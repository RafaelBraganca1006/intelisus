PY := .venv/bin/python
PYSUS_PY ?= python3.9

.PHONY: setup baixar pipeline atualizar checar web build test

setup:            ## cria o ambiente Python e instala o painel
	python3 -m venv .venv && $(PY) -m pip install -r requirements.txt
	cd web && npm install

baixar:           ## baixa SIH/CNES novos do DATASUS (precisa do ambiente com pysus)
	$(PYSUS_PY) pipeline/baixar_datasus.py --ate $(ATE) --cnes $(CNES)

checar:           ## só confere se o DATASUS publicou SIH/CNES novos (código 10 = há novidade)
	python3 pipeline/atualizar.py --so-checar

atualizar:        ## confere, baixa, valida, roda o pipeline e os testes (desfaz se algo falhar)
	python3 pipeline/atualizar.py

pipeline:         ## roda as etapas 0–7 e exporta web/public/data
	cd pipeline && ../$(PY) -m gemeo.executar

web:              ## servidor de desenvolvimento em http://localhost:5190
	cd web && npm run dev

build:            ## build estático em web/dist
	cd web && npm run build

test:             ## testes do motor (Python e TypeScript)
	$(PY) -m pytest -q tests
	cd web && npx vitest run
