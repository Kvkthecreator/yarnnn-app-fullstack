"""
Project Work Sessions API - Phase 6.5

Project-scoped work sessions that integrate with:
- project_agents (many-to-many)
- agent_work_requests (billing/trials)
- work_tickets (execution records)

This is the NEW endpoint for project-based work requests.
Old /api/work/sessions endpoints remain for backward compatibility.
"""

from __future__ import annotations

import logging
import os
from typing import Optional
from datetime import datetime
from uuid import UUID

from fastapi import APIRouter, HTTPException, Depends, Path
from pydantic import BaseModel, Field
from supabase import create_client

from app.utils.jwt import verify_jwt
from app.utils.supabase_client import supabase_admin_client
from utils.permissions import (
    check_agent_work_request_allowed,
    record_work_request,
    PermissionDeniedError,
)

# Import enhanced task configuration models and services
from models.task_configurations import CreateWorkTicketRequest as EnhancedWorkTicketRequest
from services.context_envelope_generator import ContextEnvelopeGenerator
from clients.substrate_client import SubstrateClient

router = APIRouter(prefix="/projects", tags=["project-work-sessions"])
logger = logging.getLogger(__name__)


# ========================================================================
# Request/Response Models
# ========================================================================


class WorkTicketListItem(BaseModel):
    """Work session list item (summary)."""

    ticket_id: str
    agent_id: str
    agent_type: str
    agent_display_name: str
    task_description: str
    status: str
    created_at: str
    completed_at: Optional[str]


class WorkTicketsListResponse(BaseModel):
    """List of work sessions for a project."""

    sessions: list[WorkTicketListItem]
    total_count: int
    status_counts: dict


class WorkTicketDetailResponse(BaseModel):
    """Detailed work session information."""

    ticket_id: str
    project_id: str
    project_name: str
    agent_id: str
    agent_type: str
    agent_display_name: str
    task_description: str
    status: str
    task_type: str
    priority: int
    context: dict
    work_request_id: str
    created_at: str
    updated_at: Optional[str]
    completed_at: Optional[str]
    error_message: Optional[str]
    result_summary: Optional[str]
    outputs_count: int = 0


# Legacy model kept for backward compatibility (deprecated)
class LegacyCreateWorkTicketRequest(BaseModel):
    """Legacy request format (deprecated - use EnhancedWorkTicketRequest)."""
    agent_id: str
    task_description: str
    work_mode: str = "general"
    context: Optional[dict] = {}
    priority: int = 5


class WorkTicketResponse(BaseModel):
    """Work session response."""

    ticket_id: str
    project_id: str
    agent_id: str
    agent_type: str
    task_description: str
    status: str
    work_request_id: str
    created_at: str
    is_trial_request: bool
    remaining_trials: Optional[int]
    message: str


# ========================================================================
# Endpoints
# ========================================================================


@router.post("/{project_id}/work-sessions", response_model=WorkTicketResponse)
async def create_project_work_ticket(
    project_id: str = Path(..., description="Project ID"),
    request: EnhancedWorkTicketRequest = ...,
    user: dict = Depends(verify_jwt)
):
    """
    Create work session for project agent.

    Phase 6.5: Integrates with project_agents, agent_work_requests, and permissions.

    Flow:
    1. Validate project and agent exist
    2. Get agent_type from project_agents
    3. Check permissions (trial/subscription)
    4. Create agent_work_request (billing)
    5. Create work_ticket (execution record)
    6. Return session details

    Args:
        project_id: Project ID
        request: Work session creation request
        user: Authenticated user from JWT

    Returns:
        Work session details with trial status

    Raises:
        PermissionDeniedError: If trial exhausted and not subscribed
        HTTPException: If project/agent not found or validation fails
    """
    user_id = user.get("sub") or user.get("user_id")
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid user token")

    logger.info(
        f"[PROJECT WORK SESSION] Creating work session: "
        f"project={project_id}, agent={request.agent_id}, user={user_id}"
    )

    supabase = supabase_admin_client

    try:
        # ================================================================
        # Step 1: Validate Project Exists and User Has Access
        # ================================================================
        project_response = supabase.table("projects").select(
            "id, name, workspace_id, user_id, basket_id"
        ).eq("id", project_id).single().execute()

        if not project_response.data:
            raise HTTPException(status_code=404, detail="Project not found")

        project = project_response.data

        # Verify user owns project (or has workspace access)
        if project["user_id"] != user_id:
            # TODO: Check workspace membership if different user
            raise HTTPException(status_code=403, detail="Access denied")

        workspace_id = project["workspace_id"]
        basket_id = project["basket_id"]

        # ================================================================
        # Step 2: Get Agent Session (refactored from project_agents)
        # ================================================================
        # After Phase 2e refactor, agent_sessions are created during project scaffolding
        # The agent_id from frontend is actually an agent_session_id
        agent_session_response = supabase.table("agent_sessions").select(
            "id, agent_type, basket_id"
        ).eq("id", request.agent_id).eq("basket_id", basket_id).single().execute()

        if not agent_session_response.data:
            raise HTTPException(
                status_code=404,
                detail="Agent session not found for this project"
            )

        agent_session = agent_session_response.data
        agent_type = agent_session["agent_type"]
        agent_session_id = agent_session["id"]

        logger.debug(
            f"[PROJECT WORK SESSION] Validated project and agent: "
            f"agent_type={agent_type}, basket={basket_id}"
        )

        # ================================================================
        # Step 3: Check Permissions (Trial/Subscription)
        # ================================================================
        try:
            permission_info = await check_agent_work_request_allowed(
                user_id=user_id,
                workspace_id=workspace_id,
                agent_type=agent_type,
            )
            logger.debug(
                f"[PROJECT WORK SESSION] Permission check passed: "
                f"subscribed={permission_info.get('is_subscribed')}, "
                f"remaining_trials={permission_info.get('remaining_trial_requests')}"
            )
        except PermissionDeniedError as e:
            logger.warning(f"[PROJECT WORK SESSION] Permission denied: {e}")
            raise HTTPException(
                status_code=403,
                detail={
                    "message": str(e),
                    "remaining_trials": e.remaining_trials,
                    "agent_type": e.agent_type,
                },
            )

        # ================================================================
        # Step 4: Generate Context Envelope (P4 Document)
        # ================================================================
        context_envelope = None
        task_document_id = None

        try:
            substrate_client = SubstrateClient()
            envelope_generator = ContextEnvelopeGenerator(substrate_client)

            context_envelope = await envelope_generator.generate_project_context_envelope(
                project_id=project_id,
                basket_id=basket_id,
                agent_type=agent_type,
                focus_blocks=None  # TODO: Extract from task_configuration if specified
            )

            # Store envelope as P4 document
            task_document_id = await envelope_generator.store_envelope_as_document(
                envelope=context_envelope,
                basket_id=basket_id
            )

            logger.info(
                f"[PROJECT WORK SESSION] Generated context envelope, "
                f"document_id={task_document_id}"
            )
        except Exception as e:
            logger.warning(
                f"[PROJECT WORK SESSION] Failed to generate context envelope: {e}. "
                f"Continuing without it - agent will query substrate directly."
            )
            # Non-fatal: agent can still execute without envelope

        # ================================================================
        # Step 5: Create Agent Work Request (Billing/Trial Tracking)
        # ================================================================
        request_payload = {
            "project_id": project_id,
            "agent_id": request.agent_id,
            "task_description": request.task_description[:200],  # Truncate
            "task_configuration": request.get_task_configuration(),  # Agent-specific config
        }

        try:
            work_request_id = await record_work_request(
                user_id=user_id,
                workspace_id=workspace_id,
                basket_id=basket_id,
                agent_type=agent_type,
                work_mode="enhanced",  # Mark as enhanced request
                request_payload=request_payload,
                permission_info=permission_info,
            )
            logger.info(
                f"[PROJECT WORK SESSION] Created work_request {work_request_id} "
                f"(trial={not permission_info.get('is_subscribed')})"
            )
        except Exception as e:
            logger.error(f"[PROJECT WORK SESSION] Failed to create work_request: {e}")
            raise HTTPException(
                status_code=500,
                detail=f"Failed to create work request: {str(e)}"
            )

        # ================================================================
        # Step 6: Create Work Session (Execution Record)
        # ================================================================
        session_data = {
            "project_id": project_id,
            "project_agent_id": request.agent_id,
            "agent_work_request_id": work_request_id,
            "basket_id": basket_id,
            "workspace_id": workspace_id,
            "initiated_by_user_id": user_id,
            "task_intent": request.task_description,
            "task_type": agent_type,  # Store agent type as task_type
            "status": "initialized",  # Start as initialized (pending deprecated)
            "task_configuration": request.get_task_configuration(),  # Agent-specific config (JSONB)
            "task_document_id": task_document_id,  # Link to context envelope P4 document
            "approval_strategy": request.approval_strategy.strategy,  # Checkpoint strategy
            "metadata": {
                "priority": request.priority,
                "source": "ui_enhanced",
                "envelope_generated": task_document_id is not None,
            },
        }

        try:
            session_response = supabase.table("work_tickets").insert(
                session_data
            ).execute()

            if not session_response.data:
                raise Exception("No work session created")

            session = session_response.data[0]
            ticket_id = session["id"]

            logger.info(
                f"[PROJECT WORK SESSION] ✅ SUCCESS: session={ticket_id}, "
                f"work_request={work_request_id}, agent={agent_type}"
            )

        except Exception as e:
            logger.error(f"[PROJECT WORK SESSION] Failed to create session: {e}")
            raise HTTPException(
                status_code=500,
                detail=f"Failed to create work session: {str(e)}"
            )

        # ================================================================
        # Step 7: Return Work Session Details
        # ================================================================
        return WorkTicketResponse(
            ticket_id=ticket_id,
            project_id=project_id,
            agent_id=request.agent_id,
            agent_type=agent_type,
            task_description=request.task_description,
            status="initialized",
            work_request_id=work_request_id,
            created_at=session["created_at"],
            is_trial_request=not permission_info.get("is_subscribed", False),
            remaining_trials=permission_info.get("remaining_trial_requests"),
            message=f"Work session created with context envelope. Agent ready to execute.",
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"[PROJECT WORK SESSION] Unexpected error: {e}")
        raise HTTPException(
            status_code=500,
            detail=f"Failed to create work session: {str(e)}"
        )


# ============================================================================
# PHASE 2: AGENT EXECUTION ENDPOINTS
# ============================================================================

@router.post("/{project_id}/work-sessions/{ticket_id}/execute")
async def execute_work_ticket(
    project_id: str = Path(..., description="Project ID"),
    ticket_id: str = Path(..., description="Work session ID"),
    user: dict = Depends(verify_jwt)
):
    """
    Execute a work session via Agent SDK.

    **Phase 2: Agent Execution**

    Flow:
    1. Validate session belongs to project
    2. Check session is in executable state (initialized/paused)
    3. Create agent instance
    4. Provision context envelope
    5. Execute agent task
    6. Handle outputs (outputs, checkpoints)
    7. Update session status

    Returns:
        Execution result with status and outputs
    """
    from services.work_ticket_executor import WorkTicketExecutor

    user_id = user.get("sub") or user.get("user_id")
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid user token")

    logger.info(
        f"[EXECUTE SESSION] User {user_id} executing session {ticket_id} "
        f"in project {project_id}"
    )

    try:
        # Verify session belongs to project and user has access
        supabase = create_client(
            os.getenv("SUPABASE_URL"),
            os.getenv("SUPABASE_SERVICE_ROLE_KEY")
        )

        session_response = supabase.table("work_tickets").select(
            "id, project_id, status"
        ).eq("id", ticket_id).eq("project_id", project_id).single().execute()

        if not session_response.data:
            raise HTTPException(
                status_code=404,
                detail="Work session not found or does not belong to this project"
            )

        # Execute work session
        executor = WorkTicketExecutor()
        result = await executor.execute_work_ticket(ticket_id)

        logger.info(
            f"[EXECUTE SESSION] ✅ Execution completed: "
            f"session={ticket_id}, status={result['status']}"
        )

        return result

    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"[EXECUTE SESSION] Failed to execute session {ticket_id}: {e}")
        raise HTTPException(
            status_code=500,
            detail=f"Failed to execute work session: {str(e)}"
        )


@router.get("/{project_id}/work-sessions/{ticket_id}/status")
async def get_work_ticket_status(
    project_id: str = Path(..., description="Project ID"),
    ticket_id: str = Path(..., description="Work session ID"),
    user: dict = Depends(verify_jwt)
):
    """
    Get real-time status of a work session.

    **Phase 2: Execution Monitoring**

    Returns:
        Work session status with:
        - status: Current execution status
        - outputs_count: Number of outputs created
        - checkpoints: List of checkpoints (if any)
        - metadata: Execution metadata
    """
    user_id = user.get("sub") or user.get("user_id")
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid user token")

    try:
        supabase = create_client(
            os.getenv("SUPABASE_URL"),
            os.getenv("SUPABASE_SERVICE_ROLE_KEY")
        )

        # Fetch session with outputs and checkpoints
        session_response = supabase.table("work_tickets").select(
            "id, status, task_type, task_intent, metadata, created_at"
        ).eq("id", ticket_id).eq("project_id", project_id).single().execute()

        if not session_response.data:
            raise HTTPException(
                status_code=404,
                detail="Work session not found"
            )

        session = session_response.data

        # Get outputs count
        outputs_response = supabase.table("work_outputs").select(
            "id", count="exact"
        ).eq("work_ticket_id", ticket_id).execute()

        outputs_count = outputs_response.count or 0

        # Get checkpoints
        checkpoints_response = supabase.table("work_checkpoints").select(
            "id, reason, status, created_at"
        ).eq("work_ticket_id", ticket_id).order("created_at").execute()

        checkpoints = checkpoints_response.data or []

        return {
            "ticket_id": session["id"],
            "status": session["status"],
            "task_type": session["task_type"],
            "task_intent": session["task_intent"],
            "outputs_count": outputs_count,
            "checkpoints": checkpoints,
            "metadata": session.get("metadata", {}),
            "created_at": session["created_at"]
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"[GET STATUS] Failed to get status for session {ticket_id}: {e}")
        raise HTTPException(
            status_code=500,
            detail=f"Failed to get work session status: {str(e)}"
        )


@router.post("/{project_id}/work-sessions/{ticket_id}/checkpoints/{checkpoint_id}/approve")
async def approve_checkpoint(
    project_id: str = Path(..., description="Project ID"),
    ticket_id: str = Path(..., description="Work session ID"),
    checkpoint_id: str = Path(..., description="Checkpoint ID"),
    feedback: Optional[str] = None,
    user: dict = Depends(verify_jwt)
):
    """
    Approve a checkpoint, allowing execution to resume.

    **Phase 2: Checkpoint Approval**

    Body (optional):
        - feedback: User feedback/notes

    Flow:
    1. Validate checkpoint belongs to session
    2. Mark checkpoint as approved
    3. Optionally resume execution automatically
    """
    from services.checkpoint_handler import CheckpointHandler

    user_id = user.get("sub") or user.get("user_id")
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid user token")

    logger.info(
        f"[APPROVE CHECKPOINT] User {user_id} approving checkpoint {checkpoint_id} "
        f"in session {ticket_id}"
    )

    try:
        # Verify checkpoint belongs to session
        supabase = create_client(
            os.getenv("SUPABASE_URL"),
            os.getenv("SUPABASE_SERVICE_ROLE_KEY")
        )

        checkpoint_response = supabase.table("work_checkpoints").select(
            "id, work_ticket_id"
        ).eq("id", checkpoint_id).single().execute()

        if not checkpoint_response.data:
            raise HTTPException(status_code=404, detail="Checkpoint not found")

        if checkpoint_response.data["work_ticket_id"] != ticket_id:
            raise HTTPException(
                status_code=400,
                detail="Checkpoint does not belong to this work session"
            )

        # Approve checkpoint
        handler = CheckpointHandler()
        success = await handler.approve_checkpoint(
            checkpoint_id=checkpoint_id,
            reviewed_by_user_id=user_id,
            feedback=feedback
        )

        if not success:
            raise HTTPException(
                status_code=500,
                detail="Failed to approve checkpoint"
            )

        logger.info(f"[APPROVE CHECKPOINT] ✅ Checkpoint {checkpoint_id} approved")

        return {
            "checkpoint_id": checkpoint_id,
            "status": "approved",
            "message": "Checkpoint approved. Execution can resume."
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"[APPROVE CHECKPOINT] Failed: {e}")
        raise HTTPException(
            status_code=500,
            detail=f"Failed to approve checkpoint: {str(e)}"
        )


@router.post("/{project_id}/work-sessions/{ticket_id}/checkpoints/{checkpoint_id}/reject")
async def reject_checkpoint(
    project_id: str = Path(..., description="Project ID"),
    ticket_id: str = Path(..., description="Work session ID"),
    checkpoint_id: str = Path(..., description="Checkpoint ID"),
    rejection_reason: str = ...,
    user: dict = Depends(verify_jwt)
):
    """
    Reject a checkpoint, failing the work session.

    **Phase 2: Checkpoint Rejection**

    Body (required):
        - rejection_reason: Why checkpoint was rejected

    Side effects:
        - Marks checkpoint as rejected
        - Marks work session as failed
    """
    from services.checkpoint_handler import CheckpointHandler

    user_id = user.get("sub") or user.get("user_id")
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid user token")

    logger.info(
        f"[REJECT CHECKPOINT] User {user_id} rejecting checkpoint {checkpoint_id}: "
        f"{rejection_reason}"
    )

    try:
        # Verify checkpoint belongs to session
        supabase = create_client(
            os.getenv("SUPABASE_URL"),
            os.getenv("SUPABASE_SERVICE_ROLE_KEY")
        )

        checkpoint_response = supabase.table("work_checkpoints").select(
            "id, work_ticket_id"
        ).eq("id", checkpoint_id).single().execute()

        if not checkpoint_response.data:
            raise HTTPException(status_code=404, detail="Checkpoint not found")

        if checkpoint_response.data["work_ticket_id"] != ticket_id:
            raise HTTPException(
                status_code=400,
                detail="Checkpoint does not belong to this work session"
            )

        # Reject checkpoint
        handler = CheckpointHandler()
        success = await handler.reject_checkpoint(
            checkpoint_id=checkpoint_id,
            reviewed_by_user_id=user_id,
            rejection_reason=rejection_reason
        )

        if not success:
            raise HTTPException(
                status_code=500,
                detail="Failed to reject checkpoint"
            )

        logger.info(f"[REJECT CHECKPOINT] ✅ Checkpoint {checkpoint_id} rejected")

        return {
            "checkpoint_id": checkpoint_id,
            "status": "rejected",
            "message": "Checkpoint rejected. Work session marked as failed."
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"[REJECT CHECKPOINT] Failed: {e}")
        raise HTTPException(
            status_code=500,
            detail=f"Failed to reject checkpoint: {str(e)}"
        )


@router.get("/{project_id}/work-sessions/{ticket_id}/outputs")
async def get_work_ticket_outputs(
    project_id: str = Path(..., description="Project ID"),
    ticket_id: str = Path(..., description="Work session ID"),
    user: dict = Depends(verify_jwt)
):
    """
    Get all outputs for a work session.

    **Phase 3: Artifact Viewing**

    Returns list of outputs with raw content for inspection and QA.
    Used to evaluate agent output quality before building custom renderers.

    Returns:
        List of outputs with:
        - id: Artifact UUID
        - output_type: Type of output
        - content: Raw output content (jsonb)
        - agent_confidence: Confidence score (0-1)
        - agent_reasoning: Why agent created this
        - created_at: Timestamp
    """
    user_id = user.get("sub") or user.get("user_id")
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid user token")

    logger.info(
        f"[GET ARTIFACTS] Fetching outputs: session={ticket_id}, user={user_id}"
    )

    try:
        supabase = create_client(
            os.getenv("SUPABASE_URL"),
            os.getenv("SUPABASE_SERVICE_ROLE_KEY")
        )

        # Verify session belongs to user's project
        session_response = supabase.table("work_tickets").select(
            "id, project_id"
        ).eq("id", ticket_id).eq("project_id", project_id).single().execute()

        if not session_response.data:
            raise HTTPException(
                status_code=404,
                detail="Work session not found or does not belong to this project"
            )

        # Fetch all outputs for this session
        outputs_response = supabase.table("work_outputs").select(
            "id, output_type, content, agent_confidence, agent_reasoning, status, created_at"
        ).eq("work_ticket_id", ticket_id).order("created_at").execute()

        outputs = outputs_response.data or []

        logger.info(
            f"[GET ARTIFACTS] Found {len(outputs)} outputs for session {ticket_id}"
        )

        return outputs

    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"[GET ARTIFACTS] Failed: {e}")
        raise HTTPException(
            status_code=500,
            detail=f"Failed to fetch outputs: {str(e)}"
        )


@router.get("/{project_id}/work-sessions", response_model=WorkTicketsListResponse)
async def list_project_work_tickets(
    project_id: str = Path(..., description="Project ID"),
    status: Optional[str] = None,
    agent_id: Optional[str] = None,
    user: dict = Depends(verify_jwt)
):
    """
    List all work sessions for a project.

    Args:
        project_id: Project ID
        status: Optional status filter (pending, running, completed, failed)
        user: Authenticated user from JWT

    Returns:
        List of work sessions with summary info
    """
    user_id = user.get("sub") or user.get("user_id")
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid user token")

    logger.info(
        f"[PROJECT WORK SESSIONS LIST] Fetching sessions: project={project_id}, user={user_id}"
    )

    supabase = supabase_admin_client

    try:
        # Validate project exists and user has access (include basket_id for work_tickets query)
        project_response = supabase.table("projects").select(
            "id, name, user_id, basket_id"
        ).eq("id", project_id).single().execute()

        if not project_response.data:
            raise HTTPException(status_code=404, detail="Project not found")

        project = project_response.data

        # Verify user owns project
        if project["user_id"] != user_id:
            raise HTTPException(status_code=403, detail="Access denied")

        # Get basket_id for this project (work_tickets uses basket_id, not project_id)
        basket_id = project.get("basket_id")
        if not basket_id:
            raise HTTPException(status_code=404, detail="Project has no associated basket")

        # Build query for work tickets (Phase 2e schema)
        # work_tickets columns: id, work_request_id, agent_session_id, basket_id, agent_type, status, created_at, completed_at
        query = supabase.table("work_tickets").select(
            """
            id,
            agent_session_id,
            agent_type,
            status,
            created_at,
            completed_at,
            work_request_id,
            metadata
            """
        ).eq("basket_id", basket_id).order("created_at", desc=True)

        # Apply status filter if provided
        if status:
            query = query.eq("status", status)
        if agent_id:
            # agent_id parameter now refers to agent_session_id
            query = query.eq("agent_session_id", agent_id)

        sessions_response = query.execute()
        sessions = sessions_response.data or []

        # Get agent session info for each ticket
        session_list = []
        for session in sessions:
            agent_session_id = session.get("agent_session_id")
            agent_type = session.get("agent_type", "unknown")

            # Try to get display name from agent_sessions table if we have a session_id
            display_name = agent_type.replace("_", " ").title()
            if agent_session_id:
                agent_session_response = supabase.table("agent_sessions").select(
                    "id, agent_type"
                ).eq("id", agent_session_id).single().execute()
                if agent_session_response.data:
                    agent_type = agent_session_response.data.get("agent_type", agent_type)
                    display_name = agent_type.replace("_", " ").title()

            # Extract task description from metadata if available
            metadata = session.get("metadata", {})
            task_description = metadata.get("task_description") or metadata.get("task_intent") or "Work ticket"

            session_list.append(WorkTicketListItem(
                ticket_id=session["id"],
                agent_id=agent_session_id or "unknown",  # Use agent_session_id
                agent_type=agent_type,
                agent_display_name=display_name,
                task_description=task_description,
                status=session["status"],
                created_at=session["created_at"],
                completed_at=session.get("completed_at"),
            ))

        # Get status counts (using basket_id, not project_id)
        all_sessions_response = supabase.table("work_tickets").select(
            "status"
        ).eq("basket_id", basket_id).execute()

        status_counts = {}
        for sess in (all_sessions_response.data or []):
            status_val = sess["status"]
            status_counts[status_val] = status_counts.get(status_val, 0) + 1

        logger.info(
            f"[PROJECT WORK SESSIONS LIST] Found {len(session_list)} sessions for project {project_id}"
        )

        return WorkTicketsListResponse(
            sessions=session_list,
            total_count=len(all_sessions_response.data or []),
            status_counts=status_counts,
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"[PROJECT WORK SESSIONS LIST] Unexpected error: {e}")
        raise HTTPException(
            status_code=500,
            detail=f"Failed to fetch work sessions: {str(e)}"
        )


@router.get("/{project_id}/work-sessions/{ticket_id}", response_model=WorkTicketDetailResponse)
async def get_project_work_ticket(
    project_id: str = Path(..., description="Project ID"),
    ticket_id: str = Path(..., description="Work session ID"),
    user: dict = Depends(verify_jwt)
):
    """
    Get detailed information about a specific work session.

    Args:
        project_id: Project ID
        ticket_id: Work session ID
        user: Authenticated user from JWT

    Returns:
        Detailed work session information
    """
    user_id = user.get("sub") or user.get("user_id")
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid user token")

    logger.info(
        f"[PROJECT WORK SESSION DETAIL] Fetching session: "
        f"project={project_id}, session={ticket_id}, user={user_id}"
    )

    supabase = supabase_admin_client

    try:
        # Validate project exists and user has access
        project_response = supabase.table("projects").select(
            "id, name, user_id"
        ).eq("id", project_id).single().execute()

        if not project_response.data:
            raise HTTPException(status_code=404, detail="Project not found")

        project = project_response.data

        # Verify user owns project
        if project["user_id"] != user_id:
            raise HTTPException(status_code=403, detail="Access denied")

        # Fetch work session
        session_response = supabase.table("work_tickets").select(
            """
            id,
            project_id,
            project_agent_id,
            agent_work_request_id,
            task_intent,
            task_type,
            status,
            task_parameters,
            metadata,
            created_at,
            started_at,
            ended_at
            """
        ).eq("id", ticket_id).eq("project_id", project_id).single().execute()

        if not session_response.data:
            raise HTTPException(status_code=404, detail="Work session not found")

        session = session_response.data

        # Fetch agent session (refactored from project_agents)
        # The project_agent_id in work_tickets should now point to an agent_session
        agent_session_response = supabase.table("agent_sessions").select(
            "id, agent_type"
        ).eq("id", session["project_agent_id"]).single().execute()

        if not agent_session_response.data:
            raise HTTPException(status_code=404, detail="Agent session not found")

        agent_session = agent_session_response.data

        # Generate display name from agent_type (no display_name field in agent_sessions)
        agent_display_name = agent_session["agent_type"].replace("_", " ").title()

        # Count outputs for this session
        outputs_response = supabase.table("work_outputs").select(
            "id", count="exact"
        ).eq("work_ticket_id", ticket_id).execute()

        outputs_count = outputs_response.count if outputs_response.count is not None else 0

        logger.info(
            f"[PROJECT WORK SESSION DETAIL] Found session {ticket_id} with status {session['status']}, "
            f"{outputs_count} outputs"
        )

        # Extract metadata fields
        metadata = session.get("metadata") or {}
        priority = metadata.get("priority", 5)
        error_message = metadata.get("error_message")
        result_summary = metadata.get("result_summary")

        return WorkTicketDetailResponse(
            ticket_id=session["id"],
            project_id=session["project_id"],
            project_name=project["name"],
            agent_id=agent_session["id"],
            agent_type=agent_session["agent_type"],
            agent_display_name=agent_display_name,
            task_description=session["task_intent"],  # Fixed: use task_intent
            status=session["status"],
            task_type=session["task_type"],
            priority=priority,  # From metadata
            context=session["task_parameters"] or {},  # Fixed: use task_parameters
            work_request_id=session["agent_work_request_id"],
            created_at=session["created_at"],
            updated_at=session.get("started_at"),  # Use started_at as updated_at proxy
            completed_at=session.get("ended_at"),  # Fixed: use ended_at
            error_message=error_message,  # From metadata
            result_summary=result_summary,  # From metadata
            outputs_count=outputs_count,
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"[PROJECT WORK SESSION DETAIL] Unexpected error: {e}")
        raise HTTPException(
            status_code=500,
            detail=f"Failed to fetch work session: {str(e)}"
        )
