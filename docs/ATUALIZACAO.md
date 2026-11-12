# Atualização dos dados do gêmeo

O gêmeo **não se atualiza sozinho**: a atualização é um lote que baixa SIH/CNES do DATASUS, recalcula o
modelo e regrava os arquivos que o painel lê (`web/public/data`). O script `pipeline/atualizar.py` faz isso
de ponta a ponta.

## Uso

```bash
make checar       # só confere se o DATASUS publicou algo novo (código de saída 10 = há novidade)
make atualizar    # confere, baixa, valida, roda o pipeline e os testes
```

Opções (`python3 pipeline/atualizar.py …`): `--so-checar`, `--forcar` (roda mesmo sem novidade),
`--revisar N` (quantos meses recentes do SIH conferir por republicação; padrão 6), `--sem-testes`, `--build`.

## O que o script faz

1. **Confere o FTP do DATASUS**: competências novas do SIH/RD de SP, leitos do CNES (LT) mais recentes e
   arquivos já baixados que o DATASUS **republicou**. O SIH recebe AIHs faturadas com atraso, então os últimos
   meses mudam depois de publicados (em out/2026, por exemplo, os meses 03 a 08/2026 foram republicados).
2. **Baixa** o que falta com o PySUS. A versão antiga de cada arquivo republicado vai para
   `<cache>/_substituidos/`.
3. **Valida** os arquivos (etapa 0). Se algum vier truncado ou suspeito, devolve a versão antiga e interrompe.
4. **Roda o pipeline** (etapas 0 a 7) e os testes (pytest e vitest). Se algo falhar, devolve os dados do painel
   ao estado anterior.
5. **Registra** em `data/atualizacoes/`: `historico.jsonl`, `ultima.json` e uma pasta por execução com o log e
   a cópia dos dados anteriores do painel (guarda as 5 últimas).

Códigos de saída: 0 ok / sem novidade, 1 FTP indisponível, 2 download falhou, 3 arquivos suspeitos,
4 pipeline falhou, 5 testes falharam, 6 build falhou, 10 (só com `--so-checar`) há novidade.

## Onde ficam os dados

O cache dos `.parquet` do PySUS é achado sozinho: variável `PYSUS_CACHEPATH`, depois `~/pysus`, depois
`~/Documents/Projetos/pysus` (o primeiro que tiver arquivos `RDSP*`). O ambiente com PySUS (Python 3.9, que
decodifica `.dbc`) é um Python 3.9 com `pysus==0.9.4`; aponte para ele com `PYSUS_PY`.

## Placar de acertos

Depois de cada atualização com dias novos (pelo menos 7), o script compara a previsão que existia antes com o que
chegou (`pipeline/gemeo/placar.py`) e acrescenta a avaliação em `web/public/data/placar.json`. A página
**Validação e método** mostra a mais recente (erro regional, erro e viés do estado, cobertura da faixa de 80%,
por tipo de leito) e o histórico. Para avaliar à mão: `python -m gemeo.placar --anterior <pasta com os JSON antigos>`.

## Agendamento

**Hoje: tarefa agendada do app Claude** (`atualizar-dados-intelisus`, todo dia ~07:30). Ela roda
`python3 pipeline/atualizar.py --build --notificar`, relata o resultado e só age quando há novidade. Limites: o app
precisa estar aberto no horário (se estiver fechado, roda na próxima abertura). Pode ser pausada ou editada na seção
"Agendadas" do app.

**Alternativa sem o app (launchd).** Há um modelo pronto em `docs/launchd/br.intelisus.atualizar.plist`. O macOS
bloqueia tarefas em segundo plano de ler a pasta Documents ("Operation not permitted"), então ele só funciona depois de
dar **Acesso Total ao Disco** ao Python em Ajustes do Sistema > Privacidade e Segurança (adicione
`/Library/Developer/CommandLineTools/usr/bin/python3`). Aí: copiar para `~/Library/LaunchAgents/` e
`launchctl load ~/Library/LaunchAgents/br.intelisus.atualizar.plist`. O computador precisa estar ligado e acordado.

Duas execuções ao mesmo tempo são impedidas por uma trava (`data/atualizacoes/.trava`); com `--notificar` o script
avisa por notificação do macOS quando atualiza ou quando algo dá errado.

## Limites

- A sincronização do gêmeo fica ~93 dias antes do último dia faturado (curva de completude), então cada mês
  novo do SIH adianta a sincronização em cerca de um mês. Dados mais atuais exigem outra fonte (ex.: CROSS).
- O arquivo CNES ST (estabelecimentos) às vezes vem corrompido do FTP; o pipeline não o usa, então o script
  não depende dele.
- Se o pipeline passar mas os números mudarem muito, compare `data/atualizacoes/<data>/web_data_anterior` com
  `web/public/data`.
