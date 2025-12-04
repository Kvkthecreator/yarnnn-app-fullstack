"""Pydantic schemas for context items API.

Terminology (v3.0):
- item_type: The type of context item (replaces anchor_role)
- item_key: Optional key for non-singleton types (replaces entry_key)
- content: The structured JSONB data (replaces data)
- tier: Governance tier (foundation, working, ephemeral)

See: /docs/architecture/ADR_CONTEXT_ITEMS_UNIFIED.md
"""

from datetime import datetime
from typing import Any, Dict, List, Optional
from uuid import UUID

from pydantic import BaseModel, Field


# ============================================================================
# Context Item Schema (defines field structure)
# ============================================================================


class FieldDefinition(BaseModel):
    """Definition of a single field in a context item schema."""

    key: str
    type: str  # text, longtext, array, asset
    label: str
    required: bool = False
    placeholder: Optional[str] = None
    help: Optional[str] = None
    accept: Optional[str] = None  # For asset fields: MIME types
    item_type: Optional[str] = None  # For array fields


class ContextItemSchemaResponse(BaseModel):
    """Response model for context item schema."""

    item_type: str = Field(..., alias="anchor_role")  # DB column is anchor_role
    display_name: str
    description: Optional[str] = None
    icon: Optional[str] = None
    category: Optional[str] = None
    is_singleton: bool = True
    field_schema: Dict[str, Any]
    sort_order: int = 0
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    class Config:
        populate_by_name = True


class ContextItemSchemasListResponse(BaseModel):
    """Response model for listing all schemas."""

    schemas: List[ContextItemSchemaResponse]


# ============================================================================
# Context Item (actual data)
# ============================================================================


class ContextItemCreate(BaseModel):
    """Request model for creating a context item."""

    item_type: str
    item_key: Optional[str] = None  # For non-singleton types
    title: Optional[str] = None
    content: Dict[str, Any] = Field(default_factory=dict)
    tier: Optional[str] = None  # Auto-derived from schema if not provided


class ContextItemUpdate(BaseModel):
    """Request model for updating context item content."""

    content: Dict[str, Any]
    title: Optional[str] = None


class ContextItemResponse(BaseModel):
    """Response model for a context item."""

    id: UUID
    basket_id: UUID
    item_type: str
    item_key: Optional[str] = None
    title: Optional[str] = None
    content: Dict[str, Any]
    tier: str
    completeness_score: Optional[float] = None
    status: str = "active"
    created_by: Optional[str] = None
    updated_by: Optional[str] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    # Joined from schema (optional)
    schema_display_name: Optional[str] = None
    schema_icon: Optional[str] = None
    schema_category: Optional[str] = None


class ContextItemsListResponse(BaseModel):
    """Response model for listing context items."""

    items: List[ContextItemResponse]
    basket_id: UUID


class ResolvedAsset(BaseModel):
    """Resolved asset reference with URL."""

    asset_id: str
    file_name: Optional[str] = None
    mime_type: Optional[str] = None
    url: Optional[str] = None


class ContextItemResolvedResponse(BaseModel):
    """Response model for context item with resolved asset references."""

    id: UUID
    basket_id: UUID
    item_type: str
    item_key: Optional[str] = None
    title: Optional[str] = None
    content: Dict[str, Any]  # Asset fields resolved to ResolvedAsset objects
    tier: str
    completeness_score: Optional[float] = None
    status: str = "active"


# ============================================================================
# Completeness Calculation
# ============================================================================


class CompletenessResponse(BaseModel):
    """Response model for completeness calculation."""

    score: float  # 0.0 - 1.0
    required_fields: int
    filled_fields: int
    missing_fields: List[str]


# ============================================================================
# Bulk Operations
# ============================================================================


class BulkContextRequest(BaseModel):
    """Request model for bulk context fetch."""

    item_types: List[str]  # List of item types to fetch
    resolve_assets: bool = False  # Whether to resolve asset://uuid to URLs
    include_completeness: bool = False  # Include completeness scores


class BulkContextResponse(BaseModel):
    """Response for fetching multiple context items at once."""

    items: Dict[str, ContextItemResponse]  # Keyed by item_type
    basket_id: UUID
    missing_types: List[str]
