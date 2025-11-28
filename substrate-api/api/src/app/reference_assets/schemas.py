"""Pydantic schemas for reference assets API."""

from __future__ import annotations

from datetime import datetime
from typing import Optional, List
from uuid import UUID

from pydantic import BaseModel, Field


class ReferenceAssetUpload(BaseModel):
    """Request model for uploading a reference asset."""

    asset_type: str = Field(..., description="Asset type from asset_type_catalog")
    description: Optional[str] = Field(None, description="Description of the asset")
    agent_scope: Optional[List[str]] = Field(None, description="Agent types that can access this asset")
    tags: Optional[List[str]] = Field(None, description="Tags for categorization")
    permanence: str = Field("permanent", description="'permanent' or 'temporary'")
    work_session_id: Optional[UUID] = Field(None, description="Work session ID for temporary assets")
    metadata: Optional[dict] = Field(default_factory=dict, description="Additional metadata")


class ReferenceAssetResponse(BaseModel):
    """Response model for reference asset."""

    id: UUID
    basket_id: UUID
    storage_path: str
    file_name: str
    file_size_bytes: Optional[int]
    mime_type: Optional[str]
    asset_type: str
    asset_category: str
    permanence: str
    expires_at: Optional[datetime]
    work_session_id: Optional[UUID]
    agent_scope: Optional[List[str]]
    metadata: dict
    tags: Optional[List[str]]
    description: Optional[str]
    created_at: datetime
    created_by_user_id: Optional[UUID]
    last_accessed_at: Optional[datetime]
    access_count: int


class ReferenceAssetListResponse(BaseModel):
    """Response model for listing reference assets."""

    assets: List[ReferenceAssetResponse]
    total: int
    basket_id: UUID


class SignedURLResponse(BaseModel):
    """Response model for signed URL."""

    signed_url: str
    expires_at: datetime


class AssetTypeResponse(BaseModel):
    """Response model for asset type catalog entry."""

    asset_type: str
    display_name: str
    description: Optional[str]
    category: Optional[str]
    allowed_mime_types: Optional[List[str]]
    is_active: bool


class MinimalAssetUploadResponse(BaseModel):
    """Response model for minimal asset upload (pending classification)."""

    id: UUID
    basket_id: UUID
    file_name: str
    mime_type: Optional[str]
    file_size_bytes: Optional[int]
    classification_status: str  # "unclassified" initially
    message: str


class ClassificationResultResponse(BaseModel):
    """Response model for classification result."""

    asset_id: UUID
    asset_type: str
    asset_category: str
    description: Optional[str]
    classification_confidence: Optional[float]
    classification_status: str
    reasoning: Optional[str]
