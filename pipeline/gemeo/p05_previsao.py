"""Etapa 5: calibração, backtest e previsão oficial do gêmeo.

1. Perfis (sazonalidade, dia da semana, feriados) ajustados só com dados até 2023 para o backtest.
2. Escolha da janela de nível e da tendência em origens de calibração (jul/2022–dez/2023).
3. σ(h) do erro de nível calibrado nessas mesmas origens (h até 365 dias).
4. Avaliação fora da amostra (origens mensais jan/2024–jan/2026, h ≤ 90): WAPE da ocupação vs.
   persistência e sazonal ingênuo; cobertura dos intervalos de 80% e 95%.
5. Previsão oficial a partir da data de sincronização, com assimilação dos meses parciais.
"""
import json
from datetime import date, timedelta

import numpy as np

from . import permanencia as pm
from . import previsao as pv
from .config import GRUPOS, PROC
from .segmentos import carregar, contagem

A_MAX = 180
H_BT = 90
H_SIG = 365
FIM_PREV = date(2027, 12, 31)


def estado_em(s, t0, R, G):
    em = (s.inicio <= t0) & (s.fim > t0)
    dec = np.minimum(t0 - s.inicio[em], A_MAX)
    ch = (s.regiao[em].astype(np.int64) * G + s.grupo[em]) * (A_MAX + 1) + dec
    return np.bincount(ch, minlength=R * G * (A_MAX + 1)).reshape(R * G, A_MAX + 1).astype(float)


def prever_chegadas(ent, perfis, cal, t0, H, janela, phi, beta_on):
    """λ para t0+1..t0+H dado o que se conhece até t0 (inclusive)."""
    fm_p = pv.forma(perfis, cal, t0 + 1 - 365, t0 + 1)
    L = pv.nivel(ent[..., t0 + 1 - 365: t0 + 1], fm_p, janela)
    fm_f = pv.forma(perfis, cal, t0 + 1, t0 + 1 + H)
    lam = L[..., None] * fm_f
    beta = pv.tendencia(ent[..., t0 + 1 - 365: t0 + 1], fm_p) if beta_on else np.zeros(L.shape)
    lam *= pv.fator_tendencia(beta, H, phi)
    return lam, L, beta


def main():
    d = np.load(PROC / "regiao_diario.npz")
    ent, cen = d["entradas"].astype(float), d["censo"].astype(float)
    R, G, D = ent.shape
    comp = json.loads((PROC / "completude.json").read_text())
    dia0 = date.fromisoformat(comp["dia0"])
    d_sync = D - 1 - comp["tau_sync"]
    grp = np.arange(R * G) % G
    n_fut = (FIM_PREV - dia0).days + 1
    cal = pv.Calendario(dia0, n_fut)
    tipos = pm.tipo_dia(dia0, n_fut)
    dd = lambda x: (x - dia0).days  # noqa: E731

    print("carregando segmentos para estados históricos...")
    s = carregar("dt_saida >= DATE '2022-06-01'")

    # ---------- 1. perfis só até 2023 ----------
    fim23 = dd(date(2023, 12, 31)) + 1
    perf_bt = pv.ajustar_perfis(ent[..., :fim23], cal, [2015, 2016, 2017, 2018, 2019, 2022, 2023])

    origens_cal = [dd(date(y, m, 1)) - 1 for y in (2022, 2023) for m in range(1, 13) if (y, m) >= (2022, 7)]
    origens_ev = [dd(date(y, m, 1)) - 1 for y in (2024, 2025, 2026) for m in range(1, 13)
                  if dd(date(y, m, 1)) - 1 + H_BT <= d_sync]

    # ---------- 2. escolha da janela e tendência (erro das chegadas em 7..90 dias) ----------
    cands = [(w, phi, b) for w in (28, 56, 84, 112) for (phi, b) in ((1.0, False), (0.99, True), (0.995, True))]
    res = {}
    for w, phi, b in cands:
        err, tot = 0.0, 0.0
        for t0 in origens_cal:
            lam, _, _ = prever_chegadas(ent, perf_bt, cal, t0, H_BT, w, phi, b)
            y = ent[..., t0 + 1: t0 + 1 + H_BT]
            # erro em blocos semanais (o que importa para o leito)
            yw = y[..., :84].reshape(R, G, 12, 7).sum(-1)
            lw = lam[..., :84].reshape(R, G, 12, 7).sum(-1)
            err += np.abs(yw - lw).sum()
            tot += yw.sum()
        res[(w, phi, b)] = err / tot
    melhor = min(res, key=res.get)
    W, PHI, BETA_ON = melhor
    print("WAPE semanal das chegadas (calibração):")
    for k, v in sorted(res.items(), key=lambda kv: kv[1])[:6]:
        print("   janela=%3d φ=%.3f tendência=%s  %.4f" % (k[0], k[1], k[2], v))

    # ---------- 3. σ(h) do log-nível ----------
    r_all = [[] for _ in range(G)]
    inv_all = [[] for _ in range(G)]
    hs = np.arange(7, H_SIG + 1, 7)
    for t0 in origens_cal:
        if t0 + H_SIG + 4 > d_sync:
            continue
        lam, _, _ = prever_chegadas(ent, perf_bt, cal, t0, H_SIG + 4, W, PHI, BETA_ON)
        y = ent[..., t0 + 1: t0 + 1 + H_SIG + 4]
        rr, ii = [], []
        for h in hs:
            sl = slice(h - 4, h + 3)
            yy, ll = y[..., sl].sum(-1), lam[..., sl].sum(-1)
            rr.append(np.log(np.maximum(yy, 0.5) / np.maximum(ll, 1e-9)))
            ii.append(1 / np.maximum(ll, 1e-9))
        rr, ii = np.stack(rr, -1), np.stack(ii, -1)  # [R, G, len(hs)]
        for g in range(G):
            r_all[g].append(rr[:, g])
            inv_all[g].append(ii[:, g])
    sig = np.zeros((G, 2))
    for g in range(G):
        rr = np.concatenate(r_all[g])
        ii = np.concatenate(inv_all[g])
        ok = ii.mean(axis=1) < 1 / 20  # unidades com >= 20 entradas/semana
        rr, ii = rr[ok], ii[ok]
        v = np.maximum(((rr - rr.mean(0)) ** 2).mean(0) - ii.mean(0), 1e-6)
        X = np.column_stack([np.ones_like(hs), hs]).astype(float)
        a, b = np.linalg.lstsq(X, v, rcond=None)[0]
        sig[g] = [max(a, 1e-5), max(b, 0)]
    print("σ(h) = sqrt(a+b·h):", {GRUPOS[g]: (round(np.sqrt(sig[g, 0] + sig[g, 1] * 30), 3),
                                              round(np.sqrt(sig[g, 0] + sig[g, 1] * 180), 3)) for g in range(G)},
          "(h=30, h=180)")
    sig_h = pv.sigma_de(sig, H_SIG + 400)

    # ---------- 4. avaliação fora da amostra ----------
    HS = [7, 14, 30, 60, 90]
    z80, z95 = 1.2816, 1.96
    acc = {k: np.zeros((G, len(HS))) for k in ["abs_g", "abs_p", "abs_s", "abs_mm", "tot", "c80", "c95", "n"]}
    acc_est = {k: np.zeros((G, len(HS))) for k in ["abs_g", "abs_p", "tot", "c80", "c95", "n", "vies"]}
    exemplo = {}
    for t0 in origens_ev:
        lam, _, _ = prever_chegadas(ent, perf_bt, cal, t0, H_BT, W, PHI, BETA_ON)
        est = estado_em(s, t0, R, G)
        h0, mdow = pm.estimar(s, t0, R * G, G, tipos)
        m_seq = mdow[grp][:, tipos[t0 + 1: t0 + 1 + H_BT]]
        sg = np.repeat(sig_h[None, :, :H_BT], R, 0).reshape(R * G, H_BT)
        m, sd, _ = pv.propagar(est, lam.reshape(R * G, H_BT), h0, m_seq, sg)
        _, sd_pois, _ = pv.propagar(est, lam.reshape(R * G, H_BT), h0, m_seq, None)
        m, sd, sd_pois = m.reshape(R, G, H_BT), sd.reshape(R, G, H_BT), sd_pois.reshape(R, G, H_BT)
        # agregado estadual: nível correlacionado entre regiões (conservador: ρ=1 na parte de nível)
        m_e = m.sum(0)
        lvl = np.sqrt(np.maximum(sd ** 2 - sd_pois ** 2, 0))
        sd_e = np.sqrt((sd_pois ** 2).sum(0) + lvl.sum(0) ** 2)
        for j, h in enumerate(HS):
            y = cen[..., t0 + h]
            pers = cen[..., t0]
            szn = cen[..., t0 + h - 364] * cen[..., t0 - 27: t0 + 1].mean(-1) / np.maximum(
                cen[..., t0 - 364 - 27: t0 - 364 + 1].mean(-1), 1)
            mm = cen[..., t0 - 27: t0 + 1].mean(-1)
            acc["abs_g"][:, j] += np.abs(y - m[..., h - 1]).sum(0)
            acc["abs_p"][:, j] += np.abs(y - pers).sum(0)
            acc["abs_s"][:, j] += np.abs(y - szn).sum(0)
            acc["abs_mm"][:, j] += np.abs(y - mm).sum(0)
            acc["tot"][:, j] += y.sum(0)
            ok = y >= 5
            zz = np.abs(y - m[..., h - 1]) / np.maximum(sd[..., h - 1], 1e-9)
            acc["c80"][:, j] += ((zz <= z80) & ok).sum(0)
            acc["c95"][:, j] += ((zz <= z95) & ok).sum(0)
            acc["n"][:, j] += ok.sum(0)
            ye = y.sum(0)
            acc_est["abs_g"][:, j] += np.abs(ye - m_e[:, h - 1])
            acc_est["abs_p"][:, j] += np.abs(ye - pers.sum(0))
            acc_est["vies"][:, j] += m_e[:, h - 1] - ye
            acc_est["tot"][:, j] += ye
            ze = np.abs(ye - m_e[:, h - 1]) / sd_e[:, h - 1]
            acc_est["c80"][:, j] += ze <= z80
            acc_est["c95"][:, j] += ze <= z95
            acc_est["n"][:, j] += 1
        if t0 == dd(date(2025, 5, 1)) - 1:  # leque de exemplo: inverno de 2025
            exemplo = {"t0": str(dia0 + timedelta(t0)), "media": np.round(m_e, 1).tolist(),
                       "dp": np.round(sd_e, 1).tolist(),
                       "real": cen[..., t0 - 60: t0 + 1 + H_BT].sum(0).astype(int).tolist()}

    tabela = {}
    print("\nBACKTEST fora da amostra (%d origens) — WAPE da ocupação regional" % len(origens_ev))
    print("grupo   h   gêmeo  persist  sazonal  mm28   cob80  cob95 | estado: gêmeo persist cob80 cob95")
    for g, gn in enumerate(GRUPOS):
        tabela[gn] = []
        for j, h in enumerate(HS):
            t = acc["tot"][g, j]
            row = {"h": h, "gemeo": acc["abs_g"][g, j] / t, "persistencia": acc["abs_p"][g, j] / t,
                   "sazonal": acc["abs_s"][g, j] / t, "media_movel": acc["abs_mm"][g, j] / t,
                   "cob80": acc["c80"][g, j] / acc["n"][g, j], "cob95": acc["c95"][g, j] / acc["n"][g, j],
                   "estado_gemeo": acc_est["abs_g"][g, j] / acc_est["tot"][g, j],
                   "estado_persistencia": acc_est["abs_p"][g, j] / acc_est["tot"][g, j],
                   "estado_cob80": acc_est["c80"][g, j] / acc_est["n"][g, j],
                   "estado_cob95": acc_est["c95"][g, j] / acc_est["n"][g, j],
                   "estado_vies": acc_est["vies"][g, j] / acc_est["tot"][g, j]}
            tabela[gn].append({k: (round(v, 4) if isinstance(v, float) else v) for k, v in row.items()})
            print(f"{gn:6s} {h:3d}  {row['gemeo']:.3f}   {row['persistencia']:.3f}   {row['sazonal']:.3f}   "
                  f"{row['media_movel']:.3f}  {row['cob80']:.2f}   {row['cob95']:.2f} |  "
                  f"{row['estado_gemeo']:.3f}  {row['estado_persistencia']:.3f}  {row['estado_cob80']:.2f}  {row['estado_cob95']:.2f}  viés {row['estado_vies']:+.3f}")

    # ---------- 5. perfis finais e previsão oficial ----------
    perf = pv.ajustar_perfis(ent[..., :d_sync + 1], cal, [2015, 2016, 2017, 2018, 2019, 2022, 2023, 2024, 2025])
    H = n_fut - 1 - d_sync
    lam, L, beta = prever_chegadas(ent, perf, cal, d_sync, H, W, PHI, BETA_ON)
    # assimilação: entradas parciais após a sincronização, corrigidas pela completude
    comp_e = np.array(comp["completude_entradas"])  # [G, τ]
    obs = ent[..., d_sync + 1: D]
    tau = (D - 1) - np.arange(d_sync + 1, D)
    ce = comp_e[:, np.minimum(tau, comp_e.shape[1] - 1)]  # [G, n]
    usar = ce >= 0.5
    esp = (lam[..., : D - d_sync - 1] * ce[None]) * usar[None]
    o = (obs * usar[None]).sum(-1)
    e = esp.sum(-1)
    s2 = sig[:, 0] + sig[:, 1] * 45
    alfa = (1 / s2)[None, :]  # prior gama com CV = σ(45 dias)
    fator = (alfa + o) / (alfa + e)
    # Diagnóstico apenas: no backtest operacional (p08) a correção do nível pelos meses parciais
    # PIOROU o erro regional (a completude varia por região/hospital e a curva é estadual).
    # Por isso o nível usado na previsão NÃO é ajustado; o fator fica salvo para monitoramento.
    print("\n[diagnóstico] fator que a assimilação aplicaria (não usado):",
          dict(zip(GRUPOS, np.round((fator * L).sum(0) / L.sum(0), 3))))

    est_sync = estado_em(s, d_sync, R, G) / np.array(comp["completude_censo"])[grp, comp["tau_sync"], None]
    h0, mdow = pm.estimar(s, d_sync, R * G, G, tipos)
    m_seq = mdow[grp][:, tipos[d_sync + 1: d_sync + 1 + H]]
    sg = np.repeat(sig_h[None, :, :H], R, 0).reshape(R * G, H)
    media, dp, _ = pv.propagar(est_sync, lam.reshape(R * G, H), h0, m_seq, sg)
    np.savez_compressed(PROC / "previsao.npz", lam=lam.astype(np.float32), h0=h0.astype(np.float32),  # sem assimilação
                        mdow=mdow, estado=est_sync.astype(np.float32), media=media.astype(np.float32),
                        dp=dp.astype(np.float32), L=L.astype(np.float32),
                        beta=beta.astype(np.float32), dow=perf["dow"].astype(np.float32),
                        saz=perf["saz"], fer=perf["fer"], sig=sig, d_sync=d_sync, fator_assim=fator)
    # forma futura por grupo (sazonalidade x feriados), para o motor em JS
    X = pv.fourier(cal.doy[d_sync + 1:])
    fer_f = np.where(cal.fer[d_sync + 1:] >= 0, perf["fer"][:, np.maximum(cal.fer[d_sync + 1:], 0)], 1.0)
    forma_g = np.exp(perf["saz"] @ X.T) * fer_f
    meta = {"janela": W, "phi": PHI, "tendencia": BETA_ON, "sigma": sig.tolist(),
            "wape_calibracao": {f"{k[0]}|{k[1]}|{k[2]}": round(v, 4) for k, v in res.items()},
            "backtest": tabela, "n_origens_avaliacao": len(origens_ev),
            "origens_avaliacao": [str(dia0 + timedelta(t)) for t in (origens_ev[0], origens_ev[-1])],
            "exemplo": exemplo, "dow_estado": np.round(perf["dow_estado"], 4).tolist(),
            "forma_futura": np.round(forma_g, 4).tolist(), "dow_futuro0": int(cal.dow[d_sync + 1]),
            "saz_coef": np.round(perf["saz"], 5).tolist(), "fer_nomes": cal.nomes,
            "fer_fatores": np.round(perf["fer"], 4).tolist(), "mdow": np.round(mdow, 4).tolist()}
    (PROC / "previsao_meta.json").write_text(json.dumps(meta))


if __name__ == "__main__":
    main()
