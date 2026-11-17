-- ==============================================================================
-- MIGRAÇÃO 001: inicializa o schema base v1.0.0.
-- DESTRUTIVO: apaga as 4 tabelas abaixo e tudo que há nelas. Use somente com a base vazia.
-- Para bases novas, prefira rodar diretamente `database/schema.sql`.
-- ==============================================================================
DROP TABLE IF EXISTS propostas_comerciais CASCADE;
DROP TABLE IF EXISTS metricas_montecarlo CASCADE;
DROP TABLE IF EXISTS interacoes_sdr CASCADE;
DROP TABLE IF EXISTS empresas_alvo CASCADE;

-- ==============================================================================
-- SDR COCKPIT - SCHEMA POSTGRESQL (SUPABASE)
-- Execução: colar este arquivo inteiro no SQL Editor do Supabase e rodar (idempotente).
-- Acesso: SOMENTE usuários autenticados (Supabase Auth). A anon key sozinha não lê nada.
-- ==============================================================================

-- 1. Extensões
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 2. Leads & Oportunidades
CREATE TABLE IF NOT EXISTS empresas_alvo (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    cnpj VARCHAR(20) UNIQUE,
    razao_social TEXT,
    nome_fantasia TEXT NOT NULL,
    cidade TEXT NOT NULL DEFAULT 'Brasil',          -- atuação nacional; cidade é opcional
    bairro TEXT,
    endereco_completo TEXT,
    cluster_estrategico TEXT NOT NULL,              -- perfil: B2B_Revenda, B2B_Arquitetos, B2B_Designers, B2B_Restaurantes, B2C_Area_Gourmet
    solucao_matriz_recomendada TEXT,
    whatsapp_disparo VARCHAR(20) NOT NULL,
    telefone_fixo VARCHAR(20),
    website_original TEXT,
    contato_responsavel TEXT,

    -- Fase do Kanban como VARCHAR: fases são definidas em cockpit_config.js, sem ENUM/CHECK,
    -- para permitir criar/renomear fases sem migração.
    status_kanban VARCHAR(50) NOT NULL DEFAULT 'aguardando_contato',

    -- Dossiê estruturado (scout / IA)
    pre_analise_scout JSONB NOT NULL DEFAULT '{}'::jsonb,

    -- Matriz de 4 variáveis de discovery (alimentam o Monte Carlo)
    discovery_v1_interlocutor VARCHAR(50) DEFAULT 'indefinido',
    discovery_v2_dor_zap VARCHAR(50) DEFAULT 'indefinido',
    discovery_v3_restricao_terceiros VARCHAR(50) DEFAULT 'indefinido',
    discovery_v4_receptividade_demo VARCHAR(50) DEFAULT 'indefinido',

    -- Telemetria & preditividade
    probabilidade_montecarlo NUMERIC(5,4) DEFAULT 0.0000,
    ticket_estimado NUMERIC(12,2) DEFAULT 0.00,
    data_reativacao_programada DATE,                -- usada na fase "Retomar em"
    notas_operador TEXT,

    -- Arquivamento & venda
    is_arquivado BOOLEAN NOT NULL DEFAULT FALSE,
    status_venda VARCHAR(30) DEFAULT 'em_aberto',   -- 'em_aberto', 'venda_realizada', 'perdido'
    valor_fechado NUMERIC(12,2) DEFAULT NULL,
    data_fechamento_venda TIMESTAMPTZ DEFAULT NULL,
    data_perda TIMESTAMPTZ DEFAULT NULL,
    motivo_perda TEXT DEFAULT NULL,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. Interações / linha do tempo (colunas alinhadas a web/assets/js/supabase_client.js)
CREATE TABLE IF NOT EXISTS interacoes_sdr (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    empresa_id UUID NOT NULL REFERENCES empresas_alvo(id) ON DELETE CASCADE,
    tipo_mensagem VARCHAR(50) NOT NULL,             -- 'whatsapp_outbound', 'whatsapp_inbound', 'nota_operador', 'venda_realizada'...
    conteudo_mensagem TEXT NOT NULL,
    direcao VARCHAR(20) NOT NULL DEFAULT 'outbound',-- 'inbound', 'outbound', 'system'
    operador VARCHAR(100) NOT NULL DEFAULT 'Sistema',
    data_envio TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. Índices
CREATE INDEX IF NOT EXISTS idx_empresas_status_kanban ON empresas_alvo(status_kanban);
CREATE INDEX IF NOT EXISTS idx_empresas_cluster ON empresas_alvo(cluster_estrategico);
CREATE INDEX IF NOT EXISTS idx_empresas_is_arquivado ON empresas_alvo(is_arquivado);
CREATE INDEX IF NOT EXISTS idx_empresas_created_at ON empresas_alvo(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_interacoes_empresa_id ON interacoes_sdr(empresa_id);

-- 5. updated_at automático
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_set_updated_at ON empresas_alvo;
CREATE TRIGGER trigger_set_updated_at
    BEFORE UPDATE ON empresas_alvo
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at();

-- 6. Row Level Security: somente usuários autenticados
ALTER TABLE empresas_alvo ENABLE ROW LEVEL SECURITY;
ALTER TABLE interacoes_sdr ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Acesso Total Anonimo Empresas" ON empresas_alvo;
DROP POLICY IF EXISTS "Acesso Total Anonimo Interacoes" ON interacoes_sdr;
DROP POLICY IF EXISTS "Operadores autenticados - empresas" ON empresas_alvo;
DROP POLICY IF EXISTS "Operadores autenticados - interacoes" ON interacoes_sdr;

CREATE POLICY "Operadores autenticados - empresas" ON empresas_alvo
    FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Operadores autenticados - interacoes" ON interacoes_sdr
    FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- 7. Realtime (o Kanban de um operador atualiza na tela dos outros)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'empresas_alvo'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE empresas_alvo;
    END IF;
END $$;
