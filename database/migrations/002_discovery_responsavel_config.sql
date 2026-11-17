-- ==============================================================================
-- MIGRAÇÃO 002 (v1.1.0): taxonomia da Matriz de Discovery, Responsável e Configurações.
-- NÃO destrutiva: preserva os leads existentes. Idempotente (pode rodar mais de uma vez).
-- Rode no SQL Editor do Supabase DEPOIS da 001. Não rode o schema.sql junto: ele é para bases novas.
-- ==============================================================================

-- 1. Renomeia as colunas da Matriz de Discovery para nomes que dizem o que medem
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'empresas_alvo' AND column_name = 'discovery_v1_interlocutor') THEN
        ALTER TABLE empresas_alvo RENAME COLUMN discovery_v1_interlocutor TO discovery_interlocutor;
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'empresas_alvo' AND column_name = 'discovery_v2_dor_zap') THEN
        ALTER TABLE empresas_alvo RENAME COLUMN discovery_v2_dor_zap TO discovery_potencial_negocio;
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'empresas_alvo' AND column_name = 'discovery_v3_restricao_terceiros') THEN
        ALTER TABLE empresas_alvo RENAME COLUMN discovery_v3_restricao_terceiros TO discovery_inclinacao_parceria;
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'empresas_alvo' AND column_name = 'discovery_v4_receptividade_demo') THEN
        ALTER TABLE empresas_alvo RENAME COLUMN discovery_v4_receptividade_demo TO discovery_demanda_imediata;
    END IF;
END $$;

-- 2. Os três critérios mudaram de significado: valores antigos voltam para 'indefinido'
--    (o interlocutor não mudou e é preservado).
UPDATE empresas_alvo SET discovery_potencial_negocio = 'indefinido'
    WHERE discovery_potencial_negocio NOT IN ('curto_prazo', 'medio_prazo', 'longo_prazo', 'indefinido');
UPDATE empresas_alvo SET discovery_inclinacao_parceria = 'indefinido'
    WHERE discovery_inclinacao_parceria NOT IN ('baixo', 'medio', 'alto', 'indefinido');
UPDATE empresas_alvo SET discovery_demanda_imediata = 'indefinido'
    WHERE discovery_demanda_imediata NOT IN ('sim', 'nao', 'indefinido');

-- 3. Responsável pelo cartão
ALTER TABLE empresas_alvo ADD COLUMN IF NOT EXISTS responsavel_operador VARCHAR(100);
CREATE INDEX IF NOT EXISTS idx_empresas_responsavel ON empresas_alvo(responsavel_operador);

-- 4. Dossiê: chaves do JSON sem "gmaps" e sem textos de enchimento gerados antes da IA existir
UPDATE empresas_alvo
SET pre_analise_scout = (pre_analise_scout - 'pontos_fortes_gmaps' - 'pontos_fracos_gmaps')
    || jsonb_build_object(
        'pontos_fortes', COALESCE(pre_analise_scout->'pontos_fortes_gmaps', pre_analise_scout->'pontos_fortes', '""'::jsonb),
        'pontos_fracos', COALESCE(pre_analise_scout->'pontos_fracos_gmaps', pre_analise_scout->'pontos_fracos', '""'::jsonb)
    )
WHERE pre_analise_scout ? 'pontos_fortes_gmaps' OR pre_analise_scout ? 'pontos_fracos_gmaps';

-- Registros sem marca de análise por IA: esvazia os campos de enchimento (a IA preenche depois, pelo botão "Gerar análise")
UPDATE empresas_alvo
SET pre_analise_scout = pre_analise_scout || jsonb_build_object(
        'pontos_fortes', '', 'pontos_fracos', '', 'gargalo_critico', '', 'solucao_recomendada', '', 'analise_ia', false)
WHERE NOT (pre_analise_scout ? 'analise_ia');

-- 5. Configurações compartilhadas (chave da IA). Operadores só leem.
CREATE TABLE IF NOT EXISTS configuracoes (
    chave VARCHAR(80) PRIMARY KEY,
    valor TEXT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE configuracoes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Operadores autenticados - ler configuracoes" ON configuracoes;
CREATE POLICY "Operadores autenticados - ler configuracoes" ON configuracoes
    FOR SELECT TO authenticated USING (true);

-- Faz o PostgREST enxergar as mudanças imediatamente
NOTIFY pgrst, 'reload schema';
