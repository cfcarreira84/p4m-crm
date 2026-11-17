// Teste de ponta a ponta da Edge Function `ia` JÁ PUBLICADA no Supabase, com login real de operador.
//   node tools/testar_funcao_publicada.mjs
// Lê database/.env e project.config.json (nenhum segredo é impresso). Gasta 2 chamadas de IA.
import { readFileSync } from "node:fs";

const env = Object.fromEntries(readFileSync(new URL("../database/.env", import.meta.url), "utf8").split(/\r?\n/)
  .filter((l) => l.includes("=") && !l.startsWith("#")).map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")]; }));
const cfg = JSON.parse(readFileSync(new URL("../project.config.json", import.meta.url), "utf8"));
const url = env.SUPABASE_URL;

const opEmail = env.OPERATOR_1_EMAIL || (cfg.brand?.operators?.[0]?.email);
const login = await fetch(`${url}/auth/v1/token?grant_type=password`, {
  method: "POST",
  headers: { apikey: env.SUPABASE_ANON_KEY, "Content-Type": "application/json" },
  body: JSON.stringify({ email: opEmail, password: env.OPERATOR_PASSWORD }),
});
if (!login.ok) { console.log("login falhou:", login.status); process.exit(1); }
const token = (await login.json()).access_token;
console.log("login do operador: ok");

const chamar = async (corpo) => {
  const t0 = Date.now();
  const r = await fetch(`${url}/functions/v1/ia`, {
    method: "POST",
    headers: { apikey: env.SUPABASE_ANON_KEY, Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(corpo)
  });
  const j = await r.json().catch(() => ({}));
  return { status: r.status, ms: Date.now() - t0, ...j };
};

const lead = {
  nome_fantasia: "Empresa Exemplo",
  cluster_estrategico: "B2B_Principal",
  website_original: "",
  discovery_interlocutor: "indefinido",
  discovery_potencial_negocio: "indefinido",
  discovery_inclinacao_parceria: "indefinido",
  discovery_demanda_imediata: "indefinido",
  pre_analise_scout: {
    perfil_projetos: "Empresa atuante em projetos residenciais e corporativos na região de Campinas",
    obras_referencia: "Condomínio Primavera",
    argumento_prioritario: "Atendimento direto de fábrica"
  },
  timeline: [
    { tipo: "whatsapp_inbound", direcao: "inbound", autor: "+55 19 98888-7777", texto: "Vocês entregam em Campinas?", iso: "2026-10-29T21:47:00Z" },
    { tipo: "whatsapp_inbound", direcao: "outbound", autor: "Operador 1", texto: "Sim, atendemos toda a região com entrega própria", iso: "2026-10-29T21:48:00Z" },
  ],
};
const ctx = {
  marca: cfg.brand?.companyName || "Sua Marca",
  contato: "",
  etapaId: "atendimento",
  etapaLabel: "Atendimento",
  aiGoal: "Responder o que o contato perguntou por último, com precisão técnica.",
  categoriaLabel: "B2B • Perfil Principal",
  operador: cfg.brand?.operators?.[0]?.name || "Operador 1",
  siteUrl: "",
  historico: ""
};

const m = await chamar({ acao: "mensagem", lead, ctx });
console.log(`\nmensagem -> HTTP ${m.status} em ${m.ms} ms | ok=${m.ok} | modelo=${m.modelo} | tokens ${m.uso?.entrada}/${m.uso?.saida} | ${m.blocos?.length} blocos`);
console.log(m.ok ? ">> " + m.texto : "motivo: " + m.motivo + " " + (m.detalhe || ""));

const a = await chamar({
  acao: "analise",
  lead: { ...lead, timeline: [] },
  ctx: { ...ctx, etapaId: "aguardando_contato", etapaLabel: "Aguardando Contato", historico: "Empresa com mais de 15 anos de atuação em projetos residenciais e condomínios na região metropolitana, buscando fornecedores diretos de fábrica." }
});
console.log(`\nanálise -> HTTP ${a.status} em ${a.ms} ms | ok=${a.ok} | modelo=${a.modelo} | tokens ${a.uso?.entrada}/${a.uso?.saida}`);
if (a.ok && a.dossie) {
  console.log("verificação:", JSON.stringify(a.dossie.verificacao));
  for (const k of ["status_presenca", "pontos_fortes", "pontos_fracos", "gargalo_critico", "solucao_recomendada"]) console.log(`- ${k}: ${a.dossie[k]}`);
} else console.log("motivo:", a.motivo || a.mensagem, a.detalhe || "");

const sem = await fetch(`${url}/functions/v1/ia`, { method: "POST", headers: { apikey: env.SUPABASE_ANON_KEY, "Content-Type": "application/json" }, body: "{}" });
console.log(`\nsem login -> HTTP ${sem.status} (esperado 401)`);
