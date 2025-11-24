"""Work Platform API routes - Phase 2e: Projects & Work Tickets.

NOTE: This file has been partially migrated from work_sessions to work_tickets.
However, the Phase 2e schema removes project_id from work_tickets (no longer exists).
Work tickets now only have work_request_id, agent_session_id, and denormalized fields.

TODO: This file needs more significant refactoring beyond renaming:
- Projects may no longer be the primary organizing concept
- Work tickets are now linked via work_requests (not projects)
- Consider if project-based endpoints still make sense

For now, renamed work_session → work_ticket for compilation.
"""

from datetime import datetime
from typing import List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel

from ..deps import get_db
from ..utils.jwt import verify_jwt
from ..utils.workspace import get_or_create_workspace
from .models import (
    Project,
    ProjectCreate,
    ProjectUpdate,
    ProjectWithStats,
    WorkTicket,
    WorkTicketCreate,
    WorkTicketUpdate,
    WorkTicketStatus,
    TaskType,
)
from .task_params import validate_task_params
# NOTE: Legacy executor.py deleted - work tickets now executed via workflow routes
# (workflow_research, workflow_content, workflow_reporting)

router = APIRouter(prefix="/work", tags=["work-platform"])


# ============================================================================
# Helper Functions
# ============================================================================


def _get_workspace_id(user: dict) -> str:
    """Extract or create workspace_id for user."""
    user_id = user.get("sub") or user.get("user_id")
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid user token")
    return get_or_create_workspace(user_id)


async def _validate_basket_exists(db, basket_id: UUID, workspace_id: str) -> bool:
    """Check if basket exists and user has access to it.

    NOTE: This currently just checks if basket exists in baskets table.
    TODO: Add proper workspace/permission validation.
    """
    query = """
        SELECT id FROM baskets
        WHERE id = :basket_id
        LIMIT 1
    """
    result = await db.fetch_one(query, {"basket_id": str(basket_id)})
    return result is not None


async def _check_basket_already_linked(db, basket_id: UUID) -> Optional[UUID]:
    """Check if basket is already linked to a project.

    Returns:
        Project ID if basket is already linked, None otherwise
    """
    query = """
        SELECT id FROM projects
        WHERE basket_id = :basket_id
        LIMIT 1
    """
    result = await db.fetch_one(query, {"basket_id": str(basket_id)})
    return UUID(result["id"]) if result else None


# ============================================================================
# Projects Endpoints
# ============================================================================


@router.post("/projects", response_model=Project, status_code=status.HTTP_201_CREATED)
async def create_project(
    request: ProjectCreate,
    user: dict = Depends(verify_jwt),
    db=Depends(get_db),
):
    """Create a new project linked to a basket.

    Projects are 1:1 with baskets (each basket can only have one project).

    Args:
        request: Project creation parameters
        user: Authenticated user from JWT
        db: Database connection

    Returns:
        Created project

    Raises:
        400: Basket doesn't exist or is already linked to another project
        401: Invalid user token

    Example Request:
        {
            "workspace_id": "550e8400-e29b-41d4-a716-446655440000",
            "basket_id": "660e8400-e29b-41d4-a716-446655440001",
            "name": "Acme Startup Marketing",
            "description": "All marketing and content work for Acme startup"
        }
    """
    workspace_id = _get_workspace_id(user)
    user_id = user.get("sub") or user.get("user_id")

    # Validate workspace_id matches user's workspace
    if str(request.workspace_id) != workspace_id:
        raise HTTPException(
            status_code=403,
            detail="Cannot create project in another user's workspace"
        )

    # Validate basket exists and user has access
    basket_exists = await _validate_basket_exists(db, request.basket_id, workspace_id)
    if not basket_exists:
        raise HTTPException(
            status_code=400,
            detail=f"Basket {request.basket_id} not found or access denied"
        )

    # Check if basket is already linked to a project (1:1 constraint)
    existing_project_id = await _check_basket_already_linked(db, request.basket_id)
    if existing_project_id:
        raise HTTPException(
            status_code=400,
            detail=f"Basket {request.basket_id} is already linked to project {existing_project_id}"
        )

    # Create project
    query = """
        INSERT INTO projects (
            workspace_id,
            basket_id,
            name,
            description,
            created_by_user_id,
            created_at,
            updated_at
        )
        VALUES (
            :workspace_id,
            :basket_id,
            :name,
            :description,
            :created_by_user_id,
            NOW(),
            NOW()
        )
        RETURNING *
    """

    values = {
        "workspace_id": str(request.workspace_id),
        "basket_id": str(request.basket_id),
        "name": request.name,
        "description": request.description,
        "created_by_user_id": user_id,
    }

    try:
        result = await db.fetch_one(query, values)
        if not result:
            raise HTTPException(
                status_code=500,
                detail="Failed to create project"
            )

        return Project(**dict(result))

    except Exception as e:
        # Handle unique constraint violation on basket_id
        if "unique_basket_per_project" in str(e) or "basket_id" in str(e):
            raise HTTPException(
                status_code=400,
                detail=f"Basket {request.basket_id} is already linked to another project"
            )
        raise HTTPException(
            status_code=500,
            detail=f"Failed to create project: {str(e)}"
        )


@router.get("/projects", response_model=List[ProjectWithStats])
async def list_projects(
    user: dict = Depends(verify_jwt),
    db=Depends(get_db),
):
    """List all projects for the current user's workspace.

    Returns projects with aggregated statistics:
    - Total work tickets count
    - Active tickets count (pending, running, paused)
    - Completed tickets count
    - Total artifacts count

    Args:
        user: Authenticated user from JWT
        db: Database connection

    Returns:
        List of projects with statistics
    """
    workspace_id = _get_workspace_id(user)

    query = """
        SELECT
            p.*,
            COUNT(DISTINCT ws.id) AS work_tickets_count,
            COUNT(DISTINCT CASE
                WHEN ws.status IN ('pending', 'running', 'paused')
                THEN ws.id
            END) AS active_tickets_count,
            COUNT(DISTINCT CASE
                WHEN ws.status = 'completed'
                THEN ws.id
            END) AS completed_tickets_count,
            COUNT(DISTINCT wa.id) AS total_artifacts_count
        FROM projects p
        LEFT JOIN work_tickets ws ON ws.project_id = p.id
        LEFT JOIN work_outputs wa ON wa.work_ticket_id = ws.id
        WHERE p.workspace_id = :workspace_id
        GROUP BY p.id
        ORDER BY p.created_at DESC
    """

    results = await db.fetch_all(query, {"workspace_id": workspace_id})

    return [ProjectWithStats(**dict(row)) for row in results]


@router.get("/projects/{project_id}", response_model=ProjectWithStats)
async def get_project(
    project_id: UUID,
    user: dict = Depends(verify_jwt),
    db=Depends(get_db),
):
    """Get project details with statistics.

    Args:
        project_id: Project UUID
        user: Authenticated user from JWT
        db: Database connection

    Returns:
        Project with statistics

    Raises:
        404: Project not found or access denied
    """
    workspace_id = _get_workspace_id(user)

    query = """
        SELECT
            p.*,
            COUNT(DISTINCT ws.id) AS work_tickets_count,
            COUNT(DISTINCT CASE
                WHEN ws.status IN ('pending', 'running', 'paused')
                THEN ws.id
            END) AS active_tickets_count,
            COUNT(DISTINCT CASE
                WHEN ws.status = 'completed'
                THEN ws.id
            END) AS completed_tickets_count,
            COUNT(DISTINCT wa.id) AS total_artifacts_count
        FROM projects p
        LEFT JOIN work_tickets ws ON ws.project_id = p.id
        LEFT JOIN work_outputs wa ON wa.work_ticket_id = ws.id
        WHERE p.id = :project_id AND p.workspace_id = :workspace_id
        GROUP BY p.id
    """

    result = await db.fetch_one(
        query,
        {"project_id": str(project_id), "workspace_id": workspace_id}
    )

    if not result:
        raise HTTPException(
            status_code=404,
            detail=f"Project {project_id} not found"
        )

    return ProjectWithStats(**dict(result))


@router.patch("/projects/{project_id}", response_model=Project)
async def update_project(
    project_id: UUID,
    request: ProjectUpdate,
    user: dict = Depends(verify_jwt),
    db=Depends(get_db),
):
    """Update project metadata (name, description).

    Args:
        project_id: Project UUID
        request: Update parameters (only provided fields will be updated)
        user: Authenticated user from JWT
        db: Database connection

    Returns:
        Updated project

    Raises:
        404: Project not found or access denied
    """
    workspace_id = _get_workspace_id(user)

    # Build dynamic update query based on provided fields
    update_fields = []
    values = {"project_id": str(project_id), "workspace_id": workspace_id}

    if request.name is not None:
        update_fields.append("name = :name")
        values["name"] = request.name

    if request.description is not None:
        update_fields.append("description = :description")
        values["description"] = request.description

    if not update_fields:
        # No fields to update, just return current project
        query = """
            SELECT * FROM projects
            WHERE id = :project_id AND workspace_id = :workspace_id
        """
        result = await db.fetch_one(query, values)
        if not result:
            raise HTTPException(status_code=404, detail="Project not found")
        return Project(**dict(result))

    # updated_at is automatically updated by trigger
    update_query = f"""
        UPDATE projects
        SET {', '.join(update_fields)}
        WHERE id = :project_id AND workspace_id = :workspace_id
        RETURNING *
    """

    result = await db.fetch_one(update_query, values)

    if not result:
        raise HTTPException(
            status_code=404,
            detail=f"Project {project_id} not found"
        )

    return Project(**dict(result))


@router.delete("/projects/{project_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_project(
    project_id: UUID,
    user: dict = Depends(verify_jwt),
    db=Depends(get_db),
):
    """Delete a project (CASCADE deletes all work tickets, artifacts, checkpoints).

    WARNING: This is a destructive operation. All work tickets and artifacts
    will be deleted. The linked basket will NOT be deleted.

    Args:
        project_id: Project UUID
        user: Authenticated user from JWT
        db: Database connection

    Raises:
        404: Project not found or access denied
    """
    workspace_id = _get_workspace_id(user)

    query = """
        DELETE FROM projects
        WHERE id = :project_id AND workspace_id = :workspace_id
        RETURNING id
    """

    result = await db.fetch_one(
        query,
        {"project_id": str(project_id), "workspace_id": workspace_id}
    )

    if not result:
        raise HTTPException(
            status_code=404,
            detail=f"Project {project_id} not found"
        )

    return None  # 204 No Content


# ============================================================================
# Work Sessions Endpoints
# ============================================================================


@router.post("/tickets", response_model=WorkTicket, status_code=status.HTTP_201_CREATED)
async def create_work_ticket(
    request: WorkTicketCreate,
    user: dict = Depends(verify_jwt),
    db=Depends(get_db),
):
    """Create a new work session within a project.

    Work tickets are individual work requests with:
    - Task type (research, content_creation, analysis)
    - Task intent (natural language description)
    - Task parameters (validated based on task_type)

    The session will be created in PENDING status and can be started later.

    Args:
        request: Work session creation parameters
        user: Authenticated user from JWT
        db: Database connection

    Returns:
        Created work session

    Raises:
        400: Invalid task parameters or project not found
        401: Invalid user token
        422: Validation error

    Example Request:
        {
            "project_id": "550e8400-e29b-41d4-a716-446655440000",
            "task_type": "content_creation",
            "task_intent": "Write a LinkedIn post about our AI sales assistant",
            "task_parameters": {
                "platform": "linkedin",
                "target_audience": "sales leaders",
                "tone": "professional",
                "length": "short",
                "cta": "Book a demo"
            }
        }
    """
    workspace_id = _get_workspace_id(user)
    user_id = user.get("sub") or user.get("user_id")

    # Validate project exists and get basket_id
    project_query = """
        SELECT id, basket_id, workspace_id
        FROM projects
        WHERE id = :project_id
        LIMIT 1
    """
    project = await db.fetch_one(project_query, {"project_id": str(request.project_id)})

    if not project:
        raise HTTPException(
            status_code=400,
            detail=f"Project {request.project_id} not found"
        )

    # Verify project belongs to user's workspace
    if project["workspace_id"] != workspace_id:
        raise HTTPException(
            status_code=403,
            detail="Cannot create work session in another user's project"
        )

    # Validate task_parameters based on task_type
    try:
        validated_params = validate_task_params(
            request.task_type.value,
            request.task_parameters
        )
    except ValueError as e:
        raise HTTPException(
            status_code=422,
            detail=f"Invalid task parameters: {str(e)}"
        )

    # Create work session
    query = """
        INSERT INTO work_tickets (
            project_id,
            basket_id,
            workspace_id,
            initiated_by_user_id,
            task_type,
            task_intent,
            task_parameters,
            status,
            created_at,
            metadata
        )
        VALUES (
            :project_id,
            :basket_id,
            :workspace_id,
            :initiated_by_user_id,
            :task_type,
            :task_intent,
            :task_parameters,
            :status,
            NOW(),
            '{}'::jsonb
        )
        RETURNING *
    """

    values = {
        "project_id": str(request.project_id),
        "basket_id": project["basket_id"],
        "workspace_id": workspace_id,
        "initiated_by_user_id": user_id,
        "task_type": request.task_type.value,
        "task_intent": request.task_intent,
        "task_parameters": validated_params,
        "status": WorkTicketStatus.PENDING.value,
    }

    try:
        result = await db.fetch_one(query, values)
        if not result:
            raise HTTPException(
                status_code=500,
                detail="Failed to create work session"
            )

        return WorkTicket(**dict(result))

    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to create work session: {str(e)}"
        )


@router.get("/tickets", response_model=List[WorkTicket])
async def list_work_tickets(
    project_id: Optional[UUID] = None,
    status: Optional[WorkTicketStatus] = None,
    limit: int = 50,
    offset: int = 0,
    user: dict = Depends(verify_jwt),
    db=Depends(get_db),
):
    """List work tickets for the current user's workspace.

    Optionally filter by project_id and/or status.

    Args:
        project_id: Filter by project (optional)
        status: Filter by session status (optional)
        limit: Maximum number of results (default 50, max 100)
        offset: Pagination offset (default 0)
        user: Authenticated user from JWT
        db: Database connection

    Returns:
        List of work tickets (most recent first)
    """
    workspace_id = _get_workspace_id(user)

    # Validate limit
    if limit > 100:
        limit = 100

    # Build query with optional filters
    where_clauses = ["ws.workspace_id = :workspace_id"]
    values = {"workspace_id": workspace_id, "limit": limit, "offset": offset}

    if project_id is not None:
        where_clauses.append("ws.project_id = :project_id")
        values["project_id"] = str(project_id)

    if status is not None:
        where_clauses.append("ws.status = :status")
        values["status"] = status.value

    where_sql = " AND ".join(where_clauses)

    query = f"""
        SELECT ws.*
        FROM work_tickets ws
        WHERE {where_sql}
        ORDER BY ws.created_at DESC
        LIMIT :limit OFFSET :offset
    """

    results = await db.fetch_all(query, values)

    return [WorkTicket(**dict(row)) for row in results]


# LEGACY ENDPOINT REMOVED: Work tickets are now executed via workflow-specific routes
# (workflow_research.py, workflow_content.py, workflow_reporting.py)
# This generic "start" endpoint is no longer used in Phase 2e architecture


@router.get("/tickets/{ticket_id}", response_model=WorkTicket)
async def get_work_ticket(
    ticket_id: UUID,
    user: dict = Depends(verify_jwt),
    db=Depends(get_db),
):
    """Get work session details.

    Args:
        ticket_id: Work session UUID
        user: Authenticated user from JWT
        db: Database connection

    Returns:
        Work session details

    Raises:
        404: Session not found or access denied
    """
    workspace_id = _get_workspace_id(user)

    query = """
        SELECT ws.*
        FROM work_tickets ws
        WHERE ws.id = :ticket_id AND ws.workspace_id = :workspace_id
    """

    result = await db.fetch_one(
        query,
        {"ticket_id": str(ticket_id), "workspace_id": workspace_id}
    )

    if not result:
        raise HTTPException(
            status_code=404,
            detail=f"Work session {ticket_id} not found"
        )

    return WorkTicket(**dict(result))


@router.get("/projects/{project_id}/tickets", response_model=List[WorkTicket])
async def list_project_tickets(
    project_id: UUID,
    status: Optional[WorkTicketStatus] = None,
    limit: int = 50,
    offset: int = 0,
    user: dict = Depends(verify_jwt),
    db=Depends(get_db),
):
    """List all work tickets for a specific project.

    Args:
        project_id: Project UUID
        status: Filter by session status (optional)
        limit: Maximum number of results (default 50, max 100)
        offset: Pagination offset (default 0)
        user: Authenticated user from JWT
        db: Database connection

    Returns:
        List of work tickets for the project (most recent first)

    Raises:
        404: Project not found or access denied
    """
    workspace_id = _get_workspace_id(user)

    # Verify project exists and user has access
    project_query = """
        SELECT id FROM projects
        WHERE id = :project_id AND workspace_id = :workspace_id
    """
    project = await db.fetch_one(
        project_query,
        {"project_id": str(project_id), "workspace_id": workspace_id}
    )

    if not project:
        raise HTTPException(
            status_code=404,
            detail=f"Project {project_id} not found"
        )

    # Validate limit
    if limit > 100:
        limit = 100

    # Build query with optional status filter
    where_clauses = [
        "ws.project_id = :project_id",
        "ws.workspace_id = :workspace_id"
    ]
    values = {
        "project_id": str(project_id),
        "workspace_id": workspace_id,
        "limit": limit,
        "offset": offset
    }

    if status is not None:
        where_clauses.append("ws.status = :status")
        values["status"] = status.value

    where_sql = " AND ".join(where_clauses)

    query = f"""
        SELECT ws.*
        FROM work_tickets ws
        WHERE {where_sql}
        ORDER BY ws.created_at DESC
        LIMIT :limit OFFSET :offset
    """

    results = await db.fetch_all(query, values)

    return [WorkTicket(**dict(row)) for row in results]


# LEGACY ENDPOINT REMOVED: Work tickets are now executed via workflow-specific routes
# (workflow_research.py, workflow_content.py, workflow_reporting.py)
# This generic "start" endpoint is no longer used in Phase 2e architecture
