import { Component, type ReactNode, useEffect, useLayoutEffect } from 'react';
import { SeletorEscopo } from './components/Controles';
import { I } from './components/Icones';
import { carregarTudo } from './data/carregar';
import { dataBR, parseData } from './lib/formato';
import { useStore, type Vista } from './store';
import { Fluxos } from './views/Fluxos';
import { Hospitais } from './views/Hospitais';
import { Metodologia } from './views/Metodologia';
import { Municipios } from './views/Municipios';
import { Planejamento } from './views/Planejamento';
import { Panorama } from './views/Panorama';
import { Previsao } from './views/Previsao';
import { Simulador } from './views/Simulador';

const VISTAS: { id: Vista; nome: string; sec: string; sub: string; el: () => ReactNode }[] = [
  { id: 'panorama', nome: 'Panorama', sec: 'Monitorar', sub: 'A rede no último dia com dados. Escolha uma data futura para ver a previsão.', el: () => <Panorama /> },
  { id: 'previsao', nome: 'Previsão', sec: 'Monitorar', sub: 'Ocupação esperada por dia com intervalos calibrados em backtest', el: () => <Previsao /> },
  { id: 'simulador', nome: 'Simulador de cenários', sec: 'Decidir', sub: 'E se? Monte Carlo sobre o estado atual do gêmeo', el: () => <Simulador /> },
  { id: 'fluxos', nome: 'Fluxos e regulação', sec: 'Decidir', sub: 'De onde vêm e para onde vão os pacientes internados', el: () => <Fluxos /> },
  { id: 'planejamento', nome: 'Planejamento 2045', sec: 'Planejar', sub: 'Leitos necessários com o envelhecimento da população', el: () => <Planejamento /> },
  { id: 'hospitais', nome: 'Hospitais', sec: 'Explorar', sub: 'Ocupação, porte e atração de cada estabelecimento', el: () => <Hospitais /> },
  { id: 'municipios', nome: 'Municípios', sec: 'Explorar', sub: 'Taxas de internação dos residentes, padronizadas por idade', el: () => <Municipios /> },
  { id: 'metodologia', nome: 'Validação e método', sec: 'Confiar', sub: 'Como o gêmeo funciona e quanto ele erra', el: () => <Metodologia /> },
];

class Protecao extends Component<{ children: ReactNode }, { erro: string | null }> {
  state = { erro: null as string | null };
  static getDerivedStateFromError(e: Error) { return { erro: e.message }; }
  render() {
    if (this.state.erro) return <div className="callout">Algo falhou nesta vista: <b>{this.state.erro}</b>. <button className="btn" onClick={() => this.setState({ erro: null })}>Tentar de novo</button></div>;
    return this.props.children;
  }
}

export function App() {
  const { nucleo, vista, tema, dataRef, railMini, set } = useStore();
  useEffect(() => { carregarTudo().catch((e) => console.error(e)); }, []);
  useLayoutEffect(() => { // antes dos efeitos do mapa, que leem as cores do tema ao criar o estilo
    document.documentElement.dataset.theme = tema;
    try { localStorage.setItem('gemeo-tema', tema); } catch { /* sem storage */ }
  }, [tema]);
  useEffect(() => { try { localStorage.setItem('gemeo-rail', railMini ? 'mini' : 'aberta'); } catch { /* sem storage */ } }, [railMini]);
  useEffect(() => { history.replaceState(null, '', `#${vista}`); }, [vista]);

  if (!nucleo) return <div className="loading"><div><div className="spinner" style={{ margin: '0 auto 14px' }} />Sincronizando o InteliSUS…</div></div>;
  const bleed = vista === 'panorama'; // mapa em tela cheia, sem barra superior
  const v = VISTAS.find((x) => x.id === vista) ?? VISTAS[0];
  const secs = [...new Set(VISTAS.map((x) => x.sec))];
  const sync = parseData(nucleo.meta.data_sync);
  return (
    <div className={`shell ${railMini ? 'mini' : ''}`}>
      <nav className="rail" aria-label="Navegação">
        <div className="brand">
          <div className="brand-txt"><h1>{railMini ? 'IS' : 'InteliSUS'}</h1></div>
          <button className="ghost rail-toggle" aria-label={railMini ? 'Expandir menu' : 'Recolher menu'} title={railMini ? 'Expandir menu' : 'Recolher menu'} onClick={() => set({ railMini: !railMini })}>{I.seta}</button>
        </div>
        {secs.map((s) => (
          <div key={s} style={{ display: 'contents' }}>
            <div className="nav-sec">{s}</div>
            {VISTAS.filter((x) => x.sec === s).map((x) => (
              <button key={x.id} title={x.nome} className={`nav-item ${x.id === vista ? 'on' : ''}`} onClick={() => set({ vista: x.id })}>
                {I[x.id]}<span>{x.nome}</span>
              </button>
            ))}
          </div>
        ))}
        <div className="rail-foot">
          SIH/SUS até comp. {String(nucleo.meta.competencia).replace(/(\d{4})(\d{2})/, '$2/$1')} · CNES {String(nucleo.meta.competencia_cnes).replace(/(\d{4})(\d{2})/, '$2/$1')}<br />
          Modelo atualizado em {dataBR(new Date(nucleo.meta.gerado_em + 'Z'))}
        </div>
      </nav>
      <main className="main">
        {!bleed && <header className="topbar">
          <div>
            <h2>{v.nome}</h2>
            <div className="sub">{v.sub}</div>
          </div>
          <div className="spacer" />
          <span className="pill" title="Último dia com censo ≥97% faturado; depois disso o gêmeo propaga o estado até a data de referência">
            <span className="dot pulse" /> Sincronizado em {dataBR(sync)}
          </span>
          {dataRef !== nucleo.meta.data_sync && (
            <button className="btn" onClick={() => set({ dataRef: nucleo.meta.data_sync })} title="Voltar ao último dia com dados">Último dado</button>
          )}
          <label className="pill" style={{ padding: '2px 4px 2px 10px' }}>
            Data
            <input type="date" value={dataRef} min={nucleo.meta.data_sync} max={nucleo.meta.fim_previsao}
              onChange={(e) => e.target.value && set({ dataRef: e.target.value })} style={{ border: 0, background: 'transparent', padding: '3px 4px' }} />
          </label>
          <SeletorEscopo />
          <button className="iconbtn" aria-label="Alternar tema" onClick={() => set({ tema: tema === 'dark' ? 'light' : 'dark' })}>
            {tema === 'dark' ? I.sol : I.lua}
          </button>
        </header>}
        <div className={`content ${bleed ? 'bleed' : ''}`} key={vista}><Protecao>{v.el()}</Protecao></div>
      </main>
    </div>
  );
}
