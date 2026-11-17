---
name: carga-leads
description: Valida, enriquece por regras locais e carrega no Supabase de qualquer projeto SDR Cockpit um CSV de leads conforme database/contrato.json (incluindo colunas dinâmicas em dados_segmento), com backup verificado obrigatório antes de qualquer escrita.
---

# Carga de Leads no Supabase (Com Guarda de Backup Obrigatória)

Fluxo único e estrito para qualquer projeto baseado no **SDR Cockpit Starter v2.0+**. **Nunca grave no banco sem backup íntegro verificado** e **nunca pule a confirmação explícita do operador** antes do passo 6.

 Ferramentas na pasta do projeto:
- `tools/carga_base.py` — validador, enriquecedor determinístico por regras (`database/contrato.json`), simulador, carregador e reversor (`desfazer`).
- `tools/backup_banco.py` — backup JSON completo (`empresas_alvo`, `interacoes_sdr`, `configuracoes`, `base_conhecimento`) com manifesto SHA-256.
- `database/contrato.json` e `database/CONTRATO_CARGA.md` — mapeamento de colunas, aliases e campos extras de `dados_segmento`.

## Pré-requisitos
1. `database/.env` preenchido com `SUPABASE_URL` e `SUPABASE_SERVICE_KEY` (ou `SUPABASE_SERVICE_ROLE_KEY`).
2. `database/schema.sql` e migrações até `005_starter_v2_sync_segmento.sql` aplicadas no Supabase (`dados_segmento JSONB` e `exclusoes_sync`).
3. CSV em UTF-8 (separador `,` ou `;` autodetectado). Se o CSV tiver colunas específicas do nicho do cliente, confira se estão listadas em `segment_columns` no `database/contrato.json` para irem automaticamente para `dados_segmento`.

## Fluxo Obrigatório em 8 Passos

### 1. Validar o CSV (Sem Rede / Sem Escrita)
```powershell
python tools/carga_base.py validar "<CAMINHO_DO_CSV>" --resolver-duplicados --excluir-fora-perfil --saida preview_carga.json
```
- Se retornar `exit 1`, há erro bloqueante (E.164 inválido, gancho em bloco único ou robotizado, termo proibido do `contrato.json`, duplicidade não resolvida). Reporte ao operador e acione `/higienizar-base-prospeccao` se necessário.
- Se houver linhas sem nenhum canal de contato, pergunte ao operador se deseja usar `--excluir-sem-canal`.
- Se toda a carga pertencer a um único perfil/categoria do Kanban, inclua `--perfil <ID_DO_PERFIL>` em todos os comandos.
- Defina sempre `--origem <nome_do_lote_data>` (ex.: `--origem pet_sp_2026-11-09`) para permitir auditoria e reversão.

### 2. Gerar Lista Completa para Revisão (Recomendado)
```powershell
python tools/carga_base.py lista "<CAMINHO_DO_CSV>" --resolver-duplicados --excluir-fora-perfil [--excluir-sem-canal] [--perfil <PERFIL>] --saida-csv "<PASTA_FORA_DO_GIT>/lista_revisao.csv"
```
Mostra todos os leads na ordem em que aparecerão no Kanban, já com o enriquecimento determinístico por regras (sem consumir cota da API Gemini).

### 3. Simular Contra o Banco (Somente Leitura)
```powershell
python tools/carga_base.py carregar "<CAMINHO_DO_CSV>" --origem <ORIGEM> --resolver-duplicados --excluir-fora-perfil [--excluir-sem-canal] [--perfil <PERFIL>]
```
Apresente ao operador: total no banco hoje, quantos serão inseridos, quantos serão pulados (já existentes por WhatsApp ou nome — nunca sobrescreve) e quantos entrarão sem WhatsApp.

### 4. Pedir Confirmação Explícita
Resuma os números da simulação e pergunte se pode executar o backup e gravar no banco. **Pare e aguarde o "sim" do operador.**

### 5. Criar e Verificar Backup do Banco (Obrigatório)
```powershell
python tools/backup_banco.py criar --motivo "antes da carga <ORIGEM>"
python tools/backup_banco.py verificar
```
O guard em `carga_base.py` recusa gravar (`exit 3`) se não houver backup íntegro com menos de 24 h e contagens idênticas às do banco atual.

### 6. Gravar no Supabase
```powershell
python tools/carga_base.py carregar "<CAMINHO_DO_CSV>" --origem <ORIGEM> --resolver-duplicados --excluir-fora-perfil [--excluir-sem-canal] [--perfil <PERFIL>] --confirmar
```

### 7. Verificar Pós-Carga (Idempotência)
Reexecute o comando de simulação do passo 3 (sem `--confirmar`): deve exibir **`A inserir (novos): 0`**.

### 8. Desfazer ou Restaurar (Quando Solicitado)
- **Desfazer lote recém-carregado** (remove apenas leads da `<ORIGEM>` que continuam em `aguardando_contato`):
  ```powershell
  python tools/backup_banco.py criar --motivo "antes de desfazer <ORIGEM>"
  python tools/carga_base.py desfazer <ORIGEM>
  python tools/carga_base.py desfazer <ORIGEM> --confirmar
  ```
- **Restaurar tabela a partir de backup**:
  ```powershell
  python tools/backup_banco.py listar
  python tools/backup_banco.py restaurar <PASTA_BACKUP> --tabela empresas_alvo
  python tools/backup_banco.py restaurar <PASTA_BACKUP> --tabela empresas_alvo --confirmar
  ```
