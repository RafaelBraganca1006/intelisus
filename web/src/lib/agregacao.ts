import type { Nucleo } from '../data/tipos';
import { RHO } from '../engine/motor';
import type { Previsao } from '../store';

/** Previsão agregada (média, dp) para um conjunto de unidades, dias k0..k1. */
export function serieAgregada(n: Nucleo, p: Previsao, us: number[], k0 = 0, k1 = n.meta.horizonte) {
  const H = n.meta.horizonte, L = k1 - k0;
  const media = new Float64Array(L), dp = new Float64Array(L);
  for (let i = 0; i < L; i++) {
    const k = k0 + i;
    let m = 0, v = 0, s = 0, s2 = 0;
    for (const u of us) {
      const j = u * H + k;
      m += p.media[j]; v += p.varInd[j]; s += p.sdNivel[j]; s2 += p.sdNivel[j] ** 2;
    }
    media[i] = m; dp[i] = Math.sqrt(v + RHO * s * s + (1 - RHO) * s2);
  }
  return { media, dp };
}

export const capacidade = (n: Nucleo, us: number[]) => {
  const G = n.grupos.length;
  return us.reduce((s, u) => s + n.capacidade[Math.floor(u / G)][u % G], 0);
};

/** Ocupação média e dp de uma unidade no dia k. */
export function noDia(n: Nucleo, p: Previsao, u: number, k: number) {
  const j = u * n.meta.horizonte + k;
  return { m: p.media[j], dp: Math.sqrt(p.varInd[j] + p.sdNivel[j] ** 2) };
}
