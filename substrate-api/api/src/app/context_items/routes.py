"""API routes for context items management.

Context Items provide structured, multi-modal context for work recipes.
This is the unified context table supporting foundation, working, and ephemeral tiers.

Terminology (v3.0):
- item_type: The type of context item (replaces anchor_role)
- item_key: Optional key for non-singleton types (replaces entry_key)
- content: The structured JSONB data (replaces data)
- tier: Governance tier (foundation, working, ephemeral)

See: /docs/architecture/ADR_CONTEXT_ITEMS_UNIFIED.md
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query

from ..utils.jwt import verify_jwt
from ..utils.supabase_client import supabase_admin_client
from .schemas import (
    ContextItemCreate,
    ContextItemUpdate,
    ContextItemResponse,
    ContextItemsListResponse,
    ContextItemSchemaResponse,
    ContextItemSchemasListResponse,
    ContextItemResolvedResponse,
    CompletenessResponse,
    BulkContextRequest,
    BulkContextResponse,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/substrate/baskets", tags=["context-items"])


# ============================================================================
# Helper Functions
# ============================================================================


async def get_workspace_id_from_basket(basket_id: UUID) -> str:
    """Get workspace_id for a basket (for authorization)."""
    if not supabase_admin_client:
        raise HTTPException(status_code=500, detail="Supabase client not initialized")

    result = (
        supabase_admin_client.table("baskets")
        .select("workspace_id")
        .eq("id", str(basket_id))
        .single()
        .execute()
    )

    if not result.data:
        raise HTTPException(status_code=404, detail="Basket not found")

    return result.data["workspace_id"]


async def verify_workspace_access(basket_id: UUID, user: dict = Depends(verify_jwt)) -> str:
    """Verify user has access to basket's workspace."""
    workspace_id = await get_workspace_id_from_basket(basket_id)

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


def calculate_completeness(content: Dict[str, Any], field_schema: Dict[str, Any]) -> Dict[str, Any]:
    """Calculate completeness score for a context item."""
    fields = field_schema.get("fields", [])
    required_count = 0
    filled_count = 0
    missing_fields = []

    for field in fields:
        if field.get("required", False):
            required_count += 1
            key = field.get("key")
            value = content.get(key)

            # Check if field has a meaningful value
            if value is not None and value != "" and value != []:
                filled_count += 1
            else:
                missing_fields.append(key)

    score = filled_count / required_count if required_count > 0 else 1.0

    return {
        "score": score,
        "required_fields": required_count,
        "filled_fields": filled_count,
        "missing_fields": missing_fields,
    }


def map_category_to_tier(category: str) -> str:
    """Map schema category to context tier."""
    tier_map = {
        "foundation": "foundation",
        "market": "working",
        "insight": "working",
    }
    return tier_map.get(category, "working")


async def resolve_asset_references(
    content: Dict[str, Any],
    field_schema: Dict[str, Any],
) -> Dict[str, Any]:
    """Resolve asset:// references in item content to actual asset info with URLs."""
    resolved = {}
    asset_fields = {
        f.get("key"): f
        for f in field_schema.get("fields", [])
        if f.get("type") == "asset"
    }

    for key, value in content.items():
        if key in asset_fields and isinstance(value, str) and value.startswith("asset://"):
            asset_id = value.replace("asset://", "")

            try:
                asset_result = (
                    supabase_admin_client.table("reference_assets")
                    .select("id, file_name, mime_type, storage_path")
                    .eq("id", asset_id)
                    .single()
                    .execute()
                )

                if asset_result.data:
                    # Generate signed URL (valid for 1 hour)
                    storage_path = asset_result.data["storage_path"]
                    signed_url_result = supabase_admin_client.storage.from_("yarnnn-assets").create_signed_url(
                        storage_path, 3600
                    )

                    resolved[key] = {
                        "asset_id": asset_id,
                        "file_name": asset_result.data.get("file_name"),
                        "mime_type": asset_result.data.get("mime_type"),
                        "url": signed_url_result.get("signedURL") if signed_url_result else None,
                    }
                else:
                    resolved[key] = None
            except Exception as e:
                logger.warning(f"Failed to resolve asset {asset_id}: {e}")
                resolved[key] = None
        else:
            resolved[key] = value

    return resolved


# ============================================================================
# Context Item Schema Endpoints
# ============================================================================


@router.get("/{basket_id}/context/schemas", response_model=ContextItemSchemasListResponse)
async def list_context_schemas(
    basket_id: UUID,
    category: Optional[str] = None,
    user: dict = Depends(verify_jwt),
):
    """List all available context item schemas.

    Args:
        basket_id: Basket ID (for auth context, schemas are global)
        category: Optional filter by category (foundation, market, insight)

    Returns:
        List of context item schemas
    """
    try:
        await verify_workspace_access(basket_id, user)

        query = (
            supabase_admin_client.table("context_entry_schemas")
            .select("*")
            .order("sort_order")
        )

        if category:
            query = query.eq("category", category)

        result = query.execute()

        # Transform anchor_role -> item_type in response
        schemas = []
        for schema in result.data or []:
            schemas.append({
                "item_type": schema["anchor_role"],
                "display_name": schema["display_name"],
                "description": schema.get("description"),
                "icon": schema.get("icon"),
                "category": schema.get("category"),
                "is_singleton": schema.get("is_singleton", True),
                "field_schema": schema.get("field_schema", {}),
                "sort_order": schema.get("sort_order", 0),
                "created_at": schema.get("created_at"),
                "updated_at": schema.get("updated_at"),
            })

        return {"schemas": schemas}

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to list context schemas: {e}")
        raise HTTPException(status_code=500, detail="Failed to list schemas")


@router.get("/{basket_id}/context/schemas/{item_type}", response_model=ContextItemSchemaResponse)
async def get_context_schema(
    basket_id: UUID,
    item_type: str,
    user: dict = Depends(verify_jwt),
):
    """Get a specific context item schema by item type.

    Args:
        basket_id: Basket ID (for auth context)
        item_type: The item type to get schema for

    Returns:
        Context item schema
    """
    try:
        await verify_workspace_access(basket_id, user)

        result = (
            supabase_admin_client.table("context_entry_schemas")
            .select("*")
            .eq("anchor_role", item_type)
            .single()
            .execute()
        )

        if not result.data:
            raise HTTPException(status_code=404, detail=f"Schema not found: {item_type}")

        schema = result.data
        return {
            "item_type": schema["anchor_role"],
            "display_name": schema["display_name"],
            "description": schema.get("description"),
            "icon": schema.get("icon"),
            "category": schema.get("category"),
            "is_singleton": schema.get("is_singleton", True),
            "field_schema": schema.get("field_schema", {}),
            "sort_order": schema.get("sort_order", 0),
            "created_at": schema.get("created_at"),
            "updated_at": schema.get("updated_at"),
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to get context schema: {e}")
        raise HTTPException(status_code=500, detail="Failed to get schema")


# ============================================================================
# Context Item CRUD Endpoints (using context_items table)
# ============================================================================


@router.get("/{basket_id}/context/items", response_model=ContextItemsListResponse)
async def list_context_items(
    basket_id: UUID,
    item_type: Optional[str] = None,
    tier: Optional[str] = None,
    status: str = "active",
    user: dict = Depends(verify_jwt),
):
    """List context items for a basket.

    Args:
        basket_id: Basket ID
        item_type: Optional filter by item type
        tier: Optional filter by tier (foundation, working, ephemeral)
        status: Filter by status (default: active)

    Returns:
        List of context items with schema info
    """
    try:
        await verify_workspace_access(basket_id, user)

        query = (
            supabase_admin_client.table("context_items")
            .select("*, context_entry_schemas(display_name, icon, category)")
            .eq("basket_id", str(basket_id))
            .eq("status", status)
        )

        if item_type:
            query = query.eq("item_type", item_type)

        if tier:
            query = query.eq("tier", tier)

        result = query.order("item_type").execute()

        # Transform to response format
        items = []
        for item in result.data or []:
            schema_info = item.pop("context_entry_schemas", {}) or {}
            items.append({
                "id": item["id"],
                "basket_id": item["basket_id"],
                "item_type": item["item_type"],
                "item_key": item["item_key"],
                "title": item["title"],
                "content": item["content"],
                "tier": item["tier"],
                "completeness_score": item["completeness_score"],
                "status": item["status"],
                "created_by": item.get("created_by"),
                "updated_by": item.get("updated_by"),
                "created_at": item["created_at"],
                "updated_at": item["updated_at"],
                "schema_display_name": schema_info.get("display_name"),
                "schema_icon": schema_info.get("icon"),
                "schema_category": schema_info.get("category"),
            })

        return {"items": items, "basket_id": basket_id}

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to list context items: {e}")
        raise HTTPException(status_code=500, detail="Failed to list items")


@router.get("/{basket_id}/context/items/{item_type}", response_model=ContextItemResponse)
async def get_context_item(
    basket_id: UUID,
    item_type: str,
    item_key: Optional[str] = None,
    user: dict = Depends(verify_jwt),
):
    """Get a specific context item.

    Args:
        basket_id: Basket ID
        item_type: Item type
        item_key: Item key (for non-singleton types)

    Returns:
        Context item with schema info
    """
    try:
        await verify_workspace_access(basket_id, user)

        query = (
            supabase_admin_client.table("context_items")
            .select("*, context_entry_schemas(display_name, icon, category, field_schema)")
            .eq("basket_id", str(basket_id))
            .eq("item_type", item_type)
            .eq("status", "active")
        )

        if item_key:
            query = query.eq("item_key", item_key)
        else:
            query = query.is_("item_key", "null")

        result = query.single().execute()

        if not result.data:
            raise HTTPException(status_code=404, detail=f"Context item not found: {item_type}")

        item = result.data
        schema_info = item.pop("context_entry_schemas", {}) or {}

        return {
            "id": item["id"],
            "basket_id": item["basket_id"],
            "item_type": item["item_type"],
            "item_key": item["item_key"],
            "title": item["title"],
            "content": item["content"],
            "tier": item["tier"],
            "completeness_score": item["completeness_score"],
            "status": item["status"],
            "created_by": item.get("created_by"),
            "updated_by": item.get("updated_by"),
            "created_at": item["created_at"],
            "updated_at": item["updated_at"],
            "schema_display_name": schema_info.get("display_name"),
            "schema_icon": schema_info.get("icon"),
            "schema_category": schema_info.get("category"),
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to get context item: {e}")
        raise HTTPException(status_code=500, detail="Failed to get item")


@router.put("/{basket_id}/context/items/{item_type}", response_model=ContextItemResponse)
async def upsert_context_item(
    basket_id: UUID,
    item_type: str,
    body: ContextItemUpdate,
    item_key: Optional[str] = None,
    user: dict = Depends(verify_jwt),
):
    """Create or update a context item.

    Args:
        basket_id: Basket ID
        item_type: Item type
        body: Item content
        item_key: Item key (for non-singleton types)

    Returns:
        Created/updated context item
    """
    try:
        await verify_workspace_access(basket_id, user)

        # Validate schema exists and get field_schema
        schema_result = (
            supabase_admin_client.table("context_entry_schemas")
            .select("field_schema, is_singleton, category")
            .eq("anchor_role", item_type)
            .single()
            .execute()
        )

        if not schema_result.data:
            raise HTTPException(status_code=400, detail=f"Unknown item type: {item_type}")

        field_schema = schema_result.data["field_schema"]
        is_singleton = schema_result.data["is_singleton"]
        category = schema_result.data["category"]

        # For singleton types, item_key must be null
        if is_singleton:
            item_key = None

        # Calculate completeness
        completeness = calculate_completeness(body.content, field_schema)

        user_id = user.get("user_id") or user.get("sub")

        # Map category to tier
        tier = map_category_to_tier(category)

        # Upsert item into context_items table
        item_data = {
            "basket_id": str(basket_id),
            "tier": tier,
            "item_type": item_type,
            "item_key": item_key,
            "title": body.title,
            "content": body.content,
            "schema_id": item_type,
            "completeness_score": completeness["score"],
            "status": "active",
            "created_by": f"user:{user_id}",
            "updated_by": f"user:{user_id}",
        }

        result = (
            supabase_admin_client.table("context_items")
            .upsert(item_data, on_conflict="basket_id,item_type,item_key")
            .execute()
        )

        if not result.data:
            raise HTTPException(status_code=500, detail="Failed to save context item")

        logger.info(f"Upserted context item {item_type} for basket {basket_id}")

        item = result.data[0]
        return {
            "id": item["id"],
            "basket_id": item["basket_id"],
            "item_type": item["item_type"],
            "item_key": item["item_key"],
            "title": item["title"],
            "content": item["content"],
            "tier": item["tier"],
            "completeness_score": item["completeness_score"],
            "status": item["status"],
            "created_by": item.get("created_by"),
            "updated_by": item.get("updated_by"),
            "created_at": item["created_at"],
            "updated_at": item["updated_at"],
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to upsert context item: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to save item: {str(e)}")


@router.delete("/{basket_id}/context/items/{item_type}")
async def delete_context_item(
    basket_id: UUID,
    item_type: str,
    item_key: Optional[str] = None,
    user: dict = Depends(verify_jwt),
):
    """Archive (soft delete) a context item.

    Args:
        basket_id: Basket ID
        item_type: Item type
        item_key: Item key (for non-singleton types)

    Returns:
        Success message
    """
    try:
        await verify_workspace_access(basket_id, user)

        query = (
            supabase_admin_client.table("context_items")
            .update({"status": "archived"})
            .eq("basket_id", str(basket_id))
            .eq("item_type", item_type)
        )

        if item_key:
            query = query.eq("item_key", item_key)
        else:
            query = query.is_("item_key", "null")

        result = query.execute()

        if not result.data:
            raise HTTPException(status_code=404, detail="Context item not found")

        logger.info(f"Archived context item {item_type} for basket {basket_id}")

        return {"success": True, "message": f"Context item {item_type} archived"}

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to delete context item: {e}")
        raise HTTPException(status_code=500, detail="Failed to delete item")


# ============================================================================
# Resolved Item Endpoint (with asset URLs)
# ============================================================================


@router.get("/{basket_id}/context/items/{item_type}/resolved", response_model=ContextItemResolvedResponse)
async def get_resolved_context_item(
    basket_id: UUID,
    item_type: str,
    fields: Optional[str] = Query(None, description="Comma-separated field names to include"),
    item_key: Optional[str] = None,
    user: dict = Depends(verify_jwt),
):
    """Get context item with resolved asset references.

    Asset fields (type=asset) that contain asset://uuid references are resolved
    to include file metadata and signed download URLs.

    Args:
        basket_id: Basket ID
        item_type: Item type
        fields: Optional comma-separated list of fields to include
        item_key: Item key (for non-singleton types)

    Returns:
        Context item with resolved asset references
    """
    try:
        await verify_workspace_access(basket_id, user)

        query = (
            supabase_admin_client.table("context_items")
            .select("*, context_entry_schemas(field_schema)")
            .eq("basket_id", str(basket_id))
            .eq("item_type", item_type)
            .eq("status", "active")
        )

        if item_key:
            query = query.eq("item_key", item_key)
        else:
            query = query.is_("item_key", "null")

        result = query.single().execute()

        if not result.data:
            raise HTTPException(status_code=404, detail=f"Context item not found: {item_type}")

        item = result.data
        field_schema = item.pop("context_entry_schemas", {}).get("field_schema", {})
        content = item.get("content", {})

        # Filter to requested fields if specified
        if fields:
            field_list = [f.strip() for f in fields.split(",")]
            content = {k: v for k, v in content.items() if k in field_list}

        # Resolve asset references
        resolved_content = await resolve_asset_references(content, field_schema)

        return {
            "id": item["id"],
            "basket_id": item["basket_id"],
            "item_type": item["item_type"],
            "item_key": item["item_key"],
            "title": item["title"],
            "content": resolved_content,
            "tier": item["tier"],
            "completeness_score": item["completeness_score"],
            "status": item["status"],
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to get resolved context item: {e}")
        raise HTTPException(status_code=500, detail="Failed to get resolved item")


# ============================================================================
# Completeness Endpoint
# ============================================================================


@router.get("/{basket_id}/context/items/{item_type}/completeness", response_model=CompletenessResponse)
async def get_item_completeness(
    basket_id: UUID,
    item_type: str,
    item_key: Optional[str] = None,
    user: dict = Depends(verify_jwt),
):
    """Get completeness score for a context item.

    Args:
        basket_id: Basket ID
        item_type: Item type
        item_key: Item key (for non-singleton types)

    Returns:
        Completeness score and details
    """
    try:
        await verify_workspace_access(basket_id, user)

        query = (
            supabase_admin_client.table("context_items")
            .select("content, context_entry_schemas(field_schema)")
            .eq("basket_id", str(basket_id))
            .eq("item_type", item_type)
            .eq("status", "active")
        )

        if item_key:
            query = query.eq("item_key", item_key)
        else:
            query = query.is_("item_key", "null")

        result = query.single().execute()

        if not result.data:
            raise HTTPException(status_code=404, detail=f"Context item not found: {item_type}")

        field_schema = result.data.get("context_entry_schemas", {}).get("field_schema", {})
        content = result.data.get("content", {})

        completeness = calculate_completeness(content, field_schema)

        return completeness

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to get item completeness: {e}")
        raise HTTPException(status_code=500, detail="Failed to get completeness")


# ============================================================================
# Bulk Context Endpoint (for recipe execution)
# ============================================================================


@router.post("/{basket_id}/context/bulk", response_model=BulkContextResponse)
async def get_bulk_context(
    basket_id: UUID,
    body: BulkContextRequest,
    user: dict = Depends(verify_jwt),
):
    """Get multiple context items at once.

    Useful for recipe execution to fetch all required context in one request.

    Args:
        basket_id: Basket ID
        body: Request containing list of item types to fetch

    Returns:
        Dictionary of items keyed by item_type, plus list of missing types
    """
    try:
        await verify_workspace_access(basket_id, user)

        item_types = body.item_types

        result = (
            supabase_admin_client.table("context_items")
            .select("*")
            .eq("basket_id", str(basket_id))
            .in_("item_type", item_types)
            .eq("status", "active")
            .execute()
        )

        # Transform and key by item_type
        items = {}
        for item in result.data or []:
            items[item["item_type"]] = {
                "id": item["id"],
                "basket_id": item["basket_id"],
                "item_type": item["item_type"],
                "item_key": item["item_key"],
                "title": item["title"],
                "content": item["content"],
                "tier": item["tier"],
                "completeness_score": item["completeness_score"],
                "status": item["status"],
                "created_by": item.get("created_by"),
                "updated_by": item.get("updated_by"),
                "created_at": item["created_at"],
                "updated_at": item["updated_at"],
            }

        missing_types = [t for t in item_types if t not in items]

        return {
            "items": items,
            "basket_id": basket_id,
            "missing_types": missing_types,
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to get bulk context: {e}")
        raise HTTPException(status_code=500, detail="Failed to get bulk context")


# ============================================================================
# Legacy Compatibility Routes (entries -> items)
# ============================================================================
# These routes maintain backward compatibility during migration


@router.get("/{basket_id}/context/entries")
async def list_context_entries_legacy(
    basket_id: UUID,
    role: Optional[str] = None,
    tier: Optional[str] = None,
    state: str = "active",
    user: dict = Depends(verify_jwt),
):
    """DEPRECATED: Use GET /context/items instead."""
    logger.warning(f"Legacy endpoint /context/entries called - use /context/items")
    return await list_context_items(basket_id, role, tier, state, user)


@router.get("/{basket_id}/context/entries/{anchor_role}")
async def get_context_entry_legacy(
    basket_id: UUID,
    anchor_role: str,
    entry_key: Optional[str] = None,
    user: dict = Depends(verify_jwt),
):
    """DEPRECATED: Use GET /context/items/{item_type} instead."""
    logger.warning(f"Legacy endpoint /context/entries/{anchor_role} called - use /context/items/{anchor_role}")
    return await get_context_item(basket_id, anchor_role, entry_key, user)


@router.put("/{basket_id}/context/entries/{anchor_role}")
async def upsert_context_entry_legacy(
    basket_id: UUID,
    anchor_role: str,
    body: ContextItemUpdate,
    entry_key: Optional[str] = None,
    user: dict = Depends(verify_jwt),
):
    """DEPRECATED: Use PUT /context/items/{item_type} instead."""
    logger.warning(f"Legacy endpoint PUT /context/entries/{anchor_role} called - use /context/items/{anchor_role}")
    return await upsert_context_item(basket_id, anchor_role, body, entry_key, user)


@router.delete("/{basket_id}/context/entries/{anchor_role}")
async def delete_context_entry_legacy(
    basket_id: UUID,
    anchor_role: str,
    entry_key: Optional[str] = None,
    user: dict = Depends(verify_jwt),
):
    """DEPRECATED: Use DELETE /context/items/{item_type} instead."""
    logger.warning(f"Legacy endpoint DELETE /context/entries/{anchor_role} called - use /context/items/{anchor_role}")
    return await delete_context_item(basket_id, anchor_role, entry_key, user)
