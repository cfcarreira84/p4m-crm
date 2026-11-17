# P/CRM — Extensão Chrome (Manifest V3)

Extensão oficial do **P/CRM (`sdr-cockpit`)** para disparo humanizado de abordagem inicial via WhatsApp Web, fallback automático via Gmail Web e sincronização bidirecional de timeline/mídias com o Supabase.

## Instalação Rápida (Modo Desenvolvedor)

1. Abra o Google Chrome e acesse **`chrome://extensions`**.
2. Ative a chave **Modo do desenvolvedor** (*Developer mode*) no canto superior direito.
3. Clique em **Carregar sem compactação** (*Load unpacked*).
4. Selecione a pasta:
   `d:\OneDrive\Documentos\202609_Projetos\_SDR\extension`
5. Fixe o ícone **P/CRM — SDR Cockpit** na barra do navegador.

## Como Usar

1. Deixe uma aba do **WhatsApp Web** (`https://web.whatsapp.com`) aberta e autenticada (e uma aba do **Gmail** autenticada caso haja leads no fallback).
2. Clique no ícone da extensão e faça login com seu e-mail e senha do P/CRM (Supabase Auth).
3. Escolha a **Frente** (`Cursos & Treinamentos` ou `Comércios Locais`), **Prioridade**, **Lote** e o modo de texto:
   - **Gerar/Variar via IA**: consulta a Edge Function `ia` com rotação anti-template.
   - **Usar prévia salva**: envia o texto já salvo em `proxima_mensagem_customizada` / `gancho_kickoff_gerado`.
4. Clique em **Iniciar Lote**. Cada parágrafo é digitado e enviado separadamente, com intervalo aleatório de **30 a 90 segundos** entre leads.
5. Ao confirmar o envio, o cartão avança automaticamente para **Em Andamento (Vácuo)** em tempo real.
6. Números sem WhatsApp com e-mail válido entram na **Fila Fallback Gmail**; casos sem canal ou com falha de abertura vão para **Atenção** com nota registrada.
7. Ao final do lote, confira a **Auditoria Pós-Lote** e clique em **Disparar Fila Fallback Gmail** se houver pendentes.

> **Importante:** Para ativar a variação anti-template e geração de assunto/corpo de e-mail diretamente no servidor, republique o arquivo atualizado `supabase/functions/ia/index.ts` no painel do Supabase.
