# ADR: Continuous Work Model

**Status:** Accepted
**Date:** 2025-12-04
**Context:** Work orchestration, scheduling, context lifecycle

## Summary

This ADR documents the continuous work model architecture, enabling scheduled/recurring work that builds on previous context and produces outputs that can be promoted to persistent context items.

## Context

Previously, work was modeled as discrete one-shot executions:
- User or TP triggers recipe → work_ticket created → executes → completes → done

This doesn't support:
1. Recurring scheduled work (weekly trend digests, competitor monitoring)
2. Work that builds on previous runs' context
3. Continuous presence of work that "stays alive"

## Decision

Implement a **continuous work model** where:
- Work tickets can be `one_shot` or `continuous`
- Continuous tickets are linked to `project_schedules`
- Each scheduled run creates a cycle within the ticket
- Work outputs can be promoted to `context_items`

## Architecture

### Data Flow

```
project_schedule (weekly trend_digest)
    │
    ├── schedule executor (cron/worker)
    │
    ▼
work_ticket (mode: continuous, schedule_id: xxx)
    │
    ├── cycle 1 (Jan 1)
    │   └── work_outputs → promoted to context_items
    │
    ├── cycle 2 (Jan 8)
    │   └── work_outputs → can reference previous context
    │
    └── cycle 3 (Jan 15) → running
```

### Schema Changes

#### work_tickets

| Column | Type | Description |
|--------|------|-------------|
| `schedule_id` | UUID FK | Links to project_schedules (nullable) |
| `mode` | TEXT | `'one_shot'` or `'continuous'` |
| `cycle_number` | INTEGER | For continuous, which run this is |

#### work_iterations

| Column | Type | Description |
|--------|------|-------------|
| `triggered_by` | TEXT | Added `'schedule'` option |
| `context_snapshot` | JSONB | Snapshot of context used |

#### work_outputs

| Column | Type | Description |
|--------|------|-------------|
| `promoted_to_context_item_id` | UUID FK | Links to context_items if promoted |

### Source Tracking

`work_tickets.source` now supports:
- `manual` - User-created via UI
- `thinking_partner` - TP triggered via chat
- `schedule` - Triggered by schedule executor
- `api` - External API calls

### Continuous Ticket Lifecycle

1. **Schedule triggers** → Find or create continuous ticket
2. **Increment cycle** → `cycle_number++`
3. **Load context** → Read from `context_items` (includes previous outputs)
4. **Execute** → Create `work_iteration` with `triggered_by: 'schedule'`
5. **Produce outputs** → `work_outputs` with supervision
6. **Promote** → User/agent promotes outputs to `context_items`
7. **Update schedule** → `last_run_at`, `next_run_at`, `last_run_ticket_id`

### Context Tiers Integration

Work outputs flow through tiers:

| Stage | Tier | Governance |
|-------|------|------------|
| Raw output | ephemeral | Auto-expire, low trust |
| Approved output | working | Agent-managed, versioned |
| Promoted to context | foundation/working | User-governed |

## Implementation Details

### trigger_recipe Function

```python
async def trigger_recipe(
    basket_id: str,
    workspace_id: Optional[str],
    user_id: str,
    session_id: Optional[str],
    recipe_slug: str,
    parameters: Dict[str, Any],
    priority: int = 5,
    schedule_id: Optional[str] = None,  # NEW
    mode: str = "one_shot",              # NEW
    cycle_number: int = 1,               # NEW
) -> Dict[str, Any]:
```

### Schedule Executor (Future)

The schedule executor is a worker process that:
1. Polls `project_schedules WHERE enabled = true AND next_run_at <= now()`
2. For each due schedule:
   - Finds existing continuous ticket OR creates new one
   - Calls `trigger_recipe` with `schedule_id`, `mode='continuous'`
   - Updates `project_schedules.last_run_at`, `next_run_at`

### Output Promotion

When a work output is approved and promoted:
1. Create/update `context_items` entry
2. Set `work_outputs.promoted_to_context_item_id`
3. Set `work_outputs.promotion_status = 'promoted'`
4. Context item inherits `updated_by: 'agent:{recipe_slug}'`

## Compatibility

### TP Direct Triggers

TP can still trigger recipes directly (no schedule):
- `schedule_id = None`
- `mode = 'one_shot'`
- `source = 'thinking_partner'`

### Existing Work Tickets

Existing tickets default to:
- `mode = 'one_shot'`
- `schedule_id = NULL`
- `cycle_number = 1`

No data migration needed.

## Migration

Applied: `supabase/migrations/20251204_continuous_work_model.sql`

```sql
-- Key changes:
ALTER TABLE work_tickets ADD COLUMN schedule_id UUID;
ALTER TABLE work_tickets ADD COLUMN mode TEXT DEFAULT 'one_shot';
ALTER TABLE work_tickets ADD COLUMN cycle_number INTEGER DEFAULT 1;
ALTER TABLE work_iterations ADD CONSTRAINT ... CHECK (triggered_by IN (..., 'schedule'));
ALTER TABLE work_outputs ADD COLUMN promoted_to_context_item_id UUID;
```

## Future Work

1. **Schedule Executor Worker** - Cron job or pg_cron to process due schedules
2. **Continuous Ticket UI** - Show cycle history, accumulated context
3. **Auto-promotion Rules** - Configure automatic output-to-context promotion
4. **Cross-cycle Context** - Allow recipes to explicitly reference previous cycle outputs

## Related Documents

- [ADR_CONTEXT_ITEMS_UNIFIED.md](./ADR_CONTEXT_ITEMS_UNIFIED.md) - Context tiers
- [ADR_CONTEXT_ENTRIES.md](./ADR_CONTEXT_ENTRIES.md) - Context entry schemas
- [THINKING_PARTNER_IMPLEMENTATION_PLAN.md](../implementation/THINKING_PARTNER_IMPLEMENTATION_PLAN.md) - TP architecture
