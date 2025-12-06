# Chat-First Architecture Plan v1.0

**Date**: December 6, 2025
**Status**: Approved for Implementation
**Author**: Claude Code + User Collaboration

---

## Executive Summary

This document outlines the architectural transformation of YARNNN from a tool-first to a **chat-first AI work platform**. The Thinking Partner (TP) becomes the primary interface - not as a traditional chatbot, but as a **gateway/mirror/meta** orchestrator that shows platform state inline with conversation.

### Core Thesis

> The chat interface should SHOW the platform, not just talk about it.

---

## 1. Strategic Context

### Why Chat-First?

1. **User Expectation**: ChatGPT normalized conversational AI interaction
2. **Natural Orchestration**: Complex multi-step workflows expressed naturally
3. **Context Accumulation**: Conversation builds shared understanding
4. **Reduced Cognitive Load**: One interface, many capabilities

### YARNNN's Differentiation

Unlike generic chatbots, YARNNN's TP is:
- **Gateway**: Single entry point for all platform operations
- **Mirror**: Reflects and orchestrates infrastructure state
- **Meta**: Emits own intelligence (pattern recognition, recommendations)

The chat doesn't replace structured UI - it becomes the **command center** that surfaces platform state inline.

---

## 2. Tech Debt: Substrate Blocks → Context Items Migration

### Current State

The agent layer still references legacy `substrate_blocks` terminology while the TP tools already use `context_items`.

### Files Requiring Migration

| File | Priority | Changes |
|------|----------|---------|
| `base_agent.py` | Critical | Rename `substrate_blocks` → `knowledge_context`, update `_query_substrate()`, `_build_system_prompt()` |
| `recipe_tools.py:161-163` | Critical | Add dual-format parsing for `context_items` + legacy fallback |
| `content_agent.py` | Moderate | Update prompt building references |
| `research_agent.py` | Moderate | Update prompt building references |
| `reporting_agent.py` | Moderate | Update prompt building references |

### Migration Strategy

```python
# BEFORE (base_agent.py)
substrate_blocks: List[Dict[str, Any]] = field(default_factory=list)

# AFTER
knowledge_context: List[Dict[str, Any]] = field(default_factory=list)
```

Recipe requirements parsing:
```python
# Support both formats with graceful fallback
required_context = ctx_req.get("context_items", {}).get("required_types", [])
if not required_context:
    # Legacy fallback
    required_context = ctx_req.get("substrate_blocks", {}).get("semantic_types", [])
```

---

## 3. Truncation/Summarization Strategy

### Assessment: NOT NOW, But Prepare Architecture

**Rationale**:
- Current session lengths are short (<20 messages during iteration)
- Low user volume = low total cost even with per-session growth
- Premature optimization risks solving wrong patterns

### Architecture Preparation

```python
class SessionContextStrategy:
    FULL_HISTORY = "full"           # Current behavior
    ROLLING_WINDOW = "rolling"      # Keep last N messages
    SUMMARIZED = "summarized"       # Compress older messages
    HYBRID = "hybrid"               # Summarize + keep key moments
```

### Implementation Hooks (Add Now, Implement Later)

1. `message_count` tracking (already exists)
2. Session "checkpoint" capability at key moments
3. `context_snapshot` compression hooks
4. Configurable strategy per workspace

### Trigger for Full Implementation

- Sessions regularly exceeding 30 messages
- Monthly LLM costs exceed defined threshold
- User feedback indicates context loss issues

---

## 4. Model Tiering Strategy

### Tiering Matrix

| Operation | Current | Recommended | Rationale |
|-----------|---------|-------------|-----------|
| TP simple queries (list_context, read_context) | Sonnet | **Haiku** | Pure data retrieval |
| TP orchestration (trigger_recipe, planning) | Sonnet | Sonnet | Requires judgment |
| TP Socratic dialogue | Sonnet | Sonnet | Needs nuance |
| Research execution | Sonnet | Sonnet | Depth matters |
| Content generation | Sonnet + Gemini | Sonnet + Gemini | Keep current |
| Reporting | Sonnet | Sonnet | Document quality |

### Implementation

```python
class TPModelRouter:
    SIMPLE_TOOLS = {"read_context", "list_context"}

    def select_model(self, intent: str, tool_calls: List[str]) -> str:
        if all(tc in self.SIMPLE_TOOLS for tc in tool_calls):
            return "claude-3-haiku"
        return "claude-sonnet-4"
```

---

## 5. Prompt Caching Strategy

### Structure for Maximum Cache Hits

```
┌─────────────────────────────────────────┐
│ CACHED (static across session)          │ ← cache_control: ephemeral
├─────────────────────────────────────────┤
│ • System prompt                         │
│ • Tool definitions                      │
│ • TP personality/rules                  │
│ • Recipe catalog                        │
└─────────────────────────────────────────┘
┌─────────────────────────────────────────┐
│ DYNAMIC (changes per message)           │ ← No caching
├─────────────────────────────────────────┤
│ • Context items snapshot                │
│ • Conversation history                  │
│ • Current work state                    │
└─────────────────────────────────────────┘
```

### Message Structure for Prefix Caching

```python
messages = [
    {
        "role": "system",
        "content": STATIC_SYSTEM_PROMPT,  # Cached
        "cache_control": {"type": "ephemeral"}
    },
    {
        "role": "user",
        "content": f"[CONTEXT]\n{dynamic_context}\n\n[MESSAGE]\n{user_input}"
    }
]
```

### Tool Definition Caching

Tool definitions should be stable and cacheable. Context-dependent tool behavior should be in the dynamic context, not tool definitions.

---

## 6. Chat-First UI Architecture

### Design Philosophy

The chat is a **command center**, not a simple message thread. It should:
1. Show platform state changes inline (context updates, work progress)
2. Provide quick actions without leaving conversation
3. Offer drill-down to full pages only when depth is needed

### In-Chat Card System

#### Card Types

```typescript
type ChatCardType =
  | 'context_change'      // Context item created/updated/proposed
  | 'work_output'         // Agent deliverable preview
  | 'recipe_progress'     // Running work with progress
  | 'execution_steps'     // Workflow step timeline
  | 'asset_preview'       // Image/document thumbnail
```

#### Single Item Display

```
┌─────────────────────────────────────────────────────────────┐
│ TPMessageCard (Assistant)                                    │
├─────────────────────────────────────────────────────────────┤
│ "I've updated your customer context..."                      │
│                                                             │
│ ┌─────────────────────────────────────┐                    │
│ │ 📝 Context Updated                  │                     │
│ │ Customer (Foundation)               │                     │
│ │ Action: Written → Pending Approval  │                     │
│ │ [View Details →]                    │                     │
│ └─────────────────────────────────────┘                    │
└─────────────────────────────────────────────────────────────┘
```

#### Multi-Item Display (3+ items)

```
┌─────────────────────────────────────────────────────────────┐
│ 📦 3 Context Items Updated                    [Expand ▼]   │
├─────────────────────────────────────────────────────────────┤
│ Collapsed: "Problem, Customer, Vision updated"              │
│                                                             │
│ Expanded:                                                   │
│ ┌──────────┐ ┌──────────┐ ┌──────────┐                     │
│ │ Problem  │ │ Customer │ │ Vision   │                     │
│ │ Written  │ │ Written  │ │ Proposed │                     │
│ │ [View]   │ │ [View]   │ │ [Approve]│                     │
│ └──────────┘ └──────────┘ └──────────┘                     │
│                                                             │
│ [View All in Context Page →]                                │
└─────────────────────────────────────────────────────────────┘
```

### Navigation Decision Matrix

| Scenario | In-Chat Display | Action |
|----------|-----------------|--------|
| 1 item changed | Full inline card with preview | [View →] opens detail page |
| 2-3 items changed | Expandable card group | Each has [View →], group has [View All →] |
| 4+ items changed | Summary card only | "N items updated" + [Review All →] |
| Work output created | Preview with body snippet | [Full Output →] to panel/page |
| Recipe running | Progress indicator | Persists, updates real-time |

### Layout Evolution

#### Current (Tool-First)
```
┌────────────────────────────┬─────────────────┐
│     Main Content           │   TP Sidebar    │
│     (Context, Tickets)     │   (400-480px)   │
│     flex-1                 │   fixed width   │
└────────────────────────────┴─────────────────┘
```

#### Target (Chat-First)
```
┌─────────────────────────────────────────────────┐
│  Nav: [Overview] [Context] [Tickets] [Agents]   │
├────────────────────────────┬────────────────────┤
│                            │                    │
│  TP Chat (Primary)         │  Detail Panel     │
│  - Messages                │  (Contextual)     │
│  - Embedded cards          │                    │
│  - Full interaction        │  Opens when:      │
│                            │  - Click card     │
│  75% width                 │  - Deep action    │
│                            │  25% width        │
└────────────────────────────┴────────────────────┘
```

---

## 7. Type Extensions

### Backend (Python)

```python
@dataclass
class TPContextChangeRich:
    item_type: str
    action: Literal['written', 'proposed', 'unknown']
    item_id: Optional[str] = None
    title: Optional[str] = None
    tier: Optional[Literal['foundation', 'working', 'ephemeral']] = None
    preview: Optional[str] = None  # First 100 chars

@dataclass
class TPWorkOutputPreview:
    id: str
    output_type: str
    title: Optional[str] = None
    body_preview: Optional[str] = None  # First 200 chars
    supervision_status: Literal['pending_review', 'approved', 'rejected']
    confidence: Optional[float] = None

@dataclass
class TPRecipeExecution:
    recipe_slug: str
    ticket_id: str
    status: Literal['queued', 'running', 'completed', 'failed']
    progress_pct: Optional[int] = None
```

### Frontend (TypeScript)

```typescript
// lib/types/thinking-partner.ts

interface TPContextChange {
  item_type: string;
  action: 'written' | 'proposed' | 'unknown';
  item_id?: string;
  title?: string;
  tier?: 'foundation' | 'working' | 'ephemeral';
  preview?: string;
}

interface TPWorkOutputPreview {
  id: string;
  output_type: string;
  title?: string;
  body_preview?: string;
  supervision_status: 'pending_review' | 'approved' | 'rejected';
  confidence?: number;
}

interface TPRecipeExecution {
  recipe_slug: string;
  ticket_id: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
  progress_pct?: number;
}

interface TPMessage {
  // ... existing fields
  context_changes?: TPContextChange[];
  work_outputs?: TPWorkOutputPreview[];
  recipe_execution?: TPRecipeExecution;
}
```

---

## 8. Component Architecture

### New Components

```
work-platform/web/components/thinking/chat-cards/
├── ContextChangeCard.tsx      # Single context item change
├── ContextChangesGroup.tsx    # Multi-item with expand/collapse
├── WorkOutputCard.tsx         # Work output preview
├── WorkOutputCarousel.tsx     # Multiple outputs horizontal scroll
├── RecipeProgressCard.tsx     # Running recipe with progress
├── ExecutionStepsTimeline.tsx # Collapsible step timeline
└── index.ts                   # Barrel export
```

### Integration Point

```tsx
// In TPMessageCard.tsx, after message text

{/* Tool calls - existing */}
{message.tool_calls && <ToolCallsSection calls={message.tool_calls} />}

{/* NEW: Context changes */}
{message.context_changes?.length > 0 && (
  <ContextChangesGroup
    changes={message.context_changes}
    onNavigate={handleNavigate}
  />
)}

{/* NEW: Work outputs */}
{message.work_outputs?.length > 0 && (
  <WorkOutputCarousel
    outputs={message.work_outputs}
    onViewFull={handleViewOutput}
  />
)}

{/* NEW: Recipe progress */}
{message.recipe_execution && (
  <RecipeProgressCard
    execution={message.recipe_execution}
    onTrack={handleTrackRecipe}
  />
)}
```

---

## 9. Streaming & Real-Time

### Streaming Persistence

Current: Messages saved post-execution
Target: Save message chunks as they stream

```python
async def stream_tp_response(session_id: str, user_message: str):
    # Create message record immediately
    message_id = await create_pending_message(session_id)

    accumulated_content = ""
    async for chunk in tp_agent.stream_response(user_message):
        accumulated_content += chunk.text

        # Periodic persistence (every 500 chars or 2s)
        if should_persist(accumulated_content):
            await update_message_content(message_id, accumulated_content)

        yield chunk

    # Final persistence with full metadata
    await finalize_message(message_id, accumulated_content, metadata)
```

### Real-Time Updates

- Recipe progress: WebSocket push to frontend
- Context changes: Supabase realtime subscription
- Work output creation: Push notification to chat

### Optimistic UI

```typescript
// When user submits context write
const handleContextWrite = async (data: ContextWriteRequest) => {
  // Optimistic: Show pending card immediately
  addOptimisticContextChange({
    ...data,
    status: 'pending',
    optimistic: true
  });

  // Actual API call
  const result = await writeContext(data);

  // Replace optimistic with real
  replaceOptimisticWithReal(result);
};
```

---

## 10. Implementation Phases

### Phase 1: Foundation (Tech Debt + Types)

**Goal**: Clean substrate_blocks debt, extend types for rich displays

**Tasks**:
1. Migrate `substrate_blocks` → `knowledge_context` in agent layer
2. Add dual-format parsing in recipe_tools.py
3. Extend TPMessage types with rich metadata
4. Add TPContextChangeRich and TPWorkOutputPreview types

**Files**:
- `work-platform/api/src/agents/base_agent.py`
- `work-platform/api/src/agents/recipe_tools.py`
- `work-platform/api/src/agents/content_agent.py`
- `work-platform/api/src/agents/research_agent.py`
- `work-platform/api/src/agents/reporting_agent.py`
- `work-platform/web/lib/types/thinking-partner.ts`

### Phase 2: In-Chat Display Components

**Goal**: Build card components for rich in-chat displays

**Tasks**:
1. Create ContextChangeCard component
2. Create ContextChangesGroup with expand/collapse
3. Create WorkOutputCard component
4. Create WorkOutputCarousel for multiple outputs
5. Create RecipeProgressCard component
6. Integrate into TPMessageCard

**Files**:
- `work-platform/web/components/thinking/chat-cards/*`
- `work-platform/web/components/thinking/TPMessageList.tsx`

### Phase 3: Layout Transformation

**Goal**: Shift to chat-primary layout with detail panel

**Tasks**:
1. Create ChatFirstLayout component
2. Add sliding detail panel
3. Implement tab-based quick access bar
4. Wire navigation from cards to panel

**Files**:
- `work-platform/web/app/projects/[id]/layout.tsx`
- `work-platform/web/components/thinking/ChatFirstLayout.tsx`
- `work-platform/web/components/thinking/DetailPanel.tsx`

### Phase 4: Streaming & Real-Time

**Goal**: Improve perceived performance and real-time updates

**Tasks**:
1. Implement streaming message persistence
2. Add recipe progress real-time updates
3. Implement optimistic UI for context writes
4. Add push notifications for work outputs

**Files**:
- `work-platform/api/src/app/routes/thinking_partner.py`
- `work-platform/web/hooks/useTPChat.ts`
- `work-platform/web/hooks/useTPRealtime.ts`

### Phase 5: Optimization

**Goal**: Reduce costs and improve efficiency

**Tasks**:
1. Implement model tiering (Haiku for simple queries)
2. Verify and enhance prompt caching
3. Add session checkpoint hooks
4. Implement context snapshot compression hooks

**Files**:
- `work-platform/api/src/agents/thinking_partner_agent.py`
- `work-platform/api/src/clients/anthropic_client.py`

---

## 11. Success Metrics

### Performance
- TP response time: <2s for simple queries (currently ~3-5s)
- Streaming first token: <500ms
- Context card render: <100ms

### Cost
- 30% reduction in tokens per session via prompt caching
- 20% reduction via model tiering for simple queries

### UX
- Users can complete 80% of tasks without leaving chat
- Detail panel used for <20% of interactions (deep dives only)
- Session lengths increase (users engage more, not abandon)

---

## 12. Open Questions for Future Iterations

1. **Session Summarization Trigger**: What's the right message count threshold?
2. **Context Card Interactivity**: Should cards support inline editing?
3. **Recipe Progress Granularity**: How detailed should step tracking be?
4. **Multi-Agent Visibility**: How to show parallel agent execution?

---

## Appendix A: Reference Patterns

### Claude Artifacts Pattern
- Dual-pane: chat left, artifact right
- Trigger: >15 lines, self-contained content
- Actions: view, copy, download, edit

### ChatGPT Apps SDK Patterns
- Inline cards: structured data, max 2 actions
- Carousels: 3-8 items horizontal scroll
- Fullscreen: rich media expansion
- Picture-in-Picture: persistent floating window

### YARNNN Existing Patterns (Leverage)
- ContextItemDetailClient: Bento-box layout
- ContextReadinessCard: Expandable summary
- WorkTicketCard: Status badges + metadata
- StandardizedCard: Variant system (default/elevated/intelligence)

---

## Appendix B: File Reference

### Agent Layer
- [base_agent.py](../../work-platform/api/src/agents/base_agent.py)
- [thinking_partner_agent.py](../../work-platform/api/src/agents/thinking_partner_agent.py)
- [context_tools.py](../../work-platform/api/src/agents/tools/context_tools.py)
- [recipe_tools.py](../../work-platform/api/src/agents/tools/recipe_tools.py)

### Frontend Components
- [TPChatInterface.tsx](../../work-platform/web/components/thinking/TPChatInterface.tsx)
- [TPMessageList.tsx](../../work-platform/web/components/thinking/TPMessageList.tsx)
- [LiveContextPane.tsx](../../work-platform/web/components/thinking/LiveContextPane.tsx)
- [ContextItemDetailClient.tsx](../../work-platform/web/app/projects/[id]/context/[itemId]/ContextItemDetailClient.tsx)

### Types
- [thinking-partner.ts](../../work-platform/web/lib/types/thinking-partner.ts)

### Related Documentation
- [TP_CONFIGURATION_AUDIT_2025_11_21.md](./TP_CONFIGURATION_AUDIT_2025_11_21.md)
- [THINKING_PARTNER.md](../canon/THINKING_PARTNER.md)
- [YARNNN_PLATFORM_CANON_V4.md](../canon/YARNNN_PLATFORM_CANON_V4.md)
