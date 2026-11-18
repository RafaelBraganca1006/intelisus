import en from './en.json';
import ajustes from './en-ajustes.json';

export type Lang = 'en' | 'pt';

function detecta(): Lang {
  try {
    const v = globalThis.localStorage?.getItem('gemeo-lang');
    if (v === 'en' || v === 'pt') return v;
  } catch { /* sem storage (ex.: Web Worker) */ }
  return 'en';
}

export const lang: Lang = detecta();
const dic = { ...(en as Record<string, string>), ...(ajustes as Record<string, string>) }; // ajustes = revisão manual, prevalece

/** Traduz um texto escrito em português. {0}, {1}… recebem os argumentos. Inglês é o padrão. */
export function tx(pt: string, ...args: unknown[]): string {
  const base = lang === 'pt' ? pt : dic[pt] ?? pt;
  return args.length ? base.replace(/\{(\d+)\}/g, (_, i) => String(args[+i] ?? '')) : base;
}

export function trocarIdioma(l: Lang) {
  try { localStorage.setItem('gemeo-lang', l); } catch { /* sem storage */ }
  location.reload();
}
