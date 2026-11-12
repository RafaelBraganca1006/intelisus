"""Etapa 0: valida cada RDSP*.parquet do cache antes de consolidar.

Arquivos do FTP do DATASUS às vezes chegam truncados/corrompidos (já aconteceu com
1309, 1311, 1403, 1404, 1512, 1601, 1708, 1709, 1804, 1805). Critérios de alerta:
- menos de 99,9% de DT_INTER válidas; ou
- linhas < 85% da mediana móvel de 13 meses.
Arquivos suspeitos devem ser movidos para ~/pysus/_corrompidos e baixados de novo.
"""
import duckdb

from .config import PYSUS

CONHECIDOS = {"2004", "2005"}  # abr–mai/2020


def main():
    r = duckdb.sql(f"""
        SELECT regexp_extract(filename, 'RDSP(\\d+)', 1) AS f, count(*) AS n,
               avg((TRY_STRPTIME(DT_INTER, '%Y%m%d') IS NOT NULL)::INT) AS ok
        FROM read_parquet('{PYSUS}/RDSP*.parquet/*.parquet', filename=true, union_by_name=true)
        GROUP BY 1 ORDER BY 1""").df()
    r["rel"] = r.n / r.n.rolling(13, center=True, min_periods=5).median()
    ruins = r[(r.ok < 0.999) | (r.rel < 0.85)]
    # abr–mai/2020 são baixos de verdade (COVID), não arquivos truncados: documentado em docs/METODOLOGIA.md
    conhecidos = ruins[ruins.f.isin(CONHECIDOS)]
    ruins = ruins[~ruins.f.isin(CONHECIDOS)]
    print(f"{len(r)} arquivos RD; suspeitos:")
    print(ruins.to_string(index=False) if len(ruins) else "  nenhum")
    if len(conhecidos):
        print("  (ignorados, queda real da COVID: " + ", ".join(conhecidos.f) + ")")
    return ruins


if __name__ == "__main__":
    main()
