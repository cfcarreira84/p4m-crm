#!/usr/bin/env python3
"""Backup, verificação e restauração dos dados do SDR Cockpit no Supabase (somente biblioteca padrão).

    python tools/backup_banco.py criar     [--motivo TEXTO]     exporta as 4 tabelas para backups/AAAAMMDD-HHMMSS/ e confere
    python tools/backup_banco.py verificar [PASTA]              confere hashes e contagens do backup (padrão: o mais recente)
    python tools/backup_banco.py listar                         lista os backups existentes
    python tools/backup_banco.py restaurar PASTA [--tabela T] [--confirmar]    reenvia linhas (upsert por chave); simula sem --confirmar

O backup é um conjunto de JSONs (um por tabela) mais manifest.json com contagem e SHA-256 de cada arquivo.
Usa a service key de database/.env e só LÊ o banco em `criar`. `restaurar` faz upsert: recria linhas apagadas e
desfaz alterações nas linhas existentes, mas NÃO apaga linhas que surgiram depois do backup.
Os usuários do Auth (e-mails e senhas dos operadores) não entram: são recriados por database/provision_operators.py.
A pasta backups/ contém dados de terceiros e fica fora do Git.
"""
import hashlib
import json
import sys
import urllib.error
import urllib.request
from datetime import datetime, timedelta
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
PASTA_BACKUPS = RAIZ / "backups"
# ordem importa na restauração (interacoes_sdr depende de empresas_alvo) e a chave define o upsert
TABELAS = {
    "empresas_alvo": "id",
    "interacoes_sdr": "id",
    "configuracoes": "chave",
    "base_conhecimento": "id",
}
VALIDADE_PADRAO_H = 24


def carregar_env() -> dict:
    caminho = RAIZ / "database" / ".env"
    if not caminho.exists():
        raise SystemExit("[erro] database/.env não existe (veja database/.env.example)")
    env = {}
    for linha in caminho.read_text(encoding="utf-8-sig").splitlines():
        linha = linha.strip()
        if linha and not linha.startswith("#") and "=" in linha:
            k, v = linha.split("=", 1)
            env[k.strip()] = v.strip().strip('"').strip("'")
    if not env.get("SUPABASE_SERVICE_ROLE_KEY") and env.get("SUPABASE_SERVICE_KEY"):
        env["SUPABASE_SERVICE_ROLE_KEY"] = env["SUPABASE_SERVICE_KEY"]
    if not (env.get("SUPABASE_URL") and env.get("SUPABASE_SERVICE_ROLE_KEY")):
        raise SystemExit("[erro] SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY precisam estar no database/.env")
    return env


def rest(env, metodo, caminho, corpo=None, extra=None):
    chave = env["SUPABASE_SERVICE_ROLE_KEY"]
    req = urllib.request.Request(
        f"{env['SUPABASE_URL'].rstrip('/')}/rest/v1/{caminho}", method=metodo,
        data=json.dumps(corpo).encode("utf-8") if corpo is not None else None,
        headers={"User-Agent": "SDRCockpit-AdminCLI/2.0", "apikey": chave, "Authorization": f"Bearer {chave}", "Content-Type": "application/json", **(extra or {})})
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            bruto = r.read()
            return dict(r.headers), (json.loads(bruto) if bruto else None)
    except urllib.error.HTTPError as e:
        raise RuntimeError(f"HTTP {e.code}: {e.read().decode('utf-8', 'replace')[:400]}")


def contar(env, tabela) -> int:
    cab, _ = rest(env, "GET", f"{tabela}?select=*", extra={"Prefer": "count=exact", "Range": "0-0"})
    return int(cab.get("Content-Range", "0/0").split("/")[-1])


def baixar(env, tabela, chave) -> list:
    linhas, passo, ini = [], 1000, 0
    while True:
        _, lote = rest(env, "GET", f"{tabela}?select=*&order={chave}&limit={passo}&offset={ini}")
        linhas += lote
        if len(lote) < passo:
            return linhas
        ini += passo


def sha256(caminho: Path) -> str:
    h = hashlib.sha256()
    with caminho.open("rb") as f:
        for bloco in iter(lambda: f.read(1 << 20), b""):
            h.update(bloco)
    return h.hexdigest()


def backups() -> list:
    if not PASTA_BACKUPS.exists():
        return []
    return sorted(p for p in PASTA_BACKUPS.iterdir() if (p / "manifest.json").exists())


def conferir(pasta: Path) -> list:
    """Devolve a lista de problemas do backup (vazia = íntegro)."""
    problemas = []
    try:
        man = json.loads((pasta / "manifest.json").read_text(encoding="utf-8"))
    except Exception as e:
        return [f"manifest.json ilegível: {e}"]
    for t in TABELAS:
        info = man.get("tabelas", {}).get(t)
        arq = pasta / f"{t}.json"
        if not info or not arq.exists():
            problemas.append(f"{t}: arquivo ausente")
            continue
        if sha256(arq) != info["sha256"]:
            problemas.append(f"{t}: hash diferente (arquivo alterado ou corrompido)")
            continue
        n = len(json.loads(arq.read_text(encoding="utf-8")))
        if n != info["linhas"]:
            problemas.append(f"{t}: {n} linhas no arquivo, {info['linhas']} no manifesto")
    return problemas


def backup_recente(env, horas=VALIDADE_PADRAO_H):
    """Para o guard das cargas: devolve (pasta, None) se há backup íntegro, recente e igual ao banco agora; senão (None, motivo)."""
    lista = backups()
    if not lista:
        return None, "nenhum backup encontrado em backups/"
    pasta = lista[-1]
    man = json.loads((pasta / "manifest.json").read_text(encoding="utf-8"))
    criado = datetime.fromisoformat(man["criado_em"])
    if datetime.now() - criado > timedelta(hours=horas):
        return None, f"o último backup ({pasta.name}) tem mais de {horas} h"
    problemas = conferir(pasta)
    if problemas:
        return None, f"o último backup ({pasta.name}) não passou na verificação: {'; '.join(problemas)}"
    for t in TABELAS:
        agora = contar(env, t)
        if agora != man["tabelas"][t]["linhas"]:
            return None, f"o banco mudou desde o backup {pasta.name}: {t} tinha {man['tabelas'][t]['linhas']} linhas e agora tem {agora}"
    return pasta, None


def cmd_criar(argv) -> int:
    env = carregar_env()
    motivo = argv[argv.index("--motivo") + 1] if "--motivo" in argv else ""
    pasta = PASTA_BACKUPS / datetime.now().strftime("%Y%m%d-%H%M%S")
    pasta.mkdir(parents=True)
    man = {"criado_em": datetime.now().isoformat(timespec="seconds"), "projeto": env["SUPABASE_URL"], "motivo": motivo, "tabelas": {}}
    print(f"Backup em {pasta}")
    for t, chave in TABELAS.items():
        esperado = contar(env, t)
        linhas = baixar(env, t, chave)
        if len(linhas) != esperado:
            print(f"[ERRO] {t}: o banco informa {esperado} linhas e foram baixadas {len(linhas)}. Backup descartado; tente de novo.")
            return 1
        arq = pasta / f"{t}.json"
        arq.write_text(json.dumps(linhas, ensure_ascii=False, indent=1), encoding="utf-8")
        man["tabelas"][t] = {"linhas": len(linhas), "sha256": sha256(arq), "bytes": arq.stat().st_size}
        print(f"  {t}: {len(linhas)} linhas")
    (pasta / "manifest.json").write_text(json.dumps(man, ensure_ascii=False, indent=1), encoding="utf-8")
    problemas = conferir(pasta)
    if problemas:
        print("[ERRO] a verificação do backup recém-criado falhou:", *problemas, sep="\n  - ")
        return 1
    print(f"[OK] backup íntegro e conferido (hashes e contagens). Pasta: {pasta.name}")
    return 0


def _pasta(argv, i=2):
    if len(argv) > i and not argv[i].startswith("--"):
        p = Path(argv[i])
        return p if p.is_absolute() or p.exists() else PASTA_BACKUPS / argv[i]
    lista = backups()
    if not lista:
        raise SystemExit("[erro] nenhum backup encontrado")
    return lista[-1]


def cmd_verificar(argv) -> int:
    pasta = _pasta(argv)
    problemas = conferir(pasta)
    man = json.loads((pasta / "manifest.json").read_text(encoding="utf-8")) if (pasta / "manifest.json").exists() else {}
    print(f"Backup {pasta.name} ({man.get('criado_em', '?')})")
    for t, i in man.get("tabelas", {}).items():
        print(f"  {t}: {i['linhas']} linhas")
    if problemas:
        print("[FALHOU]", *problemas, sep="\n  - ")
        return 1
    print("[OK] íntegro")
    return 0


def cmd_listar(argv) -> int:
    lista = backups()
    if not lista:
        print("Nenhum backup.")
        return 0
    for p in lista:
        man = json.loads((p / "manifest.json").read_text(encoding="utf-8"))
        res = ", ".join(f"{t}={i['linhas']}" for t, i in man["tabelas"].items())
        print(f"{p.name}  {res}  {('— ' + man['motivo']) if man.get('motivo') else ''}")
    return 0


def cmd_restaurar(argv) -> int:
    if len(argv) < 3:
        print(__doc__)
        return 2
    pasta, env = _pasta(argv), carregar_env()
    problemas = conferir(pasta)
    if problemas:
        print("[parado] o backup não está íntegro:", *problemas, sep="\n  - ")
        return 1
    so = argv[argv.index("--tabela") + 1] if "--tabela" in argv else None
    if so and so not in TABELAS:
        print(f"[erro] tabela desconhecida: {so}")
        return 2
    confirmar = "--confirmar" in argv
    print(f"Restaurar de {pasta.name} ({'GRAVA' if confirmar else 'simulação'})")
    for t, chave in TABELAS.items():
        if so and t != so:
            continue
        linhas = json.loads((pasta / f"{t}.json").read_text(encoding="utf-8"))
        atuais = {r[chave] for r in baixar(env, t, chave)}
        faltam = sum(1 for r in linhas if r[chave] not in atuais)
        print(f"  {t}: {len(linhas)} no backup, {len(atuais)} no banco agora; {faltam} serão recriadas e {len(linhas) - faltam} voltam ao estado do backup")
        if not confirmar:
            continue
        for i in range(0, len(linhas), 200):
            rest(env, "POST", f"{t}?on_conflict={chave}", linhas[i:i + 200], {"Prefer": "resolution=merge-duplicates,return=minimal"})
        print(f"    [OK] {t} restaurada")
    if not confirmar:
        print("\nSIMULAÇÃO: nada foi gravado. Repita com --confirmar.")
    return 0


def main(argv) -> int:
    comandos = {"criar": cmd_criar, "verificar": cmd_verificar, "listar": cmd_listar, "restaurar": cmd_restaurar}
    if len(argv) < 2 or argv[1] not in comandos:
        print(__doc__)
        return 2
    return comandos[argv[1]](argv)


if __name__ == "__main__":
    sys.exit(main(sys.argv))
