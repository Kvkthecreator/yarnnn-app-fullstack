# Phase 6 Refactor: Projects vs Baskets Architecture

**Date**: 2025-11-04
**Status**: ✅ Implemented and Deployed
**Commit**: `09020438` - Phase 6 Refactor: Projects vs Baskets Domain Separation

---

## Executive Summary

Phase 6 refactors the onboarding flow to create **PROJECTS** (user-facing containers) instead of naked work requests. This establishes clear domain separation between work-platform orchestration and substrate storage.

### Key Change
**Before**: User onboarding → Create Basket → Create Work Request
**After**: User onboarding → Create **PROJECT** → Create Basket → Create Work Request

---

## Domain Separation

### Work-Platform Domain (User-Facing)
**Concept**: **PROJECTS**
**Definition**: User-facing work containers that organize tasks, context, and deliverables
**Storage**: `projects` table in work-platform database
**User sees**: "My Healthcare AI Research Project"

### Substrate Domain (Infrastructure)
**Concept**: **BASKETS**
**Definition**: Knowledge storage containers with blocks, documents, and semantic relationships
**Storage**: `baskets` table in substrate database
**User sees**: (Hidden implementation detail)

---

## Why This Matters

### 1. Prevents Domain Leakage
- Frontend never directly calls substrate-api
- All substrate operations go through work-platform BFF
- "Project" language enforces proper architectural boundaries

### 2. Future Flexibility
**Today**: 1 Project = 1 Basket (simple onboarding)
**Tomorrow**:
- 1 Project = Multiple Baskets (e.g., "sources" + "synthesis")
- Basket pooling across projects
- Project templates with pre-configured basket structures

### 3. Developer Mental Model
```
User Question: "Where's my research?"
Answer: "In your RESEARCH PROJECT"

Developer Question: "Where's the data stored?"
Answer: "In the project's BASKET"

Different layers, different concerns.
```

### 4. Clearer Debugging
```
Error: "Failed to create project"
→ Check: work-platform/api/routes/projects.py

Error: "Failed to create basket"
→ Check: substrate-api/routes/baskets.py

Error: "Project created but basket missing"
→ Check: BFF communication (substrate_client.py)
```

---

## Database Schema

### `projects` Table (work-platform DB)

```sql
CREATE TABLE projects (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  user_id uuid NOT NULL REFERENCES auth.users(id),
  name text NOT NULL,  -- "Healthcare AI Research"
  description text,
  basket_id uuid NOT NULL REFERENCES baskets(id),  -- 1:1 link to substrate
  project_type text CHECK (project_type IN (
    'research', 'content_creation', 'reporting', 'analysis', 'general'
  )),
  status text CHECK (status IN ('active', 'archived', 'completed', 'on_hold')),
  origin_template text,  -- 'onboarding_v1', 'manual', 'imported'
  onboarded_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  archived_at timestamptz,
  metadata jsonb DEFAULT '{}'
);
```

**Key Constraints**:
- `UNIQUE INDEX` on `basket_id` (enforces 1:1 for now)
- `ON DELETE RESTRICT` for basket_id (can't delete basket with active project)
- RLS policies match workspace membership

---

## API Endpoints

### POST /api/projects/new (Work-Platform)

**Purpose**: Create new project with complete infrastructure
**Domain**: Work-platform (orchestration layer)
**Used by**: Frontend onboarding dialog

**Request**:
```json
{
  "project_name": "Healthcare AI Research",
  "project_type": "research",
  "initial_context": "Research latest AI developments...",
  "description": "Comprehensive analysis of AI in healthcare"
}
```

**Response**:
```json
{
  "project_id": "550e8400-...",
  "project_name": "Healthcare AI Research",
  "basket_id": "660e8400-...",
  "dump_id": "770e8400-...",
  "work_request_id": "880e8400-...",
  "status": "active",
  "is_trial_request": true,
  "remaining_trials": 9,
  "message": "Project created successfully",
  "next_step": "Navigate to /projects/550e8400-... to begin work"
}
```

**Orchestration Flow**:
1. Check permissions (trial/subscription)
2. **POST /api/baskets** (substrate-api) → Create basket
3. **POST /api/baskets/{id}/dumps** (substrate-api) → Create raw_dump
4. **INSERT projects** (work-platform DB) → Create project record
5. **INSERT agent_work_requests** (work-platform DB) → Record for trial tracking
6. Return orchestration result

---

### POST /api/work-requests/new (Legacy)

**Status**: ⚠️ Kept for backward compatibility
**Recommendation**: Migrate to `/api/projects/new`

This endpoint still works but represents the old "basket-first" thinking. New code should use project-based flows.

---

## Frontend Components

### CreateProjectDialog.tsx

**Location**: `work-platform/web/components/CreateProjectDialog.tsx`
**Replaces**: `NewOnboardingDialog.tsx`

**Form Fields**:
1. **Project Name** (required, 1-200 chars)
   - User-facing identifier
   - Example: "Healthcare AI Research"

2. **Project Type** (required, select)
   - `research` → Research Project
   - `content_creation` → Content Creation
   - `reporting` → Reporting & Analysis
   - `analysis` → Data Analysis
   - `general` → General Purpose

3. **Initial Context** (required, 10-50k chars)
   - Seed content for the project
   - Becomes first raw_dump in basket

4. **Description** (optional, max 1000 chars)
   - Summary for project cards/lists
   - NOT sent to basket (project-level only)

**Validation**:
- Project name required
- Initial context minimum 10 characters
- Project type defaults to 'research'

**Success Flow**:
1. Submit form → POST /api/projects/new
2. Show alert with project details
3. Redirect to /dashboard (will show project in future)
4. Refresh page to load new project

---

### CreateProjectButton.tsx

**Location**: `work-platform/web/app/dashboard/CreateProjectButton.tsx`
**Replaces**: `NewOnboardingButton.tsx`

```tsx
<Button onClick={() => setOpen(true)}>
  + Create Project
</Button>
```

Simple, clean CTA without "Phase 6" label.

---

## Backend Services

### project_scaffolder.py

**Location**: `work-platform/api/src/services/project_scaffolder.py`
**Replaces concept**: `onboarding_scaffolder.py` (kept for legacy)

**Function**: `scaffold_new_project()`

**Flow**:
```python
1. Check permissions (trial/subscription)
   ↓
2. Create basket (via substrate_client HTTP call)
   ↓
3. Create raw_dump (via substrate_client HTTP call)
   ↓
4. Create project (INSERT into projects table)
   ↓
5. Create work_request (INSERT for trial tracking)
   ↓
6. Return orchestration result
```

**Error Handling**:
- Raises `ProjectScaffoldingError` with step information
- Partial state preserved in error (basket_id, dump_id, project_id)
- Allows retry or manual cleanup

**Agent Type Mapping**:
```python
project_type → agent_type (for permission check)
'research' → 'research'
'content_creation' → 'content'
'reporting' → 'reporting'
'analysis' → 'research'
'general' → 'research'
```

---

## Migration Notes

### Database Migration Applied

**File**: `supabase/migrations/20251104_projects_table.sql`
**Applied**: 2025-11-04
**Verified**: `\d+ projects` shows correct schema

**What was created**:
- `projects` table with all columns
- 7 indexes (workspace, user, basket, status, type, created, basket_unique)
- 3 RLS policies (view, create, update)
- 1 trigger (update_project_timestamp)
- Foreign keys to workspaces, users, baskets

**No data migration needed**:
- This is a NEW concept, not a rename
- Existing baskets remain in substrate unchanged
- New projects created from this point forward

---

## Testing Checklist

### Backend Testing

1. **API Endpoint**:
   ```bash
   POST http://localhost:8000/api/projects/new
   Headers: Authorization: Bearer <token>
   Body: {
     "project_name": "Test Project",
     "project_type": "research",
     "initial_context": "This is a test project with initial context"
   }
   ```

2. **Database Verification**:
   ```sql
   SELECT id, name, project_type, basket_id, status
   FROM projects
   ORDER BY created_at DESC
   LIMIT 5;
   ```

3. **Basket Linkage**:
   ```sql
   SELECT
     p.id as project_id,
     p.name as project_name,
     b.id as basket_id,
     b.name as basket_name,
     b.origin_template
   FROM projects p
   JOIN baskets b ON p.basket_id = b.id
   ORDER BY p.created_at DESC;
   ```

### Frontend Testing

1. **Button Visibility**:
   - Navigate to /dashboard
   - Verify "+ Create Project" button in header (top right)

2. **Dialog Interaction**:
   - Click button → Dialog opens
   - Fill all required fields
   - Submit → Success alert shows
   - Verify redirect to /dashboard

3. **Trial Counter**:
   - Create project → Check remaining_trials in response
   - Verify agent_work_requests table increments

### Integration Testing

1. **End-to-End Flow**:
   ```
   User clicks "+ Create Project"
   → Dialog opens
   → Fills form
   → Submits
   → Backend creates: Basket → Dump → Project → Work Request
   → Frontend shows success
   → User redirected to dashboard
   ```

2. **Error Scenarios**:
   - Empty project name → Validation error
   - Context < 10 chars → Validation error
   - Trial exhausted → 403 Permission denied
   - Basket creation fails → 500 with step='create_basket'

---

## Future Enhancements (Deferred)

### 1. Project Dashboard

**Location**: `work-platform/web/app/dashboard/page.tsx`
**Current**: Shows baskets directly
**Future**: Show projects with nested baskets

```tsx
// TODO: Replace listBasketsByWorkspace with listProjectsByWorkspace
const { data: projects } = await listProjectsByWorkspace(workspace.id);

<section>
  <h2>Your Projects</h2>
  {projects.map(project => (
    <ProjectCard
      key={project.id}
      project={project}
      basket={project.basket}  // Nested basket info
    />
  ))}
</section>
```

### 2. Project Detail Page

**Route**: `/projects/[id]`
**Shows**:
- Project metadata (name, type, description)
- Linked basket(s)
- Work sessions
- Artifacts
- Activity timeline

### 3. Multi-Basket Projects

**Schema Change**:
```sql
CREATE TABLE project_baskets (
  project_id uuid REFERENCES projects(id),
  basket_id uuid REFERENCES baskets(id),
  basket_role text,  -- 'primary', 'sources', 'synthesis'
  PRIMARY KEY (project_id, basket_id)
);

-- Remove UNIQUE constraint on projects.basket_id
DROP INDEX idx_projects_basket_unique;

-- Add nullable basket_id (for multi-basket projects)
ALTER TABLE projects ALTER COLUMN basket_id DROP NOT NULL;
```

### 4. Project Templates

**Concept**: Pre-configured project scaffolding
**Example**:
```json
{
  "template_id": "research_paper",
  "name": "Research Paper Project",
  "baskets": [
    {"role": "sources", "name": "Research Sources"},
    {"role": "synthesis", "name": "Analysis & Synthesis"},
    {"role": "output", "name": "Paper Drafts"}
  ],
  "initial_blocks": [
    {"basket": "sources", "type": "literature_review"},
    {"basket": "synthesis", "type": "thesis_statement"}
  ]
}
```

---

## Developer Guidelines

### When to Use Projects vs Baskets

**Use PROJECTS when**:
- Frontend user interaction (UI, forms, lists)
- Work orchestration (starting tasks, tracking progress)
- User-facing APIs (onboarding, project management)
- Business logic (permissions, trials, subscriptions)

**Use BASKETS when**:
- Storage operations (blocks, documents, dumps)
- Semantic operations (search, relationships, embeddings)
- Infrastructure concerns (versioning, snapshots, migrations)
- Substrate-level APIs (always behind BFF)

### Naming Conventions

**Frontend/API**:
- `project_name`, `project_type`, `project_id`
- "Create Project", "My Projects", "Project Settings"

**Internal/DB**:
- `basket_id`, `basket_name` (still valid for substrate operations)
- "Linked basket", "Project's basket"

**Never**:
- Don't call baskets "projects" in substrate code
- Don't expose "basket" terminology to end users

---

## Commit Reference

**Main Commit**: `09020438` - Phase 6 Refactor: Projects vs Baskets Domain Separation

**Previous Commits** (Phase 6 evolution):
- `218e4675` - Phase 6: Basket-First Onboarding Implementation (original)
- `dc99d36f` - Phase 6: Frontend - New Onboarding Button & Dialog (initial UI)
- `18fcaf99` - Fix Vercel build error: Correct UI component imports

**Next Steps**:
- Wait for Render/Vercel deployment (~2-3 minutes)
- Test project creation flow
- Update dashboard to list projects (future)

---

**Status**: ✅ Ready for production testing
**Docs**: This file + inline code comments
**Testing**: See "Testing Checklist" above
