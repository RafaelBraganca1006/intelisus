import { tx } from '../i18n';
import type { EChartsOption } from 'echarts';
import { useMemo, useState } from 'react';
import { Controle, Kpi, SeletorGrupo, Status } from '../components/Controles';
import { Grafico } from '../components/Grafico';
import { LegendaRampa, Mapa } from '../components/Mapa';
import { corDiv, corGrupo, lerVar } from '../lib/cores';
import { n0, pct, sinal } from '../lib/formato';
import { base } from '../lib/tema-graf';
import { nomeEscopo, unidades, useStore } from '../store';

export function Planejamento() {
  const { nucleo: n, historico: h, grupo: g, escopo, tema, set } = useStore();
  const anoRef = Number(n!.meta.data_sync.slice(0, 4));
  const [ano, setAno] = useState(2035);
  const [meta, setMeta] = useState(85);
  const [pico, setPico] = useState(true);
  const [icsap, setIcsap] = useState(0);
  const [perm, setPerm] = useState(0);
  const G = n!.grupos.length;
  const anos = n!.planejamento.anos;

  // censo de referência por unidade: média ou P90 das 52 semanas antes da sincronização
  const censoRef = useMemo(() => {
    if (!h) return null;
    const W = h.semanas.n;
    return h.semanas.censo.map((s) => {
      const x = s.slice(W - 53, W - 1).slice().sort((a, b) => a - b);
      return { media: x.reduce((a, b) => a + b, 0) / x.length, p90: x[Math.floor(x.length * 0.9)] };
    });
  }, [h]);

  const necessario = (u: number, a: number) => {
    if (!censoRef) return 0;
    const j = anos.indexOf(a), j0 = anos.indexOf(anoRef);
    const c = pico ? censoRef[u].p90 : censoRef[u].media;
    const f = n!.planejamento.mult[u][j] / n!.planejamento.mult[u][j0];
    const alav = (1 - (icsap / 100) * n!.demanda.icsap_dias[u]) * (1 - perm / 100);
    return (c * f * alav) / (meta / 100);
  };

  const porRegiao = useMemo(() => n!.regioes.map((r, i) => {
    const u = i * G + g, cap = n!.capacidade[i][g];
    const nec = necessario(u, ano), hoje = necessario(u, anoRef);
    return { r, i, cap, nec, hoje, gap: nec - cap };
  }), [censoRef, g, ano, meta, pico, icsap, perm]);

  const us = unidades(n!, escopo, g);
  const idx = new Set(us.map((u) => Math.floor(u / G)));
  const sel = porRegiao.filter((x) => idx.has(x.i));
  const capT = sel.reduce((s, x) => s + x.cap, 0), necT = sel.reduce((s, x) => s + x.nec, 0), hojeT = sel.reduce((s, x) => s + x.hoje, 0);
  const deficit = sel.filter((x) => x.gap > 0.5).reduce((s, x) => s + x.gap, 0);

  const cores = useMemo(() => new Map(porRegiao.filter((x) => x.cap > 0).map((x) => [x.r.id, corDiv(x.gap / Math.max(x.cap, 1) / 0.5)])), [porRegiao, tema]);

  const opAnos = useMemo<EChartsOption | null>(() => {
    if (!censoRef) return null;
    const b = base();
    const series: any[] = n!.grupos.map((gr, gi) => {
      const uu = unidades(n!, escopo, gi);
      const cap = uu.reduce((s, u) => s + n!.capacidade[Math.floor(u / G)][gi], 0);
      return {
        type: 'line', name: gr.nome, symbol: 'none', smooth: true,
        lineStyle: { width: gi === g ? 2.6 : 1.4, color: corGrupo(gi), opacity: gi === g ? 1 : 0.55 }, itemStyle: { color: corGrupo(gi) },
        data: anos.map((a) => [a, +(((uu.reduce((s, u) => s + necessario(u, a), 0) / Math.max(cap, 1)) - 1) * 100).toFixed(1)]),
        endLabel: { show: true, formatter: (p: any) => `${gr.id.replace('_', ' ')} ${p.value[1] > 0 ? '+' : ''}${p.value[1].toFixed(0)}%`, color: b.t2, fontSize: 10.5 },
      };
    });
    series[0].markLine = { symbol: 'none', silent: true, data: [{ yAxis: 0, lineStyle: { color: b.t3, type: [4, 4] }, label: { formatter: 'capacidade atual', color: b.t3, position: 'insideStartTop', fontSize: 10.5 } },
      { xAxis: ano, lineStyle: { color: lerVar('--accent') }, label: { formatter: String(ano), color: lerVar('--accent') } }] };
    return {
      animation: false, textStyle: b.textStyle, grid: { left: 50, right: 110, top: 64, bottom: 30 },
      legend: { top: 0, left: 0, textStyle: { color: b.t2, fontSize: 11 }, itemWidth: 14, itemHeight: 3, icon: 'rect' },
      tooltip: { ...b.tooltip, trigger: 'axis', valueFormatter: (v: any) => `${v > 0 ? '+' : ''}${v}%` },
      xAxis: { type: 'value', min: anoRef, max: 2045, interval: 5, ...b.eixoX, axisLabel: { ...b.eixoX.axisLabel, formatter: (v: number) => String(v) } },
      yAxis: { type: 'value', ...b.eixoY, axisLabel: { ...b.eixoY.axisLabel, formatter: (v: number) => `${v}%` } },
      series,
    };
  }, [censoRef, escopo, g, meta, pico, icsap, perm, ano, tema]);

  return (
    <div className="grid fade-in" style={{ gridTemplateColumns: '300px minmax(0, 1fr)', alignItems: 'start' }}>
      <div className="card" style={{ position: 'sticky', top: 0 }}>
        <h3>{tx("Premissas")}</h3>
        <p className="hint">{tx("Taxas atuais de uso de leito por idade e município de residência, aplicadas à Projeção IBGE 2024.")}</p>
        <Controle rotulo={tx("Ano do horizonte")} valor={ano}><input type="range" min={anoRef} max={2045} value={ano} onChange={(e) => setAno(+e.target.value)} /></Controle>
        <Controle rotulo={tx("Meta de ocupação")} valor={`${meta}%`} desc={tx("Leitos = censo ÷ meta. 85% é a referência usual para absorver flutuações.")}><input type="range" min={70} max={95} value={meta} onChange={(e) => setMeta(+e.target.value)} /></Controle>
        <Controle rotulo={tx("Dimensionar para")} valor={pico ? tx("pico sazonal") : tx("média anual")} desc={tx("Pico = semana P90 dos últimos 12 meses (inverno).")}>
          <div className="seg"><button className={pico ? 'on' : ''} onClick={() => setPico(true)}>{tx("Pico (P90)")}</button><button className={!pico ? 'on' : ''} onClick={() => setPico(false)}>{tx("Média")}</button></div>
        </Controle>
        <Controle rotulo={tx("APS resolutiva (ICSAP evitadas)")} valor={`−${icsap}%`} desc={tx("Aplica-se à fração de leitos-dia por ICSAP de cada região.")}><input type="range" min={0} max={50} step={5} value={icsap} onChange={(e) => setIcsap(+e.target.value)} /></Controle>
        <Controle rotulo={tx("Redução da permanência")} valor={`−${perm}%`}><input type="range" min={0} max={25} value={perm} onChange={(e) => setPerm(+e.target.value)} /></Controle>
      </div>
      <div className="grid">
        <SeletorGrupo />
        <div className="kpis">
          <Kpi lbl={tx("Leitos necessários em {0}", ano)} val={n0(necT)} det={<>{nomeEscopo(n!, escopo)} · {n!.grupos[g].nome}</>} />
          <Kpi lbl={tx("Leitos SUS hoje")} val={n0(capT)} det={<>{tx("necessários hoje:")} {n0(hojeT)} ({pct(hojeT / capT - 1 >= 0 ? hojeT / capT - 1 : hojeT / capT - 1)})</>} />
          <Kpi lbl={tx("Variação necessária")} val={`${sinal(((necT - capT) / capT) * 100)}%`} un="" extra={<Status nivel={necT > capT * 1.05 ? 'serious' : necT > capT ? 'warning' : 'good'} texto={necT > capT ? tx("déficit") : 'suficiente'} />}
            det={<>{sinal(necT - capT)} {tx("leitos no saldo do recorte")}</>} />
          <Kpi lbl={tx("Soma dos déficits regionais")} val={n0(deficit)} det={<>{sel.filter((x) => x.gap > 0.5).length} {tx("de")} {sel.filter((x) => x.cap > 0).length} {tx("regiões precisam de leitos (sem remanejar)")}</>} />
        </div>
        <div className="card">
          <h3>{tx("Necessidade vs. capacidade atual, por tipo de leito ·")} {nomeEscopo(n!, escopo)}</h3>
          <p className="hint">{tx("Percentual de leitos a mais (ou a menos) em relação ao que existe hoje. O envelhecimento pressiona clínico e UTI adulto; a queda da natalidade alivia obstetrícia e pediatria.")}</p>
          {opAnos && <Grafico opcao={opAnos} altura={320} />}
        </div>
        <div className="grid" style={{ gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)' }}>
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <Mapa camada="regioes" cores={cores} altura={440} selecionado={escopo.tipo === 'regiao' ? escopo.id : null}
              onClick={(t, id) => t === 'area' && set({ escopo: { tipo: 'regiao', id } })}
              tooltip={(_, id) => { const x = porRegiao.find((y) => y.r.id === id)!; return <><b>{x.r.nome}</b>
                <div className="row"><span>{tx("Leitos hoje")}</span><span>{n0(x.cap)}</span></div>
                <div className="row"><span>{tx("Necessários")} {ano}</span><span>{n0(x.nec)}</span></div>
                <div className="row"><span>{tx("Saldo")}</span><span>{sinal(-x.gap)}</span></div></>; }}>
              <div className="map-overlay" style={{ left: 12, bottom: 12 }}>
                <LegendaRampa titulo={tx("Déficit (vermelho) / sobra (azul) em {0}", ano)} gradiente={`linear-gradient(90deg, ${[-1, -0.5, 0, 0.5, 1].map((x) => corDiv(x)).join(',')})`} ticks={['−50%', '', '0', '', '+50%']} />
              </div>
            </Mapa>
          </div>
          <div className="card" style={{ maxHeight: 442, display: 'flex', flexDirection: 'column' }}>
            <h3>{tx("Regiões por déficit em")} {ano}</h3>
            <div className="scroll" style={{ flex: 1, margin: '6px -8px 0' }}>
              <table className="tbl"><thead><tr><th>{tx("Região")}</th><th className="r">{tx("Hoje")}</th><th className="r">{tx("Necessários")}</th><th className="r">{tx("Saldo")}</th></tr></thead>
                <tbody>{porRegiao.filter((x) => x.cap > 0 || x.nec > 1).slice().sort((a, b) => b.gap - a.gap).map((x) => (
                  <tr key={x.r.id} onClick={() => set({ escopo: { tipo: 'regiao', id: x.r.id } })} className={escopo.tipo === 'regiao' && escopo.id === x.r.id ? 'sel' : ''}>
                    <td>{x.r.nome}<div className="muted" style={{ fontSize: 11 }}>{n!.drs.find((d) => d.id === x.r.drs)?.nome}</div></td>
                    <td className="r num">{n0(x.cap)}</td><td className="r num">{n0(x.nec)}</td>
                    <td className="r num" style={{ fontWeight: 600 }}><span style={{ display: 'inline-flex', gap: 5, alignItems: 'center' }}><i className="swatch" style={{ background: corDiv(x.gap / Math.max(x.cap, 1) / 0.5) }} />{sinal(-x.gap)}</span></td>
                  </tr>))}</tbody></table>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
