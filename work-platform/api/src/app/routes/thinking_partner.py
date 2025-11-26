"""
Thinking Partner API Routes

Gateway/Mirror/Meta agent that orchestrates specialized agents via chat interface.

Endpoints:
- POST /tp/chat - Send message to Thinking Partner
- GET /tp/session/{session_id} - Get session details
- POST /tp/session/{session_id}/resume - Resume existing session
"""

import logging
import os
from typing import Any, Dict, List, Optional
from uuid import UUID

from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel, Field

from agents_sdk.thinking_partner_sdk import ThinkingPartnerAgentSDK, create_thinking_partner_sdk
from app.utils.jwt import verify_jwt
from app.utils.supabase_client import supabase_admin_client

router = APIRouter(prefix="/tp", tags=["thinking-partner"])
logger = logging.getLogger(__name__)

logger.info("Thinking Partner routes initialized (using official Claude Agent SDK)")


async def _get_workspace_id_for_user(user_id: str) -> str:
    """
    Get workspace_id for user.

    Args:
        user_id: User ID from JWT

    Returns:
        workspace_id for the user

    Raises:
        HTTPException: If user has no workspace
    """
    response = supabase_admin_client.table("workspace_memberships").select(
        "workspace_id"
    ).eq("user_id", user_id).limit(1).execute()

    if not response.data or len(response.data) == 0:
        logger.error(f"No workspace found for user {user_id}")
        raise HTTPException(
            status_code=403,
            detail="User does not belong to any workspace"
        )

    workspace_id = response.data[0]['workspace_id']
    logger.debug(f"Resolved workspace_id={workspace_id} for user={user_id}")
    return workspace_id


async def _validate_basket_access(
    basket_id: str,
    workspace_id: str
) -> None:
    """
    Validate that basket belongs to workspace via projects table.

    Args:
        basket_id: Basket ID
        workspace_id: Workspace ID

    Raises:
        HTTPException: If basket not found or doesn't belong to workspace
    """
    # Query projects table (work-platform DB) instead of baskets table (substrate-API DB)
    # Projects table has basket_id and workspace_id for validation
    response = supabase_admin_client.table("projects").select("id").eq(
        "basket_id", basket_id
    ).eq("workspace_id", workspace_id).limit(1).execute()

    if not response.data or len(response.data) == 0:
        logger.error(f"No project found with basket {basket_id} in workspace {workspace_id}")
        raise HTTPException(
            status_code=404,
            detail="Basket not found or access denied"
        )

    logger.debug(f"Validated basket {basket_id} belongs to workspace {workspace_id} via project {response.data[0]['id']}")


# ============================================================================
# Request/Response Models
# ============================================================================


class TPChatRequest(BaseModel):
    """Request to chat with Thinking Partner."""
    basket_id: str = Field(..., description="Basket ID for context")
    message: str = Field(..., description="User's message")
    claude_session_id: Optional[str] = Field(None, description="Claude session ID to resume")


class WorkOutputSummary(BaseModel):
    """Summary of work output emitted by TP."""
    output_type: str
    title: str
    content_preview: Optional[str] = None


class TPChatResponse(BaseModel):
    """Response from Thinking Partner chat."""
    message: str = Field(..., description="TP's response message")
    claude_session_id: Optional[str] = Field(None, description="Claude session ID for resumption")
    session_id: Optional[str] = Field(None, description="AgentSession ID")
    work_outputs: List[Dict[str, Any]] = Field(default_factory=list, description="Work outputs emitted by TP")
    actions_taken: List[str] = Field(default_factory=list, description="Actions TP performed")


class TPSessionResponse(BaseModel):
    """Thinking Partner session details."""
    session_id: str
    claude_session_id: Optional[str] = None
    basket_id: str
    workspace_id: str
    user_id: str
    created_at: str
    updated_at: str
    metadata: Dict[str, Any] = Field(default_factory=dict)


# ============================================================================
# Endpoints
# ============================================================================


@router.post("/chat", response_model=TPChatResponse)
async def tp_chat(
    request: TPChatRequest,
    user: dict = Depends(verify_jwt)
):
    """
    Send message to Thinking Partner.

    The Thinking Partner will:
    1. Query existing knowledge (memory)
    2. Check work orchestration state (infra_reader)
    3. Decide what action to take
    4. Potentially delegate to specialized agents (work_orchestration)
    5. Respond conversationally with results

    Args:
        request: Chat request with message and basket context
        user: Authenticated user from JWT

    Returns:
        TP's response with message, session info, and any work outputs

    Example Request:
        {
            "basket_id": "basket_abc",
            "message": "I need LinkedIn content about AI agents",
            "claude_session_id": null
        }

    Example Response:
        {
            "message": "I see we have research on AI agents from 3 days ago. Would you like me to use that or run fresh research?",
            "claude_session_id": "session_xyz",
            "session_id": "agent_session_123",
            "work_outputs": [],
            "actions_taken": ["Queried memory for 'AI agents'", "Checked recent work tickets"]
        }
    """
    user_id = user.get("sub") or user.get("user_id")
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid user token")

    # Extract user JWT token for substrate-API authentication
    user_token = user.get("token", "")
    if not user_token:
        logger.warning(f"TP chat: No JWT token found for user={user_id}")

    logger.info(
        f"TP chat: user={user_id}, basket={request.basket_id}, "
        f"message={request.message[:100]}"
    )

    try:
        # Get workspace_id
        workspace_id = await _get_workspace_id_for_user(user_id)

        # Validate basket access
        await _validate_basket_access(request.basket_id, workspace_id)

        # Create Thinking Partner using official Claude Agent SDK with user JWT
        tp = create_thinking_partner_sdk(
            basket_id=request.basket_id,
            workspace_id=workspace_id,
            user_id=user_id,
            user_token=user_token  # Pass JWT for substrate-API authentication
        )

        # Chat with TP
        result = await tp.chat(
            user_message=request.message,
            claude_session_id=request.claude_session_id
        )

        logger.info(
            f"TP chat complete: {len(result.get('message', ''))} chars, "
            f"{len(result.get('work_outputs', []))} outputs, "
            f"{len(result.get('actions_taken', []))} actions"
        )

        return TPChatResponse(
            message=result.get("message", "Processing..."),
            claude_session_id=result.get("claude_session_id", ""),
            session_id=result.get("session_id"),
            work_outputs=result.get("work_outputs", []),
            actions_taken=result.get("actions_taken", [])
        )

    except HTTPException:
        # Re-raise HTTP exceptions
        raise

    except Exception as e:
        logger.exception(f"TP chat failed: {e}")
        raise HTTPException(
            status_code=500,
            detail=f"Thinking Partner error: {str(e)}"
        )


@router.get("/session/{session_id}", response_model=TPSessionResponse)
async def get_tp_session(
    session_id: str,
    user: dict = Depends(verify_jwt)
):
    """
    Get Thinking Partner session details.

    Args:
        session_id: AgentSession ID
        user: Authenticated user from JWT

    Returns:
        Session details

    Raises:
        HTTPException: If session not found or unauthorized
    """
    user_id = user.get("sub") or user.get("user_id")
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid user token")

    try:
        # Get workspace_id
        workspace_id = await _get_workspace_id_for_user(user_id)

        # Query agent_sessions table
        response = supabase_admin_client.table("agent_sessions").select(
            "id, claude_session_id, basket_id, workspace_id, user_id, created_at, updated_at, metadata"
        ).eq("id", session_id).eq(
            "agent_type", "thinking_partner"
        ).eq("workspace_id", workspace_id).single().execute()

        if not response.data:
            raise HTTPException(
                status_code=404,
                detail="Session not found or access denied"
            )

        session = response.data

        return TPSessionResponse(
            session_id=session["id"],
            claude_session_id=session.get("claude_session_id"),
            basket_id=session["basket_id"],
            workspace_id=session["workspace_id"],
            user_id=session["user_id"],
            created_at=session["created_at"],
            updated_at=session["updated_at"],
            metadata=session.get("metadata", {})
        )

    except HTTPException:
        raise

    except Exception as e:
        logger.exception(f"Failed to get TP session: {e}")
        raise HTTPException(
            status_code=500,
            detail=f"Failed to retrieve session: {str(e)}"
        )


@router.get("/capabilities")
async def get_tp_capabilities():
    """
    Get Thinking Partner capabilities.

    Returns:
        Dictionary of TP capabilities and available tools

    Example Response:
        {
            "description": "Meta-agent that orchestrates specialized agents",
            "pattern": "Gateway/Mirror/Meta",
            "tools": {
                "work_orchestration": {...},
                "infra_reader": {...},
                "steps_planner": {...}
            },
            "agents": ["research", "content", "reporting"]
        }
    """
    return {
        "description": "Thinking Partner - Meta-agent that orchestrates specialized agents",
        "pattern": "Gateway/Mirror/Meta",
        "capabilities": [
            "Chat interface for user interaction",
            "Query substrate knowledge base",
            "Delegate to specialized agents (research, content, reporting)",
            "Plan multi-step workflows",
            "Query work orchestration state",
            "Emit meta-intelligence (insights, recommendations)"
        ],
        "tools": {
            "work_orchestration": {
                "description": "Delegate work to specialized agents",
                "agents": ["research", "content", "reporting"]
            },
            "infra_reader": {
                "description": "Query work orchestration infrastructure",
                "queries": [
                    "recent_work_requests",
                    "work_tickets_by_status",
                    "work_outputs_by_type",
                    "agent_sessions",
                    "work_history"
                ]
            },
            "steps_planner": {
                "description": "Plan multi-step workflows",
                "capabilities": ["Break down complex requests", "Optimize execution order"]
            },
            "emit_work_output": {
                "description": "Emit TP's own insights",
                "output_types": ["insight", "recommendation", "pattern"]
            }
        },
        "agents_available": ["research", "content", "reporting"],
        "substrate_access": "On-demand queries via SubstrateQueryAdapter",
        "session_management": "AgentSession with Claude session resumption"
    }
