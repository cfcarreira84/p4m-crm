# Operação: Como Rodar, Provisionar, Publicar e Evoluir

## Rodar localmente
Na pasta do projeto, em qualquer terminal:
```bash
python -m http.server 8080 --directory web
```
Abra `http://localhost:8080` e entre com o e-mail e a senha do operador.

## Primeira configuração de um ambiente novo
1. Copie `database/.env.example` para `database/.env` e preencha `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_KEY`, `GEMINI_API_KEY`, `OPERATOR_PASSWORD` e `OPERATORS`.
2. Ajuste `project.config.json` (ou use `/cockpit-novo-projeto`) e gere a configuração:
   ```bash
   python tools/setup_projeto.py
   ```
3. No SQL Editor do Supabase, execute `database/schema.sql` (base nova) ou as migrações pendentes em `database/migrations/` (em ordem).
4. Provisione operadores e base de conhecimento:
   ```bash
   python tools/provisionar.py
   ```
5. Em Edge Functions no painel do Supabase: crie o segredo `GEMINI_KEY` e publique `supabase/functions/ia/index.ts` (nome `ia`, com *Verify JWT* desmarcado).

## Testes
```bash
python tools/testar_carga.py              # mapeamento, contrato e enriquecimento local (15 verificações)
node tools/testar_monte_carlo.mjs         # probabilidades B2B/B2C, ordenação e forecast (9 verificações)
node tools/testar_funcao_ia.mjs           # lógica da Edge Function, SSRF, citações e rotação (20 verificações)
node tools/testar_funcao_ia.mjs --real    # inclui chamada real à API Gemini
python tools/verificar_higiene.py         # linter zero contaminação de marca e chaves
```

## Carga de Leads e Backup
Siga `database/CONTRATO_CARGA.md` ou acione `/carga-leads`:
1. Validar: `python tools/carga_base.py validar ARQUIVO.csv --resolver-duplicados --excluir-fora-perfil --saida preview.json`
2. Gerar lista de revisão: `python tools/carga_base.py lista ARQUIVO.csv --resolver-duplicados --excluir-fora-perfil`
3. Simular: `python tools/carga_base.py carregar ARQUIVO.csv --origem LOTE --resolver-duplicados --excluir-fora-perfil`
4. Criar backup: `python tools/backup_banco.py criar`
5. Gravar: `python tools/carga_base.py carregar ARQUIVO.csv --origem LOTE --resolver-duplicados --excluir-fora-perfil --confirmar`

## Publicar em Produção (Hospedagem Estática / FTP)
1. Rode `python tools/sync_version.py` após criar a tag da versão.
2. Envie o conteúdo de `web/` (incluindo `.htaccess`) via `python tools/deploy_ftp.py` ou painel de hospedagem.
3. Confira o cabeçalho `X-Robots-Tag: noindex, nofollow, noarchive` e o selo de versão no rodapé.

## Evolução do Organismo Vivo (`/cockpit-harvest`)
Ao concluir melhorias genéricas em um projeto de cliente, acione a skill `/cockpit-harvest`. Ela compara o projeto com `STARTER_ORIGIN.json`, filtra apenas o que é genérico/parametrizável, roda `tools/verificar_higiene.py` e promove a nova versão ao `sdr-cockpit-starter`.
