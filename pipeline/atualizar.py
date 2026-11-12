"""Atualiza o gêmeo com os dados novos do DATASUS, de ponta a ponta.

    python pipeline/atualizar.py                 # confere, baixa, roda o pipeline e os testes
    python pipeline/atualizar.py --so-checar     # só diz se há novidade (código de saída 10 = há novidade)
    python pipeline/atualizar.py --forcar        # roda mesmo sem novidade
    python pipeline/atualizar.py --revisar 8     # considera republicados os últimos 8 meses do SIH (padrão 6)
    python pipeline/atualizar.py --sem-testes    # pula pytest/vitest
    python pipeline/atualizar.py --build         # no fim, gera web/dist
    python pipeline/atualizar.py --notificar     # avisa por notificação do macOS (usado no agendamento)

Passos:
 1. Conferir no FTP do DATASUS: competências novas do SIH/RD e dos leitos do CNES (LT) de SP e arquivos republicados
    (o SIH recebe AIHs faturadas com atraso, então os últimos meses mudam depois de publicados).
 2. Baixar o que falta (ambiente com PySUS) guardando a versão antiga dos republicados em <cache>/_substituidos.
 3. Validar os arquivos (etapa 0). Se algum vier suspeito, devolve a versão antiga e interrompe.
 4. Rodar o pipeline (etapas 0 a 7) e os testes. Se falhar, devolve os dados do painel ao estado anterior.
 5. Placar de acertos: compara a previsão que existia antes com o que aconteceu (gemeo.placar) e grava em
    web/public/data/placar.json, que a página Validação e método mostra.
 6. Registrar o resultado em data/atualizacoes/ (historico.jsonl, ultima.json e um log por execução).

Só usa a biblioteca padrão: roda com qualquer Python 3. O download e o pipeline usam os ambientes do projeto:
  PYSUS_PY  (padrão python3.9)  – ambiente com PySUS, que decodifica .dbc
  .venv/bin/python                                       – ambiente do pipeline (DuckDB etc.)
"""
from __future__ import annotations

import argparse
import fcntl
import ftplib
import json
import os
import re
import shutil
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[1]
PIPE = RAIZ / "pipeline"
WEB_DATA = RAIZ / "web" / "public" / "data"
LOGS = RAIZ / "data" / "atualizacoes"
PY_PIPE = RAIZ / ".venv" / "bin" / "python"
PY_PYSUS = os.environ.get("PYSUS_PY", "python3.9")

FTP_HOST = "ftp.datasus.gov.br"
FTP_SIH = "/dissemin/publicos/SIHSUS/200801_/Dados"
FTP_CNES = "/dissemin/publicos/CNES/200508_/Dados"


def achar_cache() -> Path:
    env = os.environ.get("PYSUS_CACHEPATH")
    cands = ([Path(env).expanduser()] if env else []) + [Path.home() / "pysus", Path.home() / "Documents" / "Projetos" / "pysus"]
    for c in cands:
        if c.is_dir() and any(c.glob("RDSP*.parquet")):
            return c
    return cands[0]


CACHE = achar_cache()


def notificar(titulo: str, msg: str):
    """Notificação do macOS (ignora erros: não existe fora do Mac ou sem sessão gráfica)."""
    try:
        limpo = msg.replace('"', "'").replace("\\", "")[:200]
        subprocess.run(["osascript", "-e", f'display notification "{limpo}" with title "{titulo}"'], timeout=10, check=False)
    except (OSError, subprocess.SubprocessError):
        pass


def log(msg: str, f=None):
    linha = f"[{time.strftime('%H:%M:%S')}] {msg}"
    print(linha, flush=True)
    if f:
        f.write(linha + "\n"); f.flush()


# ---------------------------------------------------------------- 1. conferir o FTP
def baixado_em(nome: str) -> float | None:
    """Quando o arquivo foi baixado (data do arquivo mais novo dentro do .parquet do cache)."""
    d = CACHE / f"{nome}.parquet"
    if not d.exists():
        return None
    arqs = [p.stat().st_mtime for p in d.rglob("*") if p.is_file()]
    return max(arqs) if arqs else d.stat().st_mtime


def conectar(pasta: str) -> ftplib.FTP:
    ftp = ftplib.FTP(FTP_HOST, timeout=40)
    ftp.login()
    ftp.cwd(pasta)
    return ftp


def listar_ftp(pasta: str, regex: str) -> list[str]:
    """Nomes '<prefixo>AAMM' de SP no FTP (sem a extensão .dbc)."""
    for tentativa in range(3):
        try:
            ftp = conectar(pasta)
            nomes = [n[:-4] for n in ftp.nlst() if re.fullmatch(regex, n)]
            ftp.quit()
            return nomes
        except ftplib.all_errors as e:  # noqa: PERF203
            if tentativa == 2:
                raise RuntimeError(f"FTP do DATASUS indisponível: {e}") from e
            time.sleep(5)
    return []


def datas_ftp(pasta: str, nomes: list[str]) -> dict[str, float]:
    """Data de modificação (UTC, epoch) de alguns arquivos: uma consulta por arquivo, por isso só dos que importam."""
    ftp = conectar(pasta)
    out = {}
    for n in nomes:
        try:
            out[n] = datetime.strptime(ftp.sendcmd(f"MDTM {n}.dbc")[4:].strip(), "%Y%m%d%H%M%S").replace(tzinfo=timezone.utc).timestamp()
        except ftplib.all_errors:
            out[n] = 0.0
    ftp.quit()
    return out


def competencia(nome: str) -> int:
    """'RDSP2608' -> 202608."""
    m = re.search(r"(\d{2})(\d{2})$", nome)
    return (2000 + int(m.group(1))) * 100 + int(m.group(2))


def checar(revisar: int) -> dict:
    """Compara o FTP com o cache. Retorna o que fazer."""
    rd = sorted((n for n in listar_ftp(FTP_SIH, r"RDSP\d{4}\.dbc") if competencia(n) >= 202301), key=competencia)
    lt = sorted((n for n in listar_ftp(f"{FTP_CNES}/LT", r"LTSP\d{4}\.dbc") if competencia(n) >= 202501), key=competencia)
    novos = [n for n in rd if baixado_em(n) is None]
    recentes = [n for n in rd[-revisar:] if n not in novos]       # meses recentes que já estão no cache: podem ter sido republicados
    ultimo_lt = lt[-1]
    if baixado_em(ultimo_lt) is None:
        novos.append(ultimo_lt)
    republicados = []
    datas = datas_ftp(f"{FTP_SIH}", recentes)
    republicados += [n for n in recentes if datas[n] > (baixado_em(n) or 0) + 3600]
    if ultimo_lt not in novos:
        d = datas_ftp(f"{FTP_CNES}/LT", [ultimo_lt])[ultimo_lt]
        if d > (baixado_em(ultimo_lt) or 0) + 3600:
            republicados.append(ultimo_lt)
    return {"novos": novos, "republicados": republicados, "ultimo_sih": competencia(rd[-1]), "ultimo_cnes": competencia(ultimo_lt)}


# ---------------------------------------------------------------- passos de execução
def executar(cmd: list[str], f, cwd: Path = RAIZ, env: dict | None = None) -> int:
    log("$ " + " ".join(str(c) for c in cmd), f)
    p = subprocess.Popen([str(c) for c in cmd], cwd=cwd, env={**os.environ, **(env or {})}, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    assert p.stdout
    for linha in p.stdout:
        if f:
            f.write(linha)
    p.wait()
    if f:
        f.flush()
    return p.returncode


def meta_atual() -> dict:
    try:
        return json.loads((WEB_DATA / "nucleo.json").read_text())["meta"]
    except (OSError, KeyError, json.JSONDecodeError):
        return {}


def restaurar_substituidos(nomes: list[str], f):
    """Devolve ao cache a versão antiga (mais recente) de cada arquivo republicado."""
    sub = CACHE / "_substituidos"
    for n in nomes:
        versoes = sorted(sub.glob(f"{n}.*.parquet")) if sub.exists() else []
        if not versoes:
            continue
        atual = CACHE / f"{n}.parquet"
        if atual.exists():
            shutil.rmtree(atual) if atual.is_dir() else atual.unlink()
        shutil.move(str(versoes[-1]), str(atual))
        log(f"versão antiga de {n} devolvida ao cache", f)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--so-checar", action="store_true")
    ap.add_argument("--forcar", action="store_true")
    ap.add_argument("--revisar", type=int, default=6, help="quantos meses recentes do SIH conferir por republicação")
    ap.add_argument("--sem-testes", action="store_true")
    ap.add_argument("--build", action="store_true")
    ap.add_argument("--notificar", action="store_true", help="avisa por notificação do macOS quando atualizar ou falhar")
    a = ap.parse_args()

    LOGS.mkdir(parents=True, exist_ok=True)
    trava = open(LOGS / ".trava", "w")  # impede duas atualizações ao mesmo tempo (ex.: agendada e manual)
    try:
        fcntl.flock(trava, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        print("Outra atualização já está em andamento."); return
    ts = time.strftime("%Y%m%d-%H%M%S")
    pasta_log = LOGS / ts
    antes = meta_atual()

    print(f"cache do PySUS: {CACHE}")
    try:
        r = checar(a.revisar)
    except RuntimeError as e:
        print("ERRO:", e)
        if a.notificar and not a.so_checar:
            notificar("InteliSUS", "Não consegui consultar o DATASUS hoje.")
        sys.exit(1)
    print(f"FTP: SIH até {r['ultimo_sih']}, CNES até {r['ultimo_cnes']}")
    print("  novos:       ", ", ".join(r["novos"]) or "nenhum")
    print("  republicados:", ", ".join(r["republicados"]) or "nenhum")
    ha_novidade = bool(r["novos"] or r["republicados"])
    if a.so_checar:
        sys.exit(10 if ha_novidade else 0)
    if not ha_novidade and not a.forcar:
        print("Nada a atualizar.")
        return

    pasta_log.mkdir(parents=True)
    f = open(pasta_log / "atualizacao.log", "w")
    resumo = {"quando": ts, "antes": {k: antes.get(k) for k in ("data_sync", "data_corte", "competencia", "competencia_cnes")},
              "novos": r["novos"], "republicados": r["republicados"], "status": "em andamento"}

    def terminar(status: str, codigo: int):
        resumo["status"] = status
        resumo["depois"] = {k: meta_atual().get(k) for k in ("data_sync", "data_corte", "competencia", "competencia_cnes")}
        if status.startswith("atualizado"):
            try:
                g = json.loads((WEB_DATA / "placar.json").read_text())[0]["geral"]
                resumo["placar"] = {k: g[k] for k in ("wape", "wape_persistencia", "erro_estado", "vies_estado", "cobertura_ic80")}
            except (OSError, IndexError, KeyError, json.JSONDecodeError):
                pass
        (LOGS / "ultima.json").write_text(json.dumps(resumo, ensure_ascii=False, indent=2))
        with open(LOGS / "historico.jsonl", "a") as h:
            h.write(json.dumps(resumo, ensure_ascii=False) + "\n")
        log(f"{status}. Detalhes em {pasta_log / 'atualizacao.log'}", f)
        f.close()
        if a.notificar:
            d = resumo["depois"]
            notificar("InteliSUS: dados atualizados" if codigo == 0 else "InteliSUS: atualização com problema",
                      f"Últimos dados confiáveis até {d.get('data_sync')} (SIH {d.get('competencia')})." if codigo == 0 else status)
        sys.exit(codigo)

    # guarda o que o painel usa hoje, para devolver se algo falhar
    if WEB_DATA.exists():
        shutil.copytree(WEB_DATA, pasta_log / "web_data_anterior")
        for antigo in sorted(LOGS.glob("20*/web_data_anterior"))[:-5]:  # mantém só as 5 últimas cópias
            shutil.rmtree(antigo, ignore_errors=True)

    def desfazer():
        restaurar_substituidos(r["republicados"], f)
        if (pasta_log / "web_data_anterior").exists():
            shutil.rmtree(WEB_DATA, ignore_errors=True)
            shutil.copytree(pasta_log / "web_data_anterior", WEB_DATA)
            log("dados do painel devolvidos ao estado anterior", f)

    # 2. baixar
    ate = f"{r['ultimo_sih'] // 100}-{r['ultimo_sih'] % 100:02d}"
    cnes = f"{r['ultimo_cnes'] // 100}-{r['ultimo_cnes'] % 100:02d}"
    cmd = [PY_PYSUS, PIPE / "baixar_datasus.py", "--ate", ate, "--cnes", cnes]
    if r["republicados"]:
        cmd += ["--refazer", ",".join(r["republicados"])]
    log("baixando do DATASUS…", f)
    if executar(cmd, f, env={"PYSUS_CACHEPATH": str(CACHE)}) != 0:
        desfazer(); terminar("falhou no download", 2)

    # 3. validar os arquivos. Os que acabaram de ser baixados e vieram truncados (acontece no FTP) são baixados de novo, até 2 vezes
    alvos = set(r["novos"] + r["republicados"])
    for tentativa in range(3):
        saida = pasta_log / f"p00_{tentativa}.txt"
        with open(saida, "w") as g:
            cod = executar([PY_PIPE, "-m", "gemeo.p00_validar"], g, cwd=PIPE)
        texto = saida.read_text()
        log("validação dos arquivos do SIH:\n" + texto.strip(), f)
        suspeitos = [f"RDSP{m}" for m in re.findall(r"^\s*(\d{4})\s+\d+\s", texto.split("suspeitos:")[-1], re.M)]
        if cod == 0 and not suspeitos and "nenhum" in texto.split("suspeitos:")[-1][:40]:
            break
        so_alvos = bool(suspeitos) and all(n in alvos for n in suspeitos)
        if cod != 0 or tentativa == 2 or not so_alvos:
            desfazer(); terminar("arquivos suspeitos: atualização interrompida e dados anteriores mantidos", 3)
        ruim = CACHE / "_corrompidos"
        ruim.mkdir(exist_ok=True)
        for n in suspeitos:  # tira do cache o arquivo ruim e baixa de novo (ele passa a contar como arquivo ausente)
            shutil.move(str(CACHE / f"{n}.parquet"), str(ruim / f"{n}.{time.strftime('%Y%m%d-%H%M%S')}.parquet"))
        log(f"arquivos truncados ({', '.join(suspeitos)}): baixando de novo (tentativa {tentativa + 2} de 3)…", f)
        if executar([PY_PYSUS, PIPE / "baixar_datasus.py", "--ate", ate, "--cnes", cnes], f, env={"PYSUS_CACHEPATH": str(CACHE)}) != 0:
            desfazer(); terminar("falhou no download", 2)

    # 4. pipeline e testes
    log("rodando o pipeline (cerca de 1 minuto)…", f)
    if executar([PY_PIPE, "-m", "gemeo.executar"], f, cwd=PIPE) != 0:
        desfazer(); terminar("falhou no pipeline", 4)
    if not a.sem_testes:
        log("rodando os testes…", f)
        ok = executar([PY_PIPE, "-m", "pytest", "-q", "tests"], f) == 0
        if ok and shutil.which("npx"):
            ok = executar(["npx", "vitest", "run"], f, cwd=RAIZ / "web") == 0
        if not ok:
            desfazer(); terminar("testes falharam: dados do painel devolvidos ao estado anterior", 5)
    if (pasta_log / "web_data_anterior").exists():  # placar: a previsão antiga contra o que aconteceu
        log("avaliando a previsão anterior com os dados novos…", f)
        executar([PY_PIPE, "-m", "gemeo.placar", "--anterior", pasta_log / "web_data_anterior"], f, cwd=PIPE)
    if a.build and shutil.which("npm"):
        if executar(["npm", "run", "build"], f, cwd=RAIZ / "web") != 0:
            terminar("atualizado, mas o build do painel falhou", 6)

    depois = meta_atual()
    log(f"sincronização: {antes.get('data_sync')} → {depois.get('data_sync')}; SIH até {antes.get('competencia')} → {depois.get('competencia')}", f)
    terminar("atualizado com sucesso", 0)


if __name__ == "__main__":
    main()
