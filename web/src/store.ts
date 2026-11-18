import { tx } from './i18n';
import { create } from 'zustand';
import type { Fluxos, Historico, Hospital, Municipio, Nucleo, Placar, Validacao } from './data/tipos';
import type { Cenario } from './engine/cenario';
import type { ResultadoSim } from './engine/simulador';
import { addDias, diffDias, isoData, parseData } from './lib/formato';

export type Vista = 'panorama' | 'previsao' | 'simulador' | 'fluxos' | 'planejamento' | 'hospitais' | 'municipios' | 'metodologia';
export type Escopo = { tipo: 'estado' } | { tipo: 'drs'; id: string } | { tipo: 'regiao'; id: number };

export interface Previsao { media: Float32Array; varInd: Float32Array; sdNivel: Float32Array }

interface Estado {
  nucleo: Nucleo | null;
  historico: Historico | null;
  fluxos: Fluxos | null;
  municipios: { meses: string[]; municipios: Municipio[] } | null;
  hospitais: { semana_final: string; hospitais: Hospital[] } | null;
  validacao: Validacao | null;
  placar: Placar[] | null;
  geo: { regioes: GeoJSON.FeatureCollection; municipios: GeoJSON.FeatureCollection; drs: GeoJSON.FeatureCollection } | null;
  previsao: Previsao | null;
  vista: Vista;
  grupo: number;
  escopo: Escopo;
  dataRef: string;
  tema: 'dark' | 'light';
  railMini: boolean;
  sim: { cen: ResultadoSim; base: ResultadoSim; cenario: Cenario; ms: number } | null;
  set: (p: Partial<Estado>) => void;
}

const temaInicial = (): 'dark' | 'light' => {
  try { const t = localStorage.getItem('gemeo-tema'); if (t === 'light' || t === 'dark') return t; } catch { /* sem storage */ }
  return window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
};

// o tema vai para o <html> antes de qualquer render: gráficos e mapa leem as cores (CSS vars) durante o render
const aplicarTema = (t: 'dark' | 'light') => { document.documentElement.dataset.theme = t; };
const tema0 = temaInicial();
aplicarTema(tema0);

export const useStore = create<Estado>((set) => ({
  nucleo: null, historico: null, fluxos: null, municipios: null, hospitais: null, validacao: null, placar: null, geo: null,
  previsao: null, vista: ((h) => (h === 'situacao' ? 'panorama' : h) as Vista)(location.hash.slice(1)) || 'panorama', grupo: 0, escopo: { tipo: 'estado' },
  dataRef: isoData(new Date()), tema: tema0, railMini: (() => { try { return localStorage.getItem('gemeo-rail') === 'mini'; } catch { return false; } })(), sim: null,
  set: (p) => { if (p.tema) aplicarTema(p.tema); set(p); },
}));

/** Índice k do motor (0 = dia seguinte à sincronização) para uma data ISO. */
export function kDe(n: Nucleo, iso: string) {
  const k = diffDias(parseData(iso), parseData(n.meta.data_sync)) - 1;
  return Math.max(0, Math.min(n.meta.horizonte - 1, k));
}
export const dataDoK = (n: Nucleo, k: number) => addDias(parseData(n.meta.data_sync), k + 1);

/** Unidades (índices u = r·G + g) de um escopo para um grupo (g < 0: todos os grupos, a categoria "Geral"). */
export function unidades(n: Nucleo, e: Escopo, g: number) {
  const G = n.grupos.length;
  return n.regioes.flatMap((r, i) =>
    e.tipo === 'estado' || (e.tipo === 'drs' && r.drs === e.id) || (e.tipo === 'regiao' && r.id === e.id)
      ? (g < 0 ? n.grupos.map((_, gg) => i * G + gg) : [i * G + g]) : []);
}
export function nomeEscopo(n: Nucleo, e: Escopo) {
  if (e.tipo === 'estado') return tx("Estado de São Paulo");
  if (e.tipo === 'drs') return tx("DRS {0} · {1}", e.id, n.drs.find((d) => d.id === e.id)?.nome);
  return tx("Região {0}", n.regioes.find((r) => r.id === e.id)?.nome);
}
