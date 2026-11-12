"""Etapa 6: fluxos, municípios, hospitais, composição da demanda e planejamento 2045.

Janela de referência: 12 meses completos até a data de sincronização.
"""
import json
from datetime import date, timedelta

import duckdb
import numpy as np
import pandas as pd

from .config import FAIXAS, GRUPOS, PROC
from .segmentos import carregar


def faixa_sql(col="idade"):
    return "CASE " + " ".join(f"WHEN {col} < {b} THEN '{n}'" for _, b, n in FAIXAS) + " END"


def main():
    comp = json.loads((PROC / "completude.json").read_text())
    dia0 = date.fromisoformat(comp["dia0"])
    sync = date.fromisoformat(comp["data_sync"])
    ini = sync - timedelta(364)
    d_sync = (sync - dia0).days
    mun = pd.read_parquet(PROC / "municipios.parquet")
    regs = pd.read_parquet(PROC / "regioes.parquet")
    pop = pd.read_parquet(PROC / "populacao.parquet")
    con = duckdb.connect()
    con.register("mun", mun)
    w = f"dt_inter BETWEEN DATE '{ini}' AND DATE '{sync}'"
    A = f"'{PROC}/aih.parquet'"

    # ---------- municípios de residência ----------
    base = con.sql(f"""
        SELECT a.mun_res AS mun, count(*) n, sum(icsap::INT) icsap, avg(perm) perm,
               sum(obito) obitos, sum(valor) valor, avg((a.mun_mov <> a.mun_res)::INT) fora_mun,
               avg((m2.regiao <> m1.regiao)::INT) fora_reg, sum((uti_dias > 0)::INT) uti,
               sum((idade >= 60)::INT) idosos, sum(resp::INT) resp
        FROM {A} a JOIN mun m1 ON m1.mun = a.mun_res LEFT JOIN mun m2 ON m2.mun = a.mun_mov
        WHERE {w} GROUP BY 1""").df()
    fx = con.sql(f"""SELECT mun_res mun, {faixa_sql()} faixa, count(*) n, sum(icsap::INT) ni FROM {A}
                     WHERE {w} GROUP BY 1, 2""").df()
    p25 = pop[pop.ano == sync.year]
    padrao = p25.groupby("faixa")["pop"].sum()
    padrao = padrao / padrao.sum()
    t = fx.merge(p25, on=["mun", "faixa"])
    t["taxa"] = t.n / t["pop"].clip(lower=1) * 1000
    t["taxa_i"] = t.ni / t["pop"].clip(lower=1) * 1000
    t["w"] = t.faixa.map(padrao)
    pad = t.groupby("mun").apply(lambda x: pd.Series({"taxa_pad": (x.taxa * x.w).sum(),
                                                       "taxa_icsap_pad": (x.taxa_i * x.w).sum()}),
                                 include_groups=False)
    popm = p25.groupby("mun")["pop"].sum().rename("pop")
    mres = mun.merge(base, on="mun", how="left").merge(pad, on="mun", how="left").merge(popm, on="mun", how="left")
    mres["taxa_bruta"] = mres.n / mres["pop"] * 1000
    # principais destinos
    dest = con.sql(f"""SELECT mun_res, mun_mov, count(*) n FROM {A} WHERE {w} AND mun_res <> mun_mov
                       GROUP BY 1, 2 QUALIFY row_number() OVER (PARTITION BY mun_res ORDER BY n DESC) <= 3""").df()
    top = dest.groupby("mun_res").apply(lambda x: [[int(a), int(b)] for a, b in zip(x.mun_mov, x.n)],
                                        include_groups=False)
    mres["destinos"] = mres.mun.map(top)
    # série mensal de internações por residência (36 meses)
    serie = con.sql(f"""SELECT mun_res mun, date_trunc('month', dt_inter) m, count(*) n FROM {A}
                        WHERE dt_inter >= DATE '{sync.replace(day=1) - timedelta(1095)}' AND dt_inter <= DATE '{sync}'
                        GROUP BY 1, 2""").df()
    mres.to_parquet(PROC / "an_municipios.parquet")
    serie.to_parquet(PROC / "an_municipios_serie.parquet")

    # ---------- fluxos ----------
    fl = con.sql(f"""SELECT mun_res o, mun_mov d, grupo, count(*) n, sum((uti_dias>0)::INT) uti
                     FROM {A} WHERE {w} AND mun_res BETWEEN 350000 AND 359999 GROUP BY 1, 2, 3""").df()
    fl.to_parquet(PROC / "an_fluxos.parquet")

    # ---------- hospitais ----------
    ch = np.load(PROC / "censo_hosp.npz")
    cen_h, hosp_ids = ch["censo"], ch["hospitais"]
    occ_media = cen_h[:, :, d_sync - 364: d_sync + 1].mean(2)  # [H, G]
    h = pd.read_parquet(PROC / "hospitais.parquet")
    lt = pd.read_parquet(PROC / "leitos_cnes.parquet")
    lt_ult = lt[lt.cmpt == lt.cmpt.max()].pivot_table(index="cnes", columns="grupo", values="sus",
                                                         aggfunc="sum").reindex(columns=GRUPOS).fillna(0)
    hs = pd.DataFrame(occ_media, columns=[f"censo_{g}" for g in GRUPOS])
    hs["cnes"] = hosp_ids
    for g in GRUPOS:
        hs[f"leitos_{g}"] = hs.cnes.map(lt_ult[g]).fillna(0)
    hstat = con.sql(f"""SELECT cnes, count(*) n, avg((m2.regiao <> m1.regiao)::INT) de_fora,
                          avg(perm) perm, sum(obito)/count(*) letal, sum(valor) valor,
                          count(DISTINCT a.mun_res) n_mun
                        FROM {A} a JOIN mun m1 ON m1.mun = a.mun_res JOIN mun m2 ON m2.mun = a.mun_mov
                        WHERE {w} GROUP BY 1""").df()
    hs = hs.merge(hstat, on="cnes", how="left").merge(h, on="cnes", how="left")
    hs = hs.merge(mun[["mun", "regiao", "nome"]].rename(columns={"nome": "municipio"}), on="mun", how="left")
    # série semanal do censo total de cada hospital (104 semanas)
    tot = cen_h.sum(1)[:, d_sync - 7 * 104 + 1: d_sync + 1].reshape(len(hosp_ids), 104, 7).mean(2)
    np.save(PROC / "an_hosp_semanal.npy", tot.astype(np.float32))
    hs.to_parquet(PROC / "an_hospitais.parquet")

    # ---------- composição da demanda e planejamento ----------
    s = carregar(f"dt_inter BETWEEN DATE '{ini}' AND DATE '{sync}'")
    R, G = len(s.regioes), len(GRUPOS)
    u = s.regiao.astype(np.int64) * G + s.grupo
    dur = np.minimum(s.fim, d_sync + 400) - s.inicio  # leitos-dia gerados
    n_u = np.bincount(u, minlength=R * G).astype(float)
    comp_dem = {
        "icsap": np.bincount(u, weights=s.icsap.astype(float), minlength=R * G) / np.maximum(n_u, 1),
        "resp": np.bincount(u, weights=s.resp.astype(float), minlength=R * G) / np.maximum(n_u, 1),
        "idosos": np.bincount(u, weights=(s.idade >= 60).astype(float), minlength=R * G) / np.maximum(n_u, 1),
        "icsap_dias": np.bincount(u, weights=s.icsap * dur, minlength=R * G) / np.maximum(
            np.bincount(u, weights=dur, minlength=R * G), 1),
        "resp_dias": np.bincount(u, weights=s.resp * dur, minlength=R * G) / np.maximum(
            np.bincount(u, weights=dur, minlength=R * G), 1),
    }
    # multiplicador demográfico: leitos-dia por (unidade, município de residência, faixa) x crescimento da faixa
    fx_idx = np.digitize(s.idade, [b for _, b, _ in FAIXAS[:-1]])
    faixas = [n for _, _, n in FAIXAS]
    df = pd.DataFrame({"u": u, "mun": s.mun_res, "faixa": np.array(faixas)[fx_idx], "dias": dur})
    agg = df.groupby(["u", "mun", "faixa"], as_index=False)["dias"].sum()
    pp = pop.pivot_table(index=["mun", "faixa"], columns="ano", values="pop")
    anos = list(range(sync.year, 2046))
    cres = pp[anos].div(pp[sync.year], axis=0)
    agg = agg.merge(cres.reset_index(), on=["mun", "faixa"], how="left").fillna(1.0)  # fora de SP: 1
    mult = np.ones((R * G, len(anos)))
    for j, a in enumerate(anos):
        num = np.bincount(agg.u, weights=agg.dias * agg[a], minlength=R * G)
        den = np.bincount(agg.u, weights=agg.dias, minlength=R * G)
        mult[:, j] = np.where(den > 0, num / np.maximum(den, 1e-9), 1)
    # distâncias entre regiões (km, haversine entre centroides)
    la, lo = np.radians(regs.set_index("regiao").loc[s.regioes, "lat"]), np.radians(
        regs.set_index("regiao").loc[s.regioes, "lon"])
    dlat = la.values[:, None] - la.values[None]
    dlon = lo.values[:, None] - lo.values[None]
    hav = np.sin(dlat / 2) ** 2 + np.cos(la.values[:, None]) * np.cos(la.values[None]) * np.sin(dlon / 2) ** 2
    dist = 2 * 6371 * np.arcsin(np.sqrt(hav))
    np.savez_compressed(PROC / "an_demanda.npz", mult=mult, anos=np.array(anos), dist=dist,
                        **{k: v for k, v in comp_dem.items()})
    est = mult.reshape(R, G, -1).mean(0)
    print("multiplicador demográfico médio 2030/2040 por grupo:",
          {g: (round(est[i, anos.index(2030)], 3), round(est[i, anos.index(2040)], 3)) for i, g in enumerate(GRUPOS)})
    print("ICSAP (% entradas) por grupo:", dict(zip(GRUPOS, np.round(
        (comp_dem["icsap"] * n_u).reshape(R, G).sum(0) / n_u.reshape(R, G).sum(0), 3))))
    print(len(mres), "municípios;", len(fl), "fluxos;", len(hs), "hospitais")


if __name__ == "__main__":
    main()
