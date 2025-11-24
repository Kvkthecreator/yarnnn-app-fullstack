# Agent Execution Architecture (Clean, Singular Approach)

**Last Updated**: 2025-11-24
**Status**: ✅ Cleaned up - no legacy paths

## Overview

This document describes the **singular, clean execution architecture** for YARNNN work platform agents. All legacy dual-path approaches have been removed.

## Execution Paths

### Path 1: Direct Workflow Invocation (Deterministic)
**Use Case**: Testing specialist agents individually, predictable workflows

```
Frontend
  ↓
POST /work/research/execute
POST /work/content/execute
POST /work/reporting/execute
  ↓
AgentSession.get_or_create() (persistent)
  ↓
Agent SDK (research_sdk.deep_dive, content_sdk.create, reporting_sdk.generate)
  ↓
Work Outputs
```

**Files**:
- `app/routes/workflow_research.py`
- `app/routes/workflow_reporting.py`
- Agent-specific methods called directly

### Path 2: Work Ticket Execution (Project-Based)
**Use Case**: Work tickets created via project scaffolding

```
Frontend
  ↓
POST /projects/{id}/work-sessions/{ticket_id}/execute
  ↓
services/work_session_executor.py
  ↓
Fetches pre-scaffolded agent_session from DB
  ↓
Creates agent via agent_sdk_client.create_agent()
  ↓
Calls agent-specific method (deep_dive, create, generate, execute_recipe)
  ↓
Work Outputs
```

**Files**:
- `app/routes/project_work_tickets.py` (endpoint)
- `services/work_session_executor.py` (orchestration)
- `services/agent_sdk_client.py` (agent factory only)

### Path 3: TP Orchestration (Future)
**Use Case**: Intelligent routing via Thinking Partner agent

```
Frontend
  ↓
POST /chat/thinking-partner
  ↓
TP analyzes request
  ↓
Delegates to workflow routes (internally)
  ↓
Specialist agent executes
  ↓
TP synthesizes response
```

**Status**: Planned, not yet implemented

## Agent-Specific Methods

Each agent type has its own execution methods:

| Agent Type | Primary Method | Alternative Method | Parameters |
|-----------|---------------|-------------------|-----------|
| Research | `deep_dive(topic, claude_session_id)` | - | topic, session_id |
| Content | `create(brief, platform, tone, claude_session_id)` | - | brief, platform, tone, session_id |
| Reporting | `generate(report_type, format, topic, claude_session_id)` | `execute_recipe(recipe, parameters, session_id)` | report_type/recipe, format, topic/params, session_id |

**No generic `execute()` method** - each agent has domain-specific methods.

## Key Components

### AgentSession (Persistent Identity)
- **Location**: `shared/session.py`
- **Purpose**: Persistent conversation context
- **Scope**: One per (basket_id, agent_type)
- **Created**: During project scaffolding
- **Contains**: user_id, basket_id, workspace_id, claude_session_id

### WorkTicket (Ephemeral Tracking)
- **Location**: Database `work_tickets` table
- **Purpose**: Track individual execution requests
- **Scope**: One per work request
- **Contains**: work_request_id, agent_session_id, status, metadata
- **Used for**: Output tagging, status tracking, execution history

### AgentSDKClient (Factory Only)
- **Location**: `services/agent_sdk_client.py`
- **Purpose**: Agent instantiation + context provision
- **Methods**:
  - `create_agent()` - Factory for creating agent instances
  - `provision_context_envelope()` - Fetch pre-generated context from substrate
- **NOT for**: Generic execution (removed)

### WorkTicketExecutor (Orchestration)
- **Location**: `services/work_session_executor.py`
- **Purpose**: Orchestrate work ticket execution lifecycle
- **Responsibilities**:
  - Fetch pre-scaffolded agent_session
  - Create agent via AgentSDKClient
  - Call agent-specific execution method
  - Save work_outputs to database
  - Update work_ticket status

## Removed Legacy Code

The following were removed to eliminate confusion:

❌ **app/work/executor.py** - Duplicate WorkTicketExecutor (unused)
❌ **agent_sdk_client.execute_task()** - Generic execution method
❌ **agent_sdk_client._parse_agent_output()** - Generic output parser
❌ **agent_sdk_client._detect_checkpoint_need()** - Generic checkpoint detection

**Total lines removed**: ~711 lines

## Architecture Principles

1. **No Generic Abstractions**: Each agent has domain-specific methods
2. **Session Persistence**: Agent sessions survive across multiple work requests
3. **Ephemeral Tracking**: Work tickets track individual executions
4. **Direct Invocation**: Workflow routes call agent methods directly
5. **Single Path Per Use Case**: No dual approaches for the same outcome

## Testing Strategy

**Phase 1** (Current): Test specialist agents individually
- ✅ Reporting agent (PPT generation) - FIRST
- ⏳ Research agent
- ⏳ Content agent

**Phase 2** (Future): Add TP orchestration layer
- TP delegates to proven workflows
- Both paths (direct + TP) coexist

## Future Enhancements

1. **Recipe System**: Parameterized workflow templates (partially implemented for reporting)
2. **TP Intelligence**: Smart routing based on request analysis
3. **Multi-Step Workflows**: Research → Content → Reporting chains
4. **Checkpoint System**: Human-in-the-loop for high-stakes decisions

---

**Maintained by**: Architecture team
**Questions**: See YARNNN docs or ask in #engineering
