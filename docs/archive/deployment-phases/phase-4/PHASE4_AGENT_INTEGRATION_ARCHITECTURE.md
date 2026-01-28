# Phase 4: Agent Integration Architecture & Migration Plan

**Date:** 2025-11-03
**Status:** Planning
**Goal:** Integrate Claude Agent SDK into work-platform with complete sunset of yarnnn-claude-agents repo

---

## Executive Summary

This phase integrates the open-source Claude Agent SDK into work-platform while:
1. ✅ **Preserving Phase 1-3 architecture** (BFF pattern, domain separation)
2. ✅ **Maintaining clean SDK dependency** (updates flow smoothly from open-source)
3. ✅ **Complete sunset of yarnnn-claude-agents** (merge → archive → delete)
4. ✅ **Adapter pattern for architecture alignment** (SDK ↔ substrate-api via substrate_client)

---

## Architecture Overview

### Current State (Phase 3.2)

```
┌─────────────────────────────────────────────┐
│  work-platform/api/                         │
│  - Legacy routes (mixed concerns)           │
│  - substrate_client.py ✅                   │
│  - Some direct DB access (11 files)         │
└────────────────┬────────────────────────────┘
                 │ HTTP (substrate_client.py)
                 ▼
┌─────────────────────────────────────────────┐
│  substrate-api/api/                         │
│  - P0-P4 Agent Pipeline                     │
│  - Memory domain (blocks, docs, embeddings) │
│  - service_to_service_auth.py ✅            │
└─────────────────────────────────────────────┘

External (to be merged):
┌─────────────────────────────────────────────┐
│  yarnnn-claude-agents/ (separate repo)     │
│  - FastAPI deployment service               │
│  - Agent routes (research, content, etc.)   │
│  - Dependencies: claude-agent-sdk (open-source)
└─────────────────────────────────────────────┘
```

### Target Architecture (Phase 4)

```
┌───────────────────────────────────────────────────────────────────┐
│  work-platform/api/ (Agentic Orchestration Layer)                 │
│                                                                    │
│  ┌──────────────────────────────────────────────────────────┐    │
│  │  Agents (from open-source SDK)                           │    │
│  │  pip install claude-agent-sdk                            │    │
│  │  ↓                                                        │    │
│  │  ResearchAgent, ContentCreatorAgent, ReportingAgent      │    │
│  └──────────────────────────────────────────────────────────┘    │
│                           ↓                                        │
│  ┌──────────────────────────────────────────────────────────┐    │
│  │  Adapter Layer (OUR CODE - Phase 1-3 compliant)         │    │
│  │  adapters/                                                │    │
│  │  ├── memory_adapter.py      ← Wraps substrate_client ✅  │    │
│  │  ├── governance_adapter.py  ← Wraps substrate_client ✅  │    │
│  │  └── auth_adapter.py        ← Uses infra/utils/jwt ✅    │    │
│  └──────────────────────────────────────────────────────────┘    │
│                           ↓                                        │
│  ┌──────────────────────────────────────────────────────────┐    │
│  │  clients/substrate_client.py (Phase 3.1) ✅             │    │
│  │  - Circuit breaker, retries, auth                        │    │
│  │  - All HTTP calls to substrate-api                       │    │
│  └──────────────────────────────────────────────────────────┘    │
│                           ↓                                        │
│  ┌──────────────────────────────────────────────────────────┐    │
│  │  Routes (NEW - Work orchestration)                       │    │
│  │  routes/                                                  │    │
│  │  ├── projects.py          ← Project management           │    │
│  │  ├── work_sessions.py     ← Agent work orchestration     │    │
│  │  └── agents_status.py     ← Agent health/config          │    │
│  └──────────────────────────────────────────────────────────┘    │
└────────────────────────┬──────────────────────────────────────────┘
                         │ HTTP/REST (substrate_client.py)
                         ▼
┌───────────────────────────────────────────────────────────────────┐
│  substrate-api/api/ (Memory + P0-P4 Domain) - UNCHANGED          │
│  - Receives HTTP from work-platform                               │
│  - Returns memory/context data                                    │
│  - P0-P4 agent pipeline operations                                │
└───────────────────────────────────────────────────────────────────┘
```

---

## Key Architectural Decisions

### Decision 1: Adapter Pattern for SDK Integration

**Problem:** Open-source SDK expects `YarnnnMemory` and `YarnnnGovernance` providers that make direct API calls. We need to respect Phase 1-3 BFF architecture.

**Solution:** Create adapter layer that translates SDK interfaces → substrate_client calls.

```python
# work-platform/api/src/adapters/memory_adapter.py
from claude_agent_sdk.interfaces import MemoryProvider, Context
from clients.substrate_client import get_substrate_client

class SubstrateMemoryAdapter(MemoryProvider):
    """
    Adapter that makes SDK's MemoryProvider interface compatible
    with our substrate_client (Phase 3 BFF pattern).

    SDK agents → SubstrateMemoryAdapter → substrate_client → substrate-api
    """

    def __init__(self, basket_id: str):
        self.basket_id = basket_id
        self.client = get_substrate_client()

    async def query(self, query: str, filters=None, limit=20) -> List[Context]:
        """SDK interface method → substrate_client call"""
        blocks = self.client.get_basket_blocks(
            self.basket_id,
            states=filters.get("states", ["ACCEPTED", "LOCKED"]) if filters else ["ACCEPTED"],
            limit=limit
        )

        # Convert substrate blocks to SDK Context format
        return [
            Context(
                content=self._format_block(block),
                metadata={
                    "id": block["id"],
                    "semantic_type": block.get("semantic_type"),
                    "state": block.get("state")
                }
            )
            for block in blocks
        ]

    async def store(self, context: Context) -> str:
        """SDK interface method → substrate_client call"""
        result = self.client.create_dump(
            self.basket_id,
            content=context.content,
            metadata=context.metadata
        )
        return result["id"]

    async def get_all(self, filters=None) -> List[Context]:
        """SDK interface method → substrate_client call"""
        return await self.query("", filters=filters, limit=1000)
```

**Benefits:**
- ✅ SDK remains clean dependency (no modifications)
- ✅ Respects Phase 3 BFF pattern (all calls via substrate_client)
- ✅ Updates to SDK flow seamlessly (we only adapt interfaces)
- ✅ Circuit breaker, retries, auth all preserved

### Decision 2: Clean Dependency on Open-Source SDK

**Implementation:**
```toml
# work-platform/api/requirements.txt (ADD)
claude-agent-sdk @ git+https://github.com/Kvkthecreator/claude-agentsdk-opensource.git@main
```

**Update Workflow:**
```bash
# When SDK releases new agents/features:
cd work-platform/api
pip install --upgrade --force-reinstall claude-agent-sdk

# Wire new agents through adapter layer:
# 1. Import new agent from SDK
# 2. Create adapter instance
# 3. Add route in work-platform
```

**SDK Provides (We consume):**
- `claude_agent_sdk.archetypes.ResearchAgent`
- `claude_agent_sdk.archetypes.ContentCreatorAgent`
- `claude_agent_sdk.archetypes.ReportingAgent`
- `claude_agent_sdk.interfaces.MemoryProvider` (interface we implement)
- `claude_agent_sdk.interfaces.GovernanceProvider` (interface we implement)

**We Provide (Adapters):**
- `adapters.SubstrateMemoryAdapter` (implements MemoryProvider)
- `adapters.SubstrateGovernanceAdapter` (implements GovernanceProvider)
- `adapters.AuthAdapter` (uses infra/utils/jwt)

### Decision 3: Complete Sunset of yarnnn-claude-agents

**Migration Steps:**
1. **Copy** relevant code (routes, configs) → work-platform
2. **Adapt** to use our architecture (substrate_client, infra/utils)
3. **Test** end-to-end in work-platform
4. **Archive** yarnnn-claude-agents repo on GitHub
5. **Delete** local clone

**What We Keep:**
- Agent route patterns (adapted to our FastAPI structure)
- Agent configuration patterns (adapted to our env management)
- Testing patterns (adapted to our test structure)

**What We Don't Keep:**
- Separate deployment service (merged into work-platform)
- YarnnnClient (replaced by substrate_client)
- YarnnnMemory/YarnnnGovernance (replaced by our adapters)

---

## Directory Structure (Post-Migration)

```
work-platform/api/
├── src/
│   ├── adapters/                    ← NEW: SDK interface adapters
│   │   ├── __init__.py
│   │   ├── memory_adapter.py        ← MemoryProvider → substrate_client
│   │   ├── governance_adapter.py    ← GovernanceProvider → substrate_client
│   │   └── auth_adapter.py          ← Uses infra/utils/jwt
│   │
│   ├── agents/                      ← NEW: Agent orchestration
│   │   ├── __init__.py
│   │   ├── factory.py               ← Create agent instances with adapters
│   │   └── config/                  ← Agent configurations (YAML)
│   │       ├── research.yaml
│   │       ├── content.yaml
│   │       └── reporting.yaml
│   │
│   ├── clients/
│   │   └── substrate_client.py      ← EXISTING (Phase 3.1) ✅
│   │
│   ├── app/
│   │   ├── routes/
│   │   │   ├── projects.py          ← NEW: Project management
│   │   │   ├── work_sessions.py     ← UPDATE: Agent orchestration
│   │   │   ├── agents_status.py     ← NEW: Agent health/config
│   │   │   └── ... (existing routes)
│   │   │
│   │   └── agent_server.py          ← UPDATE: Add new routes
│   │
│   └── middleware/                   ← EXISTING (Phase 1-3)
│       ├── auth.py
│       └── correlation.py
│
├── requirements.txt                 ← UPDATE: Add claude-agent-sdk
└── tests/
    ├── test_adapters.py             ← NEW: Test adapter layer
    ├── test_agent_integration.py    ← NEW: End-to-end agent tests
    └── ... (existing tests)

infra/                               ← EXISTING (Phase 2) - SHARED
├── utils/
│   ├── jwt.py                       ← Used by auth_adapter
│   └── supabase_client.py
└── substrate/
    └── models.py

substrate-api/api/                   ← EXISTING - NO CHANGES NEEDED
└── ... (P0-P4 pipeline + memory domain)
```

---

## Implementation Plan

### Step 1: Install SDK Dependency ✅

```bash
cd work-platform/api

# Add to requirements.txt
echo "claude-agent-sdk @ git+https://github.com/Kvkthecreator/claude-agentsdk-opensource.git@main" >> requirements.txt

# Install
pip install -r requirements.txt
```

### Step 2: Create Adapter Layer 🔨

**File 1: [memory_adapter.py](work-platform/api/src/adapters/memory_adapter.py)** (NEW)
```python
"""Memory adapter: SDK MemoryProvider → substrate_client"""
from typing import List, Dict, Any, Optional
from claude_agent_sdk.interfaces import MemoryProvider, Context
from clients.substrate_client import get_substrate_client

class SubstrateMemoryAdapter(MemoryProvider):
    """Adapts substrate_client to SDK's MemoryProvider interface."""

    def __init__(self, basket_id: str):
        self.basket_id = basket_id
        self.client = get_substrate_client()

    async def query(
        self,
        query: str,
        filters: Optional[Dict[str, Any]] = None,
        limit: int = 20
    ) -> List[Context]:
        """Query substrate via HTTP (substrate_client)."""
        # TODO: Add semantic search endpoint to substrate-api
        # For now, get blocks and filter
        blocks = self.client.get_basket_blocks(
            self.basket_id,
            states=filters.get("states") if filters else ["ACCEPTED"],
            limit=limit
        )

        return [self._block_to_context(block) for block in blocks]

    async def store(self, context: Context) -> str:
        """Store context in substrate via HTTP."""
        result = self.client.create_dump(
            self.basket_id,
            content=context.content,
            metadata=context.metadata or {}
        )
        return result["id"]

    async def get_all(
        self,
        filters: Optional[Dict[str, Any]] = None
    ) -> List[Context]:
        """Get all context items."""
        return await self.query("", filters=filters, limit=10000)

    def _block_to_context(self, block: dict) -> Context:
        """Convert substrate block to SDK Context."""
        return Context(
            content=f"{block.get('title', '')}\n\n{block.get('body', '')}",
            metadata={
                "id": block["id"],
                "semantic_type": block.get("semantic_type"),
                "state": block.get("state"),
                "anchor_role": block.get("anchor_role")
            }
        )
```

**File 2: [governance_adapter.py](work-platform/api/src/adapters/governance_adapter.py)** (NEW)
```python
"""Governance adapter: SDK GovernanceProvider → substrate_client"""
from typing import Dict, Any, Optional
from claude_agent_sdk.interfaces import GovernanceProvider
from clients.substrate_client import get_substrate_client

class SubstrateGovernanceAdapter(GovernanceProvider):
    """Adapts substrate_client to SDK's GovernanceProvider interface."""

    def __init__(self, basket_id: str, user_id: Optional[str] = None):
        self.basket_id = basket_id
        self.user_id = user_id
        self.client = get_substrate_client()

    async def propose_change(
        self,
        change_type: str,
        data: Dict[str, Any],
        confidence: float = 0.7
    ) -> str:
        """Propose change via substrate-api."""
        # Map SDK change types to substrate operations
        ops = self._map_change_to_ops(change_type, data)

        # TODO: Add create_proposal endpoint to substrate_client
        # For now, use initiate_work with proposal mode
        result = self.client.initiate_work(
            basket_id=self.basket_id,
            work_mode="governance_proposal",
            payload={
                "ops": ops,
                "confidence": confidence
            },
            user_id=self.user_id
        )
        return result["work_id"]

    async def check_approval(self, proposal_id: str) -> bool:
        """Check if proposal is approved."""
        # TODO: Add get_proposal_status to substrate_client
        status = self.client.get_work_status(proposal_id)
        return status.get("status") == "approved"

    async def commit_change(self, proposal_id: str) -> bool:
        """Commit approved change."""
        try:
            # Retry work will commit if approved
            self.client.retry_work(proposal_id)
            return True
        except Exception:
            return False

    def _map_change_to_ops(self, change_type: str, data: Dict[str, Any]) -> list:
        """Map SDK change type to substrate operations."""
        if change_type == "add_block":
            return [{
                "op": "create",
                "type": "block",
                "data": data
            }]
        elif change_type == "update_block":
            return [{
                "op": "update",
                "type": "block",
                "id": data["id"],
                "data": data
            }]
        # ... more mappings
        return []
```

**File 3: [auth_adapter.py](work-platform/api/src/adapters/auth_adapter.py)** (NEW)
```python
"""Auth adapter: Uses infra/utils/jwt (Phase 1-3 compliant)"""
import sys
import os
sys.path.append(os.path.join(os.path.dirname(__file__), "../../../.."))

from infra.utils.jwt import decode_jwt, verify_jwt
from typing import Optional, Dict, Any

class AuthAdapter:
    """Adapter for authentication using Phase 1-3 infrastructure."""

    @staticmethod
    def verify_token(token: str) -> Optional[Dict[str, Any]]:
        """Verify JWT token using infra/utils/jwt."""
        try:
            return verify_jwt(token)
        except Exception:
            return None

    @staticmethod
    def decode_token(token: str) -> Optional[Dict[str, Any]]:
        """Decode JWT token using infra/utils/jwt."""
        try:
            return decode_jwt(token)
        except Exception:
            return None

    @staticmethod
    def get_user_id(token: str) -> Optional[str]:
        """Extract user ID from JWT token."""
        payload = AuthAdapter.decode_token(token)
        return payload.get("sub") if payload else None

    @staticmethod
    def get_workspace_id(token: str) -> Optional[str]:
        """Extract workspace ID from JWT token."""
        payload = AuthAdapter.decode_token(token)
        return payload.get("workspace_id") if payload else None
```

### Step 3: Create Agent Factory 🔨

**File: [agents/factory.py](work-platform/api/src/agents/factory.py)** (NEW)
```python
"""Agent factory: Creates SDK agents with our adapters."""
import os
import yaml
from pathlib import Path
from claude_agent_sdk.archetypes import ResearchAgent, ContentCreatorAgent, ReportingAgent
from adapters.memory_adapter import SubstrateMemoryAdapter
from adapters.governance_adapter import SubstrateGovernanceAdapter

def load_agent_config(agent_type: str) -> dict:
    """Load agent configuration from YAML."""
    config_path = Path(__file__).parent / "config" / f"{agent_type}.yaml"

    if not config_path.exists():
        raise FileNotFoundError(f"Config not found: {config_path}")

    with open(config_path) as f:
        return yaml.safe_load(f)

def create_research_agent(
    basket_id: str,
    user_id: str = None
) -> ResearchAgent:
    """Create ResearchAgent with substrate adapters."""
    config = load_agent_config("research")

    # Create adapters (use our substrate_client internally)
    memory = SubstrateMemoryAdapter(basket_id=basket_id)
    governance = SubstrateGovernanceAdapter(basket_id=basket_id, user_id=user_id)

    # Get Anthropic API key
    anthropic_api_key = os.getenv("ANTHROPIC_API_KEY")
    if not anthropic_api_key:
        raise ValueError("ANTHROPIC_API_KEY environment variable required")

    # Create agent (from open-source SDK)
    return ResearchAgent(
        agent_id=config["agent"]["id"],
        memory=memory,
        governance=governance,
        anthropic_api_key=anthropic_api_key,
        monitoring_domains=config["research"]["monitoring_domains"],
        monitoring_frequency=config["research"]["monitoring_frequency"],
        signal_threshold=config["research"]["signal_threshold"],
        synthesis_mode=config["research"]["synthesis_mode"]
    )

def create_content_agent(basket_id: str, user_id: str = None) -> ContentCreatorAgent:
    """Create ContentCreatorAgent with substrate adapters."""
    config = load_agent_config("content")

    memory = SubstrateMemoryAdapter(basket_id=basket_id)
    governance = SubstrateGovernanceAdapter(basket_id=basket_id, user_id=user_id)

    anthropic_api_key = os.getenv("ANTHROPIC_API_KEY")
    if not anthropic_api_key:
        raise ValueError("ANTHROPIC_API_KEY required")

    return ContentCreatorAgent(
        agent_id=config["agent"]["id"],
        memory=memory,
        governance=governance,
        anthropic_api_key=anthropic_api_key,
        enabled_platforms=config["content"]["enabled_platforms"],
        brand_voice_mode=config["content"]["brand_voice_mode"],
        voice_temperature=config["content"]["voice_temperature"]
    )

def create_reporting_agent(basket_id: str, user_id: str = None) -> ReportingAgent:
    """Create ReportingAgent with substrate adapters."""
    config = load_agent_config("reporting")

    memory = SubstrateMemoryAdapter(basket_id=basket_id)
    governance = SubstrateGovernanceAdapter(basket_id=basket_id, user_id=user_id)

    anthropic_api_key = os.getenv("ANTHROPIC_API_KEY")
    if not anthropic_api_key:
        raise ValueError("ANTHROPIC_API_KEY required")

    return ReportingAgent(
        agent_id=config["agent"]["id"],
        memory=memory,
        governance=governance,
        anthropic_api_key=anthropic_api_key,
        default_format=config["reporting"]["default_format"],
        template_library=config["reporting"]["template_library"]
    )
```

### Step 4: Create Agent Routes 🔨

**File: [routes/agents_status.py](work-platform/api/src/app/routes/agents_status.py)** (NEW)
```python
"""Agent status and health endpoints."""
from fastapi import APIRouter, HTTPException
import os

router = APIRouter()

@router.get("/agents/status")
async def get_agents_status():
    """Get status of all available agents."""
    required_vars = ["ANTHROPIC_API_KEY", "SUBSTRATE_API_URL"]
    missing_vars = [var for var in required_vars if not os.getenv(var)]

    if missing_vars:
        return {
            "status": "not_configured",
            "message": f"Missing environment variables: {', '.join(missing_vars)}",
            "agents": {
                "research": "not_configured",
                "content": "not_configured",
                "reporting": "not_configured"
            }
        }

    return {
        "status": "ready",
        "message": "All agents configured and ready",
        "agents": {
            "research": {"status": "ready", "archetypes": ["monitor", "deep_dive"]},
            "content": {"status": "ready", "archetypes": ["create", "repurpose"]},
            "reporting": {"status": "ready", "archetypes": ["generate"]}
        }
    }

@router.get("/agents/{agent_type}/status")
async def get_agent_status(agent_type: str):
    """Get status of specific agent."""
    if agent_type not in ["research", "content", "reporting"]:
        raise HTTPException(status_code=404, detail="Agent type not found")

    return {
        "status": "ready",
        "agent_type": agent_type,
        "message": f"{agent_type.capitalize()} agent ready"
    }
```

**File: [routes/work_sessions.py](work-platform/api/src/app/routes/work_sessions.py)** (UPDATE)
```python
"""Work session orchestration with agents."""
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel, Field
from typing import Optional, Dict, Any
from agents.factory import create_research_agent, create_content_agent, create_reporting_agent
from adapters.auth_adapter import AuthAdapter

router = APIRouter()

class WorkSessionRequest(BaseModel):
    """Request to run agent work session."""
    agent_type: str = Field(..., description="Agent type: research, content, reporting")
    task_type: str = Field(..., description="Task type specific to agent")
    basket_id: str = Field(..., description="Basket ID for agent context")
    parameters: Optional[Dict[str, Any]] = Field(default_factory=dict)

class WorkSessionResponse(BaseModel):
    """Response from agent work session."""
    status: str
    session_id: Optional[str] = None
    message: str
    result: Optional[Dict[str, Any]] = None

@router.post("/work/sessions", response_model=WorkSessionResponse)
async def run_work_session(
    request: WorkSessionRequest,
    user_id: Optional[str] = None  # TODO: Extract from JWT via AuthAdapter
):
    """Run agent work session."""

    try:
        # Create agent based on type
        if request.agent_type == "research":
            agent = create_research_agent(request.basket_id, user_id)

            if request.task_type == "monitor":
                result = await agent.monitor()
            elif request.task_type == "deep_dive":
                topic = request.parameters.get("topic")
                if not topic:
                    raise HTTPException(400, "Topic required for deep_dive")
                result = await agent.deep_dive(topic)
            else:
                raise HTTPException(400, f"Unknown task type: {request.task_type}")

        elif request.agent_type == "content":
            agent = create_content_agent(request.basket_id, user_id)

            if request.task_type == "create":
                result = await agent.create(
                    platform=request.parameters.get("platform"),
                    topic=request.parameters.get("topic"),
                    content_type=request.parameters.get("content_type")
                )
            elif request.task_type == "repurpose":
                result = await agent.repurpose(
                    source_content=request.parameters.get("source_content"),
                    source_platform=request.parameters.get("source_platform"),
                    target_platforms=request.parameters.get("target_platforms")
                )
            else:
                raise HTTPException(400, f"Unknown task type: {request.task_type}")

        elif request.agent_type == "reporting":
            agent = create_reporting_agent(request.basket_id, user_id)

            result = await agent.generate(
                report_type=request.parameters.get("report_type"),
                format=request.parameters.get("format"),
                data=request.parameters.get("data")
            )

        else:
            raise HTTPException(404, f"Agent type not found: {request.agent_type}")

        return WorkSessionResponse(
            status="completed",
            message=f"{request.agent_type} task completed",
            result=result
        )

    except ValueError as e:
        raise HTTPException(500, f"Configuration error: {str(e)}")
    except Exception as e:
        raise HTTPException(500, f"Task execution failed: {str(e)}")
```

### Step 5: Update agent_server.py 🔨

**File: [agent_server.py](work-platform/api/src/app/agent_server.py)** (UPDATE)
```python
# Add new imports
from .routes.agents_status import router as agents_status_router
# work_sessions.py already imported

# Register new routers
app.include_router(agents_status_router, prefix="/api")
# work_sessions already included
```

### Step 6: Add Missing substrate_client Methods 🔨

**File: [substrate_client.py](work-platform/api/src/clients/substrate_client.py)** (UPDATE)

Add these methods to SubstrateClient class:

```python
# Add to SubstrateClient class

def get_basket_documents(self, basket_id: UUID | str) -> list[dict]:
    """Get all documents for a basket."""
    response = self._request("GET", f"/api/documents", params={"basket_id": str(basket_id)})
    return response.get("documents", [])

def get_basket_relationships(self, basket_id: UUID | str) -> list[dict]:
    """Get substrate relationships for a basket."""
    response = self._request("GET", f"/api/baskets/{basket_id}/relationships")
    return response.get("relationships", [])

def search_semantic(
    self,
    basket_id: UUID | str,
    query: str,
    limit: int = 20
) -> list[dict]:
    """Semantic search across basket blocks."""
    response = self._request(
        "POST",
        f"/api/baskets/{basket_id}/search",
        json={"query": query, "limit": limit}
    )
    return response.get("results", [])
```

### Step 7: Copy Agent Configurations 🔨

```bash
# Copy agent config files from yarnnn-claude-agents
mkdir -p work-platform/api/src/agents/config

cp /Users/macbook/yarnnn-claude-agents/agents/research/config.yaml \
   work-platform/api/src/agents/config/research.yaml

cp /Users/macbook/yarnnn-claude-agents/agents/content/config.yaml \
   work-platform/api/src/agents/config/content.yaml

cp /Users/macbook/yarnnn-claude-agents/agents/reporting/config.yaml \
   work-platform/api/src/agents/config/reporting.yaml
```

### Step 8: Update Environment Variables 🔨

**File: render.yaml** (UPDATE)

```yaml
services:
  - type: web
    name: yarnnn-work-platform-api
    env: python
    rootDir: work-platform/api
    buildCommand: pip install --upgrade pip && pip install -r requirements.txt
    startCommand: uvicorn src.app.agent_server:app --host 0.0.0.0 --port 10000
    envVars:
      # Existing
      - key: OPENAI_API_KEY
        sync: false
      - key: SUPABASE_URL
        sync: false
      - key: SUBSTRATE_API_URL
        value: https://yarnnn-substrate-api.onrender.com
      - key: SUBSTRATE_SERVICE_SECRET
        sync: false

      # NEW: For Claude Agent SDK
      - key: ANTHROPIC_API_KEY
        sync: false
```

### Step 9: Create Tests 🔨

**File: [tests/test_adapters.py](work-platform/api/tests/test_adapters.py)** (NEW)

```python
"""Test adapter layer."""
import pytest
from adapters.memory_adapter import SubstrateMemoryAdapter
from adapters.governance_adapter import SubstrateGovernanceAdapter
from claude_agent_sdk.interfaces import Context

@pytest.mark.asyncio
async def test_memory_adapter_query(mocker):
    """Test memory adapter calls substrate_client."""
    mock_client = mocker.patch('adapters.memory_adapter.get_substrate_client')
    mock_client.return_value.get_basket_blocks.return_value = [
        {"id": "1", "title": "Test", "body": "Content", "state": "ACCEPTED"}
    ]

    adapter = SubstrateMemoryAdapter(basket_id="test")
    results = await adapter.query("test query")

    assert len(results) == 1
    assert isinstance(results[0], Context)
    mock_client.return_value.get_basket_blocks.assert_called_once()

@pytest.mark.asyncio
async def test_memory_adapter_store(mocker):
    """Test memory adapter stores via substrate_client."""
    mock_client = mocker.patch('adapters.memory_adapter.get_substrate_client')
    mock_client.return_value.create_dump.return_value = {"id": "dump_123"}

    adapter = SubstrateMemoryAdapter(basket_id="test")
    context = Context(content="Test content", metadata={"type": "test"})

    result_id = await adapter.store(context)

    assert result_id == "dump_123"
    mock_client.return_value.create_dump.assert_called_once()

@pytest.mark.asyncio
async def test_governance_adapter_propose(mocker):
    """Test governance adapter proposes via substrate_client."""
    mock_client = mocker.patch('adapters.governance_adapter.get_substrate_client')
    mock_client.return_value.initiate_work.return_value = {"work_id": "work_123"}

    adapter = SubstrateGovernanceAdapter(basket_id="test")
    proposal_id = await adapter.propose_change("add_block", {"title": "New"})

    assert proposal_id == "work_123"
    mock_client.return_value.initiate_work.assert_called_once()
```

**File: [tests/test_agent_integration.py](work-platform/api/tests/test_agent_integration.py)** (NEW)

```python
"""End-to-end agent integration tests."""
import pytest
from agents.factory import create_research_agent, create_content_agent

@pytest.mark.integration
@pytest.mark.asyncio
async def test_research_agent_creation():
    """Test research agent can be created with adapters."""
    agent = create_research_agent(basket_id="test_basket")

    assert agent.agent_id is not None
    assert agent.memory is not None
    assert agent.governance is not None

@pytest.mark.integration
@pytest.mark.asyncio
async def test_content_agent_creation():
    """Test content agent can be created with adapters."""
    agent = create_content_agent(basket_id="test_basket")

    assert agent.agent_id is not None
    assert agent.memory is not None
    assert agent.governance is not None
```

### Step 10: Sunset yarnnn-claude-agents 🗑️

**After successful integration and testing:**

```bash
# 1. Verify everything works in work-platform
cd work-platform/api
pytest tests/test_adapters.py -v
pytest tests/test_agent_integration.py -v

# 2. Archive yarnnn-claude-agents on GitHub
# Go to: https://github.com/Kvkthecreator/yarnnn-claude-agents/settings
# Scroll to "Danger Zone"
# Click "Archive this repository"
# Confirm

# 3. Delete local clone
rm -rf /Users/macbook/yarnnn-claude-agents

# 4. Add deprecation notice to README (before archiving)
echo "⚠️ DEPRECATED: This repository has been merged into rightnow-agent-app-fullstack" > /Users/macbook/yarnnn-claude-agents/DEPRECATION_NOTICE.md
```

---

## Common Utilities Integration

### Authentication

**Current State:**
- infra/utils/jwt.py exists (Phase 1-3)
- work-platform uses middleware/auth.py
- substrate-api uses middleware/service_to_service_auth.py

**Integration:**
```python
# adapters/auth_adapter.py uses infra/utils/jwt ✅
from infra.utils.jwt import verify_jwt, decode_jwt
```

**No changes needed** - adapter layer bridges SDK → existing auth.

### Database Access

**Current State:**
- infra/utils/supabase_client.py exists
- work-platform should NOT directly access substrate tables (Phase 3 rule)
- All substrate access via substrate_client.py

**Integration:**
```python
# Adapters use substrate_client.py (HTTP) ✅
# NO direct database access in work-platform
```

**No changes needed** - adapter respects BFF pattern.

### Logging & Monitoring

**Current State:**
- Both services use Python logging
- Middleware/correlation.py exists for request tracing

**Integration:**
```python
# adapters/memory_adapter.py
import logging
logger = logging.getLogger(__name__)

# Use existing logging infrastructure ✅
logger.info("Querying substrate via HTTP")
```

**No changes needed** - use existing logging.

---

## Migration Validation Checklist

### Pre-Migration ✅
- [x] Phase 1-3.2 completed
- [x] substrate_client.py exists and tested
- [x] yarnnn-claude-agents repo located
- [x] Open-source SDK structure understood

### During Migration 🔨
- [ ] Install claude-agent-sdk dependency
- [ ] Create adapter layer (memory, governance, auth)
- [ ] Create agent factory
- [ ] Create agent routes
- [ ] Update agent_server.py
- [ ] Add missing substrate_client methods
- [ ] Copy agent configurations
- [ ] Update environment variables
- [ ] Create tests

### Post-Migration ✅
- [ ] All tests pass
- [ ] Memory adapter uses substrate_client (not direct DB)
- [ ] Governance adapter uses substrate_client (not direct DB)
- [ ] Auth adapter uses infra/utils/jwt
- [ ] Agents can be created and executed
- [ ] work-platform deploys successfully
- [ ] substrate-api unchanged and working
- [ ] yarnnn-claude-agents archived
- [ ] Documentation updated

---

## Benefits of This Architecture

### 1. Clean SDK Dependency ✅
- SDK remains unmodified open-source dependency
- Updates flow seamlessly: `pip install --upgrade claude-agent-sdk`
- New agents wire through adapter layer (consistent pattern)

### 2. Phase 1-3 Architecture Preserved ✅
- All substrate access via substrate_client (BFF pattern)
- Circuit breaker, retries, auth all preserved
- No direct database access in work-platform
- infra/ utilities reused (jwt, logging)

### 3. Clear Separation of Concerns ✅
- **SDK**: Generic agent framework (archetypes, interfaces)
- **Adapters**: Our architecture bridging (SDK ↔ substrate_client)
- **Routes**: Work orchestration (projects, sessions)
- **substrate-api**: Memory domain (unchanged)

### 4. Future-Proof ✅
- New SDK agents → Wire through adapters
- New SDK features → Consume via adapters
- Infrastructure changes → Adapter layer absorbs
- SDK breaking changes → Fix adapters only

### 5. Single Codebase ✅
- No more yarnnn-claude-agents confusion
- Everything in rightnow-agent-app-fullstack
- Easier to maintain and understand
- Clear architectural boundaries

---

## Next Steps

### Immediate (This Session)
1. Review and approve architecture
2. Clarify any questions about adapter pattern
3. Discuss common utilities strategy

### Next Session (Implementation)
1. Execute Step 1-9 (migration)
2. Test adapter layer thoroughly
3. Test agent integration end-to-end
4. Deploy to staging

### Follow-up (Sunset)
1. Production deployment validation
2. Archive yarnnn-claude-agents
3. Update documentation
4. Team knowledge transfer

---

## Questions for Clarification

1. **Semantic Search**: Do we need to add `/api/baskets/{id}/search` endpoint to substrate-api, or filter client-side for now?

2. **Governance Workflow**: Should proposals be routed through existing work queue or separate endpoint?

3. **Auth Token Extraction**: Should we use existing middleware/auth.py for token validation or create new decorator?

4. **Agent Configurations**: Keep YAML configs or migrate to env vars / database?

5. **Downstream Utilities**: Do you want to tackle auth/DB utilities now or as separate Phase 5?

---

**Ready to proceed with implementation!** 🚀
