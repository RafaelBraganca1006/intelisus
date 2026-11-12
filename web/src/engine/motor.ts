/**
 * Motor determinístico do gêmeo (espelho de pipeline/gemeo/previsao.py::propagar).
 *
 * Leitos como servidores infinitos (M_t/G/∞) com risco de alta h(a,t) = h0_u(a)·m_g(c(t)):
 *   - quem já estava internado na sincronização sai com o hazard da sua idade de internação;
 *   - chegadas λ(t) = L_u · dow_u(t) · forma_g(t) entram na idade 0;
 *   - incerteza = binomial (existentes) + Poisson (chegadas) + erro de nível σ(h), correlacionado no tempo.
 */
import type { Nucleo } from '../data/tipos';

export const A = 180;

export interface Alavancas {
  /** multiplicador das chegadas por dia k (0 = dia seguinte à sincronização) */
  chegadas?: (k: number) => number;
  /** multiplicador do hazard de alta (1/(1-redução da permanência)) */
  alta?: number;
}

export interface Propagacao {
  media: Float32Array;   // [H]
  varInd: Float32Array;  // variância binomial + Poisson
  sdNivel: Float32Array; // desvio do erro de nível (correlacionado entre unidades)
  estadoEm?: Float64Array; // idade de internação no dia kEstado (esperado)
}

export function lambdaUnidade(n: Nucleo, u: number, k: number): number {
  const G = n.grupos.length;
  const r = Math.floor(u / G), g = u % G;
  const m = n.motor;
  return m.L[r][g] * m.dow[r][g][(m.dow_inicio + k) % 7] * m.forma[g][k];
}

export function sigmaK(n: Nucleo, g: number, k: number): number {
  const [a, b] = n.motor.sigma[g];
  return Math.sqrt(Math.max(a + b * (k + 1), 0));
}

/** Propaga uma unidade por H dias a partir da sincronização. */
export function propagar(n: Nucleo, u: number, H: number, alav: Alavancas = {}, kEstado = -1): Propagacao {
  const G = n.grupos.length;
  const g = u % G;
  const h0 = n.motor.h0[u];
  const mdow = n.motor.mdow[g];
  const tipos = n.motor.tipos;
  const fAlta = alav.alta ?? 1;
  const A1 = A + 1;
  const Y0 = Float64Array.from(n.motor.estado[u]);
  const Y = Float64Array.from(Y0);
  let Z = new Float64Array(A1), W = new Float64Array(A1);
  let Zn = new Float64Array(A1), Wn = new Float64Array(A1);
  const media = new Float32Array(H), varInd = new Float32Array(H), sdNivel = new Float32Array(H);
  let estadoEm: Float64Array | undefined;
  for (let k = 0; k < H; k++) {
    const mk = mdow[tipos[k]] * fAlta;
    let sy = 0, vy = 0;
    for (let a0 = 0; a0 < A1; a0++) {
      if (Y0[a0] === 0) continue;
      const a = Math.min(a0 + k, A);
      const p = Math.min(h0[a] * mk, 1);
      Y[a0] *= 1 - p;
      const q = Y[a0] / Y0[a0];
      sy += Y[a0];
      vy += Y0[a0] * q * (1 - q);
    }
    const lam = lambdaUnidade(n, u, k) * (alav.chegadas ? alav.chegadas(k) : 1);
    const sg = sigmaK(n, g, k);
    Zn[0] = lam; Wn[0] = lam * sg;
    for (let a = 1; a < A; a++) {
      const s = 1 - Math.min(h0[a - 1] * mk, 1);
      Zn[a] = Z[a - 1] * s; Wn[a] = W[a - 1] * s;
    }
    const sA1 = 1 - Math.min(h0[A - 1] * mk, 1), sA = 1 - Math.min(h0[A] * mk, 1);
    Zn[A] = Z[A - 1] * sA1 + Z[A] * sA; Wn[A] = W[A - 1] * sA1 + W[A] * sA;
    [Z, Zn] = [Zn, Z]; [W, Wn] = [Wn, W];
    let sz = 0, sw = 0;
    for (let a = 0; a < A1; a++) { sz += Z[a]; sw += W[a]; }
    media[k] = sy + sz;
    varInd[k] = vy + sz;
    sdNivel[k] = sw;
    if (k === kEstado) {
      estadoEm = Float64Array.from(Z);
      for (let a0 = 0; a0 < A1; a0++) estadoEm[Math.min(a0 + k + 1, A)] += Y[a0];
    }
  }
  return { media, varInd, sdNivel, estadoEm };
}

/** Correlação do erro de nível entre unidades ao agregar (regiões → DRS → estado). */
export const RHO = 0.5;

export function agregar(ps: Propagacao[], H: number) {
  const media = new Float32Array(H), dp = new Float32Array(H);
  for (let k = 0; k < H; k++) {
    let m = 0, v = 0, s = 0, s2 = 0;
    for (const p of ps) { m += p.media[k]; v += p.varInd[k]; s += p.sdNivel[k]; s2 += p.sdNivel[k] ** 2; }
    media[k] = m;
    dp[k] = Math.sqrt(v + RHO * s * s + (1 - RHO) * s2);
  }
  return { media, dp };
}

/** Φ(x) (aproximação de Abramowitz–Stegun 26.2.17). */
export function phi(x: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989422804014327 * Math.exp(-x * x / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return x > 0 ? 1 - p : p;
}

export const Z80 = 1.2816, Z95 = 1.96, Z50 = 0.6745;
