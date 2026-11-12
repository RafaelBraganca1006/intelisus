// Contratos dos arquivos gerados por pipeline/gemeo/p07_exportar.py
export interface Grupo { id: string; nome: string; confiabilidade: 'alta' | 'média' | 'baixa' }
export interface Regiao { id: number; nome: string; drs: string; lon: number; lat: number; pop: number; pop60: number }

export interface Nucleo {
  meta: {
    gerado_em: string; dia0: string; data_sync: string; data_corte: string; competencia: number;
    d_sync: number; fim_previsao: string; horizonte: number; competencia_cnes: number;
  };
  grupos: Grupo[];
  drs: { id: string; nome: string }[];
  regioes: Regiao[];
  capacidade: number[][];                // [R][G] leitos SUS (CNES mais recente)
  capacidade_hist: { competencias: number[]; valores: number[][][] }; // [R][G][n]
  motor: {
    L: number[][]; dow: number[][][]; forma: number[][]; tipos: number[]; mdow: number[][];
    h0: number[][]; estado: number[][]; sigma: number[][]; dow_inicio: number;
  };
  demanda: { icsap: number[]; resp: number[]; idosos: number[]; icsap_dias: number[]; resp_dias: number[] };
  planejamento: { anos: number[]; mult: number[][] };
  dist: number[][];
}

export interface Historico {
  semanas: { inicio: string; n: number; censo: number[][]; entradas: number[][] };
  diario: { inicio: string; censo: number[][]; entradas: number[][] };
  completude_censo: number[][];
  completude_entradas: number[][];
  previsao_python: { media: number[][]; dp: number[][] };
}

/** Acerto da previsão antiga contra o que aconteceu depois de uma atualização (gerado por gemeo.placar). */
export interface BlocoPlacar { wape: number; wape_persistencia: number; erro_estado: number; vies_estado: number; cobertura_ic80: number | null }
export interface Placar {
  gerado_em: string; previsao_de: string; sync_atual: string; competencia_atual: number | null; periodo: [string, string]; dias: number; unidades: number;
  geral: BlocoPlacar; por_tipo: (BlocoPlacar & { id: string; nome: string; confiabilidade?: string })[];
  estado: { datas: string[]; previsto: number[]; observado: number[] };
}

export interface Fluxos { matriz: number[][][]; arestas: [number, number, number, number[]][] }

export interface Municipio {
  mun: number; nome: string; regiao: number; drs: string; lon: number; lat: number; pop: number | null;
  pop60: number; n: number | null; icsap: number | null; perm: number | null; obitos: number | null;
  valor: number | null; fora_mun: number | null; fora_reg: number | null; uti: number | null;
  idosos: number | null; resp: number | null; taxa_pad: number | null; taxa_icsap_pad: number | null;
  taxa_bruta: number | null; destinos: [number, number][]; serie: number[];
}

export interface Hospital {
  cnes: number; nome: string; mun: number; municipio: string | null; regiao: number | null;
  lat: number | null; lon: number | null; esfera: string | null; natjur: string | null; n: number | null;
  de_fora: number | null; perm: number | null; letal: number | null; valor: number | null; n_mun: number | null;
  leitos: number[]; censo: number[]; semanal: number[];
}

export interface Validacao {
  backtest: Record<string, {
    h: number; gemeo: number; persistencia: number; sazonal: number; media_movel: number; cob80: number;
    cob95: number; estado_gemeo: number; estado_persistencia: number; estado_cob80: number; estado_cob95: number;
    estado_vies: number;
  }[]>;
  n_origens_avaliacao: number; origens_avaliacao: [string, string];
  exemplo: { t0: string; media: number[][]; dp: number[][]; real: number[][] };
  janela: number; sigma: number[][]; fer_nomes: string[]; fer_fatores: number[][]; mdow: number[][];
  dow_estado: number[][];
  completude: { censo: number[][]; entradas: number[][]; tau_sync: number; cortes: number[] };
  operacional: null | { cortes: string[]; tau_sync: number; alvos: Record<string, number>;
    resultado: Record<string, Record<string, { reg: number; ing: number; est: number; pp: number; c80: number }>> };
}
