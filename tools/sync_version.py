#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Sincroniza o badge de versão e o hover card de histórico com o git.

Para cada tag vX.Y.Z (mais recente primeiro) grava: tag, hash curto do commit
da tag e o assunto da tag anotada (git tag -a -m "..."). A versão atual é a tag mais nova.
Reescreve apenas o bloco entre os marcadores <version-sync:start/end> em
web/assets/js/cockpit_config.js.

Fluxo de release:
    git commit -m "feat: ..."                                   # código da release
    git tag -a v1.1.0 -m "descrição curta exibida no hover card"  # a tag aponta p/ o commit da release
    python tools/sync_version.py                                  # atualiza badge + histórico
    git commit -am "chore(release): sincroniza versão v1.1.0"     # só o bloco da config muda
"""
import json
import os
import re
import subprocess

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CONFIG = os.path.join(ROOT, "web", "assets", "js", "cockpit_config.js")
INDEX = os.path.join(ROOT, "web", "index.html")


def git(*args):
    return subprocess.check_output(["git", *args], cwd=ROOT, text=True, encoding="utf-8").strip()


def main():
    tags = [t for t in git("tag", "--list", "v*", "--sort=-v:refname").splitlines() if t]
    if not tags:
        raise SystemExit("Nenhuma tag vX.Y.Z encontrada. Crie uma: git tag -a v1.0.0 -m 'descrição'")
    entries = []
    for t in tags:
        sha = git("rev-list", "-n", "1", "--abbrev-commit", "--abbrev=7", t)
        desc = git("tag", "-l", "--format=%(contents:subject)", t) or git("log", "-1", "--format=%s", t)
        entries.append({"tag": t, "commit": sha, "desc": desc})

    block = (
        "        // <version-sync:start>\n"
        f"        version: {json.dumps(entries[0]['tag'])},\n"
        "        versionHistory: "
        + json.dumps(entries, ensure_ascii=False, indent=4).replace("\n", "\n        ")
        + "\n        // <version-sync:end>"
    )
    src = open(CONFIG, encoding="utf-8").read()
    new, n = re.subn(r"        // <version-sync:start>.*?// <version-sync:end>", lambda m: block, src, flags=re.S)
    if n != 1:
        raise SystemExit("Marcadores <version-sync> não encontrados no cockpit_config.js")
    open(CONFIG, "w", encoding="utf-8", newline="\n").write(new)
    # Cache: scripts e CSS ganham ?v=<versão>. Sem isso o navegador e a CDN podem servir arquivos antigos após uma atualização.
    html = open(INDEX, encoding="utf-8").read()
    versao = entries[0]["tag"].lstrip("v")
    html2, k = re.subn(r'((?:src|href)="assets/(?:js|css)/[\w./-]+?)(?:\?v=[\w.]+)?(")', lambda m: f"{m.group(1)}?v={versao}{m.group(2)}", html)
    if html2 != html:
        open(INDEX, "w", encoding="utf-8", newline="\n").write(html2)
    print(f"Versão atual: {entries[0]['tag']} ({len(entries)} release(s) no histórico); {k} arquivos com ?v={versao}")


if __name__ == "__main__":
    main()
