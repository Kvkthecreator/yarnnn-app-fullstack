# Anchor Seeding Architecture

**Version**: 1.0
**Date**: 2025-11-28
**Status**: Implementation Ready
**Category**: Substrate Architecture Enhancement
**Supersedes**: CONTEXT_TEMPLATES_ARCHITECTURE.md

---

## Executive Summary

**Anchor Seeding** is an LLM-powered approach to bootstrap foundational context in new baskets. Rather than fixed template schemas, it leverages the existing `anchor_role` infrastructure to create project-specific foundational blocks from minimal user input.

**Key Decision**: Context Templates (fixed schemas) are being **replaced** by Anchor Seeding (LLM-generated blocks with anchor roles). This provides:

1. **Flexibility** - No rigid template schemas; LLM decides what's relevant
2. **Magic UX** - Users describe their project; system creates foundational blocks
3. **Existing Infrastructure** - Leverages `anchor_role`, `basket_anchors`, lifecycle management
4. **Recipe Compatibility** - Recipes query by `anchor_role` (generic) not `template_id` (specific)

---

## Decision History

### Why Context Templates Were Considered

The original goal was to ensure baskets have foundational context for agents:

- **Problem**: New baskets start empty; agents lack context
- **Initial Solution**: Fixed templates (brand_identity, competitor_registry, etc.)
- **Implementation**: `context_template_catalog` table, form-based filling

### Why We're Pivoting to Anchor Seeding

During implementation review, we identified:

1. **Redundancy**: Anchor Blocks already solve the "important blocks" problem
2. **Rigidity**: Fixed templates create recipe → template dependencies
3. **Better Fit**: `anchor_role` is more primitive and LLM-friendly
4. **Existing Infrastructure**: `basket_anchors`, `anchor_role` column, lifecycle code

### The Core Insight

```
Context Templates: "Every basket should have a Brand Identity block"
Anchor Blocks:     "Every basket should have a `customer` anchor"

Templates prescribe CONTENT STRUCTURE.
Anchors prescribe SEMANTIC IMPORTANCE.
```

Anchors are more flexible - they don't dictate what a "customer" anchor looks like, just that one should exist.

---

## Architecture Design

### Anchor Roles (Existing Schema)

```sql
anchor_role IN ('problem', 'customer', 'solution', 'feature',
                'constraint', 'metric', 'insight', 'vision')
```

These 8 roles cover the foundational context any project needs:

| Role | Purpose | Example |
|------|---------|---------|
| `problem` | What pain point is being solved | "Marketing teams lack real-time metrics" |
| `customer` | Who is this for | "Marketing managers at mid-size B2B companies" |
| `solution` | How is it solved | "Real-time analytics dashboard with AI insights" |
| `vision` | Where is this going | "Democratize data-driven marketing" |
| `feature` | Key capabilities | "Custom report builder" |
| `constraint` | Limitations/requirements | "Must integrate with existing CRM" |
| `metric` | Success measures | "50% reduction in reporting time" |
| `insight` | Key learnings | "Users prefer visual dashboards over tables" |

### Anchor Seeding Flow

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         PROJECT CREATION                                 │
│                                                                          │
│   User Input:                                                            │
│   ┌──────────────────────────────────────────────────────────────────┐  │
│   │ Project Name: [Analytics Dashboard]                               │  │
│   │ Description: [Optional brief description]                         │  │
│   │                                                                    │  │
│   │ What are you working on? (optional)                               │  │
│   │ ┌────────────────────────────────────────────────────────────┐   │  │
│   │ │ We're building a SaaS analytics platform for marketing     │   │  │
│   │ │ teams. Main problem is they spend too much time on manual  │   │  │
│   │ │ reporting. Target: mid-market B2B companies...             │   │  │
│   │ └────────────────────────────────────────────────────────────┘   │  │
│   └──────────────────────────────────────────────────────────────────┘  │
│                              │                                           │
│                              ▼                                           │
│   ┌──────────────────────────────────────────────────────────────────┐  │
│   │                    ANCHOR SEEDING ENDPOINT                        │  │
│   │                                                                    │  │
│   │  LLM analyzes input and generates 2-4 foundational blocks:       │  │
│   │                                                                    │  │
│   │  Block 1: semantic_type=entity, anchor_role=customer              │  │
│   │           "Marketing managers at mid-market B2B companies"        │  │
│   │                                                                    │  │
│   │  Block 2: semantic_type=finding, anchor_role=problem              │  │
│   │           "Manual reporting consumes 40% of analyst time"         │  │
│   │                                                                    │  │
│   │  Block 3: semantic_type=objective, anchor_role=vision             │  │
│   │           "Automate insights delivery for marketing teams"        │  │
│   │                                                                    │  │
│   └──────────────────────────────────────────────────────────────────┘  │
│                              │                                           │
│                              ▼                                           │
│                    Blocks created with anchor_role                       │
│                    basket_anchors registry updated                       │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

### Project Creation Options

**Option A: Light Start (skip rich input)**
```
Name + Description → Empty basket → User adds context later
```
- Show "Add Context" prompt on Context page
- User can manually create blocks or use "Seed Anchors" later

**Option B: Rich Start (provide context)**
```
Name + Description + Rich Input → LLM seeds anchor blocks → Basket has foundation
```
- Immediate value
- User can edit/refine generated blocks

Both paths are valid; rich input is **encouraged but optional**.

---

## Implementation Plan

### Phase 1: Cleanup (Delete Context Templates)

1. **Database**: Drop `context_template_catalog` table, remove `required_templates`/`recommended_templates` from `work_recipes`
2. **substrate-api**: Delete `/api/templates/*` routes
3. **work-platform/web**: Delete template components and BFF routes

### Phase 2: Anchor Seeding Endpoint

Create `POST /api/baskets/{id}/seed-anchors`:

```python
class AnchorSeedRequest(BaseModel):
    context: str  # User's rich input

class AnchorSeedResponse(BaseModel):
    blocks_created: List[BlockSummary]
    anchors_registered: List[str]  # anchor_roles

async def seed_anchors(basket_id: str, request: AnchorSeedRequest):
    """
    Use LLM to generate foundational blocks with anchor_role.
    """
    prompt = f"""
    Given this project context:
    {request.context}

    Generate 2-4 foundational context blocks. For each block provide:
    1. title: Brief descriptive title
    2. content: 2-3 sentence description
    3. semantic_type: One of (entity, objective, finding, constraint)
    4. anchor_role: One of (problem, customer, solution, vision, feature, constraint, metric, insight)

    Focus on identifying:
    - Who is the customer/user?
    - What problem is being solved?
    - What is the vision/goal?

    Return as JSON array.
    """

    # Call OpenAI (simple completion, not agents)
    blocks = await generate_anchor_blocks(prompt)

    # Create blocks with anchor_role
    created = []
    for block in blocks:
        result = await create_block(
            basket_id=basket_id,
            title=block.title,
            content=block.content,
            semantic_type=block.semantic_type,
            anchor_role=block.anchor_role,
            anchor_status='accepted',
            state='ACCEPTED'
        )
        created.append(result)

        # Register in basket_anchors
        await register_anchor(basket_id, block.anchor_role, result.id)

    return AnchorSeedResponse(
        blocks_created=created,
        anchors_registered=[b.anchor_role for b in blocks]
    )
```

### Phase 3: Frontend Refactor

1. **CreateProjectDialog**: Add optional "What are you working on?" textarea
2. **AnchorStatusSection**: Show anchor health on Context page (replaces CoreContextSection)
3. **SetupContextBanner**: "Your project needs a customer anchor" (not template-based)

### Phase 4: Recipe Integration

Recipes query by anchor_role instead of template_id:

```python
# Before (templates)
required_templates = ['brand_identity', 'target_audience']

# After (anchors)
required_anchors = ['customer', 'problem']  # More generic
```

---

## Comparison: Templates vs Anchors

| Aspect | Context Templates (old) | Anchor Seeding (new) |
|--------|------------------------|---------------------|
| **Schema** | Fixed fields per template | Standard block + anchor_role |
| **Creation** | User fills form | LLM generates from context |
| **Flexibility** | Low (predefined schemas) | High (8 generic roles) |
| **Query Pattern** | `metadata.template_id = 'brand_identity'` | `anchor_role = 'customer'` |
| **Recipe Binding** | Tight (specific template) | Loose (generic role) |
| **User Effort** | Fill 5 forms | Paste context, review blocks |
| **LLM Friendly** | Constrained by schema | Natural fit |

---

## Migration Notes

### What Gets Deleted

**Database**:
- `context_template_catalog` table
- `required_templates` column on `work_recipes`
- `recommended_templates` column on `work_recipes`

**substrate-api**:
- `/api/templates/*` routes
- `context_templates/` module

**work-platform/web**:
- `CoreContextSection.tsx`
- `TemplateFormModal.tsx`
- `SetupContextBanner.tsx` (will be refactored, not deleted)
- `/api/projects/[id]/context/templates/*` routes

### What Gets Kept/Refactored

**Existing anchor infrastructure** (already exists):
- `basket_anchors` table
- `anchor_role` column on blocks
- `anchor_status`, `anchor_confidence` columns
- `lib/anchors/registry.ts`

**Refactored**:
- `CreateProjectDialog` - add optional rich input
- `SetupContextBanner` - show anchor status instead of template status
- Project creation flow - call seed endpoint if rich input provided

---

## Success Metrics

1. **Basket Bootstrap Time**: < 5 seconds to seed anchors from context
2. **Anchor Coverage**: 80%+ of baskets have at least 2 anchors after seeding
3. **User Editing Rate**: Track how often users edit seeded blocks (validates quality)
4. **Recipe Success Rate**: Recipes find required anchors (no "missing context" errors)

---

## Related Documentation

- [SEMANTIC_TYPES_QUICK_REFERENCE.txt](../../SEMANTIC_TYPES_QUICK_REFERENCE.txt) - Anchor role inference
- [basket_anchors migration](../../supabase/migrations/20250928_add_basket_anchor_registry.sql) - Anchor registry schema
- [anchor_substrate_metadata migration](../../supabase/migrations/20251003_anchor_substrate_metadata.sql) - anchor_role column
- [CONTEXT_TEMPLATES_ARCHITECTURE.md](./CONTEXT_TEMPLATES_ARCHITECTURE.md) - Superseded design

---

**Document Status**: Implementation Ready
**Next Steps**: Execute cleanup, build anchor seeding endpoint
**Owner**: Architecture Team
