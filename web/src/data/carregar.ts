import { useStore } from '../store';
import type { Nucleo } from './tipos';

const url = (f: string) => `${import.meta.env.BASE_URL}data/${f}`;
const get = (f: string) => fetch(url(f)).then((r) => { if (!r.ok) throw new Error(f); return r.json(); });

let worker: Worker | null = null;
let seq = 0;
const pend = new Map<number, (v: any) => void>();

export function motor() {
  if (!worker) {
    worker = new Worker(new URL('../engine/worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e) => {
      if (e.data.erro) console.error('Erro no motor do gêmeo:', e.data.erro);
      const f = pend.get(e.data.id); if (f) { pend.delete(e.data.id); f(e.data); }
    };
    worker.onerror = (e) => console.error('Worker falhou:', e.message, e.filename, e.lineno);
  }
  return worker;
}
export function pedir<T>(msg: Record<string, unknown>): Promise<T> {
  const id = ++seq;
  return new Promise((res) => { pend.set(id, res); motor().postMessage({ ...msg, id }); });
}

export async function carregarTudo() {
  const set = useStore.getState().set;
  const [nucleo, regioes, drs, municipiosGeo] = await Promise.all([
    get('nucleo.json') as Promise<Nucleo>, get('regioes.geojson'), get('drs.geojson'), get('municipios.geojson'),
  ]);
  motor().postMessage({ tipo: 'init', nucleo });
  set({ nucleo, geo: { regioes, drs, municipios: municipiosGeo }, dataRef: nucleo.meta.data_sync });
  pedir<{ media: Float32Array; varInd: Float32Array; sdNivel: Float32Array }>({ tipo: 'prever' })
    .then((p) => set({ previsao: { media: p.media, varInd: p.varInd, sdNivel: p.sdNivel } }));
  const [historico, fluxos, municipios, hospitais, validacao] = await Promise.all(
    ['historico.json', 'fluxos.json', 'municipios.json', 'hospitais.json', 'validacao.json'].map(get));
  set({ historico, fluxos, municipios, hospitais, validacao });
  get('placar.json').then((placar) => set({ placar })).catch(() => { /* sem placar ainda: nenhuma atualização foi avaliada */ });
}
