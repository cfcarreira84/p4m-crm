-- ==============================================================================
-- SDR COCKPIT STARTER v2.0.0 - SCHEMA POSTGRESQL (SUPABASE)
-- Execução: colar este arquivo inteiro no SQL Editor do Supabase ou rodar via
--           `python tools/provisionar.py` (idempotente).
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
    cidade TEXT NOT NULL DEFAULT 'Brasil',
    bairro TEXT,
    endereco_completo TEXT,
    cluster_estrategico TEXT NOT NULL,
    solucao_matriz_recomendada TEXT,
    whatsapp_disparo VARCHAR(20),
    telefone_fixo VARCHAR(20),
    website_original TEXT,
    contato_responsavel TEXT,

    -- Contatos alternativos e dados da base enriquecida (contrato de carga: tools/carga_base.py)
    whatsapp_confirmado BOOLEAN,
    email_contato TEXT,
    email_parcerias TEXT,
    instagram_url TEXT,
    regiao_comercial TEXT,
    uf VARCHAR(2),
    prioridade_carga VARCHAR(20),                   -- alta | media_alta | media | baixa | a_qualificar
    pontuacao_carga INTEGER,                        -- 0 a 100
    qualificacao_carga VARCHAR(30),                 -- qualificado | a_revisar | dados_incompletos
    observacao_dados TEXT,
    origem_carga VARCHAR(80),

    -- Fase do Kanban como VARCHAR (sem ENUM/CHECK): fases são definidas em cockpit_config.js
    status_kanban VARCHAR(50) NOT NULL DEFAULT 'aguardando_contato',

    -- Dossiê estruturado (scout / IA) e dados específicos do segmento
    pre_analise_scout JSONB NOT NULL DEFAULT '{}'::jsonb,
    dados_segmento JSONB NOT NULL DEFAULT '{}'::jsonb,

    -- Responsável pelo cartão: o último operador que moveu a fase (ou atribuído manualmente)
    responsavel_operador VARCHAR(100),

    -- Matriz de variáveis de discovery (alimentam o Monte Carlo B2B e B2C)
    discovery_interlocutor VARCHAR(50) DEFAULT 'indefinido',
    discovery_potencial_negocio VARCHAR(50) DEFAULT 'indefinido',
    discovery_inclinacao_parceria VARCHAR(50) DEFAULT 'indefinido',
    discovery_demanda_imediata VARCHAR(50) DEFAULT 'indefinido',
    discovery_encantamento_produtos VARCHAR(50) DEFAULT 'indefinido',

    -- Telemetria & preditividade
    probabilidade_montecarlo NUMERIC(5,4) DEFAULT 0.0000,
    ticket_estimado NUMERIC(12,2) DEFAULT 0.00,
    data_reativacao_programada DATE,
    notas_operador TEXT,

    -- Arquivamento & venda
    is_arquivado BOOLEAN NOT NULL DEFAULT FALSE,
    status_venda VARCHAR(30) DEFAULT 'em_aberto',
    valor_fechado NUMERIC(12,2) DEFAULT NULL,
    data_fechamento_venda TIMESTAMPTZ DEFAULT NULL,
    data_perda TIMESTAMPTZ DEFAULT NULL,
    motivo_perda TEXT DEFAULT NULL,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Garante colunas novas caso a tabela já existisse de versão anterior
ALTER TABLE empresas_alvo ADD COLUMN IF NOT EXISTS dados_segmento JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE empresas_alvo ADD COLUMN IF NOT EXISTS discovery_encantamento_produtos VARCHAR(50) DEFAULT 'indefinido';

-- 3. Interações / linha do tempo
CREATE TABLE IF NOT EXISTS interacoes_sdr (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    empresa_id UUID NOT NULL REFERENCES empresas_alvo(id) ON DELETE CASCADE,
    tipo_mensagem VARCHAR(50) NOT NULL,
    conteudo_mensagem TEXT NOT NULL,
    direcao VARCHAR(20) NOT NULL DEFAULT 'outbound',
    operador VARCHAR(100) NOT NULL DEFAULT 'Sistema',
    data_envio TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3.1 Configurações compartilhadas (somente leitura para operadores autenticados)
CREATE TABLE IF NOT EXISTS configuracoes (
    chave VARCHAR(80) PRIMARY KEY,
    valor TEXT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3.2 Base de conhecimento (persona, regras, produtos, programas, playbooks)
CREATE TABLE IF NOT EXISTS base_conhecimento (
    id TEXT PRIMARY KEY,
    tipo VARCHAR(30) NOT NULL,                      -- nucleo | produto | programa | playbook | prova_social | preco | restrito
    titulo TEXT NOT NULL,
    conteudo TEXT NOT NULL,
    perfis TEXT[] NOT NULL DEFAULT '{}',
    fases TEXT[] NOT NULL DEFAULT '{}',
    palavras TEXT[] NOT NULL DEFAULT '{}',
    restrito BOOLEAN NOT NULL DEFAULT FALSE,
    prioridade INTEGER NOT NULL DEFAULT 50,
    fonte TEXT,
    ativo BOOLEAN NOT NULL DEFAULT TRUE,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3.3 Registro de exclusões para sincronização incremental (Delta Sync no cliente)
CREATE TABLE IF NOT EXISTS exclusoes_sync (
    id BIGSERIAL PRIMARY KEY,
    tabela VARCHAR(50) NOT NULL,
    registro_id UUID NOT NULL,
    deleted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. Índices de performance e consulta incremental
CREATE INDEX IF NOT EXISTS idx_empresas_status_kanban ON empresas_alvo(status_kanban);
CREATE INDEX IF NOT EXISTS idx_empresas_cluster ON empresas_alvo(cluster_estrategico);
CREATE INDEX IF NOT EXISTS idx_empresas_is_arquivado ON empresas_alvo(is_arquivado);
CREATE INDEX IF NOT EXISTS idx_empresas_created_at ON empresas_alvo(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_empresas_updated_at ON empresas_alvo(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_empresas_responsavel ON empresas_alvo(responsavel_operador);
CREATE INDEX IF NOT EXISTS idx_empresas_prioridade ON empresas_alvo(prioridade_carga);
CREATE INDEX IF NOT EXISTS idx_empresas_regiao ON empresas_alvo(regiao_comercial);
CREATE UNIQUE INDEX IF NOT EXISTS uq_empresas_whatsapp ON empresas_alvo(whatsapp_disparo) WHERE whatsapp_disparo IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_interacoes_empresa_id ON interacoes_sdr(empresa_id);
CREATE INDEX IF NOT EXISTS idx_interacoes_empresa_data ON interacoes_sdr(empresa_id, data_envio ASC);
CREATE INDEX IF NOT EXISTS idx_exclusoes_sync_deleted_at ON exclusoes_sync(deleted_at DESC);

-- 5. Triggers: updated_at automático e registro de exclusões para Delta Sync
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

CREATE OR REPLACE FUNCTION log_empresa_deletion()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO exclusoes_sync (tabela, registro_id, deleted_at)
    VALUES ('empresas_alvo', OLD.id, NOW());
    RETURN OLD;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_empresas_delete_sync ON empresas_alvo;
CREATE TRIGGER trg_empresas_delete_sync
    AFTER DELETE ON empresas_alvo
    FOR EACH ROW
    EXECUTE FUNCTION log_empresa_deletion();

-- 6. Row Level Security: somente usuários autenticados
ALTER TABLE empresas_alvo ENABLE ROW LEVEL SECURITY;
ALTER TABLE interacoes_sdr ENABLE ROW LEVEL SECURITY;
ALTER TABLE base_conhecimento ENABLE ROW LEVEL SECURITY;
ALTER TABLE configuracoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE exclusoes_sync ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Operadores autenticados - ler conhecimento" ON base_conhecimento;
CREATE POLICY "Operadores autenticados - ler conhecimento" ON base_conhecimento
    FOR SELECT TO authenticated USING (ativo);

DROP POLICY IF EXISTS "Operadores autenticados - ler configuracoes" ON configuracoes;
CREATE POLICY "Operadores autenticados - ler configuracoes" ON configuracoes
    FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Operadores autenticados - ler exclusoes" ON exclusoes_sync;
CREATE POLICY "Operadores autenticados - ler exclusoes" ON exclusoes_sync
    FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Acesso Total Anonimo Empresas" ON empresas_alvo;
DROP POLICY IF EXISTS "Acesso Total Anonimo Interacoes" ON interacoes_sdr;
DROP POLICY IF EXISTS "Operadores autenticados - empresas" ON empresas_alvo;
DROP POLICY IF EXISTS "Operadores autenticados - interacoes" ON interacoes_sdr;

CREATE POLICY "Operadores autenticados - empresas" ON empresas_alvo
    FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Operadores autenticados - interacoes" ON interacoes_sdr
    FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- 7. Realtime
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'empresas_alvo'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE empresas_alvo;
    END IF;
END $$;

NOTIFY pgrst, 'reload schema';
