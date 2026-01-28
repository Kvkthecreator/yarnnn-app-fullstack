# Frontend Implementation: Next Steps (REVISED - Agent-Type-Specific Routes)

**Status**: Backend Complete ✅ | Architecture Audit Complete ✅ | Frontend Ready to Start 📋
**Date**: 2025-11-23
**Architecture**: Agent-Type-Specific Routes (mirrors backend structure)

---

## Summary

The work recipes backend is fully implemented and tested. This document provides the exact steps to implement the frontend components for the recipes-only workflow.

### Architecture Confirmed (REVISED):
- **Entry Points**: Action buttons on agent cards in project overview
- **Route Pattern**: `/projects/[id]/agents/[agentType]/recipes` (agent-specific)
- **No Free-Form Path**: Users must select a recipe
- **Flow**: Agent Card → Recipe Gallery (filtered) → Configuration → Execution → Results

**Key Change**: Routes are **agent-type-specific** (not generic `/work/new`), mirroring backend endpoint structure.

---

## Implementation Sequence

### Phase 1: Shared Components (Start Here)

#### 1.1 Create Types Definition
**File**: `work-platform/web/lib/types/recipes.ts`

```typescript
export interface Recipe {
  id: string
  slug: string
  name: string
  description: string
  category: string
  agent_type: 'research' | 'content' | 'reporting'
  deliverable_intent: {
    purpose: string
    audience: string
    expected_outcome: string
  }
  configurable_parameters: Record<string, ParameterSchema>
  estimated_duration_seconds: [number, number]
  estimated_cost_cents: [number, number]
}

export interface ParameterSchema {
  type: 'range' | 'text' | 'multi-select'
  label: string
  optional?: boolean
  default?: any
  min?: number  // for range
  max?: number  // for range
  max_length?: number  // for text
  options?: string[]  // for multi-select
}

export interface RecipeExecutionRequest {
  basket_id: string
  task_description: string
  recipe_id: string
  recipe_parameters: Record<string, any>
  reference_asset_ids?: string[]
}

export interface RecipeExecutionResponse {
  work_request_id: string
  work_ticket_id: string
  agent_session_id: string
  status: 'completed' | 'failed'
  outputs: Array<{
    id: string
    content: any
    format: string
    metadata: object
  }>
  execution_time_ms: number
  message: string
  recipe_used: string
}
```

#### 1.2 Create ParameterInput Component
**File**: `work-platform/web/components/recipes/ParameterInput.tsx`

```typescript
'use client'

import { Label } from '@/components/ui/Label'
import type { ParameterSchema } from '@/lib/types/recipes'

interface ParameterInputProps {
  name: string
  schema: ParameterSchema
  value: any
  onChange: (value: any) => void
  error?: string
}

export function ParameterInput({ name, schema, value, onChange, error }: ParameterInputProps) {
  const renderInput = () => {
    switch (schema.type) {
      case 'range':
        return (
          <div className="space-y-2">
            <input
              type="range"
              min={schema.min}
              max={schema.max}
              value={value ?? schema.default ?? schema.min}
              onChange={(e) => onChange(Number(e.target.value))}
              className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer"
            />
            <div className="flex justify-between text-sm text-gray-600">
              <span>{schema.min}</span>
              <strong className="text-gray-900">{value ?? schema.default ?? schema.min}</strong>
              <span>{schema.max}</span>
            </div>
          </div>
        )

      case 'text':
        return (
          <div className="space-y-1">
            <input
              type="text"
              value={value ?? schema.default ?? ''}
              onChange={(e) => onChange(e.target.value)}
              maxLength={schema.max_length}
              placeholder={schema.optional ? 'Optional' : 'Required'}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            {schema.max_length && (
              <div className="text-xs text-gray-500 text-right">
                {(value?.length ?? 0)} / {schema.max_length}
              </div>
            )}
          </div>
        )

      case 'multi-select':
        return (
          <div className="space-y-2">
            {schema.options?.map((option) => (
              <label key={option} className="flex items-center space-x-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={value?.includes(option) ?? false}
                  onChange={(e) => {
                    const currentValues = value ?? []
                    if (e.target.checked) {
                      onChange([...currentValues, option])
                    } else {
                      onChange(currentValues.filter((v: string) => v !== option))
                    }
                  }}
                  className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                />
                <span className="text-sm text-gray-700">{option}</span>
              </label>
            ))}
          </div>
        )

      default:
        return null
    }
  }

  return (
    <div className="space-y-2">
      <Label>
        {schema.label}
        {!schema.optional && <span className="text-red-500 ml-1">*</span>}
      </Label>
      {renderInput()}
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  )
}
```

### Phase 2: Recipe Gallery Page (REVISED - Agent-Specific)

#### 2.1 Create Recipe Card Component
**File**: `work-platform/web/components/recipes/RecipeCard.tsx`

```typescript
'use client'

import Link from 'next/link'
import { Clock, DollarSign } from 'lucide-react'
import type { Recipe } from '@/lib/types/recipes'

interface RecipeCardProps {
  recipe: Recipe
  projectId: string
  agentType: string
}

export function RecipeCard({ recipe, projectId, agentType }: RecipeCardProps) {
  const [minDuration, maxDuration] = recipe.estimated_duration_seconds
  const [minCost, maxCost] = recipe.estimated_cost_cents

  const formatDuration = (seconds: number) => {
    const minutes = Math.ceil(seconds / 60)
    return `${minutes}min`
  }

  const formatCost = (cents: number) => {
    return `$${(cents / 100).toFixed(2)}`
  }

  return (
    <Link
      href={`/projects/${projectId}/agents/${agentType}/recipes/${recipe.slug}`}
      className="block p-6 bg-white border border-gray-200 rounded-lg hover:shadow-lg transition-shadow"
    >
      <div className="flex items-start justify-between mb-3">
        <h3 className="text-lg font-semibold text-gray-900">{recipe.name}</h3>
        <span className="px-2 py-1 text-xs font-medium text-blue-600 bg-blue-50 rounded">
          {recipe.category}
        </span>
      </div>

      <p className="text-sm text-gray-600 mb-4">{recipe.description}</p>

      <div className="mb-4 p-3 bg-gray-50 rounded">
        <p className="text-xs font-medium text-gray-500 mb-1">Purpose</p>
        <p className="text-sm text-gray-700">{recipe.deliverable_intent.purpose}</p>
      </div>

      <div className="flex items-center justify-between text-sm text-gray-600">
        <div className="flex items-center space-x-1">
          <Clock className="w-4 h-4" />
          <span>{formatDuration(minDuration)}-{formatDuration(maxDuration)}</span>
        </div>
        <div className="flex items-center space-x-1">
          <DollarSign className="w-4 h-4" />
          <span>{formatCost(minCost)}-{formatCost(maxCost)}</span>
        </div>
      </div>
    </Link>
  )
}
```

#### 2.2 Create Agent-Specific Recipe Gallery Page
**File**: `work-platform/web/app/projects/[id]/agents/[agentType]/recipes/page.tsx`

```typescript
'use client'

import { use } from 'react'
import { useQuery } from '@tanstack/react-query'
import { RecipeCard } from '@/components/recipes/RecipeCard'
import type { Recipe } from '@/lib/types/recipes'
import { Badge } from '@/components/ui/Badge'

interface PageProps {
  params: Promise<{ id: string; agentType: string }>
}

export default function AgentRecipeGalleryPage({ params }: PageProps) {
  const { id: projectId, agentType } = use(params)

  const { data: recipes, isLoading } = useQuery({
    queryKey: ['recipes', agentType],
    queryFn: async () => {
      const response = await fetch(`/api/work/recipes?agent_type=${agentType}`)
      if (!response.ok) throw new Error('Failed to fetch recipes')
      return response.json() as Promise<Recipe[]>
    }
  })

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-2">
          <h1 className="text-3xl font-bold text-gray-900 capitalize">{agentType} Recipes</h1>
          <Badge variant="secondary">{recipes?.length || 0} available</Badge>
        </div>
        <p className="text-gray-600">
          Select a recipe template for {agentType} work deliverables
        </p>
      </div>

      {isLoading ? (
        <div className="text-center py-12">
          <p className="text-gray-500">Loading recipes...</p>
        </div>
      ) : recipes && recipes.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {recipes.map((recipe) => (
            <RecipeCard
              key={recipe.id}
              recipe={recipe}
              projectId={projectId}
              agentType={agentType}
            />
          ))}
        </div>
      ) : (
        <div className="text-center py-12">
          <p className="text-gray-500">No recipes available for {agentType}</p>
        </div>
      )}
    </div>
  )
}
```

### Phase 3: Recipe Configuration Page (REVISED - Agent-Specific)

**File**: `work-platform/web/app/projects/[id]/agents/[agentType]/recipes/[slug]/page.tsx`

```typescript
'use client'

import { use, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useQuery, useMutation } from '@tanstack/react-query'
import { toast } from 'sonner'
import { ParameterInput } from '@/components/recipes/ParameterInput'
import type { Recipe } from '@/lib/types/recipes'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'

interface PageProps {
  params: Promise<{ id: string; agentType: string; slug: string }>
}

export default function RecipeConfigurationPage({ params }: PageProps) {
  const { id: projectId, agentType, slug } = use(params)
  const router = useRouter()

  const [parameters, setParameters] = useState<Record<string, any>>({})
  const [taskDescription, setTaskDescription] = useState('')

  // Fetch project to get basket_id
  const { data: project } = useQuery({
    queryKey: ['project', projectId],
    queryFn: async () => {
      const response = await fetch(`/api/projects/${projectId}`)
      if (!response.ok) throw new Error('Failed to fetch project')
      return response.json()
    }
  })

  // Fetch recipe details
  const { data: recipe, isLoading } = useQuery({
    queryKey: ['recipe', slug],
    queryFn: async () => {
      const response = await fetch(`/api/work/recipes/${slug}`)
      if (!response.ok) throw new Error('Failed to fetch recipe')
      return response.json() as Promise<Recipe>
    }
  })

  // Execute recipe mutation (agent-specific endpoint)
  const executeMutation = useMutation({
    mutationFn: async () => {
      if (!project?.basket_id) throw new Error('Project not loaded')

      const response = await fetch(`/api/work/${agentType}/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          basket_id: project.basket_id,
          task_description: taskDescription || recipe?.name,
          recipe_id: slug,
          recipe_parameters: parameters,
          reference_asset_ids: []
        })
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.detail || 'Execution failed')
      }

      return response.json()
    },
    onSuccess: (data) => {
      toast.success('Recipe executed successfully!')
      // Navigate to agent dashboard or work session
      router.push(`/projects/${projectId}/agents/${agentType}`)
    },
    onError: (error: Error) => {
      toast.error(error.message)
    }
  })

  if (isLoading) return <div className="p-8">Loading recipe...</div>
  if (!recipe) return <div className="p-8">Recipe not found</div>

  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      <Card className="p-6 mb-6">
        <h1 className="text-3xl font-bold mb-2">{recipe.name}</h1>
        <p className="text-gray-600 mb-4">{recipe.description}</p>
        <div className="flex gap-2">
          <span className="px-2 py-1 text-xs bg-blue-100 text-blue-800 rounded capitalize">
            {agentType}
          </span>
          <span className="px-2 py-1 text-xs bg-gray-100 text-gray-800 rounded">
            {recipe.category}
          </span>
        </div>
      </Card>

      <form onSubmit={(e) => { e.preventDefault(); executeMutation.mutate() }} className="space-y-6">
        {Object.entries(recipe.configurable_parameters).map(([name, schema]) => (
          <ParameterInput
            key={name}
            name={name}
            schema={schema}
            value={parameters[name]}
            onChange={(value) => setParameters(prev => ({ ...prev, [name]: value }))}
          />
        ))}

        <div className="space-y-2">
          <label className="block text-sm font-medium text-gray-700">
            Task Description (optional)
          </label>
          <input
            type="text"
            value={taskDescription}
            onChange={(e) => setTaskDescription(e.target.value)}
            placeholder={`e.g., ${recipe.name} for Q4 review`}
            className="w-full px-3 py-2 border border-gray-300 rounded-md"
          />
        </div>

        <Button
          type="submit"
          disabled={executeMutation.isPending}
          className="w-full"
        >
          {executeMutation.isPending ? 'Executing...' : 'Execute Recipe'}
        </Button>
      </form>
    </div>
  )
}
```

### Phase 4: Project Overview Integration (REVISED)

**File**: `work-platform/web/app/projects/[id]/overview/ProjectOverviewClient.tsx` (Update)

Add "Browse Recipes" button to each agent card:

```typescript
// Add import at top
import { BookOpen } from 'lucide-react'

// In the agent card rendering (around line 150), add action button:
{agent.is_active && (
  <Button
    onClick={() => router.push(`/projects/${project.id}/agents/${agent.agent_type}/recipes`)}
    variant="outline"
    size="sm"
    className="w-full"
  >
    <BookOpen className="w-4 h-4 mr-2" />
    Browse Recipes
  </Button>
)}
```

**Full Updated Agent Card Section** (lines 116-165):

```typescript
<div className="grid gap-4 sm:grid-cols-1 md:grid-cols-2 lg:grid-cols-4">
  {project.agents.map((agent) => {
    const stats = agentSummaries[agent.id];
    return (
      <div
        key={agent.id}
        className={cn(
          'rounded-xl border bg-card p-4 transition-all flex flex-col gap-3',
          agent.is_active ? 'hover:border-ring hover:shadow-md' : 'opacity-70'
        )}
      >
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-surface-primary/70 p-2 text-primary">
              <Zap className="h-5 w-5" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="font-medium text-foreground">{agent.display_name}</div>
              <div className="text-xs text-muted-foreground capitalize">{agent.agent_type}</div>
            </div>
          </div>
          <Badge variant="outline" className={cn('text-xs capitalize w-fit', getAgentStatusBadgeClass(stats, agent.is_active))}>
            {getAgentStatusLabel(stats, agent.is_active)}
          </Badge>
        </div>

        <div className="space-y-1 text-xs text-muted-foreground">
          <p>
            {stats?.lastRun
              ? `Last run ${formatDistanceToNow(new Date(stats.lastRun))} ago`
              : 'Session ready • Never used'}
          </p>
          {stats?.lastTask && (
            <p className="line-clamp-2 text-foreground/80">"{stats.lastTask}"</p>
          )}
        </div>

        {/* NEW: Recipe action button */}
        {agent.is_active && (
          <Button
            onClick={() => router.push(`/projects/${project.id}/agents/${agent.agent_type}/recipes`)}
            variant="outline"
            size="sm"
            className="w-full mt-auto"
          >
            <BookOpen className="w-4 h-4 mr-2" />
            Browse Recipes
          </Button>
        )}
      </div>
    );
  })}
</div>
```

---

## Testing Checklist (REVISED)

- [ ] Agent cards display "Browse Recipes" button
- [ ] Button navigates to agent-specific recipe gallery
- [ ] Recipe gallery filters by agent_type automatically
- [ ] Recipe cards navigate to configuration page with correct agent context
- [ ] Configuration page loads recipe details
- [ ] Parameter inputs render correctly (range, text, multi-select)
- [ ] Form validation works
- [ ] Recipe execution posts to correct agent endpoint (`/work/{agentType}/execute`)
- [ ] Execution succeeds and creates work outputs
- [ ] Navigation back to agent dashboard works
- [ ] Work session appears on agent dashboard

---

## API Proxy Setup (If Needed)

If the API is on a different domain, create Next.js API routes to proxy requests:

**File**: `work-platform/web/app/api/work/recipes/route.ts`

```typescript
import { NextRequest, NextResponse } from 'next/server'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:10000'

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const agent_type = searchParams.get('agent_type')

  const params = new URLSearchParams()
  if (agent_type) params.append('agent_type', agent_type)

  const response = await fetch(`${API_URL}/api/work/recipes?${params}`)
  const data = await response.json()

  return NextResponse.json(data)
}
```

---

## Next Actions (REVISED)

1. **Create type definitions** ([lib/types/recipes.ts](work-platform/web/lib/types/recipes.ts))
2. **Implement ParameterInput** component ([components/recipes/ParameterInput.tsx](work-platform/web/components/recipes/ParameterInput.tsx))
3. **Create RecipeCard** component ([components/recipes/RecipeCard.tsx](work-platform/web/components/recipes/RecipeCard.tsx))
4. **Build Agent-Specific Recipe Gallery** page ([app/projects/[id]/agents/[agentType]/recipes/page.tsx](work-platform/web/app/projects/[id]/agents/[agentType]/recipes/page.tsx))
5. **Build Recipe Configuration** page ([app/projects/[id]/agents/[agentType]/recipes/[slug]/page.tsx](work-platform/web/app/projects/[id]/agents/[agentType]/recipes/[slug]/page.tsx))
6. **Update Project Overview** with recipe buttons ([app/projects/[id]/overview/ProjectOverviewClient.tsx](work-platform/web/app/projects/[id]/overview/ProjectOverviewClient.tsx))
7. **Test end-to-end flow** (all three agent types)
8. **Deploy and validate**

**Estimated Time**: 3-4 hours for complete frontend implementation

**Route Structure Summary**:
```
/projects/[id]/agents/[agentType]/recipes         → Recipe gallery (filtered)
/projects/[id]/agents/[agentType]/recipes/[slug]  → Recipe configuration + execution
```

---

## Notes

- All backend APIs are ready and tested
- Use existing UI components from `@/components/ui/*`
- Follow existing patterns in dashboard for consistency
- Parameter validation happens on backend (RecipeLoader)
- Toast notifications use `sonner` library
- Query state management uses `@tanstack/react-query`

