"""Etapa 1: consolida todos os RDSP*.parquet (SIH/AIH reduzida) numa base enxuta.

Regras:
- só AIH tipo 1 (IDENT=1). AIH 5 (longa permanência) fica de fora e é declarada como limitação;
- deduplica N_AIH mantendo a competência mais recente (reapresentação);
- internações a partir de INICIO; datas inválidas descartadas;
- grupo de enfermaria pela ESPEC; dias de UTI (UTI_MES_TO) viram um segmento de UTI
  no início da internação (o SIH não informa as datas da UTI).
"""
import duckdb

from .config import ESPEC_GRUPO, ICSAP_PREFIXOS, INICIO, PROC, PYSUS, RESP_REGEX


def _case(mapa, col):
    return "CASE " + " ".join(f"WHEN {col}='{k}' THEN '{v}'" for k, v in mapa.items()) + " END"


def main():
    PROC.mkdir(parents=True, exist_ok=True)
    con = duckdb.connect()
    con.sql("SET threads=8; SET memory_limit='9GB'; SET preserve_insertion_order=false")
    icsap = "^(" + "|".join(ICSAP_PREFIXOS) + ")"
    src = f"read_parquet('{PYSUS}/RDSP*.parquet/*.parquet', union_by_name=true, filename=true)"
    con.sql(f"""
    CREATE TEMP TABLE bruto AS
    SELECT
        N_AIH AS n_aih,
        TRY_CAST(ANO_CMPT AS INT)*100 + TRY_CAST(MES_CMPT AS INT) AS cmpt,
        TRY_CAST(CNES AS INT) AS cnes,
        TRY_CAST(MUNIC_RES AS INT) AS mun_res,
        TRY_CAST(MUNIC_MOV AS INT) AS mun_mov,
        TRY_STRPTIME(DT_INTER, '%Y%m%d')::DATE AS dt_inter,
        TRY_STRPTIME(DT_SAIDA, '%Y%m%d')::DATE AS dt_saida,
        ESPEC AS espec,
        COALESCE(TRY_CAST(UTI_MES_TO AS INT), 0) AS uti_dias,
        CASE COD_IDADE WHEN '4' THEN TRY_CAST(IDADE AS DOUBLE)
                       WHEN '5' THEN 100 + TRY_CAST(IDADE AS DOUBLE)
                       WHEN '3' THEN TRY_CAST(IDADE AS DOUBLE)/12
                       WHEN '2' THEN TRY_CAST(IDADE AS DOUBLE)/365
                       ELSE 0 END AS idade,
        SEXO AS sexo,
        TRIM(DIAG_PRINC) AS cid,
        CAR_INT AS car_int,
        TRY_CAST(VAL_TOT AS DOUBLE) AS valor,
        TRY_CAST(MORTE AS INT) AS obito,
        PROC_REA AS proc
    FROM {src}
    WHERE IDENT = '1'
    """)
    con.sql(f"""
    COPY (
      WITH d AS (
        SELECT *, ROW_NUMBER() OVER (PARTITION BY n_aih ORDER BY cmpt DESC) AS rk FROM bruto
      )
      SELECT n_aih, cmpt, cnes, mun_res, mun_mov, dt_inter, dt_saida,
             COALESCE({_case(ESPEC_GRUPO, 'espec')}, 'CLI') AS grupo,
             LEAST(uti_dias, GREATEST(DATEDIFF('day', dt_inter, dt_saida), 0)) AS uti_dias,
             DATEDIFF('day', dt_inter, dt_saida) AS perm,
             idade::FLOAT AS idade, sexo, cid,
             regexp_matches(cid, '{icsap}') AS icsap,
             regexp_matches(cid, '{RESP_REGEX}') AS resp,
             car_int <> '01' AS urgencia,
             valor, obito, proc
      FROM d
      WHERE rk = 1 AND dt_inter >= DATE '{INICIO}' AND dt_saida >= dt_inter
        AND dt_saida <= DATE '2027-01-01' AND mun_mov BETWEEN 350000 AND 359999
        AND espec <> '09'
      ORDER BY dt_inter
    ) TO '{PROC}/aih.parquet' (FORMAT parquet, COMPRESSION zstd, ROW_GROUP_SIZE 500000)
    """)
    r = con.sql(f"""SELECT count(*) n, min(dt_inter), max(dt_saida), max(cmpt),
                   avg(icsap::INT) icsap, count(DISTINCT cnes) hosp
                   FROM '{PROC}/aih.parquet'""").fetchall()
    print("AIH consolidadas:", r)
    print(con.sql(f"""SELECT grupo, count(*) n, avg(perm) perm, sum(uti_dias>0::INT)/count(*) pct_uti
                     FROM '{PROC}/aih.parquet' GROUP BY 1 ORDER BY 2 DESC""").df())


if __name__ == "__main__":
    main()
