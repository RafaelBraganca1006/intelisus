"""Transforma AIHs em segmentos de ocupação de leito (a unidade básica do gêmeo).

Cada AIH gera até dois segmentos:
- UTI: [dt_inter, dt_inter + uti_dias), grupo UTI_A (>=15 anos) ou UTI_P (<15 anos);
- enfermaria: [dt_inter + uti_dias, dt_saida), grupo pela especialidade do leito.
O paciente ocupa o leito na meia-noite do dia t se inicio <= t < fim.
"""
from dataclasses import dataclass

import duckdb
import numpy as np
import pandas as pd

from .config import GRUPOS, INICIO, PROC

DIA0 = np.datetime64(INICIO, "D")


@dataclass
class Segmentos:
    inicio: np.ndarray   # dia (int, 0 = INICIO)
    fim: np.ndarray
    grupo: np.ndarray    # índice em GRUPOS
    hosp: np.ndarray     # índice em hospitais
    regiao: np.ndarray   # índice em regioes (região de saúde do hospital)
    mun_res: np.ndarray
    cmpt: np.ndarray
    icsap: np.ndarray
    resp: np.ndarray
    idade: np.ndarray
    hospitais: np.ndarray  # códigos CNES
    regioes: np.ndarray    # códigos de região

    def __len__(self):
        return len(self.inicio)


def dia(x):
    return ((np.asarray(x, dtype="datetime64[D]") - DIA0).astype(np.int32))


def carregar(where="TRUE"):
    mun = pd.read_parquet(PROC / "municipios.parquet")
    regioes = np.sort(mun.regiao.unique())
    reg_de_mun = dict(zip(mun.mun, np.searchsorted(regioes, mun.regiao)))
    a = duckdb.sql(f"""SELECT cnes, mun_mov, mun_res, dt_inter, dt_saida, grupo, uti_dias, idade,
                         icsap, resp, cmpt FROM '{PROC}/aih.parquet' WHERE {where}""").fetchnumpy()
    ini, fim = dia(a["dt_inter"]), dia(a["dt_saida"])
    uti = np.asarray(a["uti_dias"], dtype=np.int32)
    idade = np.asarray(a["idade"], dtype=np.float32)
    g_enf = pd.Categorical(a["grupo"], categories=GRUPOS).codes.astype(np.int8)
    g_uti = np.where(idade < 15, GRUPOS.index("UTI_P"), GRUPOS.index("UTI_A")).astype(np.int8)
    cnes = np.asarray(a["cnes"]).astype(np.int64)
    hospitais, h = np.unique(cnes, return_inverse=True)
    r = pd.Series(a["mun_mov"]).map(reg_de_mun).fillna(-1).astype(int).to_numpy()
    tem_uti = uti > 0
    tem_enf = (ini + uti) < fim
    comuns = dict(hosp=h, regiao=r, mun_res=np.asarray(a["mun_res"]), cmpt=np.asarray(a["cmpt"]),
                  icsap=np.asarray(a["icsap"]), resp=np.asarray(a["resp"]), idade=idade)

    def pega(m, i0, i1, g):
        return dict(inicio=i0[m], fim=i1[m], grupo=g[m], **{k: v[m] for k, v in comuns.items()})

    p1 = pega(tem_uti, ini, ini + uti, g_uti)
    p2 = pega(tem_enf, ini + uti, fim, g_enf)
    s = {k: np.concatenate([p1[k], p2[k]]) for k in p1}
    ok = s["regiao"] >= 0
    return Segmentos(**{k: v[ok] for k, v in s.items()}, hospitais=hospitais, regioes=regioes)


def censo(inicio, fim, chave, n_chaves, n_dias):
    """Censo diário por chave: matriz [n_chaves, n_dias] (via soma cumulativa de eventos)."""
    fim = np.minimum(fim, n_dias)
    m = inicio < n_dias
    w = n_dias + 1
    d = np.bincount(chave[m] * w + inicio[m], minlength=n_chaves * w)
    d -= np.bincount(chave[m] * w + fim[m], minlength=n_chaves * w)
    return np.cumsum(d.reshape(n_chaves, w), axis=1)[:, :n_dias].astype(np.int32)


def contagem(dias, chave, n_chaves, n_dias, peso=None):
    m = (dias >= 0) & (dias < n_dias)
    return np.bincount(chave[m] * n_dias + dias[m], weights=None if peso is None else peso[m],
                       minlength=n_chaves * n_dias).reshape(n_chaves, n_dias)
