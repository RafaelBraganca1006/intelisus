import { lerVar } from './cores';

/** Base comum dos gráficos: eixos e grade recessivos, texto em tokens de texto. */
export function base() {
  const t1 = lerVar('--text-1'), t2 = lerVar('--text-2'), t3 = lerVar('--text-3'), grid = lerVar('--grid');
  const surf = lerVar('--surface-1'), borda = lerVar('--border-strong');
  return {
    t1, t2, t3, grid, surf, borda,
    textStyle: { fontFamily: 'Geist Variable, system-ui, sans-serif', color: t2 },
    tooltip: {
      backgroundColor: surf, borderColor: borda, borderWidth: 1, padding: [8, 10],
      textStyle: { color: t1, fontSize: 12 }, extraCssText: 'border-radius:10px;box-shadow:0 12px 30px -10px rgba(0,0,0,.5);',
    },
    eixoX: { axisLine: { lineStyle: { color: grid } }, axisTick: { show: false }, axisLabel: { color: t3, fontSize: 11 }, splitLine: { show: false } },
    eixoY: { axisLine: { show: false }, axisTick: { show: false }, axisLabel: { color: t3, fontSize: 11 }, splitLine: { lineStyle: { color: grid } } },
  };
}
