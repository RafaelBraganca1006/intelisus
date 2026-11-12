import * as echarts from 'echarts';
import { useEffect, useRef } from 'react';
import { useStore } from '../store';

/** Wrapper fino do ECharts: recria o tema ao alternar claro/escuro e redimensiona com o contêiner. */
export function Grafico({ opcao, altura = 300, onClick, aoCriar }: {
  opcao: echarts.EChartsOption; altura?: number | string;
  onClick?: (p: any) => void; aoCriar?: (c: echarts.ECharts) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const chart = useRef<echarts.ECharts | null>(null);
  const tema = useStore((s) => s.tema);
  useEffect(() => {
    if (!ref.current) return;
    const c = echarts.init(ref.current, undefined, { renderer: 'canvas' });
    chart.current = c;
    aoCriar?.(c);
    const ro = new ResizeObserver(() => c.resize());
    ro.observe(ref.current);
    return () => { ro.disconnect(); c.dispose(); chart.current = null; };
  }, [tema]);
  useEffect(() => { chart.current?.setOption(opcao, { notMerge: true, lazyUpdate: true }); }, [opcao, tema]);
  useEffect(() => {
    const c = chart.current;
    if (!c || !onClick) return;
    c.on('click', onClick);
    return () => { c.off('click', onClick); };
  }, [onClick, tema]);
  return <div ref={ref} style={{ height: altura, width: '100%' }} />;
}
