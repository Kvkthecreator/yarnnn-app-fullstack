"""
Context Templates API - Template Discovery and Instantiation

Provides endpoints for:
1. Listing available templates
2. Getting template schema
3. Filling templates (creating blocks)
4. Checking basket template status

Architecture: docs/architecture/CONTEXT_TEMPLATES_ARCHITECTURE.md
"""

from __future__ import annotations

import json
import logging
from datetime import datetime
from typing import Any, Dict, List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from ..utils.jwt import verify_jwt
from ..utils.service_auth import verify_user_or_service
from ..utils.supabase_client import supabase_admin_client

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/templates", tags=["context-templates"])


# ============================================================================
# Pydantic Schemas
# ============================================================================


class TemplateField(BaseModel):
    """Schema for a template field."""
    key: str
    label: str
    type: str
    required: bool = False
    placeholder: Optional[str] = None
    validation: Optional[Dict[str, Any]] = None
    options: Optional[List[str]] = None
    default: Optional[Any] = None


class TemplateSchema(BaseModel):
    """Schema definition for a context template."""
    fields: List[Dict[str, Any]]
    outputConfig: Dict[str, Any]


class TemplateResponse(BaseModel):
    """Response schema for a context template."""
    id: str
    slug: str
    name: str
    description: Optional[str]
    category: str
    schema_def: TemplateSchema = Field(alias="schema")
    scope: str
    is_required: bool
    display_order: int
    icon: Optional[str]
    created_at: datetime

    class Config:
        populate_by_name = True


class TemplateFillRequest(BaseModel):
    """Request schema for filling a template."""
    values: Dict[str, Any]  # Key-value pairs matching template fields


class TemplateFillResponse(BaseModel):
    """Response schema for template fill operation."""
    success: bool
    block_id: str
    template_slug: str
    title: str
    message: str


class TemplateStatusItem(BaseModel):
    """Status of a single template for a basket."""
    template_slug: str
    template_name: str
    is_required: bool
    is_filled: bool
    block_id: Optional[str]
    filled_at: Optional[datetime]


class BasketTemplateStatusResponse(BaseModel):
    """Response schema for basket template status."""
    basket_id: str
    templates: List[TemplateStatusItem]
    required_filled: int
    required_total: int
    is_complete: bool


# ============================================================================
# Template Discovery Endpoints
# ============================================================================


@router.get("", response_model=List[TemplateResponse])
async def list_templates(
    category: Optional[str] = Query(None, description="Filter by category"),
    scope: Optional[str] = Query(None, description="Filter by scope (global, workspace)"),
    auth_info: dict = Depends(verify_user_or_service),
):
    """
    List all available context templates.

    Args:
        category: Filter by category (foundational, research, operational)
        scope: Filter by scope (global, workspace)

    Returns:
        List of templates with their schemas
    """
    try:
        query = supabase_admin_client.table("context_template_catalog").select("*")

        if category:
            query = query.eq("category", category)
        if scope:
            query = query.eq("scope", scope)

        query = query.order("display_order")
        result = query.execute()

        templates = []
        for row in result.data or []:
            templates.append({
                "id": str(row["id"]),
                "slug": row["slug"],
                "name": row["name"],
                "description": row.get("description"),
                "category": row.get("category", "foundational"),
                "schema": row.get("schema", {}),
                "scope": row.get("scope", "global"),
                "is_required": row.get("is_required", False),
                "display_order": row.get("display_order", 0),
                "icon": row.get("icon"),
                "created_at": row["created_at"],
            })

        return templates

    except Exception as e:
        logger.exception(f"Failed to list templates: {e}")
        raise HTTPException(status_code=500, detail="Failed to list templates")


@router.get("/{slug}", response_model=TemplateResponse)
async def get_template(
    slug: str,
    auth_info: dict = Depends(verify_user_or_service),
):
    """
    Get a specific template by slug.

    Args:
        slug: Template slug (e.g., "brand_identity")

    Returns:
        Template with schema definition
    """
    try:
        result = (
            supabase_admin_client.table("context_template_catalog")
            .select("*")
            .eq("slug", slug)
            .single()
            .execute()
        )

        if not result.data:
            raise HTTPException(status_code=404, detail=f"Template not found: {slug}")

        row = result.data
        return {
            "id": str(row["id"]),
            "slug": row["slug"],
            "name": row["name"],
            "description": row.get("description"),
            "category": row.get("category", "foundational"),
            "schema": row.get("schema", {}),
            "scope": row.get("scope", "global"),
            "is_required": row.get("is_required", False),
            "display_order": row.get("display_order", 0),
            "icon": row.get("icon"),
            "created_at": row["created_at"],
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"Failed to get template: {e}")
        raise HTTPException(status_code=500, detail="Failed to get template")


# ============================================================================
# Template Fill Endpoints
# ============================================================================


@router.post("/baskets/{basket_id}/fill/{slug}", response_model=TemplateFillResponse)
async def fill_template(
    basket_id: str,
    slug: str,
    fill_request: TemplateFillRequest,
    auth_info: dict = Depends(verify_user_or_service),
):
    """
    Fill a template to create a foundational block.

    This creates a block with:
    - semantic_type from template outputConfig
    - title from template title_template
    - content as JSON of the filled values
    - metadata.template_id for tracking

    Args:
        basket_id: Target basket ID
        slug: Template slug
        fill_request: Values to fill the template

    Returns:
        Created block information
    """
    try:
        # Get template
        template_result = (
            supabase_admin_client.table("context_template_catalog")
            .select("*")
            .eq("slug", slug)
            .single()
            .execute()
        )

        if not template_result.data:
            raise HTTPException(status_code=404, detail=f"Template not found: {slug}")

        template = template_result.data
        schema = template.get("schema", {})
        output_config = schema.get("outputConfig", {})
        fields = schema.get("fields", [])

        # Validate required fields
        for field in fields:
            if field.get("required") and field["key"] not in fill_request.values:
                raise HTTPException(
                    status_code=400,
                    detail=f"Required field missing: {field['key']}"
                )

        # Get basket to get workspace_id
        basket_result = (
            supabase_admin_client.table("baskets")
            .select("workspace_id")
            .eq("id", basket_id)
            .single()
            .execute()
        )

        if not basket_result.data:
            raise HTTPException(status_code=404, detail=f"Basket not found: {basket_id}")

        workspace_id = basket_result.data["workspace_id"]

        # Check if template already filled (update or create)
        existing_block = (
            supabase_admin_client.table("blocks")
            .select("id")
            .eq("basket_id", basket_id)
            .eq("metadata->>template_id", slug)
            .execute()
        )

        # Build title from template
        title_template = output_config.get("title_template", template["name"])
        title = title_template
        for key, value in fill_request.values.items():
            title = title.replace(f"{{{key}}}", str(value) if value else "")

        # Build block data
        block_data = {
            "basket_id": basket_id,
            "workspace_id": workspace_id,
            "semantic_type": output_config.get("semantic_type", "entity"),
            "title": title.strip(),
            "content": json.dumps(fill_request.values),
            "state": output_config.get("state", "ACCEPTED"),
            "metadata": {
                "template_id": slug,
                "template_version": 1,
                "filled_at": datetime.utcnow().isoformat(),
            },
        }

        if existing_block.data:
            # Update existing block
            block_id = existing_block.data[0]["id"]
            result = (
                supabase_admin_client.table("blocks")
                .update({
                    "title": block_data["title"],
                    "content": block_data["content"],
                    "metadata": block_data["metadata"],
                    "updated_at": datetime.utcnow().isoformat(),
                })
                .eq("id", block_id)
                .execute()
            )
            message = f"Updated existing block for template '{slug}'"
        else:
            # Create new block
            result = (
                supabase_admin_client.table("blocks")
                .insert(block_data)
                .execute()
            )
            block_id = result.data[0]["id"]
            message = f"Created new block from template '{slug}'"

        logger.info(f"[TEMPLATE FILL] {message} - block_id={block_id}")

        return TemplateFillResponse(
            success=True,
            block_id=str(block_id),
            template_slug=slug,
            title=block_data["title"],
            message=message,
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"Failed to fill template: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to fill template: {str(e)}")


# ============================================================================
# Basket Template Status Endpoints
# ============================================================================


@router.get("/baskets/{basket_id}/status", response_model=BasketTemplateStatusResponse)
async def get_basket_template_status(
    basket_id: str,
    auth_info: dict = Depends(verify_user_or_service),
):
    """
    Get template fill status for a basket.

    Returns which templates are filled and which are still needed.

    Args:
        basket_id: Basket ID

    Returns:
        Template status for the basket
    """
    try:
        # Use the helper function we created in migration
        result = supabase_admin_client.rpc(
            "get_basket_template_status",
            {"p_basket_id": basket_id}
        ).execute()

        templates = []
        required_filled = 0
        required_total = 0

        for row in result.data or []:
            is_required = row.get("is_required", False)
            is_filled = row.get("is_filled", False)

            if is_required:
                required_total += 1
                if is_filled:
                    required_filled += 1

            templates.append(TemplateStatusItem(
                template_slug=row["template_slug"],
                template_name=row["template_name"],
                is_required=is_required,
                is_filled=is_filled,
                block_id=str(row["block_id"]) if row.get("block_id") else None,
                filled_at=row.get("filled_at"),
            ))

        return BasketTemplateStatusResponse(
            basket_id=basket_id,
            templates=templates,
            required_filled=required_filled,
            required_total=required_total,
            is_complete=(required_filled >= required_total),
        )

    except Exception as e:
        logger.exception(f"Failed to get basket template status: {e}")
        raise HTTPException(status_code=500, detail="Failed to get template status")


@router.get("/baskets/{basket_id}/foundational-blocks")
async def get_foundational_blocks(
    basket_id: str,
    template_slugs: Optional[str] = Query(None, description="Comma-separated template slugs"),
    auth_info: dict = Depends(verify_user_or_service),
):
    """
    Get foundational blocks for agent context assembly.

    Used by work-platform to load template-derived blocks for agent execution.

    Args:
        basket_id: Basket ID
        template_slugs: Comma-separated list of template slugs to retrieve

    Returns:
        List of foundational blocks with their content
    """
    try:
        if template_slugs:
            slugs = [s.strip() for s in template_slugs.split(",")]
        else:
            # Default: all global templates
            templates_result = (
                supabase_admin_client.table("context_template_catalog")
                .select("slug")
                .eq("scope", "global")
                .execute()
            )
            slugs = [t["slug"] for t in templates_result.data or []]

        if not slugs:
            return {"blocks": [], "basket_id": basket_id}

        # Use helper function
        result = supabase_admin_client.rpc(
            "get_foundational_blocks",
            {"p_basket_id": basket_id, "p_template_slugs": slugs}
        ).execute()

        blocks = []
        for row in result.data or []:
            # Parse content as JSON if possible
            try:
                content_parsed = json.loads(row["content"])
            except (json.JSONDecodeError, TypeError):
                content_parsed = row["content"]

            blocks.append({
                "template_slug": row["template_slug"],
                "block_id": str(row["block_id"]),
                "title": row["title"],
                "content": content_parsed,
                "semantic_type": row["semantic_type"],
                "created_at": row["created_at"],
            })

        return {
            "blocks": blocks,
            "basket_id": basket_id,
            "templates_requested": slugs,
            "templates_found": list(set(b["template_slug"] for b in blocks)),
        }

    except Exception as e:
        logger.exception(f"Failed to get foundational blocks: {e}")
        raise HTTPException(status_code=500, detail="Failed to get foundational blocks")
