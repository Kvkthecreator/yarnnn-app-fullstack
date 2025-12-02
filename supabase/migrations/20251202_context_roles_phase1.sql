-- Context Roles Phase 1: Drop basket_anchors and extend anchor_role
-- Date: 2025-12-02
-- Canon Reference: /docs/canon/CONTEXT_ROLES_ARCHITECTURE.md
--
-- This migration:
-- 1. Drops the deprecated basket_anchors table (0 rows in production)
-- 2. Extends blocks.anchor_role with new insight role types
-- 3. Adds refresh_policy column for scheduled context refresh

BEGIN;

-- =====================================================
-- 1. Drop basket_anchors table and related objects
-- =====================================================

-- Drop policies first
DROP POLICY IF EXISTS basket_anchors_service_full ON basket_anchors;
DROP POLICY IF EXISTS basket_anchors_workspace_members_select ON basket_anchors;
DROP POLICY IF EXISTS basket_anchors_workspace_members_modify ON basket_anchors;
DROP POLICY IF EXISTS basket_anchors_workspace_members_update ON basket_anchors;
DROP POLICY IF EXISTS basket_anchors_workspace_members_delete ON basket_anchors;

-- Drop trigger and function
DROP TRIGGER IF EXISTS basket_anchors_set_updated_at ON basket_anchors;
DROP FUNCTION IF EXISTS fn_set_basket_anchor_updated_at();

-- Drop indexes
DROP INDEX IF EXISTS uq_basket_anchors_key;
DROP INDEX IF EXISTS idx_basket_anchors_substrate;
DROP INDEX IF EXISTS idx_basket_anchors_scope;

-- Drop the table
DROP TABLE IF EXISTS basket_anchors;

-- =====================================================
-- 2. Extend anchor_role CHECK constraint with new types
-- =====================================================

-- Drop existing constraint
ALTER TABLE blocks
DROP CONSTRAINT IF EXISTS blocks_anchor_role_check;

-- Add extended constraint with new insight roles
ALTER TABLE blocks
ADD CONSTRAINT blocks_anchor_role_check CHECK (
  anchor_role IN (
    -- Foundation roles (existing)
    'problem', 'customer', 'solution', 'feature',
    'constraint', 'metric', 'insight', 'vision',
    -- Insight roles (new - agent-producible, refreshable)
    'trend_digest', 'competitor_snapshot', 'market_signal',
    'brand_voice', 'strategic_direction', 'customer_insight'
  )
);

COMMENT ON COLUMN blocks.anchor_role IS
'Context role this block serves.
Foundation roles: problem, customer, vision, solution, feature, constraint, metric, insight
Insight roles: trend_digest, competitor_snapshot, market_signal, brand_voice, strategic_direction, customer_insight
See: /docs/canon/CONTEXT_ROLES_ARCHITECTURE.md';

-- =====================================================
-- 3. Add refresh_policy column for scheduled context
-- =====================================================

ALTER TABLE blocks
ADD COLUMN IF NOT EXISTS refresh_policy JSONB DEFAULT NULL;

COMMENT ON COLUMN blocks.refresh_policy IS
'Optional refresh policy for scheduled context blocks.
Schema: {"ttl_hours": 168, "source_recipe": "weekly-trend-scan", "auto_refresh": true}
Only applies to insight roles produced by scheduled recipes.';

-- Index for finding stale blocks that need refresh
CREATE INDEX IF NOT EXISTS idx_blocks_refresh_policy
ON blocks (updated_at)
WHERE refresh_policy IS NOT NULL;

-- =====================================================
-- 4. Update purge function to remove basket_anchors reference
-- =====================================================

CREATE OR REPLACE FUNCTION public.purge_workspace_data(target_workspace_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
BEGIN
  -- All operations in this function run in a single transaction
  -- If any DELETE fails, the entire operation rolls back

  -- ========================================
  -- WORK-PLATFORM TABLES (Phase 2e Schema)
  -- ========================================

  -- Delete work_iterations (references work_tickets)
  DELETE FROM work_iterations
  WHERE work_ticket_id IN (
    SELECT id FROM work_tickets WHERE workspace_id = target_workspace_id
  );

  -- Delete work_checkpoints (references work_tickets)
  DELETE FROM work_checkpoints
  WHERE work_ticket_id IN (
    SELECT id FROM work_tickets WHERE workspace_id = target_workspace_id
  );

  -- Delete work_tickets (references work_requests)
  DELETE FROM work_tickets
  WHERE workspace_id = target_workspace_id;

  -- Delete work_requests
  DELETE FROM work_requests
  WHERE workspace_id = target_workspace_id;

  -- Delete agent_sessions
  DELETE FROM agent_sessions
  WHERE workspace_id = target_workspace_id;

  -- Delete project_agents (before projects)
  DELETE FROM project_agents
  WHERE project_id IN (
    SELECT id FROM projects WHERE workspace_id = target_workspace_id
  );

  -- Delete projects (before baskets, as projects reference baskets)
  DELETE FROM projects
  WHERE workspace_id = target_workspace_id;

  -- ========================================
  -- SUBSTRATE TABLES
  -- ========================================

  -- Delete work_outputs (before blocks)
  DELETE FROM work_outputs
  WHERE basket_id IN (
    SELECT id FROM baskets WHERE workspace_id = target_workspace_id
  );

  -- Delete substrate_relationships (before blocks/context_items)
  DELETE FROM substrate_relationships
  WHERE basket_id IN (
    SELECT id FROM baskets WHERE workspace_id = target_workspace_id
  );

  -- Delete blocks (core substrate)
  DELETE FROM blocks
  WHERE basket_id IN (
    SELECT id FROM baskets WHERE workspace_id = target_workspace_id
  );

  -- Delete context_items (if still exists)
  DELETE FROM context_items
  WHERE basket_id IN (
    SELECT id FROM baskets WHERE workspace_id = target_workspace_id
  );

  -- Delete reference_assets
  DELETE FROM reference_assets
  WHERE basket_id IN (
    SELECT id FROM baskets WHERE workspace_id = target_workspace_id
  );

  -- Delete reflections_artifact
  DELETE FROM reflections_artifact
  WHERE basket_id IN (
    SELECT id FROM baskets WHERE workspace_id = target_workspace_id
  );

  -- Delete proposals (governance)
  DELETE FROM proposals
  WHERE basket_id IN (
    SELECT id FROM baskets WHERE workspace_id = target_workspace_id
  );

  -- Delete baskets
  DELETE FROM baskets
  WHERE workspace_id = target_workspace_id;

  -- ========================================
  -- NOTE: The following are intentionally NOT deleted:
  -- - workspaces (the container itself)
  -- - workspace_memberships (user access)
  -- - users (shared across workspaces)
  -- - workspace_governance_settings (settings preserved)
  -- - Integration tokens/connections (preserved for future use)
  -- ========================================

END;
$function$;

COMMENT ON FUNCTION public.purge_workspace_data(uuid) IS
'Purges ALL data (work-platform + substrate) for a workspace. Preserves workspace, memberships, users, and settings. Updated 2025-12-02 to remove basket_anchors reference.';

COMMIT;
