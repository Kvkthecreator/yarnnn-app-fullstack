import json
import os
import sys
from datetime import datetime
from uuid import uuid4, UUID
from typing import Optional

# CRITICAL: Add src to path BEFORE any other imports that depend on it
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "../../.."))

from contracts.basket import BasketChangeRequest, BasketDelta
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field, ValidationError
from ..baskets.schemas import BasketWorkRequest
from typing import Union
from services.deltas import list_deltas, persist_delta, try_apply_delta
from services.idempotency import (
    already_processed,
    fetch_delta_by_request_id,
    mark_processed,
)
# Legacy manager removed - use canonical queue processor
from src.services.canonical_queue_processor import CanonicalQueueProcessor, get_canonical_queue_health

# Import deps AFTER path setup
from ..deps import get_db
from ..utils.jwt import verify_jwt
from ..utils.workspace import get_or_create_workspace

router = APIRouter(prefix="/api/baskets", tags=["baskets"])


# ========================================================================
# Phase 6: Basket Creation Models
# ========================================================================


class CreateBasketRequest(BaseModel):
    """Request model for creating a new basket."""

    workspace_id: str = Field(..., description="Workspace ID for basket")
    name: str = Field(..., min_length=1, max_length=200, description="Basket name")
    metadata: Optional[dict] = Field(default_factory=dict, description="Metadata (stored in tags as JSON)")
    user_id: Optional[str] = Field(None, description="User ID (for audit trail)")


class CreateBasketResponse(BaseModel):
    """Response model for basket creation."""

    basket_id: str
    name: str
    workspace_id: str
    status: str
    user_id: Optional[str]
    created_at: str


# ========================================================================
# Phase 4: Service-to-Service Blocks Endpoint (BFF Pattern)
# IMPORTANT: Must be defined BEFORE /{basket_id} to ensure proper route matching
# ========================================================================


@router.get("/{basket_id}/blocks")
async def list_basket_blocks(
    basket_id: str,
    states: Optional[str] = None,
    limit: int = 20,
    prioritize_anchors: bool = True,
    db=Depends(get_db),  # noqa: B008
):
    """
    List blocks for a basket (service-to-service endpoint).

    Phase 4: Called by work-platform's SubstrateMemoryAdapter via substrate_client.
    This endpoint is part of the Phase 3 BFF architecture - work-platform never
    touches substrate tables directly.

    No JWT auth required - uses service-to-service auth via exempt_prefixes.

    Args:
        basket_id: Basket UUID
        states: Optional comma-separated list of block states (e.g., "ACCEPTED,LOCKED")
        limit: Maximum number of blocks to return (default: 20)
        prioritize_anchors: If True, anchor blocks appear first (default: True)
        db: Database connection

    Returns:
        List of block dictionaries with id, title, content, semantic_type,
        confidence_score, state, anchor_role, created_at, updated_at

    Raises:
        HTTPException 400: Invalid basket_id format
        HTTPException 500: Database error
    """
    import logging

    logger = logging.getLogger(__name__)

    try:
        # Validate basket_id is valid UUID
        try:
            basket_uuid = UUID(basket_id)
        except (ValueError, AttributeError) as e:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid basket_id format: {basket_id}",
            ) from e

        # Build query with optional state filtering
        # Include anchor_role for context assembly prioritization
        query = """
            SELECT id, title, content, semantic_type, confidence_score, state,
                   anchor_role, anchor_status, anchor_confidence,
                   created_at, updated_at
            FROM blocks
            WHERE basket_id = :basket_id
        """

        query_values = {"basket_id": str(basket_uuid)}

        # Add state filtering if provided
        if states:
            state_list = [s.strip().upper() for s in states.split(",")]
            # Use ANY for array comparison
            query += " AND state = ANY(:states)"
            query_values["states"] = state_list

        # Sort anchor blocks first (advisory pattern - anchors are quality signals)
        # anchor_role IS NOT NULL = 1 (true), IS NULL = 0 (false)
        # DESC puts 1s (anchors) first
        if prioritize_anchors:
            query += " ORDER BY (anchor_role IS NOT NULL) DESC, created_at DESC LIMIT :limit"
        else:
            query += " ORDER BY created_at DESC LIMIT :limit"
        query_values["limit"] = limit

        results = await db.fetch_all(query, values=query_values)

        # Convert to dict format
        blocks = [dict(row) for row in results]

        anchor_count = sum(1 for b in blocks if b.get("anchor_role"))
        logger.debug(
            f"[SERVICE] Fetched {len(blocks)} blocks ({anchor_count} anchors) for basket {basket_id} "
            f"(states={states}, limit={limit}, prioritize_anchors={prioritize_anchors})"
        )

        return blocks

    except HTTPException:
        raise

    except Exception as e:
        logger.exception(f"Failed to fetch blocks for basket {basket_id}: {e}")
        raise HTTPException(
            status_code=500, detail=f"Failed to fetch blocks: {str(e)}"
        ) from e


# ========================================================================
# Phase 6: Basket Creation Endpoint
# ========================================================================


@router.post("", response_model=CreateBasketResponse, status_code=201)
async def create_basket(
    request: CreateBasketRequest,
    db=Depends(get_db),  # noqa: B008
):
    """
    Create a new basket.

    Phase 6: Called by work-platform's onboarding_scaffolder via substrate_client.
    This endpoint is part of the Phase 3 BFF architecture - work-platform never
    touches substrate tables directly.

    Args:
        request: Basket creation parameters
        db: Database connection

    Returns:
        Created basket information

    Raises:
        HTTPException 400: Invalid workspace_id or validation error
        HTTPException 500: Database error
    """
    import logging

    logger = logging.getLogger(__name__)

    try:
        # Validate workspace_id is valid UUID
        try:
            workspace_uuid = UUID(request.workspace_id)
        except (ValueError, AttributeError) as e:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid workspace_id format: {request.workspace_id}",
            ) from e

        # Validate user_id if provided
        user_uuid = None
        if request.user_id:
            try:
                user_uuid = UUID(request.user_id)
            except (ValueError, AttributeError) as e:
                raise HTTPException(
                    status_code=400,
                    detail=f"Invalid user_id format: {request.user_id}",
                ) from e

        # Generate basket ID
        basket_id = uuid4()

        # Prepare tags array with metadata
        tags = []
        if request.metadata:
            # Store metadata keys as tags for searchability
            for key, value in request.metadata.items():
                tags.append(f"{key}:{str(value)}")

        # Insert basket using actual production schema
        query = """
            INSERT INTO baskets (id, name, workspace_id, user_id, status, tags, origin_template)
            VALUES (:id, :name, :workspace_id, :user_id, :status, :tags, :origin_template)
            RETURNING id, name, workspace_id, user_id, status, created_at
        """

        result = await db.fetch_one(
            query,
            values={
                "id": str(basket_id),
                "name": request.name,
                "workspace_id": str(workspace_uuid),
                "user_id": str(user_uuid) if user_uuid else None,
                "status": "INIT",  # basket_state enum default
                "tags": tags,
                "origin_template": "work_platform_onboarding",  # origin_template for tracking
            },
        )

        if not result:
            raise HTTPException(status_code=500, detail="Failed to create basket")

        logger.info(
            f"[BASKET CREATE] Created basket {result['id']} "
            f"for workspace {result['workspace_id']} via Phase 6 onboarding"
        )

        return CreateBasketResponse(
            basket_id=str(result["id"]),
            name=result["name"],
            workspace_id=str(result["workspace_id"]),
            user_id=str(result["user_id"]) if result["user_id"] else None,
            status=str(result["status"]),
            created_at=result["created_at"].isoformat(),
        )

    except HTTPException:
        # Re-raise HTTP exceptions as-is
        raise

    except Exception as e:
        logger.exception(f"Failed to create basket: {e}")
        raise HTTPException(
            status_code=500, detail=f"Failed to create basket: {str(e)}"
        ) from e


@router.get("/{basket_id}", status_code=200)
async def get_basket(
    basket_id: str,
    user: dict = Depends(verify_jwt),  # noqa: B008
    db=Depends(get_db),  # noqa: B008
):
    """
    Get basket details with stats.

    Service-to-service endpoint for BFF pattern. Returns basket metadata
    and aggregate counts (blocks, documents).

    Args:
        basket_id: Basket UUID
        db: Database connection

    Returns:
        {
            "id": "...",
            "name": "...",
            "status": "...",
            "workspace_id": "...",
            "user_id": "...",
            "created_at": "...",
            "updated_at": "...",
            "stats": {
                "blocks_count": 0,
                "documents_count": 0
            }
        }

    Raises:
        HTTPException 404: Basket not found
        HTTPException 500: Database error
    """
    import logging

    logger = logging.getLogger(__name__)

    try:
        # Validate basket_id is valid UUID
        try:
            basket_uuid = UUID(basket_id)
        except (ValueError, AttributeError) as e:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid basket_id format: {basket_id}",
            ) from e

        # Fetch basket with stats
        basket_query = """
            SELECT
                id,
                name,
                status,
                workspace_id,
                user_id,
                created_at
            FROM baskets
            WHERE id = :basket_id
        """

        basket = await db.fetch_one(basket_query, values={"basket_id": str(basket_uuid)})

        if not basket:
            raise HTTPException(status_code=404, detail="Basket not found")

        # Get blocks count
        blocks_count_query = """
            SELECT COUNT(*) as count
            FROM blocks
            WHERE basket_id = :basket_id
            AND state IN ('CONSTANT', 'LOCKED', 'ACCEPTED', 'PROPOSED')
        """
        blocks_result = await db.fetch_one(blocks_count_query, values={"basket_id": str(basket_uuid)})
        blocks_count = blocks_result["count"] if blocks_result else 0

        # Get documents count
        documents_count_query = """
            SELECT COUNT(*) as count
            FROM documents
            WHERE basket_id = :basket_id
        """
        documents_result = await db.fetch_one(documents_count_query, values={"basket_id": str(basket_uuid)})
        documents_count = documents_result["count"] if documents_result else 0

        logger.info(f"[BASKET GET] Fetched basket {basket_id}: {blocks_count} blocks, {documents_count} documents")

        return {
            "id": str(basket["id"]),
            "name": basket["name"],
            "status": basket["status"],
            "workspace_id": str(basket["workspace_id"]),
            "user_id": str(basket["user_id"]) if basket["user_id"] else None,
            "created_at": basket["created_at"].isoformat(),
            "stats": {
                "blocks_count": blocks_count,
                "documents_count": documents_count,
            },
        }

    except HTTPException:
        raise

    except Exception as e:
        logger.exception(f"Failed to fetch basket {basket_id}: {e}")
        raise HTTPException(
            status_code=500, detail=f"Failed to fetch basket: {str(e)}"
        ) from e


@router.post("/{basket_id}/work", response_model=BasketDelta)
async def post_basket_work(
    basket_id: str,
    request: Request,
    user: dict = Depends(verify_jwt),  # noqa: B008
    db=Depends(get_db),  # noqa: B008
):
    """Process basket work request with mode support"""
    
    # Parse request body to determine format
    try:
        body = await request.json()
    except Exception as err:
        raise HTTPException(400, "Invalid JSON") from err

    workspace_id = get_or_create_workspace(user["user_id"])
    trace_req_id = request.headers.get("X-Req-Id")

    if "mode" in body:
        # New BasketWorkRequest format
        from ..baskets.schemas import BasketWorkRequest
        try:
            work_req = BasketWorkRequest.model_validate(body)
        except ValidationError as err:
            raise HTTPException(422, err.errors())

        # Attach trace ID (don't lose it)
        work_req.options.trace_req_id = trace_req_id

        # Idempotency for new mode - prioritize trace_req_id for deduplication
        request_id = (work_req.options.trace_req_id
                      or request.headers.get("X-Req-Id")
                      or f"work_{uuid4().hex[:8]}")
        if await already_processed(db, request_id):
            cached_delta = await fetch_delta_by_request_id(db, request_id)
            if not cached_delta:
                raise HTTPException(409, "Duplicate request but missing delta")
            return BasketDelta(**json.loads(cached_delta["payload"]))

        # ✅ Call canonical queue processor for basket work
        processor = CanonicalQueueProcessor()
        delta = await processor.process_basket_work(basket_id, work_req, workspace_id)

        await persist_delta(db, delta, request_id)
        await mark_processed(db, request_id, delta.delta_id)
        return delta

    else:
        # Legacy BasketChangeRequest format
        try:
            req = BasketChangeRequest.model_validate(body)
        except ValidationError as err:
            raise HTTPException(422, err.errors())
        if req.basket_id != basket_id:
            raise HTTPException(400, "basket_id mismatch")

        if await already_processed(db, req.request_id):
            cached_delta = await fetch_delta_by_request_id(db, req.request_id)
            if not cached_delta:
                raise HTTPException(409, "Duplicate request but missing delta")
            return BasketDelta(**json.loads(cached_delta["payload"]))

        # Legacy path with basket_id - use canonical queue processor
        processor = CanonicalQueueProcessor()
        delta = await processor.process_basket_change(basket_id, req, workspace_id)

        await persist_delta(db, delta, req.request_id)
        await mark_processed(db, req.request_id, delta.delta_id)
        return delta


# ========================================================================
# User-Authored Block CRUD (Direct, No Governance)
#
# These endpoints enable direct block management for USER-authored content.
# Governance is reserved for AGENT outputs where quality is uncertain.
# User inputs are trusted - the user IS providing the judgment.
#
# Key safeguards maintained:
# - Async embedding regeneration (semantic search integrity)
# - Timeline events (audit trail / provenance)
# - Workspace scoping (security)
# - State machine validation (no invalid state transitions)
# ========================================================================


class CreateBlockRequest(BaseModel):
    """Request model for creating a user-authored block."""

    title: str = Field(..., min_length=1, max_length=500, description="Block title")
    content: str = Field(..., min_length=1, max_length=50000, description="Block content")
    semantic_type: str = Field(..., description="Semantic type (fact, metric, intent, etc.)")
    workspace_id: str = Field(..., description="Workspace ID")
    anchor_role: Optional[str] = Field(None, description="Optional anchor role")
    metadata: Optional[dict] = Field(default_factory=dict, description="Optional metadata")


class UpdateBlockRequest(BaseModel):
    """Request model for updating a user-authored block."""

    title: Optional[str] = Field(None, max_length=500, description="Updated title")
    content: Optional[str] = Field(None, max_length=50000, description="Updated content")
    semantic_type: Optional[str] = Field(None, description="Updated semantic type")
    metadata: Optional[dict] = Field(None, description="Updated metadata")


class BlockResponse(BaseModel):
    """Response model for block operations."""

    id: str
    basket_id: str
    workspace_id: str
    title: str
    content: str
    semantic_type: str
    state: str
    confidence_score: Optional[float] = None
    anchor_role: Optional[str] = None
    created_at: str
    updated_at: Optional[str] = None
    warning: Optional[str] = None  # For near-duplicate warnings


@router.post("/{basket_id}/blocks", response_model=BlockResponse, status_code=201)
async def create_block(
    basket_id: str,
    request: CreateBlockRequest,
    db=Depends(get_db),  # noqa: B008
):
    """
    Create a user-authored block directly (no governance).

    User-provided blocks are trusted and created in ACCEPTED state immediately.
    This bypasses the PROPOSED → ACCEPTED governance flow because the user
    IS providing the judgment (unlike agent outputs which need review).

    Safeguards maintained:
    - Async embedding generation queued after creation
    - Timeline event recorded for audit trail
    - Workspace scoping enforced

    Args:
        basket_id: Target basket UUID
        request: Block creation parameters

    Returns:
        Created block with optional near-duplicate warning

    Raises:
        HTTPException 400: Invalid basket_id or validation error
        HTTPException 500: Database error
    """
    import logging
    from uuid import uuid4
    from datetime import datetime

    logger = logging.getLogger(__name__)

    try:
        # Validate UUIDs
        try:
            basket_uuid = UUID(basket_id)
            workspace_uuid = UUID(request.workspace_id)
        except (ValueError, AttributeError) as e:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid UUID format: {str(e)}",
            ) from e

        # Generate block ID
        block_id = str(uuid4())

        # User-authored blocks get ACCEPTED state and high confidence
        block_data = {
            "id": block_id,
            "basket_id": str(basket_uuid),
            "workspace_id": str(workspace_uuid),
            "title": request.title,
            "content": request.content,
            "semantic_type": request.semantic_type,
            "state": "ACCEPTED",  # User-authored = trusted
            "confidence_score": 1.0,  # User-provided = highest confidence
            "anchor_role": request.anchor_role,
            "anchor_status": "accepted" if request.anchor_role else None,
            "anchor_confidence": 1.0 if request.anchor_role else None,
            "metadata": {
                **(request.metadata or {}),
                "source": "user_authored",
                "created_via": "direct_block_crud",
            },
        }

        # Insert block
        query = """
            INSERT INTO blocks (
                id, basket_id, workspace_id, title, content, semantic_type,
                state, confidence_score, anchor_role, anchor_status,
                anchor_confidence, metadata
            )
            VALUES (
                :id, :basket_id, :workspace_id, :title, :content, :semantic_type,
                :state, :confidence_score, :anchor_role, :anchor_status,
                :anchor_confidence, :metadata
            )
            RETURNING id, basket_id, workspace_id, title, content, semantic_type,
                      state, confidence_score, anchor_role, created_at, updated_at
        """

        result = await db.fetch_one(
            query,
            values={
                **block_data,
                "metadata": json.dumps(block_data["metadata"]),
            },
        )

        if not result:
            raise HTTPException(status_code=500, detail="Failed to create block")

        logger.info(
            f"[BLOCK CREATE] Created user-authored block {block_id} "
            f"in basket {basket_id} (type={request.semantic_type})"
        )

        # Queue async embedding generation (non-blocking)
        try:
            from jobs.embedding_generator import queue_embedding_generation
            import asyncio
            asyncio.create_task(queue_embedding_generation(block_id))
            logger.debug(f"[BLOCK CREATE] Queued embedding generation for {block_id}")
        except Exception as embed_err:
            logger.warning(f"[BLOCK CREATE] Embedding queue failed (non-fatal): {embed_err}")

        # Emit timeline event (non-blocking)
        try:
            timeline_query = """
                SELECT emit_timeline_event(
                    :basket_id, 'block.created', :block_id,
                    :event_data, :workspace_id, NULL, 'user_authored'
                )
            """
            await db.execute(
                timeline_query,
                values={
                    "basket_id": str(basket_uuid),
                    "block_id": block_id,
                    "event_data": json.dumps({
                        "block_id": block_id,
                        "semantic_type": request.semantic_type,
                        "source": "user_authored",
                    }),
                    "workspace_id": str(workspace_uuid),
                },
            )
        except Exception as timeline_err:
            logger.warning(f"[BLOCK CREATE] Timeline event failed (non-fatal): {timeline_err}")

        return BlockResponse(
            id=str(result["id"]),
            basket_id=str(result["basket_id"]),
            workspace_id=str(result["workspace_id"]),
            title=result["title"],
            content=result["content"],
            semantic_type=result["semantic_type"],
            state=result["state"],
            confidence_score=result["confidence_score"],
            anchor_role=result["anchor_role"],
            created_at=result["created_at"].isoformat(),
            updated_at=result["updated_at"].isoformat() if result["updated_at"] else None,
        )

    except HTTPException:
        raise

    except Exception as e:
        logger.exception(f"Failed to create block in basket {basket_id}: {e}")
        raise HTTPException(
            status_code=500, detail=f"Failed to create block: {str(e)}"
        ) from e


@router.put("/{basket_id}/blocks/{block_id}", response_model=BlockResponse)
async def update_block(
    basket_id: str,
    block_id: str,
    request: UpdateBlockRequest,
    db=Depends(get_db),  # noqa: B008
):
    """
    Update a user-authored block directly (no governance).

    Only blocks in ACCEPTED or PROPOSED state can be updated.
    LOCKED blocks cannot be modified (require explicit unlock first).

    Safeguards maintained:
    - Async embedding regeneration queued after update
    - Timeline event recorded for audit trail
    - State machine validation

    Args:
        basket_id: Basket UUID
        block_id: Block UUID to update
        request: Fields to update

    Returns:
        Updated block

    Raises:
        HTTPException 400: Invalid UUID format
        HTTPException 403: Block is LOCKED and cannot be modified
        HTTPException 404: Block not found
        HTTPException 500: Database error
    """
    import logging
    from datetime import datetime

    logger = logging.getLogger(__name__)

    try:
        # Validate UUIDs
        try:
            basket_uuid = UUID(basket_id)
            block_uuid = UUID(block_id)
        except (ValueError, AttributeError) as e:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid UUID format: {str(e)}",
            ) from e

        # Fetch existing block to check state
        check_query = """
            SELECT id, state, workspace_id FROM blocks
            WHERE id = :block_id AND basket_id = :basket_id
        """
        existing = await db.fetch_one(
            check_query,
            values={"block_id": str(block_uuid), "basket_id": str(basket_uuid)},
        )

        if not existing:
            raise HTTPException(status_code=404, detail="Block not found")

        # Prevent modification of LOCKED blocks
        if existing["state"] == "LOCKED":
            raise HTTPException(
                status_code=403,
                detail="LOCKED blocks cannot be modified. Unlock first if needed.",
            )

        # Build update query dynamically based on provided fields
        update_fields = []
        update_values = {"block_id": str(block_uuid), "basket_id": str(basket_uuid)}

        if request.title is not None:
            update_fields.append("title = :title")
            update_values["title"] = request.title

        if request.content is not None:
            update_fields.append("content = :content")
            update_values["content"] = request.content
            # Clear embedding when content changes (will be regenerated)
            update_fields.append("embedding = NULL")

        if request.semantic_type is not None:
            update_fields.append("semantic_type = :semantic_type")
            update_values["semantic_type"] = request.semantic_type

        if request.metadata is not None:
            update_fields.append("metadata = metadata || :metadata")
            update_values["metadata"] = json.dumps({
                **request.metadata,
                "last_modified_via": "direct_block_crud",
                "modified_at": datetime.utcnow().isoformat(),
            })

        if not update_fields:
            raise HTTPException(status_code=400, detail="No fields to update")

        # Add updated_at
        update_fields.append("updated_at = NOW()")

        update_query = f"""
            UPDATE blocks
            SET {', '.join(update_fields)}
            WHERE id = :block_id AND basket_id = :basket_id
            RETURNING id, basket_id, workspace_id, title, content, semantic_type,
                      state, confidence_score, anchor_role, created_at, updated_at
        """

        result = await db.fetch_one(update_query, values=update_values)

        if not result:
            raise HTTPException(status_code=500, detail="Failed to update block")

        logger.info(
            f"[BLOCK UPDATE] Updated block {block_id} in basket {basket_id}"
        )

        # Queue async embedding regeneration if content changed
        if request.content is not None:
            try:
                from jobs.embedding_generator import queue_embedding_generation
                import asyncio
                asyncio.create_task(queue_embedding_generation(block_id))
                logger.debug(f"[BLOCK UPDATE] Queued embedding regeneration for {block_id}")
            except Exception as embed_err:
                logger.warning(f"[BLOCK UPDATE] Embedding queue failed (non-fatal): {embed_err}")

        # Emit timeline event
        try:
            timeline_query = """
                SELECT emit_timeline_event(
                    :basket_id, 'block.updated', :block_id,
                    :event_data, :workspace_id, NULL, 'user_authored'
                )
            """
            await db.execute(
                timeline_query,
                values={
                    "basket_id": str(basket_uuid),
                    "block_id": block_id,
                    "event_data": json.dumps({
                        "block_id": block_id,
                        "fields_updated": list(update_values.keys()),
                        "source": "user_authored",
                    }),
                    "workspace_id": str(existing["workspace_id"]),
                },
            )
        except Exception as timeline_err:
            logger.warning(f"[BLOCK UPDATE] Timeline event failed (non-fatal): {timeline_err}")

        return BlockResponse(
            id=str(result["id"]),
            basket_id=str(result["basket_id"]),
            workspace_id=str(result["workspace_id"]),
            title=result["title"],
            content=result["content"],
            semantic_type=result["semantic_type"],
            state=result["state"],
            confidence_score=result["confidence_score"],
            anchor_role=result["anchor_role"],
            created_at=result["created_at"].isoformat(),
            updated_at=result["updated_at"].isoformat() if result["updated_at"] else None,
        )

    except HTTPException:
        raise

    except Exception as e:
        logger.exception(f"Failed to update block {block_id}: {e}")
        raise HTTPException(
            status_code=500, detail=f"Failed to update block: {str(e)}"
        ) from e


@router.delete("/{basket_id}/blocks/{block_id}", status_code=200)
async def delete_block(
    basket_id: str,
    block_id: str,
    db=Depends(get_db),  # noqa: B008
):
    """
    Soft-delete a block by setting state to SUPERSEDED.

    LOCKED blocks cannot be deleted (require explicit unlock first).
    This is a soft-delete - the block remains in the database for
    historical record but is excluded from active queries.

    Args:
        basket_id: Basket UUID
        block_id: Block UUID to delete

    Returns:
        Deletion confirmation

    Raises:
        HTTPException 400: Invalid UUID format
        HTTPException 403: Block is LOCKED and cannot be deleted
        HTTPException 404: Block not found
        HTTPException 500: Database error
    """
    import logging

    logger = logging.getLogger(__name__)

    try:
        # Validate UUIDs
        try:
            basket_uuid = UUID(basket_id)
            block_uuid = UUID(block_id)
        except (ValueError, AttributeError) as e:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid UUID format: {str(e)}",
            ) from e

        # Fetch existing block to check state
        check_query = """
            SELECT id, state, workspace_id FROM blocks
            WHERE id = :block_id AND basket_id = :basket_id
        """
        existing = await db.fetch_one(
            check_query,
            values={"block_id": str(block_uuid), "basket_id": str(basket_uuid)},
        )

        if not existing:
            raise HTTPException(status_code=404, detail="Block not found")

        # Prevent deletion of LOCKED blocks
        if existing["state"] == "LOCKED":
            raise HTTPException(
                status_code=403,
                detail="LOCKED blocks cannot be deleted. Unlock first if needed.",
            )

        # Soft-delete by setting state to SUPERSEDED
        old_state = existing["state"]
        delete_query = """
            UPDATE blocks
            SET state = 'SUPERSEDED',
                updated_at = NOW(),
                metadata = metadata || :delete_metadata
            WHERE id = :block_id AND basket_id = :basket_id
            RETURNING id
        """

        result = await db.fetch_one(
            delete_query,
            values={
                "block_id": str(block_uuid),
                "basket_id": str(basket_uuid),
                "delete_metadata": json.dumps({
                    "deleted_via": "direct_block_crud",
                    "deleted_at": datetime.utcnow().isoformat(),
                    "previous_state": old_state,
                }),
            },
        )

        if not result:
            raise HTTPException(status_code=500, detail="Failed to delete block")

        logger.info(
            f"[BLOCK DELETE] Soft-deleted block {block_id} in basket {basket_id} "
            f"(state: {old_state} → SUPERSEDED)"
        )

        # Emit timeline event
        try:
            timeline_query = """
                SELECT emit_timeline_event(
                    :basket_id, 'block.state_changed', :block_id,
                    :event_data, :workspace_id, NULL, 'user_authored'
                )
            """
            await db.execute(
                timeline_query,
                values={
                    "basket_id": str(basket_uuid),
                    "block_id": block_id,
                    "event_data": json.dumps({
                        "block_id": block_id,
                        "old_state": old_state,
                        "new_state": "SUPERSEDED",
                        "reason": "user_deleted",
                    }),
                    "workspace_id": str(existing["workspace_id"]),
                },
            )
        except Exception as timeline_err:
            logger.warning(f"[BLOCK DELETE] Timeline event failed (non-fatal): {timeline_err}")

        return {
            "status": "deleted",
            "block_id": block_id,
            "basket_id": basket_id,
            "previous_state": old_state,
            "new_state": "SUPERSEDED",
        }

    except HTTPException:
        raise

    except Exception as e:
        logger.exception(f"Failed to delete block {block_id}: {e}")
        raise HTTPException(
            status_code=500, detail=f"Failed to delete block: {str(e)}"
        ) from e


@router.get("/{basket_id}/deltas")
async def get_basket_deltas(basket_id: str, db=Depends(get_db)):  # noqa: B008
    """Get all deltas for a basket"""
    return await list_deltas(db, basket_id)


@router.post("/{basket_id}/apply/{delta_id}")
async def apply_basket_delta(
    basket_id: str,
    delta_id: str,
    db=Depends(get_db),  # noqa: B008
):
    """Apply a specific delta"""
    success = await try_apply_delta(db, basket_id, delta_id)
    if not success:
        raise HTTPException(409, "Version conflict or delta not found")

    return {"status": "applied", "basket_id": basket_id, "delta_id": delta_id}


