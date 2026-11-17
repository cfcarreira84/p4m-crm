# Aprendizados e Manobras Consolidados

Registro de problemas reais encontrados em operação, com causa e solução incorporadas ao **SDR Cockpit Starter v2.0.0**.

## Banco, Rede e Supabase
| Problema | Causa | Solução no Starter v2.0 |
|---|---|---|
| Lentidão ao abrir o Kanban em conexões lentas | Toda abertura buscava todas as linhas de `empresas_alvo` com join aninhado `interacoes_sdr(*)` | Cache em `IndexedDB` (`CockpitStore`) abre o Kanban em ~50 ms; sync traz só colunas de `empresas_alvo` (`fetchLeadsLean`) ou apenas o delta (`updated_at > lastSyncAt`), e `interacoes_sdr` carrega sob demanda ao abrir o cartão |
| Leads apagados por outro operador continuavam no cache local | Sync incremental por `updated_at` não enxerga linhas deletadas | Tabela `exclusoes_sync` alimentada por trigger `AFTER DELETE ON empresas_alvo` e consultada a cada sync delta |
| "Could not find column in schema cache" | `CREATE TABLE IF NOT EXISTS` não altera tabela existente; PostgREST mantém cache do schema | `schema.sql` consolidado + migrações numeradas idempotentes terminadas com `NOTIFY pgrst, 'reload schema'` |
| Bloqueio HTTP 401/403 ao usar `sb_secret_...` em scripts Python | Guarda anti-browser do Supabase barra o `User-Agent` padrão do `urllib` quando detecta `sb_secret_` | Todos os scripts administrativos enviam `"User-Agent": "SDRCockpit-AdminCLI/2.0"` |
| Só os primeiros 1.000 leads apareciam | O PostgREST limita cada resposta a 1.000 linhas | Paginação automática com `Range` e ordenação determinística (`created_at.desc,id.asc`) |

## Dados e Interface
| Problema | Causa | Solução no Starter v2.0 |
|---|---|---|
| Travamento da interface ao recalcular Monte Carlo em bases grandes | 10.000 iterações síncronas na thread principal | Cálculo movido para Web Worker (`web/assets/js/mc_worker.js`) via `simulatePipelineAsync` |
| Evento Realtime recarregava toda a base e limpava o cartão aberto | Qualquer `UPDATE` disparava `fetchLeads()` completo | Patch cirúrgico in-place (`CockpitStore.applyRealtimePayload`) preservando a referência do objeto em memória |
| Planilhas de novos segmentos com colunas diferentes ou separadas por `;` | Contrato de carga rígido de 32 colunas fixas | Contrato flexível (`database/contrato.json`) com autodetecção de `,`/`;`, aliases de colunas e gravação automática de colunas extras em `dados_segmento` (`JSONB`) |
| Vários leads empatados em 95% de probabilidade | O teto de 95% escondia diferenças na ordenação | A ordenação usa `rawScore` (sem o teto de 95%), desempatando por `pontuacao_carga` e `ticket_estimado` |

## IA (Gemini via Edge Function)
| Problema | Causa | Solução no Starter v2.0 |
|---|---|---|
| IA citava dados inexistentes no site do lead | `url_context` do modelo falhava em silêncio e completava de memória | A Edge Function baixa o site no servidor (`coletarSite`), entrega o texto visível como única fonte e valida cada citação entre aspas (`verificarCitacoes`); citações inventadas são descartadas |
| Erro 429 de cota diária no plano gratuito | Limite de 20 chamadas/dia por modelo no Free Tier | IA acionada exclusivamente sob demanda (botão Regenerar / Analisar) + rotação automática em cascata por 5 modelos (`gemini-3.5-flash` -> `gemini-3.6-flash` -> `gemini-3-flash-preview` -> `gemini-3.5-flash-lite` -> `gemini-2.5-flash`) |
| Erro 503 em modelos preview | Oscilação transitória do endpoint | 1 retry automático com backoff no mesmo modelo antes de avançar para o próximo da fila |
| Risco de SSRF ao baixar site do lead | URL fornecida pelo usuário poderia apontar para rede interna | Guarda `urlPublica()` bloqueia `localhost`, IPs privados e domínios internos |
