import { tx } from '../i18n';
/** Escalas de cor (paleta de referência validada; ver skill dataviz). */
export const lerVar = (v: string) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();

export const corGrupo = (g: number) => lerVar(`--s${g + 1}`);

type RGB = [number, number, number];
const hex = (h: string): RGB => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)) as RGB;
const toHex = (c: RGB) => '#' + c.map((x) => Math.round(Math.max(0, Math.min(255, x))).toString(16).padStart(2, '0')).join('');
function interp(stops: [number, string][], x: number) {
  if (x <= stops[0][0]) return stops[0][1];
  for (let i = 1; i < stops.length; i++) {
    if (x <= stops[i][0]) {
      const [x0, c0] = stops[i - 1], [x1, c1] = stops[i];
      const t = (x - x0) / (x1 - x0);
      const a = hex(c0), b = hex(c1);
      return toHex([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]);
    }
  }
  return stops[stops.length - 1][1];
}

/** Só azul: do mais claro (folga) ao mais escuro (acima da capacidade), nos dois temas. */
export function paradasOcupacao(): [number, string][] {
  return [[0.45, '#dce9f7'], [0.65, '#9cc0e6'], [0.85, '#5b8fcf'], [1.0, '#2c5fa8'], [1.15, '#14356b']];
}
export const corOcupacao = (x: number) => interp(paradasOcupacao(), x);
export const gradienteOcupacao = () => {
  const p = paradasOcupacao();
  const lo = p[0][0], hi = p[p.length - 1][0];
  return `linear-gradient(90deg, ${p.map(([x, c]) => `${c} ${((x - lo) / (hi - lo)) * 100}%`).join(', ')})`;
};

/** Sequencial azul (magnitude). */
export function paradasSeq(): [number, string][] {
  const escuro = document.documentElement.dataset.theme !== 'light';
  return escuro
    ? [[0, '#16233a'], [0.25, '#27518f'], [0.5, '#4a82c8'], [0.75, '#8db6e6'], [1, '#e3effc']]
    : [[0, '#eaf2fb'], [0.25, '#b7d2ee'], [0.5, '#6c9fd8'], [0.75, '#3468ad'], [1, '#122d57']];
}
export const corSeq = (t: number) => interp(paradasSeq(), Math.max(0, Math.min(1, t)));
export const gradienteSeq = () => `linear-gradient(90deg, ${paradasSeq().map(([x, c]) => `${c} ${x * 100}%`).join(', ')})`;

/** Divergente para variações (−/+) : verde-água = menos, vermelho = mais. */
export function corDiv(t: number) {
  const escuro = document.documentElement.dataset.theme !== 'light';
  const mid = escuro ? '#3a3b40' : '#e3e2de';
  return interp([[-1, escuro ? '#5f9a96' : '#3d7873'], [-0.35, escuro ? '#93bdb9' : '#9cc4c0'], [0, mid],
    [0.35, escuro ? '#e66767' : '#ec8a88'], [1, escuro ? '#d03b3b' : '#b8302f']], Math.max(-1, Math.min(1, t)));
}

export type Nivel = 'good' | 'warning' | 'serious' | 'critical';
export const nivelOcupacao = (x: number): Nivel => (x >= 1 ? 'critical' : x >= 0.92 ? 'serious' : x >= 0.85 ? 'warning' : 'good');
export const rotuloNivel: Record<Nivel, string> = { good: tx("Adequada"), warning: tx("Atenção"), serious: tx("Alta"), critical: tx("Crítica") };
