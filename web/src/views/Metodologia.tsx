import { tx } from '../i18n';
import type { EChartsOption } from 'echarts';
import { useMemo, useState } from 'react';
import { SeletorGrupo } from '../components/Controles';
import { Grafico } from '../components/Grafico';
import { Leque } from '../components/Leque';
import { lerVar } from '../lib/cores';
import { addDias, dataBR, n0, parseData, pct } from '../lib/formato';
import { base } from '../lib/tema-graf';
import { useStore } from '../store';

const ETAPAS = [
  { t: tx("Dados oficiais"), d: tx("SIH/SUS (30 mi de AIHs, 2014–2026), CNES leitos (13 competências), IBGE Censo 2022 e Projeção 2024.") },
  { t: tx("Reconstrução do censo"), d: tx("Cada AIH vira segmentos de leito (UTI + enfermaria). Censo diário por hospital × 7 tipos de leito.") },
  { t: tx("Sincronização"), d: tx("Curva de completude do faturamento estimada em cortes históricos; o estado é fixado no último dia ≥97% completo.") },
  { t: tx("Motor M_t/G/∞"), d: tx("Chegadas com sazonalidade, dia da semana, feriados e fim de competência; altas por hazard com censura (Kaplan–Meier).") },
  { t: tx("Teste em condição real"), d: tx("Backtest operacional: só AIHs já faturadas em cada corte; mede o erro do “hoje” e das semanas seguintes.") },
  { t: tx("Previsão e cenários"), d: tx("Média e variância exatas (binomial + Poisson + nível) e Monte Carlo com regulação e números aleatórios comuns.") },
  { t: tx("Decisão"), d: tx("Alertas por região, simulação de alavancas, planejamento até 2045. Revalidado a cada nova competência.") },
];

const CRITERIOS = [
  [tx("Representação virtual do sistema físico"), tx("Rede hospitalar SUS-SP: 807 hospitais, 63 regiões, 7 tipos de leito, pacientes por idade de internação.")],
  [tx("Conexão com dados do sistema real"), tx("Pipeline mensal (DATASUS/CNES/IBGE) com validação de arquivos corrompidos e sincronização explícita.")],
  [tx("Atualização do estado"), tx("Estado sincronizado no último dia ≥97% faturado e propagado até a data de referência. A correção do nível pelos meses parciais foi testada e rejeitada (piorava o erro).")],
  [tx("Previsão com incerteza quantificada"), tx("Intervalos 50/80/95% calibrados; cobertura medida fora da amostra.")],
  [tx("Suporte à decisão / what-if"), tx("Simulador de cenários com alavancas de demanda, APS, permanência, leitos e regulação.")],
  [tx("Validação e verificação (VV&UQ)"), tx("Backtest em 25 origens; teste de paridade Python ↔ TypeScript; testes do simulador.")],
  [tx("Retroalimentação ao sistema físico"), tx("Via gestores (regulação, abertura de leitos, APS). Fechar o ciclo exige dado diário de leitos (ex.: CROSS/censo hospitalar).")],
];

export function Metodologia() {
  const { validacao: v, nucleo: n, grupo: g, tema, placar } = useStore();
  const [h, setH] = useState(30);
  const G = n!.grupos;

  const opWape = useMemo<EChartsOption | null>(() => {
    if (!v) return null;
    const b = base();
    const rows = G.map((gr) => v.backtest[gr.id].find((x) => x.h === h)!);
    const mk = (nome: string, k: 'gemeo' | 'persistencia' | 'sazonal' | 'media_movel', cor: string) => ({
      type: 'bar' as const, name: nome, data: rows.map((r) => +(r[k] * 100).toFixed(1)), itemStyle: { color: cor, borderRadius: [4, 4, 0, 0] }, barGap: '12%', barMaxWidth: 16,
      label: k === 'gemeo' ? { show: true, position: 'top' as const, color: b.t2, fontSize: 10, formatter: (p: any) => `${p.value}` } : undefined,
    });
    return {
      animation: false, textStyle: b.textStyle, grid: { left: 40, right: 10, top: 40, bottom: 28 },
      legend: { top: 0, left: 0, textStyle: { color: b.t2, fontSize: 11.5 }, itemWidth: 10, itemHeight: 10 },
      tooltip: { ...b.tooltip, trigger: 'axis', axisPointer: { type: 'shadow' }, valueFormatter: (x: any) => `${x}%` },
      xAxis: { type: 'category', data: G.map((x) => x.nome), ...b.eixoX, axisLabel: { color: b.t2, fontSize: 11, interval: 0, width: 90, overflow: 'truncate' } },
      yAxis: { type: 'value', ...b.eixoY, axisLabel: { ...b.eixoY.axisLabel, formatter: (x: number) => `${x}%` } },
      series: [mk(tx("Gêmeo"), 'gemeo', lerVar('--s1')), mk(tx("Média móvel 28d"), 'media_movel', lerVar('--s3')), mk(tx("Sazonal ingênuo"), 'sazonal', lerVar('--s4')), mk(tx("Persistência"), 'persistencia', lerVar('--s2'))],
    };
  }, [v, h, tema]);

  const ult = placar?.[0] ?? null;
  const opPlacar = useMemo<EChartsOption | null>(() => {
    if (!ult) return null;
    const b = base();
    const ts = ult.estado.datas.map((d) => parseData(d).getTime());
    const linha = (nome: string, v: number[], cor: string, tracejado = false) => ({ type: 'line' as const, name: nome, symbol: 'none', data: v.map((y, i) => [ts[i], y]),
      lineStyle: { width: 2, color: cor, type: tracejado ? ([5, 4] as any) : 'solid' }, itemStyle: { color: cor } });
    return {
      animation: false, textStyle: b.textStyle, grid: { left: 52, right: 12, top: 34, bottom: 24 },
      legend: { top: 0, left: 0, textStyle: { color: b.t2, fontSize: 11.5 }, itemWidth: 14, itemHeight: 3, icon: 'rect' },
      tooltip: { ...b.tooltip, trigger: 'axis', valueFormatter: (x: any) => n0(x) },
      xAxis: { type: 'time', ...b.eixoX }, yAxis: { type: 'value', ...b.eixoY, scale: true, axisLabel: { ...b.eixoY.axisLabel, formatter: (x: number) => n0(x) } },
      series: [linha(tx("Observado (dado que chegou depois)"), ult.estado.observado, b.t1), linha(tx("Previsto pelo gêmeo"), ult.estado.previsto, lerVar('--prev'), true)],
    };
  }, [ult, tema]);

  const opCob = useMemo<EChartsOption | null>(() => {
    if (!v) return null;
    const b = base();
    const hs = v.backtest.CLI.map((x) => x.h);
    const series: any[] = [];
    G.forEach((gr, i) => {
      series.push({ type: 'line', name: gr.nome, data: v.backtest[gr.id].map((x) => [x.h, +(x.cob80 * 100).toFixed(1)]), symbol: 'circle', symbolSize: 8,
        lineStyle: { width: 2, color: lerVar(`--s${i + 1}`) }, itemStyle: { color: lerVar(`--s${i + 1}`), borderColor: lerVar('--surface-1'), borderWidth: 2 } });
    });
    series[0].markLine = { symbol: 'none', silent: true, data: [{ yAxis: 80, lineStyle: { color: b.t2, type: [4, 4] }, label: { formatter: 'nominal 80%', color: b.t2, position: 'insideEndTop' } }] };
    series[0].markArea = { silent: true, data: [[{ yAxis: 75, itemStyle: { color: lerVar('--accent-soft') } }, { yAxis: 90 }]] };
    return {
      animation: false, textStyle: b.textStyle, grid: { left: 40, right: 16, top: 44, bottom: 28 },
      legend: { top: 0, left: 0, textStyle: { color: b.t2, fontSize: 11 }, itemWidth: 12, itemHeight: 3, icon: 'rect' },
      tooltip: { ...b.tooltip, trigger: 'axis', valueFormatter: (x: any) => `${x}%` },
      xAxis: { type: 'value', ...b.eixoX, min: 0, max: 95, name: 'horizonte (dias)', nameLocation: 'middle', nameGap: 22, nameTextStyle: { color: b.t3, fontSize: 11 }, data: hs } as any,
      yAxis: { type: 'value', min: 45, max: 100, ...b.eixoY, axisLabel: { ...b.eixoY.axisLabel, formatter: (x: number) => `${x}%` } },
      series,
    };
  }, [v, tema]);

  const opComp = useMemo<EChartsOption | null>(() => {
    if (!v) return null;
    const b = base();
    const c = v.completude;
    const acc = lerVar('--accent'), s3 = lerVar('--s3');
    return {
      animation: false, textStyle: b.textStyle, grid: { left: 44, right: 14, top: 36, bottom: 34 },
      legend: { top: 0, left: 0, textStyle: { color: b.t2, fontSize: 11.5 }, itemWidth: 12, itemHeight: 3, icon: 'rect' },
      tooltip: { ...b.tooltip, trigger: 'axis', valueFormatter: (x: any) => `${x}%`, axisPointer: { type: 'line' } },
      xAxis: { type: 'value', inverse: true, max: 150, ...b.eixoX, name: 'dias antes do fim da competência mais recente', nameLocation: 'middle', nameGap: 22, nameTextStyle: { color: b.t3, fontSize: 11 } },
      yAxis: { type: 'value', max: 100, ...b.eixoY, axisLabel: { ...b.eixoY.axisLabel, formatter: (x: number) => `${x}%` } },
      series: [
        { type: 'line', name: `Censo já faturado · ${G[g].nome}`, symbol: 'none', data: c.censo[g].slice(0, 151).map((x, t) => [t, +(x * 100).toFixed(1)]), lineStyle: { color: acc, width: 2 }, itemStyle: { color: acc },
          markLine: { symbol: 'none', silent: true, data: [{ xAxis: c.tau_sync, lineStyle: { color: b.t2, type: [4, 4] }, label: { formatter: `sincronização (τ=${c.tau_sync})`, color: b.t2, position: 'insideEndTop' } }, { yAxis: 97, lineStyle: { color: b.t3, type: [2, 3] }, label: { formatter: '97%', color: b.t3 } }] } },
        { type: 'line', name: 'Entradas já faturadas', symbol: 'none', data: c.entradas[g].slice(0, 151).map((x, t) => [t, +(x * 100).toFixed(1)]), lineStyle: { color: s3, width: 2 }, itemStyle: { color: s3 } },
      ],
    };
  }, [v, g, tema]);

  const opCal = useMemo<EChartsOption | null>(() => {
    if (!v) return null;
    const b = base();
    const m = v.mdow[g];
    const faixas = ['dia 1', '2–5', '6–24', tx("25–antepenúlt."), tx("penúltimo"), tx("último")];
    const dias = ['seg', 'ter', 'qua', 'qui', 'sex', tx("sáb"), 'dom'];
    const dados: [number, number, number][] = [];
    for (let f = 0; f < 6; f++) for (let d = 0; d < 7; d++) dados.push([d, f, +m[d + 7 * f].toFixed(2)]);
    const escuro = tema === 'dark';
    return {
      animation: false, textStyle: b.textStyle, grid: { left: 110, right: 16, top: 10, bottom: 50 },
      tooltip: { ...b.tooltip, formatter: (p: any) => tx("{0}, {1} do mês<br/>risco de alta ×<b>{2}</b>", dias[p.value[0]], faixas[p.value[1]], p.value[2]) },
      xAxis: { type: 'category', data: dias, ...b.eixoX }, yAxis: { type: 'category', data: faixas, ...b.eixoY, splitLine: { show: false } },
      visualMap: { min: 0.4, max: 1.6, orient: 'horizontal', left: 'center', bottom: 0, itemHeight: 200, itemWidth: 10, textStyle: { color: b.t3 },
        inRange: { color: escuro ? ['#5f9a96', '#93bdb9', '#3a3b40', '#e66767', '#d03b3b'] : ['#3d7873', '#9cc4c0', '#e3e2de', '#ec8a88', '#b8302f'] } },
      series: [{ type: 'heatmap', data: dados, label: { show: true, color: b.t1, fontSize: 10.5, formatter: (p: any) => p.value[2].toFixed(2) },
        itemStyle: { borderColor: lerVar('--surface-1'), borderWidth: 2, borderRadius: 3 } }],
    };
  }, [v, g, tema]);

  const exemplo = useMemo(() => {
    if (!v?.exemplo?.t0) return null;
    const t0 = parseData(v.exemplo.t0);
    const real = v.exemplo.real[g];
    const datasObs = real.map((_, i) => addDias(t0, i - 60));
    return {
      datasObs, completo: real.map((x) => x as number | null), datasPrev: Array.from({ length: 90 }, (_, i) => addDias(t0, i + 1)),
      media: v.exemplo.media[g], dp: v.exemplo.dp[g], capacidade: 0, sync: t0,
    };
  }, [v, g]);

  if (!v) return <div className="loading"><div className="spinner" /></div>;
  const bt = v.backtest[G[g].id];
  return (
    <div className="grid fade-in">
      <div className="card">
        <h3>{tx("Arquitetura do gêmeo")}</h3>
        <p className="hint">{tx("Do dado bruto à decisão. Cada etapa corresponde a um módulo do pipeline (`pipeline/gemeo/p00…p07`) ou do motor web (`web/src/engine`).")}</p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 8, marginTop: 8 }}>
          {ETAPAS.map((e, i) => (
            <div key={e.t} style={{ position: 'relative', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 12, padding: '12px 12px 12px 14px' }}>
              <div className="mono" style={{ color: 'var(--accent)', fontSize: 11 }}>{String(i + 1).padStart(2, '0')}</div>
              <div style={{ fontWeight: 600, margin: '2px 0 4px' }}>{e.t}</div>
              <div className="muted" style={{ fontSize: 12 }}>{e.d}</div>
              {i < ETAPAS.length - 1 && <div aria-hidden style={{ position: 'absolute', right: -9, top: '42%', color: 'var(--text-3)', zIndex: 1 }}>›</div>}
            </div>
          ))}
        </div>
      </div>
      {ult && (
        <div className="card">
          <h3>{tx("Acerto na prática: a previsão que o gêmeo fez, comparada ao que aconteceu")}</h3>
          <p className="hint">{tx("Toda vez que chegam dados novos do DATASUS, os dias que faltavam viram gabarito para a previsão anterior. Aqui: previsão feita com os dados até")} {dataBR(parseData(ult.previsao_de))}{tx(", avaliada de")} {dataBR(parseData(ult.periodo[0]))} {tx("a")} {dataBR(parseData(ult.periodo[1]))} ({ult.dias} {tx("dias,")} {n0(ult.unidades)} {tx("combinações de região e tipo de leito com pelo menos 5 internados).")}</p>
          <div className="mini" style={{ gridTemplateColumns: 'repeat(4, 1fr)', marginBottom: 12 }}>
            <div><div className="lbl">{tx("Erro regional")}</div><div className="val num">{pct(ult.geral.wape, 1)}</div><div className="det">{tx("repetir o último censo:")} {pct(ult.geral.wape_persistencia, 1)}</div></div>
            <div><div className="lbl">{tx("Erro do total do estado")}</div><div className="val num">{pct(ult.geral.erro_estado, 1)}</div><div className="det">{tx("média diária")}</div></div>
            <div><div className="lbl">{tx("Viés do estado")}</div><div className="val num">{ult.geral.vies_estado >= 0 ? '+' : '−'}{pct(Math.abs(ult.geral.vies_estado), 1)}</div><div className="det">{ult.geral.vies_estado >= 0 ? tx("previu acima do real") : tx("previu abaixo do real")}</div></div>
            <div><div className="lbl">{tx("Acerto da faixa de 80%")}</div><div className="val num">{ult.geral.cobertura_ic80 != null ? pct(ult.geral.cobertura_ic80) : '—'}</div><div className="det">{tx("o ideal é 80%")}</div></div>
          </div>
          <div className="grid" style={{ gridTemplateColumns: 'minmax(0,1.2fr) minmax(0,1fr)' }}>
            <div>
              <div className="sec-t" style={{ marginTop: 0 }}>{tx("Total do estado, todos os tipos de leito")}</div>
              {opPlacar && <Grafico opcao={opPlacar} altura={240} />}
            </div>
            <div>
              <div className="sec-t" style={{ marginTop: 0 }}>{tx("Por tipo de leito")}<span>{tx("erro regional (repetir o último censo)")}</span></div>
              <table className="tbl"><tbody>{ult.por_tipo.map((t) => (
                <tr key={t.id} style={{ cursor: 'default' }}>
                  <td>{t.nome}{t.confiabilidade === 'baixa' && <span className="tag" style={{ marginLeft: 6 }}>{tx("confiab. baixa")}</span>}</td>
                  <td className="r num"><b>{pct(t.wape, 1)}</b> <span className="muted">({pct(t.wape_persistencia, 1)})</span></td>
                  <td className="r num muted">{t.cobertura_ic80 != null ? tx('faixa {0}', pct(t.cobertura_ic80)) : ''}</td>
                </tr>))}</tbody></table>
            </div>
          </div>
          {placar && placar.length > 1 && (
            <>
              <div className="sec-t">{tx("Histórico de avaliações")}</div>
              <table className="tbl"><thead><tr><th>{tx("Previsão de")}</th><th>{tx("Dias avaliados")}</th><th className="r">{tx("Erro regional")}</th><th className="r">{tx("Repetir último censo")}</th><th className="r">{tx("Viés estadual")}</th><th className="r">{tx("Faixa 80%")}</th></tr></thead>
                <tbody>{placar.map((x) => (
                  <tr key={x.previsao_de} style={{ cursor: 'default' }}><td>{dataBR(parseData(x.previsao_de))}</td><td>{dataBR(parseData(x.periodo[0])).slice(0, 5)} {tx("a")} {dataBR(parseData(x.periodo[1])).slice(0, 5)}</td>
                    <td className="r num">{pct(x.geral.wape, 1)}</td><td className="r num muted">{pct(x.geral.wape_persistencia, 1)}</td>
                    <td className="r num">{x.geral.vies_estado >= 0 ? '+' : '−'}{pct(Math.abs(x.geral.vies_estado), 1)}</td><td className="r num">{x.geral.cobertura_ic80 != null ? pct(x.geral.cobertura_ic80) : '—'}</td></tr>))}</tbody></table>
            </>
          )}
          <p className="hint" style={{ marginTop: 10 }}>{tx("Erro regional (WAPE) = Σ|previsto − real| ÷ Σ real, por região e tipo de leito. Uma avaliação cobre poucas semanas de uma só estação, então vale como confirmação, não como prova; o histórico cresce a cada atualização. Psiquiatria e crônicos tem confiabilidade baixa (AIH de longa permanência fora do SIH comum).")}</p>
        </div>
      )}
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}><SeletorGrupo /></div>
      <div className="grid" style={{ gridTemplateColumns: 'minmax(0,1.2fr) minmax(0,1fr)' }}>
        <div className="card">
          <div className="card-head"><div><h3>{tx("Erro da previsão de ocupação regional (WAPE), fora da amostra")}</h3>
            <p className="hint">{v.n_origens_avaliacao} {tx("origens mensais de")} {dataBR(parseData(v.origens_avaliacao[0]))} {tx("a")} {dataBR(parseData(v.origens_avaliacao[1]))}{tx("; perfis ajustados só com dados até 2023. Menor é melhor.")}</p></div>
            <div className="seg">{[7, 14, 30, 60, 90].map((x) => <button key={x} className={h === x ? 'on' : ''} onClick={() => setH(x)}>{x}{tx("d")}</button>)}</div>
          </div>
          {opWape && <Grafico opcao={opWape} altura={300} />}
        </div>
        <div className="card">
          <h3>{tx("Calibração: cobertura real do intervalo de 80%")}</h3>
          <p className="hint">{tx("Fração das previsões regionais em que o censo real caiu dentro do IC 80%. Faixa sombreada: 75–90%.")}</p>
          {opCob && <Grafico opcao={opCob} altura={300} />}
        </div>
      </div>
      <div className="grid" style={{ gridTemplateColumns: 'minmax(0,1.2fr) minmax(0,1fr)' }}>
        <div className="card">
          <h3>{tx("Teste cego · inverno de 2025 · Estado ·")} {G[g].nome}</h3>
          <p className="hint">{tx("Previsão feita em")} {v.exemplo.t0 ? dataBR(parseData(v.exemplo.t0)) : ''} {tx("só com dados anteriores, comparada ao censo que aconteceu depois.")}</p>
          {exemplo && <Leque d={exemplo} altura={300} />}
        </div>
        <div className="card">
          <h3>{tx("Tabela do backtest ·")} {G[g].nome}</h3>
          <table className="tbl"><thead><tr><th>{tx("h")}</th><th className="r">{tx("Gêmeo")}</th><th className="r">{tx("Persist.")}</th><th className="r">{tx("Sazonal")}</th><th className="r">{tx("MM28")}</th><th className="r">{tx("Cob. 80")}</th><th className="r">{tx("Cob. 95")}</th><th className="r">{tx("Estado")}</th></tr></thead>
            <tbody>{bt.map((r) => {
              const melhor = Math.min(r.gemeo, r.persistencia, r.sazonal, r.media_movel);
              const c = (x: number) => ({ fontWeight: x === melhor ? 700 : 400, color: x === melhor ? 'var(--text-1)' : 'var(--text-2)' });
              return <tr key={r.h}><td>{r.h} {tx("d")}</td><td className="r num" style={c(r.gemeo)}>{pct(r.gemeo, 1)}</td><td className="r num" style={c(r.persistencia)}>{pct(r.persistencia, 1)}</td>
                <td className="r num" style={c(r.sazonal)}>{pct(r.sazonal, 1)}</td><td className="r num" style={c(r.media_movel)}>{pct(r.media_movel, 1)}</td>
                <td className="r num">{pct(r.cob80)}</td><td className="r num">{pct(r.cob95)}</td><td className="r num">{pct(r.estado_gemeo, 1)}</td></tr>;
            })}</tbody></table>
          <p className="hint" style={{ marginTop: 10 }}>{tx("WAPE regional = Σ|erro| ÷ Σ censo real. \"Estado\" = WAPE da soma estadual. Em negrito, o melhor método em cada horizonte.")}
            {G[g].confiabilidade === 'baixa' && tx(" Este grupo exclui as AIH de longa permanência (tipo 5); o censo é subestimado e a previsão tem confiabilidade baixa.")}</p>
        </div>
      </div>
      {v.operacional && (
        <div className="card">
          <h3>{tx("Erro nas condições reais de uso (backtest operacional)")}</h3>
          <p className="hint">{tx("Em")} {v.operacional.cortes.length} {tx("cortes de faturamento (")}{dataBR(parseData(v.operacional.cortes[0]))} {tx("a")} {dataBR(parseData(v.operacional.cortes[v.operacional.cortes.length - 1]))}{tx(") o gêmeo foi rodado só com as AIHs que já existiam naquela data, exatamente como o gestor as teria, e comparado ao censo que aconteceu depois. “Hoje” = 56 dias depois do último dado faturado, a mesma defasagem do painel atual. Ingênuo = último censo visível mantido constante.")}</p>
          <div className="scroll">
            <table className="tbl"><thead><tr><th>{tx("Leito")}</th>
              {[['ultimo_faturado', tx("Último dia faturado")], ['hoje', '“Hoje”'], ['hoje_4sem', tx("Hoje + 4 semanas")], ['hoje_90d', tx("Hoje + 90 dias")]].map(([k, t]) => <th key={k} className="r">{t}</th>)}
              <th className="r">{tx("Cob. IC 80% (hoje)")}</th></tr></thead>
              <tbody>{G.filter((x) => x.id !== 'OUT').map((gr) => {
                const r = v.operacional!.resultado[gr.id];
                return <tr key={gr.id} style={{ cursor: 'default' }}><td>{gr.nome}</td>
                  {['ultimo_faturado', 'hoje', 'hoje_4sem', 'hoje_90d'].map((k) => <td key={k} className="r num">
                    <b>{pct(r[k].reg, 1)}</b> <span className="muted">{tx("· ingênuo")} {pct(r[k].ing, 0)} · ±{r[k].pp.toFixed(1)} {tx("p.p. · estado")} {pct(r[k].est, 1)}</span></td>)}
                  <td className="r num">{pct(r.hoje.c80)}</td></tr>;
              })}</tbody></table>
          </div>
          <p className="hint" style={{ marginTop: 8 }}>{tx("Negrito: erro regional (WAPE). “±p.p.” = erro absoluto médio da taxa de ocupação regional, em pontos percentuais. “Estado” = erro da soma estadual.")}</p>
        </div>
      )}
      <div className="grid" style={{ gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)' }}>
        <div className="card">
          <h3>{tx("Atraso de faturamento: por que o gêmeo sincroniza")} {v.completude.tau_sync} {tx("dias antes do último dado")}</h3>
          <p className="hint">{tx("Estimado comparando o que se sabia em")} {v.completude.cortes.length} {tx("cortes históricos com o que chegou depois. Quem está internado só aparece no SIH após a alta.")}</p>
          {opComp && <Grafico opcao={opComp} altura={260} />}
        </div>
        <div className="card">
          <h3>{tx("Efeito calendário no risco de alta ·")} {G[g].nome}</h3>
          <p className="hint">{tx("Multiplicador do risco de alta por dia da semana × fase do mês. Altas caem no fim de semana e se concentram no fim da competência (artefato de faturamento que o censo do SIH reflete).")}</p>
          {opCal && <Grafico opcao={opCal} altura={260} />}
        </div>
      </div>
      <div className="grid" style={{ gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)' }}>
        <div className="card">
          <h3>{tx("Critérios de gêmeo digital (NASEM, 2024)")}</h3>
          <table className="tbl"><tbody>{CRITERIOS.map(([c, d], i) => (
            <tr key={c} style={{ cursor: 'default' }}><td style={{ width: 22 }}><span style={{ color: i === CRITERIOS.length - 1 ? 'var(--warning)' : 'var(--good)' }}>{i === CRITERIOS.length - 1 ? '◐' : '●'}</span></td>
              <td><b>{c}</b><div className="muted" style={{ fontSize: 12 }}>{d}</div></td></tr>))}</tbody></table>
        </div>
        <div className="card prose">
          <h3 style={{ color: 'var(--text-1)' }}>{tx("Limitações declaradas")}</h3>
          <ul>
            <li><b>{tx("Só SUS e só SIH:")}</b> {tx("leitos privados e internações não faturadas via AIH ficam de fora. Capacidade = leitos SUS no CNES (")}{String(n!.meta.competencia_cnes).replace(/(\d{4})(\d{2})/, '$2/$1')}).</li>
            <li><b>{tx("AIH tipo 5")}</b> {tx("(longa permanência) excluída: psiquiatria e crônicos têm censo subestimado.")}</li>
            <li><b>{tx("Datas da UTI")}</b> {tx("não existem no SIH: os dias de UTI são colocados no início da internação.")}</li>
            <li><b>{tx("Latência:")}</b> {tx("o SIH chega com 1–3 meses de atraso. O estado de hoje é uma propagação a partir de")} {dataBR(parseData(n!.meta.data_sync))}{tx(", não uma leitura direta. O erro dessa propagação está na tabela de uso real acima.")}</li>
            <li><b>{tx("Ocupação")}</b> {tx("= censo SIH ÷ leitos SUS do CNES. Hospitais que faturam leito de um tipo em outro distorcem o valor hospital a hospital; no nível regional isso se compensa.")}</li>
            <li><b>{tx("Planejamento")}</b> {tx("mantém as taxas atuais por idade e local de residência; não inclui mudança epidemiológica nem tecnológica.")}</li>
            <li><b>{tx("Agregação:")}</b>{' '}{tx('correlação de 0,5 entre regiões no erro de nível ao somar intervalos. A cobertura estadual observada fica conservadora (>80%).')}</li>
          </ul>
          <p className="muted" style={{ fontSize: 12 }}>{tx("Parâmetros: janela de nível")} {v.janela} {tx("dias (escolhida em calibração), sem tendência; σ do nível = √(a + b·h) por grupo. Total de")} {n0(bt.length)} {tx("horizontes avaliados por grupo.")}</p>
        </div>
      </div>
    </div>
  );
}
