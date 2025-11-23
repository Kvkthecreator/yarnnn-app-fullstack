# Frontend Routing Architecture Audit - Work Recipes

**Date**: 2025-11-23
**Status**: ✅ Audit Complete - Agent-Type-Specific Routes Confirmed
**Issue**: Clarify if `/work/new` is legacy or if routes should be agent-type-specific

---

## Executive Summary

**CONCLUSION**: You are **correct** - the architecture should use **agent-type-specific routes**, not a generic `/work/new` route.

**Evidence**:
1. Backend endpoints are already agent-type-specific (`/work/research`, `/work/reporting`)
2. Frontend already has agent-type routing pattern (`/projects/[id]/agents/[agentType]`)
3. Recipes are agent-specific (each recipe has `agent_type` field)
4. Current architecture is "direct invocation PER agent type"

**Recommended Approach**: Agent-type-specific recipe routes that mirror the backend structure.

---

## Audit Findings

### 1. Backend Endpoint Structure (CURRENT)

**Pattern**: Agent-type-specific workflow endpoints

```
✅ /work/research/execute   - POST (research workflows)
✅ /work/reporting/execute  - POST (reporting workflows + recipes)
✅ /work/recipes            - GET  (discovery only, cross-agent)
✅ /work/recipes/{slug}     - GET  (discovery only)
```

**Key Observations**:
- Each agent type has its own `/work/{agent_type}/execute` endpoint
- Recipe discovery is centralized, but **execution is agent-specific**
- No generic `/work/execute` endpoint exists
- Recipes are integrated into agent-specific endpoints via optional `recipe_id` parameter

**Code Evidence** ([workflow_reporting.py:31](work-platform/api/src/app/routes/workflow_reporting.py#L31)):
```python
router = APIRouter(prefix="/work/reporting", tags=["workflows"])

@router.post("/execute", response_model=ReportingWorkflowResponse)
async def execute_reporting_workflow(
    request: ReportingWorkflowRequest,  # Includes optional recipe_id
    user: dict = Depends(verify_jwt)
)
```

**Code Evidence** ([workflow_research.py:26](work-platform/api/src/app/routes/workflow_research.py#L26)):
```python
router = APIRouter(prefix="/work/research", tags=["workflows"])

@router.post("/execute", response_model=ResearchWorkflowResponse)
async def execute_research_workflow(
    request: ResearchWorkflowRequest,
    user: dict = Depends(verify_jwt)
)
```

### 2. Frontend Routing Patterns (CURRENT)

**Pattern**: Agent-type-specific routes already exist

```
✅ /projects/[id]/agents/[agentType]  - Agent dashboard (per type)
✅ /projects/[id]/overview            - Project overview with agent cards
✅ /projects/[id]/work-sessions       - Work sessions list
✅ /projects/[id]/work-sessions/[sessionId] - Individual session
```

**Code Evidence** ([page.tsx:13-16](work-platform/web/app/projects/[id]/agents/[agentType]/page.tsx#L13-L16)):
```typescript
export default async function AgentPage({ params }: PageProps) {
  const { id: projectId, agentType } = await params;

  if (!isAgentType(agentType)) {
    notFound();
  }
  // ... loads agent-specific data
}
```

**Key Observations**:
- Frontend already validates `agentType` parameter
- Agent-specific dashboards load agent-specific data
- Pattern: `/projects/[id]/agents/{agentType}` for agent actions

### 3. Recipe Data Model

**Each recipe is agent-specific**:

```typescript
interface Recipe {
  agent_type: 'research' | 'content' | 'reporting'  // ← Agent-specific!
  // ... other fields
}
```

**Database Schema** (from migration):
```sql
CREATE TABLE work_recipes (
  id UUID PRIMARY KEY,
  agent_type TEXT NOT NULL,  -- research, content, reporting
  -- ... other fields
  CHECK (agent_type IN ('research', 'content', 'reporting'))
)
```

**Discovery API allows filtering by agent_type**:
```
GET /api/work/recipes?agent_type=reporting
```

### 4. Current Project Overview Pattern

**Code Evidence** ([ProjectOverviewClient.tsx:116-140](work-platform/web/app/projects/[id]/overview/ProjectOverviewClient.tsx#L116-L140)):

```typescript
{project.agents.map((agent) => {
  const stats = agentSummaries[agent.id];
  return (
    <div key={agent.id} className="...agent card...">
      <div className="font-medium">{agent.display_name}</div>
      <div className="text-xs capitalize">{agent.agent_type}</div>
      {/* Agent action button would go here */}
    </div>
  );
})}
```

**Pattern**: Individual agent cards, each representing a specific agent type.

---

## Architectural Analysis

### ❌ Why `/work/new` is WRONG (Legacy Approach)

1. **Breaks agent-type consistency**: Backend and frontend are both agent-type-specific
2. **Forces agent selection in UI**: User would have to select agent type AFTER clicking "New Work"
3. **Doesn't match backend structure**: No generic `/work/execute` endpoint exists
4. **Recipe filtering overhead**: Would need to filter recipes by agent type after page load
5. **Extra navigation step**: Gallery → filter by agent → select recipe → configure

### ✅ Why Agent-Type-Specific Routes are CORRECT

1. **Mirrors backend structure**: `/work/research/execute` → `/work/research/recipes`
2. **Aligns with existing frontend patterns**: `/projects/[id]/agents/[agentType]`
3. **Direct invocation**: User action on agent card → agent-specific recipe selection
4. **Better UX**: Pre-filtered recipes, fewer clicks, clearer context
5. **Future-proof**: Supports agent-specific recipe galleries with specialized parameters

---

## Recommended Frontend Architecture

### Route Structure

```
📁 work-platform/web/app/projects/[id]/

  📁 agents/
    📁 [agentType]/
      📄 page.tsx              (existing agent dashboard)
      📁 recipes/
        📄 page.tsx            (agent-specific recipe gallery)
        📁 [slug]/
          📄 page.tsx          (recipe configuration + execution)
```

### URL Examples

```
/projects/123/agents/research/recipes
  → Filters: GET /api/work/recipes?agent_type=research
  → Displays: Research recipes only

/projects/123/agents/research/recipes/competitive-analysis
  → Loads: GET /api/work/recipes/competitive-analysis
  → Executes: POST /work/research/execute { recipe_id: "competitive-analysis", ... }

/projects/123/agents/reporting/recipes
  → Filters: GET /api/work/recipes?agent_type=reporting
  → Displays: Reporting recipes only

/projects/123/agents/reporting/recipes/executive-summary-deck
  → Loads: GET /api/work/recipes/executive-summary-deck
  → Executes: POST /work/reporting/execute { recipe_id: "executive-summary-deck", ... }
```

### User Flow

1. **Project Overview** → User sees agent cards (research, content, reporting)
2. **Click Agent Card** → Navigate to `/projects/[id]/agents/[agentType]/recipes`
3. **Recipe Gallery** → See recipes filtered for that agent type
4. **Select Recipe** → Navigate to `/projects/[id]/agents/[agentType]/recipes/[slug]`
5. **Configure Parameters** → Fill dynamic form with recipe parameters
6. **Execute** → POST to `/work/[agentType]/execute` with `recipe_id`
7. **Results** → View work outputs on agent dashboard

---

## Implementation Changes

### What Changes from Original Plan

#### BEFORE (Generic Routes - WRONG):
```
❌ /work/new                    (recipe gallery)
❌ /work/new/[slug]            (recipe configuration)
❌ Dashboard: "+" New Work" button → /work/new
```

#### AFTER (Agent-Specific Routes - CORRECT):
```
✅ /projects/[id]/agents/[agentType]/recipes           (recipe gallery)
✅ /projects/[id]/agents/[agentType]/recipes/[slug]    (recipe configuration)
✅ Project Overview: Agent cards with action buttons → agent-specific recipes
```

### Component Changes

#### Recipe Gallery Component
- **Before**: Shows all recipes with filter dropdown
- **After**: Pre-filtered by agent type from URL, no filter needed

#### Recipe Configuration Component
- **Before**: Generic execution to `/api/work/execute`
- **After**: Agent-specific execution to `/api/work/[agentType]/execute`

#### Navigation Entry Points
- **Before**: Single "+ New Work" button on dashboard
- **After**: Action button on each agent card in project overview

---

## Benefits of Agent-Type-Specific Routes

1. **✅ Backend Consistency**: Routes mirror backend endpoint structure
2. **✅ Existing Pattern Alignment**: Matches `/projects/[id]/agents/[agentType]` pattern
3. **✅ Reduced Complexity**: No need for agent type selection UI
4. **✅ Better UX**: Direct path from agent → recipes → execution
5. **✅ Clearer Context**: User always knows which agent they're working with
6. **✅ Simpler State Management**: Agent type from URL, not app state
7. **✅ Future Extensibility**: Easy to add agent-specific recipe features

---

## Next Steps (REVISED)

### Phase 1: Shared Components (No Changes)
- ✅ Create TypeScript types ([lib/types/recipes.ts](work-platform/web/lib/types/recipes.ts))
- ✅ Create ParameterInput component ([components/recipes/ParameterInput.tsx](work-platform/web/components/recipes/ParameterInput.tsx))
- ✅ Create RecipeCard component ([components/recipes/RecipeCard.tsx](work-platform/web/components/recipes/RecipeCard.tsx))

### Phase 2: Agent-Specific Recipe Routes (REVISED)

**File**: `work-platform/web/app/projects/[id]/agents/[agentType]/recipes/page.tsx`

```typescript
export default async function AgentRecipeGalleryPage({ params }: PageProps) {
  const { id: projectId, agentType } = await params;

  // Pre-filter recipes by agent type
  const recipes = await fetch(`/api/work/recipes?agent_type=${agentType}`);

  // Display agent-specific recipe gallery
  return (
    <div>
      <h1>{agentType} Recipes</h1>
      <RecipeGrid recipes={recipes} agentType={agentType} />
    </div>
  );
}
```

**File**: `work-platform/web/app/projects/[id]/agents/[agentType]/recipes/[slug]/page.tsx`

```typescript
export default async function RecipeConfigurationPage({ params }: PageProps) {
  const { id: projectId, agentType, slug } = await params;

  // Load recipe details
  const recipe = await fetch(`/api/work/recipes/${slug}`);

  // Execute against agent-specific endpoint
  const handleExecute = async (parameters: Record<string, any>) => {
    const response = await fetch(`/api/work/${agentType}/execute`, {
      method: 'POST',
      body: JSON.stringify({
        basket_id,  // from project
        recipe_id: slug,
        recipe_parameters: parameters,
      }),
    });
    return response.json();
  };

  return <RecipeConfigurationForm recipe={recipe} onExecute={handleExecute} />;
}
```

### Phase 3: Update Project Overview (REVISED)

**File**: `work-platform/web/app/projects/[id]/overview/ProjectOverviewClient.tsx`

Add action button to each agent card:

```typescript
<Button
  onClick={() => router.push(`/projects/${project.id}/agents/${agent.agent_type}/recipes`)}
>
  Browse Recipes
</Button>
```

---

## Validation Checklist

- [x] Backend endpoints are agent-type-specific ✅
- [x] Frontend already has agent-type routing pattern ✅
- [x] Recipes have agent_type field ✅
- [x] Discovery API supports agent_type filtering ✅
- [x] Execution endpoints are agent-specific ✅
- [x] Project overview displays agent cards ✅

**Conclusion**: Agent-type-specific routes are the **correct architectural choice**.

---

## Files to Update

### New Files (Agent-Specific Routes):
1. `work-platform/web/app/projects/[id]/agents/[agentType]/recipes/page.tsx`
2. `work-platform/web/app/projects/[id]/agents/[agentType]/recipes/[slug]/page.tsx`

### Files to Update:
1. `work-platform/web/app/projects/[id]/overview/ProjectOverviewClient.tsx` - Add recipe action buttons

### Files to Delete from Original Plan:
1. ~~`work-platform/web/app/work/new/page.tsx`~~ (not needed)
2. ~~`work-platform/web/app/work/new/[slug]/page.tsx`~~ (not needed)

### Documentation to Update:
1. `FRONTEND_IMPLEMENTATION_NEXT_STEPS.md` - Revise route structure
2. `FRONTEND_WORK_RECIPES_INTEGRATION.md` - Update route examples

---

## Summary

Your architectural instinct was **100% correct**:

> "depending on the work request type for whichever work recipe and agent type, there will and should be endpoints respectively"

The backend is already designed this way (`/work/research/execute`, `/work/reporting/execute`), and the frontend should mirror this pattern with agent-type-specific recipe routes.

**Generic `/work/new` would be a legacy approach** that doesn't align with the existing architecture.
