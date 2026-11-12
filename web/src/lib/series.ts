import type { Historico, Nucleo } from '../data/tipos';
import { addDias, diffDias, parseData } from './formato';

/** Censo diário observado (soma das unidades) desde historico.diario.inicio. */
export function censoDiario(h: Historico, us: number[]) {
  const L = h.diario.censo[0].length;
  const out = new Float64Array(L);
  for (const u of us) { const s = h.diario.censo[u]; for (let i = 0; i < L; i++) out[i] += s[i]; }
  return out;
}
export function entradasDiarias(h: Historico, us: number[]) {
  const L = h.diario.entradas[0].length;
  const out = new Float64Array(L);
  for (const u of us) { const s = h.diario.entradas[u]; for (let i = 0; i < L; i++) out[i] += s[i]; }
  return out;
}
export function censoSemanal(h: Historico, us: number[]) {
  const L = h.semanas.n;
  const out = new Float64Array(L);
  for (const u of us) { const s = h.semanas.censo[u]; for (let i = 0; i < L; i++) out[i] += s[i]; }
  return out;
}

/** Série diária com separação completo / parcial (corrigido pela completude do faturamento). */
export function observadoComNowcast(n: Nucleo, h: Historico, us: number[], g: number) {
  const ini = parseData(h.diario.inicio);
  const sync = parseData(n.meta.data_sync);
  const corte = parseData(n.meta.data_corte);
  const c = censoDiario(h, us);
  const comp = h.completude_censo[g];
  const datas: Date[] = [], completo: (number | null)[] = [], parcial: (number | null)[] = [], bruto: (number | null)[] = [];
  for (let i = 0; i < c.length; i++) {
    const d = addDias(ini, i);
    datas.push(d);
    if (d <= sync) { completo.push(c[i]); parcial.push(null); bruto.push(null); continue; }
    const tau = diffDias(corte, d);
    const f = comp[Math.min(tau, comp.length - 1)];
    completo.push(null);
    bruto.push(f >= 0.6 ? c[i] : null);
    parcial.push(f >= 0.6 ? c[i] / f : null);
  }
  return { datas, completo, parcial, bruto };
}

/** Capacidade (leitos SUS) de um conjunto de unidades numa competência CNES (yyyymm) ou a mais próxima anterior. */
export function capacidadeEm(n: Nucleo, us: number[], yyyymm: number) {
  const cs = n.capacidade_hist.competencias;
  let j = 0;
  for (let i = 0; i < cs.length; i++) if (cs[i] <= yyyymm) j = i;
  if (yyyymm < cs[0]) j = 0;
  const G = n.grupos.length;
  return us.reduce((s, u) => s + n.capacidade_hist.valores[Math.floor(u / G)][u % G][j], 0);
}
