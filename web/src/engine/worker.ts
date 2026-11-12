/// <reference lib="webworker" />
import type { Nucleo } from '../data/tipos';
import type { Cenario } from './cenario';
import { propagar } from './motor';
import { simular } from './simulador';

let nucleo: Nucleo | null = null;

type Msg =
  | { tipo: 'init'; nucleo: Nucleo }
  | { tipo: 'prever'; id: number }
  | { tipo: 'simular'; id: number; cenario: Cenario; base: Cenario; inicioK: number; semente: number };

const fila: Msg[] = [];

self.onmessage = (ev: MessageEvent<Msg>) => {
  const m = ev.data;
  if (m.tipo === 'init') { nucleo = m.nucleo; fila.splice(0).forEach(tratarSeguro); return; }
  if (!nucleo) { fila.push(m); return; }
  tratarSeguro(m);
};

function tratarSeguro(m: Msg) {
  try { tratar(m); } catch (e) {
    console.error('[motor]', e);
    (self as unknown as Worker).postMessage({ id: (m as { id?: number }).id, erro: String((e as Error)?.stack ?? e) });
  }
}

function tratar(m: Msg) {
  if (!nucleo || m.tipo === 'init') return;
  if (m.tipo === 'prever') {
    const H = nucleo.meta.horizonte;
    const U = nucleo.motor.h0.length;
    const media = new Float32Array(U * H), varInd = new Float32Array(U * H), sdNivel = new Float32Array(U * H);
    for (let u = 0; u < U; u++) {
      const p = propagar(nucleo, u, H);
      media.set(p.media, u * H); varInd.set(p.varInd, u * H); sdNivel.set(p.sdNivel, u * H);
    }
    (self as unknown as Worker).postMessage({ id: m.id, media, varInd, sdNivel }, [media.buffer, varInd.buffer, sdNivel.buffer]);
  } else if (m.tipo === 'simular') {
    const t0 = performance.now();
    const cen = simular(nucleo, { cenario: m.cenario, inicioK: m.inicioK, semente: m.semente });
    const base = simular(nucleo, { cenario: m.base, inicioK: m.inicioK, semente: m.semente, base: true });
    (self as unknown as Worker).postMessage({ id: m.id, cen, base, ms: performance.now() - t0 });
  }
}
