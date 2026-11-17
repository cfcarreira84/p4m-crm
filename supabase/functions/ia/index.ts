// @ts-nocheck
/**
 * Edge Function `ia` — SDR Cockpit Starter v2.0.0 (100% parametrizada por `base_conhecimento`).
 *
 * Roda no servidor do Supabase: a chave do Gemini fica no segredo `GEMINI_KEY` / `Gemini_Key`
 * e nunca chega ao navegador. Persona, regras comerciais, produtos, programas e playbooks vêm
 * da tabela `base_conhecimento` (tipos `nucleo`, `produto`, `programa`, `playbook`, `prova_social`, `restrito`).
 * Trocar de marca ou atualizar catálogo = editar `database/conhecimento/blocos.json` e rodar
 * `python database/seed_conhecimento.py`, sem precisar editar nem republicar esta função.
 *
 * Ações (POST JSON):
 *   { acao: "mensagem", lead, ctx }  -> { ok, texto, blocos, uso, modelo, tentativas }
 *   { acao: "analise",  lead, ctx }  -> { ok, dossie, blocos, uso, modelo, tentativas }
 *   { acao: "console",  lead, ctx }  -> { ok, sugestao_resposta, status_sugerido, ... }
 */

const MODELOS_PADRAO = [
  "gemini-3-flash-preview",
  "gemini-2.5-pro",
  "gemini-2.5-flash",
  "gemini-3.1-flash-lite-preview",
  "gemini-2.5-flash-lite",
];

const env = (k) =>
  typeof Deno !== "undefined"
    ? Deno.env.get(k)
    : globalThis.process
    ? globalThis.process.env[k]
    : undefined;

const listaModelos = (ctx = {}) => {
  const segredo = env("Gemini_Modelos") || env("GEMINI_MODELOS") || "";
  const dosSegredos = segredo.split(",").map((m) => m.trim()).filter(Boolean);
  if (dosSegredos.length) return dosSegredos;
  if (Array.isArray(ctx?.fallbackModels) && ctx.fallbackModels.length) return ctx.fallbackModels;
  return MODELOS_PADRAO;
};

const obterChaveGemini = () =>
  env("Gemini_Key") || env("GEMINI_KEY") || env("GEMINI_API_KEY") || "";

const PRAZO_TOTAL_MS = 55000;
const MIN_PALAVRAS_ANALISE = 25;
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const PERSONA_PADRAO =
  "Você é o consultor comercial responsável pelo atendimento consultivo B2B e B2C da marca. Escreve em português do Brasil, em tom consultivo, humano, direto e honesto.";

const REGRAS_PADRAO = `REGRAS COMERCIAIS (obrigatórias):
- As informações de catálogo abaixo são a única fonte de especificações, prazos, garantias e programas. Não invente nada além delas.
- Preços: cite apenas se o cliente perguntou ou se já aparecem na conversa, e somente se houver um bloco de preços abaixo.
- Informação marcada como CONFIDENCIAL só pode ser usada se o contato perguntar explicitamente.
- Não prometa materiais, arquivos, descontos ou condições que não estejam nas informações abaixo. Não afirme que algo está anexado: diga apenas que vai enviar.
- Links: use somente os endereços oficiais que aparecem nas informações abaixo. Nunca invente URLs.`;

const norm = (s) =>
  String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
const cortar = (s, n) => String(s || "").replace(/\s+/g, " ").trim().slice(0, n);
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Extrai persona e regras comerciais dos blocos `nucleo` da base de conhecimento (com fallback seguro). */
export function extrairDiretrizes(blocos = [], ctx = {}) {
  const bPersona = (blocos || []).find((b) => b.id === "nucleo-persona" || (b.tipo === "nucleo" && /persona/i.test(b.id || b.titulo)));
  const bRegras = (blocos || []).find((b) => b.id === "nucleo-regras" || (b.tipo === "nucleo" && /regra/i.test(b.id || b.titulo)));
  const persona = bPersona ? bPersona.conteudo : ctx.persona || PERSONA_PADRAO;
  const regras = bRegras
    ? (/^REGRAS/i.test(bRegras.conteudo) ? bRegras.conteudo : `REGRAS COMERCIAIS (obrigatórias):\n${bRegras.conteudo}`)
    : ctx.regras || REGRAS_PADRAO;
  const restantes = (blocos || []).filter((b) => b !== bPersona && b !== bRegras);
  const marca = String(ctx.marca || "nossa equipe").trim();
  return { persona, regras, restantes, marca };
}

/** Escolhe os blocos de conhecimento que vão para o prompt. Exportada para teste. */
export function selecionarBlocos(blocos, { perfil, fase, texto, maxProdutos = 3 }) {
  const alvo = norm(texto);
  const acertos = (b) =>
    (b.palavras || []).reduce((n, p) => {
      const w = norm(p);
      return n + (w && new RegExp("(^|[^a-z0-9])" + esc(w) + "([^a-z0-9]|$)").test(alvo) ? 1 : 0);
    }, 0);

  const elegiveis = (blocos || []).filter((b) => {
    if (b.ativo === false) return false;
    const perfis = b.perfis || [];
    if (b.restrito && !perfis.includes(perfil)) return false;
    if (perfis.length && !perfis.includes(perfil)) return false;
    if ((b.fases || []).length && !b.fases.includes(fase)) return false;
    return true;
  });

  const fixos = [],
    gated = [];
  for (const b of elegiveis) {
    const comGatilho = (b.palavras || []).length > 0 && b.tipo !== "programa";
    if (!comGatilho) {
      fixos.push(b);
      continue;
    }
    const s = acertos(b);
    if (s > 0) gated.push({ b, s });
  }
  gated.sort((x, y) => y.s - x.s || (y.b.prioridade || 0) - (x.b.prioridade || 0));
  let produtos = 0;
  const escolhidos = [...fixos];
  for (const { b } of gated) {
    if (b.tipo === "produto") {
      if (produtos >= maxProdutos) continue;
      produtos++;
    }
    escolhidos.push(b);
  }
  return escolhidos.sort((x, y) => (y.prioridade || 0) - (x.prioridade || 0));
}

function formatarBlocos(blocos) {
  return blocos
    .map((b) => `### ${b.titulo}${b.restrito ? " (CONFIDENCIAL)" : ""}\n${b.conteudo}`)
    .join("\n\n");
}

const LEGENDA = {
  interlocutor: {
    dono_socio: "dono ou sócio",
    atendente_balcao: "atendente de balcão",
    comprador: "o próprio comprador (decide e paga)",
    especificador: "o especificador/arquiteto do projeto (especifica e influencia)",
    arquiteto: "o arquiteto/especificador do projeto (especifica e influencia)",
    representante: "um representante do comprador (familiar ou outra pessoa), que não decide sozinho",
  },
  encantamento: { baixo: "baixo", medio: "médio", alto: "alto" },
  potencial: {
    curto_prazo: "curto prazo (compra em dias)",
    medio_prazo: "médio prazo",
    longo_prazo: "longo prazo (projeto que pode levar meses ou anos)",
  },
  parceria: { baixo: "baixa", medio: "média", alto: "alta" },
  demanda: { sim: "sim", nao: "não" },
};

function linhasDoLead(lead, ctx) {
  const linhas = [];
  const add = (r, v) => {
    if (v && String(v).trim()) linhas.push(`- ${r}: ${v}`);
  };
  add("Empresa", lead.nome_fantasia);
  add("Razão Social", lead.razao_social);
  add("Perfil do cliente", ctx.categoriaLabel);
  add("Localidade", [lead.cidade, lead.bairro, lead.endereco_completo].filter(Boolean).join(" • "));
  add("Contato", ctx.contato);
  add("Responsável interno", lead.responsavel_operador);
  add("E-mail", lead.email_contato || lead.email_parcerias);
  add("Instagram", lead.instagram_url);
  add("Prioridade da base", lead.prioridade_carga ? `${lead.prioridade_carga}${lead.pontuacao_carga != null ? ` (${lead.pontuacao_carga} pts)` : ""}` : "");
  add("Observação cadastral", lead.observacao_dados);
  add("Data programada de retorno", lead.data_reativacao_programada);
  add("Interlocutor", LEGENDA.interlocutor[lead.discovery_interlocutor]);
  add("Potencial de negócio", LEGENDA.potencial[lead.discovery_potencial_negocio]);
  add("Inclinação de parceria", LEGENDA.parceria[lead.discovery_inclinacao_parceria]);
  add("Encantamento com os produtos", LEGENDA.encantamento[lead.discovery_encantamento_produtos]);
  add("Demanda imediata", LEGENDA.demanda[lead.discovery_demanda_imediata]);
  add(
    "Valor do pedido (estimativa interna da equipe: só cite valores que já apareceram na conversa)",
    Number(lead.ticket_estimado) > 0 ? `R$ ${Number(lead.ticket_estimado).toLocaleString("pt-BR")}` : ""
  );
  add("Última prévia/rascunho do operador", lead.proxima_mensagem_customizada ? cortar(lead.proxima_mensagem_customizada, 500) : "");
  add("Nota direta do cartão", lead.notas_operador ? cortar(lead.notas_operador, 600) : "");
  add("Site", lead.website_original);
  return linhas;
}

function pesquisaPrevia(lead) {
  const s = lead.pre_analise_scout || {};
  const seg = lead.dados_segmento || {};
  const itens = [];
  const add = (r, v) => {
    if (v && String(v).trim()) itens.push(`- ${r}: ${cortar(v, 700)}`);
  };
  add("Perfil de atuação", s.perfil_projetos || s.status_presenca);
  add("Projetos / obras / empreendimentos de referência", s.obras_referencia || seg.obras_referencia || seg.empreendimentos);
  add("Mini bio", s.mini_bio);
  add("Pontos fortes verificados", s.pontos_fortes);
  const atencao = String(s.pontos_fracos || "").trim();
  if (atencao && !/^sem informa/i.test(atencao)) add("Pontos de atenção levantados", atencao);
  add("Argumento prioritário definido pela equipe", s.argumento_prioritario || s.solucao_recomendada);
  add("Hipóteses da equipe a validar (não afirmar ao cliente)", s.gargalo_critico);
  const comp = s.analise_complementar || {};
  if (comp.gargalo_critico && !/^sem dados suficientes/i.test(String(comp.gargalo_critico))) {
    add("Oportunidade a validar (IA complementar)", comp.gargalo_critico);
  }
  const prop = comp.solucao_recomendada;
  if (prop && !/^sem dados suficientes/i.test(String(prop))) {
    add("Soluções já sugeridas pela análise (podem ser refinadas pela conversa)", prop);
  }
  for (const [k, v] of Object.entries(seg)) {
    if (["obras_referencia", "empreendimentos"].includes(k)) continue;
    if (v && String(v).trim()) add(`Dado do segmento (${k})`, v);
  }
  return itens;
}

export function montarPromptMensagem(lead, ctx, blocos) {
  const { persona, regras, restantes, marca } = extrairDiretrizes(blocos, ctx);
  const dataCurta = (iso) => (iso ? new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "");
  const ehEvento = (t) => /^(🏷️|👤|📞)/.test(String(t.texto || ""));
  const tl = Array.isArray(lead.timeline) ? lead.timeline : [];
  const notas = tl
    .filter((t) => t.tipo === "nota_operador" && !ehEvento(t))
    .map((t) => `- (${dataCurta(t.iso)}, ${t.autor}) ${cortar(t.texto, 600)}`);
  const conversa = tl.filter((t) => t.tipo !== "nota_operador").slice(-20);
  const linhasConversa = conversa.map(
    (t) => `[${dataCurta(t.iso)}] ${t.direcao === "outbound" ? marca.toUpperCase() : "CLIENTE"} (${t.autor}): ${cortar(t.texto, 400)}`
  );

  let ultima = "Ainda não houve conversa: esta é a primeira abordagem.";
  if (conversa.length) {
    const u = conversa[conversa.length - 1];
    const dias = u.iso ? Math.max(0, Math.round((Date.now() - new Date(u.iso).getTime()) / 86400000)) : null;
    ultima = `A última mensagem foi do ${u.direcao === "outbound" ? `lado de ${marca}` : "CLIENTE"}${dias !== null ? `, há ${dias} dia(s)` : ""}.`;
  }
  const previa = pesquisaPrevia(lead);

  const estilos = [
    "Estilo A (Direto e factual): comece citando o ponto objetivo encontrado na pesquisa e faça a ponte para a pergunta final sem rodeios.",
    "Estilo B (Contexto de setor): abra comentando uma observação prática sobre a atuação/região da empresa e conecte com uma pergunta curta.",
    "Estilo C (Curiosidade consultiva): inicie com uma pergunta leve de diagnóstico ligada ao perfil do lead antes de se apresentar brevemente.",
    "Estilo D (Abordagem breve em 2 tempos): 1º bloco apresentando quem fala e como encontrou a empresa; 2º bloco com o gancho específico e 1 pergunta.",
  ];
  const idxEstilo = Number.isInteger(ctx.estiloIndice) ? Math.abs(ctx.estiloIndice) % estilos.length : 0;
  const blocoVariacao = ctx.variacaoAntiTemplate
    ? `\nDIRETRIZ ANTI-TEMPLATE (OBRIGATÓRIA):
- Use obrigatoriamente uma construção frasal genuinamente diferente de abordagens anteriores. Varie abertura, conectivos, cadência e vocabulário para evitar qualquer padrão repetitivo de spam.
- Diretriz de estilo sorteada para este lead: ${estilos[idxEstilo]}
- Estruture em 2 ou 3 parágrafos curtos separados por linha em branco (\\n\\n), pois cada parágrafo será enviado em um balão separado no WhatsApp.`
    : "";

  if (ctx.canal === "email") {
    return `${persona}

${regras}

INFORMAÇÕES OFICIAIS DA MARCA (fonte única):
${formatarBlocos(restantes) || "(base de conhecimento em configuração)"}

TAREFA: escreva um E-MAIL de primeiro contato / fallback comercial que ${ctx.operador} (${marca}) enviará a ${ctx.contato || "este contato"}, da empresa ${lead.nome_fantasia} (número sem WhatsApp ativo).
Hoje é ${new Date().toLocaleDateString("pt-BR", { dateStyle: "full" })}.
FASE DO FUNIL: ${ctx.etapaLabel}. OBJETIVO DESTA FASE: ${ctx.aiGoal || "abrir conversa comercial consultiva"}

DADOS DO LEAD:
${linhasDoLead(lead, ctx).join("\n")}

PESQUISA PRÉVIA DA EQUIPE SOBRE O LEAD:
${previa.join("\n") || "(sem pesquisa prévia)"}

NOTAS DO OPERADOR (contexto interno, o cliente não as viu):
${notas.join("\n") || "(sem notas)"}

CONVERSA (em ordem cronológica):
${linhasConversa.join("\n") || "(sem conversa)"}
${ultima}

COMO ESCREVER O E-MAIL:
- Assunto curto, natural e sem cara de marketing em massa (máx. 60 caracteres).
- Corpo em 2 a 3 parágrafos curtos, tom executivo e humano, honesto sobre como encontramos a empresa, sem elogios artificiais e terminando com UMA pergunta ou convite simples de 2 minutos.
- Não use markdown, negrito ou listas com marcadores.

Retorne EXCLUSIVAMENTE JSON: {"assunto": "assunto do e-mail", "mensagem": "corpo do e-mail em texto puro"}`;
  }

  return `${persona}

${regras}

INFORMAÇÕES OFICIAIS DA MARCA (fonte única):
${formatarBlocos(restantes) || "(base de conhecimento em configuração)"}

TAREFA: escreva a PRÓXIMA mensagem de WhatsApp que ${ctx.operador} (${marca}) enviará a ${ctx.contato || "este contato"}, da empresa ${lead.nome_fantasia}.
Hoje é ${new Date().toLocaleDateString("pt-BR", { dateStyle: "full" })}.
FASE DO FUNIL: ${ctx.etapaLabel}. OBJETIVO DESTA FASE: ${ctx.aiGoal || "dar o próximo passo da conversa"}
OBJETIVO PRINCIPAL DA MENSAGEM: retomar a conversa com este lead e dar sequência ao funil${ctx.proximaEtapaLabel ? `, levando-o até a próxima fase (${ctx.proximaEtapaLabel})` : ""}. Use o dossiê, o valor do pedido, as notas do operador e a conversa para escolher o melhor gancho de retomada.

DADOS DO LEAD:
${linhasDoLead(lead, ctx).join("\n")}

PESQUISA PRÉVIA DA EQUIPE SOBRE O LEAD:
${previa.join("\n") || "(sem pesquisa prévia)"}

NOTAS DO OPERADOR (contexto interno, o cliente não as viu):
${notas.join("\n") || "(sem notas)"}

CONVERSA (em ordem cronológica):
${linhasConversa.join("\n") || "(sem conversa)"}
${ultima}

REGRAS DE VERACIDADE E HUMANIZAÇÃO:
1. Nunca afirme que conhece, acompanha, admira ou já viu trabalhos do lead, nem sugira relação prévia, a menos que isso esteja na conversa ou nas notas. Em primeira abordagem, diga a verdade sobre a origem do contato, por exemplo "Pesquisei empresas do segmento e encontrei a de vocês". Só cite um fato específico do lead se ele constar nos dados acima (projetos e perfil da pesquisa prévia podem ser citados como algo que você encontrou na pesquisa).
2. Se há conversa, responda primeiro ao que o cliente disse por último (perguntas, objeções, especificações), usando as informações da marca acima. Não repita o que já foi explicado.
3. Retome do ponto exato em que parou. Se já se passaram dias, reconheça o intervalo com naturalidade, sem cobrar resposta.
4. Escreva como uma pessoa no WhatsApp: natural, sem jargão de marketing, sem listas, no máximo um emoji (ou nenhum).
5. De 2 a 4 frases curtas (até 80 palavras), terminando com UMA pergunta ou um próximo passo claro.
6. Trate o contato pelo primeiro nome, se houver. Só se apresente se for a primeira mensagem.
7. Ao citar projetos ou perfil da pesquisa prévia, apresente como algo que você ENCONTROU na pesquisa. Nunca elogie de forma artificial nem avalie a qualidade do trabalho ("rigor técnico", "sofisticação", "referência") nem diga "vi" ou "admiro": você só sabe o que está escrito nos dados.
8. Se a conversa deixar dúvida sobre qual produto ou configuração o cliente quer, não presuma: confirme com uma pergunta. Se não souber de algo, não invente: diga que confirma com o especialista técnico.
9. Se a última mensagem foi da nossa equipe e o cliente não respondeu, retome por algo NOVO e útil ligado ao último ponto da conversa (proposta enviada, dúvida técnica, retorno combinado), sem cobrar nem repetir o que já foi dito. Se foi do CLIENTE, responda a ele primeiro.
10. Se a conversa mostra um assunto pendente (orçamento de concorrente, medida, decisão interna, prazo), toque nele de forma concreta e proponha UM próximo passo claro que avance o funil.
11. Se o cliente contou um imprevisto pessoal (viagem, problema), acolha em uma frase curta e sem expor detalhes; nunca use informação pessoal que ele não tenha dito na conversa.
12. O valor do pedido é uma estimativa interna: não o cite como preço, a menos que já tenha aparecido na conversa.${blocoVariacao}

Retorne EXCLUSIVAMENTE JSON: {"mensagem": "texto pronto para enviar"}`;
}

function contextoDaConversa(lead, marca = "EQUIPE") {
  const dataCurta = (iso) => (iso ? new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "");
  const ehEvento = (t) => /^(🏷️|👤|📞)/.test(String(t.texto || ""));
  const tl = Array.isArray(lead.timeline) ? lead.timeline : [];
  const notas = tl
    .filter((t) => t.tipo === "nota_operador" && !ehEvento(t))
    .map((t) => `- (${dataCurta(t.iso)}, ${t.autor}) ${cortar(t.texto, 600)}`);
  const conversa = tl.filter((t) => t.tipo !== "nota_operador").slice(-20);
  const linhasConversa = conversa.map(
    (t) => `[${dataCurta(t.iso)}] ${t.direcao === "outbound" ? marca.toUpperCase() : "CLIENTE"} (${t.autor}): ${cortar(t.texto, 400)}`
  );
  let ultima = "Ainda não houve conversa.";
  if (conversa.length) {
    const u = conversa[conversa.length - 1];
    const dias = u.iso ? Math.max(0, Math.round((Date.now() - new Date(u.iso).getTime()) / 86400000)) : null;
    ultima = `A última mensagem foi do ${u.direcao === "outbound" ? `lado de ${marca}` : "CLIENTE"}${dias !== null ? `, há ${dias} dia(s)` : ""}.`;
  }
  return { notas, linhasConversa, ultima };
}

export function montarPromptConsole(lead, ctx, blocos) {
  const { persona, regras, restantes, marca } = extrairDiretrizes(blocos, ctx);
  const { notas, linhasConversa, ultima } = contextoDaConversa(lead, marca);
  const previa = pesquisaPrevia(lead);
  const etapas = (ctx.etapas || []).map((e) => `${e.id} (${e.label})`).join(", ");
  return `${persona}

${regras}

INFORMAÇÕES OFICIAIS DA MARCA (fonte única):
${formatarBlocos(restantes) || "(base de conhecimento em configuração)"}

TAREFA: ${ctx.operador} (${marca}) está atendendo ${ctx.contato || "este contato"}, da empresa ${lead.nome_fantasia}, e pediu ajuda no console.
Hoje é ${new Date().toLocaleDateString("pt-BR", { dateStyle: "full" })}. FASE ATUAL DO FUNIL: ${ctx.etapaLabel}.

DADOS DO LEAD:
${linhasDoLead(lead, ctx).join("\n")}

PESQUISA PRÉVIA DA EQUIPE SOBRE O LEAD:
${previa.join("\n") || "(sem pesquisa prévia)"}

NOTAS DO OPERADOR (contexto interno):
${notas.join("\n") || "(sem notas)"}

CONVERSA ATÉ AGORA (em ordem cronológica):
${linhasConversa.join("\n") || "(sem conversa)"}
${ultima}

PEDIDO DO OPERADOR (pode ser a resposta do cliente colada aqui, ou uma pergunta de estratégia):
"""
${cortar(ctx.pedido, 2000)}
"""

COMO RESPONDER:
- Se o operador colou uma mensagem do cliente: escreva a réplica pronta para o WhatsApp (até 80 palavras, uma única pergunta ou próximo passo).
- Se fez uma pergunta de estratégia: dê uma orientação objetiva, em até 5 frases, dizendo o que dizer ou fazer.
- Use somente as informações acima. Nunca afirme conhecer, acompanhar ou admirar o trabalho do lead. Não invente dados; se faltar informação, diga que confirma com o especialista.
- "status_sugerido" deve ser exatamente um destes ids de fase (mantenha a fase atual se nada justificar mudar): ${etapas}.

Retorne EXCLUSIVAMENTE JSON:
{"sugestao_resposta":"texto","status_sugerido":"id_da_fase","perfil_cadencia":"resumo curto do padrão de resposta deste lead, ou vazio","proximo_followup_nominal":"data nominal sugerida ou vazio"}`;
}

export function montarPromptAnalise(lead, ctx, blocos, siteTexto = "", correcao = "") {
  const { persona, regras, restantes } = extrairDiretrizes(blocos, ctx);
  const siteUrl = ctx.siteUrl || "";
  const previa = pesquisaPrevia(lead);
  return `${persona}

${regras}

INFORMAÇÕES OFICIAIS DA MARCA (fonte única):
${formatarBlocos(restantes) || "(base de conhecimento em configuração)"}

TAREFA: elaborar o dossiê comercial do lead abaixo de forma HONESTA e baseada em evidências.
DADOS COMPLETOS DO CARTÃO:
${linhasDoLead(lead, ctx).join("\n")}
${siteUrl ? `- Site para leitura: ${siteUrl}\n` : "- Site: não informado\n"}- Contexto do operador e histórico: ${cortar(ctx.historico, 3500) || "nenhum"}
${previa.length ? `\nPESQUISA PRÉVIA DA EQUIPE SOBRE O LEAD (base enriquecida, já revisada; cite como "pesquisa prévia"):\n${previa.join("\n")}\n` : ""}${siteTexto ? `\nTEXTO DO SITE (coletado agora; é a ÚNICA fonte do site):\n<<<\n${siteTexto}\n>>>\n` : ""}${correcao ? `\nCORREÇÃO OBRIGATÓRIA: ${correcao}\n` : ""}
COMO ANALISAR:
- ${siteTexto ? "Use o TEXTO DO SITE acima e " : "Use "}o contexto do operador${previa.length ? " e a PESQUISA PRÉVIA DA EQUIPE" : ""}. Use SOMENTE o que estiver escrito nessas fontes.
- A PESQUISA PRÉVIA DA EQUIPE já foi revisada: use-a, não a contradiga e não repita o que ela já diz. Quando houver conversa ou notas, ligue as soluções da marca ao que o cliente pediu.
- Cada afirmação sobre o lead precisa indicar a origem entre parênteses. Para fatos do site, copie um trecho LITERAL curto do TEXTO DO SITE entre aspas, por exemplo (site: "trecho literal"). Todo trecho entre aspas será conferido automaticamente contra as fontes e o que não existir será descartado. Para fatos do operador, use (contexto do operador). Fato sem trecho literal não pode ser escrito.
- Se o site tiver pouco conteúdo, diga isso ("o site traz poucas informações"). É proibido completar com o que seria típico de empresas desse tipo: materiais, estilos, tipos de cliente e serviços só podem aparecer se estiverem escritos nas fontes.
- NUNCA apresente dedução como fato. É proibido escrever como verdade: dependência de fornecedores, dificuldades, dores, concorrentes, faturamento, tamanho da equipe ou intenção de compra, a menos que esteja escrito nas fontes.
- Quando faltar informação em um campo, escreva exatamente "Sem informação verificada nas fontes." Não preencha com texto genérico.
- Hipóteses só podem aparecer em "gargalo_critico" e "solucao_recomendada", escritas como hipótese e ligadas a um fato citado.
- Na proposta, escolha soluções específicas das informações da marca acima e explique a ligação com o que foi encontrado. Não cite preços.
- Se as fontes NÃO bastarem para recomendar uma solução sem inventar, escreva em "solucao_recomendada" exatamente "Sem dados suficientes para elaborar proposta." e use "Sem informação verificada nas fontes." nos campos sem base. Nunca complete lacunas com suposições.

CAMPOS DO JSON:
- status_presenca: quem é o lead e o que faz, só com fatos das fontes.
- pontos_fortes: fatos verificados que favorecem a parceria, cada um com a origem.
- pontos_fracos: apenas limitações confirmadas nas fontes; caso contrário "Sem informação verificada nas fontes."
- gargalo_critico: começa com "A validar:" e traz perguntas ou hipóteses ligadas a um fato citado.
- solucao_recomendada: começa com "Proposta:" e indica a(s) solução(ões) recomendada(s) e por quê.
- gancho_kickoff_gerado: primeira mensagem de WhatsApp em 2 blocos curtos separados por linha em branco, honesta sobre a origem do contato ("Pesquisei... e encontrei..."), citando no máximo UM fato verificado, dito como o que chamou sua atenção em vez de repetir ao lead o que ele mesmo escreve no site, e terminando com uma única pergunta. Não diga que acompanha ou admira o trabalho do lead. Se não houver nenhum fato do lead para citar, deixe vazio.

Retorne EXCLUSIVAMENTE JSON:
{"status_presenca":"","pontos_fortes":"","pontos_fracos":"","gargalo_critico":"","solucao_recomendada":"","gancho_kickoff_gerado":""}`;
}

/** Impede que a função seja usada para acessar a rede interna (SSRF). */
function urlPublica(u) {
  try {
    const x = new URL(u);
    if (!/^https?:$/.test(x.protocol)) return false;
    const h = x.hostname.toLowerCase();
    if (h === "localhost" || h.endsWith(".local") || h.endsWith(".internal") || !h.includes(".")) return false;
    if (/^(127\.|10\.|0\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(h) || h.startsWith("[")) return false;
    return true;
  } catch {
    return false;
  }
}

/** Baixa o site do lead no servidor e devolve só o texto visível (fonte verificável da análise). */
export async function coletarSite(url, { timeoutMs = 12000, limite = 8000 } = {}) {
  if (!urlPublica(url)) return { ok: false, motivo: "url_invalida" };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, {
      redirect: "follow",
      signal: ctrl.signal,
      headers: { "User-Agent": "Mozilla/5.0 (compatible; SDRCockpitBot/2.0)", Accept: "text/html" },
    });
    if (!r.ok) return { ok: false, motivo: `http_${r.status}` };
    const html = (await r.text()).slice(0, 1500000);
    const titulo = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || "";
    const desc = (html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i) || [])[1] || "";
    const corpo = html
      .replace(/<(script|style|svg|noscript)[\s\S]*?<\/\1>/gi, " ")
      .replace(/<[^>]+>/g, "\n")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&#39;|&apos;/g, "'")
      .replace(/&quot;/g, '"');
    const linhas = [
      ...new Set(
        [titulo, desc, ...corpo.split("\n")]
          .map((l) => l.replace(/\s+/g, " ").trim())
          .filter((l) => l.length > 1)
      ),
    ];
    const texto = linhas.join("\n").slice(0, limite);
    return { ok: true, texto, palavras: texto.split(/\s+/).length };
  } catch (e) {
    return { ok: false, motivo: e?.name === "AbortError" ? "tempo_esgotado" : "falha_rede" };
  } finally {
    clearTimeout(timer);
  }
}

const base = (s) =>
  norm(s)
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

export function verificarCitacoes(dossie, corpus, siteTexto = "") {
  const geral = " " + base(corpus) + " ";
  const doSite = " " + base(siteTexto) + " ";
  const invalidas = [];
  const campos = [
    "status_presenca",
    "pontos_fortes",
    "pontos_fracos",
    "gargalo_critico",
    "solucao_recomendada",
    "gancho_kickoff_gerado",
  ];
  const camposAfetados = new Set();
  let total = 0;
  for (const c of campos) {
    const txt = String(dossie[c] || "");
    for (const m of txt.matchAll(/["“]([^"”]{3,200})["”]/g)) {
      const trecho = base(m[1]);
      if (trecho.length < 3) continue;
      total++;
      const depois = txt.slice(m.index + m[0].length, m.index + m[0].length + 14);
      const antes = txt.slice(Math.max(0, m.index - 14), m.index);
      const rotuladoSite = /^\s*\)?\s*\(site/i.test(depois) || /\(site:?\s*$/i.test(antes);
      const fonte = rotuladoSite ? doSite : geral;
      if (!fonte.includes(" " + trecho + " ")) {
        invalidas.push(m[1]);
        camposAfetados.add(c);
      }
    }
  }
  return { total, invalidas, camposAfetados: [...camposAfetados] };
}

const transitorio = (r) =>
  !r.ok && (r.motivo === "tempo_esgotado" || (r.motivo === "ia_indisponivel" && !/^HTTP 4/.test(r.detalhe || "")));

const RE_MARCADOR = /\s*\((?:site|contexto do operador|pesquisa pr[eé]via|hist[oó]rico)\b(?:[^"“”()]|["“][^"”]*["”])*\)/gi;
export function limparCitacoes(texto) {
  return String(texto || "")
    .replace(RE_MARCADOR, "")
    .replace(/\s+([.,;:!?])/g, "$1")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

export function semPrefixo(texto, rotulo) {
  return String(texto || "").replace(new RegExp("^\\s*" + rotulo + "\\s*:\\s*", "i"), "").trim();
}

async function chamarGemini(prompt, opcoes = {}) {
  const inicio = Date.now();
  const tentativas = [];
  let ultimo = { ok: false, motivo: "ia_indisponivel" };
  const modelos = listaModelos(opcoes.ctx);
  for (let idx = 0; idx < modelos.length; idx++) {
    const modelo = modelos[idx];
    if (Date.now() - inicio > PRAZO_TOTAL_MS) break;
    const promptCalibrado = idx > 0
      ? `${prompt}\n\n[CALIBRAGEM DE QUALIDADE]: Você está substituindo o modelo principal em rotação. Mantenha rigor máximo de precisão factual, respeite todas as diretrizes e devolva estritamente o JSON solicitado.`
      : prompt;
    let r = await chamarGeminiUmaVez(promptCalibrado, { ...opcoes, modelo });
    if (transitorio(r) && Date.now() - inicio < PRAZO_TOTAL_MS - 15000) {
      await new Promise((ok) => setTimeout(ok, 1000));
      r = await chamarGeminiUmaVez(promptCalibrado, { ...opcoes, modelo });
    }
    tentativas.push({ modelo, ok: r.ok, motivo: r.ok ? null : r.motivo, detalhe: r.detalhe || null });
    if (r.ok) return { ...r, modelo, tentativas };
    ultimo = { ...r, modelo, tentativas };
    if (r.motivo === "sem_chave") break;
  }
  return ultimo;
}

async function chamarGeminiUmaVez(
  prompt,
  { modelo = MODELOS_PADRAO[0], temperature = 0.3, tools = null, timeoutMs = 45000 } = {}
) {
  const chave = obterChaveGemini();
  if (!chave) return { ok: false, motivo: "sem_chave" };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const resp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${modelo}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": chave },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        ...(tools ? { tools } : {}),
        generationConfig: { temperature, responseMimeType: "application/json" },
      }),
      signal: ctrl.signal,
    });
    if (resp.status === 429) return { ok: false, motivo: "cota" };
    if (!resp.ok) return { ok: false, motivo: "ia_indisponivel", detalhe: `HTTP ${resp.status}` };
    const data = await resp.json();
    const partes = data?.candidates?.[0]?.content?.parts || [];
    const bruto = partes
      .filter((p) => !p.thought && typeof p.text === "string")
      .map((p) => p.text)
      .join("")
      .trim()
      .replace(/^```json\s*/i, "")
      .replace(/```$/i, "")
      .trim();
    const u = data?.usageMetadata || {};
    return {
      ok: true,
      json: JSON.parse(bruto),
      uso: { entrada: u.promptTokenCount ?? null, saida: u.candidatesTokenCount ?? null },
    };
  } catch (e) {
    return {
      ok: false,
      motivo: e?.name === "AbortError" ? "tempo_esgotado" : "ia_indisponivel",
      detalhe: String(e?.message || e),
    };
  } finally {
    clearTimeout(timer);
  }
}

function resposta(corpo, status = 200) {
  return new Response(JSON.stringify(corpo), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}

async function validarUsuario(token) {
  const url = env("SUPABASE_URL"),
    anon = env("SUPABASE_ANON_KEY");
  if (!token || !url) return false;
  const r = await fetch(`${url}/auth/v1/user`, { headers: { Authorization: token, apikey: anon || "" } });
  return r.ok;
}

async function carregarBlocos(token) {
  const url = env("SUPABASE_URL"),
    anon = env("SUPABASE_ANON_KEY");
  const r = await fetch(`${url}/rest/v1/base_conhecimento?select=*&ativo=eq.true`, {
    headers: { Authorization: token, apikey: anon || "" },
  });
  if (!r.ok) return null;
  return await r.json();
}

export async function handler(req) {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return resposta({ ok: false, motivo: "metodo" }, 405);

  const token = req.headers.get("Authorization");
  if (!(await validarUsuario(token))) return resposta({ ok: false, motivo: "nao_autenticado" }, 401);

  let corpo;
  try {
    corpo = await req.json();
  } catch {
    return resposta({ ok: false, motivo: "entrada_invalida" }, 400);
  }
  const { acao, lead, ctx } = corpo || {};
  if (!["mensagem", "analise", "console"].includes(acao) || !lead || !ctx || !lead.nome_fantasia) {
    return resposta({ ok: false, motivo: "entrada_invalida" }, 400);
  }

  const todos = await carregarBlocos(token);
  if (!todos || !todos.length) return resposta({ ok: false, motivo: "base_indisponivel" }, 503);

  const tl = Array.isArray(lead.timeline) ? lead.timeline : [];
  const s = lead.pre_analise_scout || {};
  const seg = lead.dados_segmento || {};
  const texto = [
    ctx.historico,
    lead.notas_operador,
    ctx.etapaLabel,
    ctx.pedido,
    ...tl.map((t) => t.texto),
    s.perfil_projetos,
    s.obras_referencia,
    s.argumento_prioritario,
    s.solucao_recomendada,
    ...Object.values(seg),
  ]
    .filter(Boolean)
    .join(" \n ");
  const blocos = selecionarBlocos(todos, { perfil: lead.cluster_estrategico, fase: ctx.etapaId, texto });
  const ids = blocos.map((b) => b.id);

  if (acao === "mensagem") {
    const r = await chamarGemini(montarPromptMensagem(lead, ctx, blocos), {
      temperature: 0.6,
      timeoutMs: 25000,
      ctx,
    });
    if (!r.ok) return resposta({ ok: false, motivo: r.motivo, detalhe: r.detalhe, tentativas: r.tentativas }, 502);
    const msg = typeof r.json?.mensagem === "string" ? r.json.mensagem.trim() : "";
    if (!msg) return resposta({ ok: false, motivo: "ia_indisponivel", detalhe: "resposta vazia" }, 502);
    const assunto = ctx.canal === "email" && typeof r.json?.assunto === "string" ? r.json.assunto.trim() : "";
    const dataPayload = ctx.canal === "email" ? { assunto, mensagem: msg } : { mensagem: msg };
    return resposta({
      ok: true,
      texto: msg,
      ...(assunto ? { assunto } : {}),
      data: dataPayload,
      blocos: ids,
      uso: r.uso,
      modelo: r.modelo,
      tentativas: r.tentativas,
    });
  }

  if (acao === "console") {
    if (!String(ctx.pedido || "").trim()) return resposta({ ok: false, motivo: "entrada_invalida" }, 400);
    const r = await chamarGemini(montarPromptConsole(lead, ctx, blocos), {
      temperature: 0.4,
      timeoutMs: 25000,
      ctx,
    });
    if (!r.ok) return resposta({ ok: false, motivo: r.motivo, detalhe: r.detalhe, tentativas: r.tentativas }, 502);
    const j = r.json || {};
    const sugestao = typeof j.sugestao_resposta === "string" ? j.sugestao_resposta.trim() : "";
    if (!sugestao) return resposta({ ok: false, motivo: "ia_indisponivel", detalhe: "resposta vazia" }, 502);
    const etapas = Array.isArray(ctx.etapas) ? ctx.etapas : [];
    const sugerida = etapas.some((e) => e.id === j.status_sugerido) ? j.status_sugerido : ctx.etapaId;
    const nome = (etapas.find((e) => e.id === sugerida) || {}).label || ctx.etapaLabel;
    return resposta({
      ok: true,
      sugestao_resposta: sugestao,
      status_sugerido: sugerida,
      status_sugerido_nome: nome,
      perfil_cadencia: typeof j.perfil_cadencia === "string" ? j.perfil_cadencia.trim() : "",
      proximo_followup_nominal: typeof j.proximo_followup_nominal === "string" ? j.proximo_followup_nominal.trim() : "",
      blocos: ids,
      uso: r.uso,
      modelo: r.modelo,
      tentativas: r.tentativas,
    });
  }

  const site = String(ctx.siteUrl || "").trim();
  const coleta = site ? await coletarSite(site) : { ok: false, motivo: "sem_site" };
  const siteTexto = coleta.ok ? coleta.texto : "";
  const palavras = (t) => String(t || "").split(/\s+/).filter(Boolean).length;
  const material =
    palavras(siteTexto) +
    palavras(ctx.historico) +
    palavras(lead.notas_operador) +
    tl.reduce((n, t) => n + palavras(t.texto), 0) +
    palavras(pesquisaPrevia(lead).join(" "));
  if (material < MIN_PALAVRAS_ANALISE) {
    return resposta({
      ok: true,
      insuficiente: true,
      material,
      site: coleta.ok ? "lido" : coleta.motivo,
      mensagem:
        "Não há dados suficientes para elaborar uma proposta. Registre mensagens ou observações do lead (ou informe o site) e tente de novo.",
    });
  }
  const corpus = [
    siteTexto,
    ctx.historico,
    lead.notas_operador,
    ...tl.map((t) => t.texto),
    ...pesquisaPrevia(lead),
    formatarBlocos(blocos),
  ]
    .filter(Boolean)
    .join("\n");

  let r = await chamarGemini(montarPromptAnalise(lead, ctx, blocos, siteTexto), {
    temperature: 0.1,
    timeoutMs: 35000,
    ctx,
  });
  if (!r.ok) return resposta({ ok: false, motivo: r.motivo, detalhe: r.detalhe }, 502);
  let ver = verificarCitacoes(r.json || {}, corpus, siteTexto);
  if (ver.invalidas.length) {
    const r2 = await chamarGemini(
      montarPromptAnalise(
        lead,
        ctx,
        blocos,
        siteTexto,
        `Estas citações NÃO existem nas fontes e devem sair do texto: ${ver.invalidas
          .map((x) => `"${x}"`)
          .join("; ")}. Reescreva sem elas e sem inventar outras.`
      ),
      { temperature: 0.1, timeoutMs: 50000, ctx }
    );
    if (r2.ok) {
      r = r2;
      ver = verificarCitacoes(r.json || {}, corpus, siteTexto);
    }
  }
  const d = r.json || {};
  if (!d || typeof d !== "object" || !(d.status_presenca || d.solucao_recomendada)) {
    return resposta({ ok: false, motivo: "ia_indisponivel", detalhe: "resposta incompleta" }, 502);
  }
  for (const c of ver.camposAfetados) {
    d[c] = c === "gancho_kickoff_gerado" ? "" : "Sem informação verificada nas fontes.";
  }
  for (const c of [
    "status_presenca",
    "pontos_fortes",
    "pontos_fracos",
    "gargalo_critico",
    "solucao_recomendada",
    "gancho_kickoff_gerado",
  ]) {
    d[c] = limparCitacoes(d[c]);
  }
  d.gargalo_critico = semPrefixo(d.gargalo_critico, "A validar");
  d.solucao_recomendada = semPrefixo(d.solucao_recomendada, "Proposta");
  const t = (v) => (typeof v === "string" ? v.trim() : "");
  return resposta({
    ok: true,
    blocos: ids,
    uso: r.uso,
    modelo: r.modelo,
    tentativas: r.tentativas,
    dossie: {
      status_presenca: t(d.status_presenca) || "Sem informação verificada nas fontes.",
      pontos_fortes: t(d.pontos_fortes),
      pontos_fracos: t(d.pontos_fracos),
      gargalo_critico: t(d.gargalo_critico),
      solucao_recomendada: t(d.solucao_recomendada),
      gancho_kickoff_gerado: t(d.gancho_kickoff_gerado),
      fontes: coleta.ok ? [{ titulo: "Site do lead", url: site }] : [],
      verificacao: { site: coleta.ok ? "lido" : coleta.motivo, citacoes: ver.total, descartadas: ver.camposAfetados.length },
      analise_ia: true,
      analisado_em: new Date().toISOString(),
    },
  });
}

if (typeof Deno !== "undefined" && Deno.serve) Deno.serve(handler);
