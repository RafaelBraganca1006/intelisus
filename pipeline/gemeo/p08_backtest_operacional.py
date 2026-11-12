"""Etapa 8: backtest OPERACIONAL — o gêmeo nas condições reais de uso.

Para cada corte de faturamento C (competências jul/2024 a nov/2025), usa SOMENTE as AIHs com
competência <= C (o que o gestor teria em mãos), sincroniza 93 dias antes do fim de C, propaga e
compara com o censo que de fato ocorreu (conhecido depois) em quatro alvos:
  - último dia faturado (fim de C);  - "hoje" = fim de C + 56 dias (a defasagem atual do painel);
  - hoje + 4 semanas;                 - hoje + 90 dias.
Referência ingênua: último censo visível na sincronização, mantido constante.
Perfis de chegada ajustados só até 2023 (sem vazamento para 2024–2026).
"""
import json
from datetime import date, timedelta

import numpy as np
import pandas as pd

from . import permanencia as pm
from . import previsao as pv
from .config import GRUPOS, PROC
from .p05_previsao import estado_em, prever_chegadas
from .segmentos import Segmentos, carregar, censo, contagem

ALVOS = {"ultimo_faturado": 0, "hoje": 56, "hoje_4sem": 84, "hoje_90d": 146}


def main():
    d = np.load(PROC / "regiao_diario.npz")
    ent, cen = d["entradas"].astype(float), d["censo"].astype(float)
    R, G, D = ent.shape
    comp = json.loads((PROC / "completude.json").read_text())
    meta = json.loads((PROC / "previsao_meta.json").read_text())
    dia0 = date.fromisoformat(comp["dia0"])
    dd = lambda x: (x - dia0).days  # noqa: E731
    d_sync, tau = D - 1 - comp["tau_sync"], comp["tau_sync"]
    comp_c = np.array(comp["completude_censo"])
    sig = np.array(meta["sigma"])
    cal = pv.Calendario(dia0, D + 800)
    tipos = pm.tipo_dia(dia0, D + 800)
    grp = np.arange(R * G) % G
    perf = pv.ajustar_perfis(ent[..., :dd(date(2023, 12, 31)) + 1], cal, [2015, 2016, 2017, 2018, 2019, 2022, 2023])
    sig_h = pv.sigma_de(sig, 800)
    s = carregar("dt_saida >= DATE '2022-06-01'")
    lt = pd.read_parquet(PROC / "leitos_cnes.parquet").merge(pd.read_parquet(PROC / "municipios.parquet")[["mun", "regiao"]], on="mun")
    H = tau + max(ALVOS.values()) + 1
    res = {g: {a: {"reg": [], "ing": [], "est": [], "pp": [], "c80": []} for a in ALVOS} for g in GRUPOS}
    datas = []
    for y in (2024, 2025):
        for mo in range(1, 13):
            if (y, mo) < (2024, 7):
                continue
            dc = dd(date(y + (mo == 12), mo % 12 + 1, 1)) - 1
            ds = dc - tau
            if ds + H > d_sync:
                continue
            C = y * 100 + mo
            vis = s.cmpt <= C
            sv = Segmentos(**{k: getattr(s, k)[vis] for k in ["inicio", "fim", "grupo", "hosp", "regiao", "mun_res",
                                                               "cmpt", "icsap", "resp", "idade"]},
                           hospitais=s.hospitais, regioes=s.regioes)
            ch = sv.regiao.astype(np.int64) * G + sv.grupo
            entv = ent.copy()
            k0 = dd(date(2022, 6, 1))
            entv[..., k0:dc + 1] = contagem(sv.inicio, ch, R * G, dc + 1).reshape(R, G, dc + 1)[..., k0:]
            entv[..., dc + 1:] = 0
            est = estado_em(sv, ds, R, G) / comp_c[grp, tau, None]
            ing = censo(sv.inicio, sv.fim, ch, R * G, ds + 1).reshape(R, G, ds + 1)[..., ds] / comp_c[None, :, tau]
            h0, m = pm.estimar(sv, ds, R * G, G, tipos)
            lam, _, _ = prever_chegadas(entv, perf, cal, ds, H, meta["janela"], meta["phi"], meta["tendencia"])
            sg = np.repeat(sig_h[None, :, :H], R, 0).reshape(R * G, H)
            mu, sd, _ = pv.propagar(est, lam.reshape(R * G, H), h0, m[grp][:, tipos[ds + 1: ds + 1 + H]], sg)
            mu, sd = mu.reshape(R, G, H), sd.reshape(R, G, H)
            cmp_cap = max(c for c in lt.cmpt.unique() if c <= C)
            cap = lt[lt.cmpt == cmp_cap].pivot_table(index="regiao", columns="grupo", values="sus", aggfunc="sum") \
                .reindex(index=s.regioes, columns=GRUPOS).fillna(0).to_numpy()
            datas.append(str(dia0 + timedelta(dc)))
            for a, off in ALVOS.items():
                h = tau + off
                yv, mv, sv_ = cen[..., ds + h], mu[..., h - 1], sd[..., h - 1]
                ok = yv >= 5
                for gi, g in enumerate(GRUPOS):
                    r = res[g][a]
                    r["reg"].append(np.abs(yv[:, gi] - mv[:, gi]).sum() / yv[:, gi].sum())
                    r["ing"].append(np.abs(yv[:, gi] - ing[:, gi]).sum() / yv[:, gi].sum())
                    r["est"].append(abs(yv[:, gi].sum() - mv[:, gi].sum()) / yv[:, gi].sum())
                    r["pp"].append(np.abs(yv[:, gi] - mv[:, gi]).sum() / max(cap[:, gi].sum(), 1) * 100)
                    z = np.abs(yv[:, gi] - mv[:, gi]) / np.maximum(sv_[:, gi], 1e-9)
                    r["c80"].append(((z <= 1.2816) & ok[:, gi]).sum() / max(ok[:, gi].sum(), 1))
    out = {"cortes": datas, "alvos": ALVOS, "tau_sync": tau,
           "resultado": {g: {a: {k: round(float(np.mean(v)), 4) for k, v in r.items()} for a, r in gs.items()}
                         for g, gs in res.items()}}
    (PROC / "backtest_operacional.json").write_text(json.dumps(out))
    print(f"backtest operacional: {len(datas)} cortes ({datas[0]} a {datas[-1]})")
    for g in ["CLI", "CIR", "UTI_A", "UTI_P", "OBS", "PED"]:
        r = out["resultado"][g]
        print(f"  {g:6s}" + "  ".join(f"{a}: {r[a]['reg']*100:4.1f}% (ing {r[a]['ing']*100:4.1f}%, est {r[a]['est']*100:3.1f}%, "
                                     f"{r[a]['pp']:.1f}pp, c80 {r[a]['c80']*100:.0f}%)" for a in ["hoje", "hoje_90d"]))


if __name__ == "__main__":
    main()
