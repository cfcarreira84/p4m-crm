#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Grava a base de conhecimento (database/conhecimento/blocos.json) na tabela `base_conhecimento`.

Idempotente: reexecutar atualiza os blocos pelo `id`. Blocos que saírem do JSON NÃO são apagados
automaticamente (use --desativar-ausentes para marcá-los como inativos).

Uso:
    python database/seed_conhecimento.py [--dry-run] [--desativar-ausentes]
Somente biblioteca padrão.
"""
import json
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

AQUI = Path(__file__).resolve().parent
RAIZ = AQUI.parent
CAMPOS = ("id", "tipo", "titulo", "conteudo", "perfis", "fases", "palavras", "restrito", "prioridade", "fonte")


def load_env(path: Path) -> dict:
    env = {}
    for line in path.read_text(encoding="utf-8-sig").splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            env[k.strip()] = v.strip().strip('"').strip("'")
    return env


def termos_proibidos() -> list:
    cfg_path = RAIZ / "project.config.json"
    if not cfg_path.exists():
        return []
    try:
        cfg = json.loads(cfg_path.read_text(encoding="utf-8"))
        return [str(t).strip().lower() for t in cfg.get("ai", {}).get("forbiddenTerms", []) if str(t).strip()]
    except Exception:
        return []


def validar(blocos: list) -> list:
    erros, ids = [], set()
    proibidos = termos_proibidos()
    for b in blocos:
        bid = b.get("id", "?")
        if bid in ids:
            erros.append(f"id repetido: {bid}")
        ids.add(bid)
        for c in ("id", "tipo", "titulo", "conteudo"):
            if not str(b.get(c, "")).strip():
                erros.append(f"{bid}: campo obrigatório vazio ({c})")
        if b.get("restrito") and not b.get("perfis"):
            erros.append(f"{bid}: bloco restrito precisa listar os perfis permitidos")
        texto_bloco = json.dumps(b, ensure_ascii=False).lower()
        for termo in proibidos:
            if termo in texto_bloco:
                erros.append(f"{bid}: contém termo proibido pela marca ('{termo}')")
    return erros


def main() -> int:
    dry = "--dry-run" in sys.argv
    blocos = json.loads((AQUI / "conhecimento" / "blocos.json").read_text(encoding="utf-8"))
    erros = validar(blocos)
    if erros:
        print("[erro] blocos inválidos:\n  " + "\n  ".join(erros))
        return 1
    palavras = sum(len(b["conteudo"].split()) for b in blocos)
    print(f"[ok] {len(blocos)} blocos válidos, ~{palavras} palavras (~{int(palavras * 1.7)} tokens se enviados todos)")
    if dry:
        return 0

    env = load_env(AQUI / ".env")
    url, service = env.get("SUPABASE_URL", "").rstrip("/"), env.get("SUPABASE_SERVICE_ROLE_KEY", "")
    if not (url and service):
        print("[erro] SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY precisam estar no database/.env")
        return 1
    hdr = {
        "apikey": service,
        "Authorization": f"Bearer {service}",
        "Content-Type": "application/json",
        "User-Agent": "SDRCockpit-AdminCLI/2.0",
    }
    agora = datetime.now(timezone.utc).isoformat()
    payload = [{**{c: b.get(c) for c in CAMPOS if c in b}, "ativo": True, "updated_at": agora} for b in blocos]
    for p in payload:
        p.setdefault("perfis", [])
        p.setdefault("fases", [])
        p.setdefault("palavras", [])
        p.setdefault("restrito", False)
        p.setdefault("prioridade", 50)
        p.setdefault("fonte", None)
    try:
        req = urllib.request.Request(
            f"{url}/rest/v1/base_conhecimento?on_conflict=id",
            data=json.dumps(payload).encode("utf-8"),
            method="POST",
            headers={**hdr, "Prefer": "resolution=merge-duplicates,return=minimal"},
        )
        urllib.request.urlopen(req, timeout=30)
        print(f"[ok] {len(payload)} blocos gravados em base_conhecimento")
        if "--desativar-ausentes" in sys.argv:
            lista = ",".join(b["id"] for b in blocos)
            req = urllib.request.Request(
                f"{url}/rest/v1/base_conhecimento?id=not.in.({urllib.parse.quote(lista)})",
                data=json.dumps({"ativo": False}).encode("utf-8"),
                method="PATCH",
                headers={**hdr, "Prefer": "return=minimal"},
            )
            urllib.request.urlopen(req, timeout=30)
            print("[ok] blocos ausentes do JSON foram desativados")
    except urllib.error.HTTPError as e:
        print(f"[erro] HTTP {e.code}: {e.read().decode('utf-8', 'replace')[:300]}")
        print("       O schema.sql (ou migração 003) já foi executado no projeto Supabase?")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
