import { lang } from '../i18n';

const LOC = lang === 'pt' ? 'pt-BR' : 'en-US';
const nf0 = new Intl.NumberFormat(LOC, { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat(LOC, { maximumFractionDigits: 1, minimumFractionDigits: 1 });
export const n0 = (x: number | null | undefined) => (x == null || !isFinite(x) ? '—' : nf0.format(x));
export const n1 = (x: number | null | undefined) => (x == null || !isFinite(x) ? '—' : nf1.format(x));
export const pct = (x: number | null | undefined, d = 0) =>
  x == null || !isFinite(x) ? '—' : `${(x * 100).toLocaleString(LOC, { maximumFractionDigits: d, minimumFractionDigits: d })}%`;
export const compacto = (x: number) =>
  Math.abs(x) >= 1e9 ? `${n1(x / 1e9)} ${lang === 'pt' ? 'bi' : 'B'}` : Math.abs(x) >= 1e6 ? `${n1(x / 1e6)} ${lang === 'pt' ? 'mi' : 'M'}` : Math.abs(x) >= 1e4 ? `${n1(x / 1e3)} ${lang === 'pt' ? 'mil' : 'k'}` : n0(x);
export const reais = (x: number) => `R$ ${compacto(x)}`;
export const sinal = (x: number, f = n0) => (x > 0 ? '+' : x < 0 ? '−' : '') + f(Math.abs(x));

const MESES = lang === 'pt'
  ? ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']
  : ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const DIA_MS = 86400000;
export const parseData = (s: string) => new Date(s + 'T00:00:00Z');
export const isoData = (d: Date) => d.toISOString().slice(0, 10);
export const addDias = (d: Date, n: number) => new Date(d.getTime() + n * DIA_MS);
export const diffDias = (a: Date, b: Date) => Math.round((a.getTime() - b.getTime()) / DIA_MS);
export const dataBR = (d: Date) => {
  const dd = String(d.getUTCDate()).padStart(2, '0'), mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  return lang === 'pt' ? `${dd}/${mm}/${d.getUTCFullYear()}` : `${mm}/${dd}/${d.getUTCFullYear()}`;
};
export const dataCurta = (d: Date) => lang === 'pt' ? `${d.getUTCDate()} ${MESES[d.getUTCMonth()]}` : `${MESES[d.getUTCMonth()]} ${d.getUTCDate()}`;
export const mesAno = (d: Date) => `${MESES[d.getUTCMonth()]}/${String(d.getUTCFullYear()).slice(2)}`;
