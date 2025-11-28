# Context Templates Architecture

**Version**: 1.1
**Date**: 2025-11-28
**Status**: Design Complete, Implementation Ready
**Category**: Substrate Architecture Enhancement

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Critical Architectural Boundary](#critical-architectural-boundary)
3. [Background & Decision History](#background--decision-history)
4. [Problem Statement](#problem-statement)
5. [Architecture Design](#architecture-design)
6. [Terminology & Naming](#terminology--naming)
7. [Scope Decision](#scope-decision)
8. [Work Recipe Integration](#work-recipe-integration)
9. [Implementation Plan](#implementation-plan)
10. [Future Considerations](#future-considerations)

---

## Executive Summary

**Context Templates** are pre-defined structures that guide the creation of foundational context blocks within a basket. They represent a layer of UX guidance with minimal database footprint, designed to:

1. Ensure baskets have essential context blocks (brand name, competitors, etc.)
2. Improve deterministic agent behavior through structured context
3. Reduce token usage by enabling structured context summaries
4. Increase recursion accuracy in work output → substrate feedback loops

**Key Design Decision**: Context Templates are **scaffolding tools** that produce **actual blocks** - they are not a separate substrate type. The template guides creation; the result is standard context blocks.

---

## Critical Architectural Boundary

### Context Templates vs Work Recipes: Upstream vs Downstream

This section clarifies the **non-overlapping** domains of Context Templates and Work Recipes.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        ARCHITECTURAL FLOW                                    │
│                                                                              │
│   UPSTREAM (Substrate Layer)              DOWNSTREAM (Work Platform)         │
│   ─────────────────────────              ────────────────────────────        │
│                                                                              │
│   Context Templates                       Work Recipes                       │
│        ↓ scaffolds                             ↓ scaffolds                   │
│   Context Blocks (foundational)           Work Requests (execution)          │
│        ↓ consumed by                           ↓ references                  │
│        └──────────────────────────────────────→│                             │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Domain Separation

| Aspect | Context Templates (Substrate) | Work Recipes (Work Platform) |
|--------|------------------------------|------------------------------|
| **Purpose** | Define WHAT the basket knows | Define HOW work gets done |
| **Data Type** | Static identity context | Dynamic execution parameters |
| **Persistence** | Basket-level, reused across work | Per work_request, ephemeral |
| **User Interaction** | Fill once during basket setup | Configure per work execution |
| **Examples** | Brand name, competitor list, audience | Slide count, focus area, depth |

### The Complementary Relationship

**Context Templates** provide the **foundational substrate** that **Work Recipes** consume:

1. **Templates create blocks** → Brand Identity block exists with name, tagline
2. **Recipes reference blocks** → "Executive Summary Deck" recipe queries brand context
3. **No duplication** → Recipe doesn't re-collect brand name; it uses the block

### What Goes Where (Decision Framework)

**Use Context Template when:**
- Information is static/persistent (doesn't change per work request)
- Information is identity-related (who, what, for whom)
- Information is reused across multiple work types
- Information should exist before any work runs

**Use Work Recipe Parameter when:**
- Information is execution-specific (changes per request)
- Information configures output format (slide count, length, style)
- Information is a one-time instruction (focus area for this specific task)
- Information wouldn't make sense to store permanently

### Examples of Correct Classification

| Information | Correct Location | Rationale |
|-------------|------------------|-----------|
| Company name | Context Template (`brand_identity`) | Static, reused everywhere |
| Competitor names | Context Template (`competitor_registry`) | Reference list, reused |
| Target audience segments | Context Template (`target_audience`) | Strategic, defined once |
| Slide count for deck | Work Recipe parameter | Per-execution configuration |
| "Focus on Q4 results" | Work Recipe parameter | One-time instruction |
| Research depth (quick/deep) | Work Recipe parameter | Execution mode selection |

---

## Background & Decision History

### The Evolution of This Decision

#### Phase 1: SDK Removal Pivot (2025-11-17)
The YARNNN platform removed the Claude Agent SDK in favor of direct Anthropic API integration. This pivot documented in [PHASE_SDK_REMOVAL_PIVOT.md](../deployment/PHASE_SDK_REMOVAL_PIVOT.md) identified:

- **Problem**: 40K+ input tokens per agent execution
- **Observation**: Substrate tables were underutilized
- **Opportunity**: Better structured context could reduce tokens and improve accuracy

#### Phase 2: Substrate Architecture Review (2025-11-28)
Analysis of the three core substrate types revealed:

| Type | Purpose | Current State |
|------|---------|---------------|
| **Blocks** | Propositional knowledge | Well-architected, versioned, governed |
| **Assets** | Non-text references | Functional, supports agent scoping |
| **Work Outputs** | Agent deliverables | Recursion workflow complete via bridge |

**Gap Identified**: No mechanism to ensure baskets have foundational context blocks that agents need for deterministic operation.

#### Phase 3: Initial "Context Templates" Concept
Initial proposal considered templates as a separate database entity with:
- Formal schema definitions
- Required/optional field validation
- Strict enforcement via FK relationships

**Pivoted Away From**: This approach was deemed over-engineered.

#### Phase 4: Refined Design (Current)
Through collaborative discussion, the design evolved to:

> "Context Templates should help 'become' or create fixed/determined context blocks with inputted information. The end result can and should be actual context_blocks."

**Key Insight**: Templates are **creation guidance**, not a persistent entity type. They scaffold block creation through UI and minimal DB support - similar to how Work Recipes scaffold work requests on the work-platform side.

### Why This Matters

**Current State (Without Templates)**:
```
User creates basket → Empty substrate → Agent runs with no context
→ Generic outputs → Poor recursion → No improvement
```

**Future State (With Templates)**:
```
User creates basket → Prompted to fill core blocks (brand, competitors, etc.)
→ Agent runs with structured context → Specific outputs
→ Accurate recursion → Context enrichment flywheel
```

---

## Problem Statement

### Problem 1: Agent Token Inefficiency
**Current**: Agents receive 15K+ tokens of unstructured blocks via semantic search
**Impact**: High cost, diluted context, unpredictable relevance

### Problem 2: Non-Deterministic Agent Behavior
**Current**: Agents reason from whatever blocks exist (or don't exist)
**Impact**: Inconsistent output quality, user confusion

### Problem 3: Missing Foundational Context
**Current**: No guidance on what blocks a basket should have
**Impact**: Users don't know what to provide; agents don't know what to expect

### Problem 4: Weak Recursion Accuracy
**Current**: Work outputs promote to blocks with generic semantic_types
**Impact**: Future retrieval unreliable, flywheel doesn't spin

---

## Architecture Design

### Core Principle: Templates Produce Blocks

```
┌─────────────────────────────────────────────────────────────┐
│                 CONTEXT TEMPLATE CATALOG                     │
│  (Pre-defined structures - stored as JSON or in DB table)   │
│                                                              │
│  Examples:                                                   │
│  - "brand_identity": {name, tagline, values, voice}         │
│  - "competitor_profile": {name, positioning, strengths}     │
│  - "product_specification": {name, features, pricing}       │
└─────────────────────────────────────────────────────────────┘
                        │
                        │ User fills template
                        │ (via UI form or API)
                        ↓
┌─────────────────────────────────────────────────────────────┐
│                    CONTEXT BLOCKS                            │
│  (Standard blocks table - the actual substrate)             │
│                                                              │
│  Result:                                                     │
│  Block {                                                     │
│    semantic_type: "entity",                                  │
│    title: "Brand Identity: Acme Corp",                       │
│    content: "{name: 'Acme', tagline: 'Quality First'...}",  │
│    metadata: {template_id: "brand_identity", ...}           │
│  }                                                           │
└─────────────────────────────────────────────────────────────┘
```

### Design Decisions

#### Decision 1: Soft-Link Approach ✅
Templates **guide but do not enforce**.

**Rationale**:
- Blocks can exist without templates (manual creation remains valid)
- Templates can suggest structure without rigid validation
- Maximum flexibility for diverse use cases

**Implementation**: Blocks may have `metadata.template_id` reference, but no FK constraint.

#### Decision 2: Basket-Scoped by Default ✅
Templates and resulting blocks are scoped to baskets, not workspaces.

**Rationale from Architecture Analysis**:
- Blocks table has `basket_id` as primary scope
- `workspace_id` exists for CONSTANT blocks (cross-basket)
- Pattern: basket-scoped by default, workspace-elevation for constants

**Implementation**: Template instances are per-basket. Template definitions can be workspace-shared.

#### Decision 3: Minimal Database Footprint ✅
Templates are primarily a **front-end/UX concern** with light DB support.

**Rationale**:
- Avoids schema complexity
- Templates evolve faster than DB migrations
- Similar to Work Recipes pattern on work-platform

**Implementation Options**:
1. **JSON files** in codebase (like existing basket templates)
2. **Single `context_template_catalog` table** for dynamic templates
3. **Hybrid**: Built-in templates (JSON) + user-defined (DB)

Recommended: **Option 3 (Hybrid)** - matches existing Basket Template pattern.

### Data Model

#### Template Catalog (DB Table - Optional)

```sql
CREATE TABLE context_template_catalog (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Identity
    slug TEXT NOT NULL UNIQUE,           -- "brand_identity", "competitor_profile"
    name TEXT NOT NULL,                   -- "Brand Identity"
    description TEXT,
    category TEXT,                        -- "foundational", "research", "operational"

    -- Schema Definition
    schema JSONB NOT NULL,               -- Field definitions (see below)

    -- Scope
    scope TEXT DEFAULT 'global',          -- "global" (built-in), "workspace" (custom)
    workspace_id UUID REFERENCES workspaces(id),  -- NULL for global templates

    -- Metadata
    is_required BOOLEAN DEFAULT false,    -- Must be filled for basket setup?
    display_order INTEGER DEFAULT 0,
    icon TEXT,                            -- UI display icon

    -- Audit
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- Index for workspace-scoped templates
CREATE INDEX idx_template_catalog_workspace ON context_template_catalog(workspace_id)
    WHERE workspace_id IS NOT NULL;
```

#### Template Schema Definition (JSONB)

```json
{
  "fields": [
    {
      "key": "name",
      "label": "Brand Name",
      "type": "text",
      "required": true,
      "placeholder": "Enter your brand name",
      "validation": {
        "minLength": 1,
        "maxLength": 100
      }
    },
    {
      "key": "tagline",
      "label": "Tagline",
      "type": "text",
      "required": false,
      "placeholder": "Your brand's core message"
    },
    {
      "key": "competitors",
      "label": "Key Competitors",
      "type": "array",
      "itemType": "text",
      "required": true,
      "minItems": 1,
      "maxItems": 10
    },
    {
      "key": "logo",
      "label": "Brand Logo",
      "type": "asset_ref",
      "assetTypes": ["image/png", "image/svg+xml"],
      "required": false
    }
  ],
  "outputConfig": {
    "semantic_type": "entity",
    "title_template": "Brand Identity: {name}",
    "state": "ACCEPTED"
  }
}
```

#### Block with Template Reference

When a template is filled, it creates a standard block:

```sql
INSERT INTO blocks (
    basket_id,
    workspace_id,
    semantic_type,
    title,
    content,
    state,
    metadata
) VALUES (
    'basket-uuid',
    'workspace-uuid',
    'entity',
    'Brand Identity: Acme Corp',
    '{"name": "Acme Corp", "tagline": "Quality First", "competitors": ["Beta Inc", "Gamma LLC"]}',
    'ACCEPTED',
    '{"template_id": "brand_identity", "template_version": 1, "filled_at": "2025-11-28T10:00:00Z"}'
);
```

### Built-in Templates (Foundational)

These are the **core foundational templates** - designed to capture **static identity context** that Work Recipes will reference (not re-collect):

| Template ID | Name | Fields | Purpose | Work Recipe Usage |
|-------------|------|--------|---------|-------------------|
| `brand_identity` | Brand Identity | name, tagline, mission, values | Anchors all brand-related context | All recipes query for brand context |
| `competitor_registry` | Competitor Registry | names[], urls[], notes[] | Reference list of competitors | Research recipes iterate over this list |
| `target_audience` | Target Audience | segments[], personas[], pain_points[] | Strategic audience definition | Content recipes tailor to segments |
| `brand_voice` | Brand Voice | tone, style, vocabulary[], dont_use[] | Consistent voice guidance | Content/reporting recipes apply voice |
| `strategic_priorities` | Strategic Priorities | objectives[], timeframes[], kpis[] | Basket-level goals | Recipes align outputs to objectives |

**Explicitly NOT included** (these are Work Recipe parameters):
- ~~focus_area~~ → Per-execution instruction
- ~~output_length~~ → Per-execution configuration
- ~~research_depth~~ → Per-execution mode
- ~~specific_product_focus~~ → Per-execution scope

---

## Terminology & Naming

### Terminology Conflict Check ✅

| Existing Term | Location | Meaning | Conflict? |
|---------------|----------|---------|-----------|
| **Basket Template** | `template_cloner.py`, `/templates/` | Starter kit for new baskets | **No** - different scope |
| **Template-based generation** | `document_composition_schema.py` | Document generation approach | **No** - different domain |

**Conclusion**: "Context Template" is safe to use. It refers specifically to **block structure templates**, distinct from **basket starter templates**.

### Recommended Terminology

| Term | Definition | Use When |
|------|------------|----------|
| **Context Template** | Pre-defined structure for foundational blocks | Discussing the template definition |
| **Foundational Block** | A block created from a context template | Discussing the resulting block |
| **Template Catalog** | Collection of available context templates | Discussing available options |
| **Template Instance** | A filled template (becomes a block) | During creation workflow |

### Glossary Addition

Add to `TERMINOLOGY_GLOSSARY.md`:

```markdown
### Context Templates (NEW - 2025-11-28)

**Definition**: Pre-defined structures that guide the creation of foundational context blocks within a basket.

**Key Characteristics**:
- Scaffolding tool, not a substrate type
- Produces standard blocks with template metadata
- Soft-linked (blocks can reference template_id but no FK enforcement)
- Basket-scoped by default

**Distinction from Basket Templates**:
- **Basket Templates**: Starter kits for creating new baskets (e.g., "Brand Playbook")
- **Context Templates**: Structure definitions for individual blocks within any basket

**Related**: Blocks, Foundational Blocks, Work Recipes (work-platform analogy)
```

---

## Scope Decision

### Analysis of Existing Architecture

From `20250115_substrate_v3_purge_and_rebuild.sql`:

```sql
-- Blocks have basket_id as primary scope
CREATE INDEX idx_blocks_basket_state_time ON blocks(basket_id, state, last_validated_at DESC)
    WHERE state = 'ACCEPTED';

-- workspace_id exists for cross-basket memory (CONSTANT blocks)
CREATE INDEX idx_blocks_workspace_scope ON blocks(workspace_id, scope, state)
    WHERE scope IS NOT NULL;
```

**Pattern**:
- `basket_id` = default scope for blocks
- `workspace_id` = elevated scope for CONSTANT blocks
- `scope_level` enum: `BASKET` → `WORKSPACE` → `ORG` → `GLOBAL`

### Decision: Basket-Scoped Templates, Workspace-Shared Definitions

```
┌─────────────────────────────────────────────────────────────┐
│               TEMPLATE DEFINITIONS                           │
│  (Workspace or Global scope)                                 │
│                                                              │
│  Global: brand_identity, competitor_profile (built-in)      │
│  Workspace: custom_template_xyz (user-defined)              │
└─────────────────────────────────────────────────────────────┘
                        │
                        │ Instantiated per basket
                        ↓
┌─────────────────────────────────────────────────────────────┐
│            TEMPLATE INSTANCES (Blocks)                       │
│  (Basket-scoped)                                             │
│                                                              │
│  Basket A: brand_identity filled → Block A1                 │
│  Basket B: brand_identity filled → Block B1 (different)     │
└─────────────────────────────────────────────────────────────┘
```

**Rationale**:
1. Each basket represents a distinct context (brand, project, client)
2. Same template can have different values per basket
3. Workspace-level sharing of template definitions (not instances)
4. Matches existing block scoping pattern

---

## Work Recipe Integration

### Refactoring Work Recipes `context_requirements`

The existing `context_requirements` field in Work Recipes will be refactored to **reference** Context Templates rather than define context needs inline.

#### Current State (Before)

```json
// work_recipes.context_requirements (current)
{
  "substrate_blocks": {
    "semantic_types": ["insight", "finding", "recommendation"],
    "min_blocks": 5,
    "recency": "last_90_days"
  },
  "reference_assets": {
    "required": false,
    "types": ["presentations", "reports"]
  }
}
```

**Problem**: Recipes define what blocks they need, but there's no guarantee those blocks exist.

#### Target State (After)

```json
// work_recipes.context_requirements (refactored)
{
  "required_templates": ["brand_identity"],
  "recommended_templates": ["competitor_registry", "target_audience"],
  "substrate_query": {
    "semantic_types": ["insight", "finding"],
    "recency": "last_90_days"
  },
  "reference_assets": {
    "types": ["presentations"],
    "required": false
  }
}
```

**Improvement**:
- `required_templates`: Recipe won't execute without these foundational blocks
- `recommended_templates`: UI suggests filling these for better results
- `substrate_query`: Additional blocks to retrieve (beyond templates)

### Recipe Execution Flow (Updated)

```
1. User selects recipe
      ↓
2. UI checks: Are required_templates filled?
      ↓
   ┌─ NO → Prompt: "This recipe requires Brand Identity. [Fill Now]"
   │         ↓
   │       User fills template → Block created
   │         ↓
   └─ YES → Continue
      ↓
3. UI shows recommended_templates status
      ↓
   "Competitor Registry: Not filled (optional but recommended)"
   [Fill] [Skip]
      ↓
4. User configures recipe parameters (slide_count, focus_area, etc.)
      ↓
5. Work request created with recipe_id + recipe_parameters
      ↓
6. Agent execution:
   - Loads foundational blocks (from filled templates)
   - Queries additional substrate (substrate_query)
   - Executes with structured context
```

### Database Migration Required

```sql
-- Add required_templates to work_recipes
ALTER TABLE work_recipes
ADD COLUMN IF NOT EXISTS required_templates TEXT[] DEFAULT '{}',
ADD COLUMN IF NOT EXISTS recommended_templates TEXT[] DEFAULT '{}';

-- Update existing recipes with template references
UPDATE work_recipes
SET
  required_templates = ARRAY['brand_identity'],
  recommended_templates = ARRAY['competitor_registry', 'target_audience']
WHERE slug IN ('executive-summary-deck', 'research-deep-dive');
```

### Agent Context Assembly (Enhanced)

When assembling context for agent execution:

```python
async def assemble_agent_context(basket_id: str, recipe: Recipe) -> AgentContext:
    """Assemble context with template-aware retrieval."""

    context = AgentContext()

    # 1. Load foundational blocks (from templates)
    for template_slug in recipe.required_templates + recipe.recommended_templates:
        block = await get_template_block(basket_id, template_slug)
        if block:
            # Add as structured summary, not raw content
            context.add_foundational(
                template=template_slug,
                summary=summarize_block(block),  # Compact representation
                block_id=block.id  # For provenance
            )

    # 2. Query additional substrate
    additional_blocks = await query_substrate(
        basket_id=basket_id,
        semantic_types=recipe.context_requirements.get("substrate_query", {}).get("semantic_types"),
        limit=20
    )
    context.add_substrate(additional_blocks)

    # 3. Load reference assets if specified
    if recipe.context_requirements.get("reference_assets"):
        assets = await get_reference_assets(basket_id, recipe.context_requirements["reference_assets"])
        context.add_assets(assets)

    return context
```

### Token Optimization Impact

**Before** (current implementation):
```
System prompt: ~2K tokens
Substrate blocks (semantic search): ~15K tokens (unstructured, potentially irrelevant)
Knowledge modules: ~5K tokens
Total context: ~22K tokens
```

**After** (with Context Templates):
```
System prompt: ~2K tokens
Foundational blocks (structured summaries): ~2K tokens (guaranteed relevant)
Additional substrate: ~5K tokens (filtered by template gaps)
Knowledge modules: ~5K tokens
Total context: ~14K tokens (36% reduction)
```

---

## Implementation Plan

### Phase 1: Database & Backend (Today)

1. **Create `context_template_catalog` table**
2. **Seed foundational templates** (brand_identity, competitor_registry, etc.)
3. **Add template columns to work_recipes** (required_templates, recommended_templates)
4. **Update existing recipes** with template references
5. **Create template fill endpoint**: `POST /api/baskets/{id}/templates/{slug}/fill`
6. **Test**: Verify blocks created with template metadata

### Phase 2: Agent Integration (Next)

1. **Refactor context assembly** to use template-aware retrieval
2. **Update substrate client** to query by template_id
3. **Enhance recipe execution** to check template status
4. **Test**: Verify agents receive structured foundational context

### Phase 3: Frontend (Following)

1. **Context Page Enhancement**: Display templates with fill status
2. **Recipe Selection UI**: Show template requirements, prompt to fill
3. **Basket Setup Flow**: Guide user through foundational templates
4. **Test**: Full user flow from basket creation to recipe execution

---

## Future Considerations

### 1. Template Versioning
Templates may evolve. Consider:
- Version field in template definition
- Migration path for blocks with old template versions
- Deprecation workflow for templates

### 2. Template Inheritance
Workspace templates could extend global templates:
- Global: `competitor_profile` (base fields)
- Workspace: `tech_competitor_profile` (adds: tech_stack, api_offerings)

### 3. Cross-Basket Template Linking
For multi-basket scenarios (e.g., agency with multiple clients):
- Template definitions at workspace level
- Instances per basket
- Aggregate views across baskets

### 4. AI-Assisted Template Filling
Future enhancement:
- Agent suggests template values from existing context
- Auto-fill from raw dumps during P0-P1 pipeline
- Validation and confidence scoring

---

## Summary

**Context Templates** represent a strategic enhancement to the substrate layer that:

1. **Ensures foundational context** exists in baskets
2. **Guides deterministic agent behavior** through structured blocks
3. **Reduces token usage** via structured summaries
4. **Improves recursion accuracy** through template-aware retrieval

**Key Design Principle**: Templates are **scaffolding**, not substrate. They produce standard blocks with template metadata, maintaining the simplicity of the three-substrate-type architecture (blocks, assets, work_outputs).

**Implementation Approach**: Start with built-in JSON templates, add DB catalog for user-defined templates, integrate with frontend basket setup, and enhance agent context assembly.

---

## Related Documentation

- [TERMINOLOGY_GLOSSARY.md](../canon/TERMINOLOGY_GLOSSARY.md) - Terminology reference
- [AGENT_SUBSTRATE_ARCHITECTURE.md](../canon/AGENT_SUBSTRATE_ARCHITECTURE.md) - Substrate architecture
- [PHASE_SDK_REMOVAL_PIVOT.md](../deployment/PHASE_SDK_REMOVAL_PIVOT.md) - SDK removal context
- [Work Recipes](../../work-platform/docs/WORK_RECIPES.md) - Analogous pattern on work-platform

---

**Document Status**: Design Complete
**Next Steps**: Review with stakeholders, prioritize Phase 1 implementation
**Owner**: Architecture Team
