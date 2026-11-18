import { tx } from '../i18n';
import type { EChartsOption } from 'echarts';
import { useMemo, useState } from 'react';
import { Controle, Kpi } from '../components/Controles';
import { Grafico } from '../components/Grafico';
import { Mapa } from '../components/Mapa';
import { corGrupo, corSeq, gradienteSeq, lerVar } from '../lib/cores';
import { n0, pct } from '../lib/formato';
import { base } from '../lib/tema-graf';
import { LegendaRampa } from '../components/Mapa';
import { useStore } from '../store';

/** Curva quadrática entre dois pontos (arco levemente curvado para a direita do sentido). */
function arco(a: [number, number], b: [number, number], n = 18): [number, number][] {
  const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const c: [number, number] = [mx - dy * 0.22, my + dx * 0.22];
  return Array.from({ length: n + 1 }, (_, i) => {
    const t = i / n;
    return [(1 - t) ** 2 * a[0] + 2 * (1 - t) * t * c[0] + t * t * b[0], (1 - t) ** 2 * a[1] + 2 * (1 - t) * t * c[1] + t * t * b[1]];
  });
}

export function Fluxos() {
  const { nucleo: n, fluxos: f, municipios: ms, tema, escopo, set } = useStore();
  const G = n!.grupos.length;
  const [gSel, setG] = useState<number>(G); // G = todos
  const [minimo, setMinimo] = useState(150);
  const [munSel, setMunSel] = useState<number | null>(null);
  const [indic, setIndic] = useState<'fora_mun' | 'fora_reg'>('fora_mun');
  const mun = useMemo(() => new Map((ms?.municipios ?? []).map((m) => [m.mun, m])), [ms]);

  const linhas = useMemo<GeoJSON.FeatureCollection | null>(() => {
    if (!f || !ms) return null;
    const cor = gSel < G ? corGrupo(gSel) : lerVar('--s2');
    const arr = f.arestas.map(([o, d, tot, pg]) => ({ o, d, v: gSel < G ? pg[gSel] : tot }))
      .filter((a) => (munSel ? a.o === munSel || a.d === munSel : a.v >= minimo) && a.v > 0);
    const mx = Math.max(1, ...arr.map((a) => a.v));
    return {
      type: 'FeatureCollection', features: arr.slice(0, 1500).map((a) => {
        const A = mun.get(a.o), B = mun.get(a.d);
        if (!A || !B) return null;
        const saida = munSel != null && a.o === munSel;
        return { type: 'Feature', geometry: { type: 'LineString', coordinates: arco([A.lon, A.lat], [B.lon, B.lat]) },
          properties: { w: 0.6 + 5.5 * Math.sqrt(a.v / mx), cor: munSel == null ? cor : saida ? lerVar('--s2') : lerVar('--s3'), op: 0.7 } };
      }).filter(Boolean) as GeoJSON.Feature[],
    };
  }, [f, ms, gSel, minimo, munSel, tema]);

  const cores = useMemo(() => {
    const m = new Map<number, string>();
    for (const x of ms?.municipios ?? []) { const v = x[indic]; if (v != null) m.set(x.mun, corSeq(v / (indic === 'fora_mun' ? 1 : 0.6))); }
    return m;
  }, [ms, indic, tema]);

  const regStats = useMemo(() => {
    if (!f) return [];
    const M = f.matriz[gSel];
    return n!.regioes.map((r, i) => {
      const saem = M[i].reduce((a, b) => a + b, 0);
      const chegam = M.reduce((s, row) => s + row[i], 0);
      const proprio = M[i][i];
      let topD = -1, topV = 0;
      M[i].forEach((v, j) => { if (j !== i && v > topV) { topV = v; topD = j; } });
      return { r, i, autos: saem ? proprio / saem : NaN, atracao: chegam ? (chegam - proprio) / chegam : NaN, saldo: chegam - saem, saem, chegam,
        top: topD >= 0 ? n!.regioes[topD].nome : '—', topV };
    }).sort((a, b) => a.autos - b.autos);
  }, [f, gSel]);

  const tot = useMemo(() => {
    if (!f) return null;
    const M = f.matriz[gSel];
    let t = 0, diag = 0, drsDiag = 0;
    M.forEach((row, i) => row.forEach((v, j) => { t += v; if (i === j) diag += v; if (n!.regioes[i].drs === n!.regioes[j].drs) drsDiag += v; }));
    const foraMun = (ms?.municipios ?? []).reduce((s, m) => s + (m.fora_mun ?? 0) * (m.n ?? 0), 0) / Math.max(1, (ms?.municipios ?? []).reduce((s, m) => s + (m.n ?? 0), 0));
    return { t, foraReg: 1 - diag / t, foraDrs: 1 - drsDiag / t, foraMun };
  }, [f, gSel, ms]);

  const opSankey = useMemo<EChartsOption | null>(() => {
    if (!f) return null;
    const b = base();
    const M = f.matriz[gSel];
    const D = n!.drs;
    const mat = D.map(() => D.map(() => 0));
    M.forEach((row, i) => row.forEach((v, j) => { const a = D.findIndex((d) => d.id === n!.regioes[i].drs), c = D.findIndex((d) => d.id === n!.regioes[j].drs); if (a !== c) mat[a][c] += v; }));
    const links: any[] = [];
    mat.forEach((row, a) => row.forEach((v, c) => { if (v >= 120) links.push({ source: `${D[a].nome} ·`, target: `→ ${D[c].nome}`, value: v }); }));
    const nomes = new Set(links.flatMap((l) => [l.source, l.target]));
    const acc = lerVar('--accent');
    return {
      animation: false, textStyle: b.textStyle, tooltip: { ...b.tooltip, formatter: (p: any) => p.dataType === 'edge' ? tx("{0} → {1}<br/><b>{2}</b> internações/ano", p.data.source.replace(' ·', ''), p.data.target.replace('→ ', ''), n0(p.data.value)) : `${p.name.replace(' ·', '').replace('→ ', '')}: ${n0(p.value)}` },
      series: [{ type: 'sankey', left: 8, right: 8, top: 8, bottom: 8, nodeWidth: 10, nodeGap: 7, draggable: false, layoutIterations: 64,
        data: [...nomes].map((nm) => ({ name: nm, itemStyle: { color: nm.startsWith('→') ? lerVar('--s3') : acc, borderWidth: 0 } })),
        links, label: { color: b.t2, fontSize: 10.5 }, lineStyle: { color: 'gradient', opacity: 0.28, curveness: 0.5 },
        emphasis: { focus: 'adjacency', lineStyle: { opacity: 0.6 } } }],
    };
  }, [f, gSel, tema]);

  const sel = munSel ? mun.get(munSel) : null;
  const ligacoes = useMemo(() => {
    if (!f || !munSel) return null;
    const saidas = f.arestas.filter((a) => a[0] === munSel).map((a) => ({ m: a[1], v: gSel < G ? a[3][gSel] : a[2] })).filter((x) => x.v > 0).sort((a, b) => b.v - a.v).slice(0, 8);
    const entradas = f.arestas.filter((a) => a[1] === munSel).map((a) => ({ m: a[0], v: gSel < G ? a[3][gSel] : a[2] })).filter((x) => x.v > 0).sort((a, b) => b.v - a.v).slice(0, 8);
    return { saidas, entradas };
  }, [f, munSel, gSel]);

  return (
    <div className="grid fade-in">
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <div className="seg">
          <button className={gSel === G ? 'on' : ''} onClick={() => setG(G)}>{tx("Todos os leitos")}</button>
          {n!.grupos.map((g, i) => <button key={g.id} className={gSel === i ? 'on' : ''} onClick={() => setG(i)}><i className="swatch" style={{ background: corGrupo(i) }} />{g.nome}</button>)}
        </div>
      </div>
      {tot && <div className="kpis">
        <Kpi lbl={tx("Internações em 12 meses")} val={n0(tot.t)} det={tx("residentes em SP, SIH/SUS")} />
        <Kpi lbl={tx("Fora do município")} val={pct(tot.foraMun)} det={tx("internados em outro município (todos os leitos)")} />
        <Kpi lbl={tx("Fora da região de saúde")} val={pct(tot.foraReg)} det={tx("evasão entre as 63 regiões")} />
        <Kpi lbl={tx("Fora do DRS")} val={pct(tot.foraDrs)} det={tx("atravessam o departamento regional")} />
      </div>}
      <div className="grid" style={{ gridTemplateColumns: 'minmax(0, 1.6fr) minmax(300px, 1fr)' }}>
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <Mapa camada="municipios" cores={cores} linhas={linhas} animarLinhas altura={600} selecionado={munSel}
            onClick={(t, id) => { if (t === 'area') setMunSel(munSel === id ? null : id); }}
            tooltip={(_, id) => {
              const m = mun.get(id); if (!m) return null;
              return <><b>{m.nome}</b><div className="muted">{n!.regioes.find((r) => r.id === m.regiao)?.nome}</div>
                <div className="row"><span>{tx("Internações/ano")}</span><span>{n0(m.n)}</span></div>
                <div className="row"><span>{tx("Fora do município")}</span><span>{pct(m.fora_mun)}</span></div>
                <div className="row"><span>{tx("Fora da região")}</span><span>{pct(m.fora_reg)}</span></div></>;
            }}>
            <div className="map-overlay legend" style={{ left: 12, top: 12, width: 260 }}>
              {munSel == null ? <Controle rotulo={tx("Fluxo mínimo exibido")} valor={tx("{0} internações/ano", n0(minimo))}>
                <input type="range" min={20} max={1500} step={10} value={minimo} onChange={(e) => setMinimo(+e.target.value)} />
              </Controle> : <div style={{ fontSize: 12 }}>
                <b style={{ color: 'var(--text-1)' }}>{sel?.nome}</b>: <span style={{ color: 'var(--s2)' }}>{tx("━ saídas")}</span> · <span style={{ color: 'var(--s3)' }}>{tx("━ chegadas")}</span>
                <button className="btn" style={{ marginTop: 6 }} onClick={() => setMunSel(null)}>{tx("Limpar seleção")}</button></div>}
              <div className="seg" style={{ marginTop: 6 }}>
                <button className={indic === 'fora_mun' ? 'on' : ''} onClick={() => setIndic('fora_mun')}>{tx("% fora do município")}</button>
                <button className={indic === 'fora_reg' ? 'on' : ''} onClick={() => setIndic('fora_reg')}>{tx("% fora da região")}</button>
              </div>
            </div>
            <div className="map-overlay" style={{ left: 12, bottom: 12 }}>
              <LegendaRampa titulo={indic === 'fora_mun' ? tx("Residentes internados fora do município") : tx("Residentes internados fora da região")} gradiente={gradienteSeq()} ticks={indic === 'fora_mun' ? ['0%', '50%', '100%'] : ['0%', '30%', '60%+']} />
            </div>
          </Mapa>
        </div>
        <div className="grid" style={{ alignContent: 'start' }}>
          {sel && ligacoes ? (
            <div className="card fade-in">
              <h3>{sel.nome}</h3>
              <p className="hint">{n0(sel.n)} {tx("internações de residentes/ano ·")} {pct(sel.fora_mun)} {tx("fora do município")}</p>
              <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                {(['saidas', 'entradas'] as const).map((k) => (
                  <div key={k}>
                    <div className="nav-sec" style={{ padding: '0 0 6px' }}>{k === 'saidas' ? tx("Para onde vão") : tx("De onde vêm")}</div>
                    {ligacoes[k].map((x) => {
                      const mx = ligacoes[k][0]?.v ?? 1;
                      return <div key={x.m} style={{ marginBottom: 6, fontSize: 12 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>{mun.get(x.m)?.nome ?? x.m}</span><span className="num">{n0(x.v)}</span></div>
                        <div className="bar-inline"><i style={{ width: `${(x.v / mx) * 100}%`, background: k === 'saidas' ? 'var(--s2)' : 'var(--s3)' }} /></div>
                      </div>;
                    })}
                    {!ligacoes[k].length && <span className="muted">—</span>}
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="callout">{tx("Clique num município para ver de onde vêm e para onde vão os seus pacientes. Os arcos se movem no sentido origem → destino e a largura é proporcional ao volume anual.")}</div>
          )}
          <div className="card">
            <h3>{tx("Trocas entre DRS")}</h3>
            <p className="hint">{tx("Internações/ano que cruzam o departamento regional (≥120). À esquerda, a residência; à direita, onde a pessoa foi internada.")}</p>
            {opSankey && <Grafico opcao={opSankey} altura={430} />}
          </div>
        </div>
      </div>
      <div className="card">
        <h3>{tx("Autossuficiência e atração das regiões de saúde")}</h3>
        <p className="hint">{tx("Autossuficiência = % dos residentes internados na própria região. Atração = % dos pacientes da região que vêm de fora. Ordenado da menos para a mais autossuficiente. Clique para selecionar a região no painel.")}</p>
        <div className="scroll" style={{ maxHeight: 420 }}>
          <table className="tbl">
            <thead><tr><th>{tx("Região")}</th><th>{tx("DRS")}</th><th>{tx("Autossuficiência")}</th><th>{tx("Atração")}</th><th className="r">{tx("Saldo")}</th><th>{tx("Principal destino dos residentes")}</th></tr></thead>
            <tbody>{regStats.map((x) => (
              <tr key={x.r.id} className={escopo.tipo === 'regiao' && escopo.id === x.r.id ? 'sel' : ''} onClick={() => set({ escopo: { tipo: 'regiao', id: x.r.id } })}>
                <td style={{ fontWeight: 500 }}>{x.r.nome}</td>
                <td className="muted">{n!.drs.find((d) => d.id === x.r.drs)?.nome}</td>
                <td><div style={{ display: 'flex', gap: 8, alignItems: 'center' }}><div className="bar-inline" style={{ flex: 1 }}><i style={{ width: `${x.autos * 100}%`, background: 'var(--accent)' }} /></div><span className="num" style={{ width: 38 }}>{pct(x.autos)}</span></div></td>
                <td><div style={{ display: 'flex', gap: 8, alignItems: 'center' }}><div className="bar-inline" style={{ flex: 1 }}><i style={{ width: `${x.atracao * 100}%`, background: 'var(--s3)' }} /></div><span className="num" style={{ width: 38 }}>{pct(x.atracao)}</span></div></td>
                <td className="r num" style={{ color: x.saldo > 0 ? 'var(--text-1)' : 'var(--text-2)' }}>{x.saldo > 0 ? '+' : ''}{n0(x.saldo)}</td>
                <td className="muted">{x.top} <span className="num">({n0(x.topV)})</span></td>
              </tr>))}</tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
