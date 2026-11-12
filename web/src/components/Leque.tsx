import type { EChartsOption } from 'echarts';
import { useMemo } from 'react';
import { Z50, Z80, Z95 } from '../engine/motor';
import { lerVar } from '../lib/cores';
import { dataBR, n0, pct } from '../lib/formato';
import { base } from '../lib/tema-graf';
import { useStore } from '../store';
import { Grafico } from './Grafico';

export interface DadosLeque {
  datasObs: Date[]; completo: (number | null)[]; parcial?: (number | null)[]; bruto?: (number | null)[];
  datasPrev: Date[]; media: ArrayLike<number>; dp?: ArrayLike<number>;
  q?: { p10: ArrayLike<number>; p50: ArrayLike<number>; p90: ArrayLike<number> };
  cenario?: { p10: ArrayLike<number>; p50: ArrayLike<number>; p90: ArrayLike<number>; nome: string };
  capacidade: number; dataRef?: Date; sync?: Date;
}

/** Gráfico de leque: observado, nowcast, previsão (bandas 50/80/95%) e capacidade. */
export function Leque({ d, altura = 340, taxa = false, compacto = false }: { d: DadosLeque; altura?: number; taxa?: boolean; compacto?: boolean }) {
  const tema = useStore((s) => s.tema);
  const opcao = useMemo<EChartsOption>(() => {
    const b = base();
    const acc = lerVar('--prev'), laranja = lerVar('--s2'), crit = lerVar('--critical');
    const k = taxa && d.capacidade > 0 ? 100 / d.capacidade : 1;
    const T = (x: number | null | undefined) => (x == null ? null : +(x * k).toFixed(2));
    const obs = d.datasObs.map((t, i) => [t.getTime(), T(d.completo[i])]);
    const par = d.parcial ? d.datasObs.map((t, i) => [t.getTime(), T(d.parcial![i])]) : [];
    const bru = d.bruto ? d.datasObs.map((t, i) => [t.getTime(), T(d.bruto![i])]) : [];
    const P = d.datasPrev.map((t) => t.getTime());
    const bandas: any[] = [];
    const faixa = (lo: (i: number) => number, hi: (i: number) => number, op: number, nome: string, cor = acc, stack = nome) => {
      bandas.push({ type: 'line', data: P.map((t, i) => [t, T(lo(i))]), stack, symbol: 'none', lineStyle: { width: 0 }, silent: true, name: `${nome}-lo`, tooltip: { show: false } });
      bandas.push({ type: 'line', data: P.map((t, i) => [t, T(hi(i) - lo(i))]), stack, symbol: 'none', lineStyle: { width: 0 },
        areaStyle: { color: cor, opacity: op }, itemStyle: { color: cor, opacity: Math.min(1, op * 3) }, silent: true, name: nome, tooltip: { show: false } });
    };
    if (d.dp) {
      const m = d.media, s = d.dp;
      faixa((i) => Math.max(0, m[i] - Z95 * s[i]), (i) => m[i] + Z95 * s[i], 0.12, 'IC 95%');
      faixa((i) => Math.max(0, m[i] - Z80 * s[i]), (i) => m[i] + Z80 * s[i], 0.16, 'IC 80%');
      faixa((i) => Math.max(0, m[i] - Z50 * s[i]), (i) => m[i] + Z50 * s[i], 0.22, 'IC 50%');
    } else if (d.q) {
      faixa((i) => d.q!.p10[i], (i) => d.q!.p90[i], 0.2, 'P10–P90');
    }
    if (d.cenario) faixa((i) => d.cenario!.p10[i], (i) => d.cenario!.p90[i], 0.18, 'Cenário P10–P90', laranja, 'cen');
    const linhas: any[] = [
      { type: 'line', name: 'Observado', data: obs, symbol: 'none', lineStyle: { width: 1.6, color: b.t1 }, itemStyle: { color: b.t1 }, z: 5 },
    ];
    if (par.length) linhas.push({ type: 'line', name: 'Parcial corrigido (nowcast)', data: par, symbol: 'none', lineStyle: { width: 1.6, color: b.t1, type: [2, 3] }, itemStyle: { color: b.t1 }, z: 5 });
    if (bru.length) linhas.push({ type: 'line', name: 'Faturado até agora', data: bru, symbol: 'none', lineStyle: { width: 1, color: b.t3, type: [1, 3] }, itemStyle: { color: b.t3 }, z: 4 });
    linhas.push({ type: 'line', name: d.cenario ? 'Base (mediana)' : 'Gêmeo (esperado)', data: P.map((t, i) => [t, T(d.q ? d.q.p50[i] : d.media[i])]), symbol: 'none',
      lineStyle: { width: 2, color: acc }, itemStyle: { color: acc }, z: 6 });
    if (d.cenario) linhas.push({ type: 'line', name: d.cenario.nome, data: P.map((t, i) => [t, T(d.cenario!.p50[i])]), symbol: 'none', lineStyle: { width: 2, color: laranja }, itemStyle: { color: laranja }, z: 7 });
    const mk: any[] = [];
    if (d.capacidade > 0) {
      mk.push({ yAxis: taxa ? 100 : d.capacidade, lineStyle: { color: crit, type: 'solid', width: 1.2 }, label: { show: !compacto, formatter: taxa ? '100% · capacidade' : `Capacidade ${n0(d.capacidade)}`, color: b.t2, position: 'insideEndTop', fontSize: 11 } });
      mk.push({ yAxis: taxa ? 85 : 0.85 * d.capacidade, lineStyle: { color: b.t3, type: [4, 4], width: 1 }, label: { show: !compacto, formatter: 'meta 85%', color: b.t3, position: 'insideEndTop', fontSize: 11 } });
    }
    const vx: any[] = [];
    if (d.sync) vx.push({ xAxis: d.sync.getTime(), lineStyle: { color: b.t3, type: [2, 3] }, label: { show: !compacto, formatter: 'sincronização', color: b.t3, fontSize: 10, position: 'insideEndTop' } });
    if (d.dataRef) vx.push({ xAxis: d.dataRef.getTime(), lineStyle: { color: acc, width: 1.4 }, label: { show: !compacto, formatter: 'hoje', color: acc, fontSize: 11, position: 'insideEndTop' } });
    linhas[0].markLine = { symbol: 'none', silent: true, data: [...mk, ...vx], animation: false };
    const mapa = new Map<number, number>(P.map((t, i) => [t, i]));
    return {
      animation: false,
      textStyle: b.textStyle,
      grid: compacto ? { left: 44, right: 10, top: 10, bottom: 24 } : { left: 52, right: 18, top: 34, bottom: 56 },
      legend: { show: !compacto, top: 0, left: 0, itemWidth: 14, itemHeight: 3, textStyle: { color: b.t2, fontSize: 11.5 }, icon: 'rect',
        data: linhas.map((l) => l.name).concat(d.dp ? ['IC 50%', 'IC 80%', 'IC 95%'] : d.q ? ['P10–P90'] : []).concat(d.cenario ? ['Cenário P10–P90'] : []) },
      tooltip: {
        ...b.tooltip, trigger: 'axis', axisPointer: { type: 'line', lineStyle: { color: b.t3 } },
        formatter: (ps: any) => {
          const arr = Array.isArray(ps) ? ps : [ps];
          const t = arr[0].value[0];
          const i = mapa.get(t);
          const f = (v: number) => (taxa ? `${v.toFixed(1)}%` : n0(v));
          let s = `<b>${dataBR(new Date(t))}</b>`;
          for (const p of arr) if (!p.seriesName.endsWith('-lo') && p.value[1] != null && !p.seriesName.startsWith('IC') && !p.seriesName.includes('P10'))
            s += `<div class="row"><span>${p.marker}${p.seriesName}</span><span>${f(p.value[1])}</span></div>`;
          if (i != null && d.dp) {
            const lo = Math.max(0, d.media[i] - Z80 * d.dp[i]) * k, hi = (d.media[i] + Z80 * d.dp[i]) * k;
            s += `<div class="row"><span>IC 80%</span><span>${f(lo)} – ${f(hi)}</span></div>`;
            if (d.capacidade) s += `<div class="row"><span>Ocupação esperada</span><span>${pct(d.media[i] / d.capacidade, 1)}</span></div>`;
          }
          if (i != null && d.q) s += `<div class="row"><span>Base P10–P90</span><span>${f(d.q.p10[i] * k)} – ${f(d.q.p90[i] * k)}</span></div>`;
          if (i != null && d.cenario) s += `<div class="row"><span>Cenário P10–P90</span><span>${f(d.cenario.p10[i] * k)} – ${f(d.cenario.p90[i] * k)}</span></div>`;
          return `<div class="tooltip" style="position:static;box-shadow:none;border:0;padding:0">${s}</div>`;
        },
      },
      xAxis: { type: 'time', ...b.eixoX },
      yAxis: { type: 'value', ...b.eixoY, scale: true, axisLabel: { ...b.eixoY.axisLabel, formatter: (v: number) => (taxa ? `${v}%` : n0(v)) } },
      dataZoom: compacto ? [{ type: 'inside' }] : [{ type: 'inside' }, { type: 'slider', height: 18, bottom: 8, borderColor: 'transparent', backgroundColor: b.grid,
        fillerColor: lerVar('--accent-soft'), handleSize: 14, textStyle: { color: b.t3, fontSize: 10 }, dataBackground: { lineStyle: { color: b.t3 }, areaStyle: { color: b.grid } } }],
      series: [...bandas, ...linhas],
    };
  }, [d, taxa, tema, compacto]);
  return <Grafico opcao={opcao} altura={altura} />;
}

