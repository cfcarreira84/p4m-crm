---
name: higienizar-base-prospeccao
description: Higieniza, deduplica, prioriza e gera ganchos individuais de abordagem em 2 parágrafos para listas de prospecção B2B/B2C (.xlsx/.csv) para carga no SDR Cockpit / Supabase usando o motor tools/prospect_base e o contrato flexível database/contrato.json.
---

# Higienização de Bases de Prospecção (Multi-Segmento — Antigravity)

Use quando o operador trouxer uma planilha bruta ou mestre (`.xlsx` ou `.csv`) para organizar, deduplicar, pontuar e gerar ganchos de abordagem comercial no formato aceito por `tools/carga_base.py` e `database/contrato.json`.

## Regra-Mãe: Nunca Deduzir
Se qualquer coluna, regra de pontuação, fusão de rede/duplicidade ou argumento comercial da marca for ambíguo, **pare e pergunte com `ask_question`** antes de prosseguir. Nunca preencha lacuna por suposição: deixe vazio e sinalize em `Observação de dados`. Nunca altere o arquivo original: trabalhe sempre gerando um novo arquivo de saída.

## Ferramenta Padrão: `tools/prospect_base`
Todo projeto derivado do **SDR Cockpit Starter v2.0+** possui o pacote `tools/prospect_base/`:
- `tools/prospect_base/engine/pipeline.py` — motor determinístico de limpeza de nomes, validação de DDD/E.164, deduplicação, pontuação 0–100 e montagem de Excel/CSV.
- `tools/prospect_base/profiles/_modelo/` — perfil base limpo para ser copiado para `tools/prospect_base/profiles/<segmento_marca>/`.

Execução:
```powershell
python tools/prospect_base/run.py <perfil> <entrada.xlsx> <prefixo_saida>
```

## Fase 0: Briefing do Segmento (Obrigatória para Perfil Novo)
Antes de criar um novo perfil em `tools/prospect_base/profiles/<nome>/`, confirme com o operador via `ask_question` (ou leia de `project.config.json` e `database/conhecimento/blocos.json`):
1. **Marca, produto/serviço e argumentos comerciais aprovados** (prazos, garantias, diferenciais, programas).
2. **Mapa de abas/colunas da planilha de entrada** e colunas específicas do segmento que devem ir para `dados_segmento` em `database/contrato.json`.
3. **Geografia**: cidades prioritárias, DDDs esperados e agrupamento em regiões comerciais.
4. **Critérios de Pontuação (0–100)**: sinais positivos, sinais negativos, pesos de maturidade e canais de contato.
5. **Estrutura do Gancho (sempre a última coluna)**:
   - **Obrigatoriamente em 2 parágrafos separados por linha em branco (`\n\n`)**.
   - **1º parágrafo**: saudação + descoberta honesta (`"Pesquisei empresas de [segmento] em [Cidade] e encontrei a [Empresa]. O que me chamou atenção foi [fato verificado da base]..."`) — **proibido** repetir ao lead o posicionamento dele como definição ou usar `"admiro"`, `"acompanho"`, `"vi seu trabalho"`, colchetes `[...]` ou placeholders.
   - **2º parágrafo**: apresentação concisa da marca + 1 argumento aprovado conectado ao perfil do lead + pergunta final simples de próximo passo (CTA).
   - **Valide uma amostra de ~5 a 10 ganchos com o operador antes de gerar o arquivo final.**

## Etapas Obrigatórias do Pipeline
1. **Inventário**: abrir todas as abas, contar linhas e mapear colunas.
2. **Base Única (`Etapa`)**: `Qualificado`, `A revisar`, `Dados incompletos` ou `Fora do perfil` (linhas `Fora do perfil` são reportadas e filtradas na carga com `--excluir-fora-perfil`).
3. **Normalização de Nome**: apenas o nome de mercado (sem razão social suja, sem sufixo de cidade/cargo).
4. **Deduplicação Auditada**: por nome normalizado, telefone, WhatsApp e domínio (`FORCE_MERGE` e `KEEP_NAME` quando aprovado para redes). Tudo registrado na aba `Log de higienização`.
5. **Telefones e E.164**: validar DDD brasileiro; separar `WhatsApp (confirmado)` + `WhatsApp (E.164)`, `Celular (provável WhatsApp)` + `Celular (E.164)`, `Telefone fixo` + `Fixo (E.164)` e `Outros telefones`.
6. **Vazios Limpos**: remover `"Não publicado"`, `"nan"`, `"None"` ou placeholders.
7. **Escore (0–100) e Faixas**: `Alta` (≥60), `Média-alta` (≥46), `Média` (≥30), `Baixa` (<30) ou `A qualificar` (dados incompletos), sempre com `Motivo da prioridade` factual.
8. **Validação Cruzada com `carga_base.py`**:
   Antes de entregar, rode sempre o validador do CRM sobre o CSV gerado:
   ```powershell
   python tools/carga_base.py validar <ARQUIVO_SAIDA.csv> --resolver-duplicados --excluir-fora-perfil
   ```
   Corrija qualquer erro apontado pelo validador até obter **0 erros bloqueantes**.
