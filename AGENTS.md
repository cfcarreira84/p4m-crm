# AGENTS.md — Guia para Agentes de IA (Antigravity / Claude Code)

Este repositório é baseado no **SDR Cockpit Starter v2.0.0**. Siga estas diretrizes em qualquer manutenção, onboarding ou evolução do projeto.

---

## 1. Princípios Inegociáveis

1. **Zero-Build no Front-end (`web/`)**: HTML5 + CSS3 + Vanilla JS (ES2020). Nunca introduza `npm`, bundlers (Vite/Webpack) ou frameworks no cliente.
2. **Zero-Mentira na UI**: nenhuma mutação (mover card, salvar nota, alterar discovery, criar lead) pode exibir sucesso antes da confirmação HTTP 2xx do Supabase. O cache local (`IndexedDB`) acelera a **leitura**, jamais finge escrita.
3. **Zero Chaves no Navegador**: `web/assets/js/cockpit_config.js` contém apenas `SUPABASE_URL` e `SUPABASE_ANON_KEY` (`sb_publishable_...`). A service key (`sb_secret_...`) vive exclusivamente em `database/.env` (não versionado) e a `GEMINI_KEY` vive no Secret da Edge Function `ia` (e em `database/.env` para testes locais).
4. **Fonte Única de Parametrização**: `project.config.json` (na raiz) e `web/assets/js/cockpit_config.js`. Personas, regras comerciais e catálogo da IA vivem em `database/conhecimento/blocos.json` (sincronizado para a tabela `base_conhecimento` via `python database/seed_conhecimento.py`).
5. **User-Agent em Scripts Python**: o Supabase bloqueia chamadas administrativas com `sb_secret_...` quando o `User-Agent` padrão do `urllib` é usado. Sempre inclua `"User-Agent": "SDRCockpit-AdminCLI/2.0"` nos headers HTTP em Python.

---

## 2. Comandos Essenciais

```bash
# Aplicar project.config.json em cockpit_config.js, blocos.json e contrato.json
python tools/setup_projeto.py

# Provisionar operadores e base de conhecimento no Supabase
python tools/provisionar.py

# Testar localmente
python -m http.server 8080 --directory web

# Rodar suíte de testes (sem custo de IA)
python tools/testar_carga.py
node tools/testar_monte_carlo.mjs
node tools/testar_funcao_ia.mjs

# Verificar higiene (zero contaminação de marca/segredos)
python tools/verificar_higiene.py

# Sincronizar versão (badge + cache busting ?v=X.Y.Z)
python tools/sync_version.py
```

---

## 3. Skills Disponíveis

- **`/cockpit-novo-projeto`**: conduz o `/grill-me` de novo cliente, preenche `project.config.json`, gera os arquivos e provisiona o Supabase.
- **`/captacao-leads`**: pipeline compartilhado (`_TOOLS/captacao/`) para descoberta e enriquecimento de leads com subagentes em paralelo.
- **`/higienizar-base-prospeccao`**: transforma planilhas brutas em CSV validado segundo `database/contrato.json` usando `tools/prospect_base/`.
- **`/carga-leads`**: valida, simula, cria backup verificado (`tools/backup_banco.py`) e carrega lotes no Supabase (`tools/carga_base.py`).
- **`/cockpit-harvest`**: colhe melhorias genéricas desenvolvidas em um projeto de cliente de volta para o `sdr-cockpit-starter` comparando contra `STARTER_ORIGIN.json`.
