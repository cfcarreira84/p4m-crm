# Lean ops: como mantivemos o projeto enxuto

Premissa: **custo zero de infraestrutura e de IA**, equipe pequena, sem servidor para cuidar. Cada decisão abaixo troca
sofisticação por simplicidade e só adiciona complexidade quando um dado real pede.

## 1. Infra
- **Sem build, sem npm, sem servidor próprio.** O front é estático e roda com `python -m http.server`. Menos peças, menos
  falhas, deploy em qualquer hospedagem estática.
- **Uma só fonte de parametrização** (`cockpit_config.js`): marca, fases, perfis, pesos, objetivos de IA. Mudar uma fase
  não exige migração (`status_kanban` é texto livre, sem ENUM).
- **Conteúdo em dados, não em código.** Conhecimento de produto vive na tabela `base_conhecimento`; corrigir um texto é
  regravar o JSON (`seed_conhecimento.py`), sem republicar o app nem a função.
- **Bibliotecas por CDN com versão fixa**, para não quebrar por atualização do fornecedor sem aviso.
- **Backend como serviço**: Supabase entrega banco, login, tempo real e funções. Publicação da função pelo painel, sem
  CLI nem token de acesso.

## 2. IA e custo
- **IA só sob demanda.** O operador clica; navegar pelos cartões não gasta cota. Com 20 chamadas por dia por modelo,
  isso foi a decisão que protegeu o uso real.
- **Cache por contexto.** O texto gerado é guardado com um hash do contexto; reabrir reaproveita.
- **Trabalho pago uma vez.** Pesquisa de leads feita em lote e gravada; primeira mensagem vem pronta da base (zero IA).
- **Lista de modelos com troca automática**, já que a cota é por modelo. Capacidade multiplicada sem pagar.
- **Recuperação por filtros em vez de RAG vetorial**: ~2,85 mil tokens de conhecimento não justificam embeddings.
  Enviamos só os blocos relevantes (~1 a 1,4 mil tokens), cortando o prompt pela metade.
- **Medir antes de otimizar**: cada chamada devolve tokens de entrada e saída e os modelos tentados.
- **Adiar o que custa dinheiro**: pesquisa no Google e vetores ficam registrados como evolução, com o gatilho de quando valem.

## 3. Qualidade de dados antes de volume
- **Validar antes de carregar** (`tools/carga_base.py`): o contrato roda sobre o CSV e mostra o relatório sem escrever no
  banco. Achou duplicados, e-mails com texto, 55 leads sem canal de contato, ganchos com valores soltos.
- **Regra proporcional**: erro bloqueia a carga só quando o dado é inutilizável; o resto vira aviso e fica marcado no lead.
- **Idempotência**: migrações e seeds podem rodar de novo sem estragar nada.
- **Carga por último**: só depois de toda a configuração e integrações prontas e testadas.

## 4. Teste barato, em camadas
1. Lógica pura sob Node, sem rede (seleção de blocos, verificador de citações, proteção SSRF, troca de modelo).
2. Navegador headless com a rede simulada (ordem do Kanban, badges, fluxos de IA).
3. Poucas chamadas reais de IA, só quando o teste simulado não prova o que importa.
4. Teste da função **publicada** com login real (`tools/testar_funcao_publicada.mjs`).
Cada rodada real gasta cota, então os testes reais são curtos e os de lógica são numerosos e gratuitos.

## 5. Segurança sem custo
- Segredos só no servidor; `.env` ignorado; varredura do histórico antes de publicar o código.
- Conferência do segredo publicado por **hash**, sem expor o valor.
- Blocos confidenciais (custo e margem de revenda) filtrados no servidor por perfil.
- Respostas de IA com citação inexistente são descartadas.

## 6. Ritmo de entrega
- Releases pequenas e frequentes (SemVer + Conventional Commits), cada uma com entrada no `CHANGELOG.md` e tag anotada.
- Decisões de negócio perguntadas antes de implementar quando mudam o rumo (modelos de dados, regras comerciais).
- Dívida técnica **registrada**, não escondida (caminho direto de IA, pesos a calibrar).
- Notas de aprendizado a cada falha real (APRENDIZADOS.md), para o erro não voltar.
