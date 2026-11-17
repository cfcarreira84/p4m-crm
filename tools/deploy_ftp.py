#!/usr/bin/env python3
"""
Publicação estática da pasta `web/` via FTP/FTPS com verificação HTTP 200 pós-deploy.

Lê credenciais de `database/.env`:
  FTP_HOST=ftp.seudominio.com.br
  FTP_USER=usuario
  FTP_PASS=senha
  FTP_REMOTE_DIR=/public_html/crm
  PUBLIC_URL=https://seudominio.com.br/crm/

Uso:
  python tools/deploy_ftp.py --simular
  python tools/deploy_ftp.py --confirmar
"""
from __future__ import annotations

import argparse
import ftplib
import sys
import urllib.request
from pathlib import Path

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

RAIZ = Path(__file__).resolve().parent.parent
WEB_DIR = RAIZ / "web"
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


def garantir_dir_remoto(ftp: ftplib.FTP, caminho_remoto: str) -> None:
    partes = [p for p in caminho_remoto.replace("\\", "/").split("/") if p]
    if caminho_remoto.startswith("/"):
        ftp.cwd("/")
    for p in partes:
        try:
            ftp.cwd(p)
        except ftplib.error_perm:
            ftp.mkd(p)
            ftp.cwd(p)


def listar_arquivos_web() -> list[Path]:
    arquivos: list[Path] = []
    for p in sorted(WEB_DIR.rglob("*")):
        if p.is_file():
            arquivos.append(p)
    return arquivos


def main() -> int:
    ap = argparse.ArgumentParser(description="Deploy da pasta web/ via FTP.")
    ap.add_argument("--simular", action="store_true", help="Apenas lista os arquivos que seriam enviados")
    ap.add_argument("--confirmar", action="store_true", help="Executa o upload real via FTP")
    args = ap.parse_args()

    arquivos = listar_arquivos_web()
    print(f"Pasta local: {WEB_DIR} ({len(arquivos)} arquivos)")
    for a in arquivos:
        rel = a.relative_to(WEB_DIR).as_posix()
        print(f"  - {rel} ({a.stat().st_size} bytes)")

    if not args.confirmar:
        print("\nModo simulação. Passe --confirmar para publicar via FTP.")
        return 0

    env = ler_env(ENV_PATH)
    for k in ("FTP_HOST", "FTP_USER", "FTP_PASS", "FTP_REMOTE_DIR"):
        if not env.get(k):
            print(f"ERRO: defina {k} em database/.env antes de publicar.", file=sys.stderr)
            return 1

    host = env["FTP_HOST"]
    user = env["FTP_USER"]
    passwd = env["FTP_PASS"]
    remote_root = env["FTP_REMOTE_DIR"].rstrip("/")

    print(f"\nConectando a {host}...")
    with ftplib.FTP(host, timeout=30) as ftp:
        ftp.login(user, passwd)
        print(f"PWD inicial: {ftp.pwd()}")
        garantir_dir_remoto(ftp, remote_root)
        for a in arquivos:
            rel = a.relative_to(WEB_DIR).as_posix()
            remoto = f"{remote_root}/{rel}"
            garantir_dir_remoto(ftp, str(Path(remoto).parent).replace("\\", "/"))
            with a.open("rb") as f:
                ftp.storbinary(f"STOR {a.name}", f)
            print(f"  [OK] {rel}")

    public_url = env.get("PUBLIC_URL", "").strip()
    if public_url:
        req = urllib.request.Request(public_url, headers={"User-Agent": "SDRCockpit-DeployCheck/2.0"})
        with urllib.request.urlopen(req, timeout=15) as r:
            print(f"\nVerificação HTTP: {public_url} -> status {r.status}")
            robots = r.headers.get("X-Robots-Tag", "")
            if robots:
                print(f"X-Robots-Tag: {robots}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
