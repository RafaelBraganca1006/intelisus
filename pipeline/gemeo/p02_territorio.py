"""Etapa 2: território e população.

- município (6 díg.) -> região de saúde (63 CIR) -> DRS (17), via ponto interior do
  polígono do município dentro do polígono da região (malhas geobr);
- população residente 2022 por faixa etária (Censo, SIDRA 9514);
- fatores de crescimento por faixa até 2045 (Projeção IBGE 2024, UF SP) aplicados à base municipal;
- GeoJSON simplificado de municípios e regiões para o painel.
"""
import json

import geopandas as gpd
import numpy as np
import pandas as pd
import requests

from .config import DRS, EXTERNOS, PROC, RAW, SIDRA_IDADE, WEB_DATA


def populacao_2022():
    cache = RAW / "sidra_9514_sp.json"
    if not cache.exists():
        url = ("https://apisidra.ibge.gov.br/values/t/9514/n6/in%20n3%2035/v/93/p/2022/c2/6794/c287/"
               + ",".join(SIDRA_IDADE) + "/c286/113635")
        r = requests.get(url, timeout=300)
        r.raise_for_status()
        cache.write_text(r.text)
    d = pd.DataFrame(json.loads(cache.read_text())[1:])
    col = [c for c in d.columns if c.endswith("C") and d[c].isin(SIDRA_IDADE.keys()).any()][0]
    d["faixa"] = d[col].map(lambda k: SIDRA_IDADE[k][0])
    d["quinq"] = d[col].map(lambda k: SIDRA_IDADE[k][1])
    d["pop"] = pd.to_numeric(d["V"], errors="coerce").fillna(0)
    d["mun"] = d["D1C"].str[:6].astype(int)
    return d


def fatores_projecao():
    x = pd.read_excel(EXTERNOS / "projecoes_2024_tab2_grupo_quinquenal.xlsx", header=None)
    anos = x.iloc[5, 5:].astype(float).astype(int).tolist()
    sp = x[(x[3] == "SP") & (x[1] == "Ambos")].copy()
    sp = sp.set_index(0).iloc[:, 4:4 + len(anos)]
    sp.columns = anos
    sp = sp.astype(float)
    sp.index = sp.index.astype(str).str.strip()
    # agrega 90+ (90-94, 95-99, 100+ -> "90+")
    sp.index = [("90+" if i.startswith(("90", "95", "100")) else i) for i in sp.index]
    sp = sp.groupby(level=0).sum()
    return sp


def main():
    mun = gpd.read_parquet(EXTERNOS / "geo_municipios_sp_2022.parquet")
    reg = gpd.read_parquet(EXTERNOS / "geo_regioes_saude_sp.parquet")
    mun["mun"] = (mun.code_muni.astype(int) // 10)
    mun = mun.to_crs(4674)
    reg = reg.to_crs(4674)
    pts = mun.copy()
    pts["geometry"] = mun.representative_point()
    j = gpd.sjoin(pts, reg[["code_health_region", "name_health_region", "geometry"]], predicate="within")
    j = j.drop_duplicates("mun")
    falta = pts[~pts.mun.isin(j.mun)]
    if len(falta):  # malhas de anos diferentes: ilhas e bordas vão para a região mais próxima
        k = gpd.sjoin_nearest(falta.to_crs(31983), reg.to_crs(31983)[["code_health_region", "name_health_region", "geometry"]])
        j = pd.concat([j, k.to_crs(4674)]).drop_duplicates("mun")
        print("atribuídos por proximidade:", ", ".join(falta.name_muni))
    mun = mun.merge(j[["mun", "code_health_region", "name_health_region"]], on="mun", how="left")
    assert mun.code_health_region.notna().all(), "município sem região de saúde"
    mun["regiao"] = mun.code_health_region.astype(int)
    mun["drs"] = mun.regiao.astype(str).str[2:4]
    mun["nome_drs"] = mun.drs.map(DRS)
    c = mun.to_crs(31983).centroid.to_crs(4674)
    mun["lon"], mun["lat"] = c.x.round(4), c.y.round(4)

    # população
    p = populacao_2022()
    pf = p.pivot_table(index="mun", columns="faixa", values="pop", aggfunc="sum").fillna(0)
    pq = p.pivot_table(index="mun", columns="quinq", values="pop", aggfunc="sum").fillna(0)
    fat = fatores_projecao()
    fat = fat.div(fat[2022], axis=0)
    anos = list(range(2014, 2046))
    linhas = []
    mapa_q = {q: f for _, (f, q) in SIDRA_IDADE.items()}
    for a in anos:
        proj = pq.mul(fat.loc[pq.columns, a], axis=1)
        agg = proj.T.groupby(proj.columns.map(mapa_q)).sum().T
        agg["ano"] = a
        linhas.append(agg.reset_index())
    pop = pd.concat(linhas).melt(id_vars=["mun", "ano"], var_name="faixa", value_name="pop")
    pop.to_parquet(PROC / "populacao.parquet")
    mun["pop2022"] = mun.mun.map(pf.sum(axis=1)).fillna(0).astype(int)
    mun["pop60"] = mun.mun.map(pf[["60-69", "70-79", "80+"]].sum(axis=1)).fillna(0).astype(int)

    cols = ["mun", "name_muni", "regiao", "name_health_region", "drs", "nome_drs", "lon", "lat", "pop2022", "pop60"]
    mun[cols].rename(columns={"name_muni": "nome", "name_health_region": "nome_regiao"}).to_parquet(PROC / "municipios.parquet")
    regs = mun.dissolve(by="regiao", aggfunc={"name_health_region": "first", "drs": "first",
                                              "nome_drs": "first", "pop2022": "sum", "pop60": "sum"}).reset_index()
    rc = regs.to_crs(31983).centroid.to_crs(4674)
    regs["lon"], regs["lat"] = rc.x.round(4), rc.y.round(4)
    regs.drop(columns="geometry").rename(columns={"name_health_region": "nome"}).to_parquet(PROC / "regioes.parquet")

    # GeoJSON leve para a web
    WEB_DATA.mkdir(parents=True, exist_ok=True)
    g = mun[["mun", "name_muni", "regiao", "drs", "geometry"]].copy()
    g["geometry"] = g.to_crs(31983).simplify(350).to_crs(4326)
    g.rename(columns={"name_muni": "nome"}).to_file(WEB_DATA / "municipios.geojson", driver="GeoJSON",
                                                     COORDINATE_PRECISION=4)
    r = regs[["regiao", "name_health_region", "drs", "geometry"]].copy()
    r["geometry"] = r.to_crs(31983).simplify(600).buffer(0).to_crs(4326)
    r.rename(columns={"name_health_region": "nome"}).to_file(WEB_DATA / "regioes.geojson", driver="GeoJSON",
                                                             COORDINATE_PRECISION=4)
    d = regs.dissolve(by="drs").reset_index()[["drs", "geometry"]]
    d["nome"] = d.drs.map(DRS)
    d["geometry"] = d.to_crs(31983).simplify(800).buffer(0).to_crs(4326)
    d.to_file(WEB_DATA / "drs.geojson", driver="GeoJSON", COORDINATE_PRECISION=4)
    print(len(mun), "municípios,", mun.regiao.nunique(), "regiões,", mun.drs.nunique(), "DRS; pop 2022 =",
          f"{mun.pop2022.sum():,}")
    print(pop[pop.mun.isin([355030])].pivot_table(index="ano", columns="faixa", values="pop").loc[[2022, 2030, 2040]].round())


if __name__ == "__main__":
    main()
