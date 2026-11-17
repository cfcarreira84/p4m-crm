import { EXT_CONFIG } from "./config.js";

const $ = (id) => document.getElementById(id);

const STATUS_LABELS = {
    idle: "Pronto",
    running: "Disparando",
    paused: "Pausado",
    completed: "Concluído",
    stopped: "Interrompido"
};

function renderProfiles(profiles, selected) {
    const sel = $("sel-perfil");
    sel.innerHTML = `<option value="todos">Todos os Perfis</option>`;
    (profiles || []).forEach((p) => {
        const opt = document.createElement("option");
        opt.value = p.id;
        opt.textContent = p.label;
        if (p.id === selected) opt.selected = true;
        sel.appendChild(opt);
    });
}

function renderState(state) {
    if (!state) return;
    $("sel-frente").value = state.frente || "p4m";
    $("sel-prioridade").value = state.prioridade || "todas";
    $("sel-msg-mode").value = state.msgMode || "ia";
    if (state.dailyLimit > 0) {
        $("inp-daily-limit").value = String(state.dailyLimit);
    }

    const total = (state.queue || []).length;
    const idx = Math.min(state.currentIndex || 0, total);
    $("queue-count").textContent = String(total);
    const rec = state.recommendedDaily ?? Math.min(total, 25);
    $("daily-rec-badge").textContent = `Recomendado: ${rec}/dia`;
    $("daily-sent-info").textContent = state.dailySentToday > 0 ? `(Hoje: ${state.dailySentToday})` : "";

    $("progress-text").textContent = `${idx}/${total}`;
    $("progress-fill").style.width = total > 0 ? `${Math.round((idx / total) * 100)}%` : "0%";
    $("stat-sent").textContent = String(state.sentCount || 0);
    $("stat-gmail").textContent = String((state.gmailQueue || []).length);
    $("stat-err").textContent = String((state.attentionList || []).length);

    const badge = $("batch-status-badge");
    badge.className = `status-pill status-${state.status || "idle"}`;
    badge.textContent = STATUS_LABELS[state.status] || "Pronto";

    $("countdown-label").textContent = state.countdownSec > 0 ? `Próx. em ${state.countdownSec}s` : "--";
    $("current-lead-line").textContent = state.currentLeadName
        ? `Atendendo: ${state.currentLeadName}`
        : state.status === "completed"
        ? "Lote finalizado."
        : state.status === "stopped"
        ? "Disparo interrompido pelo operador."
        : "Aguardando início do lote.";

    const running = state.status === "running";
    const paused = state.status === "paused";
    const dispatchReady = total > 0 || running || paused;
    $("section-dispatch").classList.toggle("section-disabled", !dispatchReady);
    $("btn-start").disabled = total === 0;
    $("btn-start").classList.toggle("hidden", running || paused);
    $("btn-pause").classList.toggle("hidden", !running);
    $("btn-resume").classList.toggle("hidden", !paused);
    $("btn-stop").classList.toggle("hidden", !running && !paused);

    const hasAudit = Boolean(state.auditSummary) || (state.gmailQueue || []).length > 0;
    $("section-audit").classList.toggle("hidden", !hasAudit);
    $("btn-run-gmail").classList.toggle("hidden", (state.gmailQueue || []).length === 0);

    if (hasAudit) {
        const a = state.auditSummary;
        const parts = [];
        if (a) {
            parts.push(`<div>Enviados no lote: <strong>${a.totalSent}</strong> | Sem resposta ainda: <strong>${a.awaitingReplyCount}</strong></div>`);
            if (a.awaitingReplyLeads?.length) {
                const names = a.awaitingReplyLeads.slice(0, 4).map((l) => l.nome).join(", ");
                parts.push(`<div class="muted">Aguardando retorno: ${names}${a.awaitingReplyLeads.length > 4 ? "..." : ""}</div>`);
            }
        }
        if ((state.gmailQueue || []).length > 0) {
            parts.push(`<div class="text-warn">Fila Fallback Gmail: <strong>${state.gmailQueue.length}</strong> contato(s) sem WhatsApp com e-mail válido.</div>`);
        }
        if ((state.attentionList || []).length > 0) {
            parts.push(`<div class="text-err">Movidos para Atenção: <strong>${state.attentionList.length}</strong> contato(s).</div>`);
        }
        parts.push(`<a href="${EXT_CONFIG.crmUrl}" target="_blank" style="color:#93C5FD;text-decoration:underline;">Revisar cartões no P4m CRM &rarr;</a>`);
        $("audit-summary").innerHTML = parts.join("");
    }

    const logBox = $("log-list");
    logBox.innerHTML = "";
    (state.logs || []).forEach((l) => {
        const div = document.createElement("div");
        div.className = `log-item ${l.level || "info"}`;
        div.innerHTML = `<span class="mono muted">[${l.time}]</span> ${l.text}`;
        logBox.appendChild(div);
    });
}

function showView(authenticated, session, state, profiles) {
    $("view-login").classList.toggle("hidden", authenticated);
    $("view-main").classList.toggle("hidden", !authenticated);
    $("user-pill").classList.toggle("hidden", !authenticated);
    if (authenticated && session) {
        $("operator-name").textContent = session.user?.name || session.user?.email || "Operador";
        renderProfiles(profiles, state?.perfil);
        renderState(state);
    }
}

async function refreshQueue() {
    const res = await chrome.runtime.sendMessage({
        type: "LOAD_QUEUE",
        frente: $("sel-frente").value,
        prioridade: $("sel-prioridade").value,
        perfil: $("sel-perfil").value
    });
    if (res?.profiles) renderProfiles(res.profiles, $("sel-perfil").value);
    if (res?.ok === false && res?.error) {
        $("current-lead-line").textContent = `Erro ao carregar fila: ${res.error}`;
    }
    if (typeof res?.count === "number") {
        $("queue-count").textContent = String(res.count);
        const rec = res.recommendedDaily ?? Math.min(res.count, 25);
        $("daily-rec-badge").textContent = `Recomendado: ${rec}/dia`;
        $("section-dispatch").classList.toggle("section-disabled", res.count === 0);
        $("btn-start").disabled = res.count === 0;
    }
    if (typeof res?.dailySentToday === "number" && res.dailySentToday > 0) {
        $("daily-sent-info").textContent = `(Hoje: ${res.dailySentToday})`;
    }
}

async function init() {
    $("ext-version").textContent = EXT_CONFIG.version;
    $("link-crm").href = EXT_CONFIG.crmUrl;
    const initRes = await chrome.runtime.sendMessage({ type: "GET_INIT" });
    showView(Boolean(initRes?.session), initRes?.session, initRes?.state, initRes?.profiles);
    if (initRes?.session && initRes?.state?.status === "idle") {
        await refreshQueue();
    }
}

$("form-login").addEventListener("submit", async (e) => {
    e.preventDefault();
    $("login-error").classList.add("hidden");
    $("btn-login").disabled = true;
    const res = await chrome.runtime.sendMessage({
        type: "LOGIN",
        email: $("login-email").value,
        password: $("login-password").value
    });
    $("btn-login").disabled = false;
    if (!res?.ok) {
        $("login-error").textContent = res?.error || "Usuário ou senha inválidos.";
        $("login-error").classList.remove("hidden");
        return;
    }
    await init();
});

$("btn-logout").addEventListener("click", async () => {
    await chrome.runtime.sendMessage({ type: "LOGOUT" });
    showView(false);
});

$("sel-frente").addEventListener("change", refreshQueue);
$("sel-prioridade").addEventListener("change", refreshQueue);
$("sel-perfil").addEventListener("change", refreshQueue);
$("btn-refresh-queue").addEventListener("click", refreshQueue);

// Termo de ciência e responsabilidade antes de iniciar
$("btn-start").addEventListener("click", () => {
    $("chk-accept-risk").checked = false;
    $("btn-confirm-risk").disabled = true;
    $("modal-disclaimer").classList.remove("hidden");
});

$("chk-accept-risk").addEventListener("change", (e) => {
    $("btn-confirm-risk").disabled = !e.target.checked;
});

$("btn-cancel-risk").addEventListener("click", () => {
    $("modal-disclaimer").classList.add("hidden");
});

$("btn-confirm-risk").addEventListener("click", async () => {
    $("modal-disclaimer").classList.add("hidden");
    const res = await chrome.runtime.sendMessage({
        type: "START_BATCH",
        frente: $("sel-frente").value,
        prioridade: $("sel-prioridade").value,
        perfil: $("sel-perfil").value,
        msgMode: $("sel-msg-mode").value,
        dailyLimit: parseInt($("inp-daily-limit").value, 10) || 0
    });
    if (!res?.ok && res?.error) {
        $("current-lead-line").textContent = res.error;
    }
});

$("btn-pause").addEventListener("click", () => chrome.runtime.sendMessage({ type: "PAUSE_BATCH" }));
$("btn-resume").addEventListener("click", () => chrome.runtime.sendMessage({ type: "RESUME_BATCH" }));
$("btn-stop").addEventListener("click", () => chrome.runtime.sendMessage({ type: "STOP_BATCH" }));

$("btn-run-gmail").addEventListener("click", async () => {
    $("btn-run-gmail").disabled = true;
    await chrome.runtime.sendMessage({ type: "RUN_GMAIL_FALLBACK" });
    $("btn-run-gmail").disabled = false;
});

$("btn-sync-chat").addEventListener("click", async () => {
    const res = await chrome.runtime.sendMessage({ type: "SYNC_ACTIVE_CHAT" });
    $("current-lead-line").textContent = res?.ok
        ? `Sync: ${res.synced} nova(s) mensagem(ns) (${res.leadName || "contato"}).`
        : "Nenhuma mensagem nova ou chat não vinculado.";
});

chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type === "STATE_UPDATED") {
        renderState(msg.state);
    }
});

init();
