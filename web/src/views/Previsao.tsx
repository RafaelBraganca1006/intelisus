import { tx } from '../i18n';
import type { EChartsOption } from 'echarts';
import { useMemo, useState } from 'react';
import { SeletorGrupo, Status } from '../components/Controles';
import { Grafico } from '../components/Grafico';
import { Leque } from '../components/Leque';
import { lambdaUnidade, phi, Z80 } from '../engine/motor';
import { capacidade, noDia, serieAgregada } from '../lib/agregacao';
import { corOcupacao, lerVar, nivelOcupacao } from '../lib/cores';
import { addDias, dataBR, dataCurta, diffDias, n0, parseData, pct } from '../lib/formato';
import { entradasDiarias, observadoComNowcast } from '../lib/series';
import { base } from '../lib/tema-graf';
import { dataDoK, kDe, nomeEscopo, unidades, useStore } from '../store';

type Metrica = 'ocup' | 'p85' | 'p100';

export function Previsao() {
  const { nucleo: n, previsao: p, historico: h, grupo: g, escopo, dataRef, tema, set } = useStore();
  const [taxa, setTaxa] = useState(true);
  const [met, setMet] = useState<Metrica>('p85');
  const G = n!.grupos.length;
  const k = kDe(n!, dataRef);
  const us = unidades(n!, escopo, g);
  const cap = capacidade(n!, us);
  const conf = n!.grupos[g].confiabilidade;

  const leque = useMemo(() => {
    if (!h || !p) return null;
    const o = observadoComNowcast(n!, h, us, g);
    const k1 = Math.min(n!.meta.horizonte, k + 120);
    const s = serieAgregada(n!, p, us, 0, k1);
    return {
      datasObs: o.datas, completo: o.completo, parcial: o.parcial, bruto: o.bruto,
      datasPrev: Array.from({ length: k1 }, (_, i) => dataDoK(n!, i)), media: s.media, dp: s.dp,
      capacidade: cap, dataRef: parseData(dataRef), sync: parseData(n!.meta.data_sync),
    };
  }, [h, p, us.join(), k, cap, g]);

  const semanas = 16;
  const calor = useMemo(() => {
    if (!p) return null;
    const ordem = n!.regioes.map((r, i) => ({ r, i })).filter((x) => n!.capacidade[x.i][g] >= 5)
      .sort((a, b) => a.r.drs.localeCompare(b.r.drs) || a.r.nome.localeCompare(b.r.nome));
    const dados: [number, number, number][] = [];
    ordem.forEach((x, row) => {
      const u = x.i * G + g, c = n!.capacidade[x.i][g];
      for (let w = 0; w < semanas; w++) {
        let v = 0;
        for (let d = 0; d < 7; d++) {
          const kk = Math.min(k + w * 7 + d, n!.meta.horizonte - 1);
          const y = noDia(n!, p, u, kk);
          const val = met === 'ocup' ? y.m / c / 7 : 1 - phi(((met === 'p85' ? 0.85 : 1) * c - y.m) / Math.max(y.dp, 1e-6));
          v = met === 'ocup' ? v + val : Math.max(v, val);
        }
        dados.push([w, row, +v.toFixed(3)]);
      }
    });
    return { ordem, dados };
  }, [p, g, k, met]);

  const opCalor = useMemo<EChartsOption | null>(() => {
    if (!calor) return null;
    const b = base();
    const ref = parseData(dataRef);
    const escuro = tema === 'dark';
    const cores = met === 'ocup' ? undefined
      : escuro ? ['#1a2230', '#3a3b40', '#e66767', '#d03b3b', '#8e1f25'] : ['#f3f4f1', '#e3e2de', '#ec8a88', '#e34948', '#9b2323'];
    return {
      animation: false, textStyle: b.textStyle,
      grid: { left: 190, right: 16, top: 30, bottom: 50 },
      tooltip: {
        ...b.tooltip, formatter: (x: any) => {
          const [w, row, v] = x.value; const o = calor.ordem[row];
          const d0 = addDias(ref, w * 7);
          return tx("<b>{0}</b><br/>semana de {1}<br/>{2}: <b>{3}</b>", o.r.nome, dataBR(d0), met === 'ocup' ? tx("Ocupação esperada") : met === 'p85' ? tx("P(ocupação > 85%), maior dia") : tx("P(ocupação > 100%), maior dia"), pct(v, met === 'ocup' ? 1 : 0));
        },
      },
      xAxis: { type: 'category', data: Array.from({ length: semanas }, (_, w) => dataCurta(addDias(ref, w * 7))), ...b.eixoX, position: 'top', splitArea: { show: false } },
      yAxis: {
        type: 'category', data: calor.ordem.map((o) => `${o.r.nome}`), inverse: true, ...b.eixoY, splitLine: { show: false },
        axisLabel: { color: b.t2, fontSize: 10.5, width: 175, overflow: 'truncate' },
      },
      visualMap: met === 'ocup'
        ? { type: 'continuous', min: 0.45, max: 1.15, orient: 'horizontal', left: 'center', bottom: 4, itemHeight: 220, itemWidth: 10, calculable: false,
            inRange: { color: [0.45, 0.6, 0.75, 0.85, 0.93, 1.0, 1.15].map((x) => corOcupacao(x)) }, textStyle: { color: b.t3 }, formatter: (v: any) => pct(Number(v)) }
        : { type: 'continuous', min: 0, max: 1, orient: 'horizontal', left: 'center', bottom: 4, itemHeight: 220, itemWidth: 10,
            inRange: { color: cores }, textStyle: { color: b.t3 }, formatter: (v: any) => pct(Number(v)) },
      series: [{ type: 'heatmap', data: calor.dados, itemStyle: { borderColor: lerVar('--surface-1'), borderWidth: 1.5, borderRadius: 3 },
        emphasis: { itemStyle: { borderColor: b.t1, borderWidth: 1 } } }],
    };
  }, [calor, tema, dataRef]);

  // chegadas: observado (+ corrigido) vs λ do gêmeo
  const opChegadas = useMemo<EChartsOption | null>(() => {
    if (!h) return null;
    const b = base();
    const e = entradasDiarias(h, us);
    const ini = parseData(h.diario.inicio), sync = parseData(n!.meta.data_sync), corte = parseData(n!.meta.data_corte);
    const comp = h.completude_entradas[g];
    const obs: any[] = [], cor: any[] = [];
    for (let i = Math.max(0, e.length - 240); i < e.length; i++) {
      const d = addDias(ini, i);
      if (d <= sync) obs.push([d.getTime(), e[i]]);
      else { const f = comp[Math.min(diffDias(corte, d), comp.length - 1)]; obs.push([d.getTime(), null]); cor.push([d.getTime(), f >= 0.6 ? +(e[i] / f).toFixed(1) : null]); }
    }
    const lam: any[] = [];
    const k1 = Math.min(n!.meta.horizonte, k + 90);
    for (let kk = 0; kk < k1; kk++) {
      let s = 0; for (const u of us) s += lambdaUnidade(n!, u, kk);
      lam.push([dataDoK(n!, kk).getTime(), +s.toFixed(1)]);
    }
    const acc = lerVar('--prev');
    return {
      animation: false, textStyle: b.textStyle, grid: { left: 48, right: 14, top: 30, bottom: 28 },
      legend: { top: 0, left: 0, textStyle: { color: b.t2, fontSize: 11.5 }, itemWidth: 14, itemHeight: 3, icon: 'rect' },
      tooltip: { ...b.tooltip, trigger: 'axis', valueFormatter: (v: any) => (v == null ? '—' : n0(v)) },
      xAxis: { type: 'time', ...b.eixoX }, yAxis: { type: 'value', ...b.eixoY, scale: true },
      series: [
        { type: 'line', name: 'Entradas observadas', data: obs, symbol: 'none', lineStyle: { width: 1, color: b.t2 }, itemStyle: { color: b.t2 } },
        { type: 'line', name: 'Parciais corrigidas', data: cor, symbol: 'none', lineStyle: { width: 1, color: b.t2, type: [2, 3] }, itemStyle: { color: b.t2 } },
        { type: 'line', name: 'λ esperado pelo gêmeo', data: lam, symbol: 'none', lineStyle: { width: 1.8, color: acc }, itemStyle: { color: acc } },
      ],
    };
  }, [h, us.join(), g, tema, k]);

  const tabela = useMemo(() => {
    if (!p) return [];
    return Array.from({ length: 12 }, (_, w) => {
      const s = serieAgregada(n!, p, us, Math.min(k + w * 7, n!.meta.horizonte - 7), Math.min(k + w * 7 + 7, n!.meta.horizonte));
      let m = 0, dpm = 0, p85 = 0, p100 = 0;
      for (let i = 0; i < s.media.length; i++) {
        m += s.media[i] / s.media.length; dpm += s.dp[i] / s.media.length;
        p85 = Math.max(p85, 1 - phi((0.85 * cap - s.media[i]) / s.dp[i]));
        p100 = Math.max(p100, 1 - phi((cap - s.media[i]) / s.dp[i]));
      }
      return { ini: addDias(parseData(dataRef), w * 7), m, dp: dpm, p85, p100 };
    });
  }, [p, us.join(), k, cap]);

  return (
    <div className="grid fade-in">
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <SeletorGrupo />
        <div className="seg"><button className={taxa ? 'on' : ''} onClick={() => setTaxa(true)}>{tx("% ocupação")}</button><button className={!taxa ? 'on' : ''} onClick={() => setTaxa(false)}>{tx("pacientes")}</button></div>
        {conf !== 'alta' && <Status nivel={conf === 'baixa' ? 'serious' : 'warning'} texto={tx('confiabilidade {0}', tx(conf))} />}
      </div>
      <div className="card">
        <div className="card-head"><div>
          <h3>{tx("Ocupação diária ·")} {nomeEscopo(n!, escopo)} · {n!.grupos[g].nome}</h3>
          <p className="hint">{tx("Linha sólida: censo reconstruído do SIH (completo). Pontilhado: meses ainda em faturamento, corrigidos pela curva de completude. Azul: o gêmeo propaga o estado sincronizado, com intervalos de 50/80/95%.")}</p>
        </div></div>
        {leque ? <Leque d={leque} altura={380} taxa={taxa} /> : <div className="loading" style={{ height: 380 }}><div className="spinner" /></div>}
      </div>
      <div className="grid" style={{ gridTemplateColumns: 'minmax(0, 1.5fr) minmax(0, 1fr)' }}>
        <div className="card">
          <div className="card-head">
            <div><h3>{tx("Mapa de calor do risco · próximas 16 semanas")}</h3>
              <p className="hint">{tx("Cada célula é a semana de uma região de saúde (ordem por DRS). Clique numa linha para abrir a região.")}</p></div>
            <div className="seg">
              <button className={met === 'p85' ? 'on' : ''} onClick={() => setMet('p85')}>P &gt; 85%</button>
              <button className={met === 'p100' ? 'on' : ''} onClick={() => setMet('p100')}>P &gt; 100%</button>
              <button className={met === 'ocup' ? 'on' : ''} onClick={() => setMet('ocup')}>{tx("ocupação")}</button>
            </div>
          </div>
          {opCalor && <Grafico opcao={opCalor} altura={Math.max(420, (calor?.ordem.length ?? 60) * 15 + 90)}
            onClick={(x: any) => { const o = calor?.ordem[x.value[1]]; if (o) set({ escopo: { tipo: 'regiao', id: o.r.id } }); }} />}
        </div>
        <div className="grid" style={{ alignContent: 'start' }}>
          <div className="card">
            <h3>{tx("Próximas 12 semanas ·")} {nomeEscopo(n!, escopo)}</h3>
            <p className="hint">{tx("Probabilidades do maior dia da semana.")}</p>
            <table className="tbl">
              <thead><tr><th>{tx("Semana de")}</th><th className="r">{tx("Ocupação")}</th><th className="r">{tx("IC 80%")}</th><th className="r">P&gt;85%</th><th className="r">P&gt;100%</th></tr></thead>
              <tbody>{tabela.map((t) => (
                <tr key={t.ini.getTime()}>
                  <td>{dataBR(t.ini)}</td>
                  <td className="r num"><span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}><i className="swatch" style={{ background: corOcupacao(t.m / cap) }} />{pct(t.m / cap, 1)}</span></td>
                  <td className="r num muted">{pct(Math.max(0, t.m - Z80 * t.dp) / cap)}–{pct((t.m + Z80 * t.dp) / cap)}</td>
                  <td className="r num">{pct(t.p85)}</td>
                  <td className="r num" style={{ fontWeight: t.p100 > 0.2 ? 700 : 400 }}>{pct(t.p100)}</td>
                </tr>))}</tbody>
            </table>
            {tabela[0] && <div style={{ marginTop: 10 }}><Status nivel={nivelOcupacao(tabela[0].m / cap)} texto={tx("Semana atual: {0}", pct(tabela[0].m / cap, 1))} /></div>}
          </div>
          <div className="card">
            <h3>{tx("Entradas em leito por dia")}</h3>
            <p className="hint">{tx("Chegadas previstas (λ) vs observadas. Os meses parciais (corrigidos pela completude) servem para monitorar; não recalibram o nível, porque no backtest operacional isso piorou o erro.")}</p>
            {opChegadas && <Grafico opcao={opChegadas} altura={230} />}
          </div>
        </div>
      </div>
    </div>
  );
}
