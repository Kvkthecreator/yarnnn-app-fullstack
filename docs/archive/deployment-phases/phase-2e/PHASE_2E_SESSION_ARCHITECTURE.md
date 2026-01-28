# Phase 2e: Agent Session Architecture

**Version**: 1.0
**Date**: 2025-11-19
**Status**: Proposed
**Purpose**: Clarify agent session management and align with Claude SDK patterns

---

## Problem Statement

**Architectural Confusion**: Current `work_sessions` table conflates two distinct concepts:
1. **Claude SDK Sessions** (persistent agent instances with conversation history)
2. **Work Execution Records** (transient records of specific tasks completed)

**Symptoms**:
- `agent_session_id` field exists but is never populated
- No clear way to query "get the research agent session for this basket"
- Confusion between "session state" and "work history"
- Terminology mismatch with official Claude SDK documentation

---

## Proposed Solution: Two-Table Architecture

### **Table 1: agent_sessions (NEW)**

**Purpose**: Persistent agent instances (one per basket + agent_type)

**Schema**:
```sql
CREATE TABLE agent_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Identity
  basket_id UUID NOT NULL REFERENCES baskets(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  agent_type TEXT NOT NULL,  -- research, content, reporting

  -- Claude SDK Integration
  sdk_session_id TEXT,  -- Claude SDK session identifier for resume
  conversation_history JSONB DEFAULT '[]'::jsonb,

  -- Session State
  state JSONB DEFAULT '{}'::jsonb,  -- Agent-specific state
  last_active_at TIMESTAMPTZ DEFAULT now(),

  -- Metadata
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  created_by_user_id UUID REFERENCES auth.users(id),
  metadata JSONB DEFAULT '{}'::jsonb,

  -- Constraints
  UNIQUE(basket_id, agent_type)  -- ONE session per agent type per basket
);

CREATE INDEX idx_agent_sessions_basket ON agent_sessions(basket_id);
CREATE INDEX idx_agent_sessions_type ON agent_sessions(agent_type);
CREATE INDEX idx_agent_sessions_active ON agent_sessions(last_active_at DESC);
```

**Key Insight**: This table has **UNIQUE constraint** on (basket_id, agent_type) - only one research agent session per basket.

---

### **Table 2: work_tickets (RENAMED from work_sessions)**

**Purpose**: Execution records (many per agent_session)

**Schema**:
```sql
-- Rename existing table
ALTER TABLE work_sessions RENAME TO work_tickets;

-- Add agent_session_id foreign key
ALTER TABLE work_tickets
  ADD COLUMN agent_session_id UUID REFERENCES agent_sessions(id) ON DELETE SET NULL;

-- Add index
CREATE INDEX idx_work_tickets_session ON work_tickets(agent_session_id);

-- Note: agent_session_id can be NULL for stateless executions
```

**Key Changes**:
- ✅ Renamed: `work_sessions` → `work_tickets`
- ✅ Links to `agent_sessions` via FK
- ✅ Null `agent_session_id` = stateless execution (no session persistence)

---

## Data Model Relationships

```
agent_sessions (1)
  ↓
work_tickets (N)
  ↓
work_outputs (N) [in substrate-API]
  ↓
work_checkpoints (N)
work_iterations (N)
```

**Key Points**:
- One agent_session can have many work_tickets
- One work_ticket can have many work_outputs
- Agent session persists across multiple work tickets
- Work tickets are archived after completion
- Agent sessions persist indefinitely (or until user deletes)

---

## Usage Patterns

### **Pattern 1: Get or Create Agent Session**

```python
async def get_or_create_agent_session(
    basket_id: str,
    agent_type: str,
    workspace_id: str,
    user_id: str
) -> AgentSession:
    """Get existing agent session or create new one."""

    # Try to get existing session
    session = await db.query(
        "SELECT * FROM agent_sessions WHERE basket_id = $1 AND agent_type = $2",
        basket_id, agent_type
    )

    if session:
        # Update last_active_at
        await db.execute(
            "UPDATE agent_sessions SET last_active_at = now() WHERE id = $1",
            session.id
        )
        return session

    # Create new session
    return await db.query_one(
        """
        INSERT INTO agent_sessions (basket_id, workspace_id, agent_type, created_by_user_id)
        VALUES ($1, $2, $3, $4)
        RETURNING *
        """,
        basket_id, workspace_id, agent_type, user_id
    )
```

### **Pattern 2: Create Work Ticket**

```python
async def create_work_ticket(
    agent_session_id: Optional[str],  # Null for stateless
    basket_id: str,
    workspace_id: str,
    task_intent: str,
    task_type: str,
    user_id: str
) -> WorkTicket:
    """Create new work ticket for execution."""

    return await db.query_one(
        """
        INSERT INTO work_tickets (
            agent_session_id,
            basket_id,
            workspace_id,
            task_intent,
            task_type,
            initiated_by_user_id,
            status
        ) VALUES ($1, $2, $3, $4, $5, $6, 'initialized')
        RETURNING *
        """,
        agent_session_id, basket_id, workspace_id, task_intent, task_type, user_id
    )
```

### **Pattern 3: Resume Agent Session**

```python
async def resume_agent_from_session(
    agent_session: AgentSession,
    knowledge_modules: str,
) -> ResearchAgentSDK:
    """Resume agent from existing session."""

    if agent_session.sdk_session_id:
        # Resume with conversation history
        agent = await ResearchAgentSDK.resume(
            session_id=agent_session.sdk_session_id,
            basket_id=agent_session.basket_id,
            workspace_id=agent_session.workspace_id,
            knowledge_modules=knowledge_modules,
        )
    else:
        # First time - create new agent
        agent = ResearchAgentSDK(
            basket_id=agent_session.basket_id,
            workspace_id=agent_session.workspace_id,
            work_session_id=None,  # Will be set when work_ticket created
            knowledge_modules=knowledge_modules,
        )

        # Store SDK session_id for future resumes
        # (Requires SDK to expose get_session_id() method)
        if hasattr(agent, 'get_session_id'):
            sdk_session_id = agent.get_session_id()
            await update_agent_session(
                agent_session.id,
                sdk_session_id=sdk_session_id
            )

    return agent
```

---

## Query Examples

### **Get Agent Session**
```sql
-- Get the research agent session for a basket
SELECT * FROM agent_sessions
WHERE basket_id = '5004b9e1-67f5-4955-b028-389d45b1f5a4'
  AND agent_type = 'research';
-- Returns: 1 row (or 0 if not exists)
```

### **Get Work History**
```sql
-- Get all work tickets for an agent session
SELECT * FROM work_tickets
WHERE agent_session_id = 'session-uuid'
ORDER BY created_at DESC;
-- Returns: N rows (all work executed in this session)
```

### **Get Recent Work Across All Agents**
```sql
-- Get recent work tickets for a basket
SELECT
  wt.*,
  ags.agent_type,
  ags.sdk_session_id
FROM work_tickets wt
LEFT JOIN agent_sessions ags ON ags.id = wt.agent_session_id
WHERE wt.basket_id = '5004b9e1-67f5-4955-b028-389d45b1f5a4'
ORDER BY wt.created_at DESC
LIMIT 20;
```

---

## Migration Path

### **Phase 2e.1: Create agent_sessions table**
- Create new table with schema above
- Add indexes and RLS policies

### **Phase 2e.2: Rename work_sessions → work_tickets**
- Rename table
- Add agent_session_id column (nullable)
- Update all code references

### **Phase 2e.3: Update orchestration to use agent_sessions**
- get_or_create_agent_session() before creating work_ticket
- Link work_ticket to agent_session
- Populate sdk_session_id when available

### **Phase 2e.4: Implement session resume (future)**
- Add resume() classmethod to agent SDKs
- Use sdk_session_id to resume conversation history
- Enable persistent agent sessions

---

## Benefits

1. **Conceptual Clarity**: Sessions ≠ Tickets (different entities, different lifecycles)
2. **Aligned with Claude SDK**: Matches official session model
3. **Correct Cardinality**: UNIQUE constraint on agent_sessions
4. **Clear Queries**: No ambiguity in "get session" vs "get work history"
5. **Future-Ready**: Enables session resume, forking, conversation history

---

## Open Questions

1. **Session Expiry**: Should agent_sessions expire after inactivity? (e.g., 30 days)
2. **Session Forking**: Do we need session forking (experimental branches)?
3. **Conversation History**: Store in JSONB or separate table?
4. **Stateless Support**: Keep supporting NULL agent_session_id? (Yes for now)

---

**Next Steps**: Review and approve architecture, then proceed with Phase 2e.1 implementation.

---

**End of Document**
