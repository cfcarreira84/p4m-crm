/**
 * ==============================================================================
 * P/CRM EXTENSION — SUPABASE AUTH, POSTGREST & EDGE FUNCTION `ia`
 * ==============================================================================
 */
import { EXT_CONFIG } from "./config.js";

const STORAGE_AUTH_KEY = "pcrm_auth_session";

const PRIORITY_RANK = {
    alta: 5,
    media_alta: 4,
    media: 3,
    baixa: 2,
    a_qualificar: 1
};

export function normalizePhoneDigits(raw) {
    let digits = String(raw || "").replace(/\D/g, "");
    if (!digits) return "";
    if (!digits.startsWith("55") && (digits.length === 10 || digits.length === 11)) {
        digits = "55" + digits;
    }
    return digits;
}

export function isValidWhatsAppCandidate(raw) {
    const d = normalizePhoneDigits(raw);
    return d.length >= 12 && d.length <= 13;
}

export async function getSession() {
    const res = await chrome.storage.local.get(STORAGE_AUTH_KEY);
    return res[STORAGE_AUTH_KEY] || null;
}

export async function saveSession(session) {
    await chrome.storage.local.set({ [STORAGE_AUTH_KEY]: session });
}

export async function clearSession() {
    await chrome.storage.local.remove(STORAGE_AUTH_KEY);
}

export async function adoptExternalSession(raw) {
    if (!raw || !raw.access_token) return null;
    const expiresAt = raw.expires_at
        ? Number(raw.expires_at) * 1000
        : Date.now() + ((Number(raw.expires_in) || 3600) * 1000);
    const session = {
        access_token: raw.access_token,
        refresh_token: raw.refresh_token || "",
        expires_at: expiresAt,
        user: {
            id: raw.user?.id || "",
            email: raw.user?.email || "",
            name: raw.user?.user_metadata?.name || raw.user?.email?.split("@")[0] || "Operador"
        }
    };
    await saveSession(session);
    return session;
}

export async function getDailySentCount() {
    const today = new Date().toISOString().slice(0, 10);
    const res = await chrome.storage.local.get("pcrm_daily_sent");
    const rec = res.pcrm_daily_sent;
    if (!rec || rec.date !== today) return 0;
    return Number(rec.count) || 0;
}

export async function incrementDailySentCount() {
    const today = new Date().toISOString().slice(0, 10);
    const current = await getDailySentCount();
    await chrome.storage.local.set({ pcrm_daily_sent: { date: today, count: current + 1 } });
    return current + 1;
}

export async function signInWithPassword(email, password) {
    const url = `${EXT_CONFIG.supabase.url}/auth/v1/token?grant_type=password`;
    const resp = await fetch(url, {
        method: "POST",
        headers: {
            apikey: EXT_CONFIG.supabase.anonKey,
            "Content-Type": "application/json"
        },
        body: JSON.stringify({ email: email.trim(), password })
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok || !data.access_token) {
        return { ok: false, error: data.error_description || data.msg || data.error || `HTTP ${resp.status}` };
    }
    const expiresAt = Date.now() + ((Number(data.expires_in) || 3600) * 1000);
    const session = {
        access_token: data.access_token,
        refresh_token: data.refresh_token,
        expires_at: expiresAt,
        user: {
            id: data.user?.id || "",
            email: data.user?.email || email.trim(),
            name: data.user?.user_metadata?.name || data.user?.email?.split("@")[0] || "Carlos"
        }
    };
    await saveSession(session);
    return { ok: true, session };
}

export async function refreshSessionIfNeeded() {
    const session = await getSession();
    if (!session) return null;
    // Renova 120 segundos antes de expirar
    if (session.expires_at && Date.now() < session.expires_at - 120000) {
        return session;
    }
    if (!session.refresh_token) {
        await clearSession();
        return null;
    }
    try {
        const url = `${EXT_CONFIG.supabase.url}/auth/v1/token?grant_type=refresh_token`;
        const resp = await fetch(url, {
            method: "POST",
            headers: {
                apikey: EXT_CONFIG.supabase.anonKey,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({ refresh_token: session.refresh_token })
        });
        const data = await resp.json().catch(() => ({}));
        if (!resp.ok || !data.access_token) {
            await clearSession();
            return null;
        }
        const updated = {
            ...session,
            access_token: data.access_token,
            refresh_token: data.refresh_token || session.refresh_token,
            expires_at: Date.now() + ((Number(data.expires_in) || 3600) * 1000)
        };
        await saveSession(updated);
        return updated;
    } catch {
        return session;
    }
}

async function restRequest(path, options = {}) {
    const session = await refreshSessionIfNeeded();
    if (!session?.access_token) {
        return { ok: false, status: 401, error: "Sessão expirada. Faça login novamente." };
    }
    const url = `${EXT_CONFIG.supabase.url}/rest/v1/${path}`;
    const headers = {
        apikey: EXT_CONFIG.supabase.anonKey,
        Authorization: `Bearer ${session.access_token}`,
        "Content-Type": "application/json",
        Prefer: options.prefer || "return=representation",
        ...(options.headers || {})
    };
    try {
        const resp = await fetch(url, {
            method: options.method || "GET",
            headers,
            body: options.body ? JSON.stringify(options.body) : undefined
        });
        const text = await resp.text();
        let data = null;
        try { data = text ? JSON.parse(text) : null; } catch { data = text; }
        if (!resp.ok) {
            const msg = (data && (data.message || data.error || data.hint)) || `HTTP ${resp.status}`;
            return { ok: false, status: resp.status, error: msg, data: null };
        }
        return { ok: true, status: resp.status, data };
    } catch (err) {
        return { ok: false, status: 0, error: err?.message || "Falha de rede", data: null };
    }
}

export async function fetchInitialQueue(frenteId, filters = {}) {
    const frente = EXT_CONFIG.frentes[frenteId] || EXT_CONFIG.frentes.p4m || Object.values(EXT_CONFIG.frentes)[0];
    const params = [
        `status_kanban=eq.${EXT_CONFIG.stages.initial}`,
        "is_arquivado=eq.false",
        "whatsapp_disparo=not.is.null",
        "select=*",
        "order=pontuacao_carga.desc.nullslast,created_at.asc",
        "limit=200"
    ];
    if (filters.prioridade && filters.prioridade !== "todas") {
        params.push(`prioridade_carga=eq.${encodeURIComponent(filters.prioridade)}`);
    }
    if (filters.perfil && filters.perfil !== "todos") {
        params.push(`cluster_estrategico=eq.${encodeURIComponent(filters.perfil)}`);
    }
    const res = await restRequest(`${frente.tables.leads}?${params.join("&")}`);
    if (!res.ok) return res;

    const candidates = (res.data || []).filter((l) =>
        isValidWhatsAppCandidate(l.whatsapp_disparo) && l.whatsapp_confirmado !== false
    );

    // Filtra leads que ainda não possuem interação outbound registrada
    if (candidates.length > 0) {
        const ids = candidates.slice(0, 100).map((l) => l.id).join(",");
        const intRes = await restRequest(
            `${frente.tables.interactions}?empresa_id=in.(${ids})&direcao=eq.outbound&tipo_mensagem=neq.nota_operador&select=empresa_id`
        );
        if (intRes.ok && Array.isArray(intRes.data)) {
            const alreadyDispatched = new Set(intRes.data.map((i) => i.empresa_id));
            const filtered = candidates.filter((l) => !alreadyDispatched.has(l.id));
            filtered.sort((a, b) => {
                const pa = PRIORITY_RANK[a.prioridade_carga] || 0;
                const pb = PRIORITY_RANK[b.prioridade_carga] || 0;
                if (pb !== pa) return pb - pa;
                return (Number(b.pontuacao_carga) || 0) - (Number(a.pontuacao_carga) || 0);
            });
            return { ok: true, data: filtered };
        }
    }

    return { ok: true, data: candidates };
}

export async function fetchDistinctProfiles(frenteId) {
    const frente = EXT_CONFIG.frentes[frenteId] || EXT_CONFIG.frentes.p4m || Object.values(EXT_CONFIG.frentes)[0];
    const labelsMap = frente.clusters || {};
    const res = await restRequest(
        `${frente.tables.leads}?status_kanban=eq.${EXT_CONFIG.stages.initial}&is_arquivado=eq.false&cluster_estrategico=not.is.null&select=cluster_estrategico&limit=500`
    );
    const set = new Set((res.ok ? res.data : []).map((r) => r.cluster_estrategico).filter(Boolean));
    Object.keys(labelsMap).forEach((k) => set.add(k));
    return Array.from(set)
        .map((id) => ({ id, label: labelsMap[id] || id.replace(/_/g, " ") }))
        .sort((a, b) => a.label.localeCompare(b.label, "pt-BR"));
}

export async function updateLead(frenteId, leadId, patch) {
    const frente = EXT_CONFIG.frentes[frenteId] || EXT_CONFIG.frentes.p4m || Object.values(EXT_CONFIG.frentes)[0];
    return restRequest(`${frente.tables.leads}?id=eq.${leadId}`, {
        method: "PATCH",
        body: {
            ...patch,
            updated_at: new Date().toISOString()
        }
    });
}

export async function insertInteraction(frenteId, payload) {
    const frente = EXT_CONFIG.frentes[frenteId] || EXT_CONFIG.frentes.p4m || Object.values(EXT_CONFIG.frentes)[0];
    return restRequest(frente.tables.interactions, {
        method: "POST",
        body: payload
    });
}

export async function fetchRecentInteractions(frenteId, empresaId) {
    const frente = EXT_CONFIG.frentes[frenteId] || EXT_CONFIG.frentes.p4m || Object.values(EXT_CONFIG.frentes)[0];
    return restRequest(
        `${frente.tables.interactions}?empresa_id=eq.${empresaId}&order=data_envio.desc&limit=50&select=id,conteudo_mensagem,data_envio,direcao,tipo_mensagem`
    );
}

export async function findLeadByPhone(frenteId, phoneDigits) {
    const frente = EXT_CONFIG.frentes[frenteId] || EXT_CONFIG.frentes.p4m || Object.values(EXT_CONFIG.frentes)[0];
    const clean = normalizePhoneDigits(phoneDigits);
    if (!clean) return null;
    const suffix = clean.slice(-8);
    const res = await restRequest(
        `${frente.tables.leads}?whatsapp_disparo=ilike.*${suffix}&select=id,nome_fantasia,whatsapp_disparo,status_kanban&limit=5`
    );
    if (!res.ok || !Array.isArray(res.data)) return null;
    return res.data.find((l) => normalizePhoneDigits(l.whatsapp_disparo).endsWith(suffix)) || res.data[0] || null;
}

export async function fetchAuditLeads(frenteId, leadIds) {
    if (!leadIds || leadIds.length === 0) return [];
    const frente = EXT_CONFIG.frentes[frenteId] || EXT_CONFIG.frentes.p4m || Object.values(EXT_CONFIG.frentes)[0];
    const ids = leadIds.join(",");
    const res = await restRequest(
        `${frente.tables.leads}?id=in.(${ids})&select=id,nome_fantasia,status_kanban,whatsapp_disparo,whatsapp_confirmado,email_contato,email_parcerias`
    );
    if (!res.ok || !Array.isArray(res.data)) return [];
    return res.data;
}

export async function generateApproachViaIA(lead, frenteId, opts = {}) {
    const session = await refreshSessionIfNeeded();
    if (!session?.access_token) {
        return { ok: false, error: "Não autenticado" };
    }
    const frente = EXT_CONFIG.frentes[frenteId] || EXT_CONFIG.frentes.p4m || Object.values(EXT_CONFIG.frentes)[0];
    const sc = lead.pre_analise_scout || {};
    const leadPayload = {
        ...lead,
        pre_analise_scout: {
            status_presenca: sc.status_presenca,
            pontos_fortes_gmaps: sc.pontos_fortes_gmaps,
            pontos_fracos_gmaps: sc.pontos_fracos_gmaps,
            gargalo_critico: sc.gargalo_critico,
            solucao_recomendada: sc.solucao_recomendada,
            gancho_hipercontextualizado: sc.gancho_hipercontextualizado,
            gancho_kickoff_gerado: sc.gancho_kickoff_gerado,
            analise_complementar: sc.analise_complementar
        },
        timeline: []
    };

    const ctx = {
        marca: EXT_CONFIG.appName,
        frente: frente.id,
        frenteLabel: frente.label,
        operador: session.user?.name || "P4m",
        contato: lead.contato_responsavel || "",
        etapaId: lead.status_kanban || EXT_CONFIG.stages.initial,
        etapaLabel: EXT_CONFIG.stageLabels[lead.status_kanban] || "Aguardando Contato",
        proximaEtapaLabel: EXT_CONFIG.stageLabels[EXT_CONFIG.stages.nextAfterDispatch],
        aiGoal: frente.aiGoalInitial,
        variacaoAntiTemplate: opts.canal !== "email",
        estiloIndice: opts.estiloIndice || 0,
        canal: opts.canal || "whatsapp"
    };

    try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 50000);
        const resp = await fetch(`${EXT_CONFIG.supabase.url}/functions/v1/ia`, {
            method: "POST",
            headers: {
                apikey: EXT_CONFIG.supabase.anonKey,
                Authorization: `Bearer ${session.access_token}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({ acao: "mensagem", lead: leadPayload, ctx }),
            signal: ctrl.signal
        });
        clearTimeout(timer);
        const json = await resp.json().catch(() => null);
        if (!resp.ok || !json?.ok) {
            return { ok: false, error: json?.error || `HTTP ${resp.status}` };
        }
        const msg = json.data?.mensagem || json.texto || "";
        const assunto = json.data?.assunto || "";
        if (!msg) return { ok: false, error: "IA retornou mensagem vazia" };
        return { ok: true, mensagem: msg, assunto, modelo: json.modelo };
    } catch (err) {
        return { ok: false, error: err?.message || "Erro ao chamar Edge Function ia" };
    }
}
