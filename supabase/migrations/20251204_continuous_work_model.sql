-- Migration: Continuous Work Model
-- Date: 2025-12-04
-- Description: Add support for continuous/scheduled work tickets
--
-- This enables:
-- 1. Linking work_tickets to project_schedules
-- 2. Differentiating one-shot vs continuous work
-- 3. Tracking execution cycles for recurring work

-- ============================================================================
-- 1. Add columns to work_tickets
-- ============================================================================

-- Add schedule_id to link tickets to their originating schedule
ALTER TABLE work_tickets
ADD COLUMN IF NOT EXISTS schedule_id UUID REFERENCES project_schedules(id) ON DELETE SET NULL;

-- Add mode to differentiate one-shot vs continuous work
ALTER TABLE work_tickets
ADD COLUMN IF NOT EXISTS mode TEXT NOT NULL DEFAULT 'one_shot';

-- Add constraint for mode values
ALTER TABLE work_tickets
ADD CONSTRAINT work_tickets_mode_check
CHECK (mode IN ('one_shot', 'continuous'));

-- Add cycle_number for continuous tickets (which run this is)
ALTER TABLE work_tickets
ADD COLUMN IF NOT EXISTS cycle_number INTEGER DEFAULT 1;

-- Index for finding tickets by schedule
CREATE INDEX IF NOT EXISTS idx_work_tickets_schedule
ON work_tickets(schedule_id)
WHERE schedule_id IS NOT NULL;

-- Index for finding continuous tickets
CREATE INDEX IF NOT EXISTS idx_work_tickets_mode
ON work_tickets(mode)
WHERE mode = 'continuous';

-- ============================================================================
-- 2. Extend work_iterations triggered_by constraint
-- ============================================================================

-- Drop existing constraint
ALTER TABLE work_iterations
DROP CONSTRAINT IF EXISTS work_iterations_triggered_by_check;

-- Add new constraint with 'schedule' option
ALTER TABLE work_iterations
ADD CONSTRAINT work_iterations_triggered_by_check
CHECK (triggered_by IN (
  'checkpoint_rejection',
  'user_feedback',
  'agent_self_correction',
  'context_staleness',
  'schedule'  -- New: triggered by scheduled run
));

-- ============================================================================
-- 3. Add promoted_to_context_item_id to work_outputs
-- ============================================================================

-- Link work_outputs to context_items when promoted
ALTER TABLE work_outputs
ADD COLUMN IF NOT EXISTS promoted_to_context_item_id UUID REFERENCES context_items(id) ON DELETE SET NULL;

-- Index for finding promoted outputs
CREATE INDEX IF NOT EXISTS idx_work_outputs_promoted_context
ON work_outputs(promoted_to_context_item_id)
WHERE promoted_to_context_item_id IS NOT NULL;

-- ============================================================================
-- 4. Update work_tickets source constraint to include 'schedule'
-- ============================================================================

-- First check current constraint and drop if exists
DO $$
BEGIN
  -- Check if source column has a constraint
  IF EXISTS (
    SELECT 1 FROM information_schema.check_constraints
    WHERE constraint_name = 'work_tickets_source_check'
  ) THEN
    ALTER TABLE work_tickets DROP CONSTRAINT work_tickets_source_check;
  END IF;
END $$;

-- Add updated constraint (if source has constraints)
-- Note: source column exists but may not have constraints, so we add one
ALTER TABLE work_tickets
ADD CONSTRAINT work_tickets_source_check
CHECK (source IN ('manual', 'thinking_partner', 'schedule', 'api'));

-- ============================================================================
-- 5. Add context_snapshot_id to work_iterations for cycle context tracking
-- ============================================================================

-- Track which context was used for each iteration/cycle
ALTER TABLE work_iterations
ADD COLUMN IF NOT EXISTS context_snapshot JSONB;

-- ============================================================================
-- 6. Comments for documentation
-- ============================================================================

COMMENT ON COLUMN work_tickets.schedule_id IS 'FK to project_schedules for recurring work';
COMMENT ON COLUMN work_tickets.mode IS 'one_shot: runs once and completes; continuous: runs on schedule';
COMMENT ON COLUMN work_tickets.cycle_number IS 'For continuous tickets, which execution cycle this is';
COMMENT ON COLUMN work_iterations.context_snapshot IS 'Snapshot of context_items used for this iteration';
COMMENT ON COLUMN work_outputs.promoted_to_context_item_id IS 'FK to context_items if output was promoted to context';

-- ============================================================================
-- 7. Grant permissions
-- ============================================================================

-- Ensure RLS policies still work (existing policies should cover new columns)
-- No new policies needed as they're based on workspace_id which is already checked
