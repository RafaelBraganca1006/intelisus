"""Orquestra o pipeline completo do gêmeo.

    python -m gemeo.executar            # etapas 0 a 7
    python -m gemeo.executar 4 5 7      # só algumas etapas

A etapa de download (baixar_datasus.py) roda à parte, no ambiente com PySUS.
"""
import importlib
import sys
import time

ETAPAS = {
    0: ("p00_validar", "valida arquivos do SIH no cache"),
    1: ("p01_consolidar_sih", "consolida AIHs"),
    2: ("p02_territorio", "território e população"),
    3: ("p03_capacidade", "leitos CNES e cadastro de hospitais"),
    4: ("p04_censo", "censo diário, permanência e completude"),
    5: ("p05_previsao", "calibração, backtest e previsão"),
    6: ("p06_analises", "fluxos, municípios, hospitais, planejamento"),
    8: ("p08_backtest_operacional", "backtest nas condições reais de uso (atraso de faturamento)"),
    7: ("p07_exportar", "exporta dados para o painel"),
}


def main(args):
    etapas = [int(a) for a in args] or [0, 1, 2, 3, 4, 5, 6, 8, 7]
    for e in etapas:
        mod, desc = ETAPAS[e]
        print(f"\n=== etapa {e}: {desc} ===", flush=True)
        t = time.time()
        importlib.import_module(f"gemeo.{mod}").main()
        print(f"--- {time.time() - t:.1f}s", flush=True)


if __name__ == "__main__":
    main(sys.argv[1:])
