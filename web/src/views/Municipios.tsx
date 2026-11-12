import type { EChartsOption } from 'echarts';
import { useMemo, useState } from 'react';
import { Grafico } from '../components/Grafico';
import { LegendaRampa, Mapa } from '../components/Mapa';
import type { Municipio } from '../data/tipos';
import { corSeq, gradienteSeq, lerVar } from '../lib/cores';
import { n0, n1, parseData, pct, reais } from '../lib/formato';
import { base } from '../lib/tema-graf';
import { useStore } from '../store';

const INDIC: { id: keyof Municipio; nome: string; fmt: (v: number) => string; desc: string }[] = [
  { id: 'taxa_pad', nome: 'Internações /1.000 (padronizada)', fmt: (v) => n1(v), desc: 'Taxa de internação dos residentes padronizada pela estrutura etária do estado.' },
  { id: 'taxa_icsap_pad', nome: 'ICSAP /1.000 (padronizada)', fmt: (v) => n1(v), desc: 'Internações sensíveis à atenção primária (Portaria 221/2008), padronizadas por idade.' },
  { id: 'fora_mun', nome: '% internado fora do município', fmt: (v) => pct(v), desc: 'Dependência da rede de outros municípios.' },
  { id: 'fora_reg', nome: '% internado fora da região', fmt: (v) => pct(v), desc: 'Evasão para fora da região de saúde.' },
  { id: 'perm', nome: 'Permanência média (dias)', fmt: (v) => n1(v), desc: 'Dias de internação por AIH dos residentes.' },
];

export function Municipios() {
  const { municipios: ms, nucleo: n, tema } = useStore();
  const [ind, setInd] = useState(0);
  const [sel, setSel] = useState<number | null>(null);
  const [busca, setBusca] = useState('');
  const I = INDIC[ind];
  const lista = ms?.municipios ?? [];
  const vals = lista.map((m) => m[I.id] as number | null).filter((v): v is number => v != null && isFinite(v)).sort((a, b) => a - b);
  const lo = vals[Math.floor(vals.length * 0.03)] ?? 0, hi = vals[Math.floor(vals.length * 0.97)] ?? 1;
  const cores = useMemo(() => new Map(lista.filter((m) => m[I.id] != null && (m.pop ?? 0) > 0).map((m) => [m.mun, corSeq(((m[I.id] as number) - lo) / (hi - lo || 1))])), [ms, ind, tema]);
  const m = lista.find((x) => x.mun === sel) ?? null;
  const q = busca.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '');
  const ranking = lista.filter((x) => x[I.id] != null && (!q || x.nome.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '').includes(q)))
    .sort((a, b) => (b[I.id] as number) - (a[I.id] as number));
  const nomeMun = (id: number) => lista.find((x) => x.mun === id)?.nome ?? String(id);

  const op = useMemo<EChartsOption | null>(() => {
    if (!m || !ms) return null;
    const b = base(); const acc = lerVar('--accent');
    return {
      animation: false, textStyle: b.textStyle, grid: { left: 40, right: 10, top: 14, bottom: 22 },
      tooltip: { ...b.tooltip, trigger: 'axis', valueFormatter: (v: any) => n0(v) },
      xAxis: { type: 'time', ...b.eixoX }, yAxis: { type: 'value', ...b.eixoY, scale: true },
      series: [{ type: 'bar', name: 'Internações de residentes', data: m.serie.map((v, i) => [parseData(ms.meses[i]).getTime(), v]).slice(0, -1),
        itemStyle: { color: acc, borderRadius: [3, 3, 0, 0] }, barMaxWidth: 10 }],
    };
  }, [m, tema]);

  return (
    <div className="grid fade-in">
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <div className="seg">{INDIC.map((x, i) => <button key={String(x.id)} className={i === ind ? 'on' : ''} onClick={() => setInd(i)}>{x.nome}</button>)}</div>
      </div>
      <div className="grid" style={{ gridTemplateColumns: 'minmax(0, 1.5fr) minmax(300px, 1fr)' }}>
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <Mapa camada="municipios" cores={cores} altura={600} selecionado={sel} onClick={(t, id) => t === 'area' && setSel(id === sel ? null : id)}
            tooltip={(_, id) => { const x = lista.find((y) => y.mun === id); return x && <><b>{x.nome}</b><div className="muted">{n!.regioes.find((r) => r.id === x.regiao)?.nome}</div>
              <div className="row"><span>{I.nome}</span><span>{x[I.id] != null ? I.fmt(x[I.id] as number) : '—'}</span></div>
              <div className="row"><span>População</span><span>{n0(x.pop)}</span></div></>; }}>
            <div className="map-overlay" style={{ left: 12, bottom: 12 }}><LegendaRampa titulo={I.nome} gradiente={gradienteSeq()} ticks={[I.fmt(lo), I.fmt((lo + hi) / 2), I.fmt(hi)]} /></div>
          </Mapa>
        </div>
        <div className="grid" style={{ alignContent: 'start' }}>
          {m ? <div className="card fade-in">
            <div className="card-head"><div><h3>{m.nome}</h3><p className="hint">{n!.regioes.find((r) => r.id === m.regiao)?.nome} · {n0(m.pop)} hab. · {n0(m.pop60)} com 60+</p></div>
              <button className="iconbtn" onClick={() => setSel(null)} aria-label="Fechar">✕</button></div>
            <table className="tbl"><tbody>
              <tr><td>Internações/ano (residentes)</td><td className="r num">{n0(m.n)}</td></tr>
              <tr><td>Taxa bruta /1.000</td><td className="r num">{n1(m.taxa_bruta)}</td></tr>
              <tr><td>Taxa padronizada /1.000</td><td className="r num">{n1(m.taxa_pad)}</td></tr>
              <tr><td>ICSAP (% das internações)</td><td className="r num">{pct((m.icsap ?? 0) / (m.n || 1))}</td></tr>
              <tr><td>Idosos (% das internações)</td><td className="r num">{pct((m.idosos ?? 0) / (m.n || 1))}</td></tr>
              <tr><td>Com UTI</td><td className="r num">{pct((m.uti ?? 0) / (m.n || 1))}</td></tr>
              <tr><td>Óbitos hospitalares</td><td className="r num">{n0(m.obitos)} ({pct((m.obitos ?? 0) / (m.n || 1), 1)})</td></tr>
              <tr><td>Faturamento SUS/ano</td><td className="r num">{m.valor ? reais(m.valor) : '—'}</td></tr>
              <tr><td>Internados fora do município</td><td className="r num">{pct(m.fora_mun)}</td></tr>
            </tbody></table>
            {m.destinos.length > 0 && <><div className="nav-sec" style={{ padding: '10px 0 4px' }}>Principais destinos</div>
              {m.destinos.map(([d, v]) => <div key={d} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, padding: '2px 0' }}><span>{nomeMun(d)}</span><span className="num">{n0(v)}</span></div>)}</>}
            <div className="nav-sec" style={{ padding: '10px 0 4px' }}>Internações mensais, 3 anos</div>
            {op && <Grafico opcao={op} altura={150} />}
          </div> : <div className="callout">{I.desc} Clique num município para ver a ficha.</div>}
          <div className="card" style={{ maxHeight: m ? 300 : 520, display: 'flex', flexDirection: 'column' }}>
            <div className="card-head"><div><h3>Ranking</h3></div><input type="search" placeholder="Buscar…" value={busca} onChange={(e) => setBusca(e.target.value)} /></div>
            <div className="scroll" style={{ flex: 1, margin: '0 -8px' }}>
              <table className="tbl"><tbody>{ranking.map((x, i) => (
                <tr key={x.mun} className={x.mun === sel ? 'sel' : ''} onClick={() => setSel(x.mun)}>
                  <td className="muted num" style={{ width: 30 }}>{i + 1}</td><td>{x.nome}</td><td className="r num">{I.fmt(x[I.id] as number)}</td>
                </tr>))}</tbody></table>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
