"""
Work Supervision API - Proxy routes to substrate-API for work output supervision.

This is a proxy layer that forwards supervision requests to substrate-API,
which owns the work_outputs table. Follows the BFF pattern:
- work-platform: orchestration and proxy
- substrate-api: data ownership and business logic

Endpoints:
- GET /supervision/baskets/{basket_id}/outputs - List outputs for review
- GET /supervision/baskets/{basket_id}/outputs/{output_id} - Get single output
- POST /supervision/baskets/{basket_id}/outputs/{output_id}/approve - Approve output
- POST /supervision/baskets/{basket_id}/outputs/{output_id}/reject - Reject output
- POST /supervision/baskets/{basket_id}/outputs/{output_id}/request-revision - Request revision
- POST /supervision/baskets/{basket_id}/outputs/{output_id}/promote - Manually promote to substrate
- POST /supervision/baskets/{basket_id}/outputs/{output_id}/skip-promotion - Skip promotion
- GET /supervision/baskets/{basket_id}/stats - Get supervision statistics
- GET /supervision/baskets/{basket_id}/settings - Get supervision settings
- PUT /supervision/baskets/{basket_id}/settings - Update supervision settings
- GET /supervision/baskets/{basket_id}/pending-promotions - Get outputs awaiting promotion
"""

from __future__ import annotations

import logging
from typing import Optional, List

from fastapi import APIRouter, HTTPException, Depends, Query
from pydantic import BaseModel, Field

from app.utils.jwt import verify_jwt
from clients.substrate_client import get_substrate_client, SubstrateAPIError
from services.work_to_substrate_bridge import WorkToSubstrateBridge, create_bridge

router = APIRouter(prefix="/api/supervision", tags=["work-supervision"])
logger = logging.getLogger(__name__)


# ========================================================================
# Request/Response Models
# ========================================================================


class ApproveOutputRequest(BaseModel):
    """Request to approve an output."""
    notes: Optional[str] = Field(None, description="Optional approval notes")


class RejectOutputRequest(BaseModel):
    """Request to reject an output."""
    notes: str = Field(..., description="Reason for rejection (required)")


class RequestRevisionRequest(BaseModel):
    """Request to ask for revision."""
    feedback: str = Field(..., description="Revision feedback (required)")


class SupervisionActionResponse(BaseModel):
    """Response after supervision action."""
    output_id: str
    supervision_status: str
    message: str


# ========================================================================
# Proxy Endpoints - Forward to substrate-API
# ========================================================================


@router.get("/baskets/{basket_id}/outputs")
async def list_outputs(
    basket_id: str,
    supervision_status: Optional[str] = Query(None, description="Filter by status"),
    agent_type: Optional[str] = Query(None, description="Filter by agent type"),
    output_type: Optional[str] = Query(None, description="Filter by output type"),
    work_ticket_id: Optional[str] = Query(None, description="Filter by session"),
    limit: int = Query(100, ge=1, le=1000),
    offset: int = Query(0, ge=0),
    user: dict = Depends(verify_jwt),
):
    """
    List work outputs for a basket (proxy to substrate-API).

    Returns outputs pending user review with filtering options.
    """
    user_id = user.get("sub") or user.get("user_id")
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid user token")

    logger.info(f"[SUPERVISION] Listing outputs for basket {basket_id}")

    try:
        client = get_substrate_client()
        result = client.list_work_outputs(
            basket_id=basket_id,
            work_ticket_id=work_ticket_id,
            supervision_status=supervision_status,
            agent_type=agent_type,
            output_type=output_type,
            limit=limit,
            offset=offset,
        )

        return result

    except SubstrateAPIError as e:
        logger.error(f"[SUPERVISION] Failed to list outputs: {e.message}")
        raise HTTPException(status_code=e.status_code or 500, detail=e.message)
    except Exception as e:
        logger.exception(f"[SUPERVISION] Unexpected error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/baskets/{basket_id}/outputs/{output_id}")
async def get_output(
    basket_id: str,
    output_id: str,
    user: dict = Depends(verify_jwt),
):
    """
    Get a specific work output (proxy to substrate-API).

    Returns detailed output information for review.
    """
    user_id = user.get("sub") or user.get("user_id")
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid user token")

    logger.info(f"[SUPERVISION] Getting output {output_id} from basket {basket_id}")

    try:
        client = get_substrate_client()
        result = client.get_work_output(basket_id=basket_id, output_id=output_id)
        return result

    except SubstrateAPIError as e:
        logger.error(f"[SUPERVISION] Failed to get output: {e.message}")
        raise HTTPException(status_code=e.status_code or 500, detail=e.message)
    except Exception as e:
        logger.exception(f"[SUPERVISION] Unexpected error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/baskets/{basket_id}/stats")
async def get_supervision_stats(
    basket_id: str,
    user: dict = Depends(verify_jwt),
):
    """
    Get supervision statistics for a basket (proxy to substrate-API).

    Returns counts of outputs by status for dashboard display.
    """
    user_id = user.get("sub") or user.get("user_id")
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid user token")

    logger.info(f"[SUPERVISION] Getting stats for basket {basket_id}")

    try:
        client = get_substrate_client()
        result = client.get_supervision_stats(basket_id=basket_id)
        return result

    except SubstrateAPIError as e:
        logger.error(f"[SUPERVISION] Failed to get stats: {e.message}")
        raise HTTPException(status_code=e.status_code or 500, detail=e.message)
    except Exception as e:
        logger.exception(f"[SUPERVISION] Unexpected error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post(
    "/baskets/{basket_id}/outputs/{output_id}/approve",
    response_model=SupervisionActionResponse,
)
async def approve_output(
    basket_id: str,
    output_id: str,
    request: ApproveOutputRequest,
    user: dict = Depends(verify_jwt),
):
    """
    Approve a work output (proxy to substrate-API).

    Marks output as approved for user's knowledge base.
    If auto-promotion is enabled, triggers promotion to substrate.
    """
    user_id = user.get("sub") or user.get("user_id")
    user_token = user.get("token")
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid user token")

    logger.info(f"[SUPERVISION] Approving output {output_id} by user {user_id}")

    try:
        client = get_substrate_client()
        client.update_work_output_status(
            basket_id=basket_id,
            output_id=output_id,
            supervision_status="approved",
            reviewer_notes=request.notes,
            reviewer_id=user_id,
        )

        logger.info(f"[SUPERVISION] ✅ Output {output_id} approved")

        # Trigger auto-promotion if configured
        promotion_result = None
        try:
            bridge = create_bridge(user_id=user_id, user_token=user_token)
            promotion_result = await bridge.on_work_output_approved(
                work_output_id=output_id,
                basket_id=basket_id,
            )
            if promotion_result:
                logger.info(
                    f"[SUPERVISION] ⬆️ Auto-promoted output {output_id} → "
                    f"proposal {promotion_result.get('proposal_id')}"
                )
        except Exception as pe:
            # Don't fail the approval if promotion fails
            logger.warning(f"[SUPERVISION] Auto-promotion failed (approval succeeded): {pe}")

        message = "Output approved successfully"
        if promotion_result:
            message += f" and promoted to proposal {promotion_result.get('proposal_id')}"

        return SupervisionActionResponse(
            output_id=output_id,
            supervision_status="approved",
            message=message,
        )

    except SubstrateAPIError as e:
        logger.error(f"[SUPERVISION] Failed to approve output: {e.message}")
        raise HTTPException(status_code=e.status_code or 500, detail=e.message)
    except Exception as e:
        logger.exception(f"[SUPERVISION] Unexpected error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post(
    "/baskets/{basket_id}/outputs/{output_id}/reject",
    response_model=SupervisionActionResponse,
)
async def reject_output(
    basket_id: str,
    output_id: str,
    request: RejectOutputRequest,
    user: dict = Depends(verify_jwt),
):
    """
    Reject a work output (proxy to substrate-API).

    Marks output as rejected with required notes explaining why.
    """
    user_id = user.get("sub") or user.get("user_id")
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid user token")

    if not request.notes or len(request.notes.strip()) == 0:
        raise HTTPException(status_code=400, detail="Rejection notes are required")

    logger.info(f"[SUPERVISION] Rejecting output {output_id}: {request.notes}")

    try:
        client = get_substrate_client()
        client.update_work_output_status(
            basket_id=basket_id,
            output_id=output_id,
            supervision_status="rejected",
            reviewer_notes=request.notes,
            reviewer_id=user_id,
        )

        logger.info(f"[SUPERVISION] ❌ Output {output_id} rejected")

        return SupervisionActionResponse(
            output_id=output_id,
            supervision_status="rejected",
            message=f"Output rejected: {request.notes}",
        )

    except SubstrateAPIError as e:
        logger.error(f"[SUPERVISION] Failed to reject output: {e.message}")
        raise HTTPException(status_code=e.status_code or 500, detail=e.message)
    except Exception as e:
        logger.exception(f"[SUPERVISION] Unexpected error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post(
    "/baskets/{basket_id}/outputs/{output_id}/request-revision",
    response_model=SupervisionActionResponse,
)
async def request_revision(
    basket_id: str,
    output_id: str,
    request: RequestRevisionRequest,
    user: dict = Depends(verify_jwt),
):
    """
    Request revision for a work output (proxy to substrate-API).

    Marks output as needing revision with feedback for the agent.
    """
    user_id = user.get("sub") or user.get("user_id")
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid user token")

    if not request.feedback or len(request.feedback.strip()) == 0:
        raise HTTPException(status_code=400, detail="Revision feedback is required")

    logger.info(f"[SUPERVISION] Requesting revision for {output_id}: {request.feedback}")

    try:
        client = get_substrate_client()
        client.update_work_output_status(
            basket_id=basket_id,
            output_id=output_id,
            supervision_status="revision_requested",
            reviewer_notes=request.feedback,
            reviewer_id=user_id,
        )

        logger.info(f"[SUPERVISION] 🔄 Revision requested for output {output_id}")

        return SupervisionActionResponse(
            output_id=output_id,
            supervision_status="revision_requested",
            message=f"Revision requested: {request.feedback}",
        )

    except SubstrateAPIError as e:
        logger.error(f"[SUPERVISION] Failed to request revision: {e.message}")
        raise HTTPException(status_code=e.status_code or 500, detail=e.message)
    except Exception as e:
        logger.exception(f"[SUPERVISION] Unexpected error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ========================================================================
# Promotion Endpoints - Work Output to Substrate
# ========================================================================


class PromoteOutputRequest(BaseModel):
    """Request to promote output to substrate."""
    target_basket_id: Optional[str] = Field(None, description="Override target basket")


class SkipPromotionRequest(BaseModel):
    """Request to skip promotion for an output."""
    reason: Optional[str] = Field(None, description="Reason for skipping promotion")


class SupervisionSettingsRequest(BaseModel):
    """Request to update supervision settings."""
    promotion_mode: Optional[str] = Field(None, description="auto or manual")
    auto_promote_types: Optional[List[str]] = Field(None, description="Output types for auto-promotion")
    require_review_before_promotion: Optional[bool] = Field(None)
    notify_on_promotion: Optional[bool] = Field(None)


class PromotionResponse(BaseModel):
    """Response after promotion action."""
    success: bool
    work_output_id: str
    proposal_id: Optional[str] = None
    promotion_method: str
    message: str


@router.post(
    "/baskets/{basket_id}/outputs/{output_id}/promote",
    response_model=PromotionResponse,
)
async def promote_output(
    basket_id: str,
    output_id: str,
    request: PromoteOutputRequest,
    user: dict = Depends(verify_jwt),
):
    """
    Manually promote a work output to substrate via P1 proposal.

    Creates a proposal from the approved work output which then goes
    through standard governance flow.
    """
    user_id = user.get("sub") or user.get("user_id")
    user_token = user.get("token")
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid user token")

    logger.info(f"[SUPERVISION] Manual promote: output={output_id}, basket={basket_id}")

    try:
        bridge = create_bridge(user_id=user_id, user_token=user_token)
        result = await bridge.promote_to_substrate(
            work_output_id=output_id,
            promotion_method="manual",
            target_basket_id=request.target_basket_id,
        )

        logger.info(f"[SUPERVISION] ⬆️ Promoted output {output_id} → proposal {result.get('proposal_id')}")

        return PromotionResponse(
            success=True,
            work_output_id=output_id,
            proposal_id=result.get("proposal_id"),
            promotion_method="manual",
            message=f"Output promoted to substrate proposal",
        )

    except ValueError as e:
        logger.warning(f"[SUPERVISION] Promotion validation failed: {e}")
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.exception(f"[SUPERVISION] Failed to promote output: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post(
    "/baskets/{basket_id}/outputs/{output_id}/skip-promotion",
    response_model=PromotionResponse,
)
async def skip_output_promotion(
    basket_id: str,
    output_id: str,
    request: SkipPromotionRequest,
    user: dict = Depends(verify_jwt),
):
    """
    Skip promotion for an approved output.

    Marks the output as intentionally not promoted, keeping it
    approved but not sending to substrate.
    """
    user_id = user.get("sub") or user.get("user_id")
    user_token = user.get("token")
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid user token")

    logger.info(f"[SUPERVISION] Skip promotion: output={output_id}")

    try:
        bridge = create_bridge(user_id=user_id, user_token=user_token)
        result = await bridge.skip_promotion(
            work_output_id=output_id,
            basket_id=basket_id,
            reason=request.reason,
        )

        logger.info(f"[SUPERVISION] ⏭️ Skipped promotion for output {output_id}")

        return PromotionResponse(
            success=True,
            work_output_id=output_id,
            promotion_method="skipped",
            message=f"Promotion skipped{': ' + request.reason if request.reason else ''}",
        )

    except Exception as e:
        logger.exception(f"[SUPERVISION] Failed to skip promotion: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/baskets/{basket_id}/pending-promotions")
async def get_pending_promotions(
    basket_id: str,
    user: dict = Depends(verify_jwt),
):
    """
    Get approved outputs awaiting promotion to substrate.

    Returns outputs that are approved but haven't been promoted yet.
    Useful for manual promotion workflow review.
    """
    user_id = user.get("sub") or user.get("user_id")
    user_token = user.get("token")
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid user token")

    logger.info(f"[SUPERVISION] Getting pending promotions for basket {basket_id}")

    try:
        bridge = create_bridge(user_id=user_id, user_token=user_token)
        pending = await bridge.get_pending_promotions(basket_id)

        return {
            "basket_id": basket_id,
            "pending_count": len(pending),
            "outputs": pending,
        }

    except Exception as e:
        logger.exception(f"[SUPERVISION] Failed to get pending promotions: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/baskets/{basket_id}/settings")
async def get_supervision_settings(
    basket_id: str,
    user: dict = Depends(verify_jwt),
):
    """
    Get supervision settings for a basket.

    Returns project-level settings for work output supervision:
    - promotion_mode: auto or manual
    - auto_promote_types: which output types auto-promote
    - require_review_before_promotion: extra validation step
    - notify_on_promotion: send notifications
    """
    user_id = user.get("sub") or user.get("user_id")
    user_token = user.get("token")
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid user token")

    logger.info(f"[SUPERVISION] Getting settings for basket {basket_id}")

    try:
        bridge = create_bridge(user_id=user_id, user_token=user_token)
        settings = await bridge.get_project_settings(basket_id)

        return {
            "basket_id": basket_id,
            "settings": settings,
        }

    except Exception as e:
        logger.exception(f"[SUPERVISION] Failed to get settings: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.put("/baskets/{basket_id}/settings")
async def update_supervision_settings(
    basket_id: str,
    request: SupervisionSettingsRequest,
    user: dict = Depends(verify_jwt),
):
    """
    Update supervision settings for a basket.

    Allows configuring:
    - promotion_mode: "auto" (promote on approval) or "manual" (explicit action)
    - auto_promote_types: List of output types that auto-promote
    - require_review_before_promotion: Extra validation
    - notify_on_promotion: Send notifications on promotion
    """
    user_id = user.get("sub") or user.get("user_id")
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid user token")

    logger.info(f"[SUPERVISION] Updating settings for basket {basket_id}: {request.dict(exclude_none=True)}")

    try:
        from app.utils.supabase_client import supabase_admin_client as supabase

        # Get basket to find project
        basket_resp = supabase.table("baskets").select("project_id").eq("id", basket_id).single().execute()
        if not basket_resp.data:
            raise HTTPException(status_code=404, detail="Basket not found")

        project_id = basket_resp.data.get("project_id")

        # Get current project metadata
        project_resp = supabase.table("projects").select("metadata").eq("id", project_id).single().execute()
        if not project_resp.data:
            raise HTTPException(status_code=404, detail="Project not found")

        current_metadata = project_resp.data.get("metadata") or {}
        current_settings = current_metadata.get("work_supervision", {})

        # Merge updates
        new_settings = {**current_settings}
        if request.promotion_mode is not None:
            if request.promotion_mode not in ["auto", "manual"]:
                raise HTTPException(status_code=400, detail="promotion_mode must be 'auto' or 'manual'")
            new_settings["promotion_mode"] = request.promotion_mode
        if request.auto_promote_types is not None:
            new_settings["auto_promote_types"] = request.auto_promote_types
        if request.require_review_before_promotion is not None:
            new_settings["require_review_before_promotion"] = request.require_review_before_promotion
        if request.notify_on_promotion is not None:
            new_settings["notify_on_promotion"] = request.notify_on_promotion

        # Update project metadata
        new_metadata = {**current_metadata, "work_supervision": new_settings}
        supabase.table("projects").update({"metadata": new_metadata}).eq("id", project_id).execute()

        logger.info(f"[SUPERVISION] ✅ Updated settings for basket {basket_id}")

        return {
            "basket_id": basket_id,
            "project_id": project_id,
            "settings": new_settings,
            "message": "Settings updated successfully",
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"[SUPERVISION] Failed to update settings: {e}")
        raise HTTPException(status_code=500, detail=str(e))
