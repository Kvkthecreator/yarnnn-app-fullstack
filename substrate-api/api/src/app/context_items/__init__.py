"""Context Items API module.

Provides CRUD operations for structured context items with tiered governance.
This is the unified context table supporting foundation, working, and ephemeral tiers.

Terminology (v3.0):
- item_type: The type of context item (problem, customer, vision, brand, etc.)
- item_key: Optional key for non-singleton types (e.g., competitor name)
- content: The structured JSONB data
- tier: Governance tier (foundation, working, ephemeral)

See: /docs/architecture/ADR_CONTEXT_ITEMS_UNIFIED.md
"""

from .routes import router
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

__all__ = [
    "router",
    "ContextItemCreate",
    "ContextItemUpdate",
    "ContextItemResponse",
    "ContextItemsListResponse",
    "ContextItemSchemaResponse",
    "ContextItemSchemasListResponse",
    "ContextItemResolvedResponse",
    "CompletenessResponse",
    "BulkContextRequest",
    "BulkContextResponse",
]
