-- ==============================================================================
-- MIGRAÇÃO 005: STARTER v2.0.0 — DELTA SYNC, EXCLUSÕES E DADOS DE SEGMENTO
-- Idempotente: segura para aplicar em bases já existentes (ex.: v1.4.0).
-- ==============================================================================

ALTER TABLE empresas_alvo ADD COLUMN IF NOT EXISTS dados_segmento JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_empresas_updated_at ON empresas_alvo(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_interacoes_empresa_data ON interacoes_sdr(empresa_id, data_envio ASC);

CREATE TABLE IF NOT EXISTS exclusoes_sync (
    id BIGSERIAL PRIMARY KEY,
    tabela VARCHAR(50) NOT NULL,
    registro_id UUID NOT NULL,
    deleted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_exclusoes_sync_deleted_at ON exclusoes_sync(deleted_at DESC);

ALTER TABLE exclusoes_sync ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Operadores autenticados - ler exclusoes" ON exclusoes_sync;
CREATE POLICY "Operadores autenticados - ler exclusoes" ON exclusoes_sync
    FOR SELECT TO authenticated USING (true);

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

NOTIFY pgrst, 'reload schema';
