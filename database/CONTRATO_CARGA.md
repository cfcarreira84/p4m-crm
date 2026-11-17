# Contrato de Carga da Base de Leads

Toda carga de leads no Supabase passa por `python tools/carga_base.py validar ARQUIVO.csv`.
O validador não escreve no banco: confere o contrato declarativo (`database/contrato.json`), mostra o relatório e gera a prévia exata do que será carregado.

## Contrato Flexível (`database/contrato.json`)
O `sdr-cockpit-starter` suporta tanto planilhas canônicas de 32 colunas (separadas por `,`) quanto variações de outros segmentos (separadas por `;` ou `,`, 31+ colunas) sem alterar o schema SQL:
- **Delimitador automático**: detecta `,` ou `;` automaticamente (`"delimiter": "auto"`).
- **Campos nucleares (obrigatórios)**: `Nome`, `Prioridade`, `Pontuação`, `Etapa`, `Cidade`, `UF`, `Tipo` e a coluna de gancho (`Gancho` ou `Gancho <Marca>`).
- **Aliases de coluna**: configurados em `columns` no `database/contrato.json` (ex.: aceita tanto `WhatsApp (E.164)` quanto `WhatsApp E.164`; `E-mail novos projetos` ou `E-mails`; `Obras de referência` ou `Empreendimentos (previsão de lançamento/entrega)`).
- **Campos exclusivos do segmento (`dados_segmento`)**: colunas listadas em `segmentColumns` no `database/contrato.json` (ex.: `Empreendimentos`, `Avaliação Maps`, `Lote`, `Canal de aquisição`) são gravadas automaticamente na coluna `dados_segmento` (`JSONB`) de `empresas_alvo` e exibidas no modal do lead conforme `segmentFields` do `project.config.json`.

## Regras que BLOQUEIAM a carga
- `Prioridade` em: `Alta`, `Média-alta`, `Média`, `Baixa`, `A qualificar`.
- `Etapa` em: `Qualificado`, `A revisar`, `Dados incompletos`.
- `Pontuação` inteira de `0` a `100`. `UF` com duas letras maiúsculas quando preenchida.
- Telefones no padrão E.164 do Brasil (`+55` + DDD + número). `Site` e `Instagram` como URL `http(s)`.
- Coluna de Gancho preenchida, com até `maxLength` caracteres (padrão 600), sem colchetes `[...]`, sem padrões robóticos (`"pelo que vi"`, `"encontrei X: ..."`) e sem afirmações de relação prévia (`"acompanho"`, `"admiro"`, `"conheço seu trabalho"`).
- Se `requireTwoParagraphs: true` no `database/contrato.json`, exige linha em branco (`\n\n`) separando descoberta e apresentação; se `false` (padrão), aceita ganchos de 1 ou 2 parágrafos.
- Termos listados em `ai.forbiddenTerms` no `project.config.json` são bloqueados.
- Telefone repetido ou `nome + cidade` repetido (use `--resolver-duplicados` para manter a linha de maior pontuação).

## Regras que geram AVISO (a carga segue, o dado fica marcado)
- Sem WhatsApp: o lead é carregado com e-mail, site, Instagram e/ou telefone fixo para busca manual; o operador preenche o número depois.
- Sem nenhum canal de contato: localizar pelo nome e cidade (`--excluir-sem-canal` deixa esses leads de fora).
- Campo de e-mail com múltiplos e-mails ou texto de canal: o primeiro e-mail válido vai para `email_contato`, o segundo para `email_parcerias` e os demais/observações vão para `observacao_dados`.
- Gancho citando valor em reais não listado em `approvedCurrencyValues`.
- Responsável que não é um nome próprio (o texto é preservado no dossiê).

## Como carregar
```bash
python tools/carga_base.py validar  ARQUIVO.csv --resolver-duplicados
python tools/carga_base.py lista    ARQUIVO.csv --resolver-duplicados --saida-csv LISTA.csv
python tools/carga_base.py carregar ARQUIVO.csv --resolver-duplicados
python tools/backup_banco.py criar --motivo "antes da carga"
python tools/carga_base.py carregar ARQUIVO.csv --resolver-duplicados --confirmar
python tools/carga_base.py desfazer ORIGEM --confirmar
```
O carregador exige backup recente (< 24h e íntegro) antes de gravar com `--confirmar`, e nunca duplica nem sobrescreve leads já existentes no banco (mesmo WhatsApp ou mesmo nome).

## Enriquecimento por regras (sem IA)
Cada lead recebe uma `analise_complementar` gerada localmente a partir de `enrichment` em `database/contrato.json`: sinais encontrados no texto da pesquisa, modelos/produtos sugeridos (quando configurados), argumento prioritário e perguntas de oportunidade a validar.
