const nf0 = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1, minimumFractionDigits: 1 });
export const n0 = (x: number | null | undefined) => (x == null || !isFinite(x) ? '—' : nf0.format(x));
export const n1 = (x: number | null | undefined) => (x == null || !isFinite(x) ? '—' : nf1.format(x));
export const pct = (x: number | null | undefined, d = 0) =>
  x == null || !isFinite(x) ? '—' : `${(x * 100).toLocaleString('pt-BR', { maximumFractionDigits: d, minimumFractionDigits: d })}%`;
export const compacto = (x: number) =>
  Math.abs(x) >= 1e9 ? `${n1(x / 1e9)} bi` : Math.abs(x) >= 1e6 ? `${n1(x / 1e6)} mi` : Math.abs(x) >= 1e4 ? `${n1(x / 1e3)} mil` : n0(x);
export const reais = (x: number) => `R$ ${compacto(x)}`;
export const sinal = (x: number, f = n0) => (x > 0 ? '+' : x < 0 ? '−' : '') + f(Math.abs(x));

const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
export const DIA_MS = 86400000;
export const parseData = (s: string) => new Date(s + 'T00:00:00Z');
export const isoData = (d: Date) => d.toISOString().slice(0, 10);
export const addDias = (d: Date, n: number) => new Date(d.getTime() + n * DIA_MS);
export const diffDias = (a: Date, b: Date) => Math.round((a.getTime() - b.getTime()) / DIA_MS);
export const dataBR = (d: Date) => `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear()}`;
export const dataCurta = (d: Date) => `${d.getUTCDate()} ${MESES[d.getUTCMonth()]}`;
export const mesAno = (d: Date) => `${MESES[d.getUTCMonth()]}/${String(d.getUTCFullYear()).slice(2)}`;
