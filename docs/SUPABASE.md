# Como Usamos o Supabase

## Chaves e Segurança
| Chave | Onde fica | Para quê |
|---|---|---|
| `sb_publishable_...` (anon) | `cockpit_config.js` e `database/.env` | Identifica o projeto no cliente. Sozinha **não lê nada**: o RLS exige usuário autenticado (`TO authenticated`) |
| `sb_secret_...` (service) | Somente em `database/.env` (ignorado pelo git) | Scripts administrativos Python (`provision_operators.py`, `seed_conhecimento.py`, `carga_base.py`, `backup_banco.py`). Nunca vai ao navegador |
| JWT do operador | Sessão do Supabase Auth no navegador | Enviado como `Authorization: Bearer` em toda chamada REST e à Edge Function `ia` |
| `GEMINI_KEY` | Secret da Edge Function `ia` e `database/.env` | Usada exclusivamente no servidor |

> **Importante (Python Admin CLI):** ao usar chaves `sb_secret_...` via Python (`urllib.request`), envie sempre `"User-Agent": "SDRCockpit-AdminCLI/2.0"` para não acionar o bloqueio anti-browser da Cloudflare/Supabase.

## Tabelas e RLS
- **`empresas_alvo`**: armazena os leads, matriz de discovery, `pre_analise_scout` (`JSONB`) e `dados_segmento` (`JSONB`). RLS: `FOR ALL TO authenticated`.
- **`interacoes_sdr`**: linha do tempo (mensagens e notas), carregada sob demanda ao abrir o cartão. RLS: `FOR ALL TO authenticated`.
- **`exclusoes_sync`**: registra IDs deletados de `empresas_alvo` via trigger `trg_empresas_delete_sync` para sincronização delta do cache `IndexedDB`. RLS: `FOR SELECT TO authenticated`.
- **`base_conhecimento`**: blocos modulares de conhecimento da marca (`nucleo-persona`, `nucleo-regras`, produtos, playbooks). RLS: `FOR SELECT TO authenticated` (escrita apenas via `seed_conhecimento.py` com service key).
- **`configuracoes`**: pares chave/valor públicos para usuários autenticados.

## Migrações
- Para **bases novas**, execute `database/schema.sql` no SQL Editor (já consolida todas as migrações até a `005`).
- Para **bases existentes**, execute em ordem os arquivos de `database/migrations/` (`001` a `005`). Todos são idempotentes e encerram com `NOTIFY pgrst, 'reload schema'`.
