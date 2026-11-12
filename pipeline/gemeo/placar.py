"""Placar de acertos: compara a previsão que o gêmeo tinha ANTES de uma atualização com o que de fato aconteceu.

Cada vez que entram dados novos, os dias entre a sincronização anterior e a nova viram "gabarito" para a
previsão antiga (que cobre 30 dias a partir da sincronização). O resultado é gravado em
`web/public/data/placar.json` (lista, a mais recente primeiro) e aparece na página Validação e método.

    python -m gemeo.placar --anterior <pasta com os JSON antigos> [--atual web/public/data]

Métricas (por região × tipo de leito, só unidades com censo médio ≥ 5):
- WAPE regional: Σ|previsto − real| / Σ real. Comparado com "persistência" (manter o último censo observado).
- Erro e viés do total estadual: média diária de |P − R| / R e de (P − R) / R.
- Cobertura do intervalo de 80%: fração dos dias em que o real caiu dentro de previsto ± 1,2816·dp.
"""
import argparse
import json
import time
from datetime import date, timedelta
from pathlib import Path

import numpy as np

from .config import WEB_DATA

Z80 = 1.2816


def _wape(p, o, m):
    return float(np.abs(p[m] - o[m]).sum() / o[m].sum())


def avaliar(ant: Path, atu: Path) -> dict | None:
    try:
        hA, hN = json.loads((ant / "historico.json").read_text()), json.loads((atu / "historico.json").read_text())
        nA, nN = json.loads((ant / "nucleo.json").read_text()), json.loads((atu / "nucleo.json").read_text())
        pm, pdp = np.array(hA["previsao_python"]["media"]), np.array(hA["previsao_python"]["dp"])
    except (OSError, KeyError, json.JSONDecodeError):
        return None
    syncA, syncN = date.fromisoformat(nA["meta"]["data_sync"]), date.fromisoformat(nN["meta"]["data_sync"])
    dias = min(pm.shape[1], (syncN - syncA).days)
    if dias < 7:  # sem pelo menos uma semana de gabarito não há o que avaliar
        return None
    iniA, iniN = date.fromisoformat(hA["diario"]["inicio"]), date.fromisoformat(hN["diario"]["inicio"])
    idx = [(syncA + timedelta(days=1 + h) - iniN).days for h in range(dias)]
    if min(idx) < 0:
        return None
    real = np.array(hN["diario"]["censo"])[:, idx]
    ultimo = np.array(hA["diario"]["censo"])[:, (syncA - iniA).days]
    pers = np.repeat(ultimo[:, None], dias, axis=1)
    pm, pdp = pm[:, :dias], pdp[:, :dias]
    G, R = len(nA["grupos"]), len(nA["regioes"])
    grande = real.mean(axis=1) >= 5
    todas = np.repeat(grande[:, None], dias, axis=1)

    def bloco(us):
        m = np.zeros_like(real, bool)
        m[[u for u in us if grande[u]], :] = True
        P, O, Pe = pm[us].sum(0), real[us].sum(0), pers[us].sum(0)
        cob = [np.mean(np.abs(real[u] - pm[u]) <= Z80 * pdp[u]) for u in us if grande[u]]
        return {"wape": _wape(pm, real, m), "wape_persistencia": _wape(pers, real, m),
                "erro_estado": float(np.mean(np.abs(P - O) / O)), "vies_estado": float(np.mean((P - O) / O)),
                "cobertura_ic80": float(np.mean(cob)) if cob else None}

    por_tipo = []
    for g, gr in enumerate(nA["grupos"]):
        por_tipo.append({"id": gr["id"], "nome": gr["nome"], "confiabilidade": gr.get("confiabilidade"), **bloco([r * G + g for r in range(R)])})
    geral = bloco(list(range(len(real))))
    geral["wape"] = _wape(pm, real, todas)
    geral["wape_persistencia"] = _wape(pers, real, todas)
    datas = [(syncA + timedelta(days=1 + h)).isoformat() for h in range(dias)]
    return {
        "gerado_em": time.strftime("%Y-%m-%dT%H:%M"), "previsao_de": syncA.isoformat(), "sync_atual": syncN.isoformat(),
        "competencia_atual": nN["meta"].get("competencia"), "periodo": [datas[0], datas[-1]], "dias": dias, "unidades": int(grande.sum()),
        "geral": geral, "por_tipo": por_tipo,
        "estado": {"datas": datas, "previsto": [round(float(x)) for x in pm.sum(0)], "observado": [round(float(x)) for x in real.sum(0)]},
    }


def registrar(ant: Path, atu: Path = WEB_DATA) -> dict | None:
    """Avalia e acrescenta (ou substitui, se for a mesma previsão) a entrada em placar.json."""
    r = avaliar(ant, atu)
    if r is None:
        return None
    f = atu / "placar.json"
    lista = json.loads(f.read_text()) if f.exists() else []
    lista = [x for x in lista if x.get("previsao_de") != r["previsao_de"]]
    lista.insert(0, r)
    f.write_text(json.dumps(lista, ensure_ascii=False, separators=(",", ":")))
    return r


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--anterior", required=True, type=Path)
    ap.add_argument("--atual", type=Path, default=WEB_DATA)
    a = ap.parse_args()
    r = registrar(a.anterior, a.atual)
    if r is None:
        print("sem gabarito suficiente para avaliar (menos de 7 dias novos ou arquivos ausentes)")
        return
    g = r["geral"]
    print(f"previsão de {r['previsao_de']} vs {r['periodo'][0]} a {r['periodo'][1]} ({r['dias']} dias, {r['unidades']} unidades): "
          f"WAPE regional {100 * g['wape']:.1f}% (persistência {100 * g['wape_persistencia']:.1f}%), "
          f"erro estadual {100 * g['erro_estado']:.1f}%, viés {100 * g['vies_estado']:+.1f}%, cobertura IC80 {100 * g['cobertura_ic80']:.0f}%")


if __name__ == "__main__":
    main()
