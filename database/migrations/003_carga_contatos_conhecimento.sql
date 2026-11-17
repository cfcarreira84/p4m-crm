-- ==============================================================================
-- MIGRAÇÃO 003 (v1.3.0): campos da base enriquecida, contato sem WhatsApp e base de conhecimento.
-- NÃO destrutiva e idempotente. Rode no SQL Editor DEPOIS da 002.
-- ==============================================================================

-- 1. WhatsApp deixa de ser obrigatório: parte da base só tem e-mail, site ou Instagram.
--    O operador localiza o contato manualmente e preenche o número depois.
ALTER TABLE empresas_alvo ALTER COLUMN whatsapp_disparo DROP NOT NULL;

-- 2. Colunas da base enriquecida (contrato de carga)
ALTER TABLE empresas_alvo ADD COLUMN IF NOT EXISTS whatsapp_confirmado BOOLEAN;          -- true = confirmado; false = celular provável
ALTER TABLE empresas_alvo ADD COLUMN IF NOT EXISTS email_contato TEXT;                   -- e-mail para novos projetos
ALTER TABLE empresas_alvo ADD COLUMN IF NOT EXISTS email_parcerias TEXT;                 -- e-mail de parcerias / fornecedores
ALTER TABLE empresas_alvo ADD COLUMN IF NOT EXISTS instagram_url TEXT;
ALTER TABLE empresas_alvo ADD COLUMN IF NOT EXISTS regiao_comercial TEXT;
ALTER TABLE empresas_alvo ADD COLUMN IF NOT EXISTS uf VARCHAR(2);
ALTER TABLE empresas_alvo ADD COLUMN IF NOT EXISTS prioridade_carga VARCHAR(20);         -- alta | media_alta | media | baixa | a_qualificar
ALTER TABLE empresas_alvo ADD COLUMN IF NOT EXISTS pontuacao_carga INTEGER;              -- 0 a 100
ALTER TABLE empresas_alvo ADD COLUMN IF NOT EXISTS qualificacao_carga VARCHAR(30);       -- qualificado | a_revisar | dados_incompletos
ALTER TABLE empresas_alvo ADD COLUMN IF NOT EXISTS observacao_dados TEXT;                -- pendências de dados a confirmar
ALTER TABLE empresas_alvo ADD COLUMN IF NOT EXISTS origem_carga VARCHAR(80);             -- ex.: arquitetos_2026-11-03

CREATE INDEX IF NOT EXISTS idx_empresas_prioridade ON empresas_alvo(prioridade_carga);
CREATE INDEX IF NOT EXISTS idx_empresas_regiao ON empresas_alvo(regiao_comercial);

-- Um WhatsApp identifica um único lead (evita duplicar a carga)
CREATE UNIQUE INDEX IF NOT EXISTS uq_empresas_whatsapp ON empresas_alvo(whatsapp_disparo) WHERE whatsapp_disparo IS NOT NULL;

-- 3. Base de conhecimento (produtos, programas, playbooks). Operadores só leem; a função de IA
--    seleciona os blocos relevantes por perfil, fase e palavras da conversa.
CREATE TABLE IF NOT EXISTS base_conhecimento (
    id TEXT PRIMARY KEY,                              -- identificador estável (slug)
    tipo VARCHAR(30) NOT NULL,                        -- nucleo | produto | programa | playbook | prova_social | preco | restrito
    titulo TEXT NOT NULL,
    conteudo TEXT NOT NULL,
    perfis TEXT[] NOT NULL DEFAULT '{}',              -- vazio = todos os perfis
    fases TEXT[] NOT NULL DEFAULT '{}',               -- vazio = todas as fases
    palavras TEXT[] NOT NULL DEFAULT '{}',            -- gatilhos de recuperação (produtos)
    restrito BOOLEAN NOT NULL DEFAULT FALSE,          -- true = só vai para os perfis listados em `perfis`
    prioridade INTEGER NOT NULL DEFAULT 50,           -- maior = entra primeiro
    fonte TEXT,
    ativo BOOLEAN NOT NULL DEFAULT TRUE,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_conhecimento_tipo ON base_conhecimento(tipo) WHERE ativo;

ALTER TABLE base_conhecimento ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Operadores autenticados - ler conhecimento" ON base_conhecimento;
CREATE POLICY "Operadores autenticados - ler conhecimento" ON base_conhecimento
    FOR SELECT TO authenticated USING (ativo);

NOTIFY pgrst, 'reload schema';
