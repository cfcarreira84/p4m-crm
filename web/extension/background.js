/**
 * ==============================================================================
 * P/CRM EXTENSION — SERVICE WORKER (background.js)
 * ==============================================================================
 */
import { EXT_CONFIG } from "./config.js";
import {
    signInWithPassword,
    clearSession,
    adoptExternalSession,
    refreshSessionIfNeeded,
    fetchInitialQueue,
    fetchDistinctProfiles,
    getDailySentCount,
    incrementDailySentCount,
    updateLead,
    insertInteraction,
    fetchRecentInteractions,
    findLeadByPhone,
    fetchAuditLeads,
    generateApproachViaIA,
    normalizePhoneDigits
} from "./supabase_api.js";

const STATE_KEY = "pcrm_batch_state";

const defaultState = () => ({
    status: "idle", // idle | running | paused | completed | stopped
    frente: "p4m",
    prioridade: "todas",
    perfil: "todos",
    dailyLimit: 0, // 0 = recomendação automática do sistema
    recommendedDaily: 0,
    dailySentToday: 0,
    msgMode: "ia", // ia | saved
    queue: [],
    currentIndex: 0,
    currentLeadName: "",
    countdownSec: 0,
    dispatchedIds: [],
    sentCount: 0,
    errorCount: 0,
    gmailQueue: [],
    attentionList: [],
    auditSummary: null,
    logs: []
});

let state = defaultState();
let loopActive = false;

async function loadState() {
    const res = await chrome.storage.local.get(STATE_KEY);
    if (res[STATE_KEY]) {
        state = { ...defaultState(), ...res[STATE_KEY] };
        if (state.status === "running") {
            state.status = "paused";
        }
    }
}
loadState();

async function saveAndBroadcast() {
    await chrome.storage.local.set({ [STATE_KEY]: state });
    chrome.runtime.sendMessage({ type: "STATE_UPDATED", state }).catch(() => {});
}

function addLog(text, level = "info") {
    const now = new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    state.logs = [{ time: now, level, text }, ...(state.logs || [])].slice(0, 40);
}

function formatDateTimeBR(date = new Date()) {
    const dd = String(date.getDate()).padStart(2, "0");
    const mm = String(date.getMonth() + 1).padStart(2, "0");
    const yyyy = date.getFullYear();
    const hh = String(date.getHours()).padStart(2, "0");
    const min = String(date.getMinutes()).padStart(2, "0");
    return `${dd}/${mm}/${yyyy}, ${hh}:${min}`;
}

function computeRecommendedDaily(totalEligible) {
    if (!totalEligible || totalEligible <= 0) return 0;
    return Math.min(totalEligible, 25);
}

async function tryAdoptSessionFromCrmTab() {
    try {
        const tabs = await chrome.tabs.query({ url: "https://per4media.com.br/crm*" });
        for (const tab of tabs) {
            const results = await chrome.scripting.executeScript({
                target: { tabId: tab.id },
                func: () => {
                    for (let i = 0; i < localStorage.length; i++) {
                        const k = localStorage.key(i);
                        if (k && /^sb-.*-auth-token$/.test(k)) {
                            try {
                                return JSON.parse(localStorage.getItem(k) || "null");
                            } catch {
                                return null;
                            }
                        }
                    }
                    return null;
                }
            });
            const raw = results?.[0]?.result;
            if (raw && raw.access_token) {
                const adopted = await adoptExternalSession(raw);
                if (adopted) return adopted;
            }
        }
    } catch {
        // Sem aba do P/CRM aberta ou sem acesso ao storage
    }
    return null;
}

async function ensureCrmTabOpen() {
    const tabs = await chrome.tabs.query({ url: "https://per4media.com.br/crm*" });
    if (tabs.length === 0) {
        await chrome.tabs.create({ url: EXT_CONFIG.crmUrl, active: false });
    }
}

async function getOrOpenWhatsAppTab() {
    const tabs = await chrome.tabs.query({ url: "https://web.whatsapp.com/*" });
    if (tabs.length > 0) {
        await chrome.tabs.update(tabs[0].id, { active: true });
        return tabs[0];
    }
    const created = await chrome.tabs.create({ url: "https://web.whatsapp.com/", active: true });
    await new Promise((resolve) => {
        const listener = (tabId, info) => {
            if (tabId === created.id && info.status === "complete") {
                chrome.tabs.onUpdated.removeListener(listener);
                setTimeout(resolve, 3500);
            }
        };
        chrome.tabs.onUpdated.addListener(listener);
        setTimeout(resolve, 12000);
    });
    return created;
}

async function sendToWhatsAppTab(tabId, message) {
    try {
        return await chrome.tabs.sendMessage(tabId, message);
    } catch {
        await chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] });
        await new Promise((r) => setTimeout(r, 600));
        return await chrome.tabs.sendMessage(tabId, message);
    }
}

async function resolveMessageForLead(lead, frenteId, msgMode, estiloIndice) {
    const saved = (lead.proxima_mensagem_customizada || lead.pre_analise_scout?.gancho_kickoff_gerado || "").trim();
    if (msgMode === "saved" && saved) {
        return { ok: true, mensagem: saved, source: "prévia salva" };
    }
    const iaRes = await generateApproachViaIA(lead, frenteId, { estiloIndice });
    if (iaRes.ok) {
        return { ok: true, mensagem: iaRes.mensagem, source: `IA (${iaRes.modelo || "gemini"})` };
    }
    if (saved) {
        return { ok: true, mensagem: saved, source: "fallback prévia salva" };
    }
    return { ok: false, error: iaRes.error || "Sem mensagem disponível" };
}

async function waitCountdown(seconds) {
    state.countdownSec = seconds;
    await saveAndBroadcast();
    while (state.countdownSec > 0) {
        if (state.status === "stopped") return false;
        if (state.status === "paused") {
            await new Promise((r) => setTimeout(r, 500));
            continue;
        }
        await new Promise((r) => setTimeout(r, 1000));
        if (state.status === "running") {
            state.countdownSec = Math.max(0, state.countdownSec - 1);
            await saveAndBroadcast();
        }
    }
    return state.status === "running";
}

async function runPostBatchAudit() {
    const leads = await fetchAuditLeads(state.frente, state.dispatchedIds);
    const awaitingReply = leads.filter((l) => l.status_kanban === EXT_CONFIG.stages.nextAfterDispatch);
    state.auditSummary = {
        finishedAt: new Date().toISOString(),
        totalSent: state.sentCount,
        awaitingReplyCount: awaitingReply.length,
        awaitingReplyLeads: awaitingReply.map((l) => ({ id: l.id, nome: l.nome_fantasia })),
        gmailPendingCount: state.gmailQueue.length,
        attentionCount: state.attentionList.length
    };
    await saveAndBroadcast();

    chrome.notifications.create(`pcrm-audit-${Date.now()}`, {
        type: "basic",
        iconUrl: "icons/icon128.png",
        title: "P4m CRM — Lote Concluído",
        message: `Enviados: ${state.sentCount} | Aguardando resposta: ${awaitingReply.length} | Fallback Gmail: ${state.gmailQueue.length} | Atenção: ${state.attentionList.length}`
    });
}

async function processBatchLoop() {
    if (loopActive) return;
    loopActive = true;

    try {
        const session = await refreshSessionIfNeeded();
        const operatorName = session?.user?.name || "Carlos";

        while (state.currentIndex < state.queue.length) {
            if (state.status === "stopped") break;
            if (state.status === "paused") {
                await new Promise((r) => setTimeout(r, 500));
                continue;
            }

            const lead = state.queue[state.currentIndex];
            state.currentLeadName = lead.nome_fantasia;
            addLog(`Preparando abordagem para ${lead.nome_fantasia}...`);
            await saveAndBroadcast();

            const msgRes = await resolveMessageForLead(lead, state.frente, state.msgMode, state.currentIndex);
            if (!msgRes.ok) {
                state.errorCount++;
                addLog(`Falha ao gerar mensagem para ${lead.nome_fantasia}: ${msgRes.error}`, "error");
                state.currentIndex++;
                await saveAndBroadcast();
                continue;
            }

            const waTab = await getOrOpenWhatsAppTab();
            const sendRes = await sendToWhatsAppTab(waTab.id, {
                type: "WA_OPEN_AND_SEND",
                phone: lead.whatsapp_disparo,
                message: msgRes.mensagem
            });

            const phonePlus = `+${normalizePhoneDigits(lead.whatsapp_disparo)}`;

            if (sendRes?.ok) {
                const ts = formatDateTimeBR();
                const formattedContent = `[${ts}] ${phonePlus}: ${msgRes.mensagem}`;
                await insertInteraction(state.frente, {
                    empresa_id: lead.id,
                    tipo_mensagem: "whatsapp_outbound",
                    conteudo_mensagem: formattedContent,
                    direcao: "outbound",
                    operador: operatorName,
                    data_envio: new Date().toISOString()
                });

                await updateLead(state.frente, lead.id, {
                    status_kanban: EXT_CONFIG.stages.nextAfterDispatch,
                    whatsapp_confirmado: true,
                    responsavel_operador: operatorName
                });

                state.sentCount++;
                state.dailySentToday = await incrementDailySentCount();
                state.dispatchedIds.push(lead.id);
                addLog(`Enviado (${msgRes.source}) para ${lead.nome_fantasia} -> movido para Em Andamento.`, "success");
            } else if (sendRes?.reason === "no_whatsapp") {
                const email = (lead.email_contato || lead.email_parcerias || "").trim();
                await insertInteraction(state.frente, {
                    empresa_id: lead.id,
                    tipo_mensagem: "nota_operador",
                    conteudo_mensagem: `[sem_whatsapp] Número ${phonePlus} sem WhatsApp ativo (${sendRes.detail || "inválido"}).`,
                    direcao: "outbound",
                    operador: operatorName,
                    data_envio: new Date().toISOString()
                });

                if (email) {
                    await updateLead(state.frente, lead.id, { whatsapp_confirmado: false });
                    state.gmailQueue.push({
                        id: lead.id,
                        nome_fantasia: lead.nome_fantasia,
                        email,
                        lead
                    });
                    addLog(`${lead.nome_fantasia} sem WhatsApp -> enfileirado para fallback Gmail (${email}).`, "warn");
                } else {
                    await updateLead(state.frente, lead.id, {
                        whatsapp_confirmado: false,
                        status_kanban: EXT_CONFIG.stages.attention
                    });
                    state.attentionList.push({ id: lead.id, nome: lead.nome_fantasia, motivo: "Sem WhatsApp e sem e-mail" });
                    addLog(`${lead.nome_fantasia} sem WhatsApp e sem e-mail -> movido para Atenção.`, "warn");
                }
                state.errorCount++;
            } else {
                const detail = sendRes?.detail || "Falha ao abrir conversa no WhatsApp Web";
                await insertInteraction(state.frente, {
                    empresa_id: lead.id,
                    tipo_mensagem: "nota_operador",
                    conteudo_mensagem: `[erro_whatsapp] ${detail}`,
                    direcao: "outbound",
                    operador: operatorName,
                    data_envio: new Date().toISOString()
                });
                await updateLead(state.frente, lead.id, { status_kanban: EXT_CONFIG.stages.attention });
                state.attentionList.push({ id: lead.id, nome: lead.nome_fantasia, motivo: detail });
                state.errorCount++;
                addLog(`Erro em ${lead.nome_fantasia}: ${detail} -> movido para Atenção.`, "error");
            }

            state.currentIndex++;
            await saveAndBroadcast();

            if (state.currentIndex < state.queue.length && state.status === "running") {
                const delay = Math.floor(
                    Math.random() * (EXT_CONFIG.timing.maxIntervalSec - EXT_CONFIG.timing.minIntervalSec + 1)
                ) + EXT_CONFIG.timing.minIntervalSec;
                addLog(`Aguardando ${delay}s antes do próximo lead...`);
                const cont = await waitCountdown(delay);
                if (!cont) break;
            }
        }

        if (state.status !== "stopped") {
            state.status = "completed";
            state.countdownSec = 0;
            state.currentLeadName = "";
            addLog("Lote finalizado. Executando auditoria pós-lote...", "success");
            await runPostBatchAudit();
        }
    } finally {
        loopActive = false;
        await saveAndBroadcast();
    }
}

async function processGmailQueue() {
    if (!state.gmailQueue || state.gmailQueue.length === 0) {
        return { ok: false, error: "Fila de fallback Gmail vazia." };
    }
    const session = await refreshSessionIfNeeded();
    const operatorName = session?.user?.name || "Carlos";
    const remaining = [];
    let sent = 0;

    for (const item of state.gmailQueue) {
        addLog(`Gerando e-mail IA para ${item.nome_fantasia} (${item.email})...`);
        await saveAndBroadcast();

        const iaRes = await generateApproachViaIA(item.lead, state.frente, { canal: "email" });
        const subject = iaRes.ok && iaRes.assunto
            ? iaRes.assunto
            : `Contato comercial — ${item.nome_fantasia}`;
        const body = iaRes.ok && iaRes.mensagem
            ? iaRes.mensagem
            : `Olá,\n\nPesquisei empresas da região e encontrei a ${item.nome_fantasia}. Gostaria de entender quem cuida da área comercial/projetos para uma conversa rápida de 2 minutos.\n\nPodemos falar por aqui?`;

        const gmailUrl = `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(item.email)}&su=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
        const tab = await chrome.tabs.create({ url: gmailUrl, active: true });

        await new Promise((resolve) => {
            const listener = (tabId, info) => {
                if (tabId === tab.id && info.status === "complete") {
                    chrome.tabs.onUpdated.removeListener(listener);
                    setTimeout(resolve, 2500);
                }
            };
            chrome.tabs.onUpdated.addListener(listener);
            setTimeout(resolve, 12000);
        });

        let sendRes = null;
        try {
            sendRes = await chrome.tabs.sendMessage(tab.id, { type: "GMAIL_AUTO_SEND" });
        } catch {
            await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["gmail_content.js"] });
            await new Promise((r) => setTimeout(r, 600));
            sendRes = await chrome.tabs.sendMessage(tab.id, { type: "GMAIL_AUTO_SEND" });
        }

        if (sendRes?.ok) {
            const ts = formatDateTimeBR();
            await insertInteraction(state.frente, {
                empresa_id: item.id,
                tipo_mensagem: "email_outbound",
                conteudo_mensagem: `[${ts}] ${item.email}: [Assunto: ${subject}] ${body}`,
                direcao: "outbound",
                operador: operatorName,
                data_envio: new Date().toISOString()
            });
            await updateLead(state.frente, item.id, {
                status_kanban: EXT_CONFIG.stages.nextAfterDispatch,
                responsavel_operador: operatorName
            });
            sent++;
            addLog(`E-mail enviado via Gmail para ${item.nome_fantasia} -> movido para Em Andamento.`, "success");
            setTimeout(() => chrome.tabs.remove(tab.id).catch(() => {}), 2500);
        } else {
            remaining.push(item);
            addLog(`Falha no envio Gmail para ${item.nome_fantasia}: ${sendRes?.error || "verifique a aba"}`, "error");
        }
        await new Promise((r) => setTimeout(r, 2000));
    }

    state.gmailQueue = remaining;
    await saveAndBroadcast();
    return { ok: true, sent, remaining: remaining.length };
}

async function handleChatSync(payload) {
    if (!payload?.ok || !payload.phone || !Array.isArray(payload.entries)) return { ok: false, synced: 0 };
    const session = await refreshSessionIfNeeded();
    if (!session?.access_token) return { ok: false, synced: 0 };

    const lead = await findLeadByPhone(state.frente, payload.phone);
    if (!lead) return { ok: false, synced: 0, reason: "lead_nao_encontrado" };

    const existingRes = await fetchRecentInteractions(state.frente, lead.id);
    const existingSet = new Set((existingRes.data || []).map((i) => String(i.conteudo_mensagem || "").trim()));
    const operatorName = session.user?.name || "Carlos";

    let synced = 0;
    for (const entry of payload.entries) {
        const text = entry.conteudo_mensagem.trim();
        if (existingSet.has(text)) continue;
        // Evita duplicar se apenas o horário diferir por segundos mas o corpo for idêntico
        const bodyOnly = text.replace(/^\[[^\]]+\]\s*\+?\d+:\s*/, "").trim();
        const duplicateBody = Array.from(existingSet).some((ex) => ex.endsWith(bodyOnly));
        if (duplicateBody) continue;

        const ins = await insertInteraction(state.frente, {
            empresa_id: lead.id,
            tipo_mensagem: entry.tipo_mensagem,
            conteudo_mensagem: text,
            direcao: entry.direcao,
            operador: entry.direcao === "outbound" ? operatorName : lead.nome_fantasia,
            data_envio: entry.data_envio || new Date().toISOString()
        });
        if (ins.ok) {
            existingSet.add(text);
            synced++;
        }
    }
    if (synced > 0) {
        addLog(`Sync bidirecional: ${synced} mensagem(ns) sincronizada(s) com ${lead.nome_fantasia}.`, "success");
        await saveAndBroadcast();
    }
    return { ok: true, synced, leadName: lead.nome_fantasia };
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    (async () => {
        switch (msg?.type) {
            case "GET_INIT": {
                let session = await refreshSessionIfNeeded();
                if (!session) {
                    session = await tryAdoptSessionFromCrmTab();
                }
                state.dailySentToday = await getDailySentCount();
                const profiles = session ? await fetchDistinctProfiles(state.frente) : [];
                sendResponse({ session, state, profiles });
                break;
            }
            case "LOGIN": {
                const res = await signInWithPassword(msg.email, msg.password);
                if (res.ok) {
                    await ensureCrmTabOpen();
                }
                sendResponse(res);
                break;
            }
            case "LOGOUT": {
                await clearSession();
                state = defaultState();
                await saveAndBroadcast();
                sendResponse({ ok: true });
                break;
            }
            case "LOAD_QUEUE": {
                state.frente = msg.frente || state.frente;
                state.prioridade = msg.prioridade || "todas";
                state.perfil = msg.perfil || "todos";
                state.dailySentToday = await getDailySentCount();
                const qRes = await fetchInitialQueue(state.frente, {
                    prioridade: state.prioridade,
                    perfil: state.perfil
                });
                const profiles = await fetchDistinctProfiles(state.frente);
                if (qRes.ok) {
                    state.queue = qRes.data;
                    state.recommendedDaily = computeRecommendedDaily(qRes.data.length);
                    state.currentIndex = 0;
                    await saveAndBroadcast();
                }
                sendResponse({ ...qRes, profiles, count: qRes.data?.length || 0, recommendedDaily: state.recommendedDaily, dailySentToday: state.dailySentToday });
                break;
            }
            case "START_BATCH": {
                state.frente = msg.frente || state.frente;
                state.prioridade = msg.prioridade || "todas";
                state.perfil = msg.perfil || "todos";
                state.msgMode = msg.msgMode || "ia";
                state.dailyLimit = Math.max(0, parseInt(msg.dailyLimit, 10) || 0);
                state.dailySentToday = await getDailySentCount();

                const qRes = await fetchInitialQueue(state.frente, {
                    prioridade: state.prioridade,
                    perfil: state.perfil
                });
                if (!qRes.ok) {
                    sendResponse({ ok: false, error: qRes.error });
                    break;
                }
                if (qRes.data.length === 0) {
                    sendResponse({ ok: false, error: "Nenhum lead elegível na fila inicial com estes filtros." });
                    break;
                }

                const recommended = computeRecommendedDaily(qRes.data.length);
                state.recommendedDaily = recommended;
                const effectiveLimit = state.dailyLimit > 0 ? state.dailyLimit : recommended;
                const remainingToday = Math.max(0, effectiveLimit - state.dailySentToday);
                if (remainingToday <= 0) {
                    sendResponse({ ok: false, error: `Limite diário atingido (${state.dailySentToday}/${effectiveLimit} disparos hoje).` });
                    break;
                }

                state.queue = qRes.data.slice(0, remainingToday);
                state.currentIndex = 0;
                state.sentCount = 0;
                state.errorCount = 0;
                state.dispatchedIds = [];
                state.gmailQueue = [];
                state.attentionList = [];
                state.auditSummary = null;
                state.countdownSec = 0;
                state.status = "running";
                addLog(`Lote iniciado: ${state.queue.length} contato(s) programados (teto diário: ${effectiveLimit}).`);
                await saveAndBroadcast();
                processBatchLoop();
                sendResponse({ ok: true, count: state.queue.length });
                break;
            }
            case "PAUSE_BATCH": {
                state.status = "paused";
                addLog("Lote pausado pelo operador.", "warn");
                await saveAndBroadcast();
                sendResponse({ ok: true });
                break;
            }
            case "RESUME_BATCH": {
                state.status = "running";
                addLog("Lote retomado.");
                await saveAndBroadcast();
                processBatchLoop();
                sendResponse({ ok: true });
                break;
            }
            case "STOP_BATCH": {
                state.status = "stopped";
                state.countdownSec = 0;
                addLog("Lote interrompido pelo operador.", "warn");
                await saveAndBroadcast();
                sendResponse({ ok: true });
                break;
            }
            case "RUN_GMAIL_FALLBACK": {
                const res = await processGmailQueue();
                sendResponse(res);
                break;
            }
            case "WA_CHAT_SYNC": {
                const res = await handleChatSync(msg.payload);
                sendResponse(res);
                break;
            }
            case "SYNC_ACTIVE_CHAT": {
                const waTab = await getOrOpenWhatsAppTab();
                const scrapeRes = await sendToWhatsAppTab(waTab.id, { type: "WA_SCRAPE_CHAT" });
                const syncRes = await handleChatSync(scrapeRes);
                sendResponse(syncRes);
                break;
            }
            default:
                sendResponse({ ok: false, error: "Ação desconhecida" });
        }
    })();
    return true;
});
