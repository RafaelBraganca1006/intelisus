import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Historico, Nucleo } from '../data/tipos';
import { propagar } from './motor';

const n: Nucleo = JSON.parse(readFileSync('public/data/nucleo.json', 'utf8'));
const h: Historico = JSON.parse(readFileSync('public/data/historico.json', 'utf8'));

describe('motor TS = motor Python', () => {
  it('reproduz média e desvio dos primeiros 30 dias para todas as unidades', () => {
    let maxRel = 0;
    for (let u = 0; u < n.motor.h0.length; u++) {
      const p = propagar(n, u, 30);
      for (let k = 0; k < 30; k++) {
        const py = h.previsao_python.media[u][k];
        if (py < 5) continue;
        maxRel = Math.max(maxRel, Math.abs(p.media[k] - py) / py);
        const sd = Math.sqrt(p.varInd[k] + p.sdNivel[k] ** 2);
        expect(Math.abs(sd - h.previsao_python.dp[u][k]) / h.previsao_python.dp[u][k]).toBeLessThan(0.02);
      }
    }
    expect(maxRel).toBeLessThan(0.01);
  });
});
