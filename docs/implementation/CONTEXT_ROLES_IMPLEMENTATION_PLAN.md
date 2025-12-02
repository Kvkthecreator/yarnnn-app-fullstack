# Context Roles Implementation Plan

**Version**: 1.0
**Date**: 2025-12-02
**Status**: Approved for Implementation
**Canon Reference**: /docs/canon/CONTEXT_ROLES_ARCHITECTURE.md

---

## Overview

This document provides the detailed implementation plan for the Context Roles architecture. It covers schema migrations, code changes, and the sequencing of work.

---

## Phase 1: Schema Cleanup (Immediate Priority)

### 1.1 Deprecate basket_anchors Table

**Migration**: `20251202_deprecate_basket_anchors.sql`

```sql
-- Add deprecation comment (non-breaking)
COMMENT ON TABLE basket_anchors IS
'DEPRECATED (2025-12-02): This table is no longer used.
Context roles are stored directly on blocks.anchor_role.
See: /docs/canon/CONTEXT_ROLES_ARCHITECTURE.md
Table will be dropped after 30-day observation period.';
```

**Rationale**: Non-breaking change that documents the deprecation. The table can be dropped later.

### 1.2 Update Purge Function

**File**: `work-platform/web/migrations/001_update_purge_workspace_data.sql`

Remove the `DELETE FROM basket_anchors` section since the table is empty and deprecated.

### 1.3 Remove Dead Code

**File**: `work-platform/web/lib/anchors/registry.ts`

Remove or comment out unused functions:
- `upsertAnchorRegistryRow()` - never called
- `insertCustomAnchor()` - never called
- `archiveAnchor()` - never called
- `getAnchorRecord()` - only called by dead code paths
- `linkAnchorToSubstrate()` - never called

**Keep**:
- `loadRegistry()` - actively used
- `listAnchorsWithStatus()` - actively used

---

## Phase 2: Extend Anchor Roles (Short-term)

### 2.1 Add New Role Types

**Migration**: `20251202_extend_anchor_roles.sql`

```sql
-- Drop and recreate the CHECK constraint with new roles
ALTER TABLE blocks
DROP CONSTRAINT IF EXISTS blocks_anchor_role_check;

ALTER TABLE blocks
ADD CONSTRAINT blocks_anchor_role_check CHECK (
  anchor_role IN (
    -- Foundation roles (existing)
    'problem', 'customer', 'solution', 'feature',
    'constraint', 'metric', 'insight', 'vision',
    -- Insight roles (new)
    'trend_digest', 'competitor_snapshot', 'market_signal',
    'brand_voice', 'strategic_direction', 'customer_insight'
  )
);

COMMENT ON COLUMN blocks.anchor_role IS
'Context role this block serves. Foundation roles (problem, customer, vision)
are human-established. Insight roles (trend_digest, etc.) can be agent-produced.
See: /docs/canon/CONTEXT_ROLES_ARCHITECTURE.md';
```

### 2.2 Add Refresh Policy Support

**Migration**: `20251202_block_refresh_policy.sql`

```sql
-- Add refresh_policy column for TTL-based context refresh
ALTER TABLE blocks
ADD COLUMN refresh_policy JSONB DEFAULT NULL;

COMMENT ON COLUMN blocks.refresh_policy IS
'Optional refresh policy for scheduled context.
Schema: {"ttl_hours": 168, "source_recipe": "weekly-trend-scan", "auto_refresh": true}
Only applies to insight roles produced by scheduled recipes.';

-- Index for finding stale blocks that need refresh
CREATE INDEX idx_blocks_refresh_policy
ON blocks ((refresh_policy->>'ttl_hours')::int, updated_at)
WHERE refresh_policy IS NOT NULL;
```

---

## Phase 3: Work Outputs Enhancement (Short-term)

### 3.1 Add Context Role Targeting

**Migration**: `20251202_work_outputs_context_role.sql`

```sql
-- Add target_context_role to work_outputs
ALTER TABLE work_outputs
ADD COLUMN target_context_role TEXT,
ADD COLUMN auto_promote BOOLEAN DEFAULT false;

COMMENT ON COLUMN work_outputs.target_context_role IS
'The context role this output is intended to fill when promoted to a block.
Examples: trend_digest, competitor_snapshot, brand_voice';

COMMENT ON COLUMN work_outputs.auto_promote IS
'If true, output is automatically promoted to block on completion.
Used for trusted scheduled recipes. Requires work supervision approval.';

-- Index for finding promotable outputs by role
CREATE INDEX idx_work_outputs_target_role
ON work_outputs (target_context_role, promotion_status)
WHERE target_context_role IS NOT NULL;
```

### 3.2 Update Promotion Logic

**File**: `work-platform/api/src/services/work_output_promoter.py` (new)

```python
async def promote_output_to_block(
    output_id: str,
    promoted_by: str,
    supabase: SupabaseClient
) -> str:
    """Promote a work output to a block, optionally setting its context role."""

    output = await get_work_output(output_id, supabase)

    # Create block with content
    block_data = {
        "basket_id": output.basket_id,
        "title": output.title,
        "content": output.content,
        "semantic_type": output.semantic_type,
        "state": "ACCEPTED",
        "origin_ref": f"work_output/{output.id}",
    }

    # If output targets a context role, set it
    if output.target_context_role:
        block_data["anchor_role"] = output.target_context_role
        block_data["anchor_status"] = "accepted"
        block_data["anchor_confidence"] = 1.0

        # Copy refresh policy from recipe if available
        if output.refresh_policy:
            block_data["refresh_policy"] = output.refresh_policy

    block = await create_block(block_data, supabase)

    # Update work_output with promotion info
    await update_work_output(output_id, {
        "promoted_to_block_id": block["id"],
        "promotion_method": "auto" if output.auto_promote else "manual",
        "promoted_at": datetime.utcnow().isoformat(),
        "promoted_by": promoted_by,
    }, supabase)

    return block["id"]
```

---

## Phase 4: Recipe Declarations (Medium-term)

### 4.1 Extend Recipe Schema

**Migration**: `20251210_recipe_context_declarations.sql`

```sql
-- Add context_outputs column to work_recipes
-- (context_requirements already exists as JSONB)
ALTER TABLE work_recipes
ADD COLUMN context_outputs JSONB DEFAULT NULL;

COMMENT ON COLUMN work_recipes.context_outputs IS
'Declares what context role this recipe produces.
Schema: {"role": "trend_digest", "refresh_policy": {"ttl_hours": 168, "auto_promote": true}}
Only set for context-producing recipes (not execution recipes).';
```

### 4.2 Update Recipe Types

**File**: `work-platform/web/lib/recipes/types.ts`

```typescript
interface RecipeContextRequirements {
  // Existing fields
  substrate_blocks?: {
    min_blocks?: number;
    semantic_types?: string[];
    recency_preference?: string;
  };
  reference_assets?: {
    types?: string[];
    required?: boolean;
  };

  // New fields
  roles?: string[];           // Required context roles
  roles_optional?: string[];  // Optional context roles (enhance if present)
}

interface RecipeContextOutputs {
  role: string;               // Context role this recipe produces
  refresh_policy?: {
    ttl_hours: number;        // How long before considered stale
    auto_promote: boolean;    // Skip human review
  };
}

interface WorkRecipe {
  // ... existing fields
  context_requirements: RecipeContextRequirements;
  context_outputs?: RecipeContextOutputs;  // Only for context-producing recipes
}
```

### 4.3 Seed Recipe Declarations

Update existing recipes to declare their context requirements and outputs:

```sql
-- Example: Weekly Trend Scan
UPDATE work_recipes
SET
  context_requirements = jsonb_set(
    COALESCE(context_requirements, '{}'),
    '{roles}',
    '["customer", "brand_voice"]'
  ),
  context_outputs = '{
    "role": "trend_digest",
    "refresh_policy": {
      "ttl_hours": 168,
      "auto_promote": false
    }
  }'::jsonb
WHERE slug = 'weekly-trend-scan';
```

---

## Phase 5: Scheduling Layer (Medium-term)

### 5.1 Create Schedule Table

**Migration**: `20251215_project_recipe_schedules.sql`

```sql
CREATE TABLE project_recipe_schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  recipe_slug TEXT NOT NULL,

  -- Schedule definition (one of these)
  cron_expression TEXT,          -- e.g., '0 9 * * 1' (Monday 9am UTC)
  interval_hours INTEGER,        -- Alternative: run every N hours

  -- State
  enabled BOOLEAN DEFAULT true,
  last_run_at TIMESTAMPTZ,
  next_run_at TIMESTAMPTZ,
  last_run_status TEXT,          -- 'success', 'failed', 'skipped'

  -- Metadata
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  created_by UUID REFERENCES auth.users(id),

  UNIQUE(project_id, recipe_slug)
);

-- RLS policies
ALTER TABLE project_recipe_schedules ENABLE ROW LEVEL SECURITY;

CREATE POLICY schedule_workspace_members_select
ON project_recipe_schedules FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM projects p
    JOIN workspace_memberships wm ON wm.workspace_id = p.workspace_id
    WHERE p.id = project_recipe_schedules.project_id
    AND wm.user_id = auth.uid()
  )
);

-- Similar policies for INSERT, UPDATE, DELETE...
```

### 5.2 Implement Scheduler

**File**: `work-platform/api/src/services/recipe_scheduler.py`

```python
async def check_and_queue_scheduled_recipes():
    """
    Called by pg_cron every 15 minutes.
    Checks for due schedules and queues work requests.
    """

    now = datetime.utcnow()

    # Find due schedules
    due_schedules = await supabase.from_("project_recipe_schedules") \
        .select("*, projects(basket_id, workspace_id)") \
        .eq("enabled", True) \
        .lte("next_run_at", now.isoformat()) \
        .execute()

    for schedule in due_schedules.data:
        try:
            # Check if recipe's required roles are fresh
            recipe = await get_recipe(schedule["recipe_slug"])
            required_roles = recipe.get("context_requirements", {}).get("roles", [])

            roles_fresh = await check_roles_freshness(
                schedule["projects"]["basket_id"],
                required_roles
            )

            if not roles_fresh:
                # Skip - required context is stale
                await update_schedule_status(schedule["id"], "skipped",
                    "Required context roles are stale")
                continue

            # Queue work request
            await create_work_request(
                basket_id=schedule["projects"]["basket_id"],
                workspace_id=schedule["projects"]["workspace_id"],
                recipe_slug=schedule["recipe_slug"],
                triggered_by="scheduler",
                schedule_id=schedule["id"]
            )

            # Update schedule
            next_run = calculate_next_run(schedule)
            await update_schedule(schedule["id"], {
                "last_run_at": now,
                "next_run_at": next_run,
                "last_run_status": "success"
            })

        except Exception as e:
            await update_schedule_status(schedule["id"], "failed", str(e))


async def check_roles_freshness(basket_id: str, roles: list[str]) -> bool:
    """Check if all required roles have fresh blocks."""

    for role in roles:
        block = await supabase.from_("blocks") \
            .select("id, updated_at, refresh_policy") \
            .eq("basket_id", basket_id) \
            .eq("anchor_role", role) \
            .eq("anchor_status", "accepted") \
            .order("updated_at", desc=True) \
            .limit(1) \
            .single() \
            .execute()

        if not block.data:
            return False  # Role missing entirely

        # Check if block has TTL and is stale
        if block.data.get("refresh_policy"):
            ttl_hours = block.data["refresh_policy"].get("ttl_hours", 0)
            if ttl_hours > 0:
                stale_threshold = datetime.utcnow() - timedelta(hours=ttl_hours)
                if block.data["updated_at"] < stale_threshold.isoformat():
                    return False  # Role is stale

    return True
```

### 5.3 pg_cron Setup

```sql
-- Enable pg_cron if not already
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Schedule the checker to run every 15 minutes
SELECT cron.schedule(
  'check-recipe-schedules',
  '*/15 * * * *',
  $$SELECT net.http_post(
    'https://your-api.render.com/internal/scheduler/check',
    headers := '{"Authorization": "Bearer <service-token>"}'::jsonb
  )$$
);
```

---

## Phase 6: UI Updates

### 6.1 Context Readiness Card Updates

**File**: `work-platform/web/app/projects/[id]/agents/_components/ContextReadinessCard.tsx`

Update to show:
- Foundation roles (problem, customer, vision) - existing
- Insight roles if any exist
- Stale indicators for roles with refresh policies

### 6.2 Recipe Context Requirements Display

**File**: `work-platform/web/app/projects/[id]/work-tickets/new/configure/page.tsx`

Show what context roles a recipe requires:
- Which roles are present and fresh
- Which roles are missing or stale
- Warning if proceeding without required context

### 6.3 Schedule Management UI

**Location**: `/projects/[id]/settings/schedules`

New page to:
- View scheduled recipes for project
- Enable/disable schedules
- Configure cron expressions or intervals
- View run history

---

## Testing Plan

### Unit Tests

1. `test_promote_output_to_block_with_role.py`
   - Verify anchor_role set correctly on promoted block
   - Verify refresh_policy copied

2. `test_recipe_context_requirements.py`
   - Verify role requirements checked
   - Verify optional roles handled correctly

3. `test_scheduler_freshness_check.py`
   - Verify stale roles skip execution
   - Verify fresh roles allow execution

### Integration Tests

1. End-to-end recipe execution with context roles
2. Scheduled recipe execution via pg_cron
3. Auto-promote flow for trusted recipes

---

## Rollout Plan

| Phase | Timeline | Risk Level | Rollback |
|-------|----------|------------|----------|
| Phase 1: Cleanup | Week 1 | Low | Revert migration |
| Phase 2: Extend Roles | Week 1-2 | Low | Remove new CHECK values |
| Phase 3: Work Outputs | Week 2-3 | Medium | Ignore new columns |
| Phase 4: Recipe Declarations | Week 3-4 | Medium | Use legacy requirements |
| Phase 5: Scheduling | Week 4-6 | Medium | Disable cron job |
| Phase 6: UI | Week 5-7 | Low | Feature flag |

---

## Success Metrics

| Metric | Target | Measurement |
|--------|--------|-------------|
| Context role coverage | 80% of active projects have 3+ roles | DB query |
| Scheduled recipe success rate | >95% | Scheduler logs |
| Average context freshness | <7 days for insight roles | Block updated_at |
| Work output quality | +10% approval rate with fresh context | Promotion metrics |

---

## Open Questions

1. **Role inheritance**: Should child roles inherit from parent? (e.g., `trend_digest` is-a `insight`)
2. **Multi-block roles**: Can a role be filled by multiple blocks? (e.g., multiple `feature` blocks)
3. **Cross-project roles**: Should workspace-level context roles exist?

---

**Document Status**: Approved for Implementation
**Last Updated**: 2025-12-02
**Owner**: Engineering Team
