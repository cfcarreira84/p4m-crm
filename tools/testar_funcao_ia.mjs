// Teste local da Edge Function `ia` sob Node (sem Deno): seleção de blocos, segurança de perfis,
// extração dinâmica de persona/regras, dados_segmento e rotação de modelos Gemini.
//   node tools/testar_funcao_ia.mjs [--real]
import { readFileSync, existsSync } from "node:fs";
import assert from "node:assert/strict";

const raiz = new URL("../", import.meta.url);
const blocos = JSON.parse(readFileSync(new URL("database/conhecimento/blocos.json", raiz), "utf8"));
const real = process.argv.includes("--real");

const envPath = new URL("database/.env", raiz);
const envArq = existsSync(envPath)
  ? Object.fromEntries(readFileSync(envPath, "utf8").split(/\r?\n/)
      .filter((l) => l.includes("=") && !l.startsWith("#")).map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")]; }))
  : {};
process.env.SUPABASE_URL = "https://exemplo.supabase.co";
process.env.SUPABASE_ANON_KEY = "anon-de-teste";
if (real && envArq.GEMINI_API_KEY) process.env.GEMINI_KEY = envArq.GEMINI_API_KEY;

const { selecionarBlocos, montarPromptMensagem, handler, coletarSite, verificarCitacoes, limparCitacoes, semPrefixo, extrairDiretrizes } = await import(new URL("supabase/functions/ia/index.ts", raiz));
const ids = (l) => l.map((b) => b.id);
const palavras = (l) => l.reduce((n, b) => n + b.conteudo.split(/\s+/).length, 0);
let ok = 0;
const t = (nome, fn) => { fn(); ok++; console.log("  ✔", nome); };

console.log("Seleção de blocos e diretrizes dinâmicas");
t("extrairDiretrizes lê persona e regras dos blocos nucleo-persona e nucleo-regras e os separa dos restantes", () => {
  const dir = extrairDiretrizes(blocos, { marca: "Marca Teste" });
  assert.equal(dir.marca, "Marca Teste");
  assert.ok(dir.persona.length > 20);
  assert.ok(dir.regras.length > 20);
  assert.ok(!ids(dir.restantes).includes("nucleo-persona") && !ids(dir.restantes).includes("nucleo-regras"));
});
t("perfil comercial/parceiros vê programas e playbook, nunca custos de revenda", () => {
  const { restantes } = extrairDiretrizes(blocos);
  const s = ids(selecionarBlocos(restantes, { perfil: "B2B_Comercial", fase: "atendimento", texto: "qual a margem e o preço?" }));
  for (const esperado of ["marca-resumo", "programa-parceria", "playbook-b2b-comercial"]) assert.ok(s.includes(esperado), esperado);
  for (const proibido of ["restrito-revenda-margem", "playbook-b2b-revenda", "playbook-b2b-parceiros"]) assert.ok(!s.includes(proibido), proibido);
});
t("revenda vê condições restritas só quando o texto pergunta de margem", () => {
  const { restantes } = extrairDiretrizes(blocos);
  assert.ok(ids(selecionarBlocos(restantes, { perfil: "B2B_Revenda", fase: "atendimento", texto: "qual a margem?" })).includes("restrito-revenda-margem"));
  assert.ok(!ids(selecionarBlocos(restantes, { perfil: "B2B_Revenda", fase: "atendimento", texto: "bom dia" })).includes("restrito-revenda-margem"));
  assert.ok(ids(selecionarBlocos(restantes, { perfil: "B2B_Revenda", fase: "atendimento", texto: "bom dia" })).includes("playbook-b2b-revenda"));
});
t("especificadores/parceiros recebem programas e playbook próprio", () => {
  const { restantes } = extrairDiretrizes(blocos);
  const s = ids(selecionarBlocos(restantes, { perfil: "B2B_Parceiros", fase: "atendimento", texto: "" }));
  assert.ok(s.includes("programa-parceria") && s.includes("playbook-b2b-parceiros"));
});
t("produtos entram por palavra da conversa (no máximo 3)", () => {
  const { restantes } = extrairDiretrizes(blocos);
  const s = ids(selecionarBlocos(restantes, { perfil: "B2B_Comercial", fase: "atendimento", texto: "Preciso do modelo compacto sob bancada e também da linha profissional para o condomínio" }));
  assert.ok(s.includes("prod-solucao-compacta") && s.includes("prod-solucao-corporativa"));
  assert.ok(s.filter((i) => i.startsWith("prod-")).length <= 3);
  assert.ok(!ids(selecionarBlocos(restantes, { perfil: "B2B_Comercial", fase: "atendimento", texto: "bom dia" })).includes("prod-solucao-compacta"));
});
t("palavra curta não casa dentro de outra (kit x arquiteto)", () => {
  assert.ok(!ids(selecionarBlocos([{ id: "x", tipo: "produto", titulo: "x", conteudo: "x", palavras: ["kit"] }], { perfil: "B2B_Comercial", fase: "a", texto: "o escritório de arquitetura" })).includes("x"));
});
t("depoimentos/prova social só nas fases de decisão", () => {
  const { restantes } = extrairDiretrizes(blocos);
  assert.ok(ids(selecionarBlocos(restantes, { perfil: "B2B_Comercial", fase: "proposta", texto: "" })).includes("prova-social-cases"));
  assert.ok(!ids(selecionarBlocos(restantes, { perfil: "B2B_Comercial", fase: "atendimento", texto: "" })).includes("prova-social-cases"));
});
for (const [rot, texto] of [["primeira abordagem", ""], ["conversa sobre produto e medida", "compacto medida condominio lazer"]]) {
  const { restantes } = extrairDiretrizes(blocos);
  const sel = selecionarBlocos(restantes, { perfil: "B2B_Comercial", fase: "atendimento", texto });
  console.log(`  · ${rot}: ${sel.length} blocos, ~${Math.round(palavras(sel) * 1.7)} tokens de conhecimento (todos: ~${Math.round(palavras(blocos) * 1.7)})`);
}

console.log("Verificação de fontes");
t("citação inventada é detectada e a verdadeira passa", () => {
  const corpus = "Estúdio Alpha Projetos residenciais de alto padrão Residencial Sol Condomínio San Pedro, Itapira, SP.";
  const v = verificarCitacoes({
    pontos_fortes: 'Obra em condomínio (site: "Condomínio San Pedro, Itapira, SP"). Também a (site: "Residência G.A").',
    pontos_fracos: "Sem informação verificada nas fontes.",
  }, corpus, corpus);
  assert.equal(v.total, 2);
  assert.deepEqual(v.invalidas, ["Residência G.A"]);
  assert.deepEqual(v.camposAfetados, ["pontos_fortes"]);
});
t("citação rotulada (site) que só existe em outra fonte é recusada", () => {
  const v = verificarCitacoes({ pontos_fortes: 'Casas em "madeira, concreto e pedra" (site).' }, "madeira, concreto e pedra (pesquisa prévia) Residencial Sol", "Residencial Sol Itapira");
  assert.deepEqual(v.invalidas, ["madeira, concreto e pedra"]);
  const w = verificarCitacoes({ pontos_fortes: 'Casas em "madeira, concreto e pedra" (pesquisa prévia).' }, "madeira, concreto e pedra (pesquisa prévia)", "Residencial Sol");
  assert.equal(w.invalidas.length, 0);
});
t("pontuação e acento diferentes não geram falso alarme", () => {
  assert.equal(verificarCitacoes({ pontos_fortes: '(site: "condominio san pedro itapira sp")' }, "Condomínio San Pedro, Itapira, SP.", "Condomínio San Pedro, Itapira, SP.").invalidas.length, 0);
});
for (const u of ["http://localhost/x", "http://127.0.0.1/", "http://192.168.0.10/", "http://10.1.2.3/", "http://169.254.169.254/latest", "http://servidor/", "file:///etc/passwd", "ftp://a.com/"]) {
  const r = await coletarSite(u); assert.equal(r.ok, false, u); assert.equal(r.motivo, "url_invalida", u);
}
ok++; console.log("  ✔ 8 endereços internos ou inválidos recusados (SSRF guard)");

console.log("Limpeza do texto para leitura");
t("remove marcadores de fonte sem perder o conteúdo", () => {
  const sujo = 'O estúdio LN é liderado por Laura (site: "LN · Laura"), com sede em Campinas, SP (site: "Campinas, SP"). Atua com "Projetos residenciais" (site: "Projetos residenciais") focados em condomínios (site: "Condomínios em todo o Brasil.").';
  const limpo = limparCitacoes(sujo);
  assert.ok(!/\(site/i.test(limpo), limpo);
  assert.ok(limpo.includes("com sede em Campinas, SP.") && limpo.endsWith("focados em condomínios."), limpo);
  assert.equal(limparCitacoes("Atuação no nicho (site) e obras (contexto do operador)."), "Atuação no nicho e obras.");
  assert.equal(limparCitacoes("Texto (com parênteses normais) fica."), "Texto (com parênteses normais) fica.");
});
t("remove prefixos que o rótulo da tela já mostra", () => {
  assert.equal(semPrefixo("A validar: como a equipe alinha medidas", "A validar"), "como a equipe alinha medidas");
  assert.equal(semPrefixo("Proposta: Apresentar a linha principal", "Proposta"), "Apresentar a linha principal");
  assert.equal(semPrefixo("  A validar : como a equipe", "A validar"), "como a equipe");
  assert.equal(semPrefixo("Propostas de valor claras", "Proposta"), "Propostas de valor claras");
});

console.log("Prévia da mensagem: retomada do funil e marca dinâmica");
t("o prompt mira a retomada, usa dossiê, valor, notas, conversa e a marca informada", () => {
  const lead = {
    nome_fantasia: "Neto",
    cluster_estrategico: "B2C_Projeto_Pessoal",
    ticket_estimado: 114880,
    notas_operador: null,
    pre_analise_scout: {
      status_presenca: "Cliente final com projeto pessoal",
      pontos_fracos: "Interrupção por viagem",
      gargalo_critico: "A validar: retorno",
      analise_complementar: { solucao_recomendada: "Partir pela Linha Principal" }
    },
    timeline: [
      { tipo: "nota_operador", direcao: "system", autor: "Operador 1", texto: "Cliente comparou com concorrente", iso: "2026-11-01T12:00:00Z" },
      { tipo: "whatsapp_outbound", direcao: "outbound", autor: "Operador 1", texto: "Enviei a proposta comercial", iso: "2026-11-02T12:00:00Z" }
    ]
  };
  const p = montarPromptMensagem(lead, { marca: "Marca Demo", operador: "Operador 1", etapaLabel: "Ativado", aiGoal: "Retomar", proximaEtapaLabel: "Atendimento", categoriaLabel: "B2C • Projeto Pessoal" }, blocos);
  for (const trecho of [
    "retomar a conversa com este lead e dar sequência ao funil",
    "próxima fase (Atendimento)",
    "Valor do pedido (estimativa interna",
    "114.880",
    "Pontos de atenção levantados: Interrupção por viagem",
    "Soluções já sugeridas pela análise",
    "Cliente comparou com concorrente",
    "A última mensagem foi do lado de Marca Demo",
    "retome por algo NOVO",
    "UM próximo passo claro",
    "nunca use informação pessoal"
  ]) assert.ok(p.includes(trecho), trecho);
});

console.log("Handler e Rotação de Modelos");
const lead = {
  nome_fantasia: "Construtora Horizonte",
  cluster_estrategico: "B2B_Principal",
  website_original: "https://exemplo-horizonte.com.br/",
  discovery_interlocutor: "indefinido",
  discovery_potencial_negocio: "indefinido",
  discovery_inclinacao_parceria: "indefinido",
  discovery_demanda_imediata: "indefinido",
  notas_operador: null,
  dados_segmento: { empreendimentos: "Residencial Parque das Águas", lote: "P01" },
  pre_analise_scout: {
    perfil_projetos: "Construtora de condomínios residenciais de alto padrão",
    obras_referencia: "Residencial Parque das Águas",
    argumento_prioritario: "Atendimento direto de fábrica"
  },
  timeline: [
    { tipo: "whatsapp_inbound", direcao: "inbound", autor: "+55 19 98888-7777", texto: "Qual o prazo de entrega para Campinas?", iso: "2026-10-29T21:48:00Z" },
    { tipo: "whatsapp_inbound", direcao: "outbound", autor: "Operador 1", texto: "Entregamos com frota própria na região", iso: "2026-10-29T21:48:00Z" },
    { tipo: "nota_operador", direcao: "system", autor: "Operador 1", texto: "Cliente quer cotação para 2 condomínios", iso: "2026-11-03T14:00:00Z" },
  ],
};
const ctx = {
  marca: "Marca Demo",
  contato: "",
  etapaId: "atendimento",
  etapaLabel: "Atendimento",
  aiGoal: "Responder o que o contato perguntou por último, com precisão técnica.",
  categoriaLabel: "B2B • Perfil Principal",
  operador: "Operador 1",
  siteUrl: "",
  historico: ""
};

const original = globalThis.fetch;
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url);
  if (u.includes("/auth/v1/user")) return new Response("{}", { status: opts.headers?.Authorization === "Bearer valido" ? 200 : 401 });
  if (u.includes("/rest/v1/base_conhecimento")) return new Response(JSON.stringify(blocos), { status: 200 });
  if (u.includes("generativelanguage")) return real ? original(url, opts) : new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({ mensagem: "ok" }) }] } }], usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1 } }), { status: 200 });
  return original(url, opts);
};
const post = (corpo, auth = "Bearer valido") => handler(new Request("https://f/ia", { method: "POST", headers: { Authorization: auth, "Content-Type": "application/json" }, body: JSON.stringify(corpo) }));

{
  const r = await post({ acao: "mensagem", lead, ctx }, "Bearer invalido");
  assert.equal(r.status, 401); ok++; console.log("  ✔ recusa usuário sem sessão válida (401)");
}
{
  const r = await post({ acao: "outra", lead, ctx });
  assert.equal(r.status, 400); ok++; console.log("  ✔ recusa entrada inválida (400)");
}
{
  // cota é por modelo: se o primeiro estoura (429) ou está instável (503), a função segue para o próximo
  const usados = [];
  const base = globalThis.fetch;
  const rodar = async (planos) => {
    usados.length = 0;
    globalThis.fetch = async (url, opts = {}) => {
      const u = String(url);
      if (u.includes("generativelanguage")) {
        const modelo = u.match(/models\/([^:]+):/)[1]; usados.push(modelo);
        const plano = planos[modelo] ?? 200;
        return plano === 200 ? new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({ mensagem: "ok via " + modelo }) }] } }] }), { status: 200 }) : new Response("{}", { status: plano });
      }
      return base(url, opts);
    };
    const r = await post({ acao: "mensagem", lead, ctx });
    globalThis.fetch = base;
    return { status: r.status, ...(await r.json()) };
  };
  process.env.GEMINI_KEY = process.env.GEMINI_KEY || "chave-de-teste";
  const m1 = await rodar({ "gemini-3-flash-preview": 429 });
  assert.equal(m1.ok, true); assert.equal(m1.modelo, "gemini-2.5-pro"); assert.deepEqual(usados, ["gemini-3-flash-preview", "gemini-2.5-pro"]);
  ok++; console.log("  ✔ cota estourada no 1º modelo: usa o 2º com calibragem de qualidade");
  const m2 = await rodar({ "gemini-3-flash-preview": 503, "gemini-2.5-pro": 429 });
  assert.equal(m2.ok, true); assert.equal(m2.modelo, "gemini-2.5-flash");
  ok++; console.log("  ✔ 503 repete uma vez e depois passa ao próximo modelo (" + usados.join(" > ") + ")");
  const m3 = await rodar({ "gemini-3-flash-preview": 429, "gemini-2.5-pro": 429, "gemini-2.5-flash": 429, "gemini-3.1-flash-lite-preview": 429, "gemini-2.5-flash-lite": 429 });
  assert.equal(m3.ok, false); assert.equal(m3.motivo, "cota"); assert.equal(usados.length, 5);
  ok++; console.log("  ✔ todos sem cota: devolve motivo 'cota' (5 modelos testados em cascata)");
}
{
  // 100% dos campos do cartão entram em mensagem e análise
  const leadFull = {
    nome_fantasia: "Empresa Alfa",
    razao_social: "Alfa Serviços Ltda",
    cidade: "Campinas",
    bairro: "Cambuí",
    cluster_estrategico: "B2B_Principal",
    ticket_estimado: 4500,
    notas_operador: "Nota direta legada no cartão",
    proxima_mensagem_customizada: "Rascunho do operador",
    data_reativacao_programada: "2026-12-01",
    email_contato: "contato@alfa.com.br",
    instagram_url: "https://instagram.com/alfa",
    pre_analise_scout: { status_presenca: "Ativa" },
    timeline: []
  };
  const pm = montarPromptMensagem(leadFull, ctx, blocos);
  for (const snippet of ["Alfa Serviços Ltda", "Campinas • Cambuí", "Nota direta legada no cartão", "Rascunho do operador", "2026-12-01", "contato@alfa.com.br", "https://instagram.com/alfa"]) {
    assert.ok(pm.includes(snippet), `montarPromptMensagem faltou campo: ${snippet}`);
  }
  ok++; console.log("  ✔ 100% dos campos do cartão entram no prompt da IA");
}
{
  // dados_segmento entram na pesquisa prévia da análise
  const base = globalThis.fetch;
  let promptEnviado = "";
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url);
    if (u.includes("generativelanguage")) {
      promptEnviado = JSON.parse(opts.body).contents[0].parts[0].text;
      return new Response(JSON.stringify({
        candidates: [{
          content: {
            parts: [{
              text: JSON.stringify({
                status_presenca: "ok",
                pontos_fortes: "Sem informação verificada nas fontes.",
                pontos_fracos: "Sem informação verificada nas fontes.",
                gargalo_critico: "A validar: cronograma de compras (pesquisa prévia)",
                solucao_recomendada: "Proposta: Linha Principal.",
                gancho_kickoff_gerado: ""
              })
            }]
          }
        }]
      }), { status: 200 });
    }
    return base(url, opts);
  };
  const daBase = {
    nome_fantasia: "Construtora Horizonte",
    cluster_estrategico: "B2B_Principal",
    website_original: "",
    timeline: [],
    dados_segmento: { empreendimentos: "Residencial Parque das Águas, Residencial Sol", avaliacao_maps: "4.9" },
    pre_analise_scout: {
      origem: "carga:lote_2026-11-08",
      perfil_projetos: "Condomínios horizontais e verticais em Campinas e região com área de lazer completa",
      mini_bio: "Mais de 15 anos de atuação no mercado imobiliário regional."
    }
  };
  const comp = await (await post({ acao: "analise", lead: daBase, ctx })).json();
  assert.equal(comp.ok, true);
  assert.ok(promptEnviado.includes("Residencial Parque das Águas") && promptEnviado.includes("Dado do segmento (avaliacao_maps): 4.9"));
  assert.equal(comp.dossie.gargalo_critico, "cronograma de compras");
  ok++; console.log("  ✔ dados_segmento entram na pesquisa prévia e alimentam a análise da IA");
  globalThis.fetch = base;
}

globalThis.fetch = original;
console.log(`\n${ok} verificações ok`);
