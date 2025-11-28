"""API routes for reference assets management."""

from __future__ import annotations

import logging
from datetime import datetime, timedelta
from typing import List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import JSONResponse

from ..utils.jwt import verify_jwt
from ..utils.supabase_client import supabase_admin_client
from .schemas import (
    ReferenceAssetResponse,
    ReferenceAssetListResponse,
    SignedURLResponse,
    AssetTypeResponse,
)
from .services.storage_service import StorageService

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/substrate/baskets", tags=["reference-assets"])


# ============================================================================
# Helper Functions
# ============================================================================


async def get_workspace_id_from_basket(basket_id: UUID) -> str:
    """Get workspace_id for a basket (for authorization)."""
    if not supabase_admin_client:
        raise HTTPException(status_code=500, detail="Supabase client not initialized")

    result = supabase_admin_client.table("baskets").select("workspace_id").eq("id", str(basket_id)).single().execute()

    if not result.data:
        raise HTTPException(status_code=404, detail="Basket not found")

    return result.data["workspace_id"]


async def verify_workspace_access(basket_id: UUID, user: dict = Depends(verify_jwt)) -> str:
    """Verify user has access to basket's workspace."""
    workspace_id = await get_workspace_id_from_basket(basket_id)

    # Check workspace membership
    # Note: verify_jwt returns {"user_id": ...}, not {"sub": ...}
    user_id = user.get("user_id") or user.get("sub")
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


async def get_asset_type_category(asset_type: str) -> str:
    """Get category for an asset type from catalog."""
    result = (
        supabase_admin_client.table("asset_type_catalog")
        .select("category")
        .eq("asset_type", asset_type)
        .eq("is_active", True)
        .single()
        .execute()
    )

    if not result.data:
        raise HTTPException(status_code=400, detail=f"Invalid or inactive asset type: {asset_type}")

    return result.data["category"]


# ============================================================================
# Asset Type Catalog Endpoints
# ============================================================================


@router.get("/{basket_id}/asset-types", response_model=List[AssetTypeResponse])
async def list_asset_types(
    basket_id: UUID,
):
    """List all active asset types from catalog.

    No workspace check needed - catalog is global.
    Auth handled by middleware exemption (/api/substrate prefix).
    """
    try:
        result = (
            supabase_admin_client.table("asset_type_catalog")
            .select("asset_type, display_name, description, category, allowed_mime_types, is_active")
            .eq("is_active", True)
            .is_("deprecated_at", "null")
            .order("asset_type")
            .execute()
        )

        return result.data

    except Exception as e:
        logger.error(f"Failed to list asset types: {e}")
        raise HTTPException(status_code=500, detail="Failed to list asset types")


# ============================================================================
# Reference Assets CRUD Endpoints
# ============================================================================


@router.post("/{basket_id}/assets", response_model=ReferenceAssetResponse)
async def upload_reference_asset(
    basket_id: UUID,
    file: UploadFile = File(...),
    asset_type: str = Form(...),
    description: Optional[str] = Form(None),
    agent_scope: Optional[str] = Form(None),  # Comma-separated list
    tags: Optional[str] = Form(None),  # Comma-separated list
    permanence: str = Form("permanent"),
    work_session_id: Optional[str] = Form(None),
    metadata: Optional[str] = Form("{}"),  # JSON string
    user: dict = Depends(verify_jwt),
):
    """Upload a new reference asset.

    Args:
        basket_id: Basket ID to upload asset to
        file: File to upload (multipart/form-data)
        asset_type: Asset type from catalog
        description: Optional description
        agent_scope: Comma-separated agent types (e.g., "research,content")
        tags: Comma-separated tags
        permanence: "permanent" or "temporary"
        work_session_id: Required if permanence is "temporary"
        metadata: Additional metadata as JSON string

    Returns:
        Reference asset metadata
    """
    try:
        # Verify workspace access
        workspace_id = await verify_workspace_access(basket_id, user)

        # Get asset category
        asset_category = await get_asset_type_category(asset_type)

        # Read file content
        file_content = await file.read()
        file_size = len(file_content)

        # Check file size (50MB limit)
        if file_size > 52428800:  # 50MB in bytes
            raise HTTPException(status_code=413, detail="File size exceeds 50MB limit")

        # Upload to storage
        storage_path, asset_id = await StorageService.upload_file(
            basket_id=basket_id,
            filename=file.filename,
            file_content=file_content,
            mime_type=file.content_type,
        )

        # Parse agent_scope
        agent_scope_list = None
        if agent_scope:
            agent_scope_list = [s.strip() for s in agent_scope.split(",") if s.strip()]

        # Parse tags
        tags_list = None
        if tags:
            tags_list = [t.strip() for t in tags.split(",") if t.strip()]

        # Parse metadata
        import json

        metadata_dict = {}
        if metadata:
            try:
                metadata_dict = json.loads(metadata)
            except json.JSONDecodeError:
                logger.warning(f"Invalid metadata JSON: {metadata}")

        # Calculate expires_at for temporary assets
        expires_at = None
        if permanence == "temporary":
            if not work_session_id:
                raise HTTPException(status_code=400, detail="work_session_id required for temporary assets")
            expires_at = datetime.utcnow() + timedelta(days=7)  # 7 days expiration

        # Insert metadata into database
        # Get user_id with fallback for both key formats
        user_id = user.get("user_id") or user.get("sub")

        asset_data = {
            "id": str(asset_id),
            "basket_id": str(basket_id),
            "storage_path": storage_path,
            "file_name": file.filename,
            "file_size_bytes": file_size,
            "mime_type": file.content_type,
            "asset_type": asset_type,
            "asset_category": asset_category,
            "permanence": permanence,
            "expires_at": expires_at.isoformat() if expires_at else None,
            "work_session_id": work_session_id,
            "agent_scope": agent_scope_list,
            "metadata": metadata_dict,
            "tags": tags_list,
            "description": description,
            "created_by_user_id": user_id,
            "access_count": 0,
        }

        result = supabase_admin_client.table("reference_assets").insert(asset_data).execute()

        if not result.data:
            # Rollback storage upload
            await StorageService.delete_file(storage_path)
            raise HTTPException(status_code=500, detail="Failed to create asset metadata")

        logger.info(f"Created reference asset {asset_id} in basket {basket_id}")
        return result.data[0]

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to upload reference asset: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to upload asset: {str(e)}")


@router.get("/{basket_id}/assets", response_model=ReferenceAssetListResponse)
async def list_reference_assets(
    basket_id: UUID,
    asset_type: Optional[str] = None,
    asset_category: Optional[str] = None,
    agent_scope: Optional[str] = None,
    permanence: Optional[str] = None,
    tags: Optional[str] = None,
    limit: int = 100,
    offset: int = 0,
):
    """List reference assets in a basket with filters.

    Args:
        basket_id: Basket ID
        asset_type: Filter by asset type
        asset_category: Filter by category
        agent_scope: Filter by agent type in agent_scope array
        permanence: Filter by permanence (permanent/temporary)
        tags: Filter by tag (contains)
        limit: Max results (default 100)
        offset: Pagination offset

    Returns:
        List of reference assets

    Note: Phase 1 - Auth temporarily disabled via exempt_prefixes (/api/substrate).
          In production, should use verify_jwt or verify_user_or_service dependency.
    """
    try:
        # Phase 1: Skip workspace access verification (endpoint is exempt from auth)
        # await verify_workspace_access(basket_id, user)

        # Build query
        query = supabase_admin_client.table("reference_assets").select("*").eq("basket_id", str(basket_id))

        # Apply filters
        if asset_type:
            query = query.eq("asset_type", asset_type)

        if asset_category:
            query = query.eq("asset_category", asset_category)

        if agent_scope:
            query = query.contains("agent_scope", [agent_scope])

        if permanence:
            query = query.eq("permanence", permanence)

        if tags:
            query = query.contains("tags", [tags])

        # Get total count
        count_result = query.execute()
        total = len(count_result.data) if count_result.data else 0

        # Apply pagination and execute
        query = query.order("created_at", desc=True).range(offset, offset + limit - 1)

        result = query.execute()

        return {"assets": result.data or [], "total": total, "basket_id": basket_id}

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to list reference assets: {e}")
        raise HTTPException(status_code=500, detail="Failed to list assets")


@router.get("/{basket_id}/assets/{asset_id}", response_model=ReferenceAssetResponse)
async def get_reference_asset(
    basket_id: UUID,
    asset_id: UUID,
    user: dict = Depends(verify_jwt),
):
    """Get reference asset metadata.

    Args:
        basket_id: Basket ID
        asset_id: Asset ID

    Returns:
        Reference asset metadata
    """
    try:
        # Verify workspace access
        await verify_workspace_access(basket_id, user)

        # Get asset
        result = (
            supabase_admin_client.table("reference_assets")
            .select("*")
            .eq("id", str(asset_id))
            .eq("basket_id", str(basket_id))
            .single()
            .execute()
        )

        if not result.data:
            raise HTTPException(status_code=404, detail="Asset not found")

        # Increment access count
        supabase_admin_client.table("reference_assets").update(
            {"access_count": result.data["access_count"] + 1, "last_accessed_at": datetime.utcnow().isoformat()}
        ).eq("id", str(asset_id)).execute()

        return result.data

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to get reference asset: {e}")
        raise HTTPException(status_code=500, detail="Failed to get asset")


@router.delete("/{basket_id}/assets/{asset_id}")
async def delete_reference_asset(
    basket_id: UUID,
    asset_id: UUID,
    user: dict = Depends(verify_jwt),
):
    """Delete reference asset (both metadata and file).

    Args:
        basket_id: Basket ID
        asset_id: Asset ID

    Returns:
        Success message
    """
    try:
        # Verify workspace access
        await verify_workspace_access(basket_id, user)

        # Get asset metadata (to get storage_path)
        result = (
            supabase_admin_client.table("reference_assets")
            .select("storage_path")
            .eq("id", str(asset_id))
            .eq("basket_id", str(basket_id))
            .single()
            .execute()
        )

        if not result.data:
            raise HTTPException(status_code=404, detail="Asset not found")

        storage_path = result.data["storage_path"]

        # Delete from database first
        supabase_admin_client.table("reference_assets").delete().eq("id", str(asset_id)).execute()

        # Delete from storage (best effort)
        await StorageService.delete_file(storage_path)

        logger.info(f"Deleted reference asset {asset_id} from basket {basket_id}")
        return {"message": "Asset deleted successfully", "asset_id": str(asset_id)}

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to delete reference asset: {e}")
        raise HTTPException(status_code=500, detail="Failed to delete asset")


# ============================================================================
# File Download Endpoints
# ============================================================================


@router.post("/{basket_id}/assets/{asset_id}/signed-url", response_model=SignedURLResponse)
async def get_asset_signed_url(
    basket_id: UUID,
    asset_id: UUID,
    expires_in: int = 3600,  # 1 hour default
    user: dict = Depends(verify_jwt),
):
    """Get signed URL for downloading an asset.

    Args:
        basket_id: Basket ID
        asset_id: Asset ID
        expires_in: URL expiration time in seconds (default: 3600 = 1 hour)

    Returns:
        Signed URL and expiration time
    """
    try:
        # Verify workspace access
        await verify_workspace_access(basket_id, user)

        # Get asset metadata
        result = (
            supabase_admin_client.table("reference_assets")
            .select("storage_path")
            .eq("id", str(asset_id))
            .eq("basket_id", str(basket_id))
            .single()
            .execute()
        )

        if not result.data:
            raise HTTPException(status_code=404, detail="Asset not found")

        storage_path = result.data["storage_path"]

        # Generate signed URL
        signed_url = await StorageService.get_signed_url(storage_path, expires_in=expires_in)

        expires_at = datetime.utcnow() + timedelta(seconds=expires_in)

        return {"signed_url": signed_url, "expires_at": expires_at}

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to generate signed URL: {e}")
        raise HTTPException(status_code=500, detail="Failed to generate signed URL")
