import type { EChartsOption } from 'echarts';
import { useMemo, useState } from 'react';
import { Kpi, SeletorGrupo, Status } from '../components/Controles';
import { Grafico } from '../components/Grafico';
import { LegendaRampa, Mapa } from '../components/Mapa';
import type { Hospital } from '../data/tipos';
import { corGrupo, corOcupacao, gradienteOcupacao, lerVar, nivelOcupacao } from '../lib/cores';
import { addDias, n0, n1, parseData, pct, reais } from '../lib/formato';
import { base } from '../lib/tema-graf';
import { useStore } from '../store';

type Col = 'nome' | 'leitos' | 'ocup' | 'de_fora' | 'perm' | 'letal' | 'n';

export function Hospitais() {
  const { nucleo: n, hospitais: hs, grupo: g, escopo, tema } = useStore();
  const [busca, setBusca] = useState('');
  const [ord, setOrd] = useState<{ c: Col; d: 1 | -1 }>({ c: 'leitos', d: -1 });
  const [sel, setSel] = useState<number | null>(null);
  const G = n!.grupos.length;

  const lista = useMemo(() => {
    if (!hs) return [];
    const regs = new Set(n!.regioes.filter((r) => escopo.tipo === 'estado' || (escopo.tipo === 'drs' && r.drs === escopo.id) || (escopo.tipo === 'regiao' && r.id === escopo.id)).map((r) => r.id));
    const q = busca.trim().toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '');
    const val = (h: Hospital, c: Col) => c === 'nome' ? h.nome : c === 'leitos' ? h.leitos[g] : c === 'ocup' ? (h.leitos[g] ? h.censo[g] / h.leitos[g] : -1) : (h[c] ?? -1);
    return hs.hospitais.filter((h) => h.regiao != null && regs.has(h.regiao) && h.leitos[g] + h.censo[g] > 0.5)
      .filter((h) => !q || `${h.nome} ${h.municipio} ${h.cnes}`.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '').includes(q))
      .sort((a, b) => { const x = val(a, ord.c), y = val(b, ord.c); return (x < y ? -1 : x > y ? 1 : 0) * ord.d; });
  }, [hs, g, escopo, busca, ord]);

  const pontos = useMemo<GeoJSON.FeatureCollection>(() => ({
    type: 'FeatureCollection', features: lista.filter((h) => h.lat && h.leitos[g] > 0).map((h) => ({
      type: 'Feature', geometry: { type: 'Point', coordinates: [h.lon!, h.lat!] },
      properties: { id: h.cnes, cor: corOcupacao(h.censo[g] / h.leitos[g]), raio: Math.max(2.2, Math.sqrt(h.leitos[g]) * (h.cnes === sel ? 1.5 : 0.9)) },
    })),
  }), [lista, g, sel, tema]);
  const cores = useMemo(() => new Map(n!.regioes.map((r) => [r.id, lerVar('--surface-2')])), [tema]);

  const h = hs?.hospitais.find((x) => x.cnes === sel) ?? null;
  const opSerie = useMemo<EChartsOption | null>(() => {
    if (!h || !hs) return null;
    const b = base();
    const fim = parseData(hs.semana_final);
    const tot = h.leitos.reduce((a, c) => a + c, 0);
    const acc = lerVar('--accent');
    return {
      animation: false, textStyle: b.textStyle, grid: { left: 44, right: 12, top: 16, bottom: 24 },
      tooltip: { ...b.tooltip, trigger: 'axis', valueFormatter: (v: any) => n1(v) },
      xAxis: { type: 'time', ...b.eixoX }, yAxis: { type: 'value', ...b.eixoY, scale: true },
      series: [{ type: 'line', name: 'Censo médio semanal (todos os leitos)', symbol: 'none', data: h.semanal.map((v, i) => [addDias(fim, (i - h.semanal.length + 1) * 7).getTime(), v]),
        lineStyle: { color: acc, width: 1.8 }, areaStyle: { color: acc, opacity: 0.1 },
        markLine: { symbol: 'none', silent: true, data: [{ yAxis: tot, lineStyle: { color: lerVar('--critical') }, label: { formatter: `${tot} leitos SUS`, color: b.t2, position: 'insideEndTop', fontSize: 11 } }] } }],
    };
  }, [h, tema]);
  const opGrupos = useMemo<EChartsOption | null>(() => {
    if (!h) return null;
    const b = base();
    const idx = n!.grupos.map((_, i) => i).filter((i) => h.leitos[i] > 0 || h.censo[i] > 0.5);
    return {
      animation: false, textStyle: b.textStyle, grid: { left: 150, right: 30, top: 24, bottom: 20 },
      legend: { top: 0, right: 0, textStyle: { color: b.t2, fontSize: 11 }, itemWidth: 10, itemHeight: 10 },
      tooltip: { ...b.tooltip, trigger: 'axis', axisPointer: { type: 'shadow' } },
      xAxis: { type: 'value', ...b.eixoY }, yAxis: { type: 'category', data: idx.map((i) => n!.grupos[i].nome), ...b.eixoX, axisLabel: { color: b.t2, fontSize: 11 } },
      series: [
        { type: 'bar', name: 'Leitos SUS', data: idx.map((i) => ({ value: h.leitos[i], itemStyle: { color: lerVar('--surface-3'), borderRadius: [0, 4, 4, 0] } })), barGap: '-100%', barWidth: 14 },
        { type: 'bar', name: 'Censo médio 12m', data: idx.map((i) => ({ value: +h.censo[i].toFixed(1), itemStyle: { color: corGrupo(i), borderRadius: [0, 4, 4, 0] } })), barWidth: 8 },
      ],
    };
  }, [h, tema]);

  const th = (c: Col, rot: string, r = true) => (
    <th className={r ? 'r' : ''} onClick={() => setOrd({ c, d: ord.c === c ? (-ord.d as 1 | -1) : -1 })}>{rot}{ord.c === c ? (ord.d > 0 ? ' ↑' : ' ↓') : ''}</th>
  );
  const capT = lista.reduce((s, x) => s + x.leitos[g], 0), cenT = lista.reduce((s, x) => s + x.censo[g], 0);
  return (
    <div className="grid fade-in">
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <SeletorGrupo />
        <input type="search" placeholder="Buscar hospital, município ou CNES…" value={busca} onChange={(e) => setBusca(e.target.value)} style={{ minWidth: 260 }} />
      </div>
      <div className="kpis">
        <Kpi lbl="Hospitais no recorte" val={n0(lista.length)} det={`com leito ou internação em ${n!.grupos[g].nome.toLowerCase()}`} />
        <Kpi lbl="Leitos SUS" val={n0(capT)} />
        <Kpi lbl="Ocupação média (12 meses)" val={pct(cenT / capT, 1)} extra={<Status nivel={nivelOcupacao(cenT / capT)} />} />
        <Kpi lbl="Acima de 85%" val={n0(lista.filter((x) => x.leitos[g] >= 5 && x.censo[g] / x.leitos[g] > 0.85).length)} det="hospitais com ≥5 leitos no grupo" />
      </div>
      <p className="muted" style={{ fontSize: 12, margin: 0 }}>Ocupação = censo médio SUS dos últimos 12 meses ÷ leitos SUS do CNES. Por tipo de leito, pode passar de 100% quando o hospital fatura AIH de uma especialidade em leito cadastrado como outra (comum em hospitais de ensino); o detalhe mostra todos os tipos.</p>
      <div className="grid" style={{ gridTemplateColumns: 'minmax(0, 1.25fr) minmax(0, 1fr)' }}>
        <div className="card" style={{ display: 'flex', flexDirection: 'column', maxHeight: 640 }}>
          <div className="scroll" style={{ flex: 1, margin: '-8px -8px 0' }}>
            <table className="tbl">
              <thead><tr>{th('nome', 'Hospital', false)}{th('leitos', 'Leitos')}{th('ocup', 'Ocupação')}{th('de_fora', 'De fora da região')}{th('perm', 'Perm.')}{th('letal', 'Letalid.')}{th('n', 'AIH/ano')}</tr></thead>
              <tbody>{lista.slice(0, 400).map((x) => {
                const o = x.leitos[g] ? x.censo[g] / x.leitos[g] : NaN;
                return <tr key={x.cnes} className={x.cnes === sel ? 'sel' : ''} onClick={() => setSel(x.cnes === sel ? null : x.cnes)}>
                  <td><div style={{ fontWeight: 500 }}>{x.nome}</div><div className="muted" style={{ fontSize: 11 }}>{x.municipio} · CNES {x.cnes}{x.esfera ? ` · ${x.esfera.toLowerCase()}` : ''}</div></td>
                  <td className="r num">{n0(x.leitos[g])}</td>
                  <td className="r num"><span style={{ display: 'inline-flex', gap: 5, alignItems: 'center' }}>{isFinite(o) && <i className="swatch" style={{ background: corOcupacao(o) }} />}{isFinite(o) ? pct(o) : '—'}</span></td>
                  <td className="r num">{pct(x.de_fora)}</td><td className="r num">{n1(x.perm)}</td><td className="r num">{pct(x.letal, 1)}</td><td className="r num">{n0(x.n)}</td>
                </tr>;
              })}</tbody>
            </table>
          </div>
        </div>
        <div className="grid" style={{ alignContent: 'start' }}>
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <Mapa camada="regioes" cores={cores} pontos={pontos} altura={h ? 300 : 620}
              onClick={(t, id) => t === 'ponto' && setSel(id)}
              tooltip={(t, id) => { if (t !== 'ponto') return null; const x = hs?.hospitais.find((y) => y.cnes === id); return x && <><b>{x.nome}</b><div className="muted">{x.municipio}</div>
                <div className="row"><span>Leitos SUS</span><span>{x.leitos[g]}</span></div><div className="row"><span>Ocupação 12m</span><span>{pct(x.censo[g] / x.leitos[g])}</span></div></>; }}>
              <div className="map-overlay" style={{ left: 12, bottom: 12 }}><LegendaRampa titulo="Ocupação média · tamanho ∝ √leitos" gradiente={gradienteOcupacao()} ticks={['45%', '65%', '85%', '100%', '115%']} /></div>
            </Mapa>
          </div>
          {h && <div className="card fade-in">
            <div className="card-head"><div><h3>{h.nome}</h3><p className="hint">{h.municipio} · CNES {h.cnes} · {h.natjur ?? ''}</p></div>
              <button className="iconbtn" onClick={() => setSel(null)} aria-label="Fechar">✕</button></div>
            <div className="kpis" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
              <div><div className="muted" style={{ fontSize: 11 }}>AIH/ano</div><b className="num">{n0(h.n)}</b></div>
              <div><div className="muted" style={{ fontSize: 11 }}>Municípios de origem</div><b className="num">{n0(h.n_mun)}</b></div>
              <div><div className="muted" style={{ fontSize: 11 }}>De fora da região</div><b className="num">{pct(h.de_fora)}</b></div>
              <div><div className="muted" style={{ fontSize: 11 }}>Faturamento/ano</div><b className="num">{h.valor ? reais(h.valor) : '—'}</b></div>
            </div>
            {opGrupos && <Grafico opcao={opGrupos} altura={Math.max(120, 34 * n!.grupos.filter((_, i) => h.leitos[i] > 0 || h.censo[i] > 0.5).length + 40)} />}
            <div className="nav-sec" style={{ padding: '6px 0' }}>Censo semanal, 2 anos</div>
            {opSerie && <Grafico opcao={opSerie} altura={170} />}
          </div>}
        </div>
      </div>
      {G < 0 && null}
    </div>
  );
}
