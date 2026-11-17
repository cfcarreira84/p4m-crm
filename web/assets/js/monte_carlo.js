/**
 * ==============================================================================
 * MOTOR PREDITIVO DE MONTE CARLO - SDR COCKPIT (10.000 ITERAÇÕES)
 * ==============================================================================
 * Executa simulações probabilísticas com base nas 4 variáveis de discovery,
 * no estágio atual do funil Kanban e no cluster/categoria do negócio.
 * Totalmente parametrizável via cockpit_config.js.
 * ==============================================================================
 */

const MonteCarloEngine = {
    /**
     * Retorna a taxa base para um cluster específico
     */
    getBaseRate(clusterId) {
        if (typeof CockpitConfig !== 'undefined' && CockpitConfig.categories) {
            const cat = CockpitConfig.categories.find(c => c.id === clusterId);
            if (cat && cat.baseRate) return cat.baseRate;
        }
        return 0.25; // Taxa média padrão
    },

    /**
     * Retorna os pesos de discovery (configuráveis ou padrão)
     */
    getWeights() {
        if (typeof CockpitConfig !== 'undefined' && CockpitConfig.monteCarlo?.weights) {
            return CockpitConfig.monteCarlo.weights;
        }
        return {
            interlocutor: { dono_socio: 1.45, atendente_balcao: 0.40, indefinido: 1.00 },
            potencial_negocio: { curto_prazo: 1.25, medio_prazo: 1.00, longo_prazo: 0.70, indefinido: 1.00 },
            inclinacao_parceria: { baixo: 0.60, medio: 1.00, alto: 1.35, indefinido: 1.00 },
            demanda_imediata: { sim: 1.40, nao: 0.90, indefinido: 1.00 },
            interlocutor_b2c: { comprador: 1.45, arquiteto: 1.15, representante: 0.70, indefinido: 1.00 },
            encantamento_produtos: { baixo: 0.60, medio: 1.00, alto: 1.35, indefinido: 1.00 },
            prioridade: { alta: 1.20, media_alta: 1.10, media: 1.00, baixa: 0.85, a_qualificar: 0.95 }
        };
    },

    /**
     * Verifica se um estágio é de perda/descarte
     */
    /**
     * Em qual valor do cabeçalho o lead entra: 'ponderado' (proposta ativa), 'potencial' (funil em andamento),
     * 'fechados' (venda realizada) ou null. Mesma regra de simulatePipeline, usada também pelo filtro dos botões.
     */
    classificarForecast(l) {
        if (l.status_venda === 'venda_realizada' || (l.valor_fechado && Number(l.valor_fechado) > 0)) return 'fechados';
        if (this.isLostStage(l.status_kanban) || l.is_arquivado) return null;
        if (this.isProposalStage(l.status_kanban)) return 'ponderado';
        if (!this.isInitialStage(l.status_kanban)) return 'potencial';
        return null;
    },

    isLostStage(stageId) {
        if (typeof CockpitConfig !== 'undefined' && CockpitConfig.stages) {
            const st = CockpitConfig.stages.find(s => s.id === stageId);
            if (st && (st.isLost || st.isAlert)) return true;
        }
        return ['declinou', 'atencao'].includes(stageId);
    },

    /**
     * Verifica se um estágio é a fase de entrada (ainda sem contato)
     */
    isInitialStage(stageId) {
        if (typeof CockpitConfig !== 'undefined' && CockpitConfig.stages) {
            const st = CockpitConfig.stages.find(s => s.id === stageId);
            if (st) return !!st.isInitial;
        }
        return stageId === 'aguardando_contato';
    },

    /**
     * Verifica se um estágio é de fechamento/proposta ativa
     */
    isProposalStage(stageId) {
        if (typeof CockpitConfig !== 'undefined' && CockpitConfig.stages) {
            const st = CockpitConfig.stages.find(s => s.id === stageId);
            if (st && st.isProposal) return true;
        }
        return ['proposta', 'oferta'].includes(stageId);
    },

    /**
     * Calcula a probabilidade individual de fechamento de um lead (0.00 a 1.00)
     */
    calculateLeadProbability(lead) {
        if (this.isLostStage(lead.status_kanban)) {
            return 0.00;
        }
        return Math.min(Math.max(this.calculateLeadScore(lead), 0.02), 0.95);
    },

    /**
     * Pontuação bruta (sem os limites de 2% a 95%). Usada para ordenar o Kanban:
     * evita que leads muito quentes empatem todos em 95%.
     */
    calculateLeadScore(lead) {
        if (this.isLostStage(lead.status_kanban)) {
            return 0;
        }

        let base = this.getBaseRate(lead.cluster_estrategico);

        // Multiplicadores de estágio
        const stageMultipliers = (typeof CockpitConfig !== 'undefined' && CockpitConfig.monteCarlo?.stageMultipliers)
            ? CockpitConfig.monteCarlo.stageMultipliers
            : {
                oferta: 2.8,
                proposta: 2.5,
                interessado: 1.8,
                retomar_em: 1.6,
                atendimento: 1.2
            };

        if (stageMultipliers[lead.status_kanban]) {
            base *= stageMultipliers[lead.status_kanban];
        } else if (this.isProposalStage(lead.status_kanban)) {
            base *= 2.5;
        }

        // Variáveis de Discovery
        const weights = this.getWeights();
        // B2C usa outra matriz: interlocutor (comprador, arquiteto, representante) e encantamento com os produtos
        const cat = (typeof CockpitConfig !== 'undefined' && CockpitConfig.categories || []).find(c => c.id === lead.cluster_estrategico) || {};
        const b2c = cat.matriz === 'b2c';
        const w1 = ((b2c ? weights.interlocutor_b2c : weights.interlocutor) || {})[lead.discovery_interlocutor || 'indefinido'] || 1.0;
        const w2 = weights.potencial_negocio[lead.discovery_potencial_negocio || 'indefinido'] || 1.0;
        const w3 = (b2c ? (weights.encantamento_produtos || {})[lead.discovery_encantamento_produtos || 'indefinido']
                        : weights.inclinacao_parceria[lead.discovery_inclinacao_parceria || 'indefinido']) || 1.0;
        const w4 = weights.demanda_imediata[lead.discovery_demanda_imediata || 'indefinido'] || 1.0;

        // Prioridade da base: plena na fase inicial; depois, atenuada (raiz quadrada)
        let prior = (weights.prioridade && weights.prioridade[lead.prioridade_carga]) || 1.0;
        if (!this.isInitialStage(lead.status_kanban)) prior = Math.sqrt(prior);

        return base * w1 * w2 * w3 * w4 * prior;
    },

    /**
     * Comparador de ordenação do Kanban: maior pontuação primeiro; empate pelo maior ticket;
     * persistindo o empate, o cadastro mais recente fica no topo.
     */
    compareLeads(a, b) {
        const diff = this.calculateLeadScore(b) - this.calculateLeadScore(a);
        if (Math.abs(diff) > 1e-9) return diff;
        // Dentro do mesmo score, a pontuação de qualificação da base desempata antes do ticket
        const pt = (Number(b.pontuacao_carga) || 0) - (Number(a.pontuacao_carga) || 0);
        if (pt !== 0) return pt;
        const tk = (Number(b.ticket_estimado) || 0) - (Number(a.ticket_estimado) || 0);
        if (tk !== 0) return tk;
        return new Date(b.created_at || 0) - new Date(a.created_at || 0);
    },

    /**
     * Executa simulações estocásticas diferenciando:
     * 1. Forecast Ponderado (estritamente propostas ativas em fechamento)
     * 2. Forecast Potencial (oportunidades em andamento no funil)
     */
    simulatePipeline(leads, iterations = 10000) {
        if (!leads || leads.length === 0) {
            return {
                forecastPonderado: 0,
                forecastPotencial: 0,
                pipelineBrutoPropostas: 0,
                pipelineBrutoTotal: 0,
                taxaConversaoMedia: 0,
                distribution: [],
                numPropostas: 0,
                numAndamento: 0
            };
        }

        let pipelineBrutoTotal = 0;
        let pipelineBrutoPropostas = 0;
        let forecastPonderado = 0;
        let forecastPotencial = 0;
        let propostasCount = 0;
        let andamentoCount = 0;

        leads.forEach(l => {
            const ticket = (l.ticket_estimado !== undefined && l.ticket_estimado !== null && !isNaN(Number(l.ticket_estimado)))
                ? Number(l.ticket_estimado)
                : 0;
            const prob = this.calculateLeadProbability(l);

            if (!this.isLostStage(l.status_kanban) && !l.is_arquivado) {
                pipelineBrutoTotal += ticket;

                if (this.isProposalStage(l.status_kanban)) {
                    pipelineBrutoPropostas += ticket;
                    forecastPonderado += ticket * prob;
                    propostasCount++;
                } else if (!this.isInitialStage(l.status_kanban)) {
                    forecastPotencial += ticket * prob;
                    andamentoCount++;
                }
            }
        });

        // Simulação estocástica para a curva de distribuição
        const simulationResults = [];
        for (let i = 0; i < iterations; i++) {
            let iterRevenue = 0;
            leads.forEach(l => {
                if (!this.isLostStage(l.status_kanban) && !l.is_arquivado) {
                    const prob = this.calculateLeadProbability(l);
                    if (Math.random() < prob) {
                        const ticket = (l.ticket_estimado !== undefined && l.ticket_estimado !== null && !isNaN(Number(l.ticket_estimado)))
                            ? Number(l.ticket_estimado)
                            : 0;
                        iterRevenue += ticket;
                    }
                }
            });
            simulationResults.push(iterRevenue);
        }

        simulationResults.sort((a, b) => a - b);

        const taxaConversaoMedia = pipelineBrutoTotal > 0
            ? Math.round(((forecastPonderado + forecastPotencial) / pipelineBrutoTotal) * 100)
            : 0;

        // Distribuição em 5 faixas (Histograma)
        const minVal = simulationResults[0] || 0;
        const maxVal = simulationResults[simulationResults.length - 1] || 1;
        const rangeStep = (maxVal - minVal) / 5 || 1000;

        const buckets = [0, 0, 0, 0, 0];
        simulationResults.forEach(val => {
            let idx = Math.min(Math.floor((val - minVal) / rangeStep), 4);
            buckets[idx]++;
        });

        const distribution = buckets.map((count, i) => {
            const start = minVal + (i * rangeStep);
            const end = start + rangeStep;
            return {
                rangeLabel: `R$ ${(start / 1000).toFixed(0)}k - R$ ${(end / 1000).toFixed(0)}k`,
                pct: Math.round((count / iterations) * 100)
            };
        });

        return {
            forecastPonderado: Math.round(forecastPonderado),
            forecastPotencial: Math.round(forecastPotencial),
            pipelineBrutoPropostas,
            pipelineBrutoTotal,
            taxaConversaoMedia,
            distribution,
            numPropostas: propostasCount,
            numAndamento: andamentoCount
        };
    },

    _worker: null,
    _workerSeq: 0,
    _workerCallbacks: new Map(),

    /**
     * Executa a simulação de 10.000 iterações em um Web Worker dedicado (se disponível no navegador),
     * mantendo a UI 100% fluida. Em ambientes sem Worker (ex.: Node.js), usa o fallback síncrono.
     */
    simulatePipelineAsync(leads, iterations = 10000) {
        if (typeof Worker === 'undefined' || typeof window === 'undefined') {
            return Promise.resolve(this.simulatePipeline(leads, iterations));
        }
        try {
            if (!this._worker) {
                this._worker = new Worker('assets/js/mc_worker.js');
                this._worker.onmessage = (e) => {
                    const { id, result } = e.data || {};
                    const cb = this._workerCallbacks.get(id);
                    if (cb) {
                        this._workerCallbacks.delete(id);
                        cb(result);
                    }
                };
                this._worker.onerror = () => {
                    this._worker = null;
                };
            }
            const reqId = ++this._workerSeq;
            const leanLeads = (leads || []).map(l => ({
                status_kanban: l.status_kanban,
                is_arquivado: l.is_arquivado,
                ticket_estimado: l.ticket_estimado,
                cluster_estrategico: l.cluster_estrategico,
                discovery_interlocutor: l.discovery_interlocutor,
                discovery_potencial_negocio: l.discovery_potencial_negocio,
                discovery_inclinacao_parceria: l.discovery_inclinacao_parceria,
                discovery_encantamento_produtos: l.discovery_encantamento_produtos,
                discovery_demanda_imediata: l.discovery_demanda_imediata,
                prioridade_carga: l.prioridade_carga
            }));
            const config = typeof CockpitConfig !== 'undefined' ? {
                categories: CockpitConfig.categories || [],
                stages: CockpitConfig.stages || [],
                monteCarlo: CockpitConfig.monteCarlo || {}
            } : {};

            return new Promise((resolve) => {
                const timer = setTimeout(() => {
                    if (this._workerCallbacks.has(reqId)) {
                        this._workerCallbacks.delete(reqId);
                        resolve(this.simulatePipeline(leads, iterations));
                    }
                }, 4000);
                this._workerCallbacks.set(reqId, (res) => {
                    clearTimeout(timer);
                    resolve(res);
                });
                this._worker.postMessage({ id: reqId, leads: leanLeads, iterations, config });
            });
        } catch (err) {
            return Promise.resolve(this.simulatePipeline(leads, iterations));
        }
    }
};

if (typeof window !== 'undefined') {
    window.MonteCarloEngine = MonteCarloEngine;
}
if (typeof module !== 'undefined' && module.exports) {
    module.exports = MonteCarloEngine;
}

