# Changelog

Formato [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/) e [SemVer](https://semver.org/lang/pt-BR/).
Commits seguem [Conventional Commits](https://www.conventionalcommits.org/pt-br/) (`feat:`, `fix:`, `docs:`, `chore:`).

## [2.1.0] - 2026-11-16

### Adicionado & Colhido (`cockpit-harvest`)
- **Clique rápido na Prévia do Texto (`#textarea-next-msg`):** clicar em qualquer ponto da textarea seleciona todo o texto e copia automaticamente para a área de transferência (`navigator.clipboard`), mantendo a edição manual ou seleção por arraste disponíveis.
- **Leitura integral de 100% dos campos do cartão pela IA (`snapshotLeadDoModal` + `linhasDoLead` + `montarPromptAnalise`):** garante `CockpitStore.ensureTimeline` e sincronização de campos editados no modal antes de qualquer chamada (`Gerar análise`, `Complementar com IA`, `Regenerar` e `Smart Console`), incluindo coluna `notas_operador`, `razao_social`, `bairro`, `endereco_completo`, `email_contato`, `instagram_url`, `responsavel_operador`, `prioridade_carga`, `observacao_dados`, `data_reativacao_programada` e `proxima_mensagem_customizada`.
- **Cascata de Modelos Gemini atualizada (`MODELOS_PADRAO`):** prioriza `gemini-3-flash-preview` em 1º lugar e injeta `[CALIBRAGEM DE QUALIDADE]` na rotação automática para `gemini-2.5-pro`, `gemini-2.5-flash`, `gemini-3.1-flash-lite-preview` e `gemini-2.5-flash-lite`.

## [2.0.0] - 2026-11-09

### Adicionado (Organismo Vivo e Parametrização Multi-Segmento)
- **Manifesto `project.config.json` e gerador `tools/setup_projeto.py`**: gera automaticamente `web/assets/js/cockpit_config.js`, `database/conhecimento/blocos.json` (esqueleto inicial), `database/contrato.json` e atualiza o título em `web/index.html`.
- **Rastreabilidade de Origem (`STARTER_VERSION` e `STARTER_ORIGIN.json`)**: registra a versão e o hash SHA-256 de todos os arquivos de núcleo do starter para permitir a colheita seletiva de melhorias de projetos-filhos de volta ao starter via skill `/cockpit-harvest`.
- **Linter de Higiene (`tools/verificar_higiene.py`)**: varredura automatizada garantindo zero contaminação de marcas anteriores, chaves reais (`sb_secret_`, `AIzaSy`, `AQ.`), referências de projetos Supabase ou caminhos locais.
- **Orquestrador `tools/provisionar.py` e Deploy `tools/deploy_ftp.py`**: automação de provisionamento de operadores, seed da base de conhecimento e publicação FTP com conferência HTTP 200.

### Adicionado (Pacote de Velocidade e Conexões Lentas)
- **Cache Local em IndexedDB (`web/assets/js/data/store.js` — `CockpitStore`)**: abertura instantânea do Kanban (~50 ms) com os leads em cache local enquanto sincroniza em segundo plano com indicador discreto (`Sincronizando...`).
- **Sincronização Delta (`updated_at > lastSyncAt`) e `exclusoes_sync`**: após a primeira carga, busca apenas registros alterados ou excluídos desde o último sync (`fetchLeadsDelta` e `fetchDeletionsSince`), reduzindo drasticamente o tráfego em conexões móveis/lentas.
- **Projeção Enxuta e Lazy-Loading da Timeline**: o carregamento do Kanban traz apenas as colunas de `empresas_alvo` (sem o join pesado `interacoes_sdr(*)`), carregando o histórico de mensagens sob demanda ao abrir o cartão (`CockpitStore.ensureTimeline`) com cache local por lead.
- **Realtime Cirúrgico In-Place**: eventos WebSocket (`INSERT`, `UPDATE`, `DELETE`) atualizam apenas o cartão afetado em memória e no IndexedDB (`applyRealtimePayload`), eliminando recargas completas da base.
- **Web Worker para Monte Carlo (`web/assets/js/mc_worker.js`)**: simulação de 10.000 iterações executada fora da thread principal (`simulatePipelineAsync`), mantendo a interface fluida a 60 fps mesmo com milhares de leads.

### Adicionado (Contrato de Carga Flexível e Edge Function Multi-Modelo)
- **Coluna `dados_segmento JSONB` (`database/migrations/005_starter_v2_sync_segmento.sql`) e `database/contrato.json`**: permite carregar planilhas de qualquer segmento (com `,` ou `;`, aliases de colunas configuráveis, múltiplos e-mails no mesmo campo e filtro `--excluir-fora-perfil`), guardando atributos específicos do nicho em `dados_segmento` e exibindo-os dinamicamente no modal do lead (`segmentFields`) e no prompt da IA.
- **Edge Function `ia` 100% agnóstica de marca**: extrai persona e regras comerciais diretamente dos blocos `nucleo-persona` e `nucleo-regras` da tabela `base_conhecimento`, suporta 5 modelos Gemini em cascata (`gemini-3.5-flash`, `gemini-3.6-flash`, `gemini-3-flash-preview`, `gemini-3.5-flash-lite`, `gemini-2.5-flash`) com retry em 503 e fallback automático em 429, verificação anti-alucinação de citações do site e guarda SSRF.
- **Pipeline de Dados Integrado**: `tools/carga_base.py`, `tools/backup_banco.py` (com guarda de backup obrigatório antes de escrita) e motor de higienização `tools/prospect_base/` com perfil `_modelo`.
- **Suíte de Testes Automatizados**: `tools/testar_carga.py` (15 verificações), `tools/testar_monte_carlo.mjs` (9 verificações) e `tools/testar_funcao_ia.mjs` (20 verificações).
