import { tx } from '../i18n';
import type { EChartsOption } from 'echarts';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Status } from '../components/Controles';
import { I } from '../components/Icones';
import { Grafico } from '../components/Grafico';
import { Leque } from '../components/Leque';
import { Mapa } from '../components/Mapa';
import type { Historico, Hospital, Municipio } from '../data/tipos';
import { phi, Z80 } from '../engine/motor';
import { capacidade, noDia, serieAgregada } from '../lib/agregacao';
import { corOcupacao, corSeq, gradienteOcupacao, gradienteSeq, nivelOcupacao } from '../lib/cores';
import { addDias, dataBR, diffDias, isoData, n0, n1, parseData, pct, reais } from '../lib/formato';
import { base as baseGraf } from '../lib/tema-graf';
import { capacidadeEm, censoSemanal } from '../lib/series';
import { corGrupo } from '../lib/cores';
import { dataDoK, kDe, nomeEscopo, unidades, useStore } from '../store';

/** Censo observado de uma unidade num dia: diário quando existe, senão a média da semana. */
function censoObs(h: Historico, u: number, d: Date) {
  const s = h.diario.censo[u];
  const di = diffDias(d, parseData(h.diario.inicio));
  if (di >= 0 && di < s.length) return s[di];
  const w = Math.min(h.semanas.n - 1, Math.max(0, Math.floor(diffDias(d, parseData(h.semanas.inicio)) / 7)));
  return h.semanas.censo[u][w];
}
/** Ponto dentro de um polígono ou multipolígono GeoJSON (ray casting; furos tratados como anéis extras). */
function dentro(lon: number, lat: number, geom: GeoJSON.Geometry) {
  const polys = geom.type === 'Polygon' ? [geom.coordinates] : geom.type === 'MultiPolygon' ? geom.coordinates : [];
  for (const poly of polys) {
    let in_ = false;
    for (const anel of poly) {
      for (let i = 0, j = anel.length - 1; i < anel.length; j = i++) {
        const [xi, yi] = anel[i], [xj, yj] = anel[j];
        if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) in_ = !in_;
      }
    }
    if (in_) return true;
  }
  return false;
}
/** Leitos livres ou pacientes acima da capacidade (o gestor pensa em quantos leitos sobram, não em percentual). */
function folga(m: number, c: number) {
  if (!(c > 0) || !isFinite(m)) return null;
  const d = Math.round(c - m);
  return d >= 0 ? { n: d, acima: false, curto: tx('{0} livres', n0(d)), longo: tx('{0} leitos livres', n0(d)) }
    : { n: -d, acima: true, curto: tx('{0} acima', n0(-d)), longo: tx("{0} pacientes acima da capacidade", n0(-d)) };
}
const yyyymm = (d: Date) => d.getUTCFullYear() * 100 + d.getUTCMonth() + 1;
const PASSOS = [7, 14, 28];
type Nivel = 'todas' | '85' | '90' | '100' | 'risco';
type Porte = 'todos' | 'p' | 'm' | 'g';
const NIVEIS: [Nivel, string][] = [['todas', tx("Todas")], ['85', '≥ 85%'], ['90', '≥ 90%'], ['100', '≥ 100%'], ['risco', tx("Em risco (previsão)")]];
const PORTES: [Porte, string][] = [['todos', tx("Todos")], ['p', tx("Pequeno · < 100 leitos")], ['m', tx("Médio · 100–499")], ['g', tx("Grande · ≥ 500")]];
const porteOk = (po: Porte, c: number) => po === 'todos' || (po === 'p' ? c < 100 : po === 'm' ? c >= 100 && c < 500 : c >= 500);
type Aba = 'geral' | 'leitos' | 'hospitais' | 'municipios';
const ABAS: [Aba, string][] = [['geral', tx("Visão geral")], ['leitos', tx("Leitos")], ['hospitais', tx("Hospitais")], ['municipios', tx("Municípios")]];
const INDM: { id: 'ocup' | 'taxa_pad' | 'fora_mun' | 'perm'; nome: string; curto: string; fmt: (v: number) => string }[] = [
  { id: 'ocup', nome: tx("Ocupação dos hospitais (12 meses)"), curto: tx("Ocupação"), fmt: (v) => pct(v) },
  { id: 'taxa_pad', nome: tx("Internações /1.000 hab. (padronizada)"), curto: tx("Internação"), fmt: (v) => n1(v) },
  { id: 'fora_mun', nome: tx("% internado fora do município"), curto: tx("Fora do mun."), fmt: (v) => pct(v) },
  { id: 'perm', nome: tx("Permanência média (dias)"), curto: tx("Permanência"), fmt: (v) => n1(v) },
];
const norm = (t: string) => t.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '');
type Res = { tipo: 'regiao' | 'municipio' | 'hospital'; id: number; nome: string; sub: string };
const FAIXAS = ['0–14', '15–39', '40–59', '60–79', '80+'];

export function Panorama() {
  const { nucleo, previsao, historico } = useStore();
  if (!nucleo || !previsao || !historico) return <div className="loading"><div className="spinner" /></div>;
  return <PanoramaPronto />;
}

function PanoramaPronto() {
  const { nucleo: N, previsao: P, historico: H, hospitais, municipios, geo, escopo, tema, set } = useStore();
  const n = N!, p = P!, h = H!;
  const G = n.grupos.length, Hz = n.meta.horizonte;
  const [g, setG] = useState(-1); // tipo de leito: -1 = Geral (soma de todos os tipos)
  const geral = g < 0;
  const gs = geral ? n.grupos.map((_, i) => i) : [g];
  const grupoAtual = geral ? { id: 'Geral', nome: tx("Geral") } : n.grupos[g];
  const corTipo = (i: number) => (i < 0 ? 'var(--text-2)' : corGrupo(i));
  const L = (x: Hospital) => gs.reduce((t, i) => t + x.leitos[i], 0);
  const Cn = (x: Hospital) => gs.reduce((t, i) => t + x.censo[i], 0);
  const capR = (i: number) => gs.reduce((t, gg) => t + n.capacidade[i][gg], 0);
  const ini = parseData(n.meta.dia0), sync = parseData(n.meta.data_sync), fim = parseData(n.meta.fim_previsao);
  const total = diffDias(fim, ini);
  const hoje = parseData(isoData(new Date()));

  const [dsel, setDsel] = useState(n.meta.data_sync);
  const [tocando, setTocando] = useState(false);
  const [passo, setPasso] = useState(0);
  const [modo3d, setModo3d] = useState(false);          // padrão: mapa plano (modo gestor)
  const [verHosp, setVerHosp] = useState(true);
  const [estiloHosp, setEstiloHosp] = useState<'objetivo' | 'ilustrativo'>('objetivo');
  const [criticos, setCriticos] = useState(false);
  const cliqueRef = useRef(0);
  const [q, setQ] = useState('');
  const [buscaAberta, setBuscaAberta] = useState(false);
  const [idxB, setIdxB] = useState(0);
  const buscaRef = useRef<HTMLDivElement>(null);
  const buscaInput = useRef<HTMLInputElement>(null);
  const [abaFoco, setAbaFoco] = useState<Aba>('geral');
  const [indMun, setIndMun] = useState(0);
  const [munSel, setMunSel] = useState<number | null>(null);
  const [verMaisHosp, setVerMaisHosp] = useState(false);
  const [verMaisReg, setVerMaisReg] = useState(false);
  const [hospSel, setHospSel] = useState<number | null>(null);
  const [alvo, setAlvo] = useState<{ lon: number; lat: number; z: number; n: number } | null>(null);
  const [painel, setPainel] = useState(true);
  const [tempo, setTempo] = useState(true);
  const [focar, setFocar] = useState(false);
  const [filtros, setFiltros] = useState(false);
  const [nivel, setNivel] = useState<Nivel>('todas');
  const [porte, setPorte] = useState<Porte>('todos');
  const [esfera, setEsfera] = useState<'todas' | 'MUNICIPAL' | 'ESTADUAL'>('todas');
  const popRef = useRef<HTMLDivElement>(null);
  const [tipoMenu, setTipoMenu] = useState(false);
  const tipoRef = useRef<HTMLDivElement>(null);
  const painelRef = useRef<HTMLDivElement>(null);

  const d = parseData(dsel);
  const obs = d <= sync;
  const k = kDe(n, dsel);
  const us = unidades(n, escopo, g).filter((u) => porteOk(porte, capR(Math.floor(u / G))));
  const usKey = us.join();
  const regSel = escopo.tipo === 'regiao' ? escopo.id : null;
  const foco = focar && regSel != null ? regSel : null; // região em foco: só ela fica no mapa
  const drsLista = escopo.tipo === 'drs' ? escopo.id : null; // a lista só se restringe quando uma DRS é escolhida nos filtros

  useEffect(() => {
    if (!filtros) return;
    const fora = (e: MouseEvent) => { if (popRef.current && !popRef.current.contains(e.target as Node)) setFiltros(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setFiltros(false); };
    document.addEventListener('mousedown', fora); document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', fora); document.removeEventListener('keydown', esc); };
  }, [filtros]);

  useEffect(() => {
    if (!tipoMenu) return;
    const fora = (e: MouseEvent) => { if (tipoRef.current && !tipoRef.current.contains(e.target as Node)) setTipoMenu(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setTipoMenu(false); };
    document.addEventListener('mousedown', fora); document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', fora); document.removeEventListener('keydown', esc); };
  }, [tipoMenu]);

  useEffect(() => { // atalho "/" leva ao campo de busca
    const tecla = (e: KeyboardEvent) => {
      const alvoEl = e.target as HTMLElement;
      if (e.key !== '/' || e.metaKey || e.ctrlKey || alvoEl.closest('input, textarea, select, [contenteditable]')) return;
      e.preventDefault(); buscaInput.current?.focus(); setBuscaAberta(true);
    };
    document.addEventListener('keydown', tecla);
    return () => document.removeEventListener('keydown', tecla);
  }, []);
  useEffect(() => {
    if (!buscaAberta) return;
    const fora = (e: MouseEvent) => { if (buscaRef.current && !buscaRef.current.contains(e.target as Node)) setBuscaAberta(false); };
    document.addEventListener('mousedown', fora);
    return () => document.removeEventListener('mousedown', fora);
  }, [buscaAberta]);

  // reprodução da máquina do tempo
  const dselRef = useRef(dsel);
  dselRef.current = dsel;
  useEffect(() => {
    if (!tocando) return;
    const id = setInterval(() => {
      const nx = addDias(parseData(dselRef.current), PASSOS[passo]);
      if (nx >= fim) { setDsel(isoData(fim)); setTocando(false); } else setDsel(isoData(nx));
    }, 90);
    return () => clearInterval(id);
  }, [tocando, passo]);

  // ocupação de cada região na data selecionada (observada ou prevista)
  const dados = useMemo(() => {
    const ym = yyyymm(d);
    return n.regioes.map((_, i) => {
      let mm = 0, cc = 0, vv = 0;
      for (const gg of gs) { // soma dos tipos de leito (um só quando não é "Geral"); a incerteza soma as variâncias
        const u = i * G + gg;
        if (obs) { mm += censoObs(h, u, d); cc += capacidadeEm(n, [u], ym); }
        else { const x = noDia(n, p, u, k); mm += x.m; cc += n.capacidade[i][gg]; vv += x.dp * x.dp; }
      }
      return { m: mm, c: cc, dp: Math.sqrt(vv) };
    });
  }, [dsel, g]);

  const cores = useMemo(() => new Map(n.regioes.map((r, i) => [r.id, corOcupacao(dados[i].c > 0 ? dados[i].m / dados[i].c : NaN)])), [dados, tema]);
  // em foco, a coluna da região é achatada para que se enxergue o topo (onde ficam os hospitais)
  const alturas = useMemo(() => new Map(n.regioes.map((r, i) => [r.id, Math.sqrt(capR(i)) * 2600 * (foco != null ? 0.1 : 1)])), [g, foco]);

  // manchete do escopo selecionado
  const regIdx = [...new Set(us.map((u) => Math.floor(u / G)))]; // no "Geral" cada região tem várias unidades: contar a região uma vez (dados[i] já soma os tipos)
  const m = regIdx.reduce((s, i) => s + dados[i].m, 0);
  const cap = regIdx.reduce((s, i) => s + dados[i].c, 0);
  const taxa = cap > 0 ? m / cap : NaN;
  const prevAgg = useMemo(() => (obs ? null : serieAgregada(n, p, us, k, Math.min(k + 57, Hz))), [dsel, usKey, g]);
  const dp = prevAgg ? prevAgg.dp[0] : 0;
  const pico = useMemo(() => {
    if (!prevAgg) return null;
    let mx = 0, im = 0;
    for (let i = 0; i < prevAgg.media.length; i++) if (prevAgg.media[i] > mx) { mx = prevAgg.media[i]; im = i; }
    return { v: mx, data: dataDoK(n, k + im) };
  }, [prevAgg]);
  const antes = useMemo(() => { // observado: 4 semanas antes
    if (!obs) return null;
    const d0 = addDias(d, -28), ym = yyyymm(d0);
    const c0 = capacidadeEm(n, us, ym);
    return c0 > 0 ? us.reduce((s, u) => s + censoObs(h, u, d0), 0) / c0 : null;
  }, [dsel, usKey, g]);

  // todas as regiões com ocupação e risco na data; os filtros decidem quem aparece na lista e quem fica em destaque no mapa
  const base = useMemo(() => n.regioes.map((r, i) => {
    const { m: mm, c } = dados[i];
    let pmax = 0;
    if (!obs && c > 0) {
      for (let dd = 0; dd < 28; dd++) {
        let mm2 = 0, vv = 0;
        for (const gg of gs) { const x = noDia(n, p, i * G + gg, Math.min(k + dd, Hz - 1)); mm2 += x.m; vv += x.dp * x.dp; }
        pmax = Math.max(pmax, 1 - phi((0.9 * c - mm2) / Math.max(Math.sqrt(vv), 1e-6)));
      }
    }
    return { r, i, c, ocup: c > 0 ? mm / c : NaN, pmax };
  }), [dados, obs]);
  const passaNivel = (x: { ocup: number; pmax: number }) =>
    nivel === 'todas' || (nivel === 'risco' ? x.pmax >= 0.5 : x.ocup >= Number(nivel) / 100);
  const passa = (x: (typeof base)[number]) => (drsLista == null || x.r.drs === drsLista) && porteOk(porte, x.c) && passaNivel(x);
  // no tema claro, selecionar uma região não apaga as demais (difícil de ler); no escuro o sombreamento fica
  const apagaPorTerritorio = escopo.tipo === 'drs' || (escopo.tipo === 'regiao' && tema === 'dark');
  const passaMapa = (x: (typeof base)[number]) => (!apagaPorTerritorio || (regSel != null ? x.r.id === regSel : drsLista == null || x.r.drs === drsLista)) && porteOk(porte, x.c) && passaNivel(x);
  const filtroAtivo = apagaPorTerritorio || porte !== 'todos' || nivel !== 'todas';
  const destacados = useMemo(() => filtroAtivo ? new Set(base.filter((x) => passaMapa(x) || x.r.id === regSel).map((x) => x.r.id)) : null, [base, escopo, porte, nivel, tema]);
  // coordenadas do cadastro às vezes caem fora da própria região (ou do estado): nesse caso o hospital vai para o centro do município
  const hospPos = useMemo(() => {
    const out = new Map<number, [number, number]>();
    if (!hospitais || !geo) return out;
    const poly = new Map(geo.regioes.features.map((f) => [Number(f.properties?.regiao), f.geometry]));
    const cent = new Map((municipios?.municipios ?? []).map((m) => [m.mun, m]));
    for (const x of hospitais.hospitais) {
      if (!x.lat || !x.lon) continue;
      const g0 = x.regiao != null ? poly.get(Number(x.regiao)) : undefined;
      if (g0 && dentro(x.lon, x.lat, g0)) { out.set(x.cnes, [x.lon, x.lat]); continue; }
      const m = cent.get(x.mun);
      if (m && m.lon != null && m.lat != null && (!g0 || dentro(m.lon, m.lat, g0))) out.set(x.cnes, [m.lon, m.lat]);
    }
    return out;
  }, [hospitais, geo, municipios]);
  const critico = (x: Hospital) => L(x) > 0 && Cn(x) / L(x) >= 0.9;
  const baseHosp = useMemo(() => (hospitais ? hospitais.hospitais.filter((x) => hospPos.has(x.cnes) && L(x) >= 5 && (esfera === 'todas' || x.esfera === esfera) && (!criticos || critico(x))) : []),
    [hospitais, hospPos, g, esfera, criticos]);
  const relevo = modo3d && foco == null; // região em foco = mapa plano com os municípios
  const estiloMapa: 'gestor' | 'hospital' = relevo ? 'hospital' : estiloHosp === 'objetivo' ? 'gestor' : 'hospital'; // com relevo 3D os hospitais viram prédios
  const gestorFeats = useMemo<GeoJSON.Feature[]>(() => baseHosp.filter((x) => foco == null || Number(x.regiao) === foco).map((x) => ({
    type: 'Feature', geometry: { type: 'Point', coordinates: hospPos.get(x.cnes)! },
    properties: { id: x.cnes, leitos: L(x), censo: Cn(x), crit: critico(x) ? 1 : 0 },
  })), [baseHosp, hospPos, g, foco]);

  // hospitais no mesmo endereço (a menos de ~250 m) viram um só complexo: um prédio com o total de leitos e a ocupação conjunta
  const grupos = useMemo(() => {
    const mapa = new Map<number, Hospital[]>();
    if (!verHosp || !hospitais) return { feats: [] as GeoJSON.Feature[], mapa };
    const lista = baseHosp.filter((x) => foco == null || Number(x.regiao) === foco);
    const xy = lista.map((x) => { const [lo, la] = hospPos.get(x.cnes)!; return [lo * Math.cos((la * Math.PI) / 180), la]; });
    const pai = lista.map((_, i) => i);
    const raiz = (i: number): number => (pai[i] === i ? i : (pai[i] = raiz(pai[i])));
    const LIM = 0.0025;
    for (let i = 0; i < lista.length; i++) for (let j = i + 1; j < lista.length; j++)
      if (Math.hypot(xy[i][0] - xy[j][0], xy[i][1] - xy[j][1]) < LIM) pai[raiz(i)] = raiz(j);
    const por = new Map<number, Hospital[]>();
    lista.forEach((x, i) => { const r = raiz(i); por.set(r, [...(por.get(r) ?? []), x]); });
    const q = (x: number) => Math.round(x / 0.05) * 0.05; // poucas cores distintas (cada uma vira um ícone)
    const feats: GeoJSON.Feature[] = [];
    for (const ms of por.values()) {
      ms.sort((a, b) => L(b) - L(a));
      const rep = ms[0], leitos = ms.reduce((t, x) => t + L(x), 0), censo = ms.reduce((t, x) => t + Cn(x), 0);
      const reg = rep.regiao != null ? Number(rep.regiao) : null;
      mapa.set(rep.cnes, ms);
      feats.push({
        type: 'Feature', geometry: { type: 'Point', coordinates: hospPos.get(rep.cnes)! },
        properties: { id: rep.cnes, n: ms.length, cor: corOcupacao(q(censo / leitos)), raio: Math.max(2, Math.sqrt(leitos) * 0.8), alt: reg != null ? (alturas.get(reg) ?? 0) : 0 },
      });
    }
    return { feats, mapa };
  }, [verHosp, hospitais, hospPos, baseHosp, g, tema, alturas, foco]);
  const pontos = useMemo<GeoJSON.FeatureCollection | null>(() => (verHosp && hospitais ? { type: 'FeatureCollection', features: estiloMapa === 'gestor' ? gestorFeats : grupos.feats } : null),
    [verHosp, hospitais, estiloMapa, gestorFeats, grupos]);

  // hospitais do recorte (lista do painel): da região selecionada, da DRS escolhida ou os mais ocupados do estado
  const hospLista = useMemo(() => {
    const drsDe = new Map(n.regioes.map((r) => [r.id, r.drs]));
    return baseHosp.filter((x) => (regSel != null ? Number(x.regiao) === regSel : drsLista == null || drsDe.get(Number(x.regiao)) === drsLista))
      .map((x) => ({ x, oc: Cn(x) / L(x) })).sort((a, b) => b.oc - a.oc);
  }, [baseHosp, regSel, drsLista, g]);
  const hospMostrar = regSel != null ? hospLista : hospLista.filter((h) => L(h.x) >= 20).slice(0, 12);
  const hospCard = hospSel != null ? hospitais?.hospitais.find((x) => x.cnes === hospSel) ?? null : null;
  // ---- região em foco: municípios, matriz de leitos, comparação, painel do hospital ----
  const munsReg = useMemo(() => (foco != null && municipios ? municipios.municipios.filter((m) => m.regiao === foco) : []), [foco, municipios]);
  const hospPorMun = useMemo(() => {
    const mp = new Map<number, { leitos: number; censo: number; n: number }>();
    if (!hospitais) return mp;
    for (const x of hospitais.hospitais) {
      if (L(x) <= 0) continue;
      const a = mp.get(x.mun) ?? { leitos: 0, censo: 0, n: 0 };
      a.leitos += L(x); a.censo += Cn(x); a.n++;
      mp.set(x.mun, a);
    }
    return mp;
  }, [hospitais, g]);
  const valMun = (m: Municipio): number | null => {
    const id = INDM[indMun].id;
    if (id === 'ocup') { const a = hospPorMun.get(m.mun); return a && a.leitos > 0 ? a.censo / a.leitos : null; }
    const v = m[id] as number | null;
    return v != null && isFinite(v) ? v : null;
  };
  const munVals = munsReg.map(valMun).filter((v): v is number => v != null);
  const mLo = munVals.length ? Math.min(...munVals) : 0, mHi = munVals.length ? Math.max(...munVals) : 1;
  const municipiosFoco = useMemo(() => {
    if (foco == null || !municipios) return null;
    const mp = new Map<number, string>();
    for (const m of munsReg) { const v = valMun(m); if (v != null) mp.set(m.mun, indMun === 0 ? corOcupacao(v) : corSeq((v - mLo) / ((mHi - mLo) || 1))); }
    return mp;
  }, [foco, municipios, munsReg, indMun, hospPorMun, tema]);
  const munRank = munsReg.map((m) => ({ m, v: valMun(m) })).sort((a, b) => (b.v ?? -Infinity) - (a.v ?? -Infinity));
  const munCard = munSel != null ? municipios?.municipios.find((m) => m.mun === munSel) ?? null : null;
  const nomeMun = (id: number) => municipios?.municipios.find((m) => m.mun === id)?.nome ?? String(id);

  const matriz = useMemo(() => {
    if (regSel == null) return [];
    const i = n.regioes.findIndex((r) => r.id === regSel), ym = yyyymm(d);
    return n.grupos.map((gr, gg) => {
      const u = i * G + gg;
      if (obs) return { gr, gg, m: censoObs(h, u, d), c: capacidadeEm(n, [u], ym) };
      return { gr, gg, m: noDia(n, p, u, k).m, c: n.capacidade[i][gg] };
    });
  }, [regSel, dsel]);
  const taxaDe = (f: (r: (typeof n.regioes)[number]) => boolean) => {
    let mm = 0, cc = 0;
    n.regioes.forEach((r, i) => { if (f(r)) { mm += dados[i].m; cc += dados[i].c; } });
    return cc > 0 ? mm / cc : NaN;
  };

  const hospTipos = hospCard ? n.grupos.map((gr, gg) => ({ gr, gg, l: hospCard.leitos[gg], c: hospCard.censo[gg] })).filter((x) => x.l > 0) : [];
  const opHosp = useMemo<EChartsOption | null>(() => {
    if (!hospCard || !hospitais) return null;
    const b = baseGraf(), fimH = parseData(hospitais.semana_final), L = hospCard.semanal.length;
    const cap = hospCard.leitos.reduce((a, v) => a + v, 0);
    return {
      animation: false, textStyle: b.textStyle, grid: { left: 38, right: 8, top: 12, bottom: 22 },
      tooltip: { ...b.tooltip, trigger: 'axis', valueFormatter: (v: any) => n0(v) },
      xAxis: { type: 'time', ...b.eixoX }, yAxis: { type: 'value', ...b.eixoY, scale: true },
      series: [{ type: 'line', name: 'Censo semanal', symbol: 'none', lineStyle: { width: 1.8, color: b.t1 }, areaStyle: { color: b.grid },
        data: hospCard.semanal.map((v, i) => [addDias(fimH, -(L - 1 - i) * 7).getTime(), v]),
        markLine: { symbol: 'none', silent: true, data: [{ yAxis: cap, lineStyle: { color: b.t3, type: [4, 4] }, label: { show: false } }] } }],
    };
  }, [hospCard, tema]);

  // busca única: regiões, municípios e hospitais
  const resultados = useMemo<Res[]>(() => {
    const t = norm(q).trim();
    if (t.length < 2) return [];
    const toks = t.split(/\s+/);
    const nota = (nome: string) => { const nn = norm(nome); return toks.every((k) => nn.includes(k)) ? (nn.startsWith(toks[0]) ? 0 : 1) : -1; };
    const pega = (itens: { r: Res; sc: number }[], max: number) => itens.filter((x) => x.sc >= 0).sort((a, b) => a.sc - b.sc || a.r.nome.localeCompare(b.r.nome)).slice(0, max).map((x) => x.r);
    const drsNome = (id: string) => n.drs.find((x) => x.id === id)?.nome ?? '';
    const regs = pega(n.regioes.map((r) => ({ r: { tipo: 'regiao' as const, id: r.id, nome: r.nome, sub: tx("Região · DRS {0}", drsNome(r.drs)) }, sc: nota(r.nome) })), 5);
    const muns = pega((municipios?.municipios ?? []).map((m) => ({ r: { tipo: 'municipio' as const, id: m.mun, nome: m.nome, sub: tx("Município · {0}", n.regioes.find((r) => r.id === m.regiao)?.nome ?? '') }, sc: nota(m.nome) })), 5);
    const hosps = pega((hospitais?.hospitais ?? []).map((x) => ({ r: { tipo: 'hospital' as const, id: x.cnes, nome: x.nome, sub: tx("Hospital · {0}", x.municipio ?? '') }, sc: nota(x.nome + ' ' + (x.municipio ?? '')) })), 6);
    return [...regs, ...muns, ...hosps];
  }, [q, municipios, hospitais]);
  const escolher = (res: Res) => {
    setQ(''); setBuscaAberta(false); buscaInput.current?.blur();
    if (res.tipo === 'regiao') {
      const r = n.regioes.find((x) => x.id === res.id)!;
      set({ escopo: { tipo: 'regiao', id: r.id } }); setHospSel(null);
      if (foco == null) setAlvo({ lon: r.lon, lat: r.lat, z: 8, n: Date.now() }); // em foco, a câmera já vai para a nova região
    } else if (res.tipo === 'municipio') {
      const m = municipios?.municipios.find((x) => x.mun === res.id);
      if (!m) return;
      set({ escopo: { tipo: 'regiao', id: m.regiao } }); setFocar(true); setHospSel(null);
      window.setTimeout(() => { setAbaFoco('municipios'); setMunSel(m.mun); }, 150); // depois de o foco reiniciar as abas
    } else {
      const x = hospitais?.hospitais.find((y) => y.cnes === res.id);
      if (!x) return;
      setVerHosp(true);
      const rid = x.regiao != null ? Number(x.regiao) : null;
      const outraRegiao = foco != null && rid !== foco; // o foco só mostra uma região: precisa acompanhar o hospital
      if (outraRegiao) { if (rid != null) set({ escopo: { tipo: 'regiao', id: rid } }); else setFocar(false); }
      const abrir = () => {
        setHospSel(x.cnes);
        const pos = hospPos.get(x.cnes) ?? (x.lon != null && x.lat != null ? ([x.lon, x.lat] as [number, number]) : null);
        if (pos) setAlvo({ lon: pos[0], lat: pos[1], z: 10.5, n: Date.now() });
      };
      if (outraRegiao) window.setTimeout(abrir, 250); else abrir(); // depois de a troca de região limpar a seleção
    }
  };
  const irAoHospital = (x: Hospital) => { setHospSel(x.cnes); const pos = hospPos.get(x.cnes); if (pos) setAlvo({ lon: pos[0], lat: pos[1], z: 10.5, n: Date.now() }); };
  const lista = useMemo(() => base.filter((x) => x.c >= 5 && passa(x))
    .sort((a, b) => (obs ? 0 : b.pmax - a.pmax) || b.ocup - a.ocup), [base, escopo, porte, nivel]);
  const nAlta = lista.filter((x) => x.ocup >= 0.9).length;
  const nRisco = lista.filter((x) => x.pmax >= 0.5).length;

  useEffect(() => { if (regSel == null) setFocar(false); }, [regSel]);
  useEffect(() => { setHospSel(null); }, [regSel]);
  useEffect(() => { setAbaFoco('geral'); setMunSel(null); }, [foco]); // o cartão do hospital pertence ao recorte em que foi aberto

  // ao mudar a seleção, o painel volta ao topo (ocupação e indicadores)
  useEffect(() => {
    painelRef.current?.scrollTo({ top: 0 });
  }, [regSel]);

  // linha do tempo do escopo (painel)
  const leque = useMemo(() => {
    const semIni = parseData(h.semanas.inicio);
    const sw = censoSemanal(h, us);
    const i0 = Math.max(0, sw.length - 52 * 5);
    const datasObs: Date[] = [], completo: (number | null)[] = [];
    for (let i = i0; i < sw.length; i++) { const dd = addDias(semIni, i * 7 + 3); if (dd <= sync) { datasObs.push(dd); completo.push(sw[i]); } }
    const k1 = Math.min(Hz, 400);
    const s = serieAgregada(n, p, us, 0, k1);
    const datasPrev: Date[] = [], media: number[] = [], dpv: number[] = [];
    for (let i = 0; i + 7 <= k1; i += 7) {
      let mm = 0, dd = 0;
      for (let j = i; j < i + 7; j++) { mm += s.media[j] / 7; dd += s.dp[j] / 7; }
      datasPrev.push(dataDoK(n, i + 3)); media.push(mm); dpv.push(dd);
    }
    return { datasObs, completo, datasPrev, media, dp: dpv, capacidade: capacidade(n, us), sync };
  }, [usKey, g]);
  const lequeD = useMemo(() => ({ ...leque, dataRef: tocando ? undefined : d }), [leque, tocando, dsel]);

  // perfil de ocupação ao longo da régua (semanal): observado + previsto
  const perfil = useMemo(() => {
    const W = Math.floor(total / 7) + 1;
    const v: number[] = new Array(W).fill(NaN);
    const swk = censoSemanal(h, us), semIni = parseData(h.semanas.inicio);
    for (let w = 0; w < h.semanas.n; w++) {
      const dd = addDias(semIni, w * 7 + 3);
      if (dd > sync) break;
      const c = capacidadeEm(n, us, yyyymm(dd)), wi = Math.floor(diffDias(dd, ini) / 7);
      if (c > 0 && wi < W) v[wi] = swk[w] / c;
    }
    const cNow = capacidade(n, us), s = serieAgregada(n, p, us, 0, Hz);
    for (let kk = 3; kk < Hz; kk += 7) { const wi = Math.floor(diffDias(dataDoK(n, kk), ini) / 7); if (wi < W && cNow > 0) v[wi] = s.media[kk] / cNow; }
    const fin = v.filter((x) => isFinite(x));
    const lo = Math.min(...fin, 0.9), hi = Math.max(...fin, 0.9), yv = (x: number) => 50 - ((x - lo) / (hi - lo)) * 40;
    const wSync = Math.floor(diffDias(sync, ini) / 7);
    const tr = (a: number, b: number) => {
      let dstr = '';
      for (let i = a; i <= b && i < W; i++) if (isFinite(v[i])) dstr += `${dstr ? 'L' : 'M'}${((i / (W - 1)) * 1000).toFixed(1)},${yv(v[i]).toFixed(1)}`;
      return dstr;
    };
    return { obs: tr(0, wSync), prev: tr(wSync, W), y90: yv(0.9) };
  }, [usKey, g]);

  const pctX = (dd: Date) => `${(diffDias(dd, ini) / total) * 100}%`;
  const anos = Array.from({ length: fim.getUTCFullYear() - ini.getUTCFullYear() }, (_, i) => ini.getUTCFullYear() + 1 + i);
  const nome = nomeEscopo(n, escopo);
  const nFiltros = (escopo.tipo !== 'estado' ? 1 : 0) + (porte !== 'todos' ? 1 : 0) + (nivel !== 'todas' ? 1 : 0) + (verHosp && esfera !== 'todas' ? 1 : 0) + (verHosp && criticos ? 1 : 0);
  const rEsc = regSel != null ? n.regioes.find((r) => r.id === regSel)! : null;

  const irPara = (dd: Date) => { setTocando(false); setDsel(isoData(new Date(Math.min(fim.getTime(), Math.max(ini.getTime(), dd.getTime()))))); };
  const alternarPlay = () => {
    if (!tocando && d >= fim) setDsel(isoData(addDias(sync, -365 * 3)));
    setTocando(!tocando);
  };

  return (
    <div className={`pano fade-in ${painel ? '' : 'sem-painel'}`}>
      <Mapa camada="regioes" cores={cores} alturas={alturas} modo3d={relevo} pontos={pontos} estiloPontos={estiloMapa} pontoSel={hospSel} alvo={alvo} foco={foco} municipiosFoco={municipiosFoco} munSel={munSel} altura="100%"
        padding={{ top: 80, bottom: tempo ? 140 : 80, left: painel ? 420 : 30, right: 10 }}
        selecionado={regSel} destacados={destacados}
        onClick={(t, id) => {
          if (t === 'ponto') { setHospSel(hospSel === id ? null : id); return; }
          // o clique simples espera um instante: se vier um segundo clique (duplo clique), ele é cancelado
          window.clearTimeout(cliqueRef.current);
          cliqueRef.current = window.setTimeout(() => {
            if (foco != null) { setMunSel(munSel === id ? null : id); setAbaFoco('municipios'); setHospSel(null); }
            else set({ escopo: regSel === id ? { tipo: 'estado' } : { tipo: 'regiao', id } });
          }, 230);
        }}
        onDblClick={(_, id) => {
          window.clearTimeout(cliqueRef.current);
          if (foco != null) return;                       // com foco, as áreas são municípios: sem ação
          set({ escopo: { tipo: 'regiao', id } }); setFocar(true); setHospSel(null);
        }}
        tooltip={(t, id, props) => {
          if (t === 'cluster' && props) {
            return <><b>{props.point_count} {tx("hospitais")}</b><div className="muted">{tx("clique para aproximar")}</div>
              <div className="row"><span>{tx("Leitos SUS (")}{grupoAtual.id})</span><span>{n0(props.leitos)}</span></div>
              <div className="row"><span>{tx("Ocupação média 12m")}</span><span>{pct(props.censo / Math.max(props.leitos, 1))}</span></div>
              <div className="row"><span>{tx("Hospitais ≥ 90%")}</span><span>{props.crit}</span></div></>;
          }
          if (t === 'ponto') {
            const ms = estiloMapa === 'hospital' ? grupos.mapa.get(id) : hospitais?.hospitais.filter((y) => y.cnes === id);
            if (!ms || !ms.length) return null;
            if (ms.length === 1) {
              const x = ms[0];
              return <><b>{x.nome}</b><div className="muted">{x.municipio}</div>
                <div className="row"><span>{tx("Leitos SUS (")}{grupoAtual.id})</span><span>{L(x)}</span></div>
                <div className="row"><span>{tx("Ocupação média 12m")}</span><span>{pct(Cn(x) / L(x))}</span></div></>;
            }
            const LT = ms.reduce((t, x) => t + L(x), 0), CT = ms.reduce((t, x) => t + Cn(x), 0);
            return <><b>{ms.length} {tx("unidades neste endereço")}</b><div className="muted">{ms[0].municipio}</div>
              <div className="row"><span>{tx("Leitos SUS (")}{grupoAtual.id}{tx(") · total")}</span><span>{LT}</span></div>
              <div className="row"><span>{tx("Ocupação média 12m")}</span><span>{pct(CT / LT)}</span></div>
              <div style={{ borderTop: '1px solid var(--border)', margin: '6px 0 2px' }} />
              {ms.slice(0, 5).map((x) => <div key={x.cnes} className="row"><span>{x.nome.length > 30 ? x.nome.slice(0, 29) + '…' : x.nome}</span><span>{L(x)}</span></div>)}
              {ms.length > 5 && <div className="muted">{tx("e mais")} {ms.length - 5}…</div>}</>;
          }
          if (t === 'area' && foco != null) {
            const m = municipios?.municipios.find((x) => x.mun === id);
            if (!m) return null;
            const v = valMun(m), ha = hospPorMun.get(m.mun);
            return <><b>{m.nome}</b><div className="muted">{n0(m.pop)} {tx("habitantes")}</div>
              <div className="row"><span>{INDM[indMun].curto}</span><span>{v != null ? INDM[indMun].fmt(v) : '—'}</span></div>
              <div className="row"><span>{tx("Hospitais com leitos")} {grupoAtual.id}</span><span>{ha ? tx("{0} · {1} leitos", ha.n, ha.leitos) : tx("nenhum")}</span></div></>;
          }
          const i = n.regioes.findIndex((r) => r.id === id);
          const r = n.regioes[i], dd = dados[i];
          const rk = lista.find((x) => x.r.id === id);
          return <><b>{r.nome}</b><div className="muted">{tx("DRS")} {r.drs} · {n.drs.find((x) => x.id === r.drs)?.nome}</div>
            <div className="row"><span>{tx("Ocupação")} {dataBR(d)}</span><span>{pct(dd.c > 0 ? dd.m / dd.c : NaN, 1)}</span></div>
            <div className="row"><span>{tx("Leitos SUS")}</span><span>{n0(dd.c)}</span></div>
            {!obs && rk && <div className="row"><span>P(&gt;90%) em 4 sem.</span><span>{pct(rk.pmax)}</span></div>}
            <div className="row"><span>{tx("População")}</span><span>{n0(r.pop)}</span></div></>;
        }} />

      {/* painel contextual */}
      <aside className="pano-panel float" aria-label={tx("Resumo do recorte selecionado")}>
        {hospCard ? (
        <div className="pano-head">
          <button className="ghost collapse" aria-label={tx("Recolher painel")} title={tx("Recolher painel")} onClick={() => setPainel(false)}>{I.seta}</button>
          <h2>{tx("Hospital")}</h2>
          <button className="back" onClick={() => setHospSel(null)}>← {rEsc ? rEsc.nome : tx("Voltar ao panorama")}</button>
          <div className="esc esc-hosp">{hospCard!.nome}</div>
          <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>{hospCard!.municipio} · {hospCard!.esfera?.toLowerCase()}</div>
        </div>
        ) : (
        <div className="pano-head">
          <button className="ghost collapse" aria-label={tx("Recolher painel")} title={tx("Recolher painel")} onClick={() => setPainel(false)}>{I.seta}</button>
          <h2>{tx("Panorama")}</h2>
          {rEsc
            ? <button className="back" onClick={() => set({ escopo: { tipo: 'estado' } })}>{tx("← Estado de São Paulo")}</button>
            : escopo.tipo === 'drs' && <button className="back" onClick={() => set({ escopo: { tipo: 'estado' } })}>{tx("← Estado de São Paulo")}</button>}
          <div className="esc">{rEsc ? rEsc.nome : nome}</div>
          {rEsc && (
            <button className={`foco-btn ${focar ? 'on' : ''}`} onClick={() => setFocar(!focar)} aria-pressed={focar}
              title={focar ? tx("Voltar a mostrar o estado todo") : tx("Mostrar só esta região, com zoom")}>
              <span className="ico">{I.panorama}</span>{focar ? tx("Sair do foco") : tx("Enfocar região")}
            </button>
          )}
        </div>
        )}
        <div className="pano-scroll" ref={painelRef}>
          {hospCard ? (
            <>
          {(() => {
            const hc = hospCard!, oc = Cn(hc) / Math.max(L(hc), 1);
            return (
              <>
                <div className="headline">
                  <span className="big num">{pct(oc, 1)}</span>
                  {L(hc) > 0 && <Status nivel={nivelOcupacao(oc)} />}
                </div>
                <div className="headline-sub">{tx("ocupação média de 12 meses ·")} {grupoAtual.nome.toLowerCase()}</div>
                {(() => { const f = folga(Cn(hc), L(hc)); return f && <div className={`folga ${f.acima ? 'acima' : ''}`}><b className="num">{f.longo}</b><span>{tx("em média, de")} {n0(L(hc))} {tx("leitos SUS")}</span></div>; })()}
                <div className="mini">
                  <div><div className="lbl">{tx("Leitos SUS (")}{grupoAtual.id})</div><div className="val num">{n0(L(hc))}</div><div className="det">{tx("CNES")}</div></div>
                  <div><div className="lbl">{tx("Internados em média")}</div><div className="val num">{n0(Cn(hc))}</div><div className="det">{tx("censo médio diário")}</div></div>
                  <div><div className="lbl">{tx("Permanência média")}</div><div className="val num">{hc.perm != null ? `${n1(hc.perm)} d` : '—'}</div><div className="det">{tx("dias por internação")}</div></div>
                  <div><div className="lbl">{tx("Letalidade hospitalar")}</div><div className="val num">{hc.letal != null ? pct(hc.letal, 1) : '—'}</div><div className="det">{tx("óbitos / internações")}</div></div>
                </div>
                {oc > 1.5 && <div className="muted" style={{ fontSize: 11, margin: '-6px 0 10px' }}>{tx("Acima de 150% costuma indicar leitos subnotificados no CNES, e não superlotação real.")}</div>}

                <div className="sec-t">{tx("Por tipo de leito")}<span>{tx("média de 12 meses")}</span></div>
                <div className="matriz">
                  {hospTipos.map(({ gr, gg, l, c }) => (
                    <div key={gr.id} className={`mrow ${gg === g ? 'sel' : ''}`} onClick={() => setG(gg)}>
                      <span className="mn"><i className="swatch" style={{ background: corGrupo(gg) }} />{gr.nome}</span>
                      <span className="mv num">{n0(l)} {tx("leitos")}</span>
                      <span className="mc num" style={{ background: corOcupacao(c / Math.max(l, 1)), color: c / Math.max(l, 1) < 0.8 ? '#0b1f3d' : '#fff' }}>{pct(c / Math.max(l, 1))}</span>
                    </div>
                  ))}
                </div>

                <div className="sec-t">{tx("Censo semanal")}<span>{tx("2 anos até")} {dataBR(parseData(hospitais!.semana_final))}</span></div>
                {opHosp && <Grafico opcao={opHosp} altura={150} />}

                <div className="sec-t">{tx("Perfil do atendimento")}<span>{tx("últimos 12 meses")}</span></div>
                <div className="kv"><span>{tx("Internações por ano")}</span><b className="num">{n0(hc.n)}</b></div>
                <div className="kv"><span>{tx("Municípios de origem")}</span><b className="num">{n0(hc.n_mun)}</b></div>
                <div className="kv"><span>{tx("Pacientes de fora do município")}</span><b className="num">{hc.de_fora != null ? pct(hc.de_fora, 1) : '—'}</b></div>
                <div className="kv"><span>{tx("Faturamento SUS por ano")}</span><b className="num">{hc.valor ? reais(hc.valor) : '—'}</b></div>
                {hc.regiao != null && regSel !== Number(hc.regiao) && (
                  <button className="vermais" onClick={() => { const rid = Number(hc.regiao); setHospSel(null); set({ escopo: { tipo: 'regiao', id: rid } }); }}>{tx("Ver a região deste hospital")}</button>
                )}
              </>
            );
          })()}
            </>
          ) : (
            <>
<div className="headline">
            <span className="big num">{pct(taxa, 1)}</span>
            {cap > 0 && <Status nivel={nivelOcupacao(taxa)} />}
          </div>
          <div className="headline-sub">
            {obs ? <>{tx("ocupação de")} {grupoAtual.nome.toLowerCase()} {tx("em")} {dataBR(d)}{diffDias(d, sync) === 0 ? tx(" (último dado)") : ''}</>
              : <>{tx("ocupação prevista de")} {grupoAtual.nome.toLowerCase()} {tx("em")} {dataBR(d)} {tx("· IC 80%:")} {pct(Math.max(0, m - Z80 * dp) / cap)} – {pct((m + Z80 * dp) / cap)}</>}
          </div>
          {(() => { const f = folga(m, cap); return f && <div className={`folga ${f.acima ? 'acima' : ''}`}><b className="num">{f.longo}</b><span>{tx("de")} {n0(cap)} {tx("leitos SUS")}</span></div>; })()}
          <div className="mini">
            <div><div className="lbl">{tx("Pacientes internados")}</div><div className="val num">{n0(m)}</div><div className="det">{obs ? tx("censo SUS à meia-noite") : `±${n0(Z80 * dp)} (80%)`}</div></div>
            <div><div className="lbl">{tx("Leitos SUS")}</div><div className="val num">{n0(cap)}</div><div className="det">{(() => { const f = folga(m, cap); return f ? f.curto : '—'; })()}</div></div>
            {obs ? (
              <>
                <div><div className="lbl">{tx("Há 4 semanas")}</div><div className="val num">{antes != null ? pct(antes, 1) : '—'}</div>
                  <div className="det">{antes != null && isFinite(taxa) ? `${taxa >= antes ? '+' : '−'}${(Math.abs(taxa - antes) * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} p.p.` : ''}</div></div>
                <div><div className="lbl">{rEsc ? tx("População") : tx("Regiões ≥ 90%")}</div>
                  <div className="val num">{rEsc ? n0(rEsc.pop) : tx('{0} de {1}', nAlta, lista.length)}</div><div className="det">{rEsc ? tx("residentes") : tx("neste dia")}</div></div>
              </>
            ) : (
              <>
                <div><div className="lbl">{tx("Pico em 8 semanas")}</div><div className="val num">{pico && cap > 0 ? pct(pico.v / cap, 1) : '—'}</div>
                  <div className="det">{pico && tx("{0} · {1} pac.", dataBR(pico.data).slice(0, 5), n0(pico.v))}</div></div>
                <div><div className="lbl">{rEsc ? tx("População") : tx("Regiões em risco")}</div>
                  <div className="val num">{rEsc ? n0(rEsc.pop) : tx('{0} de {1}', nRisco, lista.length)}</div><div className="det">{rEsc ? tx("residentes") : tx("P(>90%) ≥ 50% em 4 sem.")}</div></div>
              </>
            )}
          </div>

          
              {foco != null ? (
                <>
          <div className="abas" role="tablist" aria-label={tx("Detalhe da região")}>
            {ABAS.map(([id, t]) => <button key={id} role="tab" aria-selected={abaFoco === id} className={abaFoco === id ? 'on' : ''} onClick={() => setAbaFoco(id)}>{t}</button>)}
          </div>
          {abaFoco === 'geral' && (
            <>
              <div className="sec-t">{tx("Comparação")}<span>{tx("ocupação em")} {dataBR(d)}</span></div>
              {[[tx("Esta região"), taxa], ['DRS ' + (n.drs.find((x) => x.id === rEsc?.drs)?.nome ?? ''), taxaDe((r) => r.drs === rEsc?.drs)], [tx("Estado de São Paulo"), taxaDe(() => true)]].map(([nm, v]) => (
                <div key={String(nm)} className="cmp"><span>{nm}</span><div className="bar"><i style={{ width: `${Math.min(100, ((v as number) || 0) * 100 / 1.3)}%`, background: corOcupacao(v as number) }} /></div><b className="num">{pct(v as number, 1)}</b></div>
              ))}
              <div className="mini" style={{ marginTop: 12 }}>
                <div><div className="lbl">{tx("Municípios")}</div><div className="val num">{munsReg.length}</div><div className="det">{tx("na região")}</div></div>
                <div><div className="lbl">{tx("Hospitais")}</div><div className="val num">{hospLista.length}</div><div className="det">{tx("com leitos")} {grupoAtual.id}</div></div>
              </div>
              <div className="sec-t">{tx("Linha do tempo")}
            <span className="lg"><i style={{ background: 'var(--text-1)' }} />{tx("observado")} <i style={{ background: 'var(--prev)' }} />{tx("previsão")} <i className="tr" />{tx("meta 85%")}</span></div>
          <Leque d={lequeD} altura={170} compacto />
            </>
          )}
          {abaFoco === 'leitos' && (
            <>
              <div className="sec-t">{tx("Todos os tipos de leito")}<span>{dataBR(d)}{obs ? '' : tx(" · previsão")}</span></div>
              <div className="matriz">
                {(() => {
                  const mm = matriz.reduce((t, x) => t + x.m, 0), c = matriz.reduce((t, x) => t + x.c, 0);
                  return (
                    <div className={`mrow ${geral ? 'sel' : ''}`} onClick={() => setG(-1)}>
                      <span className="mn"><i className="swatch" style={{ background: corTipo(-1) }} /><b>{tx("Geral")}</b></span>
                      <span className="mv num">{n0(mm)} / {n0(c)} · {folga(mm, c)?.curto ?? '—'}</span>
                      <span className="mc num" style={{ background: c > 0 ? corOcupacao(mm / c) : 'var(--surface-3)', color: c > 0 && mm / c >= 0.8 ? '#fff' : '#0b1f3d' }}>{c > 0 ? pct(mm / c) : '—'}</span>
                    </div>
                  );
                })()}
                {matriz.map(({ gr, gg, m: mm, c }) => (
                  <div key={gr.id} className={`mrow ${gg === g ? 'sel' : ''}`} onClick={() => setG(gg)}>
                    <span className="mn"><i className="swatch" style={{ background: corGrupo(gg) }} />{gr.nome}</span>
                    <span className="mv num">{n0(mm)} / {n0(c)} · {folga(mm, c)?.curto ?? '—'}</span>
                    <span className="mc num" style={{ background: c > 0 ? corOcupacao(mm / c) : 'var(--surface-3)', color: c > 0 && mm / c >= 0.8 ? '#fff' : '#0b1f3d' }}>{c > 0 ? pct(mm / c) : '—'}</span>
                  </div>
                ))}
              </div>
              <div className="muted" style={{ fontSize: 11, marginTop: 8 }}>{tx("Internados / leitos SUS. Clique num tipo para ver o mapa dele.")}</div>
            </>
          )}
          {abaFoco === 'hospitais' && (
            <>
              <div className="sec-t">{tx("Hospitais ·")} {rEsc?.nome}<span>{tx("média dos últimos 12 meses")}</span></div>
              <div className="rlist">
                {hospLista.length === 0 && <div className="muted" style={{ fontSize: 12, padding: '4px 8px' }}>{tx("Nenhum hospital com leitos deste tipo.")}</div>}
                {hospLista.map(({ x, oc }) => (
                  <div key={x.cnes} className={`rrow ${hospSel === x.cnes ? 'sel' : ''}`} onClick={() => irAoHospital(x)}>
                    <div><div className="nm">{x.nome.length > 34 ? x.nome.slice(0, 33) + '…' : x.nome}</div><div className="sb">{x.municipio} · {L(x)} {tx("leitos ·")} {folga(Cn(x), L(x))?.curto}</div></div>
                    <span className="ocup"><i className="swatch" style={{ background: corOcupacao(oc) }} />{pct(oc)}</span>
                    <span className="ex">{oc >= 0.9 && <span className="alerta" title={tx("Ocupação média acima de 90%")}>▲</span>}</span>
                  </div>
                ))}
              </div>
            </>
          )}
          {abaFoco === 'municipios' && (
            <>
              <div className="fgrid" style={{ margin: '12px 0 8px' }}>
                {INDM.map((x, i) => <button key={x.id} className={`chip ${indMun === i ? 'on' : ''}`} onClick={() => setIndMun(i)}>{x.curto}</button>)}
              </div>
              <div className="muted" style={{ fontSize: 11, marginBottom: 6 }}>{INDM[indMun].nome}{tx(". Dados dos hospitais e dos residentes até")} {municipios ? dataBR(parseData(municipios.meses[municipios.meses.length - 1])).slice(3) : '—'}{tx(", sem relação com a data da régua.")}</div>
              {munCard && (
                <div className="hcard">
                  <div className="hc-top"><div><b>{munCard.nome}</b><div className="muted">{n0(munCard.pop)} {tx("habitantes ·")} {n0(munCard.pop60)} {tx("com 60+")}</div></div>
                    <button className="ghost" aria-label={tx("Fechar município")} onClick={() => setMunSel(null)}>×</button></div>
                  <div className="kv"><span>{tx("Hospitais com leitos")} {grupoAtual.id}</span><b className="num">{hospPorMun.get(munCard.mun) ? tx("{0} · {1} leitos", hospPorMun.get(munCard.mun)!.n, hospPorMun.get(munCard.mun)!.leitos) : tx("nenhum")}</b></div>
                  <div className="kv"><span>{tx("Ocupação dos hospitais (12m)")}</span><b className="num">{hospPorMun.get(munCard.mun) ? pct(hospPorMun.get(munCard.mun)!.censo / hospPorMun.get(munCard.mun)!.leitos) : '—'}</b></div>
                  <div className="kv"><span>{tx("Internações por ano (residentes)")}</span><b className="num">{n0(munCard.n)}</b></div>
                  <div className="kv"><span>{tx("Taxa padronizada /1.000")}</span><b className="num">{munCard.taxa_pad != null ? n1(munCard.taxa_pad) : '—'}</b></div>
                  <div className="kv"><span>{tx("Internados fora do município")}</span><b className="num">{munCard.fora_mun != null ? pct(munCard.fora_mun) : '—'}</b></div>
                  <div className="kv"><span>{tx("Permanência média")}</span><b className="num">{munCard.perm != null ? `${n1(munCard.perm)} d` : '—'}</b></div>
                  {munCard.destinos.length > 0 && <div className="muted" style={{ fontSize: 11, marginTop: 6 }}>{tx("Principais destinos:")} {munCard.destinos.slice(0, 3).map(([dd]) => nomeMun(dd)).join(', ')}</div>}
                </div>
              )}
              <div className="rlist">
                {munRank.map(({ m: mm, v }) => (
                  <div key={mm.mun} className={`rrow ${munSel === mm.mun ? 'sel' : ''}`} onClick={() => setMunSel(munSel === mm.mun ? null : mm.mun)}>
                    <div><div className="nm">{mm.nome}</div><div className="sb">{n0(mm.pop)} {tx("hab.")}</div></div>
                    <span className="ocup">{v != null && <i className="swatch" style={{ background: indMun === 0 ? corOcupacao(v) : corSeq((v - mLo) / ((mHi - mLo) || 1)) }} />}{v != null ? INDM[indMun].fmt(v) : '—'}</span>
                    <span className="ex" />
                  </div>
                ))}
              </div>
            </>
          )}
                </>
              ) : (
                <>
<div className="sec-t">{tx("Linha do tempo")}
            <span className="lg"><i style={{ background: 'var(--text-1)' }} />{tx("observado")} <i style={{ background: 'var(--prev)' }} />{tx("previsão")} <i className="tr" />{tx("meta 85%")}</span></div>
          <Leque d={lequeD} altura={170} compacto />

          <div className="sec-t">{rEsc ? tx("Hospitais · {0}", rEsc.nome) : drsLista ? tx("Hospitais · {0}", n.drs.find((x) => x.id === drsLista)?.nome) : tx("Hospitais mais ocupados")}
            <span>{tx("média dos últimos 12 meses")}</span></div>
          <div className="rlist">
            {hospMostrar.length === 0 && <div className="muted" style={{ fontSize: 12, padding: '4px 8px' }}>{tx("Nenhum hospital com leitos deste tipo neste recorte.")}</div>}
            {(verMaisHosp ? hospMostrar : hospMostrar.slice(0, 5)).map(({ x, oc }) => (
              <div key={x.cnes} className={`rrow ${hospSel === x.cnes ? 'sel' : ''}`} onClick={() => irAoHospital(x)}>
                <div><div className="nm">{x.nome.length > 34 ? x.nome.slice(0, 33) + '…' : x.nome}</div><div className="sb">{x.municipio} · {L(x)} {tx("leitos ·")} {folga(Cn(x), L(x))?.curto}</div></div>
                <span className="ocup"><i className="swatch" style={{ background: corOcupacao(oc) }} />{pct(oc)}</span>
                <span className="ex">{oc >= 0.9 && <span className="alerta" title={tx("Ocupação média acima de 90%")}>▲</span>}</span>
              </div>
            ))}
          </div>
          {hospMostrar.length > 5 && <button className="vermais" onClick={() => setVerMaisHosp(!verMaisHosp)}>{verMaisHosp ? tx("Ver menos") : tx("Ver mais (+{0})", hospMostrar.length - 5)}</button>}
          {hospMostrar.some((h) => h.oc > 1.5) && <div className="muted" style={{ fontSize: 11, padding: '6px 0 0' }}>{tx("Valores acima de 150% costumam indicar leitos subnotificados no CNES, e não superlotação real.")}</div>}
          {regSel == null && hospLista.length > hospMostrar.length && <div className="muted" style={{ fontSize: 11, padding: '6px 0 0' }}>{tx("Ranking dos mais ocupados (≥ 20 leitos). Selecione uma região para ver todos os hospitais dela.")}</div>}

          <div className="sec-t">{drsLista ? tx("Regiões · {0}", n.drs.find((x) => x.id === drsLista)?.nome) : tx("Regiões do estado")}
            <span>{obs ? tx("por ocupação") : tx("ocupação · P(>90%) em 4 sem.")}</span></div>
          <div className="rlist">
            {(verMaisReg ? lista : lista.slice(0, 5)).map((x) => (
              <div key={x.r.id}
                className={`rrow ${regSel === x.r.id ? 'sel' : ''}`}
                onClick={() => set({ escopo: regSel === x.r.id ? { tipo: 'estado' } : { tipo: 'regiao', id: x.r.id } })}>
                <div><div className="nm">{x.r.nome}</div><div className="sb">{n.drs.find((dd) => dd.id === x.r.drs)?.nome} · {n0(x.c)} {tx("leitos")}</div></div>
                <span className="ocup"><i className="swatch" style={{ background: corOcupacao(x.ocup) }} />{pct(x.ocup)}</span>
                <span className="ex" style={{ fontWeight: !obs && x.pmax >= 0.5 ? 700 : 400 }}>{obs ? (() => { const f = folga(dados[x.i].m, x.c); return f ? <span className={f.acima ? 'ac' : 'lv'}>{f.curto}</span> : ''; })() : pct(x.pmax)}</span>
              </div>
            ))}
          </div>
          {lista.length > 5 && <button className="vermais" onClick={() => setVerMaisReg(!verMaisReg)}>{verMaisReg ? tx("Ver menos") : tx("Ver mais (+{0})", lista.length - 5)}</button>}
                          </>
              )}
              <div className="muted" style={{ fontSize: 11, marginTop: 12 }}>
            {tx("Modelo sincronizado em")} {dataBR(sync)} {tx("· SIH até")} {String(n.meta.competencia).replace(/(\d{4})(\d{2})/, '$2/$1')}
          </div>
            </>
          )}
        </div>
      </aside>

      {/* filtros do mapa */}
      <div className="pano-top" ref={popRef}>
        <div className="filt-row">
          {!painel && (
            <button className="pano-reopen float" onClick={() => setPainel(true)} aria-label={tx("Abrir painel")}>
              <span className="ghost">{I.seta}</span>
              <span className="num">{pct(taxa, 0)}</span><span className="muted" style={{ fontWeight: 400 }}>{tx("Resumo")}</span>
            </button>
          )}
          <div className="busca" ref={buscaRef}>
            <label className="apill busca-in">
              <span className="ico">{I.busca}</span>
              <input ref={buscaInput} value={q} placeholder={tx("Buscar região, município ou hospital")} aria-label={tx("Buscar")} spellCheck={false}
                onFocus={() => setBuscaAberta(true)} onChange={(e) => { setQ(e.target.value); setIdxB(0); setBuscaAberta(true); }}
                onKeyDown={(e) => {
                  if (e.key === 'ArrowDown') { e.preventDefault(); setIdxB((i) => Math.min(i + 1, resultados.length - 1)); }
                  else if (e.key === 'ArrowUp') { e.preventDefault(); setIdxB((i) => Math.max(i - 1, 0)); }
                  else if (e.key === 'Enter' && resultados[idxB]) escolher(resultados[idxB]);
                  else if (e.key === 'Escape') { setQ(''); setBuscaAberta(false); buscaInput.current?.blur(); }
                }} />
              {!q && !buscaAberta && <kbd>/</kbd>}
            </label>
            {buscaAberta && q.trim().length >= 2 && (
              <div className="busca-res float" role="listbox">
                {resultados.length === 0 && <div className="muted" style={{ padding: '10px 12px', fontSize: 12.5 }}>{tx("Nenhum resultado para “")}{q}”.</div>}
                {resultados.map((res, i) => (
                  <button key={`${res.tipo}-${res.id}`} role="option" aria-selected={i === idxB} className={`bres ${i === idxB ? 'on' : ''}`}
                    onMouseEnter={() => setIdxB(i)} onClick={() => escolher(res)}>
                    <b>{res.nome.length > 44 ? res.nome.slice(0, 43) + '…' : res.nome}</b><span>{res.sub}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <button className={`apill drop ${filtros ? 'ativo' : ''}`} onClick={() => setFiltros(!filtros)} aria-expanded={filtros}>
            <span className="ico">{I.filtro}</span>{tx("Filtros")}{nFiltros > 0 && <span className="count">{nFiltros}</span>}
          </button>
          <div className="tipo-dd" ref={tipoRef}>
            <button className="apill drop" aria-haspopup="listbox" aria-expanded={tipoMenu} onClick={() => setTipoMenu(!tipoMenu)}>
              <i className="swatch" style={{ background: corTipo(g) }} />{grupoAtual.nome}<span className="chev">{I.seta}</span>
            </button>
            {tipoMenu && (
              <div className="menu float" role="listbox" aria-label={tx("Tipo de internação")}>
                <button role="option" aria-selected={geral} className={geral ? 'on' : ''} onClick={() => { setG(-1); setTipoMenu(false); }}>
                  <i className="swatch" style={{ background: corTipo(-1) }} />{tx("Geral (todos os tipos)")}{geral && <span className="ck">✓</span>}
                </button>
                {n.grupos.map((x, i) => (
                  <button key={x.id} role="option" aria-selected={i === g} className={i === g ? 'on' : ''} onClick={() => { setG(i); setTipoMenu(false); }}>
                    <i className="swatch" style={{ background: corGrupo(i) }} />{x.nome}{i === g && <span className="ck">✓</span>}
                  </button>
                ))}
              </div>
            )}
          </div>
          <button className="apill drop tog" role="switch" aria-checked={modo3d} title={tx("Relevo 3D (os hospitais passam a aparecer como prédios)")} onClick={() => setModo3d(!modo3d)}>
            {tx("3D")}<span className={`sw swm ${modo3d ? 'on' : ''}`} aria-hidden />
          </button>
          <button className="apill drop tog" role="switch" aria-checked={verHosp} onClick={() => setVerHosp(!verHosp)}>
            {tx("Hospitais")}<span className={`sw swm ${verHosp ? 'on' : ''}`} aria-hidden />
          </button>
          {escopo.tipo !== 'estado' && <span className="apill">{escopo.tipo === 'drs' ? `DRS ${n.drs.find((x) => x.id === escopo.id)?.nome}` : tx("Região {0}", rEsc?.nome)}
            <button aria-label={tx("Limpar território")} onClick={() => set({ escopo: { tipo: 'estado' } })}>×</button></span>}
          {porte !== 'todos' && <span className="apill">{PORTES.find((x) => x[0] === porte)![1]}<button aria-label={tx("Limpar porte")} onClick={() => setPorte('todos')}>×</button></span>}
          {nivel !== 'todas' && <span className="apill">{tx("Ocupação")} {NIVEIS.find((x) => x[0] === nivel)![1]}<button aria-label={tx("Limpar nível")} onClick={() => setNivel('todas')}>×</button></span>}
          {verHosp && criticos && <span className="apill">{tx("Hospitais críticos")}<button aria-label={tx("Limpar críticos")} onClick={() => setCriticos(false)}>×</button></span>}
          {verHosp && esfera !== 'todas' && <span className="apill">{esfera === 'MUNICIPAL' ? tx("Hosp. municipais") : tx("Hosp. estaduais")}<button aria-label={tx("Limpar esfera")} onClick={() => setEsfera('todas')}>×</button></span>}
          <span style={{ flex: 1 }} />
          <button className="iconbtn float" aria-label={tx("Alternar tema")} onClick={() => set({ tema: tema === 'dark' ? 'light' : 'dark' })}>{tema === 'dark' ? I.sol : I.lua}</button>
        </div>
        {filtros && (
          <div className="filtros float" role="dialog" aria-label={tx("Filtros do mapa")}>
            <h4>{tx("Tipo de internação")} <em>{tx("leito SUS")}</em></h4>
            <div className="fgrid">
              <button className={`chip ${geral ? 'on' : ''}`} onClick={() => setG(-1)}>
                <i className="swatch" style={{ background: corTipo(-1), marginRight: 6 }} />{tx("Geral")}
              </button>
              {n.grupos.map((x, i) => (
                <button key={x.id} className={`chip ${i === g ? 'on' : ''}`} onClick={() => setG(i)}>
                  <i className="swatch" style={{ background: corGrupo(i), marginRight: 6 }} />{x.nome}
                </button>
              ))}
            </div>

            <h4>{tx("Faixa etária")} <em>{tx("em breve")}</em></h4>
            <div className="fgrid">{FAIXAS.map((f) => <button key={f} className="chip" disabled title={tx("Exige reprocessar o SIH por faixa etária")}>{f}</button>)}</div>
            <div className="fnote">{tx("O gêmeo hoje modela o censo por região e tipo de leito. Para filtrar por idade, o pipeline precisa gerar essas séries por faixa.")}</div>

            <h4>{tx("Território")} <em>{tx("DRS")}</em></h4>
            <div className="fgrid">
              <button className={`chip ${escopo.tipo === 'estado' ? 'on' : ''}`} onClick={() => set({ escopo: { tipo: 'estado' } })}>{tx("Estado todo")}</button>
              {n.drs.map((x) => (
                <button key={x.id} title={`DRS ${x.id}`} className={`chip ${escopo.tipo === 'drs' && escopo.id === x.id ? 'on' : ''}`}
                  onClick={() => set({ escopo: escopo.tipo === 'drs' && escopo.id === x.id ? { tipo: 'estado' } : { tipo: 'drs', id: x.id } })}>{x.nome}</button>
              ))}
            </div>

            <h4>{tx("Nível de ocupação")} <em>{tx("na data da régua")}</em></h4>
            <div className="fgrid">
              {NIVEIS.map(([v, t]) => <button key={v} className={`chip ${nivel === v ? 'on' : ''}`} disabled={v === 'risco' && obs}
                title={v === 'risco' && obs ? tx("Disponível ao escolher uma data de previsão") : undefined} onClick={() => setNivel(v)}>{t}</button>)}
            </div>

            <h4>{tx("Porte da região")} <em>{tx("leitos SUS do tipo escolhido")}</em></h4>
            <div className="fgrid">{PORTES.map(([v, t]) => <button key={v} className={`chip ${porte === v ? 'on' : ''}`} onClick={() => setPorte(v)}>{t}</button>)}</div>
            <div className="fnote">{tx("O porte também recorta os totais do painel; o nível de ocupação só filtra a lista e destaca o mapa.")}</div>

            {verHosp && (
              <>
                <h4>{tx("Hospitais")} <em>{tx("média de 12 meses")}</em></h4>
                <div className="frow"><span>{tx("Só críticos (ocupação ≥ 90%)")}</span><button className={`sw ${criticos ? 'on' : ''}`} role="switch" aria-checked={criticos} aria-label={tx("Só hospitais críticos")} onClick={() => setCriticos(!criticos)} /></div>
                <h4>{tx("Estilo dos hospitais")}</h4>
                <div className="fgrid">
                  <button className={`chip ${estiloHosp === 'objetivo' ? 'on' : ''}`} onClick={() => setEstiloHosp('objetivo')}>{tx("Objetivo")}</button>
                  <button className={`chip ${estiloHosp === 'ilustrativo' ? 'on' : ''}`} onClick={() => setEstiloHosp('ilustrativo')}>{tx("Ilustrativo (miniaturas)")}</button>
                </div>
                <div className="fnote">{tx("Objetivo: círculos com área proporcional aos leitos, cor pela ocupação e anel vermelho acima de 90%, agrupados por zoom. Com o relevo 3D ligado, os hospitais aparecem como prédios.")}</div>
                <h4>{tx("Esfera do hospital")}</h4>
                <div className="fgrid">
                  {([['todas', tx("Todas")], ['MUNICIPAL', tx("Municipal")], ['ESTADUAL', tx("Estadual")]] as const).map(([v, t]) =>
                    <button key={v} className={`chip ${esfera === v ? 'on' : ''}`} onClick={() => setEsfera(v)}>{t}</button>)}
                </div>
              </>
            )}
            <div className="ffoot">
              <button className="btn" disabled={nFiltros === 0} onClick={() => { set({ escopo: { tipo: 'estado' } }); setNivel('todas'); setPorte('todos'); setEsfera('todas'); setCriticos(false); }}>{tx("Limpar filtros")}</button>
              <button className="btn primary" onClick={() => setFiltros(false)}>{tx("Pronto")}</button>
            </div>
          </div>
        )}
      </div>

      {/* máquina do tempo */}
      <section className={`pano-time float ${tempo ? '' : 'recolhida'}`} aria-label={tx("Máquina do tempo")}>
        {rEsc && (
          <button className={`foco-btn foco-flut float ${focar ? 'on' : ''}`} onClick={() => setFocar(!focar)} aria-pressed={focar}
            title={focar ? tx("Voltar a mostrar o estado todo") : tx("Mostrar só esta região, com zoom")}>
            <span className="ico">{I.panorama}</span>{focar ? tx("Sair do foco") : tx("Enfocar região")}
          </button>
        )}
        <div className="time-row">
          <button className="iconbtn" style={{ width: 40, height: 40, borderRadius: 12 }} aria-label={tocando ? tx("Pausar") : tx("Reproduzir")} onClick={alternarPlay}>{tocando ? I.pause : I.play}</button>
          <div>
            <div className="time-date num">{dataBR(d)}</div>
            <span className={`badge ${obs ? '' : 'prev'}`}>{obs ? (diffDias(d, sync) === 0 ? tx("Último dado") : tx("Observado")) : tx("Previsão")}</span>
          </div>
          <button className="btn" onClick={() => setPasso((passo + 1) % PASSOS.length)} title={tx("Velocidade da reprodução")}>{PASSOS[passo] / 7}×</button>
          <button className="btn" onClick={() => irPara(sync)}>{tx("Último dado")}</button>
          <button className="btn" onClick={() => irPara(hoje)}>{tx("Hoje")}</button>
          <div className="legend-inline">
            {foco != null && municipiosFoco ? (
              <>
                <b style={{ color: 'var(--text-1)', fontWeight: 600 }}>{tx("Municípios ·")} {INDM[indMun].nome}</b>
                <div className="ramp" style={{ background: indMun === 0 ? gradienteOcupacao() : gradienteSeq() }} />
                <div className="ticks">{indMun === 0
                  ? <><span>45%</span><span>65%</span><span>85%</span><span>100%</span><span>115%</span></>
                  : <><span>{INDM[indMun].fmt(mLo)}</span><span>{INDM[indMun].fmt((mLo + mHi) / 2)}</span><span>{INDM[indMun].fmt(mHi)}</span></>}</div>
              </>
            ) : (
              <>
                <b style={{ color: 'var(--text-1)', fontWeight: 600 }}>{tx("Ocupação ·")} {grupoAtual.nome}</b>
                <div className="ramp" style={{ background: gradienteOcupacao() }} />
                <div className="ticks"><span>45%</span><span>65%</span><span>85%</span><span>100%</span><span>115%</span></div>
              </>
            )}
            {verHosp && estiloMapa === 'gestor' && <div className="lg-hosp"><i className="c" />{tx("hospital (área ∝ leitos)")} <i className="c al" />{tx("≥ 90% (média 12m)")}</div>}
          </div>
          <button className={`ghost time-toggle ${tempo ? '' : 'fechada'}`} aria-label={tempo ? tx("Recolher máquina do tempo") : tx("Expandir máquina do tempo")}
            title={tempo ? tx("Recolher") : tx("Expandir")} onClick={() => setTempo(!tempo)}>{I.seta}</button>
        </div>
        {tempo && <div className="ruler">
          <div className="prevzone" style={{ left: pctX(sync) }} />
          <svg viewBox="0 0 1000 58" preserveAspectRatio="none" aria-hidden>
            <line x1="0" x2="1000" y1={perfil.y90} y2={perfil.y90} stroke="var(--critical)" strokeOpacity="0.55" strokeDasharray="4 4" vectorEffect="non-scaling-stroke" />
            <path d={perfil.obs} fill="none" stroke="var(--text-2)" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
            <path d={perfil.prev} fill="none" stroke="var(--text-1)" strokeWidth="1.5" strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />
          </svg>
          {anos.map((a) => <span key={a} className="yr" style={{ left: pctX(parseData(`${a}-01-01`)) }}>{a}</span>)}
          <div className="mk" style={{ left: pctX(sync) }}><span>{tx("último dado · previsão →")}</span></div>
          <input type="range" min={0} max={total} value={Math.max(0, Math.min(total, diffDias(d, ini)))} aria-label={tx("Data")}
            onChange={(e) => irPara(addDias(ini, Number(e.target.value)))} />
        </div>}
      </section>
    </div>
  );
}
