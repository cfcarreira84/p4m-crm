#!/usr/bin/env python3
"""Verifica higiene e ausência de contaminação no repositório sdr-cockpit-starter.

    python tools/verificar_higiene.py

Garante que nenhum arquivo rastreado ou presente no starter contenha:
- nomes de marcas/clientes de projetos específicos (AUREN, ATTIMO, Beer Center, Animalmix, etc.)
- referências de banco de dados reais (yejtnpuldfamyaicqvyc, dkrddqomyvejfvaeagoa)
- chaves secretas do Supabase ou Google AI Studio (sb_secret_, sb_publishable_, AIza, AQ.Ab8)
- pastas ou artefatos de clientes (.env real, backups/)

Código de saída: 0 = repositório 100% limpo; 1 = contaminação detectada.
"""
import re
import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent

IGNORAR_PASTAS = {
    ".git",
    "node_modules",
    "__pycache__",
    ".venv",
    "venv",
}

ARQUIVOS_PROIBIDOS = [
    "database/.env",
    "backups",
]

# Padrões proibidos em todo o repositório (exceto na própria lista de exemplos deste script se aplicável)
PADROES_PROIBIDOS = [
    ("Marca AUREN", re.compile(r"\bauren\b", re.I)),
    ("Domínio auren.arq.br", re.compile(r"auren\.arq\.br", re.I)),
    ("Marca ATTIMO", re.compile(r"\battimo\b", re.I)),
    ("Produto Beer Center", re.compile(r"beer\s*center", re.I)),
    ("Marca Animalmix", re.compile(r"\banimalmix\b", re.I)),
    ("Supabase Ref Produção", re.compile(r"yejtnpuldfamyaicqvyc", re.I)),
    ("Supabase Ref Teste", re.compile(r"dkrddqomyvejfvaeagoa", re.I)),
    ("Chave Secreta Supabase", re.compile(r"sb_secret_(?!SUA_CHAVE)[A-Za-z0-9_-]{10,}")),
    ("Chave Publicável Real Supabase", re.compile(r"sb_publishable_(?!SUA_CHAVE)[A-Za-z0-9_-]{15,}")),
    ("Chave Google AI (AIza)", re.compile(r"AIza[0-9A-Za-z_-]{20,}")),
    ("Chave Google AI (AQ.)", re.compile(r"AQ\.[0-9A-Za-z_-]{20,}")),
    ("JWT real chumbado", re.compile(r"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9\.[A-Za-z0-9_-]{20,}")),
]

EXTENSOES_TEXTO = {
    ".py", ".js", ".mjs", ".ts", ".json", ".sql", ".md", ".html", ".css",
    ".txt", ".yml", ".yaml", ".example", ".gitignore", ""
}


def verificar() -> int:
    problemas = []

    for rel in ARQUIVOS_PROIBIDOS:
        alvo = RAIZ / rel
        if alvo.exists():
            problemas.append(f"[ARQUIVO PROIBIDO] '{rel}' existe no diretório do starter (remova antes de empacotar/commitar)")

    este_script = Path(__file__).resolve()
    arquivos_varridos = 0

    for arq in RAIZ.rglob("*"):
        if any(p in IGNORAR_PASTAS for p in arq.parts):
            continue
        if not arq.is_file() or arq.resolve() == este_script:
            continue
        if arq.suffix.lower() not in EXTENSOES_TEXTO and not arq.name.startswith("."):
            continue

        try:
            texto = arq.read_text(encoding="utf-8")
        except Exception:
            continue

        arquivos_varridos += 1
        rel_path = arq.relative_to(RAIZ).as_posix()

        for num_linha, linha in enumerate(texto.splitlines(), start=1):
            for rotulo, regex in PADROES_PROIBIDOS:
                m = regex.search(linha)
                if m:
                    trecho = m.group(0)
                    problemas.append(f"[{rotulo}] {rel_path}:{num_linha} -> '{trecho}'")

    print(f"Higiene verificada em {arquivos_varridos} arquivos de '{RAIZ.name}'.")
    if problemas:
        print(f"\n[FALHOU] {len(problemas)} ocorrência(s) de contaminação encontrada(s):")
        for p in problemas[:50]:
            print(f"  - {p}")
        if len(problemas) > 50:
            print(f"  ... e mais {len(problemas) - 50} ocorrência(s).")
        return 1

    print("[OK] Zero contaminação de marca, segmento, banco ou chaves secretas.")
    return 0


if __name__ == "__main__":
    sys.exit(verificar())
