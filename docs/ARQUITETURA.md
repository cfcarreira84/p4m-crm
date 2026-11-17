# Arquitetura do SDR Cockpit

## Stack em uma frase
Front-end estático em **HTML + CSS + JavaScript puro** (sem npm, bundler ou build), com cache local em **IndexedDB** e cálculo probabilístico em **Web Worker**, falando direto com o **Supabase** (Postgres + Auth + Realtime + Edge Functions) e com o **Gemini** por meio da Edge Function `ia`. Não existe servidor próprio para manter.

| Camada | Tecnologia | Observação |
|---|---|---|
| Interface | HTML, CSS, JS (ES2020) em `web/` | Sem build. Bibliotecas por CDN com versão fixa: `supabase-js 2.118.0`, `lucide 1.68.0`; fontes do Google Fonts |
| Cache Local | IndexedDB (`web/assets/js/data/store.js`) | Boot instantâneo com o estado local + sincronização delta (`updated_at > lastSyncAt`) e exclusões (`exclusoes_sync`) |
| Monte Carlo | Web Worker (`web/assets/js/mc_worker.js`) | Simulação de 10.000 iterações fora da thread principal, com fallback síncrono |
| Dados | Supabase Postgres | RLS ligada em todas as tabelas; API REST gerada pelo PostgREST |
| Login | Supabase Auth (e-mail e senha) | Operadores com a mesma visão; sem cadastro público |
| Tempo real | Supabase Realtime | Patch cirúrgico in-place (`INSERT`, `UPDATE`, `DELETE`) em memória e no IndexedDB |
| IA | Edge Function `ia` (Deno/TypeScript) + Gemini API | Prompt parametrizado via `base_conhecimento`, chave em segredo e rotação de 5 modelos |
| Automação | Scripts Python (somente biblioteca padrão) e Node (testes) | Setup, provisionamento, higienização, carga, backup, deploy FTP e release |
| Versionamento | Git, SemVer, Conventional Commits | Badge de versão no app e cache-busting alimentados pelas tags |

## Mapa do repositório
```text
project.config.json       manifesto único do projeto (marca, categorias, fases, operadores, campos)
STARTER_VERSION           versão do template base (2.0.0)
STARTER_ORIGIN.json       hashes SHA-256 dos arquivos de núcleo para colheita (/cockpit-harvest)
web/                      aplicação estática (é o que se publica)
  index.html              estrutura da página e modais
  assets/css/style.css    tema escuro glassmorphic
  assets/js/
    cockpit_config.js     parametrização gerada para o navegador (marca, fases, perfis, pesos, IA)
    data/store.js         cache IndexedDB, sync delta e lazy-loading da timeline (CockpitStore)
    mc_worker.js          Web Worker para a simulação de Monte Carlo
    monte_carlo.js        probabilidade de fechamento, ordenação do Kanban e ponte assíncrona com Worker
    supabase_client.js    acesso REST enxuto/delta ao banco e cliente da Edge Function `ia`
    auth.js               tela de login e sessão (AuthGate)
    app.js                Kanban, cartão do lead, filtros, timeline sob demanda, notas
database/
  schema.sql              estado final do banco (para bases novas)
  migrations/             001 a 005 (idempotentes, incluindo dados_segmento e exclusoes_sync)
  contrato.json           mapeamento flexível de colunas, aliases e regras de enriquecimento local
  conhecimento/blocos.json  base de conhecimento da IA (incluindo nucleo-persona e nucleo-regras)
  provision_operators.py  cria os usuários no Supabase Auth
  seed_conhecimento.py    grava blocos.json no banco
  CONTRATO_CARGA.md       regras de qualidade para toda carga de leads
supabase/functions/ia/    Edge Function da IA (análise com verificação de citações, mensagem e console)
tools/
  setup_projeto.py        gera cockpit_config.js, blocos.json e contrato.json a partir de project.config.json
  provisionar.py          orquestra setup, operadores e seed de conhecimento
  deploy_ftp.py           publicação via FTP com verificação HTTP 200
  carga_base.py           validador, enriquecedor por regras e carregador de CSV de leads
  backup_banco.py         backup JSON das tabelas com manifesto SHA-256 e restauração
  prospect_base/          motor de higienização de planilhas brutas com perfil _modelo
  verificar_higiene.py    linter de zero contaminação de marca e segredos
  sync_version.py         sincroniza o badge de versão e query strings com as tags git
  testar_*.{py,mjs}       suíte de testes de carga, Monte Carlo e função IA
docs/                     documentação técnica e operacional
```

## Fluxo de dados e Velocidade
```text
Navegador (operador logado)
  |-- 1. Boot imediato (~50 ms) -----------> Lê leads do IndexedDB (CockpitStore) e renderiza Kanban
  |-- 2. Sync em background ---------------> Se 1ª vez: fetchLeadsLean (sem interacoes_sdr)
  |                                          Se já sincronizado: fetchLeadsDelta (updated_at > lastSyncAt)
  |                                                            + fetchDeletionsSince (exclusoes_sync)
  |-- 3. Abrir cartão do lead -------------> CockpitStore.ensureTimeline(id) busca interacoes_sdr sob demanda
  |-- 4. Realtime (websocket) -------------> Aplica patch cirúrgico no lead afetado (memória + IndexedDB)
  `-- 5. POST /functions/v1/ia + JWT ------> Edge Function `ia`
                                              |-- valida o usuário em /auth/v1/user
                                              |-- lê base_conhecimento com o token do operador (RLS)
                                              |-- (análise) baixa o site do lead e verifica citações
                                              `-- chama o Gemini com rotação de 5 modelos
```
O navegador nunca recebe a chave do Gemini nem a chave secreta do Supabase.
