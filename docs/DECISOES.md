# Decisões de Produto e de Engenharia

Formato: decisão, motivo, quando revisar.

## Produto
1. **9 fases padrão do funil**: Aguardando Contato, Ativado, Atendimento, Interessado, Proposta, Oferta, Retomar em, Atenção, Declinou. Configuradas em `project.config.json` / `cockpit_config.js`; o banco aceita qualquer id de fase (`VARCHAR` sem `CHECK`).
2. **Perfis de cliente parametrizáveis**: definidos em `project.config.json` (B2B e B2C).
3. **Operadores com visão compartilhada**: responsável do cartão = último operador a mover a fase (editável no cabeçalho do cartão).
4. **Matriz de Discovery diferenciada B2B vs B2C**: B2B avalia Interlocutor, Potencial de Negócio, Inclinação de Parceria e Demanda Imediata; B2C substitui parceria por Encantamento com os Produtos (`discovery_encantamento_produtos`).
5. **Kanban ordenado pelo Monte Carlo (`rawScore`)**, maior probabilidade primeiro.
6. **Primeira mensagem sem IA** para leads de base enriquecida, combinando saudação por horário, gancho em 2 parágrafos da pesquisa e apresentação do operador.
7. **Lead sem WhatsApp** entra na carga com seus demais canais (e-mail, Instagram, site, telefone fixo) para descoberta manual.

## Engenharia
1. **Vanilla JS, sem build.** Revisar apenas se o front ultrapassar ~5 mil linhas por arquivo.
2. **Zero-Mentira na UI com Leitura Instantânea (`IndexedDB`)**: o cache local (`CockpitStore`) exibe os dados imediatamente e sincroniza apenas o delta (`updated_at > lastSyncAt`), mas toda escrita exige confirmação HTTP 2xx do Supabase antes de refletir sucesso na tela.
3. **Timeline sob demanda (Lazy-Loading)**: `interacoes_sdr` só é consultada quando o operador abre o cartão do lead, economizando banda na listagem do Kanban.
4. **Monte Carlo em Web Worker (`mc_worker.js`)**: evita bloqueio da thread de UI durante as 10.000 iterações por lead.
5. **IA 100% no servidor (Edge Function `ia`)**, com a chave exclusivamente no segredo `GEMINI_KEY` e persona/regras lidas de `base_conhecimento` (`nucleo-persona` e `nucleo-regras`).
6. **Contrato de Carga Flexível (`contrato.json` + `dados_segmento JSONB`)**: campos universais ficam em colunas fixas e atributos específicos do segmento do cliente vão para `dados_segmento`, renderizados dinamicamente no cartão e enviados à IA.
7. **Guarda obrigatória de backup**: `carga_base.py carregar --confirmar` e `desfazer --confirmar` exigem backup íntegro de até 24 h gerado por `tools/backup_banco.py`.
8. **Fora dos buscadores**: `<meta name="robots" content="noindex...">` e `web/.htaccess` com `X-Robots-Tag: noindex, nofollow, noarchive`.
