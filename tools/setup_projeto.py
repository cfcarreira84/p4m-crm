#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Aplica a configuração declarativa de `project.config.json` (e opcionalmente `database/.env`)
gerando `web/assets/js/cockpit_config.js` e atualizando o título/ícone em `web/index.html`,
preservando o bloco `<version-sync:start/end>`.

Uso:
    python tools/setup_projeto.py [--strict]
"""
import json
import re
import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
CFG_JSON = RAIZ / "project.config.json"
CFG_JS = RAIZ / "web" / "assets" / "js" / "cockpit_config.js"
INDEX_HTML = RAIZ / "web" / "index.html"
ENV_PATH = RAIZ / "database" / ".env"


def carregar_env(caminho: Path) -> dict:
    if not caminho.exists():
        return {}
    env = {}
    for linha in caminho.read_text(encoding="utf-8-sig").splitlines():
        linha = linha.strip()
        if linha and not linha.startswith("#") and "=" in linha:
            k, v = linha.split("=", 1)
            env[k.strip()] = v.strip().strip('"').strip("'")
    return env


def extrair_bloco_versao(js_atual: str) -> str:
    m = re.search(r"(// <version-sync:start>.*?// <version-sync:end>)", js_atual, flags=re.S)
    if m:
        return m.group(1)
    versao = (RAIZ / "STARTER_VERSION").read_text(encoding="utf-8").strip() if (RAIZ / "STARTER_VERSION").exists() else "2.0.0"
    tag = versao if versao.startswith("v") else f"v{versao}"
    return (
        "// <version-sync:start>\n"
        f'        version: "{tag}",\n'
        '        versionHistory: [\n'
        f'            {{ "tag": "{tag}", "commit": "starter", "desc": "Release inicial a partir do SDR Cockpit Starter" }}\n'
        "        ]\n"
        "        // <version-sync:end>"
    )


def main(argv: list) -> int:
    strict = "--strict" in argv
    if not CFG_JSON.exists():
        print(f"[erro] {CFG_JSON} não encontrado.")
        return 1
    cfg = json.loads(CFG_JSON.read_text(encoding="utf-8"))
    env = carregar_env(ENV_PATH)

    # Se database/.env já tiver SUPABASE_URL e SUPABASE_ANON_KEY preenchidos, sincroniza no config
    sb = cfg.setdefault("supabase", {})
    if env.get("SUPABASE_URL") and "SEU_PROJETO" in sb.get("url", "SEU_PROJETO"):
        sb["url"] = env["SUPABASE_URL"]
    if env.get("SUPABASE_ANON_KEY") and ("SUA_SUPABASE" in sb.get("anonKey", "SUA_SUPABASE") or not sb.get("anonKey")):
        sb["anonKey"] = env["SUPABASE_ANON_KEY"]

    if strict:
        if "SEU_PROJETO" in sb.get("url", "") or "SUA_SUPABASE" in sb.get("anonKey", ""):
            print("[erro] Supabase URL/AnonKey ainda estão com valores de placeholder.")
            return 1

    js_atual = CFG_JS.read_text(encoding="utf-8") if CFG_JS.exists() else ""
    bloco_versao = extrair_bloco_versao(js_atual)

    brand = cfg.get("brand", {})
    stages = cfg.get("stages", [])
    followup = {s["id"]: s.get("followupDays", 2) for s in stages}
    stages_clean = [{k: v for k, v in s.items() if k != "followupDays"} for s in stages]

    matrizes = cfg.get("matrizes") or {
        "b2b": {
            "interlocutor": {
                "label": "Interlocutor:",
                "dica": "Com quem a conversa está acontecendo",
                "opcoes": [["dono_socio", "Dono / Sócio Direto"], ["atendente_balcao", "Atendente de Balcão"]],
            },
            "afinidade": {
                "label": "Inclinação de Parceria:",
                "campo": "discovery_inclinacao_parceria",
                "dica": "Abertura do contato para uma relação comercial ou de parceria recorrente",
                "opcoes": [["baixo", "Baixo"], ["medio", "Médio"], ["alto", "Alto"]],
            },
        },
        "b2c": {
            "interlocutor": {
                "label": "Interlocutor:",
                "dica": "Quem está na conversa: o comprador, um especificador/arquiteto ou um representante",
                "opcoes": [["comprador", "Comprador"], ["arquiteto", "Especificador / Arquiteto"], ["representante", "Representante (familiar ou outro)"]],
            },
            "afinidade": {
                "label": "Encantamento com os Produtos:",
                "campo": "discovery_encantamento_produtos",
                "dica": "Quanto o cliente se encantou com a solução apresentada",
                "opcoes": [["baixo", "Baixo"], ["medio", "Médio"], ["alto", "Alto"]],
            },
        },
    }

    prioridades = cfg.get("prioridades") or {
        "alta": {"label": "Alta"},
        "media_alta": {"label": "Média-alta"},
        "media": {"label": "Média"},
        "baixa": {"label": "Baixa"},
        "a_qualificar": {"label": "A qualificar"},
    }

    ai = {
        "enabled": bool(cfg.get("ai", {}).get("enabled", True)),
        "apiKey": "",
        "model": cfg.get("ai", {}).get("model", "gemini-3-flash-preview"),
        "fallbackModels": cfg.get("ai", {}).get(
            "fallbackModels",
            ["gemini-3.5-flash", "gemini-3.6-flash", "gemini-3-flash-preview", "gemini-3.5-flash-lite", "gemini-2.5-flash"],
        ),
        "webSearch": bool(cfg.get("ai", {}).get("webSearch", False)),
        "useEdgeFunction": bool(cfg.get("ai", {}).get("useEdgeFunction", True)),
        "forbiddenTerms": cfg.get("ai", {}).get("forbiddenTerms", []),
    }

    dump = lambda obj, ind=8: json.dumps(obj, ensure_ascii=False, indent=4).replace("\n", "\n" + " " * ind)

    conteudo = f"""/**
 * ==============================================================================
 * {brand.get("appName", "SDR Cockpit").upper()} - CONFIGURAÇÃO CENTRALIZADA (cockpit_config.js)
 * ==============================================================================
 * Gerado por `python tools/setup_projeto.py` a partir de `project.config.json`.
 * SEGURANÇA: aqui entra SOMENTE a chave publicável (anon).
 * ==============================================================================
 */

const CockpitConfig = {{
    brand: {{
        appName: {json.dumps(brand.get("appName", "SDR Cockpit"), ensure_ascii=False)},
        productName: {json.dumps(brand.get("productName", brand.get("appName", "SDR Cockpit")), ensure_ascii=False)},
        companyName: {json.dumps(brand.get("companyName", "Sua Marca"), ensure_ascii=False)},
        tagline: {json.dumps(brand.get("tagline", ""), ensure_ascii=False)},
        logoIcon: {json.dumps(brand.get("logoIcon", "zap"), ensure_ascii=False)},
        currencySymbol: {json.dumps(brand.get("currencySymbol", "R$"), ensure_ascii=False)},
        catalogUrl: {json.dumps(brand.get("catalogUrl", ""), ensure_ascii=False)},
        operators: {dump(brand.get("operators", []), 8)},
        {bloco_versao}
    }},

    supabase: {dump(sb, 4)},

    ai: {dump(ai, 4)},

    stages: {dump(stages_clean, 4)},

    followupDays: {dump(followup, 4)},

    categories: {dump(cfg.get("categories", []), 4)},

    segmentFields: {dump(cfg.get("segmentFields", []), 4)},

    matrizes: {dump(matrizes, 4)},

    prioridades: {dump(prioridades, 4)},

    monteCarlo: {dump(cfg.get("monteCarlo", {}), 4)}
}};

if (typeof window !== "undefined") {{
    window.CockpitConfig = CockpitConfig;
}}
if (typeof module !== "undefined" && module.exports) {{
    module.exports = CockpitConfig;
}}
"""
    CFG_JS.write_text(conteudo, encoding="utf-8", newline="\n")

    if INDEX_HTML.exists():
        html = INDEX_HTML.read_text(encoding="utf-8")
        app_name = brand.get("appName", "SDR Cockpit")
        icon = brand.get("logoIcon", "zap")
        html = re.sub(r"<title>.*?</title>", f"<title>{app_name}</title>", html)
        html = re.sub(
            r'<span class="logo-icon" title="[^"]*"><i data-lucide="[^"]*"></i></span>',
            f'<span class="logo-icon" title="{app_name}"><i data-lucide="{icon}"></i></span>',
            html,
        )
        INDEX_HTML.write_text(html, encoding="utf-8", newline="\n")

    print(f"[ok] cockpit_config.js e index.html sincronizados para '{brand.get('appName', 'SDR Cockpit')}'")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
