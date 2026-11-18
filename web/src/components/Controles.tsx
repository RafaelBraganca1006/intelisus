import { tx } from '../i18n';
import type { ReactNode } from 'react';
import { corGrupo, type Nivel, rotuloNivel } from '../lib/cores';
import { type Escopo, useStore } from '../store';

export function SeletorGrupo({ compacto = false }: { compacto?: boolean }) {
  const { nucleo, grupo, set } = useStore();
  if (!nucleo) return null;
  return (
    <div className="seg" role="tablist" aria-label={tx("Tipo de leito")}>
      {nucleo.grupos.map((g, i) => (
        <button key={g.id} className={i === grupo ? 'on' : ''} onClick={() => set({ grupo: i, sim: null })} title={g.nome}>
          <i className="swatch" style={{ background: corGrupo(i) }} />
          {compacto ? g.id.replace('_', ' ') : g.nome}
        </button>
      ))}
    </div>
  );
}

export function SeletorEscopo() {
  const { nucleo, escopo, set } = useStore();
  if (!nucleo) return null;
  const v = escopo.tipo === 'estado' ? 'estado' : `${escopo.tipo}:${escopo.id}`;
  return (
    <select value={v} aria-label={tx("Recorte territorial")} onChange={(e) => {
      const x = e.target.value;
      let es: Escopo = { tipo: 'estado' };
      if (x.startsWith('drs:')) es = { tipo: 'drs', id: x.slice(4) };
      if (x.startsWith('regiao:')) es = { tipo: 'regiao', id: Number(x.slice(7)) };
      set({ escopo: es });
    }}>
      <option value="estado">{tx("Estado de São Paulo")}</option>
      <optgroup label={tx("Departamentos Regionais de Saúde")}>
        {nucleo.drs.map((d) => <option key={d.id} value={`drs:${d.id}`}>{tx("DRS")} {d.id} · {d.nome}</option>)}
      </optgroup>
      {nucleo.drs.map((d) => (
        <optgroup key={d.id} label={tx("Regiões · DRS {0}", d.nome)}>
          {nucleo.regioes.filter((r) => r.drs === d.id).map((r) => <option key={r.id} value={`regiao:${r.id}`}>{r.nome}</option>)}
        </optgroup>
      ))}
    </select>
  );
}

export function Status({ nivel, texto }: { nivel: Nivel; texto?: string }) {
  const icone = nivel === 'good' ? '✓' : nivel === 'warning' ? '!' : '▲';
  return (
    <span className="status" style={{ borderColor: `color-mix(in srgb, var(--${nivel}) 45%, transparent)`, background: `color-mix(in srgb, var(--${nivel}) 12%, transparent)` }}>
      <i style={{ background: `var(--${nivel})` }} aria-hidden />
      <span aria-hidden style={{ fontSize: 10 }}>{icone}</span>
      {texto ?? rotuloNivel[nivel]}
    </span>
  );
}

export function Kpi({ lbl, val, un, det, extra }: { lbl: string; val: ReactNode; un?: string; det?: ReactNode; extra?: ReactNode }) {
  return (
    <div className="kpi fade-in">
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
        <div className="lbl">{lbl}</div>{extra}
      </div>
      <div className="val num">{val}{un && <small>{un}</small>}</div>
      {det && <div className="det">{det}</div>}
    </div>
  );
}

export function Controle({ rotulo, valor, desc, children }: { rotulo: string; valor: ReactNode; desc?: string; children: ReactNode }) {
  return (
    <div className="ctrl">
      <div className="ctrl-top"><label>{rotulo}</label><span className="v">{valor}</span></div>
      {children}
      {desc && <div className="d">{desc}</div>}
    </div>
  );
}

export function Sparkline({ valores, cor, largura = 90, altura = 24, limite }: { valores: number[]; cor: string; largura?: number; altura?: number; limite?: number }) {
  if (!valores.length) return null;
  const mx = Math.max(...valores, limite ?? 0), mn = Math.min(...valores);
  const sx = (i: number) => (i / (valores.length - 1)) * largura;
  const sy = (v: number) => altura - 2 - ((v - mn) / Math.max(mx - mn, 1e-9)) * (altura - 4);
  const d = valores.map((v, i) => `${i ? 'L' : 'M'}${sx(i).toFixed(1)},${sy(v).toFixed(1)}`).join('');
  return (
    <svg width={largura} height={altura} aria-hidden>
      {limite != null && <line x1={0} x2={largura} y1={sy(limite)} y2={sy(limite)} stroke="var(--critical)" strokeDasharray="2 2" strokeWidth={1} />}
      <path d={d} fill="none" stroke={cor} strokeWidth={1.6} strokeLinejoin="round" />
    </svg>
  );
}
