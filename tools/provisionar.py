#!/usr/bin/env python3
"""
Orquestrador de provisionamento do SDR Cockpit Starter.

Fluxo:
1. Confere `database/.env` (URL, chaves e operadores).
2. Executa `tools/setup_projeto.py` para atualizar `cockpit_config.js`, `contrato.json` e `blocos.json` (se solicitado).
3. Executa `database/provision_operators.py` para criar/atualizar operadores no Supabase Auth.
4. Executa `database/seed_conhecimento.py` para gravar `database/conhecimento/blocos.json` em `base_conhecimento`.

Uso:
    python tools/provisionar.py
    python tools/provisionar.py --pular-setup
"""
from __future__ import annotations

import argparse
import subprocess
import sys
import urllib.error
import urllib.request
from pathlib import Path

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

RAIZ = Path(__file__).resolve().parent.parent
ENV_PATH = RAIZ / "database" / ".env"


def ler_env(caminho: Path) -> dict[str, str]:
    env: dict[str, str] = {}
    if not caminho.exists():
        return env
    for linha in caminho.read_text(encoding="utf-8-sig").splitlines():
        s = linha.strip()
        if not s or s.startswith("#") or "=" not in s:
            continue
        k, v = s.split("=", 1)
        env[k.strip()] = v.strip().strip('"').strip("'")
    return env


def verificar_tabelas(url: str, service_key: str) -> tuple[bool, list[str]]:
    faltando: list[str] = []
    for tabela in ("empresas_alvo", "interacoes_sdr", "base_conhecimento", "exclusoes_sync"):
        req = urllib.request.Request(
            f"{url.rstrip('/')}/rest/v1/{tabela}?select=*&limit=1",
            headers={
                "apikey": service_key,
                "Authorization": f"Bearer {service_key}",
                "User-Agent": "SDRCockpit-AdminCLI/2.0",
            },
        )
        try:
            with urllib.request.urlopen(req, timeout=15) as r:
                if r.status >= 400:
                    faltando.append(tabela)
        except urllib.error.HTTPError as e:
            if e.code in (404, 400):
                faltando.append(tabela)
        except Exception:
            faltando.append(tabela)
    return len(faltando) == 0, faltando


def rodar(cmd: list[str], descricao: str) -> int:
    print(f"\n==> {descricao}...")
    proc = subprocess.run(cmd, cwd=str(RAIZ))
    return proc.returncode


def main() -> int:
    ap = argparse.ArgumentParser(description="Provisiona ambiente do SDR Cockpit.")
    ap.add_argument("--pular-setup", action="store_true", help="Não roda tools/setup_projeto.py antes do provisionamento")
    args = ap.parse_args()

    if not ENV_PATH.exists():
        print(f"ERRO: {ENV_PATH} não encontrado. Copie database/.env.example para database/.env e preencha as chaves.", file=sys.stderr)
        return 1

    env = ler_env(ENV_PATH)
    if not env.get("SUPABASE_SERVICE_KEY") and env.get("SUPABASE_SERVICE_ROLE_KEY"):
        env["SUPABASE_SERVICE_KEY"] = env["SUPABASE_SERVICE_ROLE_KEY"]
    obrigatorias = ["SUPABASE_URL", "SUPABASE_ANON_KEY", "SUPABASE_SERVICE_KEY"]
    ausentes = [k for k in obrigatorias if not env.get(k) or "SEU-PROJETO" in env.get(k, "") or "SUA_CHAVE" in env.get(k, "")]
    if ausentes:
        print(f"ERRO: variáveis ausentes ou com placeholder em database/.env: {', '.join(ausentes)}", file=sys.stderr)
        return 1

    if not args.pular_setup and (RAIZ / "project.config.json").exists():
        rc = rodar([sys.executable, str(RAIZ / "tools" / "setup_projeto.py")], "Sincronizando project.config.json")
        if rc != 0:
            return rc

    ok_schema, faltando = verificar_tabelas(env["SUPABASE_URL"], env["SUPABASE_SERVICE_KEY"])
    if not ok_schema:
        print("\n[ATENÇÃO] As seguintes tabelas ainda não existem ou precisam de migração no Supabase:")
        for t in faltando:
            print(f"  - {t}")
        print("Execute `database/schema.sql` (base nova) ou `database/migrations/005_starter_v2_sync_segmento.sql` no SQL Editor do Supabase.")

    rc = rodar([sys.executable, str(RAIZ / "database" / "provision_operators.py")], "Provisionando operadores no Supabase Auth")
    if rc != 0:
        return rc

    if ok_schema or "base_conhecimento" not in faltando:
        rc = rodar([sys.executable, str(RAIZ / "database" / "seed_conhecimento.py")], "Semeando base_conhecimento")
        if rc != 0:
            return rc

    print("\n[OK] Provisionamento concluído.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
