"""
Work Orchestration API - Phase 4 + Phase 5

Core work execution infrastructure for YARNNN platform.
Creates work_requests, work_tickets, and orchestrates specialist agents.
Uses adapters to bridge SDK → substrate_client → substrate-api (BFF pattern).

Phase 5: Work-request-based trials (10 free requests total, then subscription).

Architecture: ALL specialist agents use Official Claude Agent SDK (v0.1.8+)
Entry Point: Thinking Partner gateway delegates to this orchestration layer.
"""

from __future__ import annotations

import logging
import os
from typing import Any, Dict, Optional
from uuid import UUID

from fastapi import APIRouter, HTTPException, Depends, Header
from pydantic import BaseModel, Field

# Import Phase 2c SDK components (all agents refactored)
from agents_sdk import (
    ResearchAgentSDK,
    ContentAgentSDK,
    ReportingAgentSDK,
)
from adapters.auth_adapter import AuthAdapter

# Import Phase 2d Knowledge Module loader
from work_orchestration import KnowledgeModuleLoader

# Import Phase 1-3 utilities
from app.utils.jwt import verify_jwt
from app.utils.supabase_client import supabase_client, supabase_admin_client

# Import Phase 5 permissions
from utils.permissions import (
    check_agent_work_request_allowed,
    record_work_request,
    update_work_request_status,
    get_trial_status,
    create_agent_subscription,
    PermissionDeniedError,
)

# Import work output service for BFF pattern
from services.work_output_service import write_agent_outputs

router = APIRouter(prefix="/agents", tags=["work-orchestration"])
logger = logging.getLogger(__name__)

logger.info("Work orchestration initialized - Phase 2c complete (all agents using SDK patterns)")


async def _get_workspace_id_for_user(user_id: str) -> str:
    """
    Get workspace_id for user using existing authorization pattern.

    Pattern from work_tickets.py: Query workspace_memberships table.

    Args:
        user_id: User ID from JWT

    Returns:
        workspace_id for the user

    Raises:
        HTTPException: If user has no workspace or workspace not found
    """
    supabase = supabase_admin_client

    # Query workspace_memberships (existing pattern)
    response = supabase.table("workspace_memberships").select(
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
    Validate that basket belongs to workspace (existing pattern).

    Pattern from work_tickets.py: Query baskets with workspace_id filter.

    Args:
        basket_id: Basket ID
        workspace_id: Workspace ID

    Raises:
        HTTPException: If basket not found or doesn't belong to workspace
    """
    supabase = supabase_admin_client

    # Validate basket ownership (existing pattern)
    response = supabase.table("baskets").select("id").eq(
        "id", basket_id
    ).eq("workspace_id", workspace_id).execute()

    if not response.data:
        logger.error(f"Basket {basket_id} not found in workspace {workspace_id}")
        raise HTTPException(
            status_code=404,
            detail="Basket not found or access denied"
        )

    logger.debug(f"Validated basket {basket_id} belongs to workspace {workspace_id}")


async def _create_work_ticket(
    basket_id: str,
    workspace_id: str,
    user_id: str,
    agent_type: str,
    task_intent: str,
    project_id: Optional[str] = None,
) -> str:
    """
    Create a work session for tracking agent outputs.

    Args:
        basket_id: Basket ID
        workspace_id: Workspace ID
        user_id: User ID
        agent_type: Type of agent (research, content, reporting)
        task_intent: Description of the task
        project_id: Optional project ID (will be looked up if not provided)

    Returns:
        work_ticket_id (UUID string)
    """
    from datetime import datetime

    # Get project_id if not provided (required field)
    if not project_id:
        try:
            project = supabase_admin_client.table("projects").select("id").eq(
                "basket_id", basket_id
            ).limit(1).execute()
            if project.data and len(project.data) > 0:
                project_id = project.data[0]["id"]
            else:
                # Create a default project if none exists
                logger.warning(f"No project found for basket {basket_id}, work session creation may fail")
                # Use a placeholder - this should be fixed in proper project setup
                project_id = basket_id  # Fallback to basket_id as project_id
        except Exception as e:
            logger.warning(f"Failed to get project_id for basket {basket_id}: {e}")
            project_id = basket_id  # Fallback

    session_data = {
        "project_id": project_id,
        "basket_id": basket_id,
        "workspace_id": workspace_id,
        "initiated_by_user_id": user_id,
        "task_type": agent_type,
        "task_intent": task_intent,
        "task_parameters": {},
        "status": "running",
        "started_at": datetime.utcnow().isoformat(),
    }

    result = supabase_admin_client.table("work_tickets").insert(session_data).execute()

    if not result.data:
        raise ValueError("Failed to create work session")

    ticket_id = result.data[0]["id"]
    logger.info(f"Created work session {ticket_id} for {agent_type} task")
    return ticket_id


async def _update_work_ticket_status(
    ticket_id: str,
    status: str,
    output_count: int = 0,
) -> None:
    """
    Update work session status after execution.

    Args:
        ticket_id: Work session ID
        status: New status (completed, failed)
        output_count: Number of outputs written
    """
    from datetime import datetime

    update_data = {
        "status": status,
        "ended_at": datetime.utcnow().isoformat(),
        "metadata": {
            "output_count": output_count,
        }
    }

    supabase_admin_client.table("work_tickets").update(update_data).eq("id", ticket_id).execute()
    logger.info(f"Updated work session {ticket_id} to status={status}, outputs={output_count}")


class AgentTaskRequest(BaseModel):
    """Request to run agent task."""
    agent_type: str = Field(..., description="Agent type: research, content, reporting")
    task_type: str = Field(..., description="Task type specific to agent")
    basket_id: str = Field(..., description="Basket ID for agent context")
    parameters: Optional[Dict[str, Any]] = Field(default_factory=dict, description="Task parameters")


class AgentTaskResponse(BaseModel):
    """Response from agent task execution."""
    status: str
    agent_type: str
    task_type: str
    message: str
    result: Optional[Dict[str, Any]] = None
    error: Optional[str] = None
    work_request_id: Optional[str] = None  # Phase 5: Track work request
    is_trial_request: Optional[bool] = None  # Phase 5: Trial vs subscription
    remaining_trials: Optional[int] = None  # Phase 5: Remaining trial requests


@router.post("/run", response_model=AgentTaskResponse, deprecated=True)
async def run_agent_task(
    request: AgentTaskRequest,
    user: dict = Depends(verify_jwt)
):
    """
    [DEPRECATED] Direct agent invocation endpoint.

    ⚠️  DEPRECATED: This endpoint is for internal/testing use only.
    ⚠️  Users should interact via Thinking Partner gateway: POST /api/tp/chat
    ⚠️  TP decides when to create work_requests and orchestrate specialist agents.

    This endpoint bypasses TP intelligence and should NOT be used by frontend.
    Maintained for backward compatibility and system testing only.

    Phase 4: Uses adapters to bridge SDK → substrate_client → substrate-api.
    Phase 5: Enforces 10 trial work requests, then requires subscription.

    Args:
        request: Agent task request
        user: Authenticated user from JWT

    Returns:
        Task execution result

    Raises:
        HTTPException: On configuration, permission, or execution errors
    """
    user_id = user.get("sub") or user.get("user_id")
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid user token")

    logger.info(
        f"Running agent task: type={request.agent_type}, "
        f"task={request.task_type}, basket={request.basket_id}, user={user_id}"
    )

    work_request_id = None
    work_ticket_id = None

    try:
        # Phase 5: Get workspace_id for permission checks
        workspace_id = await _get_workspace_id_for_user(user_id)

        # Phase 5: Check if user can make work request (trial or subscription)
        try:
            permission_info = await check_agent_work_request_allowed(
                user_id=user_id,
                workspace_id=workspace_id,
                agent_type=request.agent_type
            )
        except PermissionDeniedError as e:
            logger.warning(f"Permission denied for user {user_id}: {e}")
            raise HTTPException(
                status_code=403,
                detail=str(e)
            )

        # Phase 5: Record work request BEFORE execution (for trial counting)
        work_request_id = await record_work_request(
            user_id=user_id,
            workspace_id=workspace_id,
            basket_id=request.basket_id,
            agent_type=request.agent_type,
            work_mode=request.task_type,
            request_payload=request.parameters or {},
            permission_info=permission_info
        )

        logger.info(f"Work request recorded: {work_request_id} (trial={not permission_info.get('is_subscribed')})")

        # Phase 5: Update status to running
        await update_work_request_status(work_request_id, "running")

        # Create work session for tracking outputs (BFF pattern)
        task_intent = f"{request.agent_type}:{request.task_type}"
        if request.parameters:
            task_intent += f" - {str(request.parameters)[:100]}"

        work_ticket_id = await _create_work_ticket(
            basket_id=request.basket_id,
            workspace_id=workspace_id,
            user_id=user_id,
            agent_type=request.agent_type,
            task_intent=task_intent,
        )

        # Execute based on agent type
        if request.agent_type == "research":
            result = await _run_research_agent(request, user_id, work_ticket_id)

        elif request.agent_type == "content":
            result = await _run_content_agent(request, user_id, work_ticket_id)

        elif request.agent_type == "reporting":
            result = await _run_reporting_agent(request, user_id, work_ticket_id)

        else:
            raise HTTPException(
                status_code=400,
                detail=f"Unknown agent type: {request.agent_type}"
            )

        # Write agent outputs to substrate-API via BFF pattern
        work_outputs = result.get("work_outputs", [])
        output_write_result = {"outputs_written": 0, "output_ids": [], "errors": []}

        if work_outputs:
            logger.info(f"Writing {len(work_outputs)} outputs to substrate-API")
            output_write_result = write_agent_outputs(
                basket_id=request.basket_id,
                work_ticket_id=work_ticket_id,
                agent_type=request.agent_type,
                outputs=work_outputs,
                metadata={"work_request_id": work_request_id},
            )
            logger.info(f"Wrote {output_write_result['outputs_written']} outputs successfully")

        # Update work session status
        session_status = "completed" if output_write_result.get("success", True) else "completed_with_errors"
        await _update_work_ticket_status(
            work_ticket_id,
            session_status,
            output_count=output_write_result.get("outputs_written", 0)
        )

        logger.info(f"Agent task completed successfully: {request.agent_type}/{request.task_type}")

        # Phase 5: Update status to completed
        await update_work_request_status(
            work_request_id,
            "completed",
            result_summary=f"Completed {request.task_type} task with {output_write_result.get('outputs_written', 0)} outputs"
        )

        # Add output info to result
        result["work_ticket_id"] = work_ticket_id
        result["outputs_written"] = output_write_result.get("outputs_written", 0)
        result["output_ids"] = output_write_result.get("output_ids", [])

        return AgentTaskResponse(
            status="completed",
            agent_type=request.agent_type,
            task_type=request.task_type,
            message=f"{request.agent_type} task completed successfully with {output_write_result.get('outputs_written', 0)} outputs for review",
            result=result,
            work_request_id=work_request_id,
            is_trial_request=not permission_info.get("is_subscribed", False),
            remaining_trials=permission_info.get("remaining_trial_requests")
        )

    except ValueError as e:
        logger.error(f"Configuration error: {e}")
        if work_ticket_id:
            await _update_work_ticket_status(work_ticket_id, "failed", 0)
        if work_request_id:
            await update_work_request_status(work_request_id, "failed", error_message=str(e))
        raise HTTPException(
            status_code=500,
            detail=f"Configuration error: {str(e)}"
        )

    except ImportError as e:
        logger.error(f"SDK not installed: {e}")
        if work_ticket_id:
            await _update_work_ticket_status(work_ticket_id, "failed", 0)
        if work_request_id:
            await update_work_request_status(work_request_id, "failed", error_message=str(e))
        raise HTTPException(
            status_code=500,
            detail="Claude Agent SDK not installed. Contact administrator."
        )

    except HTTPException:
        # Re-raise HTTPExceptions (permission denied, etc.)
        if work_ticket_id:
            await _update_work_ticket_status(work_ticket_id, "failed", 0)
        if work_request_id:
            await update_work_request_status(work_request_id, "failed", error_message="Permission denied")
        raise

    except Exception as e:
        logger.exception(f"Agent task failed: {e}")
        if work_ticket_id:
            await _update_work_ticket_status(work_ticket_id, "failed", 0)
        if work_request_id:
            await update_work_request_status(work_request_id, "failed", error_message=str(e))

        return AgentTaskResponse(
            status="failed",
            agent_type=request.agent_type,
            task_type=request.task_type,
            message=f"Task execution failed: {str(e)}",
            error=str(e),
            work_request_id=work_request_id
        )


async def _run_research_agent(
    request: AgentTaskRequest,
    user_id: str,
    work_ticket_id: str,
) -> Dict[str, Any]:
    """
    Run research agent task with enhanced context (assets + config).

    Args:
        request: Task request
        user_id: User ID
        work_ticket_id: Work session ID for output tracking

    Returns:
        Task result with work_outputs list

    Raises:
        HTTPException: On invalid task type
    """
    logger.info(f"Creating research agent for basket {request.basket_id}")

    # Get workspace_id for user (existing pattern from work_tickets.py)
    workspace_id = await _get_workspace_id_for_user(user_id)

    # Validate basket access (existing pattern from work_tickets.py)
    await _validate_basket_access(request.basket_id, workspace_id)

    # Phase 1+2: Get project_id for agent config
    project_id = None
    try:
        project = supabase_admin_client.table("projects").select("id").eq(
            "basket_id", request.basket_id
        ).limit(1).execute()
        if project.data and len(project.data) > 0:
            project_id = project.data[0]["id"]
            logger.debug(f"Found project_id={project_id} for basket {request.basket_id}")
    except Exception as e:
        logger.warning(f"Failed to get project_id for basket {request.basket_id}: {e}")

    # Phase 2d: Load knowledge modules for agent
    km_loader = KnowledgeModuleLoader()
    knowledge_modules = km_loader.load_for_agent("research")

    # Phase 2: Create ResearchAgentSDK (refactored with Skills)
    logger.info(f"Creating ResearchAgentSDK (basket={request.basket_id})")
    agent = ResearchAgentSDK(
        basket_id=request.basket_id,
        workspace_id=workspace_id,
        work_ticket_id=work_ticket_id,
        knowledge_modules=knowledge_modules,
    )

    # Execute task
    if request.task_type == "monitor":
        logger.info("Running research monitoring")
        result = await agent.monitor()
        return result

    elif request.task_type == "deep_dive":
        topic = request.parameters.get("topic")
        if not topic:
            raise HTTPException(
                status_code=400,
                detail="Topic required for deep_dive tasks"
            )

        logger.info(f"Running deep dive research on: {topic}")
        result = await agent.deep_dive(topic)
        return result

    else:
        raise HTTPException(
            status_code=400,
            detail=f"Unknown task type: {request.task_type}. "
                   f"Supported: monitor, deep_dive"
        )


async def _run_content_agent(
    request: AgentTaskRequest,
    user_id: str,
    work_ticket_id: str,
) -> Dict[str, Any]:
    """
    Run content creator agent task with enhanced context (assets + config).

    Args:
        request: Task request
        user_id: User ID
        work_ticket_id: Work session ID for output tracking

    Returns:
        Task result with work_outputs list

    Raises:
        HTTPException: On invalid task type or missing parameters
    """
    logger.info(f"Creating content agent for basket {request.basket_id}")

    # Get workspace_id for user (existing pattern from work_tickets.py)
    workspace_id = await _get_workspace_id_for_user(user_id)

    # Validate basket access (existing pattern from work_tickets.py)
    await _validate_basket_access(request.basket_id, workspace_id)

    # Phase 1+2: Get project_id for agent config
    project_id = None
    try:
        project = supabase_admin_client.table("projects").select("id").eq(
            "basket_id", request.basket_id
        ).limit(1).execute()
        if project.data and len(project.data) > 0:
            project_id = project.data[0]["id"]
            logger.debug(f"Found project_id={project_id} for basket {request.basket_id}")
    except Exception as e:
        logger.warning(f"Failed to get project_id for basket {request.basket_id}: {e}")

    # Phase 2d: Load knowledge modules for agent
    km_loader = KnowledgeModuleLoader()
    knowledge_modules = km_loader.load_for_agent("content")

    # Create agent with SDK pattern (Phase 2c)
    agent = ContentAgentSDK(
        basket_id=request.basket_id,
        workspace_id=workspace_id,
        knowledge_modules=knowledge_modules,
    )

    # Execute task
    if request.task_type == "create":
        platform = request.parameters.get("platform")
        topic = request.parameters.get("topic")
        content_type = request.parameters.get("content_type", "post")

        if not platform or not topic:
            raise HTTPException(
                status_code=400,
                detail="Platform and topic required for create tasks"
            )

        logger.info(f"Creating content for {platform}: {topic}")
        result = await agent.create(
            platform=platform,
            topic=topic,
            content_type=content_type
        )
        return result

    elif request.task_type == "repurpose":
        source_content = request.parameters.get("source_content")
        source_platform = request.parameters.get("source_platform")
        target_platforms = request.parameters.get("target_platforms", [])

        if not source_content or not source_platform or not target_platforms:
            raise HTTPException(
                status_code=400,
                detail="source_content, source_platform, and target_platforms required"
            )

        logger.info(f"Repurposing content from {source_platform} to {target_platforms}")
        result = await agent.repurpose(
            source_content=source_content,
            source_platform=source_platform,
            target_platforms=target_platforms
        )
        return result

    else:
        raise HTTPException(
            status_code=400,
            detail=f"Unknown task type: {request.task_type}. "
                   f"Supported: create, repurpose"
        )


async def _run_reporting_agent(
    request: AgentTaskRequest,
    user_id: str,
    work_ticket_id: str,
) -> Dict[str, Any]:
    """
    Run reporting agent task with enhanced context (assets + config).

    Args:
        request: Task request
        user_id: User ID
        work_ticket_id: Work session ID for output tracking

    Returns:
        Task result with work_outputs list

    Raises:
        HTTPException: On invalid task type or missing parameters
    """
    logger.info(f"Creating reporting agent for basket {request.basket_id}")

    # Get workspace_id for user (existing pattern from work_tickets.py)
    workspace_id = await _get_workspace_id_for_user(user_id)

    # Validate basket access (existing pattern from work_tickets.py)
    await _validate_basket_access(request.basket_id, workspace_id)

    # Phase 1+2: Get project_id for agent config
    project_id = None
    try:
        project = supabase_admin_client.table("projects").select("id").eq(
            "basket_id", request.basket_id
        ).limit(1).execute()
        if project.data and len(project.data) > 0:
            project_id = project.data[0]["id"]
            logger.debug(f"Found project_id={project_id} for basket {request.basket_id}")
    except Exception as e:
        logger.warning(f"Failed to get project_id for basket {request.basket_id}: {e}")

    # Phase 2d: Load knowledge modules for agent
    km_loader = KnowledgeModuleLoader()
    knowledge_modules = km_loader.load_for_agent("reporting")

    # Create agent with SDK pattern (Phase 2c)
    agent = ReportingAgentSDK(
        basket_id=request.basket_id,
        workspace_id=workspace_id,
        knowledge_modules=knowledge_modules,
    )

    # Execute task
    if request.task_type == "generate":
        report_type = request.parameters.get("report_type", "summary")
        format_type = request.parameters.get("format", "pdf")
        data = request.parameters.get("data", {})

        logger.info(f"Generating {report_type} report in {format_type} format")
        result = await agent.generate(
            report_type=report_type,
            format=format_type,
            data=data
        )
        return result

    else:
        raise HTTPException(
            status_code=400,
            detail=f"Unknown task type: {request.task_type}. "
                   f"Supported: generate"
        )


@router.get("/capabilities")
async def get_agent_capabilities():
    """
    Get capabilities of all agents.

    Returns:
        Dictionary of agent capabilities
    """
    return {
        "research": {
            "tasks": {
                "monitor": {
                    "description": "Continuous monitoring across configured domains",
                    "parameters": []
                },
                "deep_dive": {
                    "description": "Deep research on specific topic",
                    "parameters": ["topic (required)"]
                }
            },
            "subagents": ["web_monitor", "competitor_tracker", "social_listener", "analyst"]
        },
        "content": {
            "tasks": {
                "create": {
                    "description": "Platform-specific content creation",
                    "parameters": ["platform (required)", "topic (required)", "content_type (optional)"]
                },
                "repurpose": {
                    "description": "Cross-platform content adaptation",
                    "parameters": [
                        "source_content (required)",
                        "source_platform (required)",
                        "target_platforms (required, array)"
                    ]
                }
            },
            "subagents": ["twitter_writer", "linkedin_writer", "blog_writer", "instagram_creator", "repurposer"]
        },
        "reporting": {
            "tasks": {
                "generate": {
                    "description": "Multi-format document generation",
                    "parameters": [
                        "report_type (optional, default: summary)",
                        "format (optional, default: pdf)",
                        "data (optional, object)"
                    ]
                }
            },
            "subagents": ["excel_specialist", "presentation_designer", "report_writer", "data_analyst"]
        },
        "architecture": {
            "pattern": "SDK + Adapters + BFF",
            "adapters": ["SubstrateQueryAdapter", "SubstrateGovernanceAdapter", "AuthAdapter"],
            "backend": "substrate-api (via substrate_client HTTP)"
        }
    }


# =====================================================================
# Phase 5: Trial & Subscription Endpoints
# =====================================================================


@router.get("/trial-status")
async def get_user_trial_status(user: dict = Depends(verify_jwt)):
    """
    Get user's trial status (remaining free work requests).

    Phase 5: Users get 10 FREE work requests total across all agents.

    Args:
        user: Authenticated user from JWT

    Returns:
        Trial status with remaining requests and active subscriptions

    Example Response:
        {
            "used_trial_requests": 3,
            "remaining_trial_requests": 7,
            "total_trial_limit": 10,
            "subscribed_agents": ["research"]
        }
    """
    user_id = user.get("sub") or user.get("user_id")
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid user token")

    workspace_id = await _get_workspace_id_for_user(user_id)

    trial_status = await get_trial_status(user_id=user_id, workspace_id=workspace_id)

    return trial_status


class AgentInfo(BaseModel):
    """Agent information from catalog."""
    agent_type: str
    name: str
    description: str
    monthly_price_usd: float
    trial_limit: int
    is_subscribed: bool


@router.get("/marketplace")
async def get_agent_marketplace(user: dict = Depends(verify_jwt)):
    """
    Get available agents with pricing and subscription status.

    Phase 5: Lists all agents users can "hire" with monthly pricing.

    Args:
        user: Authenticated user from JWT

    Returns:
        List of available agents with pricing and subscription status

    Example Response:
        {
            "agents": [
                {
                    "agent_type": "research",
                    "name": "Research Agent",
                    "description": "Monitors domains...",
                    "monthly_price_usd": 19.00,
                    "trial_limit": 10,
                    "is_subscribed": false
                },
                ...
            ],
            "trial_status": {
                "remaining_trial_requests": 7
            }
        }
    """
    user_id = user.get("sub") or user.get("user_id")
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid user token")

    workspace_id = await _get_workspace_id_for_user(user_id)
    supabase = supabase_admin_client

    try:
        # Get all active agents from catalog
        catalog_response = supabase.table("agent_catalog").select(
            "agent_type, name, description, monthly_price_cents, trial_work_requests"
        ).eq("is_active", True).order("agent_type").execute()

        if not catalog_response.data:
            return {"agents": [], "trial_status": {"remaining_trial_requests": 10}}

        # Get user's subscriptions
        subs_response = supabase.table("user_agent_subscriptions").select(
            "agent_type"
        ).eq("user_id", user_id).eq(
            "workspace_id", workspace_id
        ).eq("status", "active").execute()

        subscribed_types = {sub["agent_type"] for sub in subs_response.data} if subs_response.data else set()

        # Build agent list
        agents = []
        for agent in catalog_response.data:
            agents.append({
                "agent_type": agent["agent_type"],
                "name": agent["name"],
                "description": agent["description"],
                "monthly_price_usd": agent["monthly_price_cents"] / 100.0,
                "trial_limit": agent["trial_work_requests"],
                "is_subscribed": agent["agent_type"] in subscribed_types
            })

        # Get trial status
        trial_status = await get_trial_status(user_id=user_id, workspace_id=workspace_id)

        return {
            "agents": agents,
            "trial_status": {
                "remaining_trial_requests": trial_status["remaining_trial_requests"],
                "used_trial_requests": trial_status["used_trial_requests"]
            }
        }

    except Exception as e:
        logger.error(f"Error fetching marketplace: {e}")
        raise HTTPException(
            status_code=500,
            detail=f"Failed to fetch marketplace: {str(e)}"
        )


class SubscribeRequest(BaseModel):
    """Request to subscribe to an agent."""
    stripe_subscription_id: Optional[str] = Field(None, description="Stripe subscription ID (optional for now)")
    stripe_customer_id: Optional[str] = Field(None, description="Stripe customer ID (optional for now)")


class SubscribeResponse(BaseModel):
    """Response from subscription creation."""
    subscription_id: str
    agent_type: str
    monthly_price_usd: float
    status: str
    message: str


@router.post("/subscribe/{agent_type}", response_model=SubscribeResponse)
async def subscribe_to_agent(
    agent_type: str,
    request: SubscribeRequest,
    user: dict = Depends(verify_jwt)
):
    """
    Subscribe to an agent (unlock unlimited work requests).

    Phase 5: Users "hire" agents individually with monthly subscriptions.
    Each subscription unlocks unlimited work requests for that specific agent.

    Args:
        agent_type: Agent type to subscribe to ('research', 'content', 'reporting')
        request: Subscription request with optional Stripe IDs
        user: Authenticated user from JWT

    Returns:
        Subscription details

    Example Response:
        {
            "subscription_id": "550e8400-e29b-41d4-a716-446655440000",
            "agent_type": "research",
            "monthly_price_usd": 19.00,
            "status": "active",
            "message": "Successfully subscribed to research agent"
        }
    """
    user_id = user.get("sub") or user.get("user_id")
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid user token")

    workspace_id = await _get_workspace_id_for_user(user_id)

    # Create subscription
    subscription_id = await create_agent_subscription(
        user_id=user_id,
        workspace_id=workspace_id,
        agent_type=agent_type,
        stripe_subscription_id=request.stripe_subscription_id,
        stripe_customer_id=request.stripe_customer_id
    )

    # Get pricing from catalog
    supabase = supabase_admin_client
    catalog = supabase.table("agent_catalog").select("monthly_price_cents").eq(
        "agent_type", agent_type
    ).single().execute()

    monthly_price = catalog.data["monthly_price_cents"] / 100.0

    logger.info(f"User {user_id} subscribed to {agent_type} agent (${monthly_price}/mo)")

    return SubscribeResponse(
        subscription_id=subscription_id,
        agent_type=agent_type,
        monthly_price_usd=monthly_price,
        status="active",
        message=f"Successfully subscribed to {agent_type} agent"
    )
