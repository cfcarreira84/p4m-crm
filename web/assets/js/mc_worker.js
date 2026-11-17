/**
 * ==============================================================================
 * WEB WORKER - MOTOR DE MONTE CARLO ASSÍNCRONO (10.000 ITERAÇÕES FORA DA UI THREAD)
 * ==============================================================================
 * Recebe { id, leads, iterations, config } e devolve { id, result } sem travar a
 * renderização do Kanban ou a abertura de modais em máquinas/conexões lentas.
 * ==============================================================================
 */

self.onmessage = function (e) {
    const { id, leads, iterations = 10000, config = {} } = e.data || {};
    const categories = config.categories || [];
    const stages = config.stages || [];
    const mcConfig = config.monteCarlo || {};

    function getBaseRate(clusterId) {
        const cat = categories.find(c => c.id === clusterId);
        if (cat && cat.baseRate) return cat.baseRate;
        return 0.25;
    }

    function getWeights() {
        if (mcConfig.weights) return mcConfig.weights;
        return {
            interlocutor: { dono_socio: 1.45, atendente_balcao: 0.40, indefinido: 1.00 },
            potencial_negocio: { curto_prazo: 1.25, medio_prazo: 1.00, longo_prazo: 0.70, indefinido: 1.00 },
            inclinacao_parceria: { baixo: 0.60, medio: 1.00, alto: 1.35, indefinido: 1.00 },
            demanda_imediata: { sim: 1.40, nao: 0.90, indefinido: 1.00 },
            interlocutor_b2c: { comprador: 1.45, arquiteto: 1.15, representante: 0.70, indefinido: 1.00 },
            encantamento_produtos: { baixo: 0.60, medio: 1.00, alto: 1.35, indefinido: 1.00 },
            prioridade: { alta: 1.20, media_alta: 1.10, media: 1.00, baixa: 0.85, a_qualificar: 0.95 }
        };
    }

    function isLostStage(stageId) {
        const st = stages.find(s => s.id === stageId);
        if (st && (st.isLost || st.isAlert)) return true;
        return ['declinou', 'atencao'].includes(stageId);
    }

    function isInitialStage(stageId) {
        const st = stages.find(s => s.id === stageId);
        if (st) return Boolean(st.isInitial);
        return stageId === 'aguardando_contato';
    }

    function isProposalStage(stageId) {
        const st = stages.find(s => s.id === stageId);
        if (st && st.isProposal) return true;
        return ['proposta', 'oferta'].includes(stageId);
    }

    function calculateLeadScore(lead) {
        if (isLostStage(lead.status_kanban)) return 0;
        let base = getBaseRate(lead.cluster_estrategico);
        const stageMultipliers = mcConfig.stageMultipliers || {
            oferta: 2.8,
            proposta: 2.5,
            interessado: 1.8,
            retomar_em: 1.6,
            atendimento: 1.2
        };
        if (stageMultipliers[lead.status_kanban]) {
            base *= stageMultipliers[lead.status_kanban];
        } else if (isProposalStage(lead.status_kanban)) {
            base *= 2.5;
        }
        const weights = getWeights();
        const cat = categories.find(c => c.id === lead.cluster_estrategico) || {};
        const b2c = cat.matriz === 'b2c';
        const w1 = ((b2c ? weights.interlocutor_b2c : weights.interlocutor) || {})[lead.discovery_interlocutor || 'indefinido'] || 1.0;
        const w2 = (weights.potencial_negocio || {})[lead.discovery_potencial_negocio || 'indefinido'] || 1.0;
        const w3 = (b2c
            ? (weights.encantamento_produtos || {})[lead.discovery_encantamento_produtos || 'indefinido']
            : (weights.inclinacao_parceria || {})[lead.discovery_inclinacao_parceria || 'indefinido']) || 1.0;
        const w4 = (weights.demanda_imediata || {})[lead.discovery_demanda_imediata || 'indefinido'] || 1.0;
        let prior = (weights.prioridade && weights.prioridade[lead.prioridade_carga]) || 1.0;
        if (!isInitialStage(lead.status_kanban)) prior = Math.sqrt(prior);
        return base * w1 * w2 * w3 * w4 * prior;
    }

    function calculateLeadProbability(lead) {
        if (isLostStage(lead.status_kanban)) return 0.00;
        return Math.min(Math.max(calculateLeadScore(lead), 0.02), 0.95);
    }

    if (!leads || leads.length === 0) {
        self.postMessage({
            id,
            result: {
                forecastPonderado: 0,
                forecastPotencial: 0,
                pipelineBrutoPropostas: 0,
                pipelineBrutoTotal: 0,
                taxaConversaoMedia: 0,
                distribution: [],
                numPropostas: 0,
                numAndamento: 0
            }
        });
        return;
    }

    let pipelineBrutoTotal = 0;
    let pipelineBrutoPropostas = 0;
    let forecastPonderado = 0;
    let forecastPotencial = 0;
    let propostasCount = 0;
    let andamentoCount = 0;

    const activeLeads = [];

    for (let i = 0; i < leads.length; i++) {
        const l = leads[i];
        if (isLostStage(l.status_kanban) || l.is_arquivado) continue;
        const ticket = (l.ticket_estimado !== undefined && l.ticket_estimado !== null && !isNaN(Number(l.ticket_estimado)))
            ? Number(l.ticket_estimado)
            : 0;
        const prob = calculateLeadProbability(l);
        pipelineBrutoTotal += ticket;
        if (isProposalStage(l.status_kanban)) {
            pipelineBrutoPropostas += ticket;
            forecastPonderado += ticket * prob;
            propostasCount++;
        } else if (!isInitialStage(l.status_kanban)) {
            forecastPotencial += ticket * prob;
            andamentoCount++;
        }
        if (ticket > 0 && prob > 0) {
            activeLeads.push({ ticket, prob });
        }
    }

    const simulationResults = new Float64Array(iterations);
    for (let i = 0; i < iterations; i++) {
        let iterRevenue = 0;
        for (let j = 0; j < activeLeads.length; j++) {
            const al = activeLeads[j];
            if (Math.random() < al.prob) {
                iterRevenue += al.ticket;
            }
        }
        simulationResults[i] = iterRevenue;
    }

    simulationResults.sort();

    const taxaConversaoMedia = pipelineBrutoTotal > 0
        ? Math.round(((forecastPonderado + forecastPotencial) / pipelineBrutoTotal) * 100)
        : 0;

    const minVal = simulationResults[0] || 0;
    const maxVal = simulationResults[simulationResults.length - 1] || 1;
    const rangeStep = (maxVal - minVal) / 5 || 1000;

    const buckets = [0, 0, 0, 0, 0];
    for (let i = 0; i < iterations; i++) {
        const val = simulationResults[i];
        const idx = Math.min(Math.floor((val - minVal) / rangeStep), 4);
        buckets[idx]++;
    }

    const distribution = buckets.map((count, i) => {
        const start = minVal + (i * rangeStep);
        const end = start + rangeStep;
        return {
            rangeLabel: `R$ ${(start / 1000).toFixed(0)}k - R$ ${(end / 1000).toFixed(0)}k`,
            pct: Math.round((count / iterations) * 100)
        };
    });

    self.postMessage({
        id,
        result: {
            forecastPonderado: Math.round(forecastPonderado),
            forecastPotencial: Math.round(forecastPotencial),
            pipelineBrutoPropostas,
            pipelineBrutoTotal,
            taxaConversaoMedia,
            distribution,
            numPropostas: propostasCount,
            numAndamento: andamentoCount
        }
    });
};
