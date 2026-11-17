// Abre uma página no Chrome headless (relógio real) e espera o título começar com "RESULT".
import { spawn } from "node:child_process";
const [, , alvo, limiteS = "120"] = process.argv;
const chrome = spawn("C:/Program Files/Google/Chrome/Application/chrome.exe",
  ["--headless=new", "--disable-gpu", "--remote-debugging-port=9333", "--user-data-dir=" + process.env.TEMP + "/cdp-perfil", "about:blank"], { stdio: "ignore" });
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
try {
  let alvoInfo;
  for (let i = 0; i < 40 && !alvoInfo; i++) {
    await esperar(500);
    try { alvoInfo = await (await fetch("http://127.0.0.1:9333/json/new?" + encodeURIComponent(alvo), { method: "PUT" })).json(); } catch {}
  }
  const ws = new WebSocket(alvoInfo.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  let id = 0; const pend = new Map();
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); } };
  const avaliar = (expr) => new Promise((r) => { const n = ++id; pend.set(n, r); ws.send(JSON.stringify({ id: n, method: "Runtime.evaluate", params: { expression: expr } })); });
  const fim = Date.now() + Number(limiteS) * 1000;
  let titulo = "";
  while (Date.now() < fim) {
    titulo = (await avaliar("document.title")).result?.result?.value || "";
    if (titulo.startsWith("RESULT")) break;
    await esperar(1000);
  }
  console.log(titulo.startsWith("RESULT") ? titulo.slice(7) : "SEM RESULTADO: " + titulo);
} finally { chrome.kill(); }
