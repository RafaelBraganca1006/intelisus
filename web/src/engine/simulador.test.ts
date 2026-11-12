import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Nucleo } from '../data/tipos';
import { cenarioBase } from './cenario';
import { propagar } from './motor';
import { simular } from './simulador';

const n: Nucleo = JSON.parse(readFileSync('public/data/nucleo.json', 'utf8'));
const G = n.grupos.length;

describe('simulador estocástico', () => {
  it('cenário base tem média coerente com o motor determinístico (±3%)', () => {
    const k0 = 140, H = 60;
    const c = { ...cenarioBase(0, 2026), dias: H, execucoes: 200 };
    const s = simular(n, { cenario: c, inicioK: k0, semente: 1 });
    let det = 0;
    for (let r = 0; r < n.regioes.length; r++) det += propagar(n, r * G, k0 + H + 1).media[k0 + H];
    expect(Math.abs(s.estado.media[H - 1] - det) / det).toBeLessThan(0.03);
  });
  it('mais leitos e menor permanência reduzem o excesso; regulação transfere', () => {
    const b = { ...cenarioBase(4, 2026), dias: 60, execucoes: 60 };
    const base = simular(n, { cenario: b, inicioK: 140, semente: 2 });
    const mais = simular(n, { cenario: { ...b, permanenciaPct: 10, leitos: { ...b.leitos, delta: 10 } }, inicioK: 140, semente: 2 });
    expect(mais.metricas.pacDiasExcesso).toBeLessThan(base.metricas.pacDiasExcesso);
    const reg = simular(n, { cenario: { ...b, regulacao: 'estado' }, inicioK: 140, semente: 2 });
    expect(reg.metricas.transferencias).toBeGreaterThan(0);
  });
});
