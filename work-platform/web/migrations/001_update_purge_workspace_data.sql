-- Migration: Update purge_workspace_data to include work-platform tables
-- Date: 2025-01-12 (Updated: 2025-12-01 for Phase 2e schema)
-- Purpose: Include projects, work_tickets, agents, and related tables in workspace purge

-- Drop old version
DROP FUNCTION IF EXISTS public.purge_workspace_data(uuid);

-- Create updated version with work-platform tables (Phase 2e schema)
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
  -- SUBSTRATE-API TABLES (Existing)
  -- ========================================

  -- Delete substrate_references for documents in this workspace
  DELETE FROM substrate_references
  WHERE document_id IN (
    SELECT id FROM documents WHERE workspace_id = target_workspace_id
  );

  -- Delete document_versions for documents in this workspace
  DELETE FROM document_versions
  WHERE document_id IN (
    SELECT id FROM documents WHERE workspace_id = target_workspace_id
  );

  -- Delete document_context_items for documents in this workspace
  DELETE FROM document_context_items
  WHERE document_id IN (
    SELECT id FROM documents WHERE workspace_id = target_workspace_id
  );

  -- Delete documents in this workspace
  DELETE FROM documents WHERE workspace_id = target_workspace_id;

  -- Delete events (before blocks due to block_id FK NO ACTION)
  DELETE FROM events
  WHERE basket_id IN (
    SELECT id FROM baskets WHERE workspace_id = target_workspace_id
  );

  -- Delete block_links for blocks in this workspace's baskets
  DELETE FROM block_links
  WHERE block_id IN (
    SELECT id FROM blocks WHERE basket_id IN (
      SELECT id FROM baskets WHERE workspace_id = target_workspace_id
    )
  );

  -- Delete substrate_relationships for blocks in this workspace's baskets
  DELETE FROM substrate_relationships
  WHERE from_block_id IN (
    SELECT id FROM blocks WHERE basket_id IN (
      SELECT id FROM baskets WHERE workspace_id = target_workspace_id
    )
  );

  -- Delete blocks in this workspace's baskets
  DELETE FROM blocks
  WHERE basket_id IN (
    SELECT id FROM baskets WHERE workspace_id = target_workspace_id
  );

  -- Delete raw_dumps in this workspace's baskets
  DELETE FROM raw_dumps
  WHERE basket_id IN (
    SELECT id FROM baskets WHERE workspace_id = target_workspace_id
  );

  -- Delete reflections_artifact in this workspace's baskets
  DELETE FROM reflections_artifact
  WHERE basket_id IN (
    SELECT id FROM baskets WHERE workspace_id = target_workspace_id
  );

  -- Delete timeline_events in this workspace's baskets
  DELETE FROM timeline_events
  WHERE basket_id IN (
    SELECT id FROM baskets WHERE workspace_id = target_workspace_id
  );

  -- Delete proposal_executions (before proposals due to FK)
  DELETE FROM proposal_executions
  WHERE proposal_id IN (
    SELECT id FROM proposals WHERE basket_id IN (
      SELECT id FROM baskets WHERE workspace_id = target_workspace_id
    )
  );

  -- Delete proposals in this workspace's baskets
  DELETE FROM proposals
  WHERE basket_id IN (
    SELECT id FROM baskets WHERE workspace_id = target_workspace_id
  );

  -- NOTE: basket_anchors table was dropped in 20251202_context_roles_phase1.sql
  -- Context roles now live on blocks.anchor_role

  -- Delete agent_processing_queue items for this workspace's baskets
  DELETE FROM agent_processing_queue
  WHERE basket_id IN (
    SELECT id FROM baskets WHERE workspace_id = target_workspace_id
  );

  -- Delete app_events (before baskets due to FK NO ACTION)
  DELETE FROM app_events
  WHERE basket_id IN (
    SELECT id FROM baskets WHERE workspace_id = target_workspace_id
  );

  -- Delete mcp_unassigned_captures (before baskets due to FK NO ACTION)
  DELETE FROM mcp_unassigned_captures
  WHERE assigned_basket_id IN (
    SELECT id FROM baskets WHERE workspace_id = target_workspace_id
  );

  -- Delete narrative (before baskets due to FK NO ACTION)
  DELETE FROM narrative
  WHERE basket_id IN (
    SELECT id FROM baskets WHERE workspace_id = target_workspace_id
  );

  -- Delete baskets in this workspace (after projects deleted)
  DELETE FROM baskets WHERE workspace_id = target_workspace_id;

  -- ========================================
  -- PRESERVED (Intentional)
  -- ========================================
  -- - workspaces (workspace itself remains, just empty)
  -- - workspace_memberships (user still has access)
  -- - users (account preserved)
  -- - workspace_governance_settings (settings preserved)
  -- - Integration tokens/connections (preserved for future use)

END;
$function$;

-- Add helpful comment
COMMENT ON FUNCTION public.purge_workspace_data(uuid) IS
'Purges ALL data (work-platform + substrate) for a workspace. Preserves workspace, memberships, users, and settings. Used by /api/workspaces/purge endpoint.';
