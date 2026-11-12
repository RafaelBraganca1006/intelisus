"""Etapa 7: exporta os dados do gêmeo para o painel web (web/public/data/*.json)."""
import json
from datetime import date, datetime, timedelta

import numpy as np
import pandas as pd

from . import permanencia as pm
from .config import DRS, GRUPOS, NOME_GRUPO, PROC, WEB_DATA

FIM_PREV = date(2027, 12, 31)


def r(x, n=2):
    return np.round(np.asarray(x, dtype=float), n).tolist()


def dump(nome, obj):
    WEB_DATA.mkdir(parents=True, exist_ok=True)
    txt = json.dumps(obj, ensure_ascii=False, separators=(",", ":"), allow_nan=False)
    (WEB_DATA / nome).write_text(txt)
    print(f"  {nome:22s} {len(txt) / 1e6:6.2f} MB")


def limpa(v):
    if isinstance(v, (float, np.floating)):
        return None if not np.isfinite(v) else round(float(v), 4)
    if isinstance(v, (np.integer,)):
        return int(v)
    return v


def main():
    comp = json.loads((PROC / "completude.json").read_text())
    meta_p = json.loads((PROC / "previsao_meta.json").read_text())
    dia0 = date.fromisoformat(comp["dia0"])
    d_sync = comp["n_dias"] - 1 - comp["tau_sync"]
    D = comp["n_dias"]
    reg = np.load(PROC / "regiao_diario.npz")
    R, G, _ = reg["censo"].shape
    regioes = reg["regioes"]
    prev = np.load(PROC / "previsao.npz")
    dem = np.load(PROC / "an_demanda.npz")
    regs = pd.read_parquet(PROC / "regioes.parquet").set_index("regiao").loc[regioes].reset_index()
    mun = pd.read_parquet(PROC / "municipios.parquet")
    lt = pd.read_parquet(PROC / "leitos_cnes.parquet").merge(mun[["mun", "regiao"]], on="mun")
    cmpts = sorted(lt.cmpt.unique())
    cap_hist = lt.pivot_table(index=["regiao", "grupo"], columns="cmpt", values="sus", aggfunc="sum")
    cap_hist = cap_hist.reindex(pd.MultiIndex.from_product([regioes, GRUPOS])).fillna(0)
    cap = cap_hist[cmpts[-1]].to_numpy().reshape(R, G)
    n_fut = (FIM_PREV - dia0).days + 1
    tipos = pm.tipo_dia(dia0, n_fut)[d_sync + 1:]
    H = n_fut - 1 - d_sync
    confi = {"OUT": "baixa", "PED": "média", "OBS": "média"}

    print("exportando:")
    dump("nucleo.json", {
        "meta": {
            "gerado_em": datetime.now().isoformat(timespec="minutes"), "dia0": str(dia0),
            "data_sync": comp["data_sync"], "data_corte": comp["data_corte"], "competencia": comp["corte"],
            "d_sync": d_sync, "fim_previsao": str(FIM_PREV), "horizonte": H,
            "competencia_cnes": int(cmpts[-1]),
        },
        "grupos": [{"id": g, "nome": NOME_GRUPO[g], "confiabilidade": confi.get(g, "alta")} for g in GRUPOS],
        "drs": [{"id": k, "nome": v} for k, v in DRS.items()],
        "regioes": [{"id": int(x.regiao), "nome": x.nome, "drs": x.drs, "lon": x.lon, "lat": x.lat,
                     "pop": int(x.pop2022), "pop60": int(x.pop60)} for x in regs.itertuples()],
        "capacidade": cap.astype(int).tolist(),
        "capacidade_hist": {"competencias": [int(c) for c in cmpts],
                            "valores": cap_hist.to_numpy().reshape(R, G, -1).astype(int).tolist()},
        "motor": {
            "L": r(prev["L"], 3), "dow": r(prev["dow"], 4), "forma": r(meta_p["forma_futura"], 4),
            "tipos": tipos.astype(int).tolist(), "mdow": r(prev["mdow"], 4),
            "h0": [[float(f"{v:.4g}") for v in row] for row in prev["h0"]],
            "estado": r(prev["estado"], 2), "sigma": r(prev["sig"], 6),
            "dow_inicio": (dia0 + timedelta(d_sync + 1)).weekday(),
        },
        "demanda": {k: r(dem[k], 4) for k in ["icsap", "resp", "idosos", "icsap_dias", "resp_dias"]},
        "planejamento": {"anos": dem["anos"].astype(int).tolist(), "mult": r(dem["mult"], 4)},
        "dist": np.round(dem["dist"]).astype(int).tolist(),
    })

    # ---------- histórico ----------
    cen, ent = reg["censo"], reg["entradas"]
    w0 = 0
    W = (D - w0) // 7
    cs = cen[..., w0: w0 + 7 * W].reshape(R * G, W, 7).mean(-1)
    es = ent[..., w0: w0 + 7 * W].reshape(R * G, W, 7).sum(-1)
    di = d_sync - 540
    dump("historico.json", {
        "semanas": {"inicio": str(dia0 + timedelta(w0)), "n": W, "censo": r(cs, 1), "entradas": es.astype(int).tolist()},
        "diario": {"inicio": str(dia0 + timedelta(di)), "censo": cen[..., di:].reshape(R * G, -1).astype(int).tolist(),
                   "entradas": ent[..., di:].reshape(R * G, -1).astype(int).tolist()},
        "completude_censo": comp["completude_censo"], "completude_entradas": comp["completude_entradas"],
        "previsao_python": {"media": r(prev["media"][:, :30], 2), "dp": r(prev["dp"][:, :30], 2)},
    })

    # ---------- fluxos ----------
    fl = pd.read_parquet(PROC / "an_fluxos.parquet")
    m2r = dict(zip(mun.mun, mun.regiao))
    ridx = {int(x): i for i, x in enumerate(regioes)}
    fl["ro"] = fl.o.map(m2r).map(ridx)
    fl["rd"] = fl.d.map(m2r).map(ridx)
    fl = fl.dropna(subset=["ro", "rd"])
    mat = np.zeros((G + 1, R, R), dtype=int)
    for g in range(G):
        f = fl[fl.grupo == GRUPOS[g]]
        np.add.at(mat[g], (f.ro.astype(int), f.rd.astype(int)), f.n)
    mat[G] = mat[:G].sum(0)
    tot = fl.groupby(["o", "d"], as_index=False)["n"].sum()
    ar = tot[(tot.o != tot.d) & (tot.n >= 20)].sort_values("n", ascending=False)
    porg = fl[fl.o != fl.d].groupby(["o", "d", "grupo"])["n"].sum().unstack(fill_value=0).reindex(
        columns=GRUPOS, fill_value=0)
    arestas = [[int(a.o), int(a.d), int(a.n), porg.loc[(a.o, a.d)].astype(int).tolist()] for a in ar.itertuples()]
    dump("fluxos.json", {"matriz": mat.tolist(), "arestas": arestas})

    # ---------- municípios ----------
    ma = pd.read_parquet(PROC / "an_municipios.parquet")
    se = pd.read_parquet(PROC / "an_municipios_serie.parquet")
    meses = sorted(se.m.unique())
    sp = se.pivot_table(index="mun", columns="m", values="n", fill_value=0).reindex(columns=meses, fill_value=0)
    cols = ["mun", "nome", "regiao", "drs", "lon", "lat", "pop", "pop60", "n", "icsap", "perm", "obitos", "valor",
            "fora_mun", "fora_reg", "uti", "idosos", "resp", "taxa_pad", "taxa_icsap_pad", "taxa_bruta"]
    linhas = []
    for x in ma[cols + ["destinos"]].to_dict("records"):
        d = {k: limpa(v) for k, v in x.items() if k != "destinos"}
        d["destinos"] = x["destinos"].tolist() if isinstance(x["destinos"], np.ndarray) else (x["destinos"] or [])
        d["destinos"] = [[int(a), int(b)] for a, b in d["destinos"]]
        d["serie"] = sp.loc[x["mun"]].astype(int).tolist() if x["mun"] in sp.index else []
        linhas.append(d)
    dump("municipios.json", {"meses": [str(pd.Timestamp(m).date()) for m in meses], "municipios": linhas})

    # ---------- hospitais ----------
    hs = pd.read_parquet(PROC / "an_hospitais.parquet")
    sem = np.load(PROC / "an_hosp_semanal.npy")
    hs["semanal"] = list(np.round(sem, 1))
    hs = hs[(hs[[f"leitos_{g}" for g in GRUPOS]].sum(axis=1) > 0) | (hs.n.fillna(0) >= 200)]
    out = []
    for x in hs.to_dict("records"):
        out.append({
            "cnes": int(x["cnes"]), "nome": (x["nome"] if isinstance(x["nome"], str) else f"CNES {x['cnes']}").title(), "mun": int(x["mun"]),
            "municipio": x["municipio"] if isinstance(x["municipio"], str) else None, "regiao": limpa(x["regiao"]), "lat": limpa(x["lat"]), "lon": limpa(x["lon"]),
            "esfera": limpa(x["esfera"]) if isinstance(x["esfera"], str) else None, "natjur": x["natjur"] if isinstance(x["natjur"], str) else None, "n": limpa(x["n"]), "de_fora": limpa(x["de_fora"]),
            "perm": limpa(x["perm"]), "letal": limpa(x["letal"]), "valor": limpa(x["valor"]),
            "n_mun": limpa(x["n_mun"]),
            "leitos": [int(x[f"leitos_{g}"]) for g in GRUPOS], "censo": [round(float(x[f"censo_{g}"]), 1) for g in GRUPOS],
            "semanal": [float(v) for v in x["semanal"]],
        })
    dump("hospitais.json", {"semana_final": comp["data_sync"], "hospitais": out})

    # ---------- validação ----------
    dump("validacao.json", {k: meta_p[k] for k in ["backtest", "n_origens_avaliacao", "origens_avaliacao",
                                                   "exemplo", "janela", "phi", "tendencia", "sigma",
                                                   "wape_calibracao", "fer_nomes", "fer_fatores", "mdow",
                                                   "dow_estado"]}
         | {"operacional": json.loads((PROC / "backtest_operacional.json").read_text())
            if (PROC / "backtest_operacional.json").exists() else None}
         | {"completude": {"censo": comp["completude_censo"], "entradas": comp["completude_entradas"],
                           "tau_sync": comp["tau_sync"], "cortes": comp["cortes_backtest"]}})


if __name__ == "__main__":
    main()
