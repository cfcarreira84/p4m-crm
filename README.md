# SDR Cockpit Starter (v2.0.0)

Template multi-segmento de Cockpit Comercial Outbound B2B/B2C: Kanban de 9 fases, previsão probabilística Monte Carlo em Web Worker, cache local em IndexedDB com sincronização delta, base de leads enriquecida e IA Gemini sob demanda via Supabase Edge Function com rotação automática de modelos.

> **Rigorosamente limpo de marca, segmento, chaves e bancos.** Pronto para iniciar qualquer operação do zero absoluto a partir de `project.config.json`.

**Stack:** front-end em HTML, CSS e JavaScript puro (sem npm, bundler ou build) + Supabase (Postgres, Auth, Realtime e Edge Functions) + Gemini API. Não há servidor próprio. Detalhes em [docs/ARQUITETURA.md](docs/ARQUITETURA.md).

## Rodar localmente
```bash
python -m http.server 8080 --directory web
```
Abra `http://localhost:8080` e entre com o e-mail e a senha do operador. Mais detalhes em [docs/OPERACAO.md](docs/OPERACAO.md).

## Onboarding de Novo Projeto
1. Use a skill `/cockpit-novo-projeto` (ou `/grill-me`) para preencher `project.config.json` e `database/.env`.
2. Gere a configuração parametrizada:
   ```bash
   python tools/setup_projeto.py
   ```
3. Provisione banco, operadores e base de conhecimento:
   ```bash
   python tools/provisionar.py
   ```
4. Verifique higiene (zero contaminação):
   ```bash
   python tools/verificar_higiene.py
   ```

## Documentação
| Documento | Assunto |
|---|---|
| [AGENTS.md](AGENTS.md) | Instruções para agentes de IA (Antigravity / Claude Code), arquitetura e comandos |
| [docs/ARQUITETURA.md](docs/ARQUITETURA.md) | Stack, mapa do repositório, fluxo de dados, IndexedDB + Delta Sync, Monte Carlo Worker |
| [docs/SUPABASE.md](docs/SUPABASE.md) | Chaves, Auth, RLS, Realtime in-place, migrações, Edge Function `ia` e segredos |
| [docs/IA_GEMINI.md](docs/IA_GEMINI.md) | Plano gratuito e cotas, rotação de 5 modelos, prompts dinâmicos e verificação de citações |
| [docs/LEAN_OPS.md](docs/LEAN_OPS.md) | Abordagem lean: custo zero, IA sob demanda, validação antes da carga, testes em camadas |
| [docs/APRENDIZADOS.md](docs/APRENDIZADOS.md) | Problemas reais de produção, causas e soluções consolidadas |
| [docs/DECISOES.md](docs/DECISOES.md) | Decisões de produto e de engenharia, com gatilho de revisão |
| [docs/OPERACAO.md](docs/OPERACAO.md) | Configuração, publicação FTP, testes, release, colheita (`/cockpit-harvest`) e segredos |
| [database/CONTRATO_CARGA.md](database/CONTRATO_CARGA.md) | Contrato flexível de carga de leads (`contrato.json` + `dados_segmento`) |
| [CHANGELOG.md](CHANGELOG.md) | Histórico de versões |

## Estrutura
- `project.config.json` — manifesto único do projeto (marca, cores, categorias, fases, operadores, campos do segmento).
- `STARTER_VERSION` e `STARTER_ORIGIN.json` — rastreabilidade do template para evolução contínua via `/cockpit-harvest`.
- `web/` — aplicação estática (`cockpit_config.js`, `data/store.js`, `mc_worker.js`, `monte_carlo.js`, `supabase_client.js`, `auth.js`, `app.js`).
- `database/` — `schema.sql` consolidado, `migrations/`, `contrato.json`, `conhecimento/blocos.json` e scripts de provisionamento.
- `supabase/functions/ia/` — Edge Function da IA parametrizada via `base_conhecimento` (`nucleo-persona`, `nucleo-regras`).
- `tools/` — `setup_projeto.py`, `provisionar.py`, `deploy_ftp.py`, `carga_base.py`, `backup_banco.py`, `verificar_higiene.py`, `sync_version.py`, `prospect_base/` e suíte de testes.
- `.agents/skills/` — skills locais do projeto (`higienizar-base-prospeccao` e `carga-leads`).
