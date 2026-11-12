"""Etapa 3: capacidade instalada (CNES/LT) e cadastro de hospitais (API dados abertos do MS).

Leitos SUS (QT_SUS) por estabelecimento x grupo do gêmeo, em cada competência disponível
(dezembro de 2014 a 2025 + a mais recente). Complementares: só UTI adulto e UTI pediátrica/
neonatal entram; UCI e leito-dia ficam fora.
"""
import json
from concurrent.futures import ThreadPoolExecutor

import duckdb
import pandas as pd
import requests

from .config import PROC, PYSUS, RAW, TP_LEITO_GRUPO, UTI_ADULTO, UTI_PED

API = "https://apidadosabertos.saude.gov.br/cnes/estabelecimentos/{}"


def grupo_leito(tp, cod):
    tp, cod = str(tp).strip(), str(cod).strip()
    if tp == "3":
        return "UTI_A" if cod in UTI_ADULTO else ("UTI_P" if cod in UTI_PED else None)
    return TP_LEITO_GRUPO.get(tp)


def leitos():
    d = duckdb.sql(f"""
        SELECT TRY_CAST(CNES AS INT) cnes, TRY_CAST(CODUFMUN AS INT) mun, TP_LEITO tp, CODLEITO cod,
               TRY_CAST(QT_SUS AS INT) sus, TRY_CAST(QT_EXIST AS INT) exist, TRY_CAST(COMPETEN AS INT) cmpt
        FROM read_parquet('{PYSUS}/LTSP*.parquet/*.parquet', union_by_name=true)""").df()
    d["grupo"] = [grupo_leito(t, c) for t, c in zip(d.tp, d.cod)]
    d = d.dropna(subset=["grupo"])
    return d.groupby(["cmpt", "cnes", "mun", "grupo"], as_index=False)[["sus", "exist"]].sum()


def cadastro(cnes_list):
    cache = RAW / "cnes_api.json"
    base = json.loads(cache.read_text()) if cache.exists() else {}
    falta = [c for c in cnes_list if str(c) not in base]

    def get(c):
        try:
            r = requests.get(API.format(c), timeout=60)
            return c, (r.json() if r.ok else None)
        except Exception:  # noqa: BLE001
            return c, None

    with ThreadPoolExecutor(8) as ex:
        for c, j in ex.map(get, falta):
            if j:
                base[str(c)] = {k: j.get(k) for k in [
                    "nome_fantasia", "nome_razao_social", "latitude_estabelecimento_decimo_grau",
                    "longitude_estabelecimento_decimo_grau", "descricao_esfera_administrativa",
                    "codigo_tipo_unidade", "descricao_natureza_juridica_estabelecimento", "codigo_municipio"]}
    cache.write_text(json.dumps(base, ensure_ascii=False))
    print(f"cadastro: {len(base)} estabelecimentos ({len(falta)} consultados agora)")
    return base


def main():
    lt = leitos()
    lt.to_parquet(PROC / "leitos_cnes.parquet")
    ult = lt.cmpt.max()
    print("competências LT:", sorted(lt.cmpt.unique()))
    print(lt[lt.cmpt == ult].groupby("grupo")[["sus", "exist"]].sum())

    # hospitais: todo CNES com AIH desde 2023 ou com leito SUS na última competência
    aih = duckdb.sql(f"""SELECT cnes, any_value(mun_mov) mun, count(*) n FROM '{PROC}/aih.parquet'
                        WHERE dt_inter >= DATE '2023-01-01' GROUP BY 1""").df()
    ids = sorted(set(aih.cnes.dropna().astype(int)) | set(lt[(lt.cmpt == ult) & (lt.sus > 0)].cnes))
    cad = cadastro(ids)
    h = pd.DataFrame({"cnes": ids})
    h["nome"] = h.cnes.map(lambda c: (cad.get(str(c)) or {}).get("nome_fantasia"))
    h["lat"] = h.cnes.map(lambda c: (cad.get(str(c)) or {}).get("latitude_estabelecimento_decimo_grau"))
    h["lon"] = h.cnes.map(lambda c: (cad.get(str(c)) or {}).get("longitude_estabelecimento_decimo_grau"))
    h["esfera"] = h.cnes.map(lambda c: (cad.get(str(c)) or {}).get("descricao_esfera_administrativa"))
    h["natjur"] = h.cnes.map(lambda c: (cad.get(str(c)) or {}).get("descricao_natureza_juridica_estabelecimento"))
    mun_lt = lt.sort_values("cmpt").groupby("cnes").mun.last()
    h["mun"] = h.cnes.map(mun_lt).fillna(h.cnes.map(aih.set_index("cnes").mun))
    h = h.dropna(subset=["mun"])
    h["mun"] = h.mun.astype(int)
    h.to_parquet(PROC / "hospitais.parquet")
    print(len(h), "hospitais;", h.lat.notna().sum(), "com coordenadas")


if __name__ == "__main__":
    main()
