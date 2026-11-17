/**
 * ==============================================================================
 * SUPABASE CLIENT & AI BRIDGE - COCKPIT STARTER (RESILIENTE COM DUAL-PATH REST + REALTIME)
 * ==============================================================================
 * Diretriz Zero-Mentira: Toda mutação de dados valida a resposta do PostgreSQL/PostgREST
 * e retorna explicitamente { success: boolean, data?: any, error?: string }.
 * 
 * Totalmente desacoplado: lê credenciais, tabelas e parâmetros de IA de cockpit_config.js.
 * A inteligência artificial roda exclusivamente via Edge Function `ia` no Supabase,
 * com rotação automática de modelos em caso de limite/cota e chave segura no servidor.
 * ==============================================================================
 */

const SUPABASE_CONFIG = {
    get url() {
        return (typeof CockpitConfig !== 'undefined' && CockpitConfig.supabase?.url)
            ? CockpitConfig.supabase.url.trim().replace(/\/$/, '')
            : "";
    },
    get anonKey() {
        return (typeof CockpitConfig !== 'undefined' && CockpitConfig.supabase?.anonKey)
            ? CockpitConfig.supabase.anonKey.trim()
            : "";
    },
    get tableLeads() {
        return (typeof CockpitConfig !== 'undefined' && CockpitConfig.supabase?.tableLeads)
            ? CockpitConfig.supabase.tableLeads
            : "empresas_alvo";
    },
    get tableInteractions() {
        return (typeof CockpitConfig !== 'undefined' && CockpitConfig.supabase?.tableInteractions)
            ? CockpitConfig.supabase.tableInteractions
            : "interacoes_sdr";
    },
    get tableDeletions() {
        return (typeof CockpitConfig !== 'undefined' && CockpitConfig.supabase?.tableDeletions)
            ? CockpitConfig.supabase.tableDeletions
            : "exclusoes_sync";
    }
};

// Cliente opcional do SDK Supabase (usado para Realtime websocket quando disponível)
let sbSdkClient = null;
try {
    if (typeof window !== 'undefined' && window.supabase && typeof window.supabase.createClient === 'function') {
        if (SUPABASE_CONFIG.url && !SUPABASE_CONFIG.url.includes("SEU_PROJETO") && SUPABASE_CONFIG.anonKey) {
            sbSdkClient = window.supabase.createClient(SUPABASE_CONFIG.url, SUPABASE_CONFIG.anonKey);
        }
    }
} catch (e) {
    console.warn("Aviso: Supabase SDK não instanciado, operando 100% via REST nativo.", e);
}

/**
 * Motor REST Nativo Resiliente com verificação de integridade
 */
async function supabaseRestRequest(endpoint, options = {}) {
    if (!SUPABASE_CONFIG.url || SUPABASE_CONFIG.url.includes("SEU_PROJETO") || !SUPABASE_CONFIG.anonKey) {
        return {
            success: false,
            status: 0,
            error: "Banco de dados não configurado. Defina a URL e Anon Key do Supabase em 'cockpit_config.js'.",
            data: null
        };
    }

    const url = `${SUPABASE_CONFIG.url}/rest/v1/${endpoint}`;
    const headers = {
        'apikey': SUPABASE_CONFIG.anonKey,
        // Com sessão ativa (Supabase Auth) usa o JWT do operador; sem sessão o RLS bloqueia.
        ...((window.AuthGate && window.AuthGate.accessToken())
            ? { 'Authorization': `Bearer ${window.AuthGate.accessToken()}` }
            : {}),
        'Content-Type': 'application/json',
        'Prefer': options.prefer || 'return=representation',
        ...(options.headers || {})
    };

    try {
        const response = await fetch(url, {
            method: options.method || 'GET',
            headers: headers,
            body: options.body ? JSON.stringify(options.body) : undefined
        });

        const text = await response.text();
        let json = null;
        try {
            json = text ? JSON.parse(text) : null;
        } catch (e) {
            json = text;
        }

        if (!response.ok) {
            let errMsg = `HTTP ${response.status} (${response.statusText || 'Erro'})`;
            if (json && typeof json === 'object') {
                const parts = [];
                if (json.message) parts.push(json.message);
                if (json.error && json.error !== json.message) parts.push(json.error);
                if (json.details) parts.push(`Detalhe: ${json.details}`);
                if (json.hint) parts.push(`Dica: ${json.hint}`);
                if (parts.length > 0) errMsg = parts.join(' | ');
            }
            return {
                success: false,
                status: response.status,
                error: errMsg,
                data: null
            };
        }

        return {
            success: true,
            status: response.status,
            data: json,
            error: null
        };
    } catch (netErr) {
        return {
            success: false,
            status: 0,
            error: `Falha de rede/conectividade com o Supabase: ${netErr.message || 'Servidor inacessível'}`,
            data: null
        };
    }
}

// Helpers de operador e marca (dependem de CockpitConfig / AuthGate)
function currentOperatorName() {
    return (window.AuthGate && window.AuthGate.operatorName()) || 'Operador';
}
function brandCompanyName() {
    return (typeof CockpitConfig !== 'undefined' && (CockpitConfig.brand?.companyName || CockpitConfig.brand?.appName)) || 'Nossa Empresa';
}
function isOperatorName(name) {
    const n = String(name || '').toLowerCase();
    const company = brandCompanyName().toLowerCase();
    if (n.includes('operador') || n.includes('especialista') || (company && n.includes(company))) return true;
    const ops = (typeof CockpitConfig !== 'undefined' && CockpitConfig.brand?.operators) || [];
    return ops.some(o => n.includes(o.name.toLowerCase()));
}
function getInitialStageId() {
    const st = (typeof CockpitConfig !== 'undefined' && CockpitConfig.stages || []).find(s => s.isInitial);
    return st ? st.id : 'aguardando_contato';
}

// Parte do dossiê que a IA pode ler (pesquisa da base enriquecida e análises anteriores), sem textos de cache
function recortePesquisa(sc) {
    sc = sc || {};
    return {
        analise_ia: sc.analise_ia,
        origem: sc.origem,
        status_presenca: sc.status_presenca,
        perfil_projetos: sc.perfil_projetos,
        obras_referencia: sc.obras_referencia,
        mini_bio: sc.mini_bio,
        pontos_fortes: sc.pontos_fortes,
        gargalo_critico: sc.gargalo_critico,
        solucao_recomendada: sc.solucao_recomendada,
        argumento_prioritario: sc.argumento_prioritario,
        pontos_fracos: sc.pontos_fracos,
        analise_complementar: sc.analise_complementar ? { solucao_recomendada: sc.analise_complementar.solucao_recomendada } : undefined
    };
}

// Recorte do lead enviado à Edge Function (só o necessário; o servidor monta o prompt)
function leadParaIA(lead) {
    const sc = lead.pre_analise_scout || {};
    return {
        nome_fantasia: lead.nome_fantasia,
        cluster_estrategico: lead.cluster_estrategico,
        website_original: lead.website_original,
        ticket_estimado: lead.ticket_estimado,
        notas_operador: lead.notas_operador,
        discovery_interlocutor: lead.discovery_interlocutor,
        discovery_potencial_negocio: lead.discovery_potencial_negocio,
        discovery_inclinacao_parceria: lead.discovery_inclinacao_parceria,
        discovery_encantamento_produtos: lead.discovery_encantamento_produtos,
        discovery_demanda_imediata: lead.discovery_demanda_imediata,
        dados_segmento: lead.dados_segmento || {},
        pre_analise_scout: recortePesquisa(sc),
        timeline: (lead.timeline || []).slice(-30).map(t => ({
            tipo: t.tipo,
            direcao: t.direcao,
            autor: t.autor,
            texto: t.texto,
            iso: t.iso
        }))
    };
}

// Chama a Edge Function `ia`. Devolve { ok, ...resposta } ou { ok:false, motivo, indisponivel }
async function chamarFuncaoIA(acao, lead, ctx) {
    const token = window.AuthGate && window.AuthGate.accessToken();
    if (!token) return { ok: false, motivo: 'nao_autenticado' };
    const ctrl = new AbortController();
    const limite = setTimeout(() => ctrl.abort(), 70000);
    const enrichedCtx = {
        marca: brandCompanyName(),
        ...(ctx || {})
    };
    try {
        const resp = await fetch(`${SUPABASE_CONFIG.url}/functions/v1/ia`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'apikey': SUPABASE_CONFIG.anonKey,
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ acao, lead: leadParaIA(lead), ctx: enrichedCtx }),
            signal: ctrl.signal
        });
        if (resp.status === 404) return { ok: false, motivo: 'funcao_nao_publicada', indisponivel: true };
        const dados = await resp.json().catch(() => ({}));
        if (dados && dados.uso) {
            console.info(`IA (${acao}) via ${dados.modelo}: ${dados.uso.entrada} tokens de entrada, ${dados.uso.saida} de saída; blocos: ${(dados.blocos || []).length}`);
        }
        if (dados && (dados.tentativas || []).some(t => !t.ok)) {
            console.info('IA, rotação de modelos (tentativas anteriores):', dados.tentativas.filter(t => !t.ok).map(t => `${t.modelo}: ${t.motivo}${t.detalhe ? ' (' + t.detalhe + ')' : ''}`).join(' | '));
        }
        return resp.ok && dados.ok ? dados : { ok: false, motivo: dados.motivo || `http_${resp.status}` };
    } catch (e) {
        return {
            ok: false,
            motivo: e && e.name === 'AbortError' ? 'tempo_esgotado' : 'sem_rede',
            indisponivel: !(e && e.name === 'AbortError')
        };
    } finally {
        clearTimeout(limite);
    }
}

const SupabaseBridge = {
    /**
     * Verifica saúde da conexão com o banco
     */
    async checkConnection() {
        if (!SUPABASE_CONFIG.url || SUPABASE_CONFIG.url.includes("SEU_PROJETO") || !SUPABASE_CONFIG.anonKey) {
            return {
                online: false,
                error: "Configuração pendente em cockpit_config.js",
                status: 0
            };
        }
        const res = await supabaseRestRequest(`${SUPABASE_CONFIG.tableLeads}?select=id&limit=1`);
        return {
            online: res.success,
            error: res.error,
            status: res.status
        };
    },

    /**
     * Mantido por compatibilidade com chamadas de boot legadas.
     * Toda chave de IA agora reside na Edge Function `ia` (Supabase Secrets).
     */
    async loadRemoteConfig() {
        return { success: true };
    },

    /**
     * Converte uma linha de interacoes_sdr no formato da linha do tempo.
     */
    mapInteraction(i) {
        const op = i.operador || 'Sistema';
        const lowerOp = op.toLowerCase();
        const nossoLado = isOperatorName(op) || lowerOp.includes('você') || lowerOp.includes('voce') || lowerOp === 'eu';
        const direcao = i.direcao === 'system' ? 'system' : (nossoLado ? 'outbound' : 'inbound');
        const quando = new Date(i.data_envio || i.created_at || Date.now());
        return {
            id: i.id,
            autor: op,
            tipo: i.tipo_mensagem,
            direcao,
            iso: quando.toISOString(),
            data: quando.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }),
            texto: i.conteudo_mensagem
        };
    },

    /**
     * Busca enxuta de todos os leads (SEM interacoes_sdr embutidas) para inicialização rápida do Kanban.
     * A timeline individual é carregada sob demanda quando o operador abre o cartão.
     */
    async fetchLeadsLean() {
        const passo = 1000;
        let rawList = [];
        for (let ini = 0; ; ini += passo) {
            const query = `${SUPABASE_CONFIG.tableLeads}?select=*&order=created_at.desc,id.asc&limit=${passo}&offset=${ini}`;
            const res = await supabaseRestRequest(query);
            if (!res.success) {
                console.error("❌ Erro ao buscar leads (lean) no Supabase:", res.error);
                return { success: false, data: null, error: res.error };
            }
            const lote = Array.isArray(res.data) ? res.data : [];
            rawList = rawList.concat(lote);
            if (lote.length < passo) break;
        }
        const leads = rawList.map(lead => ({
            ...lead,
            timeline: [],
            _timelineLoaded: false
        }));
        return { success: true, data: leads, error: null };
    },

    /**
     * Busca apenas os leads criados ou atualizados após `sinceIso` (Delta Sync).
     */
    async fetchLeadsDelta(sinceIso) {
        if (!sinceIso) return this.fetchLeadsLean();
        const passo = 1000;
        let rawList = [];
        const filtro = encodeURIComponent(sinceIso);
        for (let ini = 0; ; ini += passo) {
            const query = `${SUPABASE_CONFIG.tableLeads}?select=*&updated_at=gt.${filtro}&order=updated_at.asc,id.asc&limit=${passo}&offset=${ini}`;
            const res = await supabaseRestRequest(query);
            if (!res.success) {
                return { success: false, data: null, error: res.error };
            }
            const lote = Array.isArray(res.data) ? res.data : [];
            rawList = rawList.concat(lote);
            if (lote.length < passo) break;
        }
        return { success: true, data: rawList, error: null };
    },

    /**
     * Busca IDs de leads excluídos após `sinceIso` na tabela `exclusoes_sync`.
     * Se a tabela ainda não existir no banco, falha silenciosamente devolvendo lista vazia.
     */
    async fetchDeletionsSince(sinceIso) {
        if (!sinceIso) return { success: true, data: [] };
        const filtro = encodeURIComponent(sinceIso);
        const query = `${SUPABASE_CONFIG.tableDeletions}?select=registro_id,deleted_at&tabela=eq.${SUPABASE_CONFIG.tableLeads}&deleted_at=gt.${filtro}&order=deleted_at.asc&limit=1000`;
        const res = await supabaseRestRequest(query);
        if (!res.success) {
            return { success: true, data: [] };
        }
        const ids = (Array.isArray(res.data) ? res.data : []).map(r => r.registro_id).filter(Boolean);
        return { success: true, data: ids };
    },

    /**
     * Busca sob demanda o histórico (`interacoes_sdr`) de um único lead ao abrir o cartão.
     */
    async fetchLeadTimeline(leadId) {
        if (!leadId) return { success: false, data: [], error: 'ID do lead ausente' };
        const query = `${SUPABASE_CONFIG.tableInteractions}?select=*&empresa_id=eq.${leadId}&order=data_envio.asc,created_at.asc&limit=500`;
        const res = await supabaseRestRequest(query);
        if (!res.success) {
            return { success: false, data: [], error: res.error };
        }
        const rows = Array.isArray(res.data) ? res.data : [];
        const timeline = rows.map(i => this.mapInteraction(i));
        return { success: true, data: timeline, error: null };
    },

    /**
     * Busca completa (leads + interações embutidas). Mantida para exportações ou fallback.
     */
    async fetchLeads() {
        const passo = 1000;
        let rawList = [];
        for (let ini = 0; ; ini += passo) {
            const query = `${SUPABASE_CONFIG.tableLeads}?select=*,${SUPABASE_CONFIG.tableInteractions}(*)&order=created_at.desc,id.asc&limit=${passo}&offset=${ini}`;
            const res = await supabaseRestRequest(query);
            if (!res.success) {
                console.error("❌ Erro ao buscar leads no Supabase:", res.error);
                return { success: false, data: null, error: res.error };
            }
            const lote = Array.isArray(res.data) ? res.data : [];
            rawList = rawList.concat(lote);
            if (lote.length < passo) break;
        }
        const leads = rawList.map(lead => {
            const rawInteractions = lead[SUPABASE_CONFIG.tableInteractions] || [];
            return {
                ...lead,
                timeline: rawInteractions.slice().sort((a, b) =>
                    new Date(a.data_envio || a.created_at || 0) - new Date(b.data_envio || b.created_at || 0)
                ).map(i => this.mapInteraction(i)),
                _timelineLoaded: true
            };
        });

        return { success: true, data: leads, error: null };
    },

    /**
     * Atualiza o status Kanban de um lead
     */
    async updateStatus(leadId, newStatus) {
        return this.updateLead(leadId, { status_kanban: newStatus });
    },

    /**
     * Atualiza as variáveis de discovery de um lead
     */
    async updateDiscovery(leadId, discoveryData) {
        return this.updateLead(leadId, discoveryData);
    },

    /**
     * Atualiza campos arbitrários de um lead com validação atômica
     */
    async updateLead(leadId, fields) {
        if (!leadId) {
            return { success: false, error: "ID do lead não fornecido para atualização." };
        }

        const res = await supabaseRestRequest(`${SUPABASE_CONFIG.tableLeads}?id=eq.${leadId}`, {
            method: 'PATCH',
            body: fields,
            prefer: 'return=representation'
        });

        if (!res.success) {
            return { success: false, error: res.error, data: null };
        }

        const updatedRow = (Array.isArray(res.data) && res.data.length > 0) ? res.data[0] : res.data;
        return { success: true, data: updatedRow, error: null };
    },

    /**
     * Insere um novo lead
     */
    async insertLead(leadData) {
        const res = await supabaseRestRequest(SUPABASE_CONFIG.tableLeads, {
            method: 'POST',
            body: leadData,
            prefer: 'return=representation'
        });

        if (!res.success) {
            return { success: false, error: res.error, data: null };
        }

        const insertedRow = (Array.isArray(res.data) && res.data.length > 0) ? res.data[0] : res.data;
        return { success: true, data: insertedRow, error: null };
    },

    /**
     * Insere uma interação na timeline ou nota de operador
     */
    async insertInteraction(leadId, tipoMensagem, conteudo, direcao = 'outbound', operador = null) {
        operador = operador || currentOperatorName();
        const payload = {
            empresa_id: leadId,
            tipo_mensagem: tipoMensagem,
            conteudo_mensagem: conteudo,
            direcao: direcao,
            operador: operador,
            data_envio: new Date().toISOString()
        };

        const res = await supabaseRestRequest(SUPABASE_CONFIG.tableInteractions, {
            method: 'POST',
            body: payload,
            prefer: 'return=representation'
        });

        if (!res.success) {
            return { success: false, error: res.error, data: null };
        }

        const inserted = (Array.isArray(res.data) && res.data.length > 0) ? res.data[0] : res.data;
        return { success: true, data: inserted, error: null };
    },

    /**
     * Insere múltiplas mensagens (ex: fluxo exportado do WhatsApp)
     */
    async insertMultipleInteractions(leadId, messages) {
        if (!Array.isArray(messages) || messages.length === 0) {
            return { success: true, data: [] };
        }

        const rows = messages.map(m => ({
            empresa_id: leadId,
            tipo_mensagem: m.tipo_mensagem || 'whatsapp_chat',
            conteudo_mensagem: m.texto,
            direcao: m.direcao || 'outbound',
            operador: m.autor || currentOperatorName(),
            data_envio: m.data_envio || new Date().toISOString()
        }));

        const res = await supabaseRestRequest(SUPABASE_CONFIG.tableInteractions, {
            method: 'POST',
            body: rows,
            prefer: 'return=representation'
        });

        if (!res.success) {
            return { success: false, error: res.error, data: null };
        }

        return { success: true, data: res.data, error: null };
    },

    /**
     * Atualiza o conteúdo de uma mensagem ou nota existente
     */
    async updateInteraction(interactionId, novoConteudo) {
        if (!interactionId) {
            return { success: false, error: "ID da interação não informado." };
        }

        const res = await supabaseRestRequest(`${SUPABASE_CONFIG.tableInteractions}?id=eq.${interactionId}`, {
            method: 'PATCH',
            body: { conteudo_mensagem: novoConteudo },
            prefer: 'return=representation'
        });

        return res;
    },

    /**
     * Exclui uma interação ou nota da timeline
     */
    async deleteInteraction(interactionId) {
        if (!interactionId) {
            return { success: false, error: "ID da interação não informado." };
        }

        const res = await supabaseRestRequest(`${SUPABASE_CONFIG.tableInteractions}?id=eq.${interactionId}`, {
            method: 'DELETE'
        });

        return res;
    },

    /**
     * Exclui múltiplas interações em lote
     */
    async deleteMultipleInteractions(ids) {
        if (!Array.isArray(ids) || ids.length === 0) {
            return { success: true };
        }

        const inFilter = `in.(${ids.join(',')})`;
        const res = await supabaseRestRequest(`${SUPABASE_CONFIG.tableInteractions}?id=${inFilter}`, {
            method: 'DELETE'
        });

        return res;
    },

    /**
     * Inscrição em Realtime para atualizações dinâmicas
     */
    subscribe(onEvent) {
        if (!sbSdkClient) return null;
        try {
            const channel = sbSdkClient
                .channel('public:cockpit_leads')
                .on('postgres_changes', { event: '*', schema: 'public', table: SUPABASE_CONFIG.tableLeads }, payload => {
                    onEvent(payload);
                })
                .subscribe();
            return channel;
        } catch (e) {
            console.warn("Realtime indisponível:", e);
            return null;
        }
    },

    /**
     * Analisa a cadência comportamental das mensagens
     */
    analyzeCadence(lead) {
        const msgs = (lead.timeline || []).filter(t => t.tipo !== 'nota_operador');
        if (msgs.length === 0) {
            return {
                padraoGeral: "Contato inicial (D0) pendente",
                horarioPreferencial: "Horário comercial padrão (09h - 17h)",
                tempoRespostaMedio: "Primeiro contato",
                estiloResposta: "Não mapeado"
            };
        }

        const inboundCount = msgs.filter(m => m.direcao === 'inbound').length;
        const outboundCount = msgs.filter(m => m.direcao === 'outbound').length;

        let padrao = "Cadência equilibrada";
        if (inboundCount === 0 && outboundCount > 1) {
            padrao = "Lead em vácuo (Aguardando quebra)";
        } else if (inboundCount > outboundCount) {
            padrao = "Lead altamente responsivo";
        }

        return {
            padraoGeral: padrao,
            horarioPreferencial: "Horário comercial (Manhã / Tarde)",
            tempoRespostaMedio: inboundCount > 0 ? "Ativo" : "Aguardando",
            estiloResposta: "Objetivo"
        };
    },

    /**
     * Calcula a data nominal de follow-up amigável no calendário
     */
    calculateNominalFollowupDate(lead, targetStage = null) {
        const stage = targetStage || lead.status_kanban || getInitialStageId();
        const now = new Date();
        const diasSemana = ["Domingo", "Segunda-feira", "Terça-feira", "Quarta-feira", "Quinta-feira", "Sexta-feira", "Sábado"];

        const fu = (typeof CockpitConfig !== 'undefined' && CockpitConfig.followupDays) || {};
        const addDays = (fu[stage] !== undefined) ? fu[stage] : 2;

        const targetDate = new Date(now.getTime() + (addDays * 24 * 60 * 60 * 1000));
        if (targetDate.getDay() === 0) targetDate.setDate(targetDate.getDate() + 1);
        if (targetDate.getDay() === 6) targetDate.setDate(targetDate.getDate() + 2);

        const d = String(targetDate.getDate()).padStart(2, '0');
        const m = String(targetDate.getMonth() + 1).padStart(2, '0');
        const y = targetDate.getFullYear();
        const diaNome = diasSemana[targetDate.getDay()];

        return `${diaNome}, ${d}/${m}/${y} às 10:30`;
    },

    /**
     * Consulta a IA via Edge Function `ia` para análise do Smart Console
     */
    async consultGeminiBrain(lead, userInput) {
        const etapas = (CockpitConfig.stages || []).map(s => ({ id: s.id, label: s.label }));
        const cat = (CockpitConfig.categories || []).find(c => c.id === lead.cluster_estrategico) || {};
        const atual = lead.status_kanban || getInitialStageId();
        const r = await chamarFuncaoIA('console', lead, {
            contato: lead.contato_responsavel || '',
            categoriaLabel: cat.label || lead.cluster_estrategico,
            etapaId: atual,
            etapaLabel: (etapas.find(e => e.id === atual) || {}).label || atual,
            operador: currentOperatorName(),
            pedido: userInput,
            etapas
        });
        if (r.ok) {
            return {
                success: true,
                modelUsed: r.modelo,
                error: null,
                data: {
                    sugestao_resposta: r.sugestao_resposta,
                    status_sugerido: r.status_sugerido,
                    status_sugerido_nome: r.status_sugerido_nome,
                    perfil_cadencia: r.perfil_cadencia,
                    proximo_followup_nominal: this.calculateNominalFollowupDate(lead, r.status_sugerido)
                }
            };
        }
        return {
            success: false,
            data: null,
            error: r.motivo === 'cota'
                ? 'Limite de uso da IA atingido em todos os modelos configurados; tente novamente em instantes.'
                : `IA indisponível (${r.motivo}). Verifique se a Edge Function 'ia' e o secret GEMINI_KEY estão ativos.`
        };
    },

    /**
     * Gera a próxima mensagem de WhatsApp com IA via Edge Function `ia`.
     */
    async generateNextMessageAI(lead, ctx) {
        const r = await chamarFuncaoIA('mensagem', lead, ctx);
        if (r.ok) return { success: true, text: r.texto, modelUsed: r.modelo };
        return {
            success: false,
            reason: ['sem_chave', 'cota'].includes(r.motivo) ? r.motivo : 'erro',
            error: r.motivo
        };
    },

    /**
     * Enriquecimento de novo lead via Edge Function `ia` (Lead Scout V2)
     */
    async enrichLeadScoutAI(leadData) {
        const categoriasCfg = (typeof CockpitConfig !== 'undefined' && CockpitConfig.categories) ? CockpitConfig.categories : [];
        const cluster = leadData.cluster_estrategico || "Geral";
        const cat = categoriasCfg.find(c => c.id === cluster) || categoriasCfg[0] || {
            label: cluster,
            defaultTicket: 0,
            caseHeroName: 'Catálogo Oficial',
            caseHeroUrl: ''
        };
        const site = (leadData.website_original || '').trim();
        const siteUrl = site && !/n[aã]o possui|ausente/i.test(site)
            ? (/^https?:\/\//i.test(site) ? site : 'https://' + site)
            : '';

        const r = await chamarFuncaoIA('analise', {
            nome_fantasia: leadData.nome_fantasia,
            cluster_estrategico: cluster,
            website_original: leadData.website_original,
            dados_segmento: leadData.dados_segmento || {},
            timeline: [],
            notas_operador: leadData.notas_operador,
            pre_analise_scout: recortePesquisa(leadData.pre_analise_scout)
        }, {
            contato: leadData.contato_responsavel || '',
            categoriaLabel: cat.label || cluster,
            siteUrl,
            historico: leadData.historico || '',
            etapaId: leadData.etapaId || 'aguardando_contato',
            etapaLabel: leadData.etapaLabel || 'Aguardando Contato',
            operador: currentOperatorName()
        });

        if (r.ok && r.insuficiente) {
            return { insuficiente: true, analise_ia: false, mensagem: r.mensagem };
        }
        if (r.ok && r.dossie) {
            return {
                ...r.dossie,
                case_hero: cat.caseHeroUrl,
                website: leadData.website_original || 'Não possui site cadastrado',
                ticket_estimado: cat.defaultTicket || 0
            };
        }

        // Alternativa determinística sem IA (quando a função ainda não está publicada ou sem rede)
        const nome = leadData.nome_fantasia || "sua empresa";
        const contato = leadData.contato_responsavel || "";
        const marca = brandCompanyName();
        const subtitulo = (typeof CockpitConfig !== 'undefined' && CockpitConfig.brand?.subtitle) || 'soluções comerciais B2B';
        const saudacao = contato
            ? `Gostaria de falar com ${contato}.`
            : `Gostaria de falar com o(a) responsável pela área de compras e parcerias.`;
        const ganchoPadrao = `Olá, bom dia! Tudo bem?\n\nPesquisei empresas do segmento de ${cat.label.replace(/^B2[BC] • /, '')} e encontrei a ${nome}. ${saudacao}\n\nFalo da ${marca} (${subtitulo}). Posso enviar nosso catálogo para avaliação?`;

        return {
            case_hero: cat.caseHeroUrl,
            website: leadData.website_original || "Não possui site cadastrado",
            status_presenca: `Perfil: ${cat.label}.`,
            pontos_fortes: "",
            pontos_fracos: "",
            gargalo_critico: "",
            solucao_recomendada: "",
            analise_ia: false,
            ticket_estimado: cat.defaultTicket || 0,
            gancho_kickoff_gerado: ganchoPadrao
        };
    }
};

if (typeof window !== 'undefined') {
    window.SupabaseBridge = SupabaseBridge;
}
if (typeof module !== 'undefined' && module.exports) {
    module.exports = SupabaseBridge;
}
