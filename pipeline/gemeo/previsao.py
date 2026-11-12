"""Motor de previsão do gêmeo: chegadas (entradas em leito) + ocupação M_t/G/∞.

Chegadas por unidade (região de saúde x grupo de leito):
    λ(t) = L · ρ(t) · dow_u(t) · saz_g(doy(t)) · fer_g(t)
- saz_g: sazonalidade anual do grupo (Fourier K=4, anos sem COVID);
- dow_u: perfil do dia da semana da unidade (encolhido para o do estado);
- fer_g: efeito de cada feriado (e de 24/12 a 01/01) por grupo;
- L: nível recente = soma das entradas nas últimas W semanas / soma do esperado sem nível;
- ρ(t): tendência amortecida (opcional; decidida pelo backtest).

Ocupação no dia T0+h (leitos como servidores infinitos, Baas et al. 2021):
    E[N(h)] = Σ_a E_a · S(a+h)/S(a) + Σ_{u=1..h} λ(T0+u) · S(h-u)
com E_a = pacientes internados em T0 com a dias decorridos e S(a) = P(permanência > a).
Incerteza: binomial (quem já está) + Poisson (quem chega) + erro de nível com σ(h)
calibrado por backtest.
"""
from datetime import date, timedelta

import numpy as np

from .config import GRUPOS

K_FOURIER = 4


def pascoa(ano):
    a, b, c = ano % 19, ano // 100, ano % 100
    d, e = b // 4, b % 4
    f = (b + 8) // 25
    g = (b - f + 1) // 3
    h = (19 * a + b - d - g + 15) % 30
    i, k = c // 4, c % 4
    l_ = (32 + 2 * e + 2 * i - h - k) % 7
    m = (a + 11 * h + 22 * l_) // 451
    mes = (h + l_ - 7 * m + 114) // 31
    dia = ((h + l_ - 7 * m + 114) % 31) + 1
    return date(ano, mes, dia)


def feriados(ano):
    """Feriados nacionais e estaduais de SP (+ período de fim de ano), nome -> data."""
    p = pascoa(ano)
    f = {
        "confraternizacao": date(ano, 1, 1), "carnaval_seg": p - timedelta(48),
        "carnaval_ter": p - timedelta(47), "cinzas": p - timedelta(46),
        "sexta_santa": p - timedelta(2), "tiradentes": date(ano, 4, 21), "trabalho": date(ano, 5, 1),
        "corpus_christi": p + timedelta(60), "revolucao_1932": date(ano, 7, 9),
        "independencia": date(ano, 9, 7), "aparecida": date(ano, 10, 12), "finados": date(ano, 11, 2),
        "republica": date(ano, 11, 15), "consciencia_negra": date(ano, 11, 20),
    }
    for d in range(22, 32):
        f[f"dez{d}"] = date(ano, 12, d)
    return f


def fourier(doy, k=K_FOURIER):
    x = 2 * np.pi * np.asarray(doy) / 365.25
    return np.column_stack([np.ones_like(x)] + [fn(j * x) for j in range(1, k + 1) for fn in (np.sin, np.cos)])


class Calendario:
    """Atributos de calendário para um intervalo de dias inteiros a partir de dia0."""

    def __init__(self, dia0: date, n: int):
        self.dia0, self.n = dia0, n
        datas = [dia0 + timedelta(int(i)) for i in range(n)]
        self.dow = np.array([d.weekday() for d in datas])
        self.doy = np.array([d.timetuple().tm_yday for d in datas])
        self.ano = np.array([d.year for d in datas])
        self.nomes = sorted(feriados(2020)) + ["mes_dia1", "mes_2a5", "mes_25", "mes_penult", "mes_ultimo"]
        self.fer = np.full(n, -1)
        # faixas do dia do mês (efeito de fim de competência); feriados têm precedência
        from .permanencia import faixa_mes
        rotulo = {0: "mes_dia1", 1: "mes_2a5", 3: "mes_25", 4: "mes_penult", 5: "mes_ultimo"}
        for i, d in enumerate(datas):
            f = faixa_mes(d)
            if f in rotulo:
                self.fer[i] = self.nomes.index(rotulo[f])
        idx = {d: i for i, d in enumerate(datas)}
        for a in range(datas[0].year, datas[-1].year + 1):
            for nome, d in feriados(a).items():
                if d in idx:
                    self.fer[idx[d]] = self.nomes.index(nome)


def ajustar_perfis(entradas, cal: Calendario, anos_fit):
    """Sazonalidade por grupo, dia da semana por unidade e fatores de feriado por grupo.

    entradas: [R, G, D]. Retorna dict com saz_coef [G, 2K+1], dow [R, G, 7], fer [G, n_fer].
    """
    R, G, D = entradas.shape
    c_ano, c_dow, c_doy, c_fer = cal.ano[:D], cal.dow[:D], cal.doy[:D], cal.fer[:D]
    est = entradas.sum(axis=0).astype(float)  # [G, D]
    ok = np.isin(c_ano, anos_fit)
    base = np.zeros_like(est)
    for g in range(G):  # média móvel centrada de 364 dias como tendência local
        c = np.convolve(est[g], np.ones(364) / 364, mode="same")
        base[g] = c
    borda = np.zeros(D, bool)
    borda[182:D - 182] = True
    dow_est = np.zeros((G, 7))
    for g in range(G):
        for w in range(7):
            m = ok & borda & (c_dow == w) & (c_fer < 0)
            dow_est[g, w] = np.mean(est[g, m] / base[g, m])
    dow_est /= dow_est.mean(axis=1, keepdims=True)
    X = fourier(c_doy)
    saz = np.zeros((G, X.shape[1]))
    for g in range(G):
        m = ok & borda & (c_fer < 0) & (base[g] > 0)
        y = np.log(np.maximum(est[g, m], 0.5) / (base[g, m] * dow_est[g, c_dow[m]]))
        saz[g] = np.linalg.lstsq(X[m], y, rcond=None)[0]
        saz[g, 0] = 0.0  # nível fica a cargo de L
    esperado = base * dow_est[:, c_dow] * np.exp(saz @ X.T)
    fer = np.ones((G, len(cal.nomes)))
    for j in range(len(cal.nomes)):
        m = ok & borda & (c_fer == j)
        if m.sum():
            fer[:, j] = (est[:, m] / esperado[:, m]).mean(axis=1)
    # dia da semana por unidade, encolhido para o do estado (k = 5000 entradas)
    dow_u = np.zeros((R, G, 7))
    rec = slice(D - 730, D)
    for w in range(7):
        m = np.zeros(D, bool)
        m[rec] = True
        m &= (c_dow == w) & (c_fer < 0)
        dow_u[:, :, w] = entradas[:, :, m].mean(axis=2)
    tot = dow_u.mean(axis=2, keepdims=True)
    raw = dow_u / np.maximum(tot, 1e-9)
    n = entradas[:, :, rec].sum(axis=2, keepdims=True)
    wgt = n / (n + 5000.0)
    dow_u = wgt * raw + (1 - wgt) * dow_est[None]
    dow_u /= dow_u.mean(axis=2, keepdims=True)
    return {"saz": saz, "dow": dow_u, "fer": fer, "dow_estado": dow_est}


def forma(perfis, cal: Calendario, t0, t1):
    """Componente sem nível de λ para os dias [t0, t1): [R, G, t1-t0]."""
    X = fourier(cal.doy[t0:t1])
    saz = np.exp(perfis["saz"] @ X.T)  # [G, T]
    fer = np.where(cal.fer[t0:t1] >= 0, perfis["fer"][:, np.maximum(cal.fer[t0:t1], 0)], 1.0)
    dow = perfis["dow"][:, :, cal.dow[t0:t1]]  # [R, G, T]
    return dow * (saz * fer)[None]


def nivel(entradas, fm_passado, janela):
    """Nível L por unidade: razão entre entradas observadas e a forma nas últimas `janela` dias."""
    return entradas[..., -janela:].sum(axis=-1) / np.maximum(fm_passado[..., -janela:].sum(axis=-1), 1e-9)


def tendencia(entradas, fm_passado, semanas=52):
    """Inclinação diária do log-nível (blocos de 4 semanas no último ano)."""
    blocos = semanas // 4
    y = entradas[..., -blocos * 28:].reshape(*entradas.shape[:-1], blocos, 28).sum(-1)
    f = fm_passado[..., -blocos * 28:].reshape(*entradas.shape[:-1], blocos, 28).sum(-1)
    ly = np.log(np.maximum(y, 1) / np.maximum(f, 1e-9))
    x = (np.arange(blocos) - (blocos - 1) / 2) * 28
    return (ly * x).sum(-1) / (x ** 2).sum()


def fator_tendencia(beta, h, phi):
    """exp(β Σ_{k=1..h} φ^k): tendência amortecida (φ=1 → linear no log)."""
    if phi >= 1:
        acc = np.arange(1, h + 1, dtype=float)
    else:
        acc = phi * (1 - phi ** np.arange(1, h + 1)) / (1 - phi)
    return np.exp(beta[..., None] * acc)


def estender_S(S, n):
    """Estende S(a) (a=0..A) até a=n-1 com risco constante estimado nos últimos 30 dias."""
    A = S.shape[-1] - 1
    if n <= A + 1:
        return S[..., :n]
    q = np.clip((S[..., A] / np.maximum(S[..., A - 30], 1e-12)) ** (1 / 30), 0, 0.999)
    extra = S[..., A:A + 1] * q[..., None] ** np.arange(1, n - A)
    return np.concatenate([S, extra], axis=-1)


def propagar(estado, lam, h0, m_seq, sigma_h=None):
    """Propaga o gêmeo dia a dia por coortes (média e variância exatas do M_t/G/∞ com
    hazard dependente do dia da semana).

    estado: [U, A+1] internados em T0 por dias decorridos (último balde = A ou mais);
    lam: [U, H] chegadas esperadas em T0+1..T0+H; h0: [U, A+1] hazard base;
    m_seq: [U, H] multiplicador do dia da semana da alta em cada dia futuro;
    sigma_h: [U, H] desvio do log-nível das chegadas (erro correlacionado no tempo).
    Retorna (media, dp, estado_final) com média/dp [U, H].
    """
    U, A1 = estado.shape
    H = lam.shape[1]
    A = A1 - 1
    Y0 = estado.astype(float)
    Y = Y0.copy()                      # quem já estava, por idade original
    Z = np.zeros((U, A1))              # chegadas, por dias decorridos
    W = np.zeros((U, A1))              # chegadas ponderadas por σ (erro de nível)
    idx0 = np.arange(A1)
    media, dp = np.zeros((U, H)), np.zeros((U, H))
    for k in range(H):
        mk = m_seq[:, k:k + 1]
        # existentes: idade atual = idade original + k (limitada a A)
        hy = np.clip(h0[:, np.minimum(idx0 + k, A)] * mk, 0, 1)
        Y = Y * (1 - hy)
        sz = 1 - np.clip(h0 * mk, 0, 1)
        Zs, Ws = Z * sz, W * sz
        Z = np.concatenate([lam[:, k:k + 1], Zs[:, :-2], Zs[:, -2:-1] + Zs[:, -1:]], axis=1)
        sg = 0 if sigma_h is None else sigma_h[:, k:k + 1]
        W = np.concatenate([lam[:, k:k + 1] * sg, Ws[:, :-2], Ws[:, -2:-1] + Ws[:, -1:]], axis=1)
        p = np.where(Y0 > 0, Y / np.maximum(Y0, 1e-12), 0)
        media[:, k] = Y.sum(1) + Z.sum(1)
        dp[:, k] = np.sqrt((Y0 * p * (1 - p)).sum(1) + Z.sum(1) + W.sum(1) ** 2)
    # estado final por dias decorridos (para encadear simulações)
    fim = Z.copy()
    ida = np.minimum(idx0 + H, A)
    for i in range(U):
        fim[i] += np.bincount(ida, weights=Y[i], minlength=A1)
    return media, dp, fim


def sigma_de(params, H):
    """σ(h) = sqrt(a + b·h) por grupo -> [G, H]."""
    h = np.arange(1, H + 1)
    return np.sqrt(np.maximum(params[:, :1] + params[:, 1:2] * h[None], 0))


__all__ = ["GRUPOS"]
