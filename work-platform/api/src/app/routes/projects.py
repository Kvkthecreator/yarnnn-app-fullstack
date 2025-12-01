"""
Projects API - Phase 6 Refactor: Project-First Onboarding

Endpoints for NEW user onboarding with project-based organization.

DOMAIN SEPARATION:
- Projects = User-facing containers (work-platform domain)
- Baskets = Storage infrastructure (substrate domain)

Work execution uses deterministic workflow endpoints (e.g., /api/work/research).
"""

from __future__ import annotations

import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from app.utils.jwt import verify_jwt
from app.routes.work_orchestration import _get_workspace_id_for_user
from services.project_scaffolder import (
    scaffold_new_project,
    ProjectScaffoldingError,
)
from utils.permissions import PermissionDeniedError

router = APIRouter(prefix="/projects", tags=["projects"])
logger = logging.getLogger(__name__)


# ========================================================================
# Request/Response Models
# ========================================================================


class CreateProjectRequest(BaseModel):
    """Request to create new project (NEW user onboarding).

    Creates TWO foundational anchor blocks:
    - Topic block (anchor_role: 'topic') - WHAT you're working on
    - Vision block (anchor_role: 'vision') - WHY you're working on it
    """

    project_name: str = Field(
        ...,
        description="Project name (used for display, often same as topic)",
        min_length=1,
        max_length=200,
    )
    project_topic: Optional[str] = Field(
        None,
        description="WHAT - Topic/brand/subject (creates topic anchor block). Falls back to project_name if not provided.",
        max_length=200,
    )
    project_intent: str = Field(
        ...,
        description="WHY - Project intent/vision (required, creates vision anchor block)",
        min_length=1,
        max_length=500,
    )
    initial_context: str = Field(
        default="",
        description="Initial context/notes from seed file (optional, triggers P1 extraction)",
        max_length=50000,
    )
    description: Optional[str] = Field(
        None,
        description="Optional project description for display",
        max_length=1000,
    )


class ProjectResponse(BaseModel):
    """Response from project creation."""

    project_id: str
    project_name: str
    basket_id: str
    dump_id: Optional[str] = None  # Optional - only created if initial_context provided
    topic_block_id: Optional[str] = None  # WHAT anchor block
    vision_block_id: Optional[str] = None  # WHY anchor block
    agent_session_ids: dict[str, str]  # Changed from agent_ids: list[str] to match scaffolder
    work_request_id: str
    status: str
    is_trial_request: bool
    remaining_trials: Optional[int]
    message: str
    next_step: str


# ========================================================================
# Endpoints
# ========================================================================


@router.post("/new", response_model=ProjectResponse)
async def create_project(
    request: CreateProjectRequest, user: dict = Depends(verify_jwt)
):
    """
    Create new project with complete infrastructure scaffolding (NEW users).

    Phase 6.5 Refactor: Creates PROJECT (pure container) with BASKET (storage) and ALL AGENTS.

    Orchestrates:
    1. Permission check (trial/subscription)
    2. Basket creation (substrate-api)
    3. Raw dump creation (substrate-api)
    4. Project creation (work-platform DB)
    5. Auto-scaffold ALL agents (research, content, reporting)
    6. Work request record (for trial tracking)

    Work execution uses deterministic workflow endpoints (e.g., /api/work/research).

    Args:
        request: Project creation parameters
        user: Authenticated user from JWT

    Returns:
        Project creation result with all 3 agents auto-created

    Example Request:
        {
            "project_name": "Healthcare AI Research",
            "initial_context": "Research latest AI developments in healthcare...",
            "description": "Comprehensive analysis of AI in healthcare"
        }

    Example Response:
        {
            "project_id": "550e8400-...",
            "project_name": "Healthcare AI Research",
            "basket_id": "660e8400-...",
            "dump_id": "770e8400-...",
            "agent_session_ids": {
                "thinking_partner": "990e8400-...",
                "research": "aa0e8400-...",
                "content": "bb0e8400-...",
                "reporting": "cc0e8400-..."
            },
            "work_request_id": "880e8400-...",
            "status": "active",
            "is_trial_request": true,
            "remaining_trials": 9,
            "message": "Project created successfully. Ready to begin work.",
            "next_step": "Navigate to /projects/550e8400-... to begin work"
        }
    """
    user_id = user.get("sub") or user.get("user_id")
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid user token")

    # Get workspace_id for user (reuse helper from agent_orchestration)
    workspace_id = await _get_workspace_id_for_user(user_id)

    logger.info(
        f"[PROJECTS API] Creating project: user={user_id}, workspace={workspace_id}"
    )

    try:
        result = await scaffold_new_project(
            user_id=user_id,
            workspace_id=workspace_id,
            project_name=request.project_name,
            project_intent=request.project_intent,
            project_topic=request.project_topic,
            initial_context=request.initial_context,
            description=request.description,
        )

        logger.info(
            f"[PROJECTS API] ✅ SUCCESS: project={result['project_id']}, "
            f"basket={result['basket_id']}"
        )

        return ProjectResponse(
            **result,
            message="Project created successfully. Ready to begin work.",
        )

    except PermissionDeniedError as e:
        logger.warning(f"[PROJECTS API] Permission denied: {e}")
        raise HTTPException(
            status_code=403,
            detail={
                "message": str(e),
                "remaining_trials": e.remaining_trials,
                "agent_type": e.agent_type,
            },
        )

    except ProjectScaffoldingError as e:
        logger.error(
            f"[PROJECTS API] Scaffolding failed at step '{e.step}': {e.message}"
        )
        raise HTTPException(
            status_code=500,
            detail={
                "message": e.message,
                "step": e.step,
                "project_id": e.project_id,
                "basket_id": e.basket_id,
                "dump_id": e.dump_id,
                "details": e.details,
            },
        )

    except Exception as e:
        logger.exception(f"[PROJECTS API] Unexpected error: {e}")
        raise HTTPException(
            status_code=500, detail=f"Failed to create project: {str(e)}"
        )
