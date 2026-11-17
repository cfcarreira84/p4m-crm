/**
 * ==============================================================================
 * P/CRM EXTENSION — GMAIL WEB AUTO-SEND CONTENT SCRIPT (gmail_content.js)
 * ==============================================================================
 */
(() => {
    if (window.__pcrmGmailInjected) return;
    window.__pcrmGmailInjected = true;

    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

    function findSendButton() {
        const selectors = [
            'div[role="button"][aria-label*="Enviar"]',
            'div[role="button"][aria-label*="Send"]',
            'div[role="button"][data-tooltip*="Enviar"]',
            'div[role="button"][data-tooltip*="Send"]'
        ];
        for (const sel of selectors) {
            const btn = document.querySelector(sel);
            if (btn && btn.offsetParent !== null) return btn;
        }
        return null;
    }

    function detectSentToast() {
        const txt = (document.body.innerText || "").toLowerCase();
        return txt.includes("mensagem enviada") || txt.includes("message sent");
    }

    async function autoSendCompose() {
        for (let i = 0; i < 40; i++) {
            const sendBtn = findSendButton();
            const bodyBox = document.querySelector('div[role="textbox"][aria-label*="Corpo"], div[role="textbox"][aria-label*="Message Body"], div[aria-label="Corpo da mensagem"]');
            if (sendBtn && bodyBox && (bodyBox.innerText || "").trim().length > 5) {
                await sleep(900);
                sendBtn.click();
                for (let j = 0; j < 20; j++) {
                    await sleep(400);
                    if (detectSentToast() || !findSendButton()) {
                        return { ok: true };
                    }
                }
                return { ok: true };
            }
            await sleep(500);
        }
        return { ok: false, error: "Botão Enviar ou corpo do e-mail não encontrado no Gmail Web." };
    }

    chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
        if (msg?.type === "GMAIL_AUTO_SEND") {
            autoSendCompose()
                .then((res) => sendResponse(res))
                .catch((err) => sendResponse({ ok: false, error: err?.message || "Erro no Gmail" }));
            return true;
        }
        return false;
    });
})();
