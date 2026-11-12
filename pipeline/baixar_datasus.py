"""Baixa do FTP do DATASUS (via PySUS) os arquivos que faltam no cache do PySUS.

O cache é achado sozinho (variável PYSUS_CACHEPATH, ~/pysus ou ~/Documents/Projetos/pysus).

- SIH/RD (AIH reduzida) de SP, mês a mês;
- CNES/LT (leitos) de SP: dezembro de cada ano + competência mais recente;
- CNES/ST (estabelecimentos) de SP: competência mais recente.

Uso (precisa do ambiente com pysus 0.9.x, que decodifica .dbc):
    python pipeline/baixar_datasus.py --ate 2026-08 --cnes 2026-09
    python pipeline/baixar_datasus.py --ate 2026-08 --cnes 2026-09 --refazer RDSP2606,RDSP2607,LTSP2609

--refazer: arquivos já no cache que o DATASUS republicou (o SIH recebe AIHs atrasadas). A versão antiga é
guardada em <cache>/_substituidos/ antes de baixar de novo.
"""
import argparse
import os
import shutil
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path


def _achar_cache():
    env = os.environ.get("PYSUS_CACHEPATH")
    cands = ([Path(env).expanduser()] if env else []) + [Path.home() / "pysus", Path.home() / "Documents" / "Projetos" / "pysus"]
    for c in cands:
        if c.is_dir() and any(c.glob("RDSP*.parquet")):
            return c
    return cands[0]


CACHE = str(_achar_cache())
os.environ["PYSUS_CACHEPATH"] = CACHE  # o PySUS lê esta variável ao ser importado
from pysus.online_data import CNES, SIH  # noqa: E402


def existe(nome):
    return os.path.exists(os.path.join(CACHE, f"{nome}.parquet"))


def baixar_rd(ano, mes):
    nome = f"RDSP{ano % 100:02d}{mes:02d}"
    if existe(nome):
        return nome, "cache"
    SIH.download("SP", ano, mes, group="RD")
    return nome, "ok" if existe(nome) else "falhou"


def baixar_cnes(grupo, ano, mes):
    nome = f"{grupo}SP{ano % 100:02d}{mes:02d}"
    if existe(nome):
        return nome, "cache"
    CNES.download(grupo, "SP", ano, mes)
    return nome, "ok" if existe(nome) else "falhou"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--desde", default="2010-01")
    ap.add_argument("--ate", default="2026-07", help="última competência SIH")
    ap.add_argument("--cnes", default="2026-08", help="última competência CNES")
    ap.add_argument("--refazer", default="", help="nomes (RDSP2606,LTSP2609…) a baixar de novo, guardando a versão antiga")
    a = ap.parse_args()
    print("cache:", CACHE, flush=True)
    for nome in [x.strip() for x in a.refazer.split(",") if x.strip()]:
        antigo = Path(CACHE) / f"{nome}.parquet"
        if antigo.exists():
            destino = Path(CACHE) / "_substituidos"
            destino.mkdir(exist_ok=True)
            shutil.move(str(antigo), str(destino / f"{nome}.{time.strftime('%Y%m%d-%H%M%S')}.parquet"))
            print("guardada versão antiga de", nome, flush=True)
    y0, m0 = map(int, a.desde.split("-"))
    y1, m1 = map(int, a.ate.split("-"))
    yc, mc = map(int, a.cnes.split("-"))

    tarefas = [("RD", y, m) for y in range(y0, y1 + 1) for m in range(1, 13)
               if (y, m) >= (y0, m0) and (y, m) <= (y1, m1)]
    tarefas += [("LT", y, 12) for y in range(2014, yc)] + [("LT", yc, mc), ("ST", yc, mc)]

    with ThreadPoolExecutor(max_workers=4) as ex:
        futs = {}
        for g, y, m in tarefas:
            fn = baixar_rd if g == "RD" else (lambda y, m, g=g: baixar_cnes(g, y, m))
            futs[ex.submit(fn, y, m)] = (g, y, m)
        for f in as_completed(futs):
            g, y, m = futs[f]
            try:
                nome, st = f.result()
                if st != "cache":
                    print(nome, st, flush=True)
            except Exception as e:  # noqa: BLE001
                print(g, y, m, "ERRO", e, flush=True)
    print("fim", flush=True)


if __name__ == "__main__":
    main()
