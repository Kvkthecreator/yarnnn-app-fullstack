# Thinking Partner Implementation Plan

**Version**: 1.0
**Date**: 2025-12-04
**Status**: Draft
**Dependencies**: Context Items Unified (v3.0), tp_messages table

---

## Overview

Thinking Partner (TP) is a conversational AI agent that helps users explore ideas, manage context, and orchestrate work recipes. Unlike task-oriented agents (Research, Content, Reporting), TP is:

- **Conversational**: Maintains chat history, supports back-and-forth dialogue
- **Context-Aware**: Reads and writes to `context_items` with full taxonomy access
- **Orchestrating**: Can trigger other agents/recipes on user's behalf
- **Governance-Aware**: Foundation tier writes go to governance queue for approval

---

## Architecture

### System Diagram

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           FRONTEND                                       │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│   TPChatInterface                                                        │
│   ├── useTPSession (new hook)                                            │
│   ├── useTPMessages (new hook)                                           │
│   └── useContextItems (existing)                                         │
│                                                                          │
│   Calls: POST /api/tp/chat (streaming)                                   │
│                                                                          │
└────────────────────────────────────────────────────────────────┬────────┘
                                                                 │
                                                                 ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                           BACKEND (work-platform/api)                    │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│   /api/tp/chat                                                           │
│   ├── Creates/resumes tp_session                                         │
│   ├── Saves user message to tp_messages                                  │
│   ├── Provisions context via ContextProvisioner                          │
│   ├── Executes ThinkingPartnerAgent                                      │
│   ├── Streams response                                                   │
│   └── Saves assistant message to tp_messages                             │
│                                                                          │
│   ThinkingPartnerAgent                                                   │
│   ├── SYSTEM_PROMPT with context awareness                               │
│   ├── Tools:                                                             │
│   │   ├── read_context(item_type, fields?)                               │
│   │   ├── write_context(item_type, content) → governance if foundation   │
│   │   ├── list_context() → all context items with completeness           │
│   │   ├── list_recipes() → available work recipes                        │
│   │   ├── trigger_recipe(slug, params) → create work_ticket              │
│   │   └── emit_work_output(type, content) → existing tool                │
│   └── AnthropicDirectClient with streaming                               │
│                                                                          │
└────────────────────────────────────────────────────────────────┬────────┘
                                                                 │
                                                                 ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                           DATABASE                                       │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│   tp_sessions              tp_messages                                   │
│   ├── id                   ├── id                                        │
│   ├── basket_id            ├── session_id → tp_sessions                  │
│   ├── workspace_id         ├── role (user/assistant/system)              │
│   ├── status               ├── content                                   │
│   └── message_count        ├── work_output_ids[]                         │
│                            └── context_snapshot                          │
│                                                                          │
│   context_items (existing)                                               │
│   ├── id, basket_id, tier                                                │
│   ├── item_type, item_key                                                │
│   └── content, status                                                    │
│                                                                          │
│   governance_proposals (for foundation writes)                           │
│   ├── id, basket_id                                                      │
│   ├── proposal_type: 'context_item'                                      │
│   ├── proposed_changes: JSONB                                            │
│   └── status: pending/approved/rejected                                  │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Phase 1: Core TP Chat (MVP)

### 1.1 Backend: TP Routes Rewrite

**File**: `work-platform/api/src/app/routes/thinking_partner.py`

Replace the current "migration notice" routes with working implementation:

```python
@router.post("/chat", response_model=TPChatResponse)
async def tp_chat(
    request: TPChatRequest,
    user: dict = Depends(verify_jwt)
):
    """
    Send message to Thinking Partner.

    Flow:
    1. Get or create session
    2. Save user message
    3. Provision context
    4. Execute TP agent
    5. Save assistant message
    6. Return response with streaming
    """
    # Implementation
```

**New Endpoints**:
- `POST /tp/chat` - Send message (streaming)
- `GET /tp/sessions` - List user's sessions
- `GET /tp/sessions/{id}` - Get session with messages
- `DELETE /tp/sessions/{id}` - Archive session

### 1.2 Backend: ThinkingPartnerAgent Tools

**File**: `work-platform/api/src/agents/thinking_partner_agent.py`

Add context-aware tools:

```python
class ThinkingPartnerAgent(BaseAgent):
    AGENT_TYPE = "thinking_partner"

    TOOLS = [
        "read_context",      # Read context item by type
        "write_context",     # Write/propose context update
        "list_context",      # List all context items
        "list_recipes",      # List available recipes
        "trigger_recipe",    # Queue recipe execution
        "emit_work_output",  # Capture insights (existing)
    ]
```

**Tool Definitions**:

```python
# read_context
{
    "name": "read_context",
    "description": "Read a context item by type. Returns content, completeness, and tier.",
    "input_schema": {
        "type": "object",
        "properties": {
            "item_type": {"type": "string", "description": "Type: problem, customer, vision, brand, competitor, etc."},
            "fields": {"type": "array", "items": {"type": "string"}, "description": "Optional: specific fields to return"}
        },
        "required": ["item_type"]
    }
}

# write_context
{
    "name": "write_context",
    "description": "Create or update a context item. Foundation tier items require user approval.",
    "input_schema": {
        "type": "object",
        "properties": {
            "item_type": {"type": "string"},
            "content": {"type": "object", "description": "Field values to set"},
            "item_key": {"type": "string", "description": "For non-singleton types like competitor"}
        },
        "required": ["item_type", "content"]
    }
}

# list_context
{
    "name": "list_context",
    "description": "List all context items for the current basket, grouped by tier.",
    "input_schema": {
        "type": "object",
        "properties": {}
    }
}

# list_recipes
{
    "name": "list_recipes",
    "description": "List available work recipes that can be triggered.",
    "input_schema": {
        "type": "object",
        "properties": {}
    }
}

# trigger_recipe
{
    "name": "trigger_recipe",
    "description": "Queue a work recipe for execution. Creates a work_ticket.",
    "input_schema": {
        "type": "object",
        "properties": {
            "recipe_slug": {"type": "string"},
            "parameters": {"type": "object"}
        },
        "required": ["recipe_slug"]
    }
}
```

### 1.3 Frontend: TP Hooks

**New File**: `work-platform/web/hooks/useTPSession.ts`

```typescript
export function useTPSession(basketId: string) {
  // Create/resume session
  // Load message history
  // Handle streaming responses
}

export function useTPMessages(sessionId: string) {
  // Fetch messages for session
  // Real-time updates via Supabase
}
```

### 1.4 Frontend: Update TPChatInterface

Modify `TPChatInterface.tsx` to:
- Use `useTPSession` instead of localStorage
- Support streaming responses
- Show tool call indicators
- Display context changes in UI

---

## Phase 2: Governance Integration

### 2.1 Foundation Write Flow

When TP writes to a foundation-tier context item:

1. **TP calls `write_context(item_type="problem", content={...})`**
2. **Tool handler detects tier = foundation**
3. **Creates governance_proposal instead of direct write**:
   ```python
   governance_proposal = {
       "basket_id": basket_id,
       "proposal_type": "context_item",
       "proposed_changes": {
           "item_type": "problem",
           "content": {...},
           "operation": "upsert"
       },
       "source": "thinking_partner",
       "source_session_id": session_id,
       "status": "pending"
   }
   ```
4. **Returns to TP**: "Proposed change to Problem. Awaiting user approval."
5. **User reviews in Governance UI**
6. **On approval**: Context item updated, TP notified

### 2.2 Governance UI

Separate page at `/projects/{id}/governance`:
- List pending proposals
- Show diff of proposed changes
- Approve/reject actions
- History of approved changes

---

## Phase 3: Advanced Features

### 3.1 Context-Aware Prompting

TP's system prompt includes:
- Current context completeness
- Stale items that need refresh
- Available recipes

### 3.2 Specialist Orchestration

TP can delegate to specialists:

```
User: "Research our competitors and update the competitor context"

TP: "I'll research your competitors and propose updates."
    - Calls trigger_recipe("deep_research", {scope: "competitors"})
    - Monitors work_ticket status
    - When complete, calls write_context("competitor", {...})
    - "I've proposed updates to 3 competitors. Please review in Governance."
```

### 3.3 Streaming with Tool Calls

Real-time UI updates:
- Show when TP is "thinking"
- Show tool calls as they happen
- Stream text response
- Highlight context changes

---

## Implementation Order

| Phase | Task | Effort | Dependencies |
|-------|------|--------|--------------|
| 1.1 | TP Routes rewrite | 4h | - |
| 1.2 | TP Agent tools | 4h | 1.1 |
| 1.3 | Frontend hooks | 3h | 1.1 |
| 1.4 | TPChatInterface update | 3h | 1.3 |
| 2.1 | Governance proposal flow | 4h | 1.2 |
| 2.2 | Governance UI | 4h | 2.1 |
| 3.1 | Context-aware prompting | 2h | 1.2 |
| 3.2 | Specialist orchestration | 4h | 3.1 |
| 3.3 | Streaming improvements | 3h | 1.4 |

**Total Estimated Effort**: ~31h (Phase 1: ~14h, Phase 2: ~8h, Phase 3: ~9h)

---

## Testing Strategy

### Unit Tests
- Tool handlers (read_context, write_context, etc.)
- Governance proposal creation
- Session management

### Integration Tests
- Full chat flow with context reads
- Foundation write → governance proposal → approval → update
- Recipe triggering

### Manual Testing
- Conversational flow
- Context completeness guidance
- Governance approval UX

---

## Files to Create/Modify

### New Files
- `work-platform/api/src/agents/tools/context_tools.py` - Context item tools
- `work-platform/web/hooks/useTPSession.ts` - Session management
- `work-platform/web/hooks/useTPMessages.ts` - Message fetching
- `work-platform/web/app/projects/[id]/governance/page.tsx` - Governance UI

### Modified Files
- `work-platform/api/src/app/routes/thinking_partner.py` - Route rewrite
- `work-platform/api/src/agents/thinking_partner_agent.py` - Add tools
- `work-platform/web/components/thinking/TPChatInterface.tsx` - Use new hooks
- `work-platform/web/lib/gateway/ThinkingPartnerGateway.ts` - Update API calls

---

## Success Criteria

1. **MVP (Phase 1)**:
   - User can chat with TP
   - TP can read/write context items
   - Chat history persists in database
   - Basic tool call visibility

2. **Governance (Phase 2)**:
   - Foundation writes create proposals
   - User can approve/reject in UI
   - TP informed of approval status

3. **Full (Phase 3)**:
   - TP orchestrates specialists
   - Context-aware suggestions
   - Smooth streaming experience

---

## Related Documents

- [ADR_CONTEXT_ITEMS_UNIFIED.md](../architecture/ADR_CONTEXT_ITEMS_UNIFIED.md)
- [THINKING_PARTNER_GATEWAY.md](../architecture/THINKING_PARTNER_GATEWAY.md)
- [SUBSTRATE_DATA_TYPES.md](../canon/SUBSTRATE_DATA_TYPES.md)
- [20251204_tp_messages.sql](../../supabase/migrations/20251204_tp_messages.sql)

---

**End of Document**
