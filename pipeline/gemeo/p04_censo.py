"""Etapa 4: censo diário, entradas, permanência e completude do faturamento.

Saídas (data/processed):
- censo_hosp.npz: censo diário por hospital x grupo;
- regiao_diario.npz: censo, entradas, entradas ICSAP e respiratórias por região x grupo x dia;
- permanencia.npz: curvas de sobrevivência da permanência S(a)=P(perm>a) por região x grupo;
- completude.json: fração já faturada do censo/entradas em função da distância até o corte,
  estimada por backtest em cortes históricos (o que se sabia em cada corte vs. o que veio depois).
"""
import json

import numpy as np
import pandas as pd

from .config import GRUPOS, PROC
from .segmentos import DIA0, carregar, censo, contagem, dia

A_MAX = 180  # dias de permanência modelados explicitamente


def mes_fim(yyyymm):
    y, m = divmod(yyyymm, 100)
    return int(dia(np.datetime64(f"{y + (m == 12):04d}-{m % 12 + 1:02d}-01")) - 1)


def main():
    s = carregar()
    G, R, H = len(GRUPOS), len(s.regioes), len(s.hospitais)
    corte = int(s.cmpt.max())
    D = mes_fim(corte) + 1
    print(f"{len(s):,} segmentos; {H} hospitais; corte {corte}; {D} dias")

    ch_h = s.hosp.astype(np.int64) * G + s.grupo
    ch_r = s.regiao.astype(np.int64) * G + s.grupo
    cen_h = censo(s.inicio, s.fim, ch_h, H * G, D).reshape(H, G, D)
    np.savez_compressed(PROC / "censo_hosp.npz", censo=cen_h, hospitais=s.hospitais, dia0=str(DIA0))
    cen_r = censo(s.inicio, s.fim, ch_r, R * G, D).reshape(R, G, D)
    ent = contagem(s.inicio, ch_r, R * G, D).reshape(R, G, D)
    ent_icsap = contagem(s.inicio, ch_r, R * G, D, s.icsap.astype(float)).reshape(R, G, D)
    ent_resp = contagem(s.inicio, ch_r, R * G, D, s.resp.astype(float)).reshape(R, G, D)
    ent_60 = contagem(s.inicio, ch_r, R * G, D, (s.idade >= 60).astype(float)).reshape(R, G, D)
    np.savez_compressed(PROC / "regiao_diario.npz", censo=cen_r, entradas=ent, icsap=ent_icsap,
                        resp=ent_resp, idosos=ent_60, regioes=s.regioes, dia0=str(DIA0), corte=corte)

    # --- permanência: S(a) por região x grupo, entradas de jan/2024 a set/2025 ---
    w0, w1 = int(dia(np.datetime64("2024-01-01"))), int(dia(np.datetime64("2025-09-30")))
    m = (s.inicio >= w0) & (s.inicio <= w1)
    los = np.minimum(s.fim[m] - s.inicio[m], A_MAX + 1)
    hist = np.bincount(ch_r[m] * (A_MAX + 2) + los, minlength=R * G * (A_MAX + 2)).reshape(R, G, A_MAX + 2)
    n = hist.sum(axis=2, keepdims=True)
    surv = 1 - np.cumsum(hist, axis=2)[:, :, : A_MAX + 1] / np.maximum(n, 1)
    # encolhimento para a curva estadual quando a região tem poucas internações no grupo
    est = hist.sum(axis=0)
    s_est = 1 - np.cumsum(est, axis=1)[:, : A_MAX + 1] / np.maximum(est.sum(axis=1, keepdims=True), 1)
    k = 200.0
    wgt = n / (n + k)
    surv = wgt * surv + (1 - wgt) * s_est[None]
    media = surv.sum(axis=2)  # E[perm] = soma de S(a)
    np.savez_compressed(PROC / "permanencia.npz", S=surv.astype(np.float32), S_estado=s_est.astype(np.float32),
                        n=n[..., 0])
    print("permanência média estadual (dias):",
          dict(zip(GRUPOS, np.round(s_est.sum(axis=1), 2))))

    # --- completude do faturamento por backtest em cortes históricos ---
    cortes = [202407, 202410, 202501, 202504, 202507, 202510]
    T = 200
    fr_c, fr_e = np.zeros((len(cortes), G, T)), np.zeros((len(cortes), G, T))
    for i, c in enumerate(cortes):
        dc = mes_fim(c)
        vis = s.cmpt <= c
        cen_v = censo(s.inicio[vis], s.fim[vis], s.grupo[vis].astype(np.int64), G, dc + 1)
        ent_v = contagem(s.inicio[vis], s.grupo[vis].astype(np.int64), G, dc + 1)
        cen_t = cen_r.sum(axis=0)[:, : dc + 1]
        ent_t = ent.sum(axis=0)[:, : dc + 1]
        for tau in range(T):
            d_ = dc - tau
            fr_c[i, :, tau] = cen_v[:, d_] / np.maximum(cen_t[:, d_], 1)
            fr_e[i, :, tau] = ent_v[:, d_] / np.maximum(ent_t[:, d_], 1)
    comp_c, comp_e = fr_c.mean(axis=0), fr_e.mean(axis=0)
    # data de sincronização: último dia com censo >= 97% completo em todos os grupos principais
    principais = [GRUPOS.index(g) for g in ["CLI", "CIR", "OBS", "PED", "UTI_A", "UTI_P"]]
    tau_sync = int(np.argmax((comp_c[principais] >= 0.97).all(axis=0)))
    d_sync = D - 1 - tau_sync
    info = {
        "corte": corte, "dia0": str(DIA0), "n_dias": D, "tau_sync": tau_sync,
        "data_sync": str(DIA0 + d_sync), "data_corte": str(DIA0 + D - 1),
        "completude_censo": np.round(comp_c, 4).tolist(), "completude_entradas": np.round(comp_e, 4).tolist(),
        "cortes_backtest": cortes,
    }
    (PROC / "completude.json").write_text(json.dumps(info))
    print("sincronização:", info["data_sync"], f"(τ={tau_sync} dias antes do fim de {corte})")
    for tau in [0, 15, 30, 60, 90, 120]:
        print(f"  τ={tau:3d}: censo {comp_c[0, tau]:.3f} (CLI)  {comp_c[4, tau]:.3f} (UTI_A)   entradas CLI {comp_e[0, tau]:.3f}")

    # --- estado inicial na sincronização: pacientes internados por dias decorridos ---
    em = (s.inicio <= d_sync) & (s.fim > d_sync)
    dec = np.minimum(d_sync - s.inicio[em], A_MAX)
    est0 = np.bincount(ch_r[em] * (A_MAX + 1) + dec, minlength=R * G * (A_MAX + 1)).reshape(R, G, A_MAX + 1)
    # correção pela completude residual (pacientes ainda não faturados)
    est0 = est0 / comp_c[None, :, tau_sync, None]
    np.savez_compressed(PROC / "estado_sync.npz", estado=est0.astype(np.float32), d_sync=d_sync)

    # --- resumo de sanidade: ocupação regional média nos 12 meses antes da sincronização ---
    lt = pd.read_parquet(PROC / "leitos_cnes.parquet")
    mun = pd.read_parquet(PROC / "municipios.parquet")
    lt = lt[lt.cmpt == lt.cmpt.max()].merge(mun[["mun", "regiao"]], on="mun")
    cap = lt.pivot_table(index="regiao", columns="grupo", values="sus", aggfunc="sum").reindex(
        index=s.regioes, columns=GRUPOS).fillna(0).to_numpy()
    occ = cen_r[:, :, d_sync - 365: d_sync].mean(axis=2)
    print("ocupação estadual (censo SIH / leitos SUS CNES):",
          dict(zip(GRUPOS, np.round(occ.sum(0) / cap.sum(0), 3))))


if __name__ == "__main__":
    main()
