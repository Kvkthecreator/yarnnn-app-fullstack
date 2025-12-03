# ADR: Context Entries Architecture

**ADR Number**: ADR-2025-12-03
**Title**: Structured Context Entries for Multi-Modal Context Management
**Status**: Approved
**Date**: 2025-12-03
**Author**: Architecture Team
**Supersedes**: CONTEXT_ROLES_ARCHITECTURE.md (partially), CONTEXT_ROLES_IMPLEMENTATION_PLAN.md

---

## Executive Summary

This ADR documents the decision to introduce **Context Entries** - a new structured, multi-modal context management system that replaces the flat text block paradigm for work recipe context. Context Entries provide schema-driven, field-level context with embedded asset references, enabling token-efficient context injection and deterministic agent behavior.

---

## Decision Statement

**We will implement Context Entries as the primary context management system for Yarnnn's work platform.**

Key aspects:
1. **Context Entry Schemas** define the structure for each anchor role (brand, customer, competitor, etc.)
2. **Context Entries** store structured JSONB data per basket with embedded asset references
3. **Field-level recipe requirements** enable selective context loading
4. **Existing blocks/assets remain** for storage but are abstracted behind Context Entries for work recipes
5. **API lives in substrate-api** (BFF pattern preserved)

---

## Context: How We Got Here

### The Problem Statement

During routine audit of the substrate and context blocks system (December 2025), several issues emerged:

1. **Block Content is Unstructured**
   - Blocks contain freeform text with no schema
   - Same "brand" block might have voice info in paragraph 3 or paragraph 7
   - Agents must parse unstructured text to find relevant pieces
   - LLM attention diluted across irrelevant content

2. **Assets Disconnected from Context**
   - `reference_assets` table has NO `anchor_role` column
   - Brand logo is an "asset", brand voice is a "block" - no programmatic link
   - Recipes must query both tables and hope naming conventions align

3. **Token Inefficiency**
   - Current approach loads ALL blocks matching an anchor role
   - No field-level selection: loading "brand" gets everything, not just "voice"
   - Typical context injection: 3,000-15,000 tokens
   - Much of this is irrelevant to specific recipe needs

4. **UX Friction**
   - Create Block modal has 4 fields: Title, Type, Anchor Role, Content
   - Title often duplicates anchor role information
   - Users struggle to understand what to put in each field

5. **Non-Deterministic Agent Behavior**
   - Same recipe on same context can produce varying outputs
   - Variation often due to how agent parses unstructured content
   - No stable field access pattern

### The Discussion Journey

**Initial Question**: "Should we simplify block creation by making anchor_role primary?"

**Deeper Question Emerged**: "If blocks are becoming anchor-role-centric, why keep them as flat text? What if we expanded the fundamental data handling scope?"

**Key Insight**: A "brand" context entry could include multiple typed fields: text (name, voice), images (logo), documents (guidelines PDF), arrays (color codes). This treats context as a rich, multi-modal entity rather than text chunks with separate assets.

**User Value Perspective**: Solo founders need structured, wizard-like context collection that produces high-quality agent outputs with minimal input effort.

---

## Decision Analysis

### Options Considered

#### Option A: Enhance Blocks with Asset Links

Add `linked_asset_ids[]` to blocks. Keep blocks as primary context unit.

**Pros**:
- Minimal schema change
- Preserves existing block workflows

**Cons**:
- Still freeform text within blocks
- Still multiple queries (blocks + assets)
- Doesn't solve token efficiency (whole block or nothing)
- Doesn't solve determinism (agents still parse text)

**Verdict**: Rejected - addresses symptom, not root cause.

#### Option B: Context Slots with Block/Asset Composition

Create composition layer that groups blocks + assets by semantic category.

**Pros**:
- Unifies assets and blocks under anchor roles
- Minimal existing schema disruption

**Cons**:
- Still freeform content within blocks
- Still queries multiple tables then composes
- Adds complexity layer without solving core issues

**Verdict**: Rejected - indirection without structural improvement.

#### Option C: Structured Context Entries (Selected)

New tables with schema-driven, typed fields, embedded asset references.

**Pros**:
- Deterministic field access (`data.voice`, not "find voice in text")
- Token-efficient: load only required fields
- Multi-modal in single query
- Clean UX: form-based context collection
- Recipe requirements can specify exact fields needed

**Cons**:
- New tables, new API routes
- Migration effort for existing workflows
- Must define schemas upfront (less flexible than freeform)

**Verdict**: Selected - addresses root causes, superior long-term architecture.

### Why Not Just Improve Blocks?

The block paradigm was designed for a different use case:
- **Blocks origin**: Knowledge extraction from documents, semantic chunking, embeddings
- **Work recipe need**: Structured business context for agent prompting

These are fundamentally different:
- Blocks optimize for: retrieval, similarity search, provenance tracking
- Context entries optimize for: structured prompting, field-level access, schema validation

Trying to force blocks to serve both purposes creates a conflicted abstraction.

---

## Technical Stress Test

### Token Efficiency: Quantified

**Current Architecture (blocks + assets separately)**:

```
Recipe: brand-voice-extraction needs brand info + customer context

1. Query blocks WHERE anchor_role IN ('brand', 'customer')
   → Returns full text of all matching blocks
   → Typical: 2-4 blocks × 500-2000 tokens = 1,000-8,000 tokens

2. Query reference_assets for basket
   → Returns all assets (no semantic filtering)
   → Typical: 5-20 assets metadata

3. Agent prompt:
   "Here is the brand context: [full block 1] [full block 2]..."
   "Available assets: [list all]"

Total context injection: 3,000-15,000 tokens (unoptimized)
```

**Context Entries Architecture**:

```
Recipe context_requirements:
  entries:
    - type: "brand"
      fields: ["name", "voice", "tagline"]  # NOT logo, NOT guidelines
    - type: "customer"
      fields: ["description", "pain_points"]

1. Single query with field projection:
   SELECT
     anchor_role,
     data->'name' as name,
     data->'voice' as voice,
     data->'tagline' as tagline
   FROM context_entries
   WHERE basket_id = ? AND anchor_role IN ('brand', 'customer')

   → Returns ONLY requested fields
   → Typical: 200-800 tokens

2. Asset resolution ONLY if field is asset type AND requested:
   → Logo not requested? Not loaded.
   → Guidelines PDF not needed? Not fetched.

Total context injection: 500-1,500 tokens (3-10x reduction)
```

### Prompt Engineering: Structured vs Unstructured

**Current**:
```xml
<context>
  <block role="brand">
    Title: Company Brand Guidelines
    Content: [2000 words of unstructured text mixing voice, colors, history, mission...]
  </block>
  <assets>
    - logo.png (attached)
    - brand_deck.pdf (attached)
    - random_screenshot.png (attached)
  </assets>
</context>

Agent must parse unstructured text to find relevant pieces.
LLM attention diluted across irrelevant content.
```

**Context Entries**:
```xml
<context>
  <brand>
    <name>Acme Corp</name>
    <voice>Professional yet approachable. Use active voice. Avoid jargon.</voice>
    <tagline>Building tomorrow, today.</tagline>
  </brand>
  <customer>
    <description>SMB founders, 1-10 employees, bootstrapped</description>
    <pain_points>["Time-strapped", "Wearing multiple hats", "Limited budget"]</pain_points>
  </customer>
</context>

Agent receives structured, labeled data.
Zero parsing required.
Each field semantically meaningful.
```

### Determinism Comparison

| Dimension | Blocks (Current) | Context Entries |
|-----------|------------------|-----------------|
| Field access | Search within text | Direct key access |
| Content location | Varies by block author | Fixed by schema |
| Agent parsing | Required | Not required |
| Output variance | Higher (parsing-dependent) | Lower (stable input format) |

---

## Architectural Impact

### Substrate-API: Dual Purpose Philosophy

**Original Vision**: Substrate-API as both BFF for Yarnnn AND standalone enterprise context service.

**Current Reality**:
- 95% of substrate-api traffic serves Yarnnn frontend
- Enterprise context service use case remains speculative

**Decision**: Context Entries API routes live in **substrate-api** (not Next.js API routes).

**Rationale**:
1. Asset resolution needs substrate-api's storage layer
2. Future extraction pipelines (PDF → structured fields) use Python ecosystem
3. Consistency: one API layer for all context operations
4. Option preserved: if enterprise demand materializes, clean extraction path

### Relationship to Existing Tables

| Table | Current Use | Future State |
|-------|-------------|--------------|
| `blocks` | Context + knowledge extraction | Knowledge extraction only; context via entries |
| `reference_assets` | Standalone files | Storage layer; referenced via `asset://uuid` in entries |
| `basket_anchors` | Already deprecated | Drop after migration |
| `context_entry_schemas` | NEW | Defines field structure per anchor role |
| `context_entries` | NEW | Stores structured context data |

### Migration Strategy

**Phase 1**: Add new tables, build API, build UI
**Phase 2**: Work orchestration consumes context entries (not blocks for context)
**Phase 3**: Block-based context UI deprecated
**Phase 4**: Optional data migration for existing blocks → entries

Existing blocks remain for:
- Knowledge extraction use cases
- RAG/semantic search (embeddings)
- Audit trail of what was extracted

---

## Schema Design

### Context Entry Schemas

```sql
CREATE TABLE context_entry_schemas (
    anchor_role TEXT PRIMARY KEY,        -- 'brand', 'customer', 'competitor'
    display_name TEXT NOT NULL,          -- 'Brand Identity'
    description TEXT,
    icon TEXT,                           -- Lucide icon name
    category TEXT CHECK (category IN ('foundation', 'market', 'insight')),
    is_singleton BOOLEAN DEFAULT true,   -- true = one per basket, false = array
    field_schema JSONB NOT NULL,         -- Defines available fields
    created_at TIMESTAMPTZ DEFAULT now()
);

COMMENT ON TABLE context_entry_schemas IS
'Defines the structure and available fields for each anchor role.
Foundation roles (problem, customer, vision) are universal.
Market roles (competitor, trend) can have multiple entries.
Insight roles (trend_digest) are agent-produced.';
```

### Field Schema Structure

```yaml
anchor_role: brand
display_name: "Brand Identity"
category: "foundation"
is_singleton: true
field_schema:
  fields:
    - key: "name"
      type: "text"
      label: "Brand Name"
      required: true
      placeholder: "Your company or product name"

    - key: "tagline"
      type: "text"
      label: "Tagline"
      placeholder: "Your memorable catchphrase"

    - key: "voice"
      type: "longtext"
      label: "Brand Voice"
      placeholder: "Describe how your brand communicates..."
      help: "Include tone, vocabulary preferences, things to avoid"

    - key: "logo"
      type: "asset"
      label: "Logo"
      accept: "image/*"

    - key: "colors"
      type: "array"
      label: "Brand Colors"
      item_type: "text"
      placeholder: "#FF5733"

    - key: "guidelines_doc"
      type: "asset"
      label: "Brand Guidelines"
      accept: "application/pdf,.docx"
```

### Context Entries

```sql
CREATE TABLE context_entries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    basket_id UUID NOT NULL REFERENCES baskets(id) ON DELETE CASCADE,
    anchor_role TEXT NOT NULL REFERENCES context_entry_schemas(anchor_role),
    entry_key TEXT,                      -- For non-singleton (e.g., competitor name)
    display_name TEXT,                   -- Optional override of anchor_role display
    data JSONB NOT NULL DEFAULT '{}',    -- Structured data per field_schema
    completeness_score FLOAT,            -- 0.0-1.0 based on required fields filled
    state TEXT DEFAULT 'active' CHECK (state IN ('active', 'archived')),
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    created_by UUID REFERENCES auth.users(id),
    UNIQUE(basket_id, anchor_role, entry_key)
);

CREATE INDEX idx_context_entries_basket_role
ON context_entries(basket_id, anchor_role);

CREATE INDEX idx_context_entries_updated
ON context_entries(basket_id, updated_at DESC);
```

### Asset Reference Pattern

Assets are referenced within `data` using URI syntax:

```json
{
  "name": "Acme Corp",
  "voice": "Professional yet approachable...",
  "logo": "asset://550e8400-e29b-41d4-a716-446655440000",
  "guidelines_doc": "asset://6ba7b810-9dad-11d1-80b4-00c04fd430c8"
}
```

Resolution at query time:
```sql
-- Expand asset references
SELECT
  ce.anchor_role,
  ce.data,
  COALESCE(
    jsonb_object_agg(
      key,
      CASE
        WHEN value::text LIKE '"asset://%"'
        THEN jsonb_build_object(
          'asset_id', replace(value::text, '"asset://', ''),
          'url', ra.public_url,
          'mime_type', ra.mime_type
        )
        ELSE value
      END
    ),
    '{}'::jsonb
  ) as resolved_data
FROM context_entries ce
LEFT JOIN LATERAL (
  SELECT key, value
  FROM jsonb_each(ce.data)
) fields ON true
LEFT JOIN reference_assets ra ON ra.id::text = replace(fields.value::text, '"asset://', '')::uuid
WHERE ce.basket_id = $1
GROUP BY ce.id, ce.anchor_role, ce.data;
```

---

## Recipe Integration

### Updated Context Requirements

```yaml
recipe: weekly-content-calendar
context_requirements:
  entries:
    - role: "brand"
      fields: ["name", "voice", "tagline"]
      required: true
    - role: "customer"
      fields: ["description", "pain_points", "jobs_to_be_done"]
      required: true
    - role: "trend_digest"
      fields: ["summary", "key_themes"]
      required: false  # Enhances output if present

context_outputs:
  role: "content_calendar"
  fields_produced: ["topics", "schedule", "hooks"]
  refresh_policy:
    ttl_hours: 336  # 2 weeks
    auto_promote: false
```

### Context Assembly for Agents

```python
async def assemble_recipe_context(
    basket_id: str,
    recipe: WorkRecipe,
    supabase: Client
) -> dict:
    """
    Assemble context for agent execution from context entries.
    Only loads fields specified in recipe requirements.
    """
    context = {}

    for req in recipe.context_requirements.get("entries", []):
        role = req["role"]
        fields = req.get("fields", [])  # Empty = all fields
        required = req.get("required", False)

        # Query entry with field projection
        entry = await supabase.from_("context_entries") \
            .select("data") \
            .eq("basket_id", basket_id) \
            .eq("anchor_role", role) \
            .eq("state", "active") \
            .maybeSingle() \
            .execute()

        if not entry.data:
            if required:
                raise MissingContextError(f"Required context role '{role}' not found")
            continue

        # Project only requested fields
        if fields:
            projected = {k: v for k, v in entry.data["data"].items() if k in fields}
        else:
            projected = entry.data["data"]

        # Resolve asset references
        resolved = await resolve_asset_references(projected, supabase)

        context[role] = resolved

    return context
```

---

## Frontend Impact

### New Context Page UX

Replace tab-based (Blocks/Entries/Documents/Images) with role-based cards:

```
┌─────────────────────────────────────────────────────────────────┐
│  Context                                           [+ Add Role] │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐   │
│  │ 🎯 Problem      │ │ 👥 Customer     │ │ 🔮 Vision       │   │
│  │ ────────────    │ │ ────────────    │ │ ────────────    │   │
│  │ [Summary...]    │ │ [Summary...]    │ │ [Summary...]    │   │
│  │                 │ │                 │ │                 │   │
│  │ ██████████ 100% │ │ ████████░░  80% │ │ ████░░░░░░  40% │   │
│  └─────────────────┘ └─────────────────┘ └─────────────────┘   │
│                                                                 │
│  ┌─────────────────┐ ┌─────────────────┐                       │
│  │ 🏷️ Brand        │ │ 📊 Competitors  │                       │
│  │ ────────────    │ │ ────────────    │                       │
│  │ Acme Corp       │ │ 3 competitors   │                       │
│  │ Logo: ✓         │ │                 │                       │
│  │ Voice: ✓        │ │ [+ Add]         │                       │
│  │ ██████████ 100% │ │ ██████████ 100% │                       │
│  └─────────────────┘ └─────────────────┘                       │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Context Entry Editor

Form-based editing per schema:

```
┌─────────────────────────────────────────────────────────────────┐
│  ← Back to Context                                              │
│                                                                 │
│  🏷️ Brand Identity                                              │
│  ═══════════════════════════════════════════════════════════   │
│                                                                 │
│  Brand Name *                                                   │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ Acme Corp                                               │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  Tagline                                                        │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ Building tomorrow, today.                               │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  Brand Voice                                                    │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ Professional yet approachable. We use active voice.     │   │
│  │ Avoid jargon and buzzwords. Be direct but friendly.     │   │
│  │ ...                                                     │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  Logo                                                           │
│  ┌──────────────────┐                                          │
│  │   [Acme Logo]    │  [Replace] [Remove]                      │
│  │                  │                                          │
│  └──────────────────┘                                          │
│                                                                 │
│  Brand Colors                                                   │
│  [#FF5733] [#3498DB] [#2ECC71]  [+ Add Color]                  │
│                                                                 │
│  Brand Guidelines (PDF)                                         │
│  📄 brand_guidelines_v2.pdf  [Download] [Replace]              │
│                                                                 │
│  ─────────────────────────────────────────────────────────────  │
│  Completeness: ████████████████████ 100%                        │
│                                                                 │
│                                          [Cancel]  [Save]       │
└─────────────────────────────────────────────────────────────────┘
```

---

## Implementation Plan

### Phase 1: Schema & API (substrate-api)

1. Create migration for `context_entry_schemas` and `context_entries`
2. Seed initial schemas (brand, customer, problem, vision, competitor)
3. Add CRUD routes in substrate-api:
   - `GET /baskets/{id}/context-entries`
   - `GET /baskets/{id}/context-entries/{role}`
   - `PUT /baskets/{id}/context-entries/{role}`
   - `DELETE /baskets/{id}/context-entries/{role}/{entry_key}`
4. Add extraction endpoint: `POST /baskets/{id}/context-entries/{role}/extract`

### Phase 2: Frontend Context Page

1. New Context page with role-based cards
2. Context Entry editor component (form per schema)
3. Asset upload integration within fields
4. Completeness indicators

### Phase 3: Work Orchestration Integration

1. Update recipe `context_requirements` format
2. Update context assembly in agent-hub
3. Field-level context injection in prompts
4. Update recipe configuration UI

### Phase 4: Recipe Integration (Implemented 2025-12-03)

1. **ContextProvisioner Service** (`services/context_provisioner.py`)
   - `ContextProvisionResult` class for structured provision results
   - `provision_context()` method for bulk fetching by anchor roles
   - `get_foundation_context()` for core roles (problem, customer, vision, brand)
   - `get_recipe_context()` for recipe-specific context with foundation
   - Staleness detection for insight roles
   - Asset resolution support

2. **Job Handler Integration** (`services/job_handlers.py`)
   - `handle_scheduled_work()` reads `context_required` from payload
   - Provisions context before work ticket creation
   - Stores provisioned context in `work_ticket.metadata.context_entries`
   - Stores provision metadata in `metadata.provisioned_context`
   - `handle_stale_refresh()` also supports context provisioning

3. **Database Function Updates** (`migrations/20251203_context_required_in_jobs.sql`)
   - `check_and_queue_due_schedules()` includes `context_requirements.roles` in job payload
   - `check_and_queue_stale_anchors()` includes `context_requirements.roles` in job payload
   - Jobs now carry `context_required` array from recipe definitions

4. **Context Flow**:
   ```
   Recipe → context_requirements.roles → Job payload.context_required
                                                     ↓
                                          Job handler reads payload
                                                     ↓
                                          ContextProvisioner.get_recipe_context()
                                                     ↓
                                          work_ticket.metadata.context_entries
                                                     ↓
                                          Agent prompt injection
   ```

### Phase 5: Migration & Cleanup

1. Optional: migrate existing block content to entries
2. Deprecate block-based context UI
3. Update documentation
4. Monitor and iterate

---

## Risks and Mitigations

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| Schema rigidity limits edge cases | Medium | Medium | Support custom fields in schema; allow freeform notes field |
| Migration disrupts existing workflows | Low | High | Parallel operation; gradual migration; feature flags |
| Token savings don't materialize | Low | Medium | Measure actual token usage before/after; A/B test |
| Complexity increase without proportional benefit | Medium | Medium | Start with 5 core schemas; expand based on usage |

---

## Success Metrics

| Metric | Target | Measurement |
|--------|--------|-------------|
| Context token usage per recipe | -50% reduction | Agent prompt token counts |
| Context completeness | 80% of projects with 3+ roles at 100% | DB query |
| Agent output quality | +15% approval rate | Work output promotion rate |
| Context page time-to-complete | -40% vs current | Analytics |
| Developer time for new recipes | -30% | Sprint velocity |

---

## Open Questions (Resolved)

**Q: Should API routes live in Next.js or substrate-api?**
A: **Substrate-API**. Asset resolution needs storage layer, extraction needs Python, consistency with existing patterns.

**Q: What happens to existing blocks?**
A: Blocks remain for knowledge extraction use cases. Context for work recipes moves to entries. No data loss.

**Q: How do we handle the "raw dump ingestion" use case?**
A: New extraction endpoint: upload document → LLM extracts structured fields → populates entry. Similar to block ingestion but structured output.

**Q: What terminology should we use?**
A:
- User-facing: "Context" (e.g., "Brand Context")
- Technical: `context_entries` table, `context_entry_schemas` table
- Anchor roles remain the organizing principle

---

## Ephemeral vs Permanent Asset Model

### Decision

**Anything not attached to a Context Entry is ephemeral.**

This creates a clean binary model for asset lifecycle:
- **Permanent**: Asset is linked to a `context_entry_id` - it persists indefinitely
- **Temporary/Ephemeral**: Asset has no context entry link - expires automatically

### How It Works

1. **User uploads asset outside context entry**:
   - Asset created with `permanence = 'temporary'`
   - `expires_at` set to 7 days (configurable)
   - User can attach it to a context entry to make permanent

2. **User uploads asset within context entry field**:
   - Asset created with `permanence = 'permanent'`
   - `context_entry_id` and `context_field_key` set automatically
   - Never expires

3. **Agent produces work output with file**:
   - Asset created with `permanence = 'temporary'`
   - If user promotes to context entry → becomes permanent
   - Otherwise, expires after work session TTL

### Schema Changes

```sql
-- Add to reference_assets
ALTER TABLE reference_assets
  ADD COLUMN context_entry_id UUID REFERENCES context_entries(id) ON DELETE SET NULL,
  ADD COLUMN context_field_key TEXT;

-- Update permanence constraint
ALTER TABLE reference_assets
  DROP CONSTRAINT IF EXISTS temporary_must_expire;

ALTER TABLE reference_assets
  ADD CONSTRAINT permanence_logic CHECK (
    CASE
      -- Linked to context entry = must be permanent
      WHEN context_entry_id IS NOT NULL THEN permanence = 'permanent'
      -- Not linked = must have expiration
      WHEN context_entry_id IS NULL AND permanence = 'temporary' THEN expires_at IS NOT NULL
      ELSE TRUE
    END
  );

-- Index for context entry links
CREATE INDEX idx_ref_assets_context_entry
  ON reference_assets(context_entry_id, context_field_key)
  WHERE context_entry_id IS NOT NULL;

COMMENT ON COLUMN reference_assets.context_entry_id IS
'Links asset to context entry. If set, asset is permanent. If NULL, asset is ephemeral.';

COMMENT ON COLUMN reference_assets.context_field_key IS
'Which field in the context entry this asset fills (e.g., "logo", "guidelines_doc")';
```

### Cleanup Mechanism

The existing `cleanup_expired_assets()` function handles ephemeral cleanup:
```sql
-- Already exists in 20251113_phase1_reference_assets.sql
SELECT * FROM cleanup_expired_assets();
-- Deletes assets WHERE permanence = 'temporary' AND expires_at < now()
```

Call via pg_cron daily:
```sql
SELECT cron.schedule('cleanup-expired-assets', '0 3 * * *',
  'SELECT cleanup_expired_assets()');
```

---

## De-wiring Legacy Classification System

### Background

The current system has two classification tracks:
1. **Asset Type Catalog + LLM Classification** (for `reference_assets`)
2. **Block Semantic Types + Anchor Roles** (for `blocks`)

With Context Entries, we need to de-wire the asset classification for user uploads while preserving it for work output files.

### Decision

| Upload Source | Classification | Rationale |
|---------------|---------------|-----------|
| User via Context Entry | **None** | Schema defines field type; user explicitly chooses where to attach |
| User standalone upload | **None** | Ephemeral by default; attach to entry to categorize |
| Work output file | **Keep LLM** | Agent doesn't know asset type; need auto-classification |
| Block from extraction | **Keep** | RAG/semantic search still uses semantic types |

### Implementation

1. **Disable classification trigger for user uploads**:
   - Add `skip_classification` flag to upload endpoint
   - Default to `true` for user uploads, `false` for agent uploads

2. **Update classification service**:
   ```python
   # substrate-api/api/src/app/reference_assets/services/classification_service.py

   # Add deprecation notice
   """
   DEPRECATION NOTICE (2025-12-03):
   LLM classification is now only used for work output files.
   User uploads are classified by attachment to context entries.
   See: /docs/architecture/ADR_CONTEXT_ENTRIES.md#de-wiring-legacy-classification-system
   """

   @staticmethod
   async def classify_asset(
       ...,
       source: str = "agent",  # New: "agent" | "user"
   ) -> Dict[str, Any]:
       # Skip for user uploads
       if source == "user":
           return {
               "success": True,
               "asset_type": "other",
               "confidence": 1.0,
               "description": file_name,
               "reasoning": "User upload - classification skipped (context entry determines type)",
           }
       # ... existing LLM logic for agent uploads
   ```

3. **Deprecate asset_type_catalog for context purposes**:
   - Keep table for backward compatibility
   - Add deprecation comment
   - Stop expanding with new types
   - Context entry schemas replace this functionality

### Legacy Code Preservation

The following remain active but deprecated:
- `asset_type_catalog` table - kept for existing assets
- `blocks.anchor_role` - kept for RAG use cases
- `blocks.semantic_type` - kept for knowledge extraction

The following are actively de-wired:
- LLM classification for user file uploads
- `asset_category` field on new user uploads (use context entry instead)

---

## Related Documents

- [CONTEXT_ROLES_ARCHITECTURE.md](../canon/CONTEXT_ROLES_ARCHITECTURE.md) - Prior architecture (partially superseded)
- [SUBSTRATE_DATA_TYPES.md](../canon/SUBSTRATE_DATA_TYPES.md) - Data taxonomy (to be updated)
- [YARNNN_DATA_FLOW_V4.md](YARNNN_DATA_FLOW_V4.md) - Data flow patterns

---

## Appendix: Decision Timeline

| Date | Event |
|------|-------|
| 2025-12-02 | Routine substrate/context audit initiated |
| 2025-12-03 | Block creation UX analysis revealed redundancy |
| 2025-12-03 | Asset disconnection from anchor roles identified |
| 2025-12-03 | Multi-modal context entries concept proposed |
| 2025-12-03 | First principles validation (user value focus) |
| 2025-12-03 | API architecture decision (substrate-api vs Next.js) |
| 2025-12-03 | Ephemeral/permanent asset model defined |
| 2025-12-03 | De-wiring of LLM classification for user uploads decided |
| 2025-12-03 | This ADR created and approved |
| 2025-12-03 | Phase 4 Recipe Integration implemented |

---

## Appendix: Legacy Systems Reference

### What Remains Active (Not Deprecated)

| Component | Purpose | Why Kept |
|-----------|---------|----------|
| `blocks` table | Knowledge extraction, RAG | Semantic search, embeddings, provenance |
| `blocks.semantic_type` | Block categorization | Extraction pipelines use this |
| `context_items` table | External context ingestion | May merge with entries later |
| `reference_assets` table | File storage | Core storage layer |

### What Is Deprecated (Legacy)

| Component | Deprecated For | Migration Path |
|-----------|---------------|----------------|
| `blocks.anchor_role` for context | Work recipe context | Use `context_entries` instead |
| `basket_anchors` table | Everything | Drop after validation |
| `asset_type_catalog` for user uploads | Classification | Context entries define type |
| LLM classification for user files | User uploads | Attach to context entry |

### What Is Actively De-wired

| Component | De-wiring Action |
|-----------|-----------------|
| `AssetClassificationService.classify_asset()` | Skip for `source="user"` |
| Asset upload auto-classification trigger | Add `skip_classification` flag |
| `asset_category` on new user uploads | Default to 'uncategorized' |

---

**Document Status**: Approved
**Last Updated**: 2025-12-03
**Owner**: Architecture Team
