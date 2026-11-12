"""Risco (hazard) diário de alta, com efeito de calendário, estimado sem olhar o futuro.

Modelo: h(a, t) = h0_u(a) · m_g(c(t)), com a = dias decorridos, u = unidade (região x grupo)
e c(t) o "tipo de dia" da alta = dia da semana x faixa do dia do mês (dia 1, 2–5, 6–24,
25 até antepenúltimo, penúltimo, último). As faixas captam o "efeito de fim de competência"
do SIH: altas se concentram na última semana do mês (≈30% a mais no último dia) e o censo
cai ~4%; o gêmeo reproduz o censo como o SIH o mede.
Estimação por Kaplan–Meier com censura na origem t0 e ajuste alternado de h0 e m
(riscos proporcionais em tempo discreto). h0 é encolhido para a curva estadual do grupo.
"""
from datetime import date, timedelta

import numpy as np

A_MAX = 180
K_ENCOLHE = 300.0
N_FAIXAS = 6
N_TIPOS = 7 * N_FAIXAS * 2  # dia da semana x fase do mês x feriado


def faixa_mes(d: date):
    """0: dia 1; 1: 2–5; 2: 6–24; 3: 25..antepenúltimo; 4: penúltimo; 5: último."""
    ult = ((d.replace(day=28) + timedelta(4)).replace(day=1) - timedelta(1)).day
    if d.day == 1:
        return 0
    if d.day <= 5:
        return 1
    if d.day == ult:
        return 5
    if d.day == ult - 1:
        return 4
    if d.day >= 25:
        return 3
    return 2


def tipo_dia(dia0: date, n: int):
    """c(t) = dia da semana + 7·faixa do mês + 42·feriado, para t = 0..n-1 (dias desde dia0)."""
    from .previsao import feriados
    fer = {d for a in range(dia0.year, (dia0 + timedelta(n)).year + 1) for k, d in feriados(a).items()
           if not k.startswith("dez") or k in ("dez24", "dez25", "dez31")}
    out = np.zeros(n, dtype=np.int64)
    for i in range(n):
        d = dia0 + timedelta(i)
        out[i] = d.weekday() + 7 * faixa_mes(d) + 42 * (d in fer)
    return out


def separavel(num, den, iters=30):
    """m[c] = a[dow]·b[faixa]·f[feriado] por ajuste proporcional iterativo (evita células ralas)."""
    G = num.shape[0]
    nu = num.reshape(G, 2, N_FAIXAS, 7)
    de = den.reshape(G, 2, N_FAIXAS, 7)
    a, b, f = np.ones((G, 7)), np.ones((G, N_FAIXAS)), np.ones((G, 2))
    for _ in range(iters):
        a = nu.sum((1, 2)) / np.maximum((de * b[:, None, :, None] * f[:, :, None, None]).sum((1, 2)), 1e-9)
        b = nu.sum((1, 3)) / np.maximum((de * a[:, None, None, :] * f[:, :, None, None]).sum((1, 3)), 1e-9)
        f = nu.sum((2, 3)) / np.maximum((de * a[:, None, None, :] * b[:, None, :, None]).sum((2, 3)), 1e-9)
        f = np.where(de.sum((2, 3)) > 0, f, 1.0)
    m = f[:, :, None, None] * b[:, None, :, None] * a[:, None, None, :]
    return m.reshape(G, N_TIPOS)


def estimar(s, t0, n_unid, G, tipos, janela=365, iters=6):
    """h0 [U, A+1] e m [G, 14] com segmentos iniciados em [t0-janela, t0]; `tipos` = tipo_dia(...)."""
    B = A_MAX + 2
    sel = (s.inicio >= t0 - janela) & (s.inicio <= t0)
    ini = s.inicio[sel]
    L = np.minimum(np.minimum(s.fim[sel], t0 + 1) - ini, A_MAX + 1)
    evento = s.fim[sel] <= t0
    u = s.regiao[sel].astype(np.int64) * G + s.grupo[sel]
    dd = ini - (t0 - janela)  # 0..janela
    nd = janela + 1
    key = (u * nd + dd) * B + L
    tot = np.bincount(key, minlength=n_unid * nd * B).reshape(n_unid, nd, B).astype(np.float32)
    ev = np.bincount(key[evento], minlength=n_unid * nd * B).reshape(n_unid, nd, B).astype(np.float32)
    risco = np.flip(np.cumsum(np.flip(tot, -1), -1), -1)[..., 1:A_MAX + 2]  # L > a
    alta = ev[..., 1:A_MAX + 2].copy()
    alta[..., A_MAX] = ev[..., A_MAX + 1]
    del tot, ev
    # tipo do dia da alta para (início d, idade a): t = t0 - janela + d + a + 1
    a = np.arange(A_MAX + 1)
    tt = (t0 - janela) + np.arange(nd)[:, None] + a[None, :] + 1
    T = tipos[np.minimum(tt, len(tipos) - 1)]  # [nd, A+1]
    grp = np.arange(n_unid) % G
    alta_u = alta.sum(1)  # [U, A+1]
    num = np.zeros((G, N_TIPOS))
    for gg in range(G):
        num[gg] = np.bincount(T.ravel(), weights=alta[grp == gg].sum(0).ravel(), minlength=N_TIPOS)
    m = np.ones((G, N_TIPOS))
    for _ in range(iters):
        exp_u = np.zeros_like(alta_u)
        for gg in range(G):
            ug = grp == gg
            exp_u[ug] = np.einsum("uda,da->ua", risco[ug], m[gg][T].astype(np.float32))
        h0 = alta_u / np.maximum(exp_u, 1e-9)
        h0_est = np.zeros((G, A_MAX + 1))
        for gg in range(G):
            h0_est[gg] = alta_u[grp == gg].sum(0) / np.maximum(exp_u[grp == gg].sum(0), 1e-9)
        n_u = risco[:, :, 0].sum(1, keepdims=True)
        w = n_u / (n_u + K_ENCOLHE)
        h0 = w * h0 + (1 - w) * h0_est[grp]
        den = np.zeros((G, N_TIPOS))
        for gg in range(G):
            ug = grp == gg
            eg = np.einsum("uda,ua->da", risco[ug], h0[ug].astype(np.float32))
            den[gg] = np.bincount(T.ravel(), weights=eg.ravel(), minlength=N_TIPOS)
        m = separavel(num, den)
        m /= m[:, 14:21].mean(1, keepdims=True)  # referência: dias úteis 6–24, sem feriado
    return np.clip(h0, 0, 1), m


def sobrevivencia(h0):
    """S(a) = P(perm > a) implícita pelo hazard base (para exibição)."""
    s = np.cumprod(1 - np.clip(h0, 0, 1), axis=-1)
    return np.concatenate([np.ones(s.shape[:-1] + (1,)), s[..., :-1]], -1)
