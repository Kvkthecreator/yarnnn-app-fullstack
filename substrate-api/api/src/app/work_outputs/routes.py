"""
API routes for work outputs management (Work Supervision Lifecycle).

Pattern: Follows reference_assets routes structure with JWT auth.
All endpoints are user-facing with workspace-scoped access control.
"""

from __future__ import annotations

import json
import logging
from datetime import datetime
from typing import List, Optional, Union
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field, field_validator
import anthropic
import io

from ..utils.jwt import verify_jwt
from ..utils.service_auth import verify_user_or_service
from ..utils.supabase_client import supabase_admin_client

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/baskets", tags=["work-outputs"])


# ============================================================================
# Pydantic Schemas
# ============================================================================


class WorkOutputCreate(BaseModel):
    """Schema for creating a work output."""
    basket_id: str
    work_ticket_id: str
    output_type: str
    agent_type: str
    title: str = Field(..., max_length=200)
    body: Optional[str] = None  # TEXT column (can be JSON string or plain text)
    confidence: float = Field(..., ge=0, le=1)
    source_context_ids: List[str] = Field(default_factory=list)
    tool_call_id: Optional[str] = None
    metadata: dict = Field(default_factory=dict)

    # File output fields (mutually exclusive with body)
    file_id: Optional[str] = None
    file_format: Optional[str] = None
    file_size_bytes: Optional[int] = None
    mime_type: Optional[str] = None
    generation_method: str = "text"
    skill_metadata: Optional[dict] = None

    @field_validator('source_context_ids', mode='before')
    @classmethod
    def parse_source_context_ids(cls, v: Union[str, List[str]]) -> List[str]:
        """Parse source_context_ids from string to list if needed."""
        if isinstance(v, str):
            # Handle empty string
            if not v or v.strip() == "":
                return []
            # Handle JSON string like "[]" or '["id1", "id2"]'
            try:
                parsed = json.loads(v)
                if isinstance(parsed, list):
                    return parsed
                return []
            except (json.JSONDecodeError, ValueError):
                # Not valid JSON, return empty list
                return []
        elif isinstance(v, list):
            return v
        else:
            return []


class WorkOutputStatusUpdate(BaseModel):
    """Schema for updating work output supervision status."""
    supervision_status: str = Field(..., pattern="^(approved|rejected|revision_requested|archived)$")
    reviewer_notes: Optional[str] = None
    reviewer_id: Optional[str] = None


class WorkOutputResponse(BaseModel):
    """Response schema for work output."""
    id: str
    basket_id: str
    work_ticket_id: str
    output_type: str
    agent_type: str
    title: str
    body: Optional[str]  # TEXT column
    confidence: float
    source_context_ids: List[str]
    tool_call_id: Optional[str]
    supervision_status: str
    reviewer_notes: Optional[str]
    reviewed_at: Optional[datetime]
    reviewed_by: Optional[str]
    created_at: datetime
    updated_at: datetime
    metadata: dict

    # File output fields
    file_id: Optional[str] = None
    file_format: Optional[str] = None
    file_size_bytes: Optional[int] = None
    mime_type: Optional[str] = None
    generation_method: Optional[str] = None
    skill_metadata: Optional[dict] = None


class WorkOutputListResponse(BaseModel):
    """Response schema for listing work outputs."""
    outputs: List[dict]
    total: int
    basket_id: str


class SupervisionStatsResponse(BaseModel):
    """Response schema for supervision statistics."""
    total_outputs: int
    pending_review: int
    approved: int
    rejected: int
    revision_requested: int


# ============================================================================
# Helper Functions
# ============================================================================


async def get_workspace_id_from_basket(basket_id: str) -> str:
    """Get workspace_id for a basket (for authorization)."""
    if not supabase_admin_client:
        raise HTTPException(status_code=500, detail="Supabase client not initialized")

    result = supabase_admin_client.table("baskets").select("workspace_id").eq("id", basket_id).single().execute()

    if not result.data:
        raise HTTPException(status_code=404, detail="Basket not found")

    return result.data["workspace_id"]


async def verify_workspace_access(basket_id: str, auth_info: dict) -> str:
    """
    Verify caller has access to basket's workspace.

    For user JWT: Checks workspace membership.
    For service auth: Trusts the service (work-platform already verified).
    """
    workspace_id = await get_workspace_id_from_basket(basket_id)

    # Service-to-service auth bypasses membership check
    if auth_info.get("is_service"):
        logger.debug(f"Service {auth_info.get('service_name')} accessing basket {basket_id}")
        return workspace_id

    # Check workspace membership for user auth
    user_id = auth_info.get("user_id") or auth_info.get("sub")
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid authentication")

    result = (
        supabase_admin_client.table("workspace_memberships")
        .select("workspace_id")
        .eq("workspace_id", workspace_id)
        .eq("user_id", user_id)
        .execute()
    )

    if not result.data:
        raise HTTPException(status_code=403, detail="Access denied to basket's workspace")

    return workspace_id


# ============================================================================
# Work Outputs CRUD Endpoints
# ============================================================================


@router.post("/{basket_id}/work-outputs", response_model=WorkOutputResponse)
async def create_work_output(
    basket_id: str,
    output_data: WorkOutputCreate,
):
    """
    Create a new work output for user supervision.

    This is called by the work session executor after agent execution.
    Outputs are created with supervision_status='pending_review'.

    Args:
        basket_id: Basket ID
        output_data: Work output data

    Returns:
        Created work output record

    Note: Phase 1 - Auth temporarily disabled via exempt_prefixes (/api/baskets).
          In production, should use verify_user_or_service dependency.
    """
    try:
        # Phase 1: Skip workspace access verification (endpoint is exempt from auth)
        # await verify_workspace_access(basket_id, auth_info)

        # Verify basket_id matches
        if str(output_data.basket_id) != str(basket_id):
            raise HTTPException(status_code=400, detail="basket_id in body must match URL parameter")

        # Create work output
        output_record = {
            "basket_id": str(basket_id),
            "work_ticket_id": output_data.work_ticket_id,
            "output_type": output_data.output_type,
            "agent_type": output_data.agent_type,
            "title": output_data.title,
            "body": output_data.body,
            "confidence": output_data.confidence,
            "source_context_ids": output_data.source_context_ids,
            "tool_call_id": output_data.tool_call_id,
            "supervision_status": "pending_review",  # Always starts pending
            "metadata": output_data.metadata,
            "file_id": output_data.file_id,
            "file_format": output_data.file_format,
            "file_size_bytes": output_data.file_size_bytes,
            "mime_type": output_data.mime_type,
            "generation_method": output_data.generation_method,
            "skill_metadata": output_data.skill_metadata,
        }

        result = supabase_admin_client.table("work_outputs").insert(output_record).execute()

        if not result.data:
            raise HTTPException(status_code=500, detail="Failed to create work output")

        logger.info(f"Created work output {result.data[0]['id']} in basket {basket_id}")
        return result.data[0]

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to create work output: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to create work output: {str(e)}")


@router.get("/{basket_id}/work-outputs", response_model=WorkOutputListResponse)
async def list_work_outputs(
    basket_id: str,
    work_ticket_id: Optional[str] = Query(None),
    supervision_status: Optional[str] = Query(None),
    agent_type: Optional[str] = Query(None),
    output_type: Optional[str] = Query(None),
    limit: int = Query(100, ge=1, le=1000),
    offset: int = Query(0, ge=0),
    auth_info: dict = Depends(verify_user_or_service),
):
    """
    List work outputs for a basket with optional filters.

    Args:
        basket_id: Basket ID
        work_ticket_id: Filter by work ticket
        supervision_status: Filter by status (pending_review, approved, etc.)
        agent_type: Filter by agent type
        output_type: Filter by output type
        limit: Max results (default 100)
        offset: Pagination offset

    Returns:
        List of work outputs with total count
    """
    try:
        # Verify workspace access
        await verify_workspace_access(basket_id, auth_info)

        # Build query
        query = supabase_admin_client.table("work_outputs").select("*").eq("basket_id", basket_id)

        # Apply filters
        if work_ticket_id:
            query = query.eq("work_ticket_id", work_ticket_id)
        if supervision_status:
            query = query.eq("supervision_status", supervision_status)
        if agent_type:
            query = query.eq("agent_type", agent_type)
        if output_type:
            query = query.eq("output_type", output_type)

        # Get total count first
        count_result = query.execute()
        total = len(count_result.data) if count_result.data else 0

        # Apply pagination
        query = query.order("created_at", desc=True).range(offset, offset + limit - 1)
        result = query.execute()

        return {
            "outputs": result.data or [],
            "total": total,
            "basket_id": basket_id
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to list work outputs: {e}")
        raise HTTPException(status_code=500, detail="Failed to list work outputs")


@router.get("/{basket_id}/work-outputs/stats", response_model=SupervisionStatsResponse)
async def get_supervision_stats(
    basket_id: str,
    auth_info: dict = Depends(verify_user_or_service),
):
    """
    Get supervision statistics for a basket.

    Returns counts of outputs by supervision status.
    """
    try:
        # Verify workspace access
        await verify_workspace_access(basket_id, auth_info)

        # Call the database function
        result = supabase_admin_client.rpc(
            "get_supervision_stats",
            {"p_basket_id": basket_id}
        ).execute()

        if not result.data:
            # Return empty stats if no outputs
            return {
                "total_outputs": 0,
                "pending_review": 0,
                "approved": 0,
                "rejected": 0,
                "revision_requested": 0
            }

        return result.data[0]

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to get supervision stats: {e}")
        raise HTTPException(status_code=500, detail="Failed to get supervision stats")


@router.get("/{basket_id}/work-outputs/{output_id}", response_model=WorkOutputResponse)
async def get_work_output(
    basket_id: str,
    output_id: str,
    auth_info: dict = Depends(verify_user_or_service),
):
    """
    Get a specific work output.

    Args:
        basket_id: Basket ID
        output_id: Output ID

    Returns:
        Work output record
    """
    try:
        # Verify workspace access
        await verify_workspace_access(basket_id, auth_info)

        # Get output
        result = (
            supabase_admin_client.table("work_outputs")
            .select("*")
            .eq("id", output_id)
            .eq("basket_id", basket_id)
            .single()
            .execute()
        )

        if not result.data:
            raise HTTPException(status_code=404, detail="Work output not found")

        return result.data

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to get work output: {e}")
        raise HTTPException(status_code=500, detail="Failed to get work output")


@router.patch("/{basket_id}/work-outputs/{output_id}", response_model=WorkOutputResponse)
async def update_work_output_status(
    basket_id: str,
    output_id: str,
    status_update: WorkOutputStatusUpdate,
    auth_info: dict = Depends(verify_user_or_service),
):
    """
    Update work output supervision status.

    This is called by the supervision UI when user approves/rejects outputs.

    Args:
        basket_id: Basket ID
        output_id: Output ID
        status_update: New status and notes

    Returns:
        Updated work output record
    """
    try:
        # Verify workspace access
        await verify_workspace_access(basket_id, auth_info)

        # Get current output to verify it exists and is updatable
        current = (
            supabase_admin_client.table("work_outputs")
            .select("supervision_status")
            .eq("id", output_id)
            .eq("basket_id", basket_id)
            .single()
            .execute()
        )

        if not current.data:
            raise HTTPException(status_code=404, detail="Work output not found")

        # Prepare update data - use reviewer_id from request or auth_info
        reviewer_id = status_update.reviewer_id or auth_info.get("user_id")
        update_data = {
            "supervision_status": status_update.supervision_status,
            "reviewed_at": datetime.utcnow().isoformat(),
            "reviewed_by": reviewer_id,
        }

        if status_update.reviewer_notes:
            update_data["reviewer_notes"] = status_update.reviewer_notes

        # Validation: rejection and revision require notes
        if status_update.supervision_status in ["rejected", "revision_requested"]:
            if not status_update.reviewer_notes:
                raise HTTPException(
                    status_code=400,
                    detail=f"{status_update.supervision_status} requires reviewer_notes"
                )

        # Update
        result = (
            supabase_admin_client.table("work_outputs")
            .update(update_data)
            .eq("id", output_id)
            .eq("basket_id", basket_id)
            .execute()
        )

        if not result.data:
            raise HTTPException(status_code=500, detail="Failed to update work output")

        logger.info(
            f"Updated work output {output_id} status to {status_update.supervision_status}"
        )
        return result.data[0]

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to update work output status: {e}")
        raise HTTPException(status_code=500, detail="Failed to update work output status")


@router.delete("/{basket_id}/work-outputs/{output_id}")
async def delete_work_output(
    basket_id: str,
    output_id: str,
    auth_info: dict = Depends(verify_user_or_service),
):
    """
    Delete a work output (archive/cleanup).

    Args:
        basket_id: Basket ID
        output_id: Output ID

    Returns:
        Success message
    """
    try:
        # Verify workspace access
        await verify_workspace_access(basket_id, auth_info)

        # Delete output
        result = (
            supabase_admin_client.table("work_outputs")
            .delete()
            .eq("id", output_id)
            .eq("basket_id", basket_id)
            .execute()
        )

        if not result.data:
            raise HTTPException(status_code=404, detail="Work output not found")

        logger.info(f"Deleted work output {output_id} from basket {basket_id}")
        return {"message": "Work output deleted successfully", "output_id": output_id}

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to delete work output: {e}")
        raise HTTPException(status_code=500, detail="Failed to delete work output")


# ============================================================================
# File Download Endpoint (Claude Files API)
# ============================================================================


MIME_TYPE_MAP = {
    "pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "pdf": "application/pdf",
    "png": "image/png",
    "csv": "text/csv",
}


@router.get("/{basket_id}/work-outputs/{output_id}/download")
async def download_work_output_file(
    basket_id: str,
    output_id: str,
    auth_info: dict = Depends(verify_user_or_service),
):
    """
    Download a file-based work output via Claude Files API.

    This endpoint streams the file content from Claude's Files API.
    Only works for outputs that have a file_id (generated via Skills API).

    Args:
        basket_id: Basket ID
        output_id: Work output ID

    Returns:
        StreamingResponse with file content

    Raises:
        400: Output is not a file output
        404: Work output not found
        500: Failed to download from Claude Files API
    """
    try:
        # Verify workspace access
        await verify_workspace_access(basket_id, auth_info)

        # Get work output
        result = (
            supabase_admin_client.table("work_outputs")
            .select("id, title, file_id, file_format, mime_type, metadata")
            .eq("id", output_id)
            .eq("basket_id", basket_id)
            .single()
            .execute()
        )

        if not result.data:
            raise HTTPException(status_code=404, detail="Work output not found")

        output = result.data
        file_id = output.get("file_id")

        if not file_id:
            raise HTTPException(
                status_code=400,
                detail="This work output is not a file output. Only file outputs can be downloaded."
            )

        # Get file format and determine mime type
        file_format = output.get("file_format", "bin")
        mime_type = output.get("mime_type") or MIME_TYPE_MAP.get(file_format, "application/octet-stream")

        # Generate filename
        title = output.get("title", "download")
        # Sanitize title for filename
        safe_title = "".join(c for c in title if c.isalnum() or c in " -_").strip()[:50]
        filename = f"{safe_title}.{file_format}" if safe_title else f"work_output.{file_format}"

        logger.info(f"Downloading file {file_id} for work output {output_id}")

        # Download from Claude Files API
        try:
            client = anthropic.Anthropic()
            file_content = client.files.content(file_id)

            # Read content into memory (Claude Files API returns bytes)
            content_bytes = file_content.read()

            # Create streaming response
            return StreamingResponse(
                io.BytesIO(content_bytes),
                media_type=mime_type,
                headers={
                    "Content-Disposition": f'attachment; filename="{filename}"',
                    "Content-Length": str(len(content_bytes)),
                }
            )

        except anthropic.NotFoundError:
            logger.error(f"File {file_id} not found in Claude Files API")
            raise HTTPException(
                status_code=404,
                detail="File no longer available in Claude Files API. Files expire after 7 days."
            )
        except anthropic.APIError as e:
            logger.error(f"Claude Files API error: {e}")
            raise HTTPException(status_code=500, detail=f"Failed to download file: {str(e)}")

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to download work output file: {e}")
        raise HTTPException(status_code=500, detail="Failed to download file")


# ============================================================================
# Promotion Endpoints (Work Output → Substrate)
# ============================================================================


class PromotionUpdate(BaseModel):
    """Schema for marking a work output as promoted."""
    proposal_id: str
    promotion_method: str = Field(..., pattern="^(auto|manual)$")
    promoted_by: str


class SkipPromotionUpdate(BaseModel):
    """Schema for skipping promotion of a work output."""
    reason: Optional[str] = None
    skipped_by: str


@router.patch("/{basket_id}/work-outputs/{output_id}/promote")
async def mark_output_promoted(
    basket_id: str,
    output_id: str,
    promotion: PromotionUpdate,
    auth_info: dict = Depends(verify_user_or_service),
):
    """
    Mark a work output as promoted to substrate.

    Called after a P1 proposal is created from this output.

    Args:
        basket_id: Basket ID
        output_id: Output ID
        promotion: Promotion details (proposal_id, method, user)

    Returns:
        Updated work output record
    """
    try:
        # Verify workspace access
        await verify_workspace_access(basket_id, auth_info)

        # Verify output exists and is approved
        current = (
            supabase_admin_client.table("work_outputs")
            .select("supervision_status, substrate_proposal_id")
            .eq("id", output_id)
            .eq("basket_id", basket_id)
            .single()
            .execute()
        )

        if not current.data:
            raise HTTPException(status_code=404, detail="Work output not found")

        if current.data.get("supervision_status") != "approved":
            raise HTTPException(
                status_code=400,
                detail=f"Cannot promote output with status '{current.data.get('supervision_status')}'. Must be 'approved'."
            )

        if current.data.get("substrate_proposal_id"):
            raise HTTPException(
                status_code=400,
                detail=f"Output already promoted to proposal {current.data.get('substrate_proposal_id')}"
            )

        # Update with promotion info
        update_data = {
            "substrate_proposal_id": promotion.proposal_id,
            "promotion_method": promotion.promotion_method,
            "promoted_at": datetime.utcnow().isoformat(),
            "promoted_by": promotion.promoted_by,
        }

        result = (
            supabase_admin_client.table("work_outputs")
            .update(update_data)
            .eq("id", output_id)
            .eq("basket_id", basket_id)
            .execute()
        )

        if not result.data:
            raise HTTPException(status_code=500, detail="Failed to mark output as promoted")

        logger.info(
            f"Marked work output {output_id} as promoted to proposal {promotion.proposal_id}"
        )
        return result.data[0]

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to mark output as promoted: {e}")
        raise HTTPException(status_code=500, detail="Failed to mark output as promoted")


@router.patch("/{basket_id}/work-outputs/{output_id}/skip-promotion")
async def mark_output_skipped(
    basket_id: str,
    output_id: str,
    skip_data: SkipPromotionUpdate,
    auth_info: dict = Depends(verify_user_or_service),
):
    """
    Mark a work output as intentionally not promoted.

    Output remains approved but won't be sent to substrate.

    Args:
        basket_id: Basket ID
        output_id: Output ID
        skip_data: Skip details (reason, user)

    Returns:
        Updated work output record
    """
    try:
        # Verify workspace access
        await verify_workspace_access(basket_id, auth_info)

        # Verify output exists
        current = (
            supabase_admin_client.table("work_outputs")
            .select("supervision_status, substrate_proposal_id")
            .eq("id", output_id)
            .eq("basket_id", basket_id)
            .single()
            .execute()
        )

        if not current.data:
            raise HTTPException(status_code=404, detail="Work output not found")

        if current.data.get("substrate_proposal_id"):
            raise HTTPException(
                status_code=400,
                detail=f"Output already promoted to proposal {current.data.get('substrate_proposal_id')}"
            )

        # Update with skip info
        update_data = {
            "promotion_method": "skipped",
            "promoted_at": datetime.utcnow().isoformat(),
            "promoted_by": skip_data.skipped_by,
        }

        if skip_data.reason:
            update_data["reviewer_notes"] = skip_data.reason

        result = (
            supabase_admin_client.table("work_outputs")
            .update(update_data)
            .eq("id", output_id)
            .eq("basket_id", basket_id)
            .execute()
        )

        if not result.data:
            raise HTTPException(status_code=500, detail="Failed to mark output as skipped")

        logger.info(f"Marked work output {output_id} as promotion-skipped")
        return result.data[0]

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to skip output promotion: {e}")
        raise HTTPException(status_code=500, detail="Failed to skip output promotion")
