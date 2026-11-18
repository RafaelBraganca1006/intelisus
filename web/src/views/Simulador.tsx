import { tx } from '../i18n';
import { useEffect, useMemo, useState } from 'react';
import { Controle, Kpi, SeletorGrupo, Status } from '../components/Controles';
import { Leque } from '../components/Leque';
import { LegendaRampa, Mapa } from '../components/Mapa';
import { pedir } from '../data/carregar';
import { type Cenario, cenarioBase, PRESETS } from '../engine/cenario';
import type { ResultadoSim } from '../engine/simulador';
import { corDiv, corOcupacao, gradienteOcupacao } from '../lib/cores';
import { addDias, dataBR, isoData, n0, n1, parseData, pct, sinal } from '../lib/formato';
import { kDe, useStore } from '../store';

type Res = { cen: ResultadoSim; base: ResultadoSim; ms: number };

export function Simulador() {
  const { nucleo: n, grupo: g, dataRef, sim, set } = useStore();
  const anoRef = Number(n!.meta.data_sync.slice(0, 4));
  const [c, setC] = useState<Cenario>(() => sim?.cenario ?? { ...cenarioBase(g, anoRef), nome: tx("Meu cenário") });
  const [rodando, setRodando] = useState(false);
  const [verMapa, setVerMapa] = useState<'pico' | 'delta'>('pico');
  const [regSel, setRegSel] = useState<number | null>(null);
  const res: Res | null = sim && sim.cenario.grupo === g ? sim : null;
  const k0 = kDe(n!, dataRef);
  const ref = parseData(dataRef);
  const R = n!.regioes.length;

  useEffect(() => { setC((x) => ({ ...x, grupo: g })); }, [g]);

  const rodar = async (cc: Cenario = c) => {
    setRodando(true);
    const b = { ...cenarioBase(cc.grupo, anoRef), dias: cc.dias, execucoes: cc.execucoes };
    const r = await pedir<Res>({ tipo: 'simular', cenario: cc, base: b, inicioK: k0, semente: 42 });
    set({ sim: { ...r, cenario: cc } });
    setRodando(false);
  };
  useEffect(() => { if (!res) rodar(); }, []);

  const up = (p: Partial<Cenario>) => setC((x) => ({ ...x, ...p }));
  const upResp = (p: Partial<Cenario['resp']>) => setC((x) => ({ ...x, resp: { ...x.resp, ...p } }));
  const upLeitos = (p: Partial<Cenario['leitos']>) => setC((x) => ({ ...x, leitos: { ...x.leitos, ...p } }));

  const leque = useMemo(() => {
    if (!res) return null;
    const H = res.cen.dias;
    const datas = Array.from({ length: H }, (_, t) => addDias(ref, t + 1));
    const q = (r: ResultadoSim) => regSel == null ? r.estado : r.q[regSel];
    const capB = regSel == null ? res.base.capacidade.reduce((a, b) => a + b, 0) : res.base.capacidade[regSel];
    return {
      datasObs: [], completo: [], datasPrev: datas, media: q(res.base).p50, q: q(res.base),
      cenario: { ...q(res.cen), nome: res.cen === res.base ? tx("Cenário") : (sim?.cenario.nome ?? tx("Cenário")) }, capacidade: capB,
    };
  }, [res, regSel]);

  const cores = useMemo(() => {
    const m = new Map<number, string>();
    if (!res) return m;
    n!.regioes.forEach((r, i) => {
      if (res.cen.capacidade[i] <= 0) return;
      if (verMapa === 'pico') m.set(r.id, corOcupacao(res.cen.metricas.picoOcup[i] / 100));
      else m.set(r.id, corDiv((res.cen.metricas.picoOcup[i] - res.base.metricas.picoOcup[i]) / 25));
    });
    return m;
  }, [res, verMapa]);

  const M = res?.cen.metricas, B = res?.base.metricas;
  const soma = (a: number[]) => a.reduce((x, y) => x + y, 0);
  const ranking = useMemo(() => {
    if (!res) return [];
    return n!.regioes.map((r, i) => ({ r, i, pb: res.base.metricas.picoOcup[i], pc: res.cen.metricas.picoOcup[i],
      db: res.base.metricas.diasAcima100[i], dc: res.cen.metricas.diasAcima100[i],
      env: res.cen.metricas.enviadasPorRegiao[i], rec: res.cen.metricas.transfPorRegiao[i], cap: res.cen.capacidade[i] }))
      .filter((x) => x.cap >= 5).sort((a, b) => b.pc - a.pc);
  }, [res]);

  const picoData = addDias(ref, c.resp.picoDia);
  return (
    <div className="grid fade-in" style={{ gridTemplateColumns: '330px minmax(0, 1fr)', alignItems: 'start' }}>
      <div className="card" style={{ position: 'sticky', top: 0 }}>
        <h3>{tx("Cenários prontos")}</h3>
        <p className="hint">{tx("Comece por um cenário e ajuste as alavancas.")}</p>
        <div className="grid" style={{ gap: 6 }}>
          {PRESETS.map((pr) => (
            <button key={pr.id} className="preset" onClick={() => { const nc = pr.aplicar({ ...cenarioBase(g, anoRef), dias: c.dias, execucoes: c.execucoes }); setC(nc); rodar(nc); }}>
              <b>{pr.nome}</b><span>{pr.descricao}</span>
            </button>
          ))}
        </div>
        <div style={{ marginTop: 14 }}>
          <div className="nav-sec" style={{ padding: '6px 0' }}>{tx("Horizonte")}</div>
          <Controle rotulo={tx("Dias simulados")} valor={tx("{0} dias · até {1}", c.dias, dataBR(addDias(ref, c.dias)))}>
            <input type="range" min={30} max={365} step={15} value={c.dias} onChange={(e) => up({ dias: +e.target.value })} />
          </Controle>
          <div className="nav-sec" style={{ padding: '10px 0 0' }}>{tx("Demanda")}</div>
          <Controle rotulo={tx("Onda respiratória")} valor={c.resp.intensidade ? tx('+{0}% no pico', c.resp.intensidade) : tx("desligada")}
            desc={tx("Aumenta as internações por CID respiratório (J00–J22, U04/U07) em cada região, na proporção que elas têm no grupo.")}>
            <input type="range" min={0} max={300} step={10} value={c.resp.intensidade} onChange={(e) => upResp({ intensidade: +e.target.value })} />
            {c.resp.intensidade > 0 && <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
              <label className="d">{tx("Pico em")}<input type="date" value={isoData(picoData)} min={isoData(ref)} max={isoData(addDias(ref, c.dias))} style={{ width: '100%' }}
                onChange={(e) => e.target.value && upResp({ picoDia: Math.round((parseData(e.target.value).getTime() - ref.getTime()) / 864e5) })} /></label>
              <label className="d">{tx("Largura (sem.)")}<input type="number" min={1} max={20} value={c.resp.larguraSem} style={{ width: '100%' }} onChange={(e) => upResp({ larguraSem: Math.max(1, +e.target.value) })} /></label>
              <label className="d" style={{ gridColumn: 'span 2' }}>{tx("Abrangência")}
                <select value={c.resp.drs ?? ''} style={{ width: '100%' }} onChange={(e) => upResp({ drs: e.target.value || null })}>
                  <option value="">{tx("Todo o estado")}</option>{n!.drs.map((d) => <option key={d.id} value={d.id}>{tx("DRS")} {d.nome}</option>)}
                </select></label>
            </div>}
          </Controle>
          <Controle rotulo={tx("Choque geral de demanda")} valor={`${sinal(c.demandaPct)}%`} desc={tx("Ex.: fechamento de serviço vizinho, evento de massa.")}>
            <input type="range" min={-20} max={40} step={1} value={c.demandaPct} onChange={(e) => up({ demandaPct: +e.target.value })} />
          </Controle>
          <Controle rotulo={tx("Envelhecimento populacional")} valor={c.anoDemografia === anoRef ? tx("população atual") : tx("população de {0}", c.anoDemografia)}
            desc={tx("Taxas atuais por idade e município de residência × Projeção IBGE 2024.")}>
            <input type="range" min={anoRef} max={2045} step={1} value={c.anoDemografia} onChange={(e) => up({ anoDemografia: +e.target.value })} />
          </Controle>
          <div className="nav-sec" style={{ padding: '10px 0 0' }}>{tx("Atenção primária e gestão do cuidado")}</div>
          <Controle rotulo={tx("Redução de ICSAP")} valor={`−${c.icsapPct}%`} desc={tx("Internações sensíveis à atenção primária evitadas por APS mais resolutiva.")}>
            <input type="range" min={0} max={50} step={5} value={c.icsapPct} onChange={(e) => up({ icsapPct: +e.target.value })} />
          </Controle>
          <Controle rotulo={tx("Redução da permanência")} valor={`−${c.permanenciaPct}%`} desc={tx("Gestão de altas, atenção domiciliar (a DiD estimou −3,5% com EMAD), leitos de retaguarda.")}>
            <input type="range" min={0} max={25} step={1} value={c.permanenciaPct} onChange={(e) => up({ permanenciaPct: +e.target.value })} />
          </Controle>
          <div className="nav-sec" style={{ padding: '10px 0 0' }}>{tx("Oferta")}</div>
          <Controle rotulo={tx("Leitos")} valor={`${sinal(c.leitos.delta)}${c.leitos.modo === 'pct' ? '%' : ' leitos'}`}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
              <select value={c.leitos.escopo === 'estado' ? 'estado' : `${c.leitos.escopo}:${c.leitos.id}`} onChange={(e) => {
                const v = e.target.value;
                if (v === 'estado') upLeitos({ escopo: 'estado', id: null });
                else if (v.startsWith('drs:')) upLeitos({ escopo: 'drs', id: v.slice(4) });
                else upLeitos({ escopo: 'regiao', id: Number(v.slice(7)) });
              }}>
                <option value="estado">{tx("Todo o estado")}</option>
                <optgroup label={tx("DRS")}>{n!.drs.map((d) => <option key={d.id} value={`drs:${d.id}`}>{d.nome}</option>)}</optgroup>
                <optgroup label={tx("Região")}>{n!.regioes.map((r) => <option key={r.id} value={`regiao:${r.id}`}>{r.nome}</option>)}</optgroup>
              </select>
              <select value={c.leitos.modo} onChange={(e) => upLeitos({ modo: e.target.value as 'pct' | 'abs', delta: 0 })}>
                <option value="pct">{tx("em %")}</option><option value="abs">{tx("em leitos")}</option>
              </select>
            </div>
            <input type="range" min={c.leitos.modo === 'pct' ? -30 : -200} max={c.leitos.modo === 'pct' ? 50 : 500} step={c.leitos.modo === 'pct' ? 1 : 10}
              value={c.leitos.delta} onChange={(e) => upLeitos({ delta: +e.target.value })} />
          </Controle>
          <div className="nav-sec" style={{ padding: '10px 0 0' }}>{tx("Regulação")}</div>
          <Controle rotulo={tx("Transferência entre regiões")} valor={c.regulacao === 'nenhuma' ? tx("atual") : c.regulacao === 'drs' ? tx("no DRS") : tx("estadual")}
            desc={tx("Novas internações acima do gatilho vão para a região mais próxima abaixo do alvo, dentro do raio.")}>
            <div className="seg">
              {(['nenhuma', 'drs', 'estado'] as const).map((r) => <button key={r} className={c.regulacao === r ? 'on' : ''} onClick={() => up({ regulacao: r })}>{r === 'nenhuma' ? tx("Sem regra") : r === 'drs' ? tx("No DRS") : tx("Estadual")}</button>)}
            </div>
            {c.regulacao !== 'nenhuma' && <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6 }}>
              <label className="d">{tx("Gatilho")}<input type="number" min={70} max={120} value={Math.round(c.gatilho * 100)} style={{ width: '100%' }} onChange={(e) => up({ gatilho: +e.target.value / 100 })} /></label>
              <label className="d">{tx("Alvo")}<input type="number" min={50} max={100} value={Math.round(c.alvo * 100)} style={{ width: '100%' }} onChange={(e) => up({ alvo: +e.target.value / 100 })} /></label>
              <label className="d">{tx("Raio km")}<input type="number" min={30} max={800} step={10} value={c.raioKm} style={{ width: '100%' }} onChange={(e) => up({ raioKm: +e.target.value })} /></label>
            </div>}
          </Controle>
        </div>
        <button className="btn primary" style={{ width: '100%', justifyContent: 'center', marginTop: 10, padding: 10 }} disabled={rodando} onClick={() => rodar()}>
          {rodando ? 'Simulando…' : tx("Rodar simulação · {0} execuções", c.execucoes)}
        </button>
        <button className="btn" style={{ width: '100%', justifyContent: 'center', marginTop: 6 }} onClick={() => { const nc = { ...cenarioBase(g, anoRef), dias: c.dias, nome: tx("Meu cenário") }; setC(nc); }}>{tx("Zerar alavancas")}</button>
      </div>

      <div className="grid">
        {!res ? <div className="card loading" style={{ height: 400 }}><div><div className="spinner" style={{ margin: 'auto' }} /><p>{tx("Simulando")} {c.execucoes} {tx("futuros possíveis…")}</p></div></div> : (<>
          <div className="callout">
            <b>{sim?.cenario.nome}</b> · {n!.grupos[g].nome} · {res.cen.dias} {tx("dias a partir de")} {dataBR(ref)} · {sim?.cenario.execucoes} {tx("execuções Monte Carlo com números aleatórios comuns (base e cenário veem os mesmos \"futuros\"), em")} {n0(res.ms)} {tx("ms. As diferenças são efeito das alavancas, não de sorteio.")}
          </div>
          <div className="kpis">
            <Kpi lbl={tx("Pacientes-dia acima da capacidade")} val={n0(M!.pacDiasExcesso)} det={<>{tx("base")} {n0(B!.pacDiasExcesso)} · <b>{sinal(M!.pacDiasExcesso - B!.pacDiasExcesso)}</b> {tx("· P90")} {n0(M!.pacDiasExcessoP90)}</>}
              extra={<Status nivel={M!.pacDiasExcesso <= B!.pacDiasExcesso ? 'good' : 'serious'} texto={M!.pacDiasExcesso <= B!.pacDiasExcesso ? tx("melhora") : tx("piora")} />} />
            <Kpi lbl={tx("Região-dias com lotação ≥100%")} val={n0(soma(M!.diasAcima100))} det={<>{tx("base")} {n0(soma(B!.diasAcima100))} · {sinal(soma(M!.diasAcima100) - soma(B!.diasAcima100))}</>} />
            <Kpi lbl={tx("Pico estadual (mediana)")} val={pct(Math.max(...res.cen.estado.p50) / res.cen.capacidade.reduce((a, b) => a + b, 0), 1)}
              det={<>{tx("base")} {pct(Math.max(...res.base.estado.p50) / res.base.capacidade.reduce((a, b) => a + b, 0), 1)}</>} />
            <Kpi lbl={tx("Transferências reguladas")} val={n0(M!.transferencias)} det={M!.transferencias ? <>{n0(M!.kmTotal / Math.max(M!.transferencias, 1))} {tx("km em média ·")} {n0(M!.kmTotal)} {tx("km no total")}</> : tx("regulação adicional desligada")} />
            <Kpi lbl={tx("P(estado > 95%)")} val={pct(M!.probColapso)} det={<>{tx("em algum dia · base")} {pct(B!.probColapso)}</>} />
            <Kpi lbl={tx("Entradas no período")} val={n0(M!.entradas)} det={<>{sinal(((M!.entradas - B!.entradas) / B!.entradas) * 100, n1)}{tx("% vs base")}</>} />
          </div>
          <div className="card">
            <div className="card-head"><div>
              <h3>{regSel == null ? tx("Estado de São Paulo") : n!.regioes[regSel].nome} {tx("· base × cenário")}</h3>
              <p className="hint">{tx("Mediana e faixa P10–P90 das execuções. Clique numa região no mapa ou na tabela para ver só ela.")}</p></div>
              {regSel != null && <button className="btn" onClick={() => setRegSel(null)}>{tx("Ver estado")}</button>}
            </div>
            {leque && <Leque d={leque} altura={320} taxa />}
          </div>
          <div className="grid" style={{ gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)' }}>
            <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
              <Mapa camada="regioes" cores={cores} altura={440} selecionado={regSel == null ? null : n!.regioes[regSel].id}
                onClick={(t, id) => { if (t === 'area') { const i = n!.regioes.findIndex((r) => r.id === id); setRegSel(i === regSel ? null : i); } }}
                tooltip={(_, id) => {
                  const i = n!.regioes.findIndex((r) => r.id === id);
                  return <><b>{n!.regioes[i].nome}</b>
                    <div className="row"><span>{tx("Pico base (P50)")}</span><span>{pct(res.base.metricas.picoOcup[i] / 100)}</span></div>
                    <div className="row"><span>{tx("Pico cenário (P50)")}</span><span>{pct(res.cen.metricas.picoOcup[i] / 100)}</span></div>
                    <div className="row"><span>{tx("Dias ≥100% (cenário)")}</span><span>{n1(res.cen.metricas.diasAcima100[i])}</span></div>
                    <div className="row"><span>{tx("Enviadas / recebidas")}</span><span>{n0(res.cen.metricas.enviadasPorRegiao[i])} / {n0(res.cen.metricas.transfPorRegiao[i])}</span></div></>;
                }}>
                <div className="map-overlay" style={{ left: 12, top: 12 }}>
                  <div className="seg"><button className={verMapa === 'pico' ? 'on' : ''} onClick={() => setVerMapa('pico')}>{tx("Pico no cenário")}</button><button className={verMapa === 'delta' ? 'on' : ''} onClick={() => setVerMapa('delta')}>{tx("Δ vs base")}</button></div>
                </div>
                <div className="map-overlay" style={{ left: 12, bottom: 12 }}>
                  {verMapa === 'pico' ? <LegendaRampa titulo={tx("Pico de ocupação (P50)")} gradiente={gradienteOcupacao()} ticks={['45%', '65%', '85%', '100%', '115%']} />
                    : <LegendaRampa titulo={tx("Δ pico (p.p.) vs base")} gradiente={`linear-gradient(90deg, ${[-1, -0.5, 0, 0.5, 1].map((x) => corDiv(x)).join(',')})`} ticks={['−25', '', '0', '', '+25']} />}
                </div>
              </Mapa>
            </div>
            <div className="card" style={{ maxHeight: 442, display: 'flex', flexDirection: 'column' }}>
              <h3>{tx("Regiões por pico no cenário")}</h3>
              <div className="scroll" style={{ flex: 1, margin: '6px -8px 0' }}>
                <table className="tbl">
                  <thead><tr><th>{tx("Região")}</th><th className="r">{tx("Pico base")}</th><th className="r">{tx("Pico cen.")}</th><th className="r">{tx("Dias ≥100%")}</th><th className="r">{tx("Transf.")}</th></tr></thead>
                  <tbody>{ranking.map((x) => (
                    <tr key={x.r.id} className={regSel === x.i ? 'sel' : ''} onClick={() => setRegSel(x.i === regSel ? null : x.i)}>
                      <td>{x.r.nome}<div className="muted" style={{ fontSize: 11 }}>{n0(x.cap)} {tx("leitos")}</div></td>
                      <td className="r num muted">{pct(x.pb / 100)}</td>
                      <td className="r num"><span style={{ display: 'inline-flex', gap: 5, alignItems: 'center' }}><i className="swatch" style={{ background: corOcupacao(x.pc / 100) }} />{pct(x.pc / 100)}</span></td>
                      <td className="r num">{n1(x.dc)} <span className="muted">({sinal(x.dc - x.db, n1)})</span></td>
                      <td className="r num">{x.env || x.rec ? `${n0(x.env)}↑ ${n0(x.rec)}↓` : '—'}</td>
                    </tr>))}</tbody>
                </table>
              </div>
            </div>
          </div>
        </>)}
      </div>
      {R < 0 && null}
    </div>
  );
}
