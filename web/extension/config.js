/**
 * ==============================================================================
 * P4m EXTENSION — CONFIGURAÇÃO CENTRAL (espelho de web/assets/js/cockpit_config.js)
 * ==============================================================================
 * Contém apenas URL e ANON_KEY públicas do Supabase. Nenhuma chave secreta.
 */
export const EXT_CONFIG = {
    appName: "P4m",
    tagline: "Esteira comercial consultiva B2B & Network",
    version: "v3.2.0",
    crmUrl: "https://per4media.com.br/crm/",
    supabase: {
        url: "https://vtwxjrcxpbzlbwghfdab.supabase.co",
        anonKey: "sb_publishable_WlzthL5rqU7RC6LqVzf0sA_1i0XMVDS"
    },
    stages: {
        initial: "aguardando_contato",
        nextAfterDispatch: "ativado",
        attention: "atencao"
    },
    stageLabels: {
        aguardando_contato: "Aguardando Contato",
        ativado: "Ativado",
        atendimento: "Atendimento",
        interessado: "Interessado",
        proposta: "Proposta",
        oferta: "Oferta",
        retomar_em: "Retomar em",
        atencao: "Atenção",
        declinou: "Declinou"
    },
    frentes: {
        p4m: {
            id: "p4m",
            label: "P4m Comercial & Network",
            tables: {
                leads: "empresas_alvo",
                interactions: "interacoes_sdr"
            },
            aiGoalInitial: "Primeira abordagem: curta, honesta sobre como o lead foi encontrado, com UMA pergunta simples para abrir a conversa.",
            clusters: {
                PME_Direta: "PME Direta",
                Agencia: "Agência & Parceiros",
                Grande_Marca: "Grande Marca",
                Network: "Network"
            }
        }
    },
    timing: {
        minIntervalSec: 30,
        maxIntervalSec: 90
    }
};
