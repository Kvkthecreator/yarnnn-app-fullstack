-- Migration: Add context_required to job payloads
-- Date: 2025-12-03
-- Purpose: Include context_requirements.roles in job payloads for context provisioning
-- Canon ref: /docs/architecture/ADR_CONTEXT_ENTRIES.md Phase 4

BEGIN;

-- ============================================================================
-- 1. UPDATE check_and_queue_due_schedules
-- Include context_requirements from recipe in job payload
-- ============================================================================

CREATE OR REPLACE FUNCTION check_and_queue_due_schedules()
RETURNS TABLE (
  schedule_id UUID,
  job_id UUID
) AS $$
DECLARE
  v_schedule RECORD;
  v_job_id UUID;
BEGIN
  -- Find all enabled schedules that are due
  FOR v_schedule IN
    SELECT
      ps.id,
      ps.project_id,
      ps.recipe_id,
      ps.basket_id,
      ps.recipe_parameters,
      ps.frequency,
      ps.day_of_week,
      ps.time_of_day,
      wr.slug as recipe_slug,
      wr.context_outputs,
      wr.context_requirements
    FROM project_schedules ps
    JOIN work_recipes wr ON wr.id = ps.recipe_id
    WHERE ps.enabled = true
    AND ps.next_run_at <= NOW()
    AND wr.status = 'active'
    -- Don't create duplicate jobs for same schedule
    AND NOT EXISTS (
      SELECT 1 FROM jobs j
      WHERE j.parent_schedule_id = ps.id
      AND j.status IN ('pending', 'claimed', 'running')
    )
    FOR UPDATE OF ps SKIP LOCKED
  LOOP
    -- Create job for this schedule
    -- Include context_required from recipe's context_requirements.roles
    INSERT INTO jobs (
      job_type,
      payload,
      priority,
      parent_schedule_id
    ) VALUES (
      'scheduled_work',
      jsonb_build_object(
        'schedule_id', v_schedule.id,
        'project_id', v_schedule.project_id,
        'recipe_id', v_schedule.recipe_id,
        'recipe_slug', v_schedule.recipe_slug,
        'basket_id', v_schedule.basket_id,
        'recipe_parameters', v_schedule.recipe_parameters,
        'context_outputs', v_schedule.context_outputs,
        'context_required', COALESCE(v_schedule.context_requirements->'roles', '[]'::jsonb),
        'triggered_at', NOW()
      ),
      5,  -- Default priority
      v_schedule.id
    )
    RETURNING id INTO v_job_id;

    -- Update schedule's next run time
    UPDATE project_schedules
    SET
      next_run_at = calculate_next_run_at(
        v_schedule.frequency,
        v_schedule.day_of_week,
        v_schedule.time_of_day,
        NULL
      ),
      updated_at = NOW()
    WHERE id = v_schedule.id;

    schedule_id := v_schedule.id;
    job_id := v_job_id;
    RETURN NEXT;
  END LOOP;

  RETURN;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- 2. UPDATE check_and_queue_stale_anchors
-- Include context_requirements from producing recipe in refresh job payload
-- ============================================================================

CREATE OR REPLACE FUNCTION check_and_queue_stale_anchors()
RETURNS TABLE (
  block_id UUID,
  job_id UUID
) AS $$
DECLARE
  v_stale RECORD;
  v_job_id UUID;
BEGIN
  -- Find stale anchor blocks that have a producing recipe
  FOR v_stale IN
    SELECT
      b.id as block_id,
      b.basket_id,
      b.anchor_role,
      wr.id as recipe_id,
      wr.slug as recipe_slug,
      wr.context_outputs,
      wr.context_requirements
    FROM blocks b
    JOIN work_recipes wr ON wr.context_outputs->>'role' = b.anchor_role
    WHERE b.anchor_role IS NOT NULL
    AND b.state = 'ACCEPTED'
    AND wr.status = 'active'
    AND b.updated_at < NOW() - (
      (wr.context_outputs->'refresh_policy'->>'ttl_hours')::INTEGER * INTERVAL '1 hour'
    )
    -- Don't queue if there's already a pending job
    AND NOT EXISTS (
      SELECT 1 FROM jobs j
      WHERE j.job_type = 'stale_refresh'
      AND j.payload->>'basket_id' = b.basket_id::TEXT
      AND j.payload->>'anchor_role' = b.anchor_role
      AND j.status IN ('pending', 'claimed', 'running')
    )
    FOR UPDATE OF b SKIP LOCKED
  LOOP
    -- Create refresh job with context_required from producing recipe
    INSERT INTO jobs (
      job_type,
      payload,
      priority
    ) VALUES (
      'stale_refresh',
      jsonb_build_object(
        'block_id', v_stale.block_id,
        'basket_id', v_stale.basket_id,
        'anchor_role', v_stale.anchor_role,
        'recipe_id', v_stale.recipe_id,
        'recipe_slug', v_stale.recipe_slug,
        'context_outputs', v_stale.context_outputs,
        'context_required', COALESCE(v_stale.context_requirements->'roles', '[]'::jsonb),
        'triggered_at', NOW()
      ),
      3  -- Lower priority than user-initiated
    )
    RETURNING id INTO v_job_id;

    block_id := v_stale.block_id;
    job_id := v_job_id;
    RETURN NEXT;
  END LOOP;

  RETURN;
END;
$$ LANGUAGE plpgsql;

COMMIT;
