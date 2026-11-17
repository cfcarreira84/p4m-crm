// Testes do motor de Monte Carlo: pesos das matrizes B2B e B2C, prioridade da base, ordenação e modo assíncrono. Sem rede e sem banco.
//   node tools/testar_monte_carlo.mjs
import { createRequire } from "node:module";
import assert from "node:assert/strict";
const require = createRequire(import.meta.url);
globalThis.CockpitConfig = require("../web/assets/js/cockpit_config.js");
const MC = require("../web/assets/js/monte_carlo.js");

let ok = 0;
const t = (nome, fn) => { fn(); ok++; console.log("  ✔", nome); };
const p = (lead) => MC.calculateLeadProbability({
  status_kanban: "atendimento",
  discovery_interlocutor: "indefinido",
  discovery_potencial_negocio: "indefinido",
  discovery_inclinacao_parceria: "indefinido",
  discovery_demanda_imediata: "indefinido",
  discovery_encantamento_produtos: "indefinido",
  ...lead
});
const b2c = { cluster_estrategico: "B2C_Cliente_Final" }, b2b = { cluster_estrategico: "B2B_Comercial" };

t("B2C: comprador pesa mais que arquiteto, que pesa mais que representante", () => {
  const c = p({ ...b2c, discovery_interlocutor: "comprador" }), a = p({ ...b2c, discovery_interlocutor: "arquiteto" }), r = p({ ...b2c, discovery_interlocutor: "representante" }), n = p(b2c);
  assert.ok(c > a && a > n && n > r, `${c} ${a} ${n} ${r}`);
});
t("B2C: razão entre os pesos é a configurada (1,45 / 1,15 / 0,70)", () => {
  const n = p(b2c);
  assert.ok(Math.abs(p({ ...b2c, discovery_interlocutor: "comprador" }) / n - 1.45) < 1e-9);
  assert.ok(Math.abs(p({ ...b2c, discovery_interlocutor: "arquiteto" }) / n - 1.15) < 1e-9);
  assert.ok(Math.abs(p({ ...b2c, discovery_interlocutor: "representante" }) / n - 0.70) < 1e-9);
});
t("B2C: encantamento com os produtos (alto > médio > baixo) usa a coluna própria", () => {
  const a = p({ ...b2c, discovery_encantamento_produtos: "alto" }), m = p({ ...b2c, discovery_encantamento_produtos: "medio" }), b = p({ ...b2c, discovery_encantamento_produtos: "baixo" });
  assert.ok(a > m && m > b);
});
t("B2C ignora a inclinação de parceria (que é critério do B2B)", () => {
  assert.equal(p({ ...b2c, discovery_inclinacao_parceria: "alto" }), p(b2c));
});
t("B2B ignora o encantamento e segue com dono/sócio e parceria", () => {
  assert.equal(p({ ...b2b, discovery_encantamento_produtos: "alto" }), p(b2b));
  assert.ok(p({ ...b2b, discovery_interlocutor: "dono_socio" }) > p(b2b));
  assert.ok(p({ ...b2b, discovery_inclinacao_parceria: "alto" }) > p(b2b));
});
t("valor de interlocutor do outro tipo de cliente não pontua (cai no neutro)", () => {
  assert.equal(p({ ...b2c, discovery_interlocutor: "dono_socio" }), p(b2c));
  assert.equal(p({ ...b2b, discovery_interlocutor: "comprador" }), p(b2b));
});
t("ordenação: maior pontuação primeiro, mesmo quando a probabilidade exibida empata no teto de 95%", () => {
  const forte = { ...b2c, discovery_interlocutor: "comprador", discovery_encantamento_produtos: "alto", discovery_potencial_negocio: "curto_prazo", discovery_demanda_imediata: "sim", status_kanban: "oferta" };
  const quase = { ...forte, discovery_interlocutor: "arquiteto" };
  assert.equal(p(forte), 0.95); assert.equal(p(quase), 0.95);
  assert.ok(MC.compareLeads(forte, quase) < 0, "o de maior pontuação deve vir antes");
});
t("categorias: só o B2C usa a matriz própria", () => {
  const cats = CockpitConfig.categories;
  assert.deepEqual(cats.filter((c) => c.matriz === "b2c").map((c) => c.id), ["B2C_Cliente_Final"]);
  assert.deepEqual(CockpitConfig.matrizes.b2c.interlocutor.opcoes.map((o) => o[0]), ["comprador", "arquiteto", "representante"]);
  assert.equal(CockpitConfig.matrizes.b2c.afinidade.campo, "discovery_encantamento_produtos");
});

const asyncRes = await MC.simulatePipelineAsync([{ ...b2b, ticket_estimado: 10000, status_kanban: "proposta" }], 1000);
assert.ok(asyncRes.forecastPonderado > 0);
ok++;
console.log("  ✔ simulatePipelineAsync funciona com fallback síncrono em Node");

console.log(`\n${ok} verificações ok`);
