# Context Roles Architecture

**Version**: 1.0
**Date**: 2025-12-02
**Status**: Canonical
**Category**: Substrate Architecture
**Related**: ANCHOR_SEEDING_ARCHITECTURE.md, TERMINOLOGY_GLOSSARY.md

---

## Executive Summary

This document establishes the canonical architecture for **Context Roles** - the system by which blocks are tagged with strategic significance and how work recipes interact with context. It represents a consolidation and clarification of the anchor system following production learnings.

### Key Decisions

1. **`basket_anchors` table**: **DEPRECATED** - No production data, superseded by `blocks.anchor_role`
2. **Context Roles live on blocks**: The `anchor_role` column on `blocks` is the source of truth
3. **Work Outputs remain the intermediary**: Agent outputs go through `work_outputs` before promotion to blocks
4. **Roles are advisory, not gates**: Agents work with available context; missing roles don't block execution
5. **Refresh policies enable scheduling**: Blocks with context roles can have TTL-based refresh semantics

---

## Background: How We Got Here

### The Original Design (Sept 2025)

The initial anchor system had two components:

```
basket_anchors (registry) ──────► linked_substrate_id ──────► blocks
     │                                                           │
     └── anchor_key: 'problem'                                   └── (content)
```

- `basket_anchors` defined expected anchor slots per basket
- `linked_substrate_id` pointed to the block filling that slot
- This was a **slot-based registry** model

### The Phase A Refactor (Oct 2025)

Migration `20251003_anchor_substrate_metadata.sql` moved anchors to substrate metadata:

```sql
ALTER TABLE blocks
  ADD COLUMN anchor_role TEXT,    -- 'problem', 'customer', 'vision', etc.
  ADD COLUMN anchor_status TEXT,  -- 'proposed', 'accepted', 'rejected'
  ADD COLUMN anchor_confidence REAL;
```

This created a **content-tagged** model where blocks self-declare their role.

### The Confusion

Both systems coexisted:
- `basket_anchors` table kept for rollback safety (never dropped)
- `blocks.anchor_role` became the active source of truth
- Code shimmed between them via `anchored_substrate` view
- Terminology overloaded: "anchor" meant both "slot" and "role tag"

### Production Reality (Dec 2025)

Audit findings:
- `basket_anchors` table: **0 rows** (never populated in production)
- `blocks` with `anchor_role`: **10 blocks across 2 baskets**
- `registry.ts` reads from `anchored_substrate` view (queries blocks, not basket_anchors)
- Write functions (`insertCustomAnchor`, etc.) target `basket_anchors` but are never called

**Conclusion**: The registry model was abandoned. Blocks with anchor roles are the only active system.

---

## Decision: Deprecate `basket_anchors`

### Evidence

| Factor | Finding |
|--------|---------|
| Production data | 0 rows in `basket_anchors` |
| Active reads | `listAnchorsWithStatus()` queries `anchored_substrate` view (blocks table) |
| Active writes | None - write functions exist but are dead code |
| Dependencies | Purge function references it; can be updated |
| Rollback need | 2+ months since refactor; no issues reported |

### Decision

**DEPRECATE `basket_anchors`** with the following actions:

1. **Immediate**: Mark as deprecated in schema comments
2. **Migration**: Update purge function to remove reference
3. **Cleanup**: Remove dead code in `registry.ts` (write functions)
4. **Future**: Drop table after 30-day observation period

### Why Not Keep It?

The slot-based model has value for:
- Defining expected roles per project
- Showing "missing" anchors in UI
- Pre-scaffolding context structure

However, this can be achieved without a separate table:
- Foundation roles (`problem`, `customer`, `vision`) are universal
- UI can check for missing roles by querying blocks
- Recipe declarations define what roles they expect/produce

Keeping `basket_anchors` creates confusion without adding value.

---

## Canonical Model: Context Roles

### Terminology

| Term | Definition | Where It Lives |
|------|------------|----------------|
| **Context Role** | A strategic function a block serves | `blocks.anchor_role` |
| **Role Status** | Whether the block is accepted for that role | `blocks.anchor_status` |
| **Foundation Roles** | Universal roles every project should have | `problem`, `customer`, `vision` |
| **Insight Roles** | Derived/synthesized roles from agent work | `trend_digest`, `competitor_snapshot`, etc. |
| **Refresh Policy** | TTL and source metadata for role refresh | `blocks.metadata` or new column |

### Schema (Current)

```sql
-- blocks table (existing)
anchor_role TEXT CHECK (
  anchor_role IN (
    'problem', 'customer', 'solution', 'feature',
    'constraint', 'metric', 'insight', 'vision'
  )
),
anchor_status TEXT CHECK (
  anchor_status IN ('proposed', 'accepted', 'rejected', 'n/a')
) DEFAULT 'proposed',
anchor_confidence REAL CHECK (
  anchor_confidence >= 0.0 AND anchor_confidence <= 1.0
)
```

### Role Categories

**Foundation Roles** (human-established, stable):
- `problem` - What pain point is being solved
- `customer` - Who this is for
- `vision` - Where this is going

**Strategic Roles** (human or agent, evolving):
- `solution` - How it's solved
- `feature` - Key capabilities
- `constraint` - Limitations/requirements
- `metric` - Success measures
- `insight` - Key learnings

**Insight Roles** (to be added, agent-produced, refreshable):
- `trend_digest` - Synthesized market/industry trends
- `competitor_snapshot` - Competitive intelligence
- `market_signal` - External signals and indicators

---

## Work Outputs: The Quality Gate

### Why Keep Work Outputs?

Direct block creation from recipes bypasses quality control. The work outputs layer provides:

1. **Review checkpoint**: Humans can reject poor outputs before they become substrate
2. **Iteration safety**: Bad weekly runs don't pollute context
3. **Audit trail**: Full history of what was proposed vs. accepted
4. **Recursion control**: Prevents runaway agent chains

### The Flow

```
┌──────────────────┐     ┌──────────────────┐     ┌──────────────────┐
│   Work Recipe    │     │   Work Output    │     │      Block       │
│                  │     │                  │     │                  │
│ context_outputs: │ ──► │ target_role:     │ ──► │ anchor_role:     │
│   role: trend_   │     │   trend_digest   │     │   trend_digest   │
│   digest         │     │ promotion_status:│     │ anchor_status:   │
│                  │     │   pending        │     │   accepted       │
└──────────────────┘     └──────────────────┘     └──────────────────┘
```

### Schema Extension (Proposed)

```sql
-- work_outputs (add columns)
ALTER TABLE work_outputs
  ADD COLUMN target_context_role TEXT,
  ADD COLUMN auto_promote BOOLEAN DEFAULT false;
```

- `target_context_role`: Which role this output is meant to fill
- `auto_promote`: Whether to skip human review (for trusted, scheduled recipes)

---

## Recipe Declarations

### Current Schema

```json
{
  "context_requirements": {
    "substrate_blocks": {
      "min_blocks": 3,
      "semantic_types": ["insight", "finding"],
      "recency_preference": "last_90_days"
    }
  }
}
```

### Extended Schema (Proposed)

```json
{
  "context_requirements": {
    "roles": ["customer", "brand_voice"],
    "roles_optional": ["trend_digest"],
    "substrate_blocks": {
      "min_blocks": 3,
      "semantic_types": ["insight", "finding"]
    }
  },
  "context_outputs": {
    "role": "trend_digest",
    "refresh_policy": {
      "ttl_hours": 168,
      "auto_promote": true
    }
  }
}
```

### Recipe Types

| Type | Consumes | Produces | Examples |
|------|----------|----------|----------|
| **Context-producing** | Foundation roles | Insight roles | Weekly Trend Scan, Competitor Intel |
| **Execution** | All role types | Work deliverables (not roles) | Content Brief, Social Posts |

---

## Scheduling Layer

### Mechanism

Use Supabase's `pg_cron` extension for scheduling:

```sql
-- New table for project-level recipe schedules
CREATE TABLE project_recipe_schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  recipe_slug TEXT NOT NULL REFERENCES work_recipes(slug),
  cron_expression TEXT,           -- e.g., '0 9 * * 1' (Monday 9am)
  interval_hours INTEGER,         -- Alternative to cron
  enabled BOOLEAN DEFAULT true,
  last_run_at TIMESTAMPTZ,
  next_run_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(project_id, recipe_slug)
);
```

### Freshness-Driven Execution

The scheduler checks:

1. Find blocks with `anchor_role` and refresh metadata
2. Check if `updated_at` exceeds TTL
3. Find recipe that produces that role
4. Verify recipe's required roles are fresh
5. Queue work request if conditions met

---

## Quality Measurement

### Role Value Assessment

How to determine if a role improves output quality:

| Role | Measurement Approach |
|------|---------------------|
| Foundation (`problem`, `customer`, `vision`) | Compare output coherence with/without |
| Insight (`trend_digest`) | Track engagement on content using trends vs. not |
| All roles | Human quality ratings on work outputs |

### Emergent Role Discovery

Roles don't need to be pre-defined:

1. Recipe declares `context_outputs.role: "new_role_type"`
2. First execution creates block with that role
3. Other recipes can now consume it
4. If never consumed, role naturally becomes irrelevant

---

## Migration Path

### Phase 1: Schema Cleanup (Immediate)

1. Add deprecation comment to `basket_anchors`
2. Remove unused write functions from `registry.ts`
3. Update purge function

### Phase 2: Extended Anchor Roles (Short-term)

1. Add new roles to CHECK constraint: `trend_digest`, `competitor_snapshot`
2. Add `refresh_policy` to blocks metadata or as column

### Phase 3: Work Outputs Enhancement (Short-term)

1. Add `target_context_role` and `auto_promote` to `work_outputs`
2. Update promotion logic to set `anchor_role` on promoted blocks

### Phase 4: Recipe Declarations (Medium-term)

1. Extend `context_requirements` JSONB to include `roles`
2. Add `context_outputs` to recipe schema

### Phase 5: Scheduling (Medium-term)

1. Create `project_recipe_schedules` table
2. Implement pg_cron integration
3. Build freshness-checking logic

---

## Relationship to Existing Documentation

| Document | Relationship |
|----------|--------------|
| `ANCHOR_SEEDING_ARCHITECTURE.md` | Describes LLM-based anchor creation; still valid |
| `TERMINOLOGY_GLOSSARY.md` | Needs update with Context Roles terminology |
| `YARNNN_DATA_FLOW_V4.md` | Describes context assembly; compatible with this |

---

## Appendix: Audit Evidence

### Database State (2025-12-02)

```sql
-- basket_anchors: Empty
SELECT COUNT(*) FROM basket_anchors;
-- Result: 0

-- blocks with anchor_role: Active
SELECT anchor_role, anchor_status, COUNT(*)
FROM blocks WHERE anchor_role IS NOT NULL
GROUP BY anchor_role, anchor_status;
-- Result:
-- feature  | proposed | 1
-- insight  | proposed | 4
-- metric   | proposed | 2
-- solution | proposed | 2
-- vision   | proposed | 1
```

### Code Usage Analysis

| Function | Table | Usage |
|----------|-------|-------|
| `loadRegistry()` | `anchored_substrate` (view on blocks) | Active - used by API |
| `listAnchorsWithStatus()` | `anchored_substrate` | Active - used by UI |
| `upsertAnchorRegistryRow()` | `basket_anchors` | Dead code - never called |
| `insertCustomAnchor()` | `basket_anchors` | Dead code - never called |
| `archiveAnchor()` | `basket_anchors` | Dead code - never called |
| `linkAnchorToSubstrate()` | `basket_anchors` | Dead code - never called |

---

**Document Status**: Canonical
**Last Updated**: 2025-12-02
**Owner**: Architecture Team
