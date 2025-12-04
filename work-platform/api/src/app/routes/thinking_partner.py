"""
Thinking Partner API Routes

Conversational AI agent for context management, ideation, and work orchestration.

Endpoints:
- POST /tp/chat - Send message to Thinking Partner
- GET /tp/sessions - List user's sessions for a basket
- GET /tp/sessions/{id} - Get session with messages
- POST /tp/sessions - Create new session
- DELETE /tp/sessions/{id} - Archive session
- GET /tp/capabilities - Get TP capabilities

See: /docs/implementation/THINKING_PARTNER_IMPLEMENTATION_PLAN.md
"""

import logging
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
from uuid import uuid4

from fastapi import APIRouter, HTTPException, Depends
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from app.utils.jwt import verify_jwt
from app.utils.supabase_client import supabase_admin_client

router = APIRouter(prefix="/tp", tags=["thinking-partner"])
logger = logging.getLogger(__name__)

logger.info("Thinking Partner routes initialized (v2.0 - context-aware)")


# ============================================================================
# Request/Response Models
# ============================================================================


class TPChatRequest(BaseModel):
    """Request to chat with Thinking Partner."""
    basket_id: str = Field(..., description="Basket ID for context")
    message: str = Field(..., description="User's message")
    session_id: Optional[str] = Field(None, description="Existing session to continue")


class TPChatResponse(BaseModel):
    """Response from Thinking Partner chat."""
    message: str = Field(..., description="Response message")
    session_id: str = Field(..., description="Session ID for continuity")
    message_id: str = Field(..., description="Message ID")
    tool_calls: List[Dict[str, Any]] = Field(default_factory=list)
    work_outputs: List[Dict[str, Any]] = Field(default_factory=list)
    context_changes: List[Dict[str, Any]] = Field(default_factory=list)


class TPSessionCreate(BaseModel):
    """Request to create a new TP session."""
    basket_id: str = Field(..., description="Basket ID")
    title: Optional[str] = Field(None, description="Optional session title")


class TPSessionResponse(BaseModel):
    """Thinking Partner session details."""
    id: str
    basket_id: str
    workspace_id: str
    title: Optional[str]
    status: str
    message_count: int
    last_message_at: Optional[str]
    created_at: str
    updated_at: str


class TPMessageResponse(BaseModel):
    """Single TP message."""
    id: str
    session_id: str
    role: str
    content: str
    tool_calls: List[Dict[str, Any]] = Field(default_factory=list)
    work_output_ids: List[str] = Field(default_factory=list)
    created_at: str


class TPSessionWithMessages(TPSessionResponse):
    """Session with message history."""
    messages: List[TPMessageResponse] = Field(default_factory=list)


# ============================================================================
# Helper Functions
# ============================================================================


async def _get_workspace_id_for_basket(basket_id: str) -> str:
    """Get workspace_id for a basket."""
    result = (
        supabase_admin_client.table("baskets")
        .select("workspace_id")
        .eq("id", basket_id)
        .single()
        .execute()
    )

    if not result.data:
        raise HTTPException(status_code=404, detail="Basket not found")

    return result.data["workspace_id"]


async def _verify_basket_access(basket_id: str, user_id: str) -> str:
    """Verify user has access to basket and return workspace_id."""
    workspace_id = await _get_workspace_id_for_basket(basket_id)

    result = (
        supabase_admin_client.table("workspace_memberships")
        .select("workspace_id")
        .eq("workspace_id", workspace_id)
        .eq("user_id", user_id)
        .execute()
    )

    if not result.data:
        raise HTTPException(status_code=403, detail="Access denied to basket")

    return workspace_id


async def _get_or_create_session(
    basket_id: str,
    workspace_id: str,
    user_id: str,
    session_id: Optional[str] = None,
) -> Dict[str, Any]:
    """Get existing session or create new one."""

    if session_id:
        # Try to get existing session
        result = (
            supabase_admin_client.table("tp_sessions")
            .select("*")
            .eq("id", session_id)
            .eq("basket_id", basket_id)
            .eq("status", "active")
            .single()
            .execute()
        )

        if result.data:
            return result.data

        logger.warning(f"Session {session_id} not found, creating new one")

    # Create new session
    session_data = {
        "basket_id": basket_id,
        "workspace_id": workspace_id,
        "status": "active",
        "created_by_user_id": user_id,
    }

    result = supabase_admin_client.table("tp_sessions").insert(session_data).execute()

    if not result.data:
        raise HTTPException(status_code=500, detail="Failed to create session")

    logger.info(f"Created new TP session {result.data[0]['id']}")
    return result.data[0]


async def _save_message(
    session_id: str,
    basket_id: str,
    user_id: str,
    role: str,
    content: str,
    tool_calls: Optional[List[Dict]] = None,
    work_output_ids: Optional[List[str]] = None,
    context_snapshot: Optional[Dict] = None,
) -> Dict[str, Any]:
    """Save a message to tp_messages."""
    message_data = {
        "session_id": session_id,
        "basket_id": basket_id,
        "role": role,
        "content": content,
        "user_id": user_id if role == "user" else None,
        "tool_calls": tool_calls or [],
        "work_output_ids": work_output_ids or [],
        "context_snapshot": context_snapshot,
    }

    result = supabase_admin_client.table("tp_messages").insert(message_data).execute()

    if not result.data:
        raise HTTPException(status_code=500, detail="Failed to save message")

    return result.data[0]


async def _provision_context(basket_id: str) -> Dict[str, Any]:
    """Provision context for TP prompt."""
    # Fetch all active context items
    result = (
        supabase_admin_client.table("context_items")
        .select("item_type, title, content, tier, completeness_score")
        .eq("basket_id", basket_id)
        .eq("status", "active")
        .execute()
    )

    items = result.data or []

    # Group by tier
    context = {
        "foundation": [],
        "working": [],
        "ephemeral": [],
    }

    for item in items:
        tier = item.get("tier", "working")
        context[tier].append({
            "type": item["item_type"],
            "title": item.get("title"),
            "content": item.get("content", {}),
            "completeness": item.get("completeness_score", 0),
        })

    return context


def _build_context_prompt(context: Dict[str, Any]) -> str:
    """Build context section for system prompt."""
    sections = []

    # Foundation context
    if context["foundation"]:
        foundation_items = []
        for item in context["foundation"]:
            item_str = f"### {item['title'] or item['type'].title()}\n"
            for key, value in item.get("content", {}).items():
                if value:
                    item_str += f"- **{key.replace('_', ' ').title()}**: {value}\n"
            foundation_items.append(item_str)

        sections.append(
            "## Foundation Context (stable, user-established)\n\n" +
            "\n".join(foundation_items)
        )

    # Working context
    if context["working"]:
        working_items = []
        for item in context["working"]:
            item_str = f"- {item['title'] or item['type'].title()} (completeness: {int(item['completeness'] * 100)}%)"
            working_items.append(item_str)

        sections.append(
            "## Working Context (accumulating)\n\n" +
            "\n".join(working_items)
        )

    if not sections:
        return "No context items have been set up yet. You can help the user establish their foundation context (problem, customer, vision, brand)."

    return "\n\n".join(sections)


# ============================================================================
# Chat Endpoint
# ============================================================================


@router.post("/chat", response_model=TPChatResponse)
async def tp_chat(
    request: TPChatRequest,
    user: dict = Depends(verify_jwt)
):
    """
    Send message to Thinking Partner.

    This endpoint:
    1. Creates or resumes a session
    2. Saves the user's message
    3. Provisions context for the agent
    4. Executes the ThinkingPartnerAgent
    5. Saves the assistant's response
    6. Returns the response with tool calls and outputs
    """
    user_id = user.get("sub") or user.get("user_id")
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid user token")

    basket_id = request.basket_id

    try:
        # Verify access
        workspace_id = await _verify_basket_access(basket_id, user_id)

        # Get or create session
        session = await _get_or_create_session(
            basket_id=basket_id,
            workspace_id=workspace_id,
            user_id=user_id,
            session_id=request.session_id,
        )

        session_id = session["id"]

        # Save user message
        user_message = await _save_message(
            session_id=session_id,
            basket_id=basket_id,
            user_id=user_id,
            role="user",
            content=request.message,
        )

        # Provision context
        context = await _provision_context(basket_id)
        context_prompt = _build_context_prompt(context)

        # Execute TP agent
        from agents.thinking_partner_agent import ThinkingPartnerAgent

        agent = ThinkingPartnerAgent(
            basket_id=basket_id,
            workspace_id=workspace_id,
            work_ticket_id=None,  # TP doesn't require a ticket
            user_id=user_id,
            session_id=session_id,
        )

        result = await agent.execute(
            message=request.message,
            context_prompt=context_prompt,
        )

        # Extract results
        response_text = result.response_text or "I apologize, I wasn't able to generate a response."
        tool_calls = result.tool_calls or []
        work_outputs = result.work_outputs or []

        # Track context changes from tool calls
        context_changes = []
        for tc in tool_calls:
            if tc.get("name") == "write_context":
                context_changes.append({
                    "item_type": tc.get("input", {}).get("item_type"),
                    "action": tc.get("result", {}).get("action", "unknown"),
                })

        # Save assistant message
        assistant_message = await _save_message(
            session_id=session_id,
            basket_id=basket_id,
            user_id=user_id,
            role="assistant",
            content=response_text,
            tool_calls=tool_calls,
            work_output_ids=[wo.get("id") for wo in work_outputs if wo.get("id")],
            context_snapshot={"summary": f"{len(context['foundation'])} foundation, {len(context['working'])} working items"},
        )

        logger.info(
            f"[TP Chat] session={session_id}, user_msg={len(request.message)} chars, "
            f"response={len(response_text)} chars, tools={len(tool_calls)}, outputs={len(work_outputs)}"
        )

        return TPChatResponse(
            message=response_text,
            session_id=session_id,
            message_id=assistant_message["id"],
            tool_calls=tool_calls,
            work_outputs=work_outputs,
            context_changes=context_changes,
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"[TP Chat] Error: {e}")
        raise HTTPException(status_code=500, detail=f"Chat failed: {str(e)}")


# ============================================================================
# Session Endpoints
# ============================================================================


@router.get("/sessions", response_model=List[TPSessionResponse])
async def list_sessions(
    basket_id: str,
    status: str = "active",
    limit: int = 20,
    user: dict = Depends(verify_jwt)
):
    """List TP sessions for a basket."""
    user_id = user.get("sub") or user.get("user_id")
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid user token")

    try:
        await _verify_basket_access(basket_id, user_id)

        result = (
            supabase_admin_client.table("tp_sessions")
            .select("*")
            .eq("basket_id", basket_id)
            .eq("status", status)
            .order("updated_at", desc=True)
            .limit(limit)
            .execute()
        )

        return [
            TPSessionResponse(
                id=s["id"],
                basket_id=s["basket_id"],
                workspace_id=s["workspace_id"],
                title=s.get("title"),
                status=s["status"],
                message_count=s.get("message_count", 0),
                last_message_at=s.get("last_message_at"),
                created_at=s["created_at"],
                updated_at=s["updated_at"],
            )
            for s in result.data or []
        ]

    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"[TP Sessions] Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/sessions/{session_id}", response_model=TPSessionWithMessages)
async def get_session(
    session_id: str,
    user: dict = Depends(verify_jwt)
):
    """Get a TP session with its messages."""
    user_id = user.get("sub") or user.get("user_id")
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid user token")

    try:
        # Get session
        session_result = (
            supabase_admin_client.table("tp_sessions")
            .select("*")
            .eq("id", session_id)
            .single()
            .execute()
        )

        if not session_result.data:
            raise HTTPException(status_code=404, detail="Session not found")

        session = session_result.data

        # Verify access
        await _verify_basket_access(session["basket_id"], user_id)

        # Get messages
        messages_result = (
            supabase_admin_client.table("tp_messages")
            .select("*")
            .eq("session_id", session_id)
            .order("created_at")
            .execute()
        )

        messages = [
            TPMessageResponse(
                id=m["id"],
                session_id=m["session_id"],
                role=m["role"],
                content=m["content"],
                tool_calls=m.get("tool_calls", []),
                work_output_ids=m.get("work_output_ids", []),
                created_at=m["created_at"],
            )
            for m in messages_result.data or []
        ]

        return TPSessionWithMessages(
            id=session["id"],
            basket_id=session["basket_id"],
            workspace_id=session["workspace_id"],
            title=session.get("title"),
            status=session["status"],
            message_count=session.get("message_count", 0),
            last_message_at=session.get("last_message_at"),
            created_at=session["created_at"],
            updated_at=session["updated_at"],
            messages=messages,
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"[TP Session] Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/sessions", response_model=TPSessionResponse)
async def create_session(
    request: TPSessionCreate,
    user: dict = Depends(verify_jwt)
):
    """Create a new TP session."""
    user_id = user.get("sub") or user.get("user_id")
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid user token")

    try:
        workspace_id = await _verify_basket_access(request.basket_id, user_id)

        session_data = {
            "basket_id": request.basket_id,
            "workspace_id": workspace_id,
            "title": request.title,
            "status": "active",
            "created_by_user_id": user_id,
        }

        result = supabase_admin_client.table("tp_sessions").insert(session_data).execute()

        if not result.data:
            raise HTTPException(status_code=500, detail="Failed to create session")

        session = result.data[0]

        return TPSessionResponse(
            id=session["id"],
            basket_id=session["basket_id"],
            workspace_id=session["workspace_id"],
            title=session.get("title"),
            status=session["status"],
            message_count=0,
            last_message_at=None,
            created_at=session["created_at"],
            updated_at=session["updated_at"],
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"[TP Create Session] Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/sessions/{session_id}")
async def archive_session(
    session_id: str,
    user: dict = Depends(verify_jwt)
):
    """Archive a TP session."""
    user_id = user.get("sub") or user.get("user_id")
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid user token")

    try:
        # Get session to verify access
        session_result = (
            supabase_admin_client.table("tp_sessions")
            .select("basket_id")
            .eq("id", session_id)
            .single()
            .execute()
        )

        if not session_result.data:
            raise HTTPException(status_code=404, detail="Session not found")

        await _verify_basket_access(session_result.data["basket_id"], user_id)

        # Archive
        supabase_admin_client.table("tp_sessions").update(
            {"status": "archived"}
        ).eq("id", session_id).execute()

        return {"success": True, "message": "Session archived"}

    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"[TP Archive Session] Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ============================================================================
# Capabilities Endpoint
# ============================================================================


@router.get("/capabilities")
async def get_tp_capabilities():
    """Get Thinking Partner capabilities."""
    return {
        "description": "Thinking Partner - Conversational AI for context management and work orchestration",
        "status": "active",
        "features": {
            "chat": {
                "enabled": True,
                "streaming": False,  # TODO: Add streaming support
                "description": "Send messages and receive responses"
            },
            "context_management": {
                "enabled": True,
                "tools": ["read_context", "write_context", "list_context"],
                "description": "Read, write, and list context items"
            },
            "work_orchestration": {
                "enabled": True,
                "tools": ["list_recipes", "trigger_recipe"],
                "description": "List and trigger work recipes"
            },
            "governance": {
                "enabled": True,
                "description": "Foundation tier writes create proposals for approval"
            },
            "session_persistence": {
                "enabled": True,
                "description": "Chat history persists in database"
            }
        },
        "context_tiers": {
            "foundation": {
                "types": ["problem", "customer", "vision", "brand"],
                "governance": "requires_approval"
            },
            "working": {
                "types": ["competitor", "trend_digest", "competitor_snapshot"],
                "governance": "auto_apply"
            },
            "ephemeral": {
                "types": [],
                "governance": "auto_apply"
            }
        }
    }
