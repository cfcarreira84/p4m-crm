# Documentação Técnica — Extensão Chrome (MV3) & Integração `sdr-cockpit`

Este documento detalha a arquitetura, os contratos de dados, as regras de negócio e o guia de adaptação da extensão Chrome **Manifest V3** (`_SDR/extension`) para qualquer instância de CRM baseada na estrutura do **`sdr-cockpit` / P/CRM**.

---

## 1. Visão Geral da Arquitetura

A extensão opera sem bundlers ou etapas de build (ES2020 puro), dividida em 4 camadas desacopladas:

```text
+-------------------------------------------------------------------+
|  Popup UI (popup.html / popup.js / styles.css)                    |
|  - Login / adoção automática de sessão                            |
|  - Filtros (Frente, Prioridade, Perfil) + Limite diário           |
|  - Trava obrigatória pré-disparo + Termo de ciência               |
|  - Controles (Iniciar / Pausar / Retomar / Interromper)           |
+-----------------------------+-------------------------------------+
                              | chrome.runtime.sendMessage
                              v
+-------------------------------------------------------------------+
|  Service Worker (background.js + supabase_api.js + config.js)     |
|  - Estado persistido em chrome.storage.local (pcrm_batch_state)   |
|  - Refresh automático de JWT antes de expirar                     |
|  - Consulta PostgREST + chamada à Edge Function `ia`              |
|  - Intervalo randômico 30–90s + auditoria pós-lote + notificação  |
+--------------+----------------------------------+-----------------+
               |                                  |
               v                                  v
+------------------------------+   +--------------------------------+
|  WhatsApp Web (content.js)   |   |  Gmail Web (gmail_content.js)  |
|  - Busca lateral + SPA link  |   |  - Compose via URL (?view=cm)  |
|  - Quebra por parágrafo      |   |  - Auto-envio & confirmação    |
|  - Digitação humana (ms)     |   |  - Registro email_outbound     |
|  - Captura texto + mídias    |   +--------------------------------+
+------------------------------+
```

---

## 2. Autenticação e Reaproveitamento de Sessão

1. **Adoção automática da sessão do CRM Web (`tryAdoptSessionFromCrmTab`):**
   - Ao abrir o popup (`GET_INIT`), o `background.js` procura abas abertas correspondentes à URL configurada do CRM (`https://cfcarreira.com.br/sdr-cockpit*`).
   - Via `chrome.scripting.executeScript`, lê a chave `sb-*-auth-token` do `localStorage` da aba do CRM.
   - Se houver `access_token` válido, a sessão é importada para `chrome.storage.local` (`pcrm_auth_session`), evitando novo login.
2. **Login direto e abertura do ambiente:**
   - Caso não haja sessão ativa, o usuário informa e-mail e senha na tela de conexão (`POST /auth/v1/token?grant_type=password` usando apenas `url` e `anonKey` públicas).
   - Após autenticação bem-sucedida, `ensureCrmTabOpen()` abre uma aba do CRM automaticamente caso ainda não exista uma aberta.
3. **Refresh automático de JWT (`refreshSessionIfNeeded`):**
   - Antes de qualquer chamada REST ou à Edge Function `ia`, verifica se faltam menos de 120s para expiração (`expires_at`) e renova via `grant_type=refresh_token`.

---

## 3. Contrato de Banco de Dados & Regras de Fila

### 3.1 Multi-Frente (`config.js`)
Cada frente mapeia suas tabelas isoladas:
- `comercios`: `empresas_alvo` / `interacoes_sdr`
- `cursos`: `cursos_leads` / `cursos_interacoes`

### 3.2 Seleção da Fila Inicial (`fetchInitialQueue`)
A consulta PostgREST aplica os seguintes critérios obrigatórios:
- `status_kanban=eq.fila_disparo` (fase inicial configurada em `EXT_CONFIG.stages.initial`)
- `is_arquivado=eq.false`
- `whatsapp_disparo=not.is.null`
- Filtros opcionais: `prioridade_carga=eq.<prioridade>` e `cluster_estrategico=eq.<perfil>`
- Ordenação: `pontuacao_carga.desc.nullslast,created_at.asc`, seguida de ordenação em memória por peso de `prioridade_carga` (`alta` > `media_alta` > `media` > `baixa` > `a_qualificar`).
- **Higiene de fila:** descarta registros com `whatsapp_confirmado === false`, telefones fora do padrão E.164 BR (`12–13` dígitos após normalização `55...`) e leads que já possuam qualquer interação `direcao=eq.outbound` (`tipo_mensagem != nota_operador`).

### 3.3 Movimentação Obrigatória & Realtime
Todas as mutações via `PATCH` atualizam explicitamente `updated_at = new Date().toISOString()`, disparando os eventos **Supabase Realtime** (`UPDATE`) para atualização in-place do Kanban no front-end:
- **Envio WhatsApp confirmado:** `status_kanban = "em_andamento_vacuo"`, `whatsapp_confirmado = true`, `responsavel_operador = <operador>`.
- **Número sem WhatsApp (`no_whatsapp`):**
  - Marca `whatsapp_confirmado = false` e grava interação `nota_operador` (`[sem_whatsapp] ...`).
  - Se possuir `email_contato` ou `email_parcerias`: mantém em `fila_disparo` e adiciona à `gmailQueue`.
  - Se não possuir e-mail: move para `status_kanban = "atencao"` e adiciona à `attentionList`.
- **Falha de abertura no DOM (`open_failed`):** grava `nota_operador` (`[erro_whatsapp] ...`) e move para `atencao`.

---

## 4. Contrato com a Edge Function `ia` (`supabase/functions/ia/index.ts`)

A extensão consome `POST /functions/v1/ia` com `Authorization: Bearer <JWT>` e `acao: "mensagem"`:

### 4.1 Variação Genuína Anti-Template (WhatsApp)
- Payload `ctx`:
  ```json
  {
    "frente": "cursos",
    "variacaoAntiTemplate": true,
    "estiloIndice": 2,
    "canal": "whatsapp"
  }
  ```
- O servidor alterna entre 4 estilos estruturais (`Estilo A` a `Estilo D` via `estiloIndice % 4`) e instrui quebra em 2–3 parágrafos curtos separados por `\n\n`.
- O operador pode alternar no Popup entre **Redação dinâmica** (Edge Function `ia`) e **Usar prévia salva** (`proxima_mensagem_customizada` ou `pre_analise_scout.gancho_kickoff_gerado`).

### 4.2 Geração de E-mail para Fallback (`canal: "email"`)
- Payload `ctx` inclui `"canal": "email"`.
- Retorno esperado: `{ "ok": true, "data": { "assunto": "...", "mensagem": "..." } }`.
- Caso a Edge Function ainda não esteja atualizada no servidor, a extensão aplica um fallback local seguro com assunto e corpo consultivos.

---

## 5. Automação Humanizada no WhatsApp Web (`content.js`)

1. **Abertura limpa da conversa:**
   - Tenta localizar o contato pela barra lateral de busca (`#side div[contenteditable="true"][data-tab="3"]`) pelos últimos 8 dígitos.
   - Se não houver conversa recente, cria e clica em um link interno `https://web.whatsapp.com/send?phone=55...` dentro do DOM (interceptado pelo roteador SPA do WhatsApp Web sem recarregar a página).
   - Monitora modais de número inválido (`div[role="dialog"]`), fecha o alerta e retorna `{ ok: false, reason: "no_whatsapp" }`.
2. **Envio fracionado por parágrafo + digitação humana:**
   - Divide o texto por `\n\n` ou `\n`.
   - Para cada parágrafo: foca o compositor (`#main footer div[contenteditable="true"][data-tab="10"]`), insere caractere por caractere com `document.execCommand("insertText")` + `InputEvent`, com jitter de `22–68 ms` (e micropausas em pontuação e a cada 25 caracteres).
   - Envia cada parágrafo como um balão separado, aguardando `1.2–2.4 s` entre balões.
3. **Cadência entre leads & Governança:**
   - Aguarda intervalo aleatório entre **30 e 90 segundos** entre um lead e outro.
   - Respeita o **Limite diário** configurado (ou recomendação automática `min(fila, 25)/dia`), persistindo a contagem do dia em `chrome.storage.local` (`pcrm_daily_sent`).
   - Exige confirmação explícita no **Modal de Ciência e Responsabilidade** antes de iniciar.

---

## 6. Sync Bidirecional & Normalização de Mídias

O `MutationObserver` em `content.js` (e o botão manual **Sincronizar Chat Ativo**) lê as linhas de `#main div[data-id]`:
- Extrai direção e telefone direto do atributo `data-id` (`true_55...@c.us` = outbound, `false_55...@c.us` = inbound) e data/hora de `[data-pre-plain-text]`.
- Identifica mídias no DOM:
  - Áudio / PTT: `[Mídia enviada: Áudio (0:42)]` / `[Mídia recebida: Áudio (0:42)]`
  - Vídeo: `[Vídeo anexado]`
  - Imagem: `[Imagem anexada]`
  - Documento: `[Documento: nome_arquivo.pdf]`
  - Figurinha: `[Figurinha anexada]`
- Formata estritamente no padrão exigido por `parseWhatsAppChat()` (`web/assets/js/app.js`):
  ```text
  [DD/MM/AAAA, HH:MM] +5519999999999: Conteúdo ou descrição da mídia
  ```
- Deduplica contra as últimas 50 interações do lead antes de inserir em `interacoes_sdr` / `cursos_interacoes`.

---

## 7. Como Integrar em Outro Projeto Baseado no `sdr-cockpit`

Para reutilizar esta extensão em outro CRM derivado do `sdr-cockpit` / `cockpit-starter`:

1. **Atualizar `extension/config.js`:**
   - Substitua `supabase.url`, `supabase.anonKey` e `crmUrl` pelos dados públicos do novo projeto (espelho de `cockpit_config.js` / `pcrm_config.js`).
   - Ajuste `stages.initial`, `stages.nextAfterDispatch`, `stages.attention` e o mapa `frentes` / `clusters` conforme `project.config.json`.
2. **Atualizar `extension/manifest.json`:**
   - Atualize `host_permissions` com o domínio público do novo CRM (para adoção automática de sessão) e a URL do novo projeto Supabase.
3. **Garantir colunas mínimas no Postgres:**
   - `status_kanban`, `is_arquivado`, `whatsapp_disparo`, `whatsapp_confirmado`, `email_contato`, `responsavel_operador`, `updated_at`, `prioridade_carga`, `pontuacao_carga`, `cluster_estrategico`.
4. **Validar higiene e versão:**
   - Rode `python tools/sync_version.py` para alinhar `manifest.json` e `config.js` à tag Git atual.
   - Rode `python tools/verificar_higiene.py` para garantir zero vazamento de chaves secretas (`sb_secret_`, `AIza`, `AQ.`).
