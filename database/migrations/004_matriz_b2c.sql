-- ==============================================================================
-- MIGRAÇÃO 004 (v1.3.8): matriz de discovery do B2C.
-- Aditiva e idempotente. Rode no SQL Editor ANTES de publicar o app da v1.3.8.
-- ==============================================================================

-- "Encantamento com os produtos" (B2C Projeto Pessoal): baixo | medio | alto.
-- É uma coluna própria para não reaproveitar "inclinação de parceria" com outro significado.
ALTER TABLE empresas_alvo ADD COLUMN IF NOT EXISTS discovery_encantamento_produtos VARCHAR(50) DEFAULT 'indefinido';

-- O interlocutor do B2C usa valores próprios na coluna existente (discovery_interlocutor):
--   comprador | arquiteto | representante     (B2B segue com dono_socio | atendente_balcao)

NOTIFY pgrst, 'reload schema';
