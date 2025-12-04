-- ============================================================================
-- Thinking Partner Messages Table
-- ============================================================================
--
-- This migration creates the tp_messages table for persisting Thinking Partner
-- chat conversations. Unlike work_outputs which capture agent-generated content,
-- tp_messages captures the full conversational flow including user messages.
--
-- Key Features:
-- - Persistent chat history across sessions/devices
-- - Links to work_outputs produced during conversation
-- - Session grouping for conversation continuity
-- - Role-based messages (user, assistant, system)
--
-- See: /docs/architecture/ADR_CONTEXT_ITEMS_UNIFIED.md (TP integration section)
-- ============================================================================

-- Create tp_messages table
CREATE TABLE IF NOT EXISTS public.tp_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Session & Context
    basket_id UUID NOT NULL REFERENCES baskets(id) ON DELETE CASCADE,
    session_id UUID NOT NULL,  -- Groups messages into conversations

    -- Message Content
    role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
    content TEXT NOT NULL,

    -- Metadata for assistant messages
    work_output_ids UUID[] DEFAULT '{}',  -- Links to work_outputs produced
    tool_calls JSONB DEFAULT '[]',  -- Tool calls made during this turn
    model TEXT,  -- Model used (for auditing)
    input_tokens INTEGER,
    output_tokens INTEGER,

    -- Thinking Partner state
    tp_phase TEXT,  -- 'thinking', 'researching', 'writing', etc.
    context_snapshot JSONB,  -- Snapshot of context_items at time of message

    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL,

    -- User tracking
    user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_tp_messages_basket_session
    ON public.tp_messages (basket_id, session_id);
CREATE INDEX IF NOT EXISTS idx_tp_messages_session_created
    ON public.tp_messages (session_id, created_at);
CREATE INDEX IF NOT EXISTS idx_tp_messages_user
    ON public.tp_messages (user_id);

-- Create tp_sessions table for session metadata
CREATE TABLE IF NOT EXISTS public.tp_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Context
    basket_id UUID NOT NULL REFERENCES baskets(id) ON DELETE CASCADE,
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,

    -- Session Info
    title TEXT,  -- Optional user-provided or auto-generated title
    summary TEXT,  -- AI-generated summary of conversation

    -- State
    status TEXT DEFAULT 'active' CHECK (status IN ('active', 'archived', 'expired')),

    -- Tracking
    message_count INTEGER DEFAULT 0,
    last_message_at TIMESTAMPTZ,

    -- Metadata
    metadata JSONB DEFAULT '{}',

    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT now() NOT NULL,

    -- User tracking
    created_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL
);

-- Indexes for tp_sessions
CREATE INDEX IF NOT EXISTS idx_tp_sessions_basket
    ON public.tp_sessions (basket_id);
CREATE INDEX IF NOT EXISTS idx_tp_sessions_workspace
    ON public.tp_sessions (workspace_id);
CREATE INDEX IF NOT EXISTS idx_tp_sessions_user
    ON public.tp_sessions (created_by_user_id);
CREATE INDEX IF NOT EXISTS idx_tp_sessions_status
    ON public.tp_sessions (status) WHERE status = 'active';

-- Add foreign key from tp_messages to tp_sessions
ALTER TABLE public.tp_messages
    ADD CONSTRAINT fk_tp_messages_session
    FOREIGN KEY (session_id) REFERENCES public.tp_sessions(id) ON DELETE CASCADE;

-- ============================================================================
-- RLS Policies
-- ============================================================================

ALTER TABLE public.tp_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tp_sessions ENABLE ROW LEVEL SECURITY;

-- tp_sessions policies
CREATE POLICY "Users can view their workspace's TP sessions"
    ON public.tp_sessions
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM workspace_memberships wm
            WHERE wm.workspace_id = tp_sessions.workspace_id
            AND wm.user_id = auth.uid()
        )
    );

CREATE POLICY "Users can create TP sessions in their workspace"
    ON public.tp_sessions
    FOR INSERT
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM workspace_memberships wm
            WHERE wm.workspace_id = tp_sessions.workspace_id
            AND wm.user_id = auth.uid()
        )
    );

CREATE POLICY "Users can update their workspace's TP sessions"
    ON public.tp_sessions
    FOR UPDATE
    USING (
        EXISTS (
            SELECT 1 FROM workspace_memberships wm
            WHERE wm.workspace_id = tp_sessions.workspace_id
            AND wm.user_id = auth.uid()
        )
    );

-- tp_messages policies (inherit from session access)
CREATE POLICY "Users can view messages in their sessions"
    ON public.tp_messages
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM tp_sessions ts
            JOIN workspace_memberships wm ON wm.workspace_id = ts.workspace_id
            WHERE ts.id = tp_messages.session_id
            AND wm.user_id = auth.uid()
        )
    );

CREATE POLICY "Users can create messages in their sessions"
    ON public.tp_messages
    FOR INSERT
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM tp_sessions ts
            JOIN workspace_memberships wm ON wm.workspace_id = ts.workspace_id
            WHERE ts.id = tp_messages.session_id
            AND wm.user_id = auth.uid()
        )
    );

-- ============================================================================
-- Trigger to update session stats
-- ============================================================================

CREATE OR REPLACE FUNCTION update_tp_session_stats()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE tp_sessions
    SET
        message_count = message_count + 1,
        last_message_at = NEW.created_at,
        updated_at = now()
    WHERE id = NEW.session_id;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_tp_message_insert
    AFTER INSERT ON public.tp_messages
    FOR EACH ROW
    EXECUTE FUNCTION update_tp_session_stats();

-- ============================================================================
-- Comments
-- ============================================================================

COMMENT ON TABLE public.tp_messages IS 'Stores Thinking Partner chat messages for conversation persistence';
COMMENT ON TABLE public.tp_sessions IS 'Stores Thinking Partner session metadata for conversation grouping';

COMMENT ON COLUMN public.tp_messages.session_id IS 'Groups messages into conversations, references tp_sessions';
COMMENT ON COLUMN public.tp_messages.work_output_ids IS 'Links to work_outputs produced during this assistant turn';
COMMENT ON COLUMN public.tp_messages.context_snapshot IS 'Snapshot of context_items state at time of message for auditing';
COMMENT ON COLUMN public.tp_sessions.summary IS 'AI-generated summary of the conversation for quick reference';
