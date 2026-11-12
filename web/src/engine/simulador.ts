/**
 * Simulador estocástico de cenários (Monte Carlo) sobre o estado do gêmeo.
 *
 * Por execução e por região (um grupo de leito):
 *   - chegadas ~ Poisson(λ·alavancas·ε), ε = erro de nível log-normal correlacionado entre regiões (ρ);
 *   - altas: campo médio por coorte de idade de internação + ruído binomial agregado (aproximação de difusão);
 *   - regulação: acima do gatilho, novas internações vão para a região mais próxima (mesmo DRS ou estado,
 *     dentro do raio) que siga abaixo da ocupação-alvo;
 *   - base e cenário usam os mesmos números aleatórios (CRN), então a diferença é o efeito do cenário.
 */
import type { Nucleo } from '../data/tipos';
import type { Cenario } from './cenario';
import { A, lambdaUnidade, propagar, RHO, sigmaK } from './motor';

const AS = 90; // idades de internação na simulação (último balde absorvente)

function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

function normal(u: () => number) {
  let a = 0;
  while (a === 0) a = u();
  return Math.sqrt(-2 * Math.log(a)) * Math.cos(2 * Math.PI * u());
}

function poisson(lam: number, u: () => number, z: () => number) {
  if (lam <= 0) return 0;
  if (lam > 30) return Math.max(0, Math.round(lam + Math.sqrt(lam) * z()));
  const L = Math.exp(-lam);
  let k = 0, p = 1;
  do { k++; p *= u(); } while (p > L);
  return k - 1;
}

export interface ResultadoSim {
  dias: number; inicioK: number;
  q: { p10: Float32Array; p50: Float32Array; p90: Float32Array }[]; // por região [dias]
  estado: { p10: Float32Array; p50: Float32Array; p90: Float32Array; media: Float32Array };
  capacidade: number[];
  metricas: {
    diasAcima100: number[];      // por região (média entre execuções)
    diasAcima85: number[];
    picoOcup: number[];          // por região: P50 do pico de ocupação (%)
    pacDiasExcesso: number;      // pacientes-dia acima da capacidade (estado, média)
    pacDiasExcessoP90: number;
    transferencias: number; kmTotal: number;
    transfPorRegiao: number[];   // recebidas
    enviadasPorRegiao: number[];
    entradas: number;            // total de entradas no horizonte
    probColapso: number;         // P(estado > 95% em algum dia)
  };
}

export interface EntradaSim { cenario: Cenario; inicioK: number; semente: number; base?: boolean }

export function simular(n: Nucleo, e: EntradaSim): ResultadoSim {
  const c = e.cenario;
  const G = n.grupos.length, R = n.regioes.length, g = c.grupo;
  const H = c.dias, runs = c.execucoes, k0 = e.inicioK;
  const anoRef = Number(n.meta.data_sync.slice(0, 4));
  const anos = n.planejamento.anos;
  const jAno = Math.max(0, anos.indexOf(c.anoDemografia));
  const jRef = Math.max(0, anos.indexOf(anoRef));

  // capacidade com alavanca de leitos
  const cap = n.regioes.map((reg, r) => {
    const base = n.capacidade[r][g];
    const L = c.leitos;
    const alvo = L.escopo === 'estado' || (L.escopo === 'drs' && reg.drs === L.id) || (L.escopo === 'regiao' && reg.id === L.id);
    if (!alvo || !L.delta) return base;
    if (L.modo === 'pct') return Math.max(0, base * (1 + L.delta / 100));
    // absoluto: em escopo agregado, distribui proporcionalmente à capacidade
    const tot = n.regioes.reduce((s, r2, i) => s + (((L.escopo === 'drs' && r2.drs === L.id) || L.escopo === 'estado' || r2.id === L.id) ? n.capacidade[i][g] : 0), 0);
    return Math.max(0, base + L.delta * (tot > 0 ? base / tot : 0));
  });

  // multiplicador das chegadas por região e dia
  const multR = new Float64Array(R);
  for (let r = 0; r < R; r++) {
    const u = r * G + g;
    const dem = n.planejamento.mult[u][jAno] / n.planejamento.mult[u][jRef];
    multR[r] = dem * (1 + c.demandaPct / 100) * (1 - (c.icsapPct / 100) * n.demanda.icsap[u]);
  }
  const respAmp = (r: number, t: number) => {
    if (!c.resp.intensidade) return 1;
    if (c.resp.drs && n.regioes[r].drs !== c.resp.drs) return 1;
    const sd = c.resp.larguraSem * 7 / 2;
    const bell = Math.exp(-0.5 * ((t - c.resp.picoDia) / sd) ** 2);
    return 1 + n.demanda.resp[r * G + g] * (c.resp.intensidade / 100) * bell;
  };
  const fAlta = 1 / Math.max(1 - c.permanenciaPct / 100, 0.3);

  // estado esperado em k0 e incerteza inicial
  const est0: Float64Array[] = [], cv0 = new Float64Array(R);
  for (let r = 0; r < R; r++) {
    const p = propagar(n, r * G + g, k0 + 1, {}, k0);
    const e0 = new Float64Array(AS + 1);
    const ek = p.estadoEm!;
    for (let a = 0; a <= A; a++) e0[Math.min(a, AS)] += ek[a];
    est0.push(e0);
    const m = p.media[k0];
    cv0[r] = m > 0 ? Math.sqrt(p.varInd[k0] + p.sdNivel[k0] ** 2) / m : 0;
  }
  // hazard por região com balde final (média ponderada 90..180)
  const hz = n.regioes.map((_, r) => {
    const h0 = n.motor.h0[r * G + g];
    const out = new Float64Array(AS + 1);
    for (let a = 0; a < AS; a++) out[a] = h0[a];
    let s = 0, w = 0;
    for (let a = AS; a <= A; a++) { const wt = Math.pow(0.97, a - AS); s += h0[a] * wt; w += wt; }
    out[AS] = s / w;
    return out;
  });
  const mdow = n.motor.mdow[g];
  const tipos = n.motor.tipos;

  // vizinhos para regulação (ordenados por distância)
  const viz = n.regioes.map((reg, r) => n.regioes
    .map((r2, j) => ({ j, d: n.dist[r][j], drs: r2.drs }))
    .filter((x) => x.j !== r && x.d <= c.raioKm && (c.regulacao === 'estado' || x.drs === reg.drs))
    .sort((a, b) => a.d - b.d));

  const occ = new Float32Array(runs * R * H);
  const tot = new Float32Array(runs * H);
  let excesso = 0, transf = 0, km = 0, entradasTot = 0, colapsos = 0;
  const excRuns: number[] = [];
  const dAcima100 = new Float64Array(R), dAcima85 = new Float64Array(R);
  const picos: number[][] = n.regioes.map(() => []);
  const recebidas = new Float64Array(R), enviadas = new Float64Array(R);
  const capTot = cap.reduce((a, b) => a + b, 0);

  const x = n.regioes.map(() => new Float64Array(AS + 1));
  const chegam = new Float64Array(R), ocupAtual = new Float64Array(R), recebeHoje = new Float64Array(R);
  const eps = new Float64Array(R);
  const out = new Float64Array(AS + 1);
  const lamBase = n.regioes.map((_, r) => {
    const a = new Float64Array(H);
    for (let t = 0; t < H; t++) {
      const k = Math.min(k0 + 1 + t, n.motor.forma[g].length - 1);
      a[t] = lambdaUnidade(n, r * G + g, k) * multR[r] * respAmp(r, t);
    }
    return a;
  });
  const sigT = Float64Array.from({ length: H }, (_, t) => sigmaK(n, g, Math.min(k0 + 1 + t, n.motor.forma[g].length - 1)));

  for (let run = 0; run < runs; run++) {
    const u = rng(e.semente * 7919 + run * 104729 + 1);
    const z = () => normal(u);
    const zEst = z();
    for (let r = 0; r < R; r++) {
      const f = Math.max(0.2, 1 + cv0[r] * z());
      for (let a = 0; a <= AS; a++) x[r][a] = est0[r][a] * f;
      eps[r] = Math.sqrt(RHO) * zEst + Math.sqrt(1 - RHO) * z();
    }
    let excRun = 0, colapsou = false;
    const picoRun = new Float64Array(R);
    for (let t = 0; t < H; t++) {
      const k = k0 + 1 + t;
      const kk = Math.min(k, tipos.length - 1);
      const mk = mdow[tipos[kk]] * fAlta;
      // altas + envelhecimento
      for (let r = 0; r < R; r++) {
        const xr = x[r], h = hz[r];
        let sai = 0, v = 0;
        for (let a = 0; a <= AS; a++) {
          const p = Math.min(h[a] * mk, 1);
          const o = xr[a] * p;
          out[a] = o; sai += o; v += o * (1 - p);
        }
        const fator = sai > 0 ? Math.max(0, sai + Math.sqrt(v) * z()) / sai : 1;
        const fim = xr[AS] - out[AS] * fator;
        for (let a = AS; a >= 1; a--) xr[a] = xr[a - 1] - out[a - 1] * fator;
        xr[AS] += fim;
        xr[0] = 0;
        let s = 0;
        for (let a = 1; a <= AS; a++) { if (xr[a] < 0) xr[a] = 0; s += xr[a]; }
        ocupAtual[r] = s;
        const sg = sigT[t];
        const lam = lamBase[r][t] * Math.exp(sg * eps[r] - sg * sg / 2);
        chegam[r] = poisson(lam, u, z);
        entradasTot += chegam[r] / runs;
        recebeHoje[r] = 0;
      }
      // regulação
      if (c.regulacao !== 'nenhuma') {
        for (let r = 0; r < R; r++) {
          if (cap[r] <= 0) continue;
          let excedente = ocupAtual[r] + chegam[r] - c.gatilho * cap[r];
          if (excedente <= 0) continue;
          excedente = Math.min(excedente, chegam[r]);
          for (const vz of viz[r]) {
            if (excedente <= 0.5) break;
            const j = vz.j;
            const folga = c.alvo * cap[j] - (ocupAtual[j] + chegam[j] + recebeHoje[j]);
            if (folga < 1) continue;
            const m = Math.floor(Math.min(folga, excedente));
            if (m <= 0) continue;
            recebeHoje[j] += m; chegam[r] -= m; excedente -= m;
            transf += m / runs; km += (m * vz.d) / runs;
            recebidas[j] += m / runs; enviadas[r] += m / runs;
          }
        }
      }
      let st = 0;
      for (let r = 0; r < R; r++) {
        x[r][0] = chegam[r] + recebeHoje[r];
        const o = ocupAtual[r] + x[r][0];
        occ[(run * R + r) * H + t] = o;
        st += o;
        if (cap[r] > 0) {
          const taxa = o / cap[r];
          if (taxa >= 1) dAcima100[r] += 1 / runs;
          if (taxa >= 0.85) dAcima85[r] += 1 / runs;
          if (taxa > picoRun[r]) picoRun[r] = taxa;
          excRun += Math.max(0, o - cap[r]);
        }
      }
      tot[run * H + t] = st;
      if (st > 0.95 * capTot) colapsou = true;
    }
    excRuns.push(excRun);
    excesso += excRun / runs;
    if (colapsou) colapsos++;
    for (let r = 0; r < R; r++) picos[r].push(picoRun[r]);
  }

  const quant = (arr: number[], p: number) => {
    const s = arr.slice().sort((a, b) => a - b);
    const i = (s.length - 1) * p, lo = Math.floor(i), hi = Math.ceil(i);
    return s[lo] + (s[hi] - s[lo]) * (i - lo);
  };
  const q = n.regioes.map((_, r) => {
    const p10 = new Float32Array(H), p50 = new Float32Array(H), p90 = new Float32Array(H);
    const buf = new Array(runs);
    for (let t = 0; t < H; t++) {
      for (let run = 0; run < runs; run++) buf[run] = occ[(run * R + r) * H + t];
      p10[t] = quant(buf, 0.1); p50[t] = quant(buf, 0.5); p90[t] = quant(buf, 0.9);
    }
    return { p10, p50, p90 };
  });
  const est = { p10: new Float32Array(H), p50: new Float32Array(H), p90: new Float32Array(H), media: new Float32Array(H) };
  const buf = new Array(runs);
  for (let t = 0; t < H; t++) {
    let m = 0;
    for (let run = 0; run < runs; run++) { buf[run] = tot[run * H + t]; m += buf[run]; }
    est.p10[t] = quant(buf, 0.1); est.p50[t] = quant(buf, 0.5); est.p90[t] = quant(buf, 0.9); est.media[t] = m / runs;
  }
  return {
    dias: H, inicioK: k0, q, estado: est, capacidade: cap,
    metricas: {
      diasAcima100: Array.from(dAcima100), diasAcima85: Array.from(dAcima85),
      picoOcup: picos.map((p) => quant(p, 0.5) * 100),
      pacDiasExcesso: excesso, pacDiasExcessoP90: quant(excRuns, 0.9),
      transferencias: transf, kmTotal: km,
      transfPorRegiao: Array.from(recebidas), enviadasPorRegiao: Array.from(enviadas),
      entradas: entradasTot, probColapso: colapsos / runs,
    },
  };
}
