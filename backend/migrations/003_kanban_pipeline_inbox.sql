-- Migration 003: Sprint A — Modelagem de Dados Base
-- Kanban de Vendas (pipelines/pipeline_stages/deals/deal_stage_history)
-- + Inbox Unificada (conversations, FK em whatsapp_messages)
-- Idempotente — pode rodar múltiplas vezes

-- ── 1. TABELAS DO FUNIL DE VENDAS (KANBAN) ───────────────────────────────────

-- Tabela de Pipelines (Funis de Vendas)
CREATE TABLE IF NOT EXISTS pipelines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  nome VARCHAR(255) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Tabela de Estágios do Funil (Pipeline Stages)
CREATE TABLE IF NOT EXISTS pipeline_stages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pipeline_id UUID NOT NULL REFERENCES pipelines(id) ON DELETE CASCADE,
  nome VARCHAR(255) NOT NULL,
  ordem INT NOT NULL,
  is_won BOOLEAN DEFAULT false,
  is_lost BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT unique_pipeline_stage_order UNIQUE (pipeline_id, ordem)
);

-- Tabela de Negócios (Deals/Cards)
CREATE TABLE IF NOT EXISTS deals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  pipeline_id UUID NOT NULL REFERENCES pipelines(id) ON DELETE CASCADE,
  stage_id UUID NOT NULL REFERENCES pipeline_stages(id) ON DELETE CASCADE,
  contato_id UUID REFERENCES contatos(id) ON DELETE SET NULL, -- Vínculo recomendado de contato
  owner_id UUID REFERENCES users(id) ON DELETE SET NULL, -- Atendente dono do card
  titulo VARCHAR(255) NOT NULL,
  valor NUMERIC(15, 2) DEFAULT 0.00,
  status VARCHAR(50) DEFAULT 'aberto', -- aberto, ganho, perdido
  motivo_perda TEXT,
  versao INT DEFAULT 1, -- Lock Otimista para concorrência
  created_at TIMESTAMPTZ DEFAULT NOW(),
  closed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Tabela de Histórico de Movimentação (Deal Stage History - Append Only)
CREATE TABLE IF NOT EXISTS deal_stage_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id UUID NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  from_stage_id UUID REFERENCES pipeline_stages(id) ON DELETE SET NULL,
  to_stage_id UUID REFERENCES pipeline_stages(id) ON DELETE SET NULL,
  moved_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);


-- ── 2. TABELAS DA CAIXA DE ENTRADA UNIFICADA (INBOX) ─────────────────────────

-- Tabela de Conversas (Conversations) mapeadas por (user_id, instance_name, remote_jid)
CREATE TABLE IF NOT EXISTS conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  contato_id UUID NOT NULL REFERENCES contatos(id) ON DELETE CASCADE,
  instance_name VARCHAR(255) NOT NULL,
  remote_jid VARCHAR(255) NOT NULL,
  assigned_agent_id UUID REFERENCES users(id) ON DELETE SET NULL, -- Atendente atribuído
  status VARCHAR(50) DEFAULT 'open', -- open, pending, closed
  last_message_at TIMESTAMPTZ DEFAULT NOW(),
  unread_count INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT unique_user_instance_jid UNIQUE (user_id, instance_name, remote_jid)
);

-- Adiciona a coluna conversation_id na tabela de mensagens existente
ALTER TABLE whatsapp_messages
ADD COLUMN IF NOT EXISTS conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL;


-- ── 3. ÍNDICES DE PERFORMANCE E ESCALABILIDADE ───────────────────────────────

CREATE INDEX IF NOT EXISTS idx_deals_pipeline_stage ON deals(pipeline_id, stage_id);
CREATE INDEX IF NOT EXISTS idx_deals_owner ON deals(owner_id);
CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_conversation ON whatsapp_messages(conversation_id, created_at DESC);
