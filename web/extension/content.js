/**
 * ==============================================================================
 * P/CRM EXTENSION — WHATSAPP WEB CONTENT SCRIPT (content.js)
 * ==============================================================================
 * - Abertura limpa de conversa (busca lateral + fallback link interno SPA)
 * - Envio fracionado por parágrafo com simulação humana caractere por caractere
 * - Detecção de número sem WhatsApp / erro de abertura
 * - Captura & normalização de mensagens e mídias ([DD/MM/AAAA, HH:MM] +55...: Conteúdo)
 */
(() => {
    if (window.__pcrmWaInjected) return;
    window.__pcrmWaInjected = true;

    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const rand = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

    function normalizeDigits(raw) {
        let d = String(raw || "").replace(/\D/g, "");
        if (!d) return "";
        if (!d.startsWith("55") && (d.length === 10 || d.length === 11)) d = "55" + d;
        return d;
    }

    function formatDateBR(date = new Date()) {
        const dd = String(date.getDate()).padStart(2, "0");
        const mm = String(date.getMonth() + 1).padStart(2, "0");
        const yyyy = date.getFullYear();
        const hh = String(date.getHours()).padStart(2, "0");
        const min = String(date.getMinutes()).padStart(2, "0");
        return { dateStr: `${dd}/${mm}/${yyyy}`, timeStr: `${hh}:${min}` };
    }

    function parsePrePlainText(pre) {
        // Exemplos WA Web: "[14:32, 16/11/2026] +55 19 99999-9999: " ou "[16/11/2026, 14:32] Nome: "
        const m1 = String(pre || "").match(/\[(\d{1,2}:\d{2}),?\s+(\d{1,2}\/\d{1,2}\/\d{2,4})\]/);
        if (m1) {
            const parts = m1[2].split("/");
            const y = parts[2].length === 2 ? "20" + parts[2] : parts[2];
            return `${parts[0].padStart(2, "0")}/${parts[1].padStart(2, "0")}/${y}, ${m1[1].padStart(5, "0")}`;
        }
        const m2 = String(pre || "").match(/\[(\d{1,2}\/\d{1,2}\/\d{2,4}),?\s+(\d{1,2}:\d{2})\]/);
        if (m2) {
            const parts = m2[1].split("/");
            const y = parts[2].length === 2 ? "20" + parts[2] : parts[2];
            return `${parts[0].padStart(2, "0")}/${parts[1].padStart(2, "0")}/${y}, ${m2[2].padStart(5, "0")}`;
        }
        return null;
    }

    function findComposer() {
        return (
            document.querySelector('#main footer div[contenteditable="true"][data-tab="10"]') ||
            document.querySelector('#main footer div[role="textbox"][contenteditable="true"]') ||
            document.querySelector('footer div[contenteditable="true"]')
        );
    }

    function findSendButton() {
        const icon =
            document.querySelector('#main footer span[data-icon="send"]') ||
            document.querySelector('#main footer span[data-icon="wds-ic-send-filled"]');
        if (icon) return icon.closest("button") || icon;
        return (
            document.querySelector('#main footer button[data-tab="11"]') ||
            document.querySelector('#main footer button[aria-label*="Enviar"]') ||
            document.querySelector('#main footer button[aria-label*="Send"]')
        );
    }

    function findSearchBox() {
        return (
            document.querySelector('#side div[contenteditable="true"][data-tab="3"]') ||
            document.querySelector('div[role="textbox"][data-tab="3"]') ||
            document.querySelector('#side div[role="textbox"][contenteditable="true"]')
        );
    }

    function detectInvalidNumberDialog() {
        const dialogs = Array.from(document.querySelectorAll('div[role="dialog"], div[data-animate-modal-popup="true"]'));
        for (const dlg of dialogs) {
            const txt = (dlg.innerText || "").toLowerCase();
            if (
                txt.includes("inválido") ||
                txt.includes("invalid") ||
                txt.includes("não está no whatsapp") ||
                txt.includes("not on whatsapp") ||
                txt.includes("url") && txt.includes("telefone")
            ) {
                const okBtn = dlg.querySelector('button');
                if (okBtn) okBtn.click();
                return dlg.innerText.trim().slice(0, 180);
            }
        }
        return null;
    }

    async function typeHumanText(el, text) {
        el.focus();
        await sleep(rand(80, 180));
        for (let i = 0; i < text.length; i++) {
            const ch = text[i];
            document.execCommand("insertText", false, ch);
            el.dispatchEvent(new InputEvent("input", { bubbles: true, data: ch, inputType: "insertText" }));
            let delay = rand(22, 68);
            if (ch === " " || ch === "," || ch === ".") delay += rand(15, 70);
            if (i > 0 && i % 25 === 0) delay += rand(60, 160);
            await sleep(delay);
        }
    }

    async function clearEditable(el) {
        el.focus();
        document.execCommand("selectAll", false, null);
        document.execCommand("delete", false, null);
        el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "deleteContentBackward" }));
        await sleep(120);
    }

    async function tryOpenViaSidebarSearch(phoneDigits) {
        const searchBox = findSearchBox();
        if (!searchBox) return false;

        await clearEditable(searchBox);
        const query = phoneDigits.slice(-8);
        await typeHumanText(searchBox, query);
        await sleep(1400);

        const items = Array.from(document.querySelectorAll('#pane-side div[role="listitem"], #pane-side div[role="row"]'));
        for (const item of items) {
            const txt = (item.innerText || "").replace(/\D/g, "");
            if (txt.includes(query)) {
                item.click();
                await sleep(1200);
                await clearEditable(searchBox);
                if (findComposer()) return true;
            }
        }
        await clearEditable(searchBox);
        return false;
    }

    async function tryOpenViaInternalLink(phoneDigits) {
        const a = document.createElement("a");
        a.href = `https://web.whatsapp.com/send?phone=${phoneDigits}`;
        a.style.display = "none";
        document.body.appendChild(a);
        a.click();
        a.remove();

        for (let i = 0; i < 24; i++) {
            await sleep(500);
            const invalidMsg = detectInvalidNumberDialog();
            if (invalidMsg) {
                return { ok: false, reason: "no_whatsapp", detail: invalidMsg };
            }
            if (findComposer()) {
                return { ok: true };
            }
        }
        return { ok: false, reason: "open_failed", detail: "Tempo esgotado aguardando abertura da conversa no WhatsApp Web." };
    }

    async function openAndSend(phoneRaw, message) {
        const phoneDigits = normalizeDigits(phoneRaw);
        if (!phoneDigits) {
            return { ok: false, reason: "open_failed", detail: "Telefone inválido no cadastro." };
        }

        let opened = await tryOpenViaSidebarSearch(phoneDigits);
        if (!opened) {
            const linkRes = await tryOpenViaInternalLink(phoneDigits);
            if (!linkRes.ok) return linkRes;
        }

        await sleep(rand(600, 1100));

        const paragraphs = String(message || "")
            .split(/\r?\n\s*\r?\n|\r?\n/)
            .map((p) => p.trim())
            .filter(Boolean);

        if (paragraphs.length === 0) {
            return { ok: false, reason: "open_failed", detail: "Mensagem vazia para disparo." };
        }

        for (let idx = 0; idx < paragraphs.length; idx++) {
            const composer = findComposer();
            if (!composer) {
                return { ok: false, reason: "open_failed", detail: "Campo de mensagem não encontrado no DOM." };
            }
            await typeHumanText(composer, paragraphs[idx]);
            await sleep(rand(350, 750));

            const sendBtn = findSendButton();
            if (sendBtn) {
                sendBtn.click();
            } else {
                composer.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", keyCode: 13, bubbles: true }));
            }

            if (idx < paragraphs.length - 1) {
                await sleep(rand(1200, 2400));
            } else {
                await sleep(rand(700, 1200));
            }
        }

        return { ok: true, paragraphsSent: paragraphs.length, phoneDigits };
    }

    function extractMediaDescription(row, isOutbound) {
        const prefix = isOutbound ? "Mídia enviada" : "Mídia recebida";
        if (row.querySelector('span[data-icon="audio-play"], span[data-icon="ptt"], audio')) {
            const durMatch = (row.innerText || "").match(/\b\d{1,2}:\d{2}\b/);
            const dur = durMatch ? ` (${durMatch[0]})` : "";
            return `[${prefix}: Áudio${dur}]`;
        }
        if (row.querySelector('video, span[data-icon="video-pip"], span[data-icon="media-play"]')) {
            return `[Vídeo anexado]`;
        }
        if (row.querySelector('span[data-icon*="document"], a[download]')) {
            const docNameEl = row.querySelector('span[title*="."], div[title*="."]');
            const fileName = docNameEl?.getAttribute("title") || "arquivo";
            return `[Documento: ${fileName}]`;
        }
        if (row.querySelector('img[alt*="figurinha"], span[data-icon="sticker"]')) {
            return `[Figurinha anexada]`;
        }
        if (row.querySelector('img[src^="blob:"], div[aria-label*="Imagem"], span[data-icon="image"]')) {
            return `[Imagem anexada]`;
        }
        return null;
    }

    function scrapeActiveChat() {
        const main = document.querySelector("#main");
        if (!main) return { ok: false, error: "Nenhuma conversa aberta." };

        const rows = Array.from(main.querySelectorAll('div[data-id]'));
        const entries = [];
        let detectedPhone = "";

        for (const row of rows.slice(-40)) {
            const dataId = row.getAttribute("data-id") || "";
            const jidMatch = dataId.match(/(true|false)_(\d{10,15})@(?:c\.us|lid)/);
            if (!jidMatch) continue;

            const isOutbound = jidMatch[1] === "true";
            const phone = `+${jidMatch[2]}`;
            if (!detectedPhone && jidMatch[2].length >= 10) detectedPhone = phone;

            const preEl = row.querySelector("[data-pre-plain-text]");
            const parsedDate = preEl ? parsePrePlainText(preEl.getAttribute("data-pre-plain-text")) : null;
            const fallback = formatDateBR();
            const dateTime = parsedDate || `${fallback.dateStr}, ${fallback.timeStr}`;

            const textSpans = Array.from(row.querySelectorAll('span.selectable-text span, span[dir="ltr"].selectable-text'));
            const textContent = textSpans.map((s) => s.innerText).join(" ").trim();
            const mediaDesc = extractMediaDescription(row, isOutbound);

            const body = [mediaDesc, textContent].filter(Boolean).join(" ").trim();
            if (!body) continue;

            const formatted = `[${dateTime}] ${phone}: ${body}`;
            entries.push({
                id: dataId,
                phone,
                direcao: isOutbound ? "outbound" : "inbound",
                tipo_mensagem: isOutbound ? "whatsapp_outbound" : "whatsapp_inbound",
                conteudo_mensagem: formatted,
                texto_puro: body,
                data_envio: new Date().toISOString()
            });
        }

        return { ok: true, phone: detectedPhone, entries };
    }

    // Observa novas mensagens na conversa ativa e envia para o background (sync bidirecional)
    let syncTimer = null;
    let lastScrapedHash = "";
    function startChatObserver() {
        const observer = new MutationObserver(() => {
            if (!document.querySelector("#main")) return;
            clearTimeout(syncTimer);
            syncTimer = setTimeout(() => {
                const res = scrapeActiveChat();
                if (!res.ok || !res.entries.length) return;
                const tail = res.entries.slice(-3).map((e) => e.id).join("|");
                if (tail && tail !== lastScrapedHash) {
                    lastScrapedHash = tail;
                    chrome.runtime.sendMessage({ type: "WA_CHAT_SYNC", payload: res }).catch(() => {});
                }
            }, 2500);
        });
        observer.observe(document.body, { childList: true, subtree: true });
    }
    startChatObserver();

    chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
        if (msg?.type === "WA_OPEN_AND_SEND") {
            openAndSend(msg.phone, msg.message)
                .then((res) => sendResponse(res))
                .catch((err) => sendResponse({ ok: false, reason: "open_failed", detail: err?.message || "Erro inesperado" }));
            return true;
        }
        if (msg?.type === "WA_SCRAPE_CHAT") {
            sendResponse(scrapeActiveChat());
            return false;
        }
        return false;
    });
})();
