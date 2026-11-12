"""Caminhos, constantes e dicionários usados por todo o pipeline."""
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def achar_cache_pysus() -> Path:
    """Cache dos .parquet do PySUS: variável PYSUS_CACHEPATH, ~/pysus ou ~/Documents/Projetos/pysus (o primeiro que tiver RDSP*)."""
    env = os.environ.get("PYSUS_CACHEPATH")
    candidatos = ([Path(env).expanduser()] if env else []) + [Path.home() / "pysus", Path.home() / "Documents" / "Projetos" / "pysus"]
    for c in candidatos:
        if c.is_dir() and any(c.glob("RDSP*.parquet")):
            return c
    return candidatos[0]


PYSUS = achar_cache_pysus()
EXTERNOS = Path(os.environ.get("DADOS_EXTERNOS", ROOT / "data" / "external"))   # IBGE: malhas e projeções
RAW = ROOT / "data" / "raw"
PROC = ROOT / "data" / "processed"
WEB_DATA = ROOT / "web" / "public" / "data"

INICIO = "2014-01-01"      # primeira data de internação considerada
# Grupos de leito do gêmeo. Ordem = ordem de exibição.
GRUPOS = ["CLI", "CIR", "OBS", "PED", "UTI_A", "UTI_P", "OUT"]
NOME_GRUPO = {
    "CLI": "Clínico", "CIR": "Cirúrgico", "OBS": "Obstétrico", "PED": "Pediátrico",
    "UTI_A": "UTI adulto", "UTI_P": "UTI pediátrica/neonatal", "OUT": "Psiquiatria e crônicos",
}
# SIH ESPEC (especialidade do leito da AIH) -> grupo de enfermaria.
# 09 = leito-dia cirúrgico (permanência ~0): fica fora do censo.
ESPEC_GRUPO = {
    "01": "CIR", "02": "OBS", "03": "CLI", "07": "PED", "12": "CLI", "13": "CLI",
    "04": "OUT", "05": "OUT", "06": "OUT", "08": "OUT", "10": "OUT", "14": "OUT", "87": "OUT",
}
# CNES LT: TP_LEITO / CODLEITO -> grupo.
TP_LEITO_GRUPO = {"1": "CIR", "2": "CLI", "4": "OBS", "5": "PED", "6": "OUT"}
UTI_ADULTO = {"74", "75", "76", "83", "85", "86", "51"}
UTI_PED = {"77", "78", "79", "80", "81", "82", "52"}

FAIXAS = [(0, 5, "0-4"), (5, 15, "5-14"), (15, 40, "15-39"), (40, 60, "40-59"),
          (60, 70, "60-69"), (70, 80, "70-79"), (80, 200, "80+")]
# Censo 2022 (SIDRA 9514, c287) -> faixa do gêmeo; e grupo quinquenal da Projeção IBGE 2024.
SIDRA_IDADE = {
    "93070": ("0-4", "00-04"), "93084": ("5-14", "05-09"), "93085": ("5-14", "10-14"),
    "93086": ("15-39", "15-19"), "93087": ("15-39", "20-24"), "93088": ("15-39", "25-29"),
    "93089": ("15-39", "30-34"), "93090": ("15-39", "35-39"), "93091": ("40-59", "40-44"),
    "93092": ("40-59", "45-49"), "93093": ("40-59", "50-54"), "93094": ("40-59", "55-59"),
    "93095": ("60-69", "60-64"), "93096": ("60-69", "65-69"), "93097": ("70-79", "70-74"),
    "93098": ("70-79", "75-79"), "49108": ("80+", "80-84"), "49109": ("80+", "85-89"),
    "60040": ("80+", "90+"), "60041": ("80+", "90+"), "6653": ("80+", "90+"),
}

# Departamentos Regionais de Saúde (o código da região de saúde é 35DDs).
DRS = {
    "01": "Grande São Paulo", "02": "Araçatuba", "03": "Araraquara", "04": "Baixada Santista",
    "05": "Barretos", "06": "Bauru", "07": "Campinas", "08": "Franca", "09": "Marília",
    "10": "Piracicaba", "11": "Presidente Prudente", "12": "Registro", "13": "Ribeirão Preto",
    "14": "São João da Boa Vista", "15": "São José do Rio Preto", "16": "Sorocaba", "17": "Taubaté",
}

# Lista brasileira de ICSAP (Portaria SAS/MS 221/2008, via csapAIH).
ICSAP_PREFIXOS = [
    "A15", "A16", "A17", "A18", "A19", "I00", "I01", "I02", "A51", "A52", "A53", "B05", "B06",
    "B50", "B51", "B52", "B53", "B54", "B77", "A33", "A34", "A35", "A36", "A37", "A95", "B16",
    "B26", "G000", "A0", "E86", "D50", "E4", "E5", "E60", "E61", "E62", "E63", "E64", "H66",
    "J00", "J01", "J02", "J03", "J06", "J31", "J13", "J14", "J153", "J154", "J158", "J159",
    "J181", "J45", "J46", "J20", "J21", "J40", "J41", "J42", "J43", "J44", "J47", "I10", "I11",
    "I20", "I50", "J81", "I63", "I64", "I65", "I66", "I67", "I69", "G45", "G46", "E10", "E11",
    "E12", "E13", "E14", "G40", "G41", "N10", "N11", "N12", "N30", "N34", "N390", "A46", "L01",
    "L02", "L03", "L04", "L08", "N70", "N71", "N72", "N73", "N75", "N76", "K25", "K26", "K27",
    "K28", "K920", "K921", "K922", "O23", "A50", "P350",
]
# Síndromes respiratórias (para cenários epidêmicos): CID J00–J22, U04, U07, B34.2, B97.2.
RESP_REGEX = r"^(J0|J1|J20|J21|J22|U04|U07|B342|B972)"
