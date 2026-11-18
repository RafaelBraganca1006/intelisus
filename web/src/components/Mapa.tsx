import { tx } from '../i18n';
import maplibregl, { type MapGeoJSONFeature } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { corOcupacao, lerVar, paradasOcupacao } from '../lib/cores';
import { useStore } from '../store';

export type Camada = 'regioes' | 'municipios';

interface Props {
  camada: Camada;
  cores: Map<number, string>;
  alturas?: Map<number, number>;
  modo3d?: boolean;
  pontos?: GeoJSON.FeatureCollection | null;   // props: id, cor, raio (+ alt: altura da região, para o estilo 'hospital' em 3D)
  estiloPontos?: 'bolha' | 'hospital' | 'gestor'; // 'gestor': marcadores planos agrupados, com anel de alerta; 'hospital': miniaturas (3D e 2D)
  pontoSel?: number | null;                      // hospital selecionado (anel branco)
  alvo?: { lon: number; lat: number; z: number; n: number } | null; // leva a câmera até um ponto (n muda a cada pedido)
  linhas?: GeoJSON.FeatureCollection | null;   // props: w, cor, op
  animarLinhas?: boolean;
  selecionado?: number | null;
  destacados?: Set<number> | null;
  altura?: number | string;
  tooltip?: (tipo: 'area' | 'ponto' | 'cluster', id: number, props?: Record<string, any>) => ReactNode;
  onClick?: (tipo: 'area' | 'ponto', id: number) => void;
  onDblClick?: (tipo: 'area', id: number) => void; // duplo clique numa área (desativa o zoom padrão do duplo clique)
  municipiosFoco?: Map<number, string> | null;   // com foco: desenha os municípios da região nestas cores (no lugar do preenchimento da região)
  munSel?: number | null;                        // município selecionado
  foco?: number | null;                          // região em foco: só ela fica no mapa e a câmera aproxima
  semDestaqueHover?: boolean;                    // não contorna a região sob o cursor (só o tooltip)
  hoverId?: number | null;                       // destaque vindo de fora (ex.: linha da lista)
  onHover?: (id: number | null) => void;         // região sob o cursor no mapa
  padding?: maplibregl.PaddingOptions | number;  // margem da câmera (áreas cobertas por painéis)
  children?: ReactNode;
}

const carregado = (m: maplibregl.Map | null): m is maplibregl.Map => !!m && !!(m as unknown as { __pronto?: boolean }).__pronto;

const rgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
function misturar(a: string, b: string, t: number) {
  if (!/^#[0-9a-f]{6}$/i.test(a) || !/^#[0-9a-f]{6}$/i.test(b)) return a;
  const x = rgb(a), y = rgb(b);
  return '#' + x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, '0')).join('');
}

const PONTOS = ['pts', 'hp3-ext', 'hp2-sym', 'hg-cluster', 'hg-pt'];
const ALERTA = '#ffb21e'; // âmbar: sinal de atenção que se destaca sobre o azul sem parecer erro
const VAZIO: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };

const claro = (hex: string) => /^#[0-9a-f]{6}$/i.test(hex) && (([r, g, b]) => 0.299 * r + 0.587 * g + 0.114 * b)(rgb(hex)) > 150;

/** Tom da mesma cor para detalhes (cruz, janelas): mais claro sobre cor escura e mais escuro sobre cor clara. */
const tom = (cor: string) => (claro(cor) ? misturar(cor, '#0b1f3d', 0.62) : misturar(cor, '#ffffff', 0.78));

/** Miniatura de hospital (vista frontal): ala esquerda, torre central com cruz, ala direita, porta e janelas. Cada hospital em uma cor só (a da ocupação), com detalhes em tons dela; cache por cor. */
function iconeHospital(m: maplibregl.Map, cor: string, n = 1) {
  const nome = `hosp-${cor}-${n}`;
  if (m.hasImage(nome)) return nome;
  const T = 64, c = document.createElement('canvas');
  c.width = c.height = T;
  const g = c.getContext('2d')!;
  const rr = (x: number, y: number, w: number, h: number, r: number) => { g.beginPath(); g.roundRect(x, y, w, h, r); };
  const jan = claro(cor) ? 'rgba(11,31,61,0.45)' : 'rgba(255,255,255,0.55)';
  g.shadowColor = 'rgba(0,0,0,0.4)'; g.shadowBlur = 4; g.shadowOffsetY = 1.5;
  g.fillStyle = cor;
  rr(5, 30, 18, 24, 3); g.fill();   // ala esquerda
  rr(41, 30, 18, 24, 3); g.fill();  // ala direita
  rr(20, 9, 24, 45, 3.5); g.fill(); // torre central
  g.shadowColor = 'transparent';
  g.fillStyle = jan;
  for (const [x, y] of [[9, 35], [9, 43], [47, 35], [47, 43]]) { rr(x, y, 8, 4.5, 1); g.fill(); }  // janelas das alas
  for (const y of [28, 36, 44]) { rr(25, y, 5.5, 5, 1); g.fill(); rr(33.5, y, 5.5, 5, 1); g.fill(); }  // janelas da torre
  rr(28, 46, 8, 8, 2); g.fill();     // porta
  g.fillStyle = tom(cor);
  rr(28.5, 12.5, 7, 17, 1.5); g.fill();   // haste vertical
  rr(23.5, 17.5, 17, 7, 1.5); g.fill();   // haste horizontal
  if (n > 1) { // complexo com várias unidades: selo com a contagem
    g.shadowColor = 'rgba(0,0,0,0.4)'; g.shadowBlur = 3;
    g.beginPath(); g.arc(50, 14, 11, 0, Math.PI * 2); g.fillStyle = '#ffffff'; g.fill();
    g.shadowColor = 'transparent'; g.fillStyle = '#0b1f3d'; g.font = '700 15px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(String(Math.min(n, 99)), 50, 14.5);
  }
  m.addImage(nome, g.getImageData(0, 0, T, T), { pixelRatio: 2 });
  return nome;
}

/** Hospitais em 3D: edifício vertical em massas escalonadas (base baixa, torre estreita, anexo mais baixo), faixas de janelas
 *  em todas as fachadas, caixa técnica, marquise e cruz deitada no telhado do anexo. Cada hospital gira num ângulo próprio.
 *  Tamanho fixo em relação ao mapa; base sobre a coluna da região. Também gera um anel de destaque (hover) por hospital. */
function hospitais3d(fs: GeoJSON.Feature[]): { corpo: GeoJSON.FeatureCollection; aneis: GeoJSON.FeatureCollection } {
  const corpo: GeoJSON.Feature[] = [], aneis: GeoJSON.Feature[] = [];
  // afasta levemente hospitais muito próximos (repulsão limitada) para que cada prédio possa crescer
  const orig = fs.map((f) => { const [lo, la] = (f.geometry as GeoJSON.Point).coordinates; return [lo * Math.cos((la * Math.PI) / 180), la]; });
  const xy = orig.map(([x, y]) => [x, y]);
  const D0 = 0.07, MAXD = 0.07;
  for (let it = 0; it < 30; it++) {
    const dx = xy.map(() => [0, 0]);
    for (let i = 0; i < xy.length; i++) for (let j = i + 1; j < xy.length; j++) {
      let ex = xy[j][0] - xy[i][0], ey = xy[j][1] - xy[i][1], d = Math.hypot(ex, ey);
      if (d >= D0) continue;
      if (d < 1e-6) { const a = (i * 2.399963) % (2 * Math.PI); ex = Math.cos(a); ey = Math.sin(a); d = 1; } // coincidentes: direção determinística
      const f = ((D0 - Math.min(d, D0)) / 2) * 0.5 / d;
      dx[i][0] -= ex * f; dx[i][1] -= ey * f; dx[j][0] += ex * f; dx[j][1] += ey * f;
    }
    for (let i = 0; i < xy.length; i++) {
      xy[i][0] += dx[i][0]; xy[i][1] += dx[i][1];
      const ox = xy[i][0] - orig[i][0], oy = xy[i][1] - orig[i][1], dd = Math.hypot(ox, oy);
      if (dd > MAXD) { xy[i][0] = orig[i][0] + (ox / dd) * MAXD; xy[i][1] = orig[i][1] + (oy / dd) * MAXD; }
    }
  }
  // distância ao vizinho mais próximo (graus), já com o afastamento: limita o tamanho de cada prédio
  const vizinho = xy.map(([x, y], i) => {
    let d2 = Infinity;
    for (let j = 0; j < xy.length; j++) if (j !== i) { const dx = xy[j][0] - x, dy = xy[j][1] - y, q = dx * dx + dy * dy; if (q < d2) d2 = q; }
    return Math.sqrt(d2);
  });
  for (const [k, f] of fs.entries()) {
    const lat = xy[k][1], lon = xy[k][0] / Math.cos((((f.geometry as GeoJSON.Point).coordinates[1]) * Math.PI) / 180);
    const pr = f.properties as { id: number; cor: string; raio?: number; alt?: number; n?: number };
    const esc = Math.min(1.25, Math.max(0.8, (pr.raio ?? 8) / 11));
    const Lmax = 0.1 * esc;                                      // largura de referência em graus de latitude
    const L = Math.max(0.3 * Lmax, Math.min(Lmax, vizinho[k] * 1.05));
    const u = L * 111000;                                        // metros (referência das alturas)
    const hy = L / 2, hx = hy / Math.cos((lat * Math.PI) / 180);
    const ang = ((pr.id * 137) % 360) * (Math.PI / 180), co = Math.cos(ang), si = Math.sin(ang);
    const pt = (x: number, y: number): [number, number] => [lon + (x * co - y * si) * hx, lat + (x * si + y * co) * hy];
    const ret = (x0: number, x1: number, y0: number, y1: number) => [pt(x0, y0), pt(x1, y0), pt(x1, y1), pt(x0, y1), pt(x0, y0)];
    const b = pr.alt ?? 0, id = pr.id, cor = pr.cor, t = tom(cor), jan = misturar(cor, claro(cor) ? '#0b1f3d' : '#ffffff', 0.42);
    const P = (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, c = cor) =>
      corpo.push({ type: 'Feature', properties: { id, cor: c, base: b + z0 * u, top: b + z1 * u }, geometry: { type: 'Polygon', coordinates: [ret(x0, x1, y0, y1)] } });
    const E = 0.025, EM = 0.04;
    /** Fachada de um bloco: faixas de janelas contínuas + montantes verticais (formam as "janelas") + cornijas + platibanda. */
    const fachada = (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, andares: number, montantes: [number, number]) => {
      const dz = (z1 - z0 - 0.06) / andares;
      for (let i = 0; i < andares; i++) P(x0 - E, x1 + E, y0 - E, y1 + E, z0 + 0.04 + i * dz + dz * 0.2, z0 + 0.04 + i * dz + dz * 0.75, jan);
      const [nx, ny] = montantes, w = 0.012;
      for (let i = 0; i <= nx; i++) {            // montantes nas faces maiores (frente e fundos)
        const x = x0 + ((x1 - x0) * i) / nx;
        P(x - w, x + w, y0 - EM, y0 + 0.002, z0 + 0.03, z1 - 0.02);
        P(x - w, x + w, y1 - 0.002, y1 + EM, z0 + 0.03, z1 - 0.02);
      }
      for (let i = 1; i < ny; i++) {             // montantes nas laterais
        const y = y0 + ((y1 - y0) * i) / ny;
        P(x0 - EM, x0 + 0.002, y - w, y + w, z0 + 0.03, z1 - 0.02);
        P(x1 - 0.002, x1 + EM, y - w, y + w, z0 + 0.03, z1 - 0.02);
      }
      P(x0 - E, x1 + E, y0 - E, y1 + E, z1 - 0.025, z1 + 0.012, t);    // platibanda / cornija do topo
      P(x0 - E, x1 + E, y0 - E, y1 + E, z0 + (z1 - z0) / 2 - 0.01, z0 + (z1 - z0) / 2 + 0.012, t); // cornija intermediária
    };
    const [Tx0, Tx1, Ty0, Ty1] = [-0.55, 0.15, -0.32, 0.32];   // torre
    const [Ax0, Ax1, Ay0, Ay1] = [0.15, 0.7, -0.32, 0.2];      // anexo
    P(-0.7, 0.7, -0.5, 0.5, 0, 0.14);                          // base (pódio)
    P(Tx0, Tx1, Ty0, Ty1, 0.14, 0.85);                         // torre
    P(Ax0, Ax1, Ay0, Ay1, 0.14, 0.45);                         // anexo
    P(-0.7 - E, 0.7 + E, -0.5 - E, 0.5 + E, 0.03, 0.095, jan); // janelas do pódio
    P(-0.7 - E, 0.7 + E, -0.5 - E, 0.5 + E, 0.125, 0.14 + 0.012, t); // beiral do pódio
    fachada(Tx0, Tx1, Ty0, Ty1, 0.14, 0.85, 7, [5, 3]);        // torre: 7 andares
    fachada(Ax0, Ax1, Ay0, Ay1, 0.14, 0.45, 3, [3, 2]);        // anexo: 3 andares
    // topo da torre: caixa técnica, casa de máquinas, antena
    P(-0.42, -0.1, -0.2, 0.2, 0.85, 0.93);
    P(-0.04, 0.1, -0.12, 0.12, 0.85, 0.9);
    P(-0.27, -0.23, -0.02, 0.02, 0.93, 1.18, t);
    // entrada: marquise elevada sobre quatro pilares + degrau
    P(-0.32, 0.32, -0.78, -0.5, 0.085, 0.115);
    for (const x of [-0.3, 0.3]) for (const y of [-0.76, -0.54]) P(x - 0.018, x + 0.018, y - 0.018, y + 0.018, 0, 0.085, t);
    P(-0.2, 0.2, -0.56, -0.5, 0, 0.025, t);
    // complexo hospitalar (várias unidades no mesmo endereço): torres extras atrás, uma por unidade adicional (até 3)
    for (let i = 0; i < Math.min((pr.n ?? 1) - 1, 3); i++) {
      const x0 = -0.62 + i * 0.5, alt = 0.55 + 0.15 * ((i + 1) % 2);
      P(x0, x0 + 0.36, 0.5 + 0.02, 0.5 + 0.36, 0, alt);
      for (let k = 0; k < 4; k++) P(x0 - E, x0 + 0.36 + E, 0.5 + 0.02 - E, 0.5 + 0.36 + E, 0.08 + k * ((alt - 0.12) / 4) + 0.02, 0.08 + k * ((alt - 0.12) / 4) + 0.075, jan);
      P(x0 - E, x0 + 0.36 + E, 0.5 + 0.02 - E, 0.5 + 0.36 + E, alt - 0.02, alt + 0.01, t);
    }
    // heliponto no pódio e caixa d'água no anexo
    P(-0.42, -0.02, 0.35, 0.49, 0.14, 0.158, t);
    P(0.55, 0.66, 0.0, 0.14, 0.45, 0.56);
    // cruz deitada no telhado do anexo
    const cx = 0.38, cy = -0.1;
    P(cx - 0.17, cx + 0.17, cy - 0.04, cy + 0.04, 0.45 + 0.012, 0.5, t);
    P(cx - 0.045, cx + 0.045, cy - 0.15, cy + 0.15, 0.45 + 0.012, 0.5, t);
    // anel de destaque ao redor da base
    const ext = ret(-0.86, 0.86, -0.9, 0.62), int = ret(-0.72, 0.72, -0.52, 0.52).reverse();
    aneis.push({ type: 'Feature', properties: { id, base: b, top: b + 0.05 * u }, geometry: { type: 'Polygon', coordinates: [ext, int] } });
  }
  return { corpo: { type: 'FeatureCollection', features: corpo }, aneis: { type: 'FeatureCollection', features: aneis } };
}

const LIMITES: [[number, number], [number, number]] = [[-53.15, -25.35], [-44.15, -19.75]];

export function Mapa(p: Props) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const [pronto, setPronto] = useState(false);
  const [hover, setHover] = useState<{ tipo: 'area' | 'ponto' | 'cluster'; id: number; x: number; y: number; props?: Record<string, any> } | null>(null);
  const geo = useStore((s) => s.geo);
  const tema = useStore((s) => s.tema);
  const cb = useRef(p);
  cb.current = p;
  const hovered = useRef<number | null>(null);
  const camInicial = useRef(false);
  // trocar o tema recria o mapa (as cores vêm do estilo): a câmera é guardada e restaurada, sem zoom nem animação
  const camSalva = useRef<{ center: maplibregl.LngLat; zoom: number; bearing: number; pitch: number } | null>(null);
  const restVis = useRef(false), restFoco = useRef(false), restPad = useRef(false);
  const ultimoHover = useRef<number | null>(null);
  const hoverExt = useRef<number | null>(null);
  const hovPonto = useRef(-1);
  const hoveredSrc = useRef('reg');
  const hovChave = useRef('');


  useEffect(() => {
    if (!el.current || !geo) return;
    const m = new maplibregl.Map({
      container: el.current,
      style: { version: 8, sources: {}, layers: [{ id: 'bg', type: 'background', paint: { 'background-color': lerVar('--map-bg') } }] },
      ...(camSalva.current ? { center: camSalva.current.center, zoom: camSalva.current.zoom, bearing: camSalva.current.bearing, pitch: camSalva.current.pitch }
        : { bounds: LIMITES, fitBoundsOptions: { padding: cb.current.padding ?? 16 } }), attributionControl: false, dragRotate: true, doubleClickZoom: !cb.current.onDblClick, pitchWithRotate: true, touchPitch: true, keyboard: true,
      maxPitch: 65, minZoom: 5, maxZoom: 13,
    });
    map.current = m;
    if (camSalva.current) { restVis.current = restFoco.current = restPad.current = true; }
    // números dos grupos: imagens geradas sob demanda (o estilo não tem fontes)
    m.on('styleimagemissing', (e) => {
      const mt = /^c-(\d+)-(\d+)-([kn])$/.exec(e.id);
      if (!mt || m.hasImage(e.id)) return;
      const ratio = Number(mt[1]) / 20, n = Number(mt[2]), crit = mt[3] === 'k';
      const fill = corOcupacao(ratio), lg = Math.log2(Math.max(n, 2));
      const fontPx = 13 + Math.min(4, lg), alt = 28 + Math.min(12, lg * 2.6);
      const medidor = document.createElement('canvas').getContext('2d')!;
      medidor.font = tx("650 {0}px \"Geist Variable\", system-ui, sans-serif", fontPx);
      const dot = alt * 0.26, txt = Math.ceil(medidor.measureText(String(n)).width);
      const larg = Math.ceil(10 + dot * 2 + 7 + txt + 12), mg = 9;
      const c = document.createElement('canvas'); c.width = Math.ceil(larg + mg * 2); c.height = Math.ceil(alt + mg * 2);
      const g = c.getContext('2d')!;
      const rr = (x: number, y: number, w: number, h: number, r: number) => { g.beginPath(); g.roundRect(x, y, w, h, r); };
      g.shadowColor = 'rgba(6,16,38,0.45)'; g.shadowBlur = 8; g.shadowOffsetY = 2;
      rr(mg, mg, larg, alt, alt / 2); g.fillStyle = '#fbfcff'; g.fill();       // pílula branca, com sombra suave
      g.shadowColor = 'transparent';
      if (crit) { g.lineWidth = 2.2; g.strokeStyle = ALERTA; rr(mg - 4, mg - 4, larg + 8, alt + 8, alt / 2 + 4); g.stroke(); }
      g.beginPath(); g.arc(mg + 10 + dot, mg + alt / 2, dot, 0, Math.PI * 2); g.fillStyle = fill; g.fill();  // bolinha com a cor da ocupação
      g.font = medidor.font; g.textAlign = 'left'; g.textBaseline = 'middle'; g.fillStyle = '#0b1f3d';
      g.fillText(String(n), mg + 10 + dot * 2 + 7, mg + alt / 2 + 1);
      m.addImage(e.id, g.getImageData(0, 0, c.width, c.height), { pixelRatio: 2 });
    });
    if (import.meta.env.DEV) (window as unknown as { __mapa?: maplibregl.Map }).__mapa = m; // inspeção em desenvolvimento
    m.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    m.on('load', () => {
      const linha = lerVar('--map-line');
      m.addSource('reg', { type: 'geojson', data: geo.regioes, promoteId: 'regiao' });
      m.addSource('mun', { type: 'geojson', data: geo.municipios, promoteId: 'mun' });
      m.addSource('drs', { type: 'geojson', data: geo.drs });
      m.addSource('lin', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      m.addSource('pts', { type: 'geojson', data: { type: 'FeatureCollection', features: [] }, promoteId: 'id' });
      m.addSource('hp2', { type: 'geojson', data: VAZIO });
      m.addSource('hp3', { type: 'geojson', data: VAZIO });
      m.addSource('hp3r', { type: 'geojson', data: VAZIO });
      m.addSource('hg', { type: 'geojson', data: VAZIO, cluster: true, clusterRadius: 42, clusterMaxZoom: 11,
        clusterProperties: { leitos: ['+', ['get', 'leitos']], censo: ['+', ['get', 'censo']], crit: ['+', ['get', 'crit']] } });
      const cor = ['coalesce', ['feature-state', 'cor'], lerVar('--surface-3')];
      for (const [id, src] of [['reg', 'reg'], ['mun', 'mun']] as const) {
        m.addLayer({ id: `${id}-fill`, type: 'fill', source: src, layout: { visibility: 'none' },
          paint: { 'fill-color': cor as any, 'fill-opacity': ['case', ['boolean', ['feature-state', 'apagado'], false], 0.35, 0.92] as any } });
        m.addLayer({ id: `${id}-ext`, type: 'fill-extrusion', source: src, layout: { visibility: 'none' },
          paint: { 'fill-extrusion-color': ['case', ['boolean', ['feature-state', 'hover'], false], ['coalesce', ['feature-state', 'corHov'], ['feature-state', 'cor'], lerVar('--surface-3')], cor] as any,
            'fill-extrusion-height': ['coalesce', ['feature-state', 'alt'], 0] as any,
            'fill-extrusion-opacity': 0.92, 'fill-extrusion-vertical-gradient': true } });
        m.addLayer({ id: `${id}-line`, type: 'line', source: src, layout: { visibility: 'none' },
          paint: { 'line-color': linha, 'line-width': id === 'reg' ? 0.8 : 0.5 } });
        m.addLayer({ id: `${id}-hl`, type: 'line', source: src, layout: { visibility: 'none' },
          paint: { 'line-color': lerVar('--text-1'), 'line-width': ['case', ['boolean', ['feature-state', 'sel'], false], 2.4,
            ['boolean', ['feature-state', 'hover'], false], 2.4, 0] as any } });
      }
      m.addLayer({ id: 'drs-line', type: 'line', source: 'drs', paint: { 'line-color': lerVar('--text-3'), 'line-width': 1.1, 'line-opacity': 0.55 } });
      m.addLayer({ id: 'lin-base', type: 'line', source: 'lin', layout: { 'line-cap': 'round' },
        paint: { 'line-color': ['get', 'cor'] as any, 'line-width': ['get', 'w'] as any, 'line-opacity': ['coalesce', ['get', 'op'], 0.35] as any } });
      m.addLayer({ id: 'lin-anim', type: 'line', source: 'lin', layout: { 'line-cap': 'round' },
        paint: { 'line-color': lerVar('--text-1'), 'line-width': ['*', ['get', 'w'], 0.6] as any, 'line-opacity': 0.75, 'line-dasharray': [0, 4, 3] } });
      m.addLayer({ id: 'pts', type: 'circle', source: 'pts',
        paint: { 'circle-color': ['get', 'cor'] as any, 'circle-radius': ['interpolate', ['linear'], ['zoom'], 5, ['*', ['get', 'raio'], 0.7], 10, ['*', ['get', 'raio'], 2.2]] as any,
          'circle-stroke-color': lerVar('--map-bg'), 'circle-stroke-width': 1.2, 'circle-opacity': 0.95 } });
      // marcadores planos (modo gestor): área ∝ leitos, cor = ocupação, anel de alerta ≥ 90%, agrupamento por zoom
      const ocup = ['/', ['get', 'censo'], ['max', ['get', 'leitos'], 1]];
      const corOcup = ['interpolate', ['linear'], ocup, ...paradasOcupacao().flatMap(([x, c]) => [x, c])] as any;
      const unit = ['!', ['has', 'point_count']] as any;
      // a expressão de zoom precisa ficar no topo do interpolate: por isso o raio é gerado já com multiplicador e acréscimo
      const r5 = ['min', 10, ['max', 4.5, ['*', ['sqrt', ['get', 'leitos']], 0.42]]], r11 = ['min', 26, ['max', 6.5, ['*', ['sqrt', ['get', 'leitos']], 1.2]]];
      const raioF = (k: number, a: number) => ['interpolate', ['linear'], ['zoom'], 5, ['+', ['*', r5, k], a], 11, ['+', ['*', r11, k], a]] as any;
            const vis = { visibility: 'none' } as const;
      // pontos: bolha de cor sólida com brilho suave, sem contorno; crítico (≥ 90%) ganha um anel fino afastado, como um alvo
      m.addLayer({ id: 'hg-glow', type: 'circle', source: 'hg', filter: unit, layout: vis,
        paint: { 'circle-radius': raioF(1.5, 0), 'circle-color': 'rgba(6,16,38,0.5)', 'circle-opacity': 0.55, 'circle-blur': 1, 'circle-translate': [0, 1.5] } });
      m.addLayer({ id: 'hg-pt', type: 'circle', source: 'hg', filter: unit, layout: vis,
        paint: { 'circle-radius': raioF(1, 0), 'circle-color': '#fbfcff', 'circle-opacity': 0.97 } });
      m.addLayer({ id: 'hg-core', type: 'circle', source: 'hg', filter: unit, layout: vis,
        paint: { 'circle-radius': raioF(0.62, 0), 'circle-color': corOcup } });
      m.addLayer({ id: 'hg-ring', type: 'circle', source: 'hg', filter: ['all', unit, ['>', ['get', 'crit'], 0]] as any, layout: vis,
        paint: { 'circle-radius': raioF(1, 5), 'circle-color': 'rgba(0,0,0,0)', 'circle-stroke-color': ALERTA, 'circle-stroke-width': 2.2, 'circle-stroke-opacity': 1 } });
      // grupos: pílulas arredondadas com o número (imagens geradas sob demanda, cor pela ocupação conjunta)
      const bin = ['round', ['*', ocup, 20]] as any;
      m.addLayer({ id: 'hg-cluster', type: 'symbol', source: 'hg', filter: ['has', 'point_count'], layout: { visibility: 'none',
        'icon-image': ['concat', 'c-', ['to-string', bin], '-', ['to-string', ['get', 'point_count']], '-', ['case', ['>', ['get', 'crit'], 0], 'k', 'n']] as any,
        'icon-allow-overlap': true, 'icon-ignore-placement': true } });
      // hover: brilho em volta do hospital e pílula do grupo levemente ampliada
      m.addLayer({ id: 'hg-hov', type: 'circle', source: 'hg', filter: ['==', ['get', 'id'], -1], layout: vis,
        paint: { 'circle-radius': raioF(1, 8), 'circle-color': '#ffffff', 'circle-opacity': 0.5, 'circle-blur': 0.55 } });
      m.addLayer({ id: 'hg-hov-cl', type: 'symbol', source: 'hg', filter: ['==', ['get', 'cluster_id'], -1], layout: { visibility: 'none',
        'icon-image': ['concat', 'c-', ['to-string', bin], '-', ['to-string', ['get', 'point_count']], '-', ['case', ['>', ['get', 'crit'], 0], 'k', 'n']] as any, 'icon-size': 1.16, 'icon-allow-overlap': true, 'icon-ignore-placement': true } });
      m.addLayer({ id: 'hg-sel', type: 'circle', source: 'hg', filter: ['==', ['get', 'id'], -1], layout: vis,
        paint: { 'circle-radius': raioF(1, 8.5), 'circle-color': 'rgba(0,0,0,0)', 'circle-stroke-color': lerVar('--text-1'), 'circle-stroke-width': 2 } });
      m.addLayer({ id: 'hp3-ext', type: 'fill-extrusion', source: 'hp3', layout: { visibility: 'none' },
        paint: { 'fill-extrusion-color': ['get', 'cor'] as any, 'fill-extrusion-base': ['get', 'base'] as any, 'fill-extrusion-height': ['get', 'top'] as any,
          'fill-extrusion-opacity': 1, 'fill-extrusion-vertical-gradient': true } });
      m.addLayer({ id: 'hp3-hov', type: 'fill-extrusion', source: 'hp3r', filter: ['==', ['get', 'id'], -1], layout: { visibility: 'none' },
        paint: { 'fill-extrusion-color': lerVar('--text-1'), 'fill-extrusion-base': ['get', 'base'] as any, 'fill-extrusion-height': ['get', 'top'] as any, 'fill-extrusion-opacity': 0.95 } });
      m.addLayer({ id: 'hp2-sym', type: 'symbol', source: 'hp2', layout: { visibility: 'none', 'icon-image': ['get', 'img'] as any,
        'icon-size': ['interpolate', ['linear'], ['zoom'], 5, ['*', ['get', 'sz'], 0.4], 10, ['*', ['get', 'sz'], 1.3]] as any,
        'icon-allow-overlap': true, 'icon-ignore-placement': true, 'symbol-sort-key': ['*', -1, ['get', 'raio']] as any } });
      m.addLayer({ id: 'hp2-hov', type: 'circle', source: 'hp2', filter: ['==', ['get', 'id'], -1], layout: { visibility: 'none' },
        paint: { 'circle-color': 'rgba(0,0,0,0)', 'circle-stroke-color': lerVar('--text-1'), 'circle-stroke-width': 2,
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 5, ['+', ['*', ['get', 'sz'], 6.4], 4], 10, ['+', ['*', ['get', 'sz'], 20.8], 4]] as any } });
      (m as unknown as { __pronto: boolean }).__pronto = true;
      setPronto(true);
    });

    const areaLayers = ['reg-fill', 'mun-fill', 'reg-ext', 'mun-ext'];
    const onMove = (e: maplibregl.MapMouseEvent) => {
      const f = m.queryRenderedFeatures(e.point, { layers: [...PONTOS, ...areaLayers].filter((l) => m.getLayer(l) && m.getLayoutProperty(l, 'visibility') !== 'none') });
      const pt = f.find((x) => PONTOS.includes(x.layer.id));
      const ar = f.find((x) => !PONTOS.includes(x.layer.id)) as MapGeoJSONFeature | undefined;
      const src = ar && ar.source ? String(ar.source) : cb.current.camada === 'regioes' ? 'reg' : 'mun';
      if (hovered.current != null) m.setFeatureState({ source: hoveredSrc.current, id: hovered.current }, { hover: false });
      hovered.current = null;
      const semHl = cb.current.semDestaqueHover;
      const idp = pt && pt.properties && !pt.properties.cluster ? Number(pt.properties.id) : -1; // contorno do hospital sob o cursor (2D e 3D)
      const chave = pt && pt.properties ? (pt.properties.cluster ? `c${pt.properties.cluster_id}` : `p${pt.properties.id}`) : '';
      if (chave !== hovChave.current && m.getLayer('hg-hov')) {
        hovChave.current = chave;
        m.setFilter('hg-hov', ['==', ['get', 'id'], chave.startsWith('p') ? Number(chave.slice(1)) : -1]);
        m.setFilter('hg-hov-cl', ['==', ['get', 'cluster_id'], chave.startsWith('c') ? Number(chave.slice(1)) : -1]);
      }
      if (idp !== hovPonto.current) {
        hovPonto.current = idp;
        const filtro = ['==', ['get', 'id'], idp] as any;
        if (m.getLayer('hp3-hov')) { m.setFilter('hp3-hov', filtro); m.setFilter('hp2-hov', filtro); }
      }
      if (pt && pt.properties) {
        const cl = !!pt.properties.cluster;
        setHover({ tipo: cl ? 'cluster' : 'ponto', id: Number(cl ? pt.properties.cluster_id : pt.properties.id), x: e.point.x, y: e.point.y, props: pt.properties });
        m.getCanvas().style.cursor = 'pointer';
      } else if (ar && ar.id != null) {
        if (!semHl) { hovered.current = Number(ar.id); hoveredSrc.current = src; m.setFeatureState({ source: src, id: ar.id }, { hover: true }); }
        setHover({ tipo: 'area', id: Number(ar.id), x: e.point.x, y: e.point.y });
        m.getCanvas().style.cursor = cb.current.onClick ? 'pointer' : '';
      } else { setHover(null); m.getCanvas().style.cursor = ''; }
      const novo = !pt && ar && ar.id != null ? Number(ar.id) : null;
      if (novo !== ultimoHover.current) { ultimoHover.current = novo; cb.current.onHover?.(novo); }
    };
    m.on('mousemove', onMove);
    m.on('mouseout', () => {
      setHover(null); ultimoHover.current = null; cb.current.onHover?.(null);
      hovPonto.current = -1; hovChave.current = '';
      if (m.getLayer('hg-hov')) { m.setFilter('hg-hov', ['==', ['get', 'id'], -1]); m.setFilter('hg-hov-cl', ['==', ['get', 'cluster_id'], -1]); }
      if (m.getLayer('hp3-hov')) { m.setFilter('hp3-hov', ['==', ['get', 'id'], -1]); m.setFilter('hp2-hov', ['==', ['get', 'id'], -1]); }
    });
    m.on('dblclick', (e) => {
      if (!cb.current.onDblClick) return;
      const f = m.queryRenderedFeatures(e.point, { layers: [...PONTOS, ...areaLayers].filter((l) => m.getLayer(l) && m.getLayoutProperty(l, 'visibility') !== 'none') });
      if (f.some((x) => PONTOS.includes(x.layer.id))) return;
      const ar = f.find((x) => !PONTOS.includes(x.layer.id));
      if (ar?.id != null) cb.current.onDblClick('area', Number(ar.id));
    });
    m.on('click', (e) => {
      const f = m.queryRenderedFeatures(e.point, { layers: [...PONTOS, ...areaLayers].filter((l) => m.getLayer(l) && m.getLayoutProperty(l, 'visibility') !== 'none') });
      const pt = f.find((x) => PONTOS.includes(x.layer.id));
      const ar = f.find((x) => !PONTOS.includes(x.layer.id));
      if (pt?.properties?.cluster) {
        const cid = Number(pt.properties.cluster_id), geom = pt.geometry as GeoJSON.Point;
        (m.getSource('hg') as maplibregl.GeoJSONSource).getClusterExpansionZoom(cid).then((z) => m.easeTo({ center: geom.coordinates as [number, number], zoom: Math.min(z + 0.3, 12), duration: 700 })).catch(() => {});
      } else if (pt?.properties) cb.current.onClick?.('ponto', Number(pt.properties.id));
      else if (ar?.id != null) cb.current.onClick?.('area', Number(ar.id));
    });
    const ro = new ResizeObserver(() => m.resize()); // painéis recolhíveis mudam a largura do mapa
    ro.observe(el.current);
    return () => { camSalva.current = { center: m.getCenter(), zoom: m.getZoom(), bearing: m.getBearing(), pitch: m.getPitch() }; ro.disconnect(); m.remove(); map.current = null; camInicial.current = false; focoAnt.current = null; setPronto(false); };
  }, [geo, tema]);

  // camada visível + 3D
  useEffect(() => {
    const m = map.current;
    if (!carregado(m) || !pronto) return;
    const src = p.camada === 'regioes' ? 'reg' : 'mun';
    const detalhe = p.foco != null && !!p.municipiosFoco; // região em foco com municípios desenhados dentro
    for (const id of ['reg', 'mun']) {
      const on = id === src, det = detalhe && id === 'mun';
      m.setLayoutProperty(`${id}-fill`, 'visibility', (on && !p.modo3d && !(detalhe && id === 'reg')) || det ? 'visible' : 'none');
      m.setLayoutProperty(`${id}-ext`, 'visibility', on && p.modo3d && !detalhe ? 'visible' : 'none');
      m.setLayoutProperty(`${id}-line`, 'visibility', (on && !p.modo3d) || det ? 'visible' : 'none');
      m.setLayoutProperty(`${id}-hl`, 'visibility', on || det ? 'visible' : 'none');
    }
    const hosp = p.estiloPontos === 'hospital', gest = p.estiloPontos === 'gestor';
    for (const l of ['hg-glow', 'hg-hov', 'hg-pt', 'hg-core', 'hg-ring', 'hg-cluster', 'hg-hov-cl', 'hg-sel']) m.setLayoutProperty(l, 'visibility', gest ? 'visible' : 'none');
    m.setLayoutProperty('pts', 'visibility', hosp || gest ? 'none' : 'visible');
    m.setLayoutProperty('hp3-ext', 'visibility', hosp && p.modo3d ? 'visible' : 'none');
    m.setLayoutProperty('hp2-sym', 'visibility', hosp && !p.modo3d ? 'visible' : 'none');
    m.setLayoutProperty('hp3-hov', 'visibility', hosp && p.modo3d ? 'visible' : 'none');
    m.setLayoutProperty('hp2-hov', 'visibility', hosp && !p.modo3d ? 'visible' : 'none');
    // rotação e inclinação só existem no relevo 3D; no mapa plano ficam travadas (mouse, toque e teclado)
    if (p.modo3d) { m.dragRotate.enable(); m.touchZoomRotate.enableRotation(); m.keyboard.enableRotation(); m.touchPitch.enable(); }
    else { m.dragRotate.disable(); m.touchZoomRotate.disableRotation(); m.keyboard.disableRotation(); m.touchPitch.disable(); }
    const alvo = { pitch: p.modo3d ? 52 : 0, bearing: p.modo3d ? -12 : 0 };
    // primeira aplicação: salto direto (animação pode não rodar com a aba em segundo plano); depois, transição suave
    if (restVis.current) { restVis.current = false; camInicial.current = true; } // câmera restaurada após trocar o tema
    else if (!camInicial.current) { m.jumpTo(alvo); camInicial.current = true; } else m.easeTo({ ...alvo, duration: 900 });
  }, [pronto, p.camada, p.modo3d, p.estiloPontos, p.foco, !!p.municipiosFoco]);

  // cores/alturas via feature-state
  useEffect(() => {
    const m = map.current;
    if (!carregado(m) || !pronto) return;
    const src = p.camada === 'regioes' ? 'reg' : 'mun';
    const fundo = lerVar('--map-bg');
    for (const [id, c] of p.cores) {
      const apagado = p.destacados ? !p.destacados.has(id) : false;
      // a camada 3D não aceita opacidade por feição: regiões fora do filtro ficam mescladas ao fundo (a altura não muda)
      m.setFeatureState({ source: src, id }, { cor: apagado ? misturar(c, fundo, 0.72) : c, corHov: misturar(apagado ? misturar(c, fundo, 0.72) : c, '#ffffff', 0.3), alt: p.alturas?.get(id) ?? 0, apagado });
    }
  }, [pronto, p.cores, p.alturas, p.camada, p.destacados, tema]);

  // margem da câmera acompanha os painéis abertos
  const padKey = JSON.stringify(p.padding ?? null);
  useEffect(() => {
    const m = map.current;
    if (!carregado(m) || !pronto || p.padding == null) return;
    if (restPad.current) { restPad.current = false; m.jumpTo({ padding: typeof p.padding === 'number' ? { top: p.padding, bottom: p.padding, left: p.padding, right: p.padding } : p.padding }); } else m.easeTo({ padding: p.padding, duration: 450 });
  }, [pronto, padKey]);

  // região em foco: só ela permanece no mapa e a câmera aproxima (e volta ao estado todo ao sair)
  const focoAnt = useRef<number | null>(null);
  useEffect(() => {
    const m = map.current;
    if (!carregado(m) || !pronto) return;
    const foco = p.foco ?? null;
    const restaurada = restFoco.current; restFoco.current = false; // câmera restaurada após trocar o tema: não reenquadrar
    if (foco === focoAnt.current) return;
    focoAnt.current = foco;
    const filtro = foco != null ? (['==', ['get', 'regiao'], foco] as any) : null;
    for (const l of ['reg-fill', 'reg-ext', 'reg-line', 'reg-hl', 'mun-fill', 'mun-line', 'mun-hl']) m.setFilter(l, filtro);
    m.setLayoutProperty('drs-line', 'visibility', foco != null ? 'none' : 'visible');
    let b: [[number, number], [number, number]] = LIMITES;
    if (foco != null && geo) {
      let x0 = 180, y0 = 90, x1 = -180, y1 = -90;
      const varre = (c: any) => { if (typeof c[0] === 'number') { x0 = Math.min(x0, c[0]); x1 = Math.max(x1, c[0]); y0 = Math.min(y0, c[1]); y1 = Math.max(y1, c[1]); } else c.forEach(varre); };
      for (const f of geo.regioes.features) if (f.properties?.regiao === foco) varre((f.geometry as any).coordinates);
      if (x0 < x1) b = [[x0, y0], [x1, y1]];
    }
    if (restaurada) return; // recriação do mapa (tema): mantém a câmera onde estava
    m.fitBounds(b, { padding: foco != null ? 70 : 16, duration: 1100, maxZoom: 10 });
  }, [pronto, p.foco]);

  // hospital selecionado: anel branco
  useEffect(() => {
    const m = map.current;
    if (!carregado(m) || !pronto) return;
    m.setFilter('hg-sel', ['==', ['get', 'id'], p.pontoSel ?? -1]);
  }, [pronto, p.pontoSel]);

  // levar a câmera até um ponto (clique na lista)
  const alvoN = p.alvo?.n ?? 0;
  useEffect(() => {
    const m = map.current;
    if (!carregado(m) || !pronto || !p.alvo) return;
    m.easeTo({ center: [p.alvo.lon, p.alvo.lat], zoom: Math.max(m.getZoom(), p.alvo.z), duration: 900 });
  }, [pronto, alvoN]);

  // destaque vindo de fora (lista → mapa)
  useEffect(() => {
    const m = map.current;
    if (!carregado(m) || !pronto) return;
    const src = p.camada === 'regioes' ? 'reg' : 'mun';
    if (hoverExt.current != null && hoverExt.current !== hovered.current) m.setFeatureState({ source: src, id: hoverExt.current }, { hover: false });
    hoverExt.current = p.hoverId ?? null;
    if (hoverExt.current != null) m.setFeatureState({ source: src, id: hoverExt.current }, { hover: true });
  }, [pronto, p.hoverId, p.camada]);

  // cores dos municípios da região em foco
  useEffect(() => {
    const m = map.current;
    if (!carregado(m) || !pronto || !p.municipiosFoco) return;
    for (const [id, c] of p.municipiosFoco) m.setFeatureState({ source: 'mun', id }, { cor: c });
  }, [pronto, p.municipiosFoco]);

  const munSelAnt = useRef<number | null>(null);
  useEffect(() => {
    const m = map.current;
    if (!carregado(m) || !pronto) return;
    if (munSelAnt.current != null) m.setFeatureState({ source: 'mun', id: munSelAnt.current }, { sel: false });
    munSelAnt.current = p.munSel ?? null;
    if (p.munSel != null) m.setFeatureState({ source: 'mun', id: p.munSel }, { sel: true });
  }, [pronto, p.munSel, p.foco]);

  const selAnt = useRef<{ src: string; id: number } | null>(null);
  useEffect(() => {
    const m = map.current;
    if (!carregado(m) || !pronto) return;
    if (selAnt.current) m.setFeatureState({ source: selAnt.current.src, id: selAnt.current.id }, { sel: false });
    selAnt.current = null;
    if (p.selecionado != null) {
      const src = p.camada === 'regioes' ? 'reg' : 'mun';
      m.setFeatureState({ source: src, id: p.selecionado }, { sel: true });
      selAnt.current = { src, id: p.selecionado };
    }
  }, [pronto, p.selecionado, p.camada]);

  useEffect(() => {
    const m = map.current;
    if (!carregado(m) || !pronto) return;
    const fs = p.pontos?.features ?? [];
    const set = (id: string, d: GeoJSON.FeatureCollection) => (m.getSource(id) as maplibregl.GeoJSONSource).setData(d);
    set('hg', p.estiloPontos === 'gestor' ? p.pontos ?? VAZIO : VAZIO);
    if (p.estiloPontos === 'gestor') { set('pts', VAZIO); set('hp2', VAZIO); set('hp3', VAZIO); set('hp3r', VAZIO); return; }
    if (p.estiloPontos !== 'hospital') { set('pts', p.pontos ?? VAZIO); set('hp2', VAZIO); set('hp3', VAZIO); set('hp3r', VAZIO); return; }
    set('pts', VAZIO);
    set('hp2', { type: 'FeatureCollection', features: fs.map((f) => {
      const pr = f.properties as { cor: string; raio: number; n?: number };
      return { ...f, properties: { ...pr, img: iconeHospital(m, pr.cor, pr.n ?? 1), sz: Math.min(1.25, Math.max(0.8, pr.raio / 12)) } };
    }) });
  }, [pronto, p.pontos, p.estiloPontos]);

  // prédios 3D: tamanho geográfico fixo, então acompanham o mapa ao dar zoom
  useEffect(() => {
    const m = map.current;
    if (!carregado(m) || !pronto || p.estiloPontos !== 'hospital' || !p.modo3d) return;
    const h3 = hospitais3d(p.pontos?.features ?? []);
    (m.getSource('hp3') as maplibregl.GeoJSONSource).setData(h3.corpo);
    (m.getSource('hp3r') as maplibregl.GeoJSONSource).setData(h3.aneis);
  }, [pronto, p.pontos, p.estiloPontos, p.modo3d]);

  useEffect(() => {
    const m = map.current;
    if (!carregado(m) || !pronto) return;
    (m.getSource('lin') as maplibregl.GeoJSONSource).setData(p.linhas ?? { type: 'FeatureCollection', features: [] });
    const op = p.linhas?.features.length ? 0.45 : 0.92;
    for (const id of ['reg-fill', 'mun-fill']) m.setPaintProperty(id, 'fill-opacity', ['case', ['boolean', ['feature-state', 'apagado'], false], 0.35 * op, op]);
    m.setLayoutProperty('lin-anim', 'visibility', p.animarLinhas ? 'visible' : 'none');
    if (!p.animarLinhas) return;
    // "formigas marchando": ciclo de dasharrays (padrão do exemplo oficial MapLibre)
    const seq = [[0, 4, 3], [0.5, 4, 2.5], [1, 4, 2], [1.5, 4, 1.5], [2, 4, 1], [2.5, 4, 0.5], [3, 4, 0],
      [0, 0.5, 3, 3.5], [0, 1, 3, 3], [0, 1.5, 3, 2.5], [0, 2, 3, 2], [0, 2.5, 3, 1.5], [0, 3, 3, 1], [0, 3.5, 3, 0.5]];
    let passo = -1, raf = 0, t0 = 0;
    const tick = (t: number) => {
      const s = Math.floor(t / 70) % seq.length;
      if (s !== passo && t - t0 > 60) { m.setPaintProperty('lin-anim', 'line-dasharray', seq[s]); passo = s; t0 = t; }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [pronto, p.linhas, p.animarLinhas]);

  return (
    <div className="mapbox" style={{ height: p.altura ?? 520 }}>
      <div ref={el} style={{ position: 'absolute', inset: 0 }} />
      {hover && p.tooltip && (
        <div className="tooltip" style={{ left: Math.min(hover.x + 14, (el.current?.clientWidth ?? 600) - 290), top: hover.y + 14 }}>
          {p.tooltip(hover.tipo, hover.id, hover.props)}
        </div>
      )}
      {p.children}
    </div>
  );
}

export function LegendaRampa({ titulo, gradiente, ticks }: { titulo: string; gradiente: string; ticks: string[] }) {
  return (
    <div className="legend">
      <div style={{ fontWeight: 600, color: 'var(--text-1)' }}>{titulo}</div>
      <div className="ramp" style={{ background: gradiente }} />
      <div className="ticks">{ticks.map((t, i) => <span key={i}>{t}</span>)}</div>
    </div>
  );
}
