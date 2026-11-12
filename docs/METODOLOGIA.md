# Metodologia do gêmeo digital

## 1. Unidade de análise
- **Unidade do motor:** região de saúde (63) × grupo de leito (7) = 441 unidades.
  Grupos: clínico, cirúrgico, obstétrico, pediátrico, UTI adulto, UTI pediátrica/neonatal,
  psiquiatria e crônicos.
- **Hospital:** censo diário por estabelecimento (CNES) × grupo, usado nas vistas de hospitais.
- **Região da unidade:** região de saúde do município do hospital (MUNIC_MOV).

## 2. Dados
| Fonte | Uso |
|---|---|
| SIH/SUS RD (SP), jan/2014–jul/2026 | internações, datas, especialidade, UTI, CID, residência |
| CNES LT, dez/2014–dez/2025 e ago/2026 | leitos SUS por estabelecimento e tipo |
| API de dados abertos do MS (CNES) | nome e coordenadas dos hospitais |
| IBGE Censo 2022 (SIDRA 9514) | população por faixa etária e município |
| IBGE Projeções 2024 (SP) | crescimento por faixa etária até 2045 |
| geobr | malhas de municípios e regiões de saúde |

Validação de arquivos (etapa 0): o `RDSP1804` estava truncado no cache e foi baixado de novo.
Abr–mai/2020 aparecem baixos por causa da COVID (queda real).

## 3. Censo
Segmento de UTI: `[dt_inter, dt_inter + UTI_MES_TO)`; grupo UTI_P se idade < 15.
Segmento de enfermaria: `[dt_inter + UTI_MES_TO, dt_saida)`; grupo pela ESPEC
(09, o leito-dia cirúrgico, fica fora). O paciente conta no dia t se `início ≤ t < fim`.

## 4. Completude e sincronização
Para cada corte histórico C (jul/2024 a out/2025, a cada 3 meses), o censo calculado só com AIHs de
competência ≤ C é comparado com o censo final. A razão média por distância até o fim de C é a
curva de completude. Sincronização = último dia com ≥97% em todos os grupos principais (τ = 93 dias).
O estado inicial (pacientes por dias decorridos) é dividido pela completude residual.

## 5. Chegadas
`λ_u(t) = L_u · dow_u(t) · exp(Fourier_g(doy)) · feriado_g(t) · fase_mês_g(t)`
- Sazonalidade e feriados por grupo (anos sem COVID); dia da semana por unidade, com
  encolhimento para o estado (k = 5.000 entradas).
- Nível L: razão observado/forma nos últimos W dias. W = 84, sem tendência (escolhido em
  calibração entre 28/56/84/112 dias, com e sem tendência amortecida).
- σ(h)² = a + b·h do log-nível, calibrado em origens de jul/2022 a dez/2023 (h até 365),
  descontando o ruído de Poisson.
- Assimilação (testada e **desligada**): `L ← L · (α + Σ obs) / (α + Σ λ·completude)`. No backtest
  operacional (etapa 8) ela piorou o WAPE regional do "hoje" (clínico 6,6% → 8,5%; UTI adulto 8,3% → 11,2%),
  porque a completude varia por região e hospital e a curva é estadual. O fator segue calculado só como diagnóstico.

## 6. Permanência
Hazard discreto `h(a,t) = h0_u(a) · m_g(c(t))`, a = 0…180 (último balde absorvente),
c = dia da semana × fase do mês (dia 1, 2–5, 6–24, 25–antepenúltimo, penúltimo, último) × feriado.
Estimação alternada (riscos proporcionais discretos) com censura em t0; m separável por ajuste
proporcional iterativo; h0 encolhido para a curva estadual (k = 300).

## 7. Propagação e agregação
Por unidade: `E[N] = Σ_a Y_a(t) + Σ_a Z_a(t)`. Y são os existentes por coorte, com variância
binomial; Z são as chegadas, com variância de Poisson. O erro de nível W = Σ λσ·sobrevivência é
perfeitamente correlacionado no tempo. Ao agregar unidades:
`Var = Σ var_ind + ρ(Σ sd_nível)² + (1−ρ)Σ sd_nível²`, com ρ = 0,5.

## 8. Simulador
Campo médio por coorte com ruído binomial agregado (aproximação de difusão), chegadas de Poisson
com erro de nível log-normal correlacionado entre regiões, capacidade e regulação: acima do
gatilho, as novas internações vão para a região mais próxima (haversine entre centroides), no
mesmo DRS ou no estado e dentro do raio, que esteja abaixo do alvo. Base e cenário usam as mesmas
sementes (CRN).

## 9. Planejamento
Leitos necessários (ano Y) = censo de referência (média ou semana P90 dos últimos 12 meses)
× multiplicador demográfico × (1 − redução de ICSAP × fração de leitos-dia ICSAP) × (1 − redução
de permanência) ÷ meta de ocupação. O multiplicador vem dos leitos-dia por município de residência
e faixa etária, cada um com o crescimento da sua população (IBGE 2024).

## 10. Validação
- Backtest fora da amostra: 25 origens (jan/2024–jan/2026), h = 7…90, perfis ajustados até 2023.
  Métodos comparados: persistência, sazonal ingênuo e média móvel de 28 dias.
- Cobertura regional do IC 80%: 82–89% nos grupos de confiabilidade alta.
- **Backtest operacional** (etapa 8, `p08_backtest_operacional.py`): 17 cortes de jul/2024 a nov/2025,
  só com AIHs de competência ≤ corte, sincronização em τ = 93 e alvos no último dia faturado, em "hoje" (+56 d),
  em hoje + 4 semanas e em hoje + 90 dias.
- Paridade Python ↔ TypeScript: diferença < 1% na média e < 2% no desvio, nas 441 unidades
  (`web/src/engine/motor.test.ts`).
- Simulador: a média da base bate com o motor determinístico (±3%); as alavancas têm o efeito
  no sentido esperado (`simulador.test.ts`).

## Referências
- NASEM (2024). *Foundational Research Gaps and Future Directions for Digital Twins*.
- Baas S. et al. (2021). Real-time forecasting of COVID-19 bed occupancy in wards and ICUs. *Health Care Management Science*.
- Monks T. et al. (2019). STRESS guidelines for simulation studies. *Journal of Simulation*.
- Alfradique M.E. et al. (2009). Internações por condições sensíveis à atenção primária. *Cad. Saúde Pública*.
(Conferir as referências antes de citá-las formalmente.)
