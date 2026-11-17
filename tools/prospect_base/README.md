# prospect_base — higienização, priorização e ganchos para bases de prospecção (pt-BR)

Pacote único e configurável por **segmento/empresa**. O motor (`engine/`) é genérico; tudo que é específico
(varejo, pet shops, design de interiores, restaurantes, hotéis, clínicas, escritórios…) fica em `profiles/<nome>/`.
Saída: `.xlsx` (BASE + Dicionário de dados + Log de higienização) e `.csv` UTF-8, prontos para o Supabase/CRM.

## Uso
```bash
pip install pandas openpyxl
python run.py <perfil> LISTA_BRUTA.xlsx ./saida
```

## O que o motor faz (ordem fixa)
1. Carrega a origem pelo `load()` do perfil (colunas canônicas) · 2. Nome de mercado (sem descritores, cidades, ALL CAPS)
· 3. Duplicados por nome/telefone/WhatsApp/domínio (union-find), mescla mantendo o registro mais rico; conflitos reais
ficam separados e sinalizados (`NOMERGE`) · 4. Telefones em E.164 (+55DDNÚMERO) e formatado, separando WhatsApp
confirmado / celular provável / fixo / outros; DDD inválido ou estrangeiro nunca é "consertado" · 5. Site, Instagram,
e-mails, endereço, CEP, cidade/UF, região comercial · 6. Etapa (Qualificado / A revisar / Dados incompletos) ·
7. Escore 0–100 explicável por regras do perfil + faixas (Dados incompletos = "A qualificar") + motivo ·
8. Gancho individual (última coluna): Alta à mão, demais por modelo determinístico · 9. Validação (`validate`) e exportação.

Campos vazios ficam vazios (NULL). Sem "Não publicado", sem "nan". O ID é gerado pelo Supabase.

## Regra-mãe: nunca deduzir
Se algo não for 100% certo, **pergunte antes**. O motor falha alto: chaves de override sem correspondência única
interrompem a execução; perfil com `TODO` não roda.

## Briefing de segmento (perguntar ANTES de criar um perfil novo)
1. Quem é o público e o que a empresa vende a ele? Quais produtos/serviços e **quais argumentos são aprovados** (prazos, garantias, descontos, programas)? Cite só o que o usuário confirmar; reconfirmar com o material comercial vigente (catálogo/PDF).
2. Domínio, contatos oficiais e cidade da fábrica/loja que podem ser citados no gancho.
3. Colunas e abas da planilha: qual significa o quê? Qual aba/estágio já está validado manualmente?
4. Canal prioritário (ligação/WhatsApp/e-mail) e campos que NÃO entram (status, canal, fonte/lote, ID).
5. Geografia: cidades-alvo, DDDs da área, agrupamento em regiões comerciais, UF.
6. O que torna um lead "bom" para ESTE segmento? Sinais positivos/negativos e pesos.
7. Faixas de prioridade (cortes) e como tratar registros com dados incompletos.
8. Tom e estrutura do gancho; fórmula de abertura quando não há relação real ("Pesquisei e encontrei…"); uso do primeiro nome; variações.
9. Duplicidades ambíguas: mesclar ou manter separado? (cada caso, com o usuário.)

## Adaptando um segmento
Copie `profiles/_modelo` → `profiles/<novo>`. Preencha `load()`, `NAME_*`, geografia, `FLAGS/RULES/DIMS`, `HAND`,
`make_hook`, `COLUMNS`, `DICTIONARY`. Rode `python run.py <novo> origem.xlsx saida`. Valide uma amostra de ganchos
com o usuário antes de gerar tudo.

## Estrutura
```
engine/  textutil · contacts · address · names · scoring · pipeline · profile_check   (genérico)
profiles/_modelo/            esqueleto com TODO para novos segmentos
run.py                       linha de comando
```

Opções de perfil lidas pelo motor (opcionais): `FORCE_MERGE = [('Nome A', 'Nome B')]` mescla leads por decisão do operador; `KEEP_NAME = {...}` define qual nome prevalece no lead mesclado. `EXCLUIDOS` tira marcas da carga.

## Limitações conhecidas
- Colunas canônicas mantêm compatibilidade estrutural; use `OUTPUT_LABELS` para renomear na saída.
- Regex de escore/gancho são em português e sem acento; revisar por segmento.
- O texto dos ganchos de Média/Baixa é um modelo: para outro segmento precisa ser reescrito e validado.
