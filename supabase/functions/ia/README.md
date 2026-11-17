# Edge Function `ia`

Motor de IA server-side do SDR Cockpit Starter.

## Por que existe
- A chave do Google AI Studio (`GEMINI_KEY` / `Gemini_Key`) fica exclusivamente nos segredos da Edge Function e nunca chega ao navegador.
- Toda a identidade da marca (`nucleo-persona`, `nucleo-regras`), produtos, programas e playbooks vêm da tabela `base_conhecimento`. Trocar de marca ou atualizar produtos não exige editar `index.ts`.
- Alterna automaticamente entre múltiplos modelos gratuitos do Gemini (`gemini-3.5-flash`, `gemini-3.6-flash`, `gemini-3-flash-preview`, `gemini-3.5-flash-lite`, `gemini-2.5-flash`) quando a cota diária de um modelo se esgota (HTTP 429) ou oscila (HTTP 5xx).
- Na ação `analise`, baixa o site do lead no servidor (com proteção SSRF) e verifica cada citação entre aspas contra o corpus real antes de gravar o dossiê.

## Como publicar
- **Automatizado (recomendado):** `python tools/provisionar.py --funcao` (usa `npx supabase` com `SUPABASE_ACCESS_TOKEN` do `database/.env`).
- **Pelo painel do Supabase:** Edge Functions > Deploy a new function > Via Editor > nome `ia`, colar `supabase/functions/ia/index.ts` e desligar *Verify JWT* (a própria função valida o JWT em `/auth/v1/user`).

## Segredos da função
- `GEMINI_KEY` (ou `Gemini_Key`): chave da API do Google AI Studio.
- `GEMINI_MODELOS` (opcional): lista de modelos separados por vírgula.
