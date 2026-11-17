# IA com Gemini: Plano, Cotas, Rotação de Modelos e Veracidade

## Plano e Segurança
- Suporta tanto o **nível gratuito** da Gemini API quanto chaves com faturamento ativado no Google AI Studio.
- A chave vive exclusivamente no segredo `GEMINI_KEY` da Edge Function `ia` (e em `database/.env` local para testes de CLI). O navegador jamais recebe a chave.
- O prompt envia ao Gemini nome da empresa, perfil, dados públicos do site/pesquisa, conversa e notas, mas nunca chaves ou credenciais.

## Estratégia de Rotação de Modelos (Cascata Anti-429/503)
Como a cota gratuita da Gemini API é contabilizada **por modelo** (~20 chamadas/dia/modelo no Free Tier), a Edge Function `ia` percorre automaticamente uma fila de 5 modelos:
1. `gemini-3.5-flash`
2. `gemini-3.6-flash`
3. `gemini-3-flash-preview`
4. `gemini-3.5-flash-lite`
5. `gemini-2.5-flash`

- **Erro 429 (cota esgotada) ou 404**: avança imediatamente para o próximo modelo da fila sem repetir o anterior.
- **Erro 503 / 5xx (instabilidade transitória)**: repete uma vez no mesmo modelo e, se persistir, avança para o próximo.
- **Ordem customizável**: pode ser alterada sem republicar código via segredo opcional `GEMINI_MODELOS` (lista separada por vírgulas) ou via `ai.fallbackModels` em `cockpit_config.js`.
- A resposta da Edge Function informa o `modelo` efetivamente utilizado e o array `tentativas` (visível no console do navegador).

## Parametrização via `base_conhecimento`
A Edge Function `ia` não contém textos de marca fixos no código. Ela extrai:
- **Persona da marca**: bloco `id = "nucleo-persona"` em `base_conhecimento`.
- **Regras comerciais inegociáveis**: bloco `id = "nucleo-regras"` em `base_conhecimento`.
- **Conhecimento modular**: blocos filtrados por perfil do lead, fase do funil e palavras-chave da conversa (~1 a 1,4 mil tokens enviados por chamada).

## Análise do Lead com Fonte Verificável (Anti-Alucinação)
1. A Edge Function baixa o site do lead no servidor (`coletarSite`, com guarda anti-SSRF `urlPublica`), extrai título, meta description e texto visível.
2. Soma o material disponível (site + histórico + notas + `pre_analise_scout` + `dados_segmento`). Se houver menos de 25 palavras úteis, recusa a chamada sem gastar cota de IA.
3. Toda citação entre aspas gerada pelo modelo é conferida contra o corpus real (`verificarCitacoes`). Se houver citação inexistente, solicita 1 regeneração corretiva apontando os trechos inválidos; o que continuar sem lastro literal é substituído por `"Sem informação verificada nas fontes."`.
