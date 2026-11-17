/**
 * ==============================================================================
 * P4M SDR COCKPIT - CONFIGURAÇÃO CENTRALIZADA (cockpit_config.js)
 * ==============================================================================
 * Gerado por `python tools/setup_projeto.py` a partir de `project.config.json`.
 * SEGURANÇA: aqui entra SOMENTE a chave publicável (anon).
 * ==============================================================================
 */

const CockpitConfig = {
    brand: {
        appName: "P4m SDR Cockpit",
        productName: "P4m CRM",
        companyName: "P4m",
        tagline: "Esteira comercial consultiva B2B & Network",
        logoIcon: "zap",
        currencySymbol: "R$",
        catalogUrl: "https://per4media.com.br/crm",
        operators: [
            {
                "key": "joao",
                "name": "João"
            },
            {
                "key": "cf",
                "name": "CF"
            }
        ],
        // <version-sync:start>
        version: "v2.1.0",
        versionHistory: [
            {
                "tag": "v2.1.0",
                "commit": "63404a2",
                "desc": "v2.1.0 - Leitura integral do cartao, clique+copia rapida na previa e cascata gemini-3-flash-preview"
            },
            {
                "tag": "v2.0.0",
                "commit": "a6877f6",
                "desc": "SDR Cockpit Starter v2.0.0 — Organismo vivo multi-segmento, cache IndexedDB + sync delta, Monte Carlo em Web Worker e pipeline de dados completo"
            }
        ]
        // <version-sync:end>
    },

    supabase: {
        "url": "https://vtwxjrcxpbzlbwghfdab.supabase.co",
        "anonKey": "sb_publishable_WlzthL5rqU7RC6LqVzf0sA_1i0XMVDS",
        "tableLeads": "empresas_alvo",
        "tableInteractions": "interacoes_sdr",
        "tableDeletions": "exclusoes_sync"
    },

    ai: {
        "enabled": true,
        "apiKey": "",
        "model": "gemini-3-flash-preview",
        "fallbackModels": [
            "gemini-3.5-flash",
            "gemini-3.6-flash",
            "gemini-3-flash-preview",
            "gemini-3.5-flash-lite",
            "gemini-2.5-flash"
        ],
        "webSearch": false,
        "useEdgeFunction": true,
        "forbiddenTerms": []
    },

    stages: [
        {
            "id": "aguardando_contato",
            "label": "Aguardando Contato",
            "icon": "hourglass",
            "color": "#60A5FA",
            "isInitial": true,
            "aiGoal": "Primeira abordagem: curta, honesta sobre como o lead foi encontrado, com UMA pergunta simples para abrir a conversa."
        },
        {
            "id": "ativado",
            "label": "Ativado",
            "icon": "zap",
            "color": "#FBBF24",
            "aiGoal": "Retomar a primeira mensagem sem cobrar: acrescente um ponto novo e útil, sem repetir o que já foi dito."
        },
        {
            "id": "atendimento",
            "label": "Atendimento",
            "icon": "message-circle",
            "color": "#A78BFA",
            "aiGoal": "Responder o que o contato perguntou por último, com precisão técnica, e conduzir para entender a necessidade."
        },
        {
            "id": "interessado",
            "label": "Interessado",
            "icon": "star",
            "color": "#38BDF8",
            "aiGoal": "Avançar para uma recomendação concreta de solução e propor montar a proposta."
        },
        {
            "id": "proposta",
            "label": "Proposta",
            "icon": "file-text",
            "color": "#34D399",
            "isProposal": true,
            "aiGoal": "Acompanhar a proposta enviada: tirar dúvidas e oferecer ajustes."
        },
        {
            "id": "oferta",
            "label": "Oferta",
            "icon": "tag",
            "color": "#10B981",
            "isProposal": true,
            "aiGoal": "Conduzir ao fechamento: confirmar o que falta para decidir e propor o próximo passo objetivo."
        },
        {
            "id": "retomar_em",
            "label": "Retomar em",
            "icon": "calendar-clock",
            "color": "#818CF8",
            "isScheduled": true,
            "aiGoal": "Retomada combinada: relembrar o combinado e perguntar como está o andamento."
        },
        {
            "id": "atencao",
            "label": "Atenção",
            "icon": "alert-triangle",
            "color": "#F87171",
            "isAlert": true,
            "aiGoal": "Confirmar dados e contato correto antes de qualquer avanço."
        },
        {
            "id": "declinou",
            "label": "Declinou",
            "icon": "archive",
            "color": "#9CA3AF",
            "isLost": true,
            "aiGoal": "Reativação gentil e sem pressão, com algo novo; deixe a porta aberta."
        }
    ],

    followupDays: {
        "aguardando_contato": 0,
        "ativado": 2,
        "atendimento": 1,
        "interessado": 2,
        "proposta": 3,
        "oferta": 2,
        "retomar_em": 0,
        "atencao": 1,
        "declinou": 30
    },

    categories: [
        {
            "id": "PME_Direta",
            "label": "PME Direta",
            "matriz": "b2b",
            "defaultTicket": 0,
            "baseRate": 0.25,
            "caseHeroName": "Soluções P4m PME",
            "caseHeroUrl": "https://per4media.com.br/crm"
        },
        {
            "id": "Agencia",
            "label": "Agência & Parceiros",
            "matriz": "b2b",
            "defaultTicket": 0,
            "baseRate": 0.25,
            "caseHeroName": "Parceria Agências",
            "caseHeroUrl": "https://per4media.com.br/crm"
        },
        {
            "id": "Grande_Marca",
            "label": "Grande Marca",
            "matriz": "b2b",
            "defaultTicket": 0,
            "baseRate": 0.25,
            "caseHeroName": "Cases Enterprise",
            "caseHeroUrl": "https://per4media.com.br/crm"
        },
        {
            "id": "Network",
            "label": "Network",
            "matriz": "b2b",
            "defaultTicket": 0,
            "baseRate": 0.3,
            "caseHeroName": "Rede P4m",
            "caseHeroUrl": "https://per4media.com.br/crm"
        }
    ],

    segmentFields: [
        {
            "key": "vertical",
            "label": "Vertical / Segmento"
        },
        {
            "key": "perfil_conta",
            "label": "Perfil da conta"
        },
        {
            "key": "cargo_responsavel",
            "label": "Cargo do responsável"
        },
        {
            "key": "dominio_corporativo",
            "label": "Domínio"
        },
        {
            "key": "linkedin_url",
            "label": "LinkedIn"
        },
        {
            "key": "qtd_contatos_empresa",
            "label": "Qtd contatos"
        },
        {
            "key": "origem_bruta",
            "label": "Origem bruta"
        }
    ],

    matrizes: {
        "b2b": {
            "interlocutor": {
                "label": "Interlocutor:",
                "dica": "Com quem a conversa está acontecendo",
                "opcoes": [
                    [
                        "dono_socio",
                        "Dono / Sócio Direto"
                    ],
                    [
                        "atendente_balcao",
                        "Atendente de Balcão"
                    ]
                ]
            },
            "afinidade": {
                "label": "Inclinação de Parceria:",
                "campo": "discovery_inclinacao_parceria",
                "dica": "Abertura do contato para uma relação comercial ou de parceria recorrente",
                "opcoes": [
                    [
                        "baixo",
                        "Baixo"
                    ],
                    [
                        "medio",
                        "Médio"
                    ],
                    [
                        "alto",
                        "Alto"
                    ]
                ]
            }
        },
        "b2c": {
            "interlocutor": {
                "label": "Interlocutor:",
                "dica": "Quem está na conversa: o comprador, um especificador/arquiteto ou um representante",
                "opcoes": [
                    [
                        "comprador",
                        "Comprador"
                    ],
                    [
                        "arquiteto",
                        "Especificador / Arquiteto"
                    ],
                    [
                        "representante",
                        "Representante (familiar ou outro)"
                    ]
                ]
            },
            "afinidade": {
                "label": "Encantamento com os Produtos:",
                "campo": "discovery_encantamento_produtos",
                "dica": "Quanto o cliente se encantou com a solução apresentada",
                "opcoes": [
                    [
                        "baixo",
                        "Baixo"
                    ],
                    [
                        "medio",
                        "Médio"
                    ],
                    [
                        "alto",
                        "Alto"
                    ]
                ]
            }
        }
    },

    prioridades: {
        "alta": {
            "label": "Alta"
        },
        "media_alta": {
            "label": "Média-alta"
        },
        "media": {
            "label": "Média"
        },
        "baixa": {
            "label": "Baixa"
        },
        "a_qualificar": {
            "label": "A qualificar"
        }
    },

    monteCarlo: {
        "iterations": 10000,
        "weights": {
            "interlocutor": {
                "dono_socio": 1.45,
                "atendente_balcao": 0.4,
                "indefinido": 1.0
            },
            "potencial_negocio": {
                "curto_prazo": 1.25,
                "medio_prazo": 1.0,
                "longo_prazo": 0.7,
                "indefinido": 1.0
            },
            "inclinacao_parceria": {
                "baixo": 0.6,
                "medio": 1.0,
                "alto": 1.35,
                "indefinido": 1.0
            },
            "interlocutor_b2c": {
                "comprador": 1.45,
                "especificador": 1.15,
                "arquiteto": 1.15,
                "representante": 0.7,
                "indefinido": 1.0
            },
            "encantamento_produtos": {
                "baixo": 0.6,
                "medio": 1.0,
                "alto": 1.35,
                "indefinido": 1.0
            },
            "demanda_imediata": {
                "sim": 1.4,
                "nao": 0.9,
                "indefinido": 1.0
            },
            "prioridade": {
                "alta": 1.2,
                "media_alta": 1.1,
                "media": 1.0,
                "baixa": 0.85,
                "a_qualificar": 0.95
            }
        },
        "stageMultipliers": {
            "oferta": 2.8,
            "proposta": 2.5,
            "interessado": 1.8,
            "retomar_em": 1.6,
            "atendimento": 1.2
        }
    }
};

if (typeof window !== "undefined") {
    window.CockpitConfig = CockpitConfig;
}
if (typeof module !== "undefined" && module.exports) {
    module.exports = CockpitConfig;
}
