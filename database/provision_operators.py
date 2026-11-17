#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Cria (ou confirma) os operadores no Supabase Auth lendo a lista de `project.config.json`
e os e-mails/senha de `database/.env` (`OPERATOR_PASSWORD` e `OPERATOR_<KEY_UPPER>_EMAIL`).
Somente biblioteca padrão. Rode DEPOIS do schema.sql:

    python database/provision_operators.py
"""
import json
import sys
import urllib.error
import urllib.request
from pathlib import Path

AQUI = Path(__file__).resolve().parent
RAIZ = AQUI.parent
ENV_PATH = AQUI / ".env"
CFG_PATH = RAIZ / "project.config.json"


def load_env(path: Path) -> dict:
    if not path.exists():
        return {}
    env = {}
    for line in path.read_text(encoding="utf-8-sig").splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            env[k.strip()] = v.strip().strip('"').strip("'")
    return env


def load_operators(env: dict) -> list:
    if CFG_PATH.exists():
        cfg = json.loads(CFG_PATH.read_text(encoding="utf-8"))
        ops = cfg.get("brand", {}).get("operators", [])
        if ops:
            return [(str(o["key"]).upper(), str(o["name"])) for o in ops if o.get("key") and o.get("name")]
    # Fallback: descobre pelas variáveis OPERATOR_<TAG>_EMAIL no .env
    achados = []
    for k in env:
        if k.startswith("OPERATOR_") and k.endswith("_EMAIL"):
            tag = k[len("OPERATOR_"):-len("_EMAIL")]
            if tag:
                achados.append((tag, tag.capitalize()))
    return achados


def call(url: str, key: str, method: str = "GET", body=None):
    req = urllib.request.Request(
        url,
        method=method,
        data=json.dumps(body).encode("utf-8") if body is not None else None,
        headers={
            "apikey": key,
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
            "User-Agent": "SDRCockpit-AdminCLI/2.0",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return resp.status, json.loads(resp.read() or b"{}")
    except urllib.error.HTTPError as e:
        raw = e.read().decode("utf-8", "replace")
        try:
            return e.code, json.loads(raw)
        except ValueError:
            return e.code, {"raw": raw}


def main() -> int:
    env = load_env(ENV_PATH)
    base = env.get("SUPABASE_URL", "").rstrip("/")
    key = env.get("SUPABASE_SERVICE_ROLE_KEY", "")
    password = env.get("OPERATOR_PASSWORD", "")
    if not (base and key and password):
        print("[erro] Faltam SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY ou OPERATOR_PASSWORD em database/.env")
        return 1

    operators = load_operators(env)
    if not operators:
        print("[erro] Nenhum operador configurado em project.config.json ou database/.env")
        return 1

    failed = False
    for tag, name in operators:
        email = env.get(f"OPERATOR_{tag}_EMAIL", "")
        if not email:
            print(f"[pulado] {name}: OPERATOR_{tag}_EMAIL vazio em database/.env")
            failed = True
            continue
        status, data = call(
            f"{base}/auth/v1/admin/users",
            key,
            "POST",
            {"email": email, "password": password, "email_confirm": True, "user_metadata": {"name": name}},
        )
        if status in (200, 201):
            print(f"[criado] {name} <{email}>")
        elif status == 422 or "already" in json.dumps(data).lower():
            print(f"[existe] {name} <{email}> (nada alterado)")
        else:
            print(f"[erro {status}] {name}: {data}")
            failed = True
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
