import { tx } from '../i18n';
/** Definição de cenários (alavancas do gestor) e presets. */
export type Regulacao = 'nenhuma' | 'drs' | 'estado';

export interface Cenario {
  nome: string;
  grupo: number;
  dias: number;            // horizonte a partir da data de referência
  execucoes: number;
  demandaPct: number;      // choque geral de demanda (%)
  resp: { intensidade: number; picoDia: number; larguraSem: number; drs: string | null }; // onda respiratória
  anoDemografia: number;   // envelhecimento: taxas atuais x população do ano
  permanenciaPct: number;  // redução da permanência (%) — desospitalização, gestão de altas, EMAD
  icsapPct: number;        // redução das internações sensíveis à APS (%)
  leitos: { escopo: 'estado' | 'drs' | 'regiao'; id: string | number | null; delta: number; modo: 'pct' | 'abs' };
  regulacao: Regulacao;
  gatilho: number;         // ocupação que dispara transferência (0–1.2)
  alvo: number;            // ocupação máxima aceitável no destino
  raioKm: number;
}

export const cenarioBase = (grupo: number, ano: number): Cenario => ({
  nome: tx("Base"), grupo, dias: 120, execucoes: 150, demandaPct: 0,
  resp: { intensidade: 0, picoDia: 60, larguraSem: 4, drs: null }, anoDemografia: ano,
  permanenciaPct: 0, icsapPct: 0, leitos: { escopo: 'estado', id: null, delta: 0, modo: 'pct' },
  regulacao: 'nenhuma', gatilho: 0.95, alvo: 0.85, raioKm: 250,
});

export interface Preset { id: string; nome: string; descricao: string; aplicar: (c: Cenario) => Cenario }

export const PRESETS: Preset[] = [
  {
    id: 'inverno', nome: tx("Inverno severo"), descricao: tx("Onda de influenza/VSR: +80% nas internações respiratórias no pico, 5 semanas de largura."),
    aplicar: (c) => ({ ...c, nome: tx("Inverno severo"), resp: { ...c.resp, intensidade: 80, larguraSem: 5 } }),
  },
  {
    id: 'pandemia', nome: tx("Epidemia respiratória grave"), descricao: tx("Choque tipo COVID-19: +250% nas respiratórias, 8 semanas. Depois, ligue a regulação estadual e compare."),
    aplicar: (c) => ({ ...c, nome: tx("Epidemia grave"), resp: { ...c.resp, intensidade: 250, larguraSem: 8 } }),
  },
  {
    id: 'envelhecimento', nome: tx("Envelhecimento 2035"), descricao: tx("Taxas de internação atuais por idade aplicadas à população projetada de 2035 (IBGE 2024)."),
    aplicar: (c) => ({ ...c, nome: tx("Envelhecimento 2035"), anoDemografia: 2035 }),
  },
  {
    id: 'aps', nome: tx("APS resolutiva + desospitalização"), descricao: tx("−20% ICSAP (APS no nível de referência) e −5% de permanência (gestão de altas, atenção domiciliar)."),
    aplicar: (c) => ({ ...c, nome: tx("APS + desospitalização"), icsapPct: 20, permanenciaPct: 5 }),
  },
  {
    id: 'regulacao', nome: tx("Regulação regional"), descricao: tx("Transferência automática quando a região passa de 95%, para a mais próxima abaixo de 85% no mesmo DRS."),
    aplicar: (c) => ({ ...c, nome: tx("Regulação no DRS"), regulacao: 'drs' }),
  },
];
