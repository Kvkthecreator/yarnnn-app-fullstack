# Frontend Integration Guide: Work Recipes

**Date**: 2025-11-23
**Architecture**: Recipes-Only, Fully Integrated into Work Requests
**Backend Status**: ✅ Complete (commit 69070103)

---

## Overview

This document provides implementation guidance for integrating the work recipes system into the frontend. The backend is complete and provides two discovery endpoints + one integrated execution endpoint.

**User Experience**: Single "+ New Work" button → Recipe gallery → Dynamic configuration form → Execution & results

---

## API Endpoints

### 1. Recipe Discovery

**List Active Recipes**
```typescript
GET /api/work/recipes
Query Params:
  - agent_type?: string (filter by "research" | "content" | "reporting")
  - category?: string (filter by category)

Response:
[
  {
    id: string,
    slug: string,
    name: string,
    description: string,
    category: string,
    agent_type: "research" | "content" | "reporting",
    deliverable_intent: {
      purpose: string,
      audience: string,
      expected_outcome: string
    },
    configurable_parameters: {
      [paramName: string]: {
        type: "range" | "text" | "multi-select",
        label: string,
        optional?: boolean,
        default?: any,
        // Type-specific fields:
        min?: number,         // for range
        max?: number,         // for range
        max_length?: number,  // for text
        options?: string[]    // for multi-select
      }
    },
    estimated_duration_seconds: [min, max],
    estimated_cost_cents: [min, max]
  }
]
```

**Get Recipe Details**
```typescript
GET /api/work/recipes/{slug}

Response: Same as list item above (single recipe)
```

### 2. Recipe Execution

**Execute Recipe-Driven Work Request**
```typescript
POST /api/work/reporting/execute

Request Body:
{
  basket_id: string,
  task_description: string,  // Brief description for tracking
  recipe_id: string,          // Recipe slug or UUID
  recipe_parameters: {        // User-customized parameters
    [paramName: string]: any  // Must match recipe schema
  },
  reference_asset_ids?: string[]  // Optional user-uploaded documents
}

Response:
{
  work_request_id: string,
  work_ticket_id: string,
  agent_session_id: string,
  status: "completed" | "failed",
  outputs: Array<{
    id: string,
    content: any,
    format: string,
    metadata: object
  }>,
  execution_time_ms: number,
  message: string,
  recipe_used: string  // Recipe slug
}
```

---

## UI Components to Build

### 1. Overview Page Update

**Current State**: Individual action buttons on each agent card
**Target State**: Single top-right "+ New Work" button

**Changes Required**:
```tsx
// Remove from agent cards:
<Button onClick={openNewWorkModal}>New Work</Button>

// Add to page header (top-right):
<Button
  variant="primary"
  onClick={() => navigate('/work/new')}
  icon={<PlusIcon />}
>
  New Work
</Button>
```

**File**: `work-platform/frontend/src/pages/Overview.tsx` (or similar)

---

### 2. Recipe Gallery Component

**Route**: `/work/new`
**Purpose**: Browse and select work recipe templates

**Component Structure**:
```tsx
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'

interface Recipe {
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
  configurable_parameters: Record<string, any>
  estimated_duration_seconds: [number, number]
  estimated_cost_cents: [number, number]
}

export function RecipeGallery() {
  const [agentTypeFilter, setAgentTypeFilter] = useState<string | null>(null)
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null)

  const { data: recipes, isLoading } = useQuery({
    queryKey: ['recipes', { agent_type: agentTypeFilter, category: categoryFilter }],
    queryFn: async () => {
      const params = new URLSearchParams()
      if (agentTypeFilter) params.append('agent_type', agentTypeFilter)
      if (categoryFilter) params.append('category', categoryFilter)

      const response = await fetch(`/api/work/recipes?${params}`, {
        headers: { Authorization: `Bearer ${getToken()}` }
      })
      return response.json() as Promise<Recipe[]>
    }
  })

  return (
    <div className="recipe-gallery">
      {/* Filters */}
      <div className="filters">
        <select onChange={(e) => setAgentTypeFilter(e.target.value || null)}>
          <option value="">All Agent Types</option>
          <option value="research">Research</option>
          <option value="content">Content</option>
          <option value="reporting">Reporting</option>
        </select>
      </div>

      {/* Recipe Cards */}
      <div className="recipe-grid">
        {recipes?.map(recipe => (
          <RecipeCard
            key={recipe.id}
            recipe={recipe}
            onSelect={() => navigate(`/work/new/recipe/${recipe.slug}`)}
          />
        ))}
      </div>
    </div>
  )
}

function RecipeCard({ recipe, onSelect }: { recipe: Recipe, onSelect: () => void }) {
  const [minDuration, maxDuration] = recipe.estimated_duration_seconds
  const [minCost, maxCost] = recipe.estimated_cost_cents

  return (
    <div className="recipe-card" onClick={onSelect}>
      <div className="recipe-header">
        <h3>{recipe.name}</h3>
        <span className="category-badge">{recipe.category}</span>
      </div>

      <p className="description">{recipe.description}</p>

      <div className="deliverable-intent">
        <strong>Purpose:</strong> {recipe.deliverable_intent.purpose}
      </div>

      <div className="estimates">
        <div className="estimate-item">
          <ClockIcon />
          <span>{formatDuration(minDuration)} - {formatDuration(maxDuration)}</span>
        </div>
        <div className="estimate-item">
          <DollarIcon />
          <span>${(minCost/100).toFixed(2)} - ${(maxCost/100).toFixed(2)}</span>
        </div>
      </div>

      <Button variant="secondary">Configure →</Button>
    </div>
  )
}
```

**File to Create**: `work-platform/frontend/src/components/RecipeGallery.tsx`

---

### 3. Recipe Configuration Component

**Route**: `/work/new/recipe/:slug`
**Purpose**: Configure recipe parameters and execute

**Component Structure**:
```tsx
import { useParams } from 'react-router-dom'
import { useQuery, useMutation } from '@tanstack/react-query'
import { useState } from 'react'

export function RecipeConfiguration() {
  const { slug } = useParams<{ slug: string }>()
  const [parameters, setParameters] = useState<Record<string, any>>({})
  const [taskDescription, setTaskDescription] = useState('')

  // Fetch recipe details
  const { data: recipe, isLoading } = useQuery({
    queryKey: ['recipe', slug],
    queryFn: async () => {
      const response = await fetch(`/api/work/recipes/${slug}`, {
        headers: { Authorization: `Bearer ${getToken()}` }
      })
      return response.json() as Promise<Recipe>
    }
  })

  // Execute recipe
  const executeMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch('/api/work/reporting/execute', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${getToken()}`
        },
        body: JSON.stringify({
          basket_id: getCurrentBasketId(),
          task_description: taskDescription || recipe?.name,
          recipe_id: slug,
          recipe_parameters: parameters,
          reference_asset_ids: []
        })
      })

      if (!response.ok) throw new Error('Execution failed')
      return response.json()
    },
    onSuccess: (data) => {
      navigate(`/work/results/${data.work_request_id}`)
    }
  })

  if (isLoading) return <LoadingSpinner />
  if (!recipe) return <NotFound />

  return (
    <div className="recipe-configuration">
      {/* Recipe Header */}
      <div className="recipe-header">
        <h1>{recipe.name}</h1>
        <p>{recipe.description}</p>
      </div>

      {/* Parameter Form */}
      <form onSubmit={(e) => { e.preventDefault(); executeMutation.mutate() }}>
        <div className="parameter-form">
          {Object.entries(recipe.configurable_parameters).map(([paramName, paramSchema]) => (
            <ParameterInput
              key={paramName}
              name={paramName}
              schema={paramSchema}
              value={parameters[paramName]}
              onChange={(value) => setParameters(prev => ({ ...prev, [paramName]: value }))}
            />
          ))}
        </div>

        {/* Optional Task Description */}
        <div className="form-group">
          <label>Task Description (optional)</label>
          <input
            type="text"
            placeholder={`e.g., ${recipe.name} for Q4 review`}
            value={taskDescription}
            onChange={(e) => setTaskDescription(e.target.value)}
          />
        </div>

        {/* Submit Button */}
        <Button
          type="submit"
          variant="primary"
          loading={executeMutation.isPending}
        >
          Execute Recipe
        </Button>
      </form>
    </div>
  )
}
```

**File to Create**: `work-platform/frontend/src/components/RecipeConfiguration.tsx`

---

### 4. Dynamic Parameter Input Component

**Purpose**: Render appropriate input controls based on parameter type

```tsx
interface ParameterSchema {
  type: 'range' | 'text' | 'multi-select'
  label: string
  optional?: boolean
  default?: any
  min?: number
  max?: number
  max_length?: number
  options?: string[]
}

function ParameterInput({
  name,
  schema,
  value,
  onChange
}: {
  name: string
  schema: ParameterSchema
  value: any
  onChange: (value: any) => void
}) {
  const renderInput = () => {
    switch (schema.type) {
      case 'range':
        return (
          <div className="range-input">
            <input
              type="range"
              min={schema.min}
              max={schema.max}
              value={value ?? schema.default ?? schema.min}
              onChange={(e) => onChange(Number(e.target.value))}
            />
            <div className="range-labels">
              <span>{schema.min}</span>
              <strong>{value ?? schema.default ?? schema.min}</strong>
              <span>{schema.max}</span>
            </div>
          </div>
        )

      case 'text':
        return (
          <div className="text-input">
            <input
              type="text"
              value={value ?? schema.default ?? ''}
              onChange={(e) => onChange(e.target.value)}
              maxLength={schema.max_length}
              placeholder={schema.optional ? 'Optional' : 'Required'}
            />
            {schema.max_length && (
              <span className="char-counter">
                {(value?.length ?? 0)} / {schema.max_length}
              </span>
            )}
          </div>
        )

      case 'multi-select':
        return (
          <div className="multi-select-input">
            {schema.options?.map(option => (
              <label key={option} className="checkbox-label">
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
                />
                {option}
              </label>
            ))}
          </div>
        )

      default:
        return null
    }
  }

  return (
    <div className="parameter-input-group">
      <label>
        {schema.label}
        {!schema.optional && <span className="required">*</span>}
      </label>
      {renderInput()}
    </div>
  )
}
```

**File to Create**: `work-platform/frontend/src/components/ParameterInput.tsx`

---

## Implementation Checklist

### Phase 1: Overview Page Update
- [ ] Remove individual action buttons from agent cards
- [ ] Add single "+ New Work" button to page header (top-right)
- [ ] Wire button to navigate to `/work/new`

### Phase 2: Recipe Gallery
- [ ] Create RecipeGallery component
- [ ] Implement recipe card display
- [ ] Add filters (agent_type, category)
- [ ] Wire "Configure" button to navigate to `/work/new/recipe/:slug`

### Phase 3: Recipe Configuration
- [ ] Create RecipeConfiguration component
- [ ] Create ParameterInput component with all three types:
  - [ ] Range slider
  - [ ] Text input with character counter
  - [ ] Multi-select checkboxes
- [ ] Implement form validation (required parameters)
- [ ] Wire submit to POST /api/work/reporting/execute
- [ ] Handle success (navigate to results)
- [ ] Handle errors (display validation errors)

### Phase 4: Execution Results
- [ ] Create or update work results page
- [ ] Display work_ticket status
- [ ] Display work_outputs when complete
- [ ] Link to work request history

---

## API Integration Examples

### Fetching Recipes with React Query

```tsx
import { useQuery } from '@tanstack/react-query'

// In your component:
const { data: recipes, isLoading, error } = useQuery({
  queryKey: ['recipes', { agent_type: 'reporting' }],
  queryFn: async () => {
    const response = await fetch('/api/work/recipes?agent_type=reporting', {
      headers: { Authorization: `Bearer ${getToken()}` }
    })
    if (!response.ok) throw new Error('Failed to fetch recipes')
    return response.json()
  }
})
```

### Executing a Recipe

```tsx
import { useMutation } from '@tanstack/react-query'

const executeMutation = useMutation({
  mutationFn: async (payload: {
    recipe_id: string
    recipe_parameters: Record<string, any>
  }) => {
    const response = await fetch('/api/work/reporting/execute', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${getToken()}`
      },
      body: JSON.stringify({
        basket_id: getCurrentBasketId(),
        task_description: 'Executive summary for Q4',
        ...payload
      })
    })

    if (!response.ok) {
      const error = await response.json()
      throw new Error(error.detail || 'Execution failed')
    }

    return response.json()
  },
  onSuccess: (data) => {
    console.log('Recipe executed:', data.work_request_id)
    navigate(`/work/results/${data.work_request_id}`)
  },
  onError: (error) => {
    toast.error(error.message)
  }
})

// Usage:
executeMutation.mutate({
  recipe_id: 'executive-summary-deck',
  recipe_parameters: {
    slide_count: 5,
    focus_area: 'Q4 performance highlights'
  }
})
```

---

## Parameter Validation

**Frontend Validation** (before submission):
```typescript
function validateParameters(
  parameters: Record<string, any>,
  schema: Record<string, ParameterSchema>
): { valid: boolean; errors: Record<string, string> } {
  const errors: Record<string, string> = {}

  for (const [paramName, paramSchema] of Object.entries(schema)) {
    const value = parameters[paramName]

    // Check required
    if (!paramSchema.optional && (value === undefined || value === null || value === '')) {
      errors[paramName] = `${paramSchema.label} is required`
      continue
    }

    // Type-specific validation
    if (value !== undefined && value !== null) {
      switch (paramSchema.type) {
        case 'range':
          if (typeof value !== 'number') {
            errors[paramName] = 'Must be a number'
          } else if (paramSchema.min !== undefined && value < paramSchema.min) {
            errors[paramName] = `Must be at least ${paramSchema.min}`
          } else if (paramSchema.max !== undefined && value > paramSchema.max) {
            errors[paramName] = `Must be at most ${paramSchema.max}`
          }
          break

        case 'text':
          if (typeof value !== 'string') {
            errors[paramName] = 'Must be text'
          } else if (paramSchema.max_length && value.length > paramSchema.max_length) {
            errors[paramName] = `Must be ${paramSchema.max_length} characters or less`
          }
          break

        case 'multi-select':
          if (!Array.isArray(value)) {
            errors[paramName] = 'Must be an array'
          } else {
            const invalidOptions = value.filter(v => !paramSchema.options?.includes(v))
            if (invalidOptions.length > 0) {
              errors[paramName] = `Invalid options: ${invalidOptions.join(', ')}`
            }
          }
          break
      }
    }
  }

  return { valid: Object.keys(errors).length === 0, errors }
}
```

**Backend Validation**: The RecipeLoader service validates parameters against the schema and returns 400 errors if validation fails.

---

## Styling Recommendations

### Recipe Card
- Card-based layout with hover effect
- Category badge (color-coded by agent_type)
- Icon for agent type (research, content, reporting)
- Prominent estimates (duration + cost)
- Clear CTA button

### Parameter Form
- Grouped by parameter type
- Clear labels with required asterisks
- Range sliders with current value displayed
- Text inputs with character counters
- Multi-select with checkbox groups
- Validation error messages below inputs

### Responsive Design
- Recipe gallery: 3 columns on desktop, 2 on tablet, 1 on mobile
- Parameter form: Full-width on mobile, constrained on desktop

---

## Testing Strategy

### Unit Tests
- ParameterInput component (all three types)
- Parameter validation logic
- Recipe card rendering

### Integration Tests
- Recipe gallery fetch + display
- Recipe configuration form submission
- Error handling (validation errors, API errors)

### E2E Tests
1. Navigate to "+ New Work" → Recipe Gallery
2. Filter recipes by agent type
3. Select "Executive Summary Deck" recipe
4. Fill parameters (slide_count: 5, focus_area: "Q4 highlights")
5. Submit and verify navigation to results page
6. Verify work_request created with recipe_id

---

## Error Handling

### API Error Responses

**404 - Recipe Not Found**:
```json
{
  "detail": "Recipe not found: invalid-slug"
}
```

**400 - Parameter Validation Failed**:
```json
{
  "detail": "Recipe parameter validation failed: Parameter 'slide_count' must be >= 3, got 2"
}
```

**500 - Execution Error**:
```json
{
  "detail": "Reporting workflow execution failed: Agent execution timed out"
}
```

### Frontend Error Display
- Toast notifications for API errors
- Inline validation errors for parameter inputs
- Retry button for execution failures
- Link to support if unexpected errors occur

---

## Performance Considerations

- Cache recipe list with React Query (staleTime: 5 minutes)
- Debounce parameter inputs (especially text inputs)
- Optimistic updates for parameter changes
- Loading states for all async operations
- Consider pagination for recipe gallery if > 20 recipes

---

## Future Enhancements

**Phase 2 (Post-MVP)**:
- Recipe search/autocomplete
- Recipe favorites
- Recently used recipes
- Recipe preview (sample outputs)
- Multi-agent recipes (research → reporting flow)
- Recipe templates (save custom parameter sets)

---

## Questions & Support

If you encounter issues during implementation:
1. Check backend logs in Render (srv-d4duig9r0fns73bbtl4g)
2. Verify JWT token is valid
3. Check basket_id exists and user has access
4. Review WORK_RECIPES_IMPLEMENTATION_STATUS.md for architecture details

Backend is fully tested and ready. Focus on frontend UX and parameter form dynamics.
