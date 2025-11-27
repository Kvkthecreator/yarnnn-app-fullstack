"""
HTTP client for Substrate API service-to-service communication.

Phase 3.1: BFF Foundation - HTTP client with:
- Service token authentication
- Retry logic with exponential backoff
- Circuit breaker for fault tolerance
- Request/response logging
- Connection pooling
"""

from __future__ import annotations

import logging
import os
import time
from datetime import datetime, timedelta
from enum import Enum
from typing import Any, Optional
from uuid import UUID

import httpx
from tenacity import (
    retry,
    stop_after_attempt,
    wait_exponential,
    retry_if_exception_type,
)

logger = logging.getLogger("uvicorn.error")


class SubstrateAPIError(Exception):
    """Base exception for Substrate API errors."""

    def __init__(
        self,
        message: str,
        status_code: Optional[int] = None,
        details: Optional[dict] = None,
        retry_after: Optional[int] = None,
    ):
        self.message = message
        self.status_code = status_code
        self.details = details or {}
        self.retry_after = retry_after
        super().__init__(message)

    def is_retryable(self) -> bool:
        """Check if this error should trigger a retry."""
        # Retry on 5xx errors and specific 4xx errors
        if self.status_code:
            return self.status_code >= 500 or self.status_code in [408, 429]
        return False


class CircuitState(Enum):
    """Circuit breaker states."""

    CLOSED = "closed"  # Normal operation
    OPEN = "open"  # Failing, reject requests
    HALF_OPEN = "half_open"  # Testing if service recovered


class CircuitBreaker:
    """
    Circuit breaker pattern to prevent cascading failures.

    - CLOSED: Normal operation
    - OPEN: Too many failures, reject all requests for cooldown period
    - HALF_OPEN: Testing if service recovered, allow limited requests
    """

    def __init__(
        self,
        failure_threshold: int = 5,
        cooldown_seconds: int = 60,
        half_open_max_requests: int = 3,
    ):
        self.failure_threshold = failure_threshold
        self.cooldown_seconds = cooldown_seconds
        self.half_open_max_requests = half_open_max_requests

        self.state = CircuitState.CLOSED
        self.failure_count = 0
        self.last_failure_time: Optional[datetime] = None
        self.half_open_requests = 0

    def record_success(self):
        """Record successful request."""
        if self.state == CircuitState.HALF_OPEN:
            # Success in half-open state -> close circuit
            logger.info("Circuit breaker: Service recovered, closing circuit")
            self.state = CircuitState.CLOSED
            self.failure_count = 0
            self.half_open_requests = 0
        elif self.state == CircuitState.CLOSED:
            # Reset failure count on success
            self.failure_count = 0

    def record_failure(self):
        """Record failed request."""
        self.failure_count += 1
        self.last_failure_time = datetime.utcnow()

        if self.state == CircuitState.HALF_OPEN:
            # Failure in half-open state -> reopen circuit
            logger.warning("Circuit breaker: Service still failing, reopening circuit")
            self.state = CircuitState.OPEN
            self.half_open_requests = 0
        elif self.state == CircuitState.CLOSED:
            if self.failure_count >= self.failure_threshold:
                logger.error(
                    f"Circuit breaker: Opening circuit after {self.failure_count} failures"
                )
                self.state = CircuitState.OPEN

    def can_request(self) -> bool:
        """Check if requests are allowed."""
        if self.state == CircuitState.CLOSED:
            return True

        if self.state == CircuitState.OPEN:
            # Check if cooldown period passed
            if (
                self.last_failure_time
                and (datetime.utcnow() - self.last_failure_time).total_seconds()
                >= self.cooldown_seconds
            ):
                logger.info("Circuit breaker: Cooldown passed, entering half-open state")
                self.state = CircuitState.HALF_OPEN
                self.half_open_requests = 0
                return True
            return False

        if self.state == CircuitState.HALF_OPEN:
            # Allow limited requests in half-open state
            if self.half_open_requests < self.half_open_max_requests:
                self.half_open_requests += 1
                return True
            return False

        return False


class SubstrateClient:
    """
    HTTP client for Substrate API with resilience patterns.

    Features:
    - Service token authentication
    - Automatic retries with exponential backoff
    - Circuit breaker for fault tolerance
    - Connection pooling via httpx.Client
    - Request/response logging
    """

    def __init__(
        self,
        base_url: Optional[str] = None,
        service_secret: Optional[str] = None,  # DEPRECATED: Use user_token instead
        user_token: Optional[str] = None,  # NEW: User JWT token for authentication
        timeout: float = 30.0,
    ):
        self.base_url = base_url or os.getenv(
            "SUBSTRATE_API_URL", "http://localhost:10000"
        )
        # Prefer user_token over service_secret (backward compatibility)
        self.auth_token = user_token or service_secret or os.getenv("SUBSTRATE_SERVICE_SECRET")
        self.timeout = timeout

        if not self.auth_token:
            logger.warning(
                "No auth token provided - substrate-API authentication will fail"
            )

        # HTTP client with connection pooling
        self.client = httpx.Client(
            base_url=self.base_url,
            timeout=self.timeout,
            limits=httpx.Limits(max_keepalive_connections=20, max_connections=100),
        )

        # Circuit breaker for fault tolerance
        self.circuit_breaker = CircuitBreaker()

        logger.info(f"SubstrateClient initialized with base_url={self.base_url}")

    def _get_headers(self) -> dict[str, str]:
        """Get request headers with authentication (user JWT or service token)."""
        return {
            "Authorization": f"Bearer {self.auth_token}",
            "X-Service-Name": "platform-api",
            "Content-Type": "application/json",
        }

    def _handle_response(self, response: httpx.Response) -> dict:
        """Handle HTTP response and raise appropriate errors."""
        # Log request/response for debugging
        logger.debug(
            f"Substrate API {response.request.method} {response.request.url}: {response.status_code}"
        )

        if response.status_code >= 400:
            error_detail = response.json() if response.text else {}
            error_message = error_detail.get(
                "detail", f"HTTP {response.status_code} error"
            )

            raise SubstrateAPIError(
                message=error_message,
                status_code=response.status_code,
                details=error_detail,
            )

        return response.json() if response.text else {}

    @retry(
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=1, min=1, max=10),
        retry=retry_if_exception_type(SubstrateAPIError),
        reraise=True,
    )
    def _request(
        self,
        method: str,
        endpoint: str,
        json: Optional[dict] = None,
        params: Optional[dict] = None,
    ) -> dict:
        """
        Make HTTP request with retry logic and circuit breaker.

        Args:
            method: HTTP method (GET, POST, PUT, DELETE)
            endpoint: API endpoint path (e.g., "/api/health")
            json: Request body (for POST/PUT)
            params: Query parameters

        Returns:
            Response JSON

        Raises:
            SubstrateAPIError: On HTTP errors or circuit open
        """
        # Check circuit breaker
        if not self.circuit_breaker.can_request():
            raise SubstrateAPIError(
                message="Substrate API circuit breaker is OPEN - service unavailable",
                status_code=503,
            )

        start_time = time.time()

        try:
            response = self.client.request(
                method=method,
                url=endpoint,
                json=json,
                params=params,
                headers=self._get_headers(),
            )

            result = self._handle_response(response)
            self.circuit_breaker.record_success()

            latency_ms = (time.time() - start_time) * 1000
            logger.debug(f"Substrate API call succeeded in {latency_ms:.2f}ms")

            return result

        except SubstrateAPIError as e:
            self.circuit_breaker.record_failure()
            logger.error(
                f"Substrate API error: {e.message}",
                extra={
                    "status_code": e.status_code,
                    "endpoint": endpoint,
                    "details": e.details,
                },
            )
            # Only retry if error is retryable
            if not e.is_retryable():
                raise
            raise

        except Exception as e:
            self.circuit_breaker.record_failure()
            logger.exception(f"Substrate API request failed: {e}")
            raise SubstrateAPIError(
                message=f"Request failed: {str(e)}",
                details={"exception": str(e)},
            )

    # ========================================================================
    # Health & Status
    # ========================================================================

    def health_check(self) -> dict:
        """
        Check Substrate API health.

        Returns:
            {"status": "ok"} or raises SubstrateAPIError
        """
        return self._request("GET", "/health")

    def work_queue_health(self) -> dict:
        """
        Get work queue health metrics.

        Returns:
            Queue health statistics
        """
        return self._request("GET", "/api/work/health")

    # ========================================================================
    # Block Operations (Read-Only)
    # ========================================================================

    def get_basket_blocks(
        self,
        basket_id: UUID | str,
        states: Optional[list[str]] = None,
        limit: Optional[int] = None,
    ) -> list[dict]:
        """
        Get all blocks for a basket.

        Args:
            basket_id: Basket UUID
            states: Filter by block states (e.g., ["ACCEPTED", "LOCKED"])
            limit: Maximum number of blocks to return

        Returns:
            List of block dictionaries
        """
        params = {}
        if states:
            params["states"] = ",".join(states)
        if limit:
            params["limit"] = limit

        response = self._request("GET", f"/api/baskets/{basket_id}/blocks", params=params)
        # Handle both list response and {"blocks": [...]} response formats
        if isinstance(response, list):
            return response
        return response.get("blocks", [])

    # ========================================================================
    # Work Orchestration (Canon v2.1)
    # ========================================================================

    def initiate_work(
        self,
        basket_id: UUID | str,
        work_mode: str,
        payload: dict,
        user_id: Optional[UUID | str] = None,
    ) -> dict:
        """
        Initiate new substrate work via Universal Work Orchestration.

        Args:
            basket_id: Basket UUID
            work_mode: Work mode (e.g., "compose_canon", "infer_relationships")
            payload: Work-specific payload
            user_id: Optional user ID for attribution

        Returns:
            {"work_id": "...", "status": "pending", ...}
        """
        request_body = {
            "basket_id": str(basket_id),
            "work_mode": work_mode,
            "payload": payload,
        }
        if user_id:
            request_body["user_id"] = str(user_id)

        return self._request("POST", "/api/work/initiate", json=request_body)

    def get_work_status(self, work_id: UUID | str) -> dict:
        """
        Get status of a work item.

        Args:
            work_id: Work UUID

        Returns:
            Work status details
        """
        return self._request("GET", f"/api/work/{work_id}/status")

    def retry_work(self, work_id: UUID | str) -> dict:
        """
        Retry failed work.

        Args:
            work_id: Work UUID

        Returns:
            Updated work status
        """
        return self._request("POST", f"/api/work/{work_id}/retry")

    # ========================================================================
    # Document Operations
    # ========================================================================

    def compose_document(
        self,
        basket_id: UUID | str,
        context_blocks: list[UUID | str],
        composition_intent: Optional[str] = None,
    ) -> dict:
        """
        Compose document from context blocks.

        Args:
            basket_id: Basket UUID
            context_blocks: List of block IDs to include
            composition_intent: Optional composition intent

        Returns:
            Document creation result
        """
        request_body = {
            "basket_id": str(basket_id),
            "context_block_ids": [str(block_id) for block_id in context_blocks],
        }
        if composition_intent:
            request_body["composition_intent"] = composition_intent

        return self._request(
            "POST", "/api/documents/compose-contextual", json=request_body
        )

    # ========================================================================
    # Basket Operations (Phase 6: Onboarding Scaffolding)
    # ========================================================================

    def create_basket(
        self,
        workspace_id: UUID | str,
        name: str,
        metadata: Optional[dict] = None,
        user_id: Optional[UUID | str] = None,
    ) -> dict:
        """
        Create new basket in substrate-api.

        Phase 6: Used by onboarding scaffolder to create context containers.

        Args:
            workspace_id: Workspace UUID
            name: Basket name
            metadata: Optional metadata (tags, origin_template, etc.)
            user_id: Optional user ID for ownership

        Returns:
            {"basket_id": "...", "name": "...", "workspace_id": "...", ...}
        """
        request_body = {
            "workspace_id": str(workspace_id),
            "name": name,
            "metadata": metadata or {},
        }
        if user_id:
            request_body["user_id"] = str(user_id)

        return self._request("POST", "/api/baskets", json=request_body)

    def get_basket_info(self, basket_id: UUID | str) -> dict:
        """
        Get basket information.

        Args:
            basket_id: Basket UUID

        Returns:
            Basket details
        """
        return self._request("GET", f"/api/baskets/{basket_id}")

    # ========================================================================
    # Raw Dumps / Inputs
    # ========================================================================

    def get_basket_inputs(self, basket_id: UUID | str) -> list[dict]:
        """
        Get all raw text dumps (inputs) for a basket.

        Args:
            basket_id: Basket UUID

        Returns:
            List of dump dictionaries
        """
        response = self._request("GET", f"/api/baskets/{basket_id}/inputs")
        return response.get("inputs", [])

    def create_dump(
        self,
        basket_id: UUID | str,
        content: str,
        metadata: Optional[dict] = None,
    ) -> dict:
        """
        Create new raw dump (idempotent via content hash).

        Args:
            basket_id: Basket UUID
            content: Raw text content
            metadata: Optional metadata

        Returns:
            Dump creation result
        """
        import uuid

        # Generate deterministic UUID from content for idempotency
        # Using uuid5 with NAMESPACE_DNS ensures same content -> same UUID
        dump_request_id = str(uuid.uuid5(uuid.NAMESPACE_DNS, content))

        request_body = {
            "basket_id": str(basket_id),
            "dump_request_id": dump_request_id,
            "text_dump": content,  # Changed from "content" to "text_dump"
            "meta": metadata or {},  # Changed from "metadata" to "meta"
        }
        return self._request("POST", "/api/dumps/new", json=request_body)

    # ========================================================================
    # Insights & Reflections (P3)
    # ========================================================================

    def generate_insight_canon(
        self,
        basket_id: UUID | str,
        force_regenerate: bool = False,
    ) -> dict:
        """
        Generate P3 insight canon for basket.

        Args:
            basket_id: Basket UUID
            force_regenerate: Force regeneration even if cached

        Returns:
            Insight output
        """
        request_body = {
            "basket_id": str(basket_id),
            "force_regenerate": force_regenerate,
        }
        return self._request("POST", "/p3/insight-canon", json=request_body)

    # ========================================================================
    # Phase 4: Additional Methods for Agent SDK Integration
    # ========================================================================

    def get_basket_documents(self, basket_id: UUID | str) -> list[dict]:
        """
        Get all documents for a basket.

        Args:
            basket_id: Basket UUID

        Returns:
            List of document dictionaries
        """
        response = self._request(
            "GET",
            f"/api/documents",
            params={"basket_id": str(basket_id)}
        )
        return response.get("documents", [])

    def get_basket_relationships(self, basket_id: UUID | str) -> list[dict]:
        """
        Get substrate relationships for a basket.

        Args:
            basket_id: Basket UUID

        Returns:
            List of relationship dictionaries
        """
        response = self._request(
            "GET",
            f"/api/baskets/{basket_id}/relationships"
        )
        return response.get("relationships", [])

    def search_semantic(
        self,
        basket_id: UUID | str,
        query: str,
        limit: int = 20
    ) -> list[dict]:
        """
        Semantic search across basket blocks.

        Note: This endpoint may not exist yet in substrate-api.
        For now, falls back to get_basket_blocks() with client-side filtering.

        Args:
            basket_id: Basket UUID
            query: Semantic query string
            limit: Maximum results to return

        Returns:
            List of matching block dictionaries
        """
        try:
            response = self._request(
                "POST",
                f"/api/baskets/{basket_id}/search",
                json={"query": query, "limit": limit}
            )
            return response.get("results", [])
        except SubstrateAPIError as e:
            # If endpoint doesn't exist (404), fall back to get_basket_blocks
            if e.status_code == 404:
                logger.warning(
                    "Semantic search endpoint not found, falling back to get_basket_blocks"
                )
                return self.get_basket_blocks(basket_id, limit=limit)
            raise

    # ========================================================================
    # Phase 1+2: Reference Assets & Agent Config (Agent Execution Context)
    # ========================================================================

    def get_reference_assets(
        self,
        basket_id: UUID | str,
        agent_type: Optional[str] = None,
        work_ticket_id: Optional[str] = None,
        asset_types: Optional[list[str]] = None,
        permanence: Optional[str] = None,
    ) -> list[dict]:
        """
        Get reference assets for agent execution context.

        Args:
            basket_id: Basket UUID
            agent_type: Filter by agent_scope (e.g., 'content', 'research')
            work_ticket_id: Filter by work_ticket_id (temporary assets)
            asset_types: Filter by asset types (e.g., ['brand_voice', 'screenshot'])
            permanence: Filter by permanence ('permanent', 'temporary')

        Returns:
            List of asset dictionaries with signed URLs included
        """
        params = {}
        if agent_type:
            params["agent_scope"] = agent_type
        if work_ticket_id:
            params["work_ticket_id"] = work_ticket_id
        if asset_types:
            params["asset_type"] = ",".join(asset_types)
        if permanence:
            params["permanence"] = permanence

        response = self._request(
            "GET",
            f"/api/substrate/baskets/{basket_id}/assets",
            params=params
        )

        assets = response.get("assets", [])

        # Generate signed URLs for each asset
        assets_with_urls = []
        for asset in assets:
            try:
                url_response = self._request(
                    "POST",
                    f"/api/substrate/baskets/{basket_id}/assets/{asset['id']}/signed-url"
                )
                asset["signed_url"] = url_response.get("signed_url")
                asset["url_expires_at"] = url_response.get("expires_at")
                assets_with_urls.append(asset)
            except SubstrateAPIError as e:
                logger.warning(
                    f"Failed to get signed URL for asset {asset['id']}: {e.message}"
                )
                # Include asset without signed URL
                asset["signed_url"] = None
                assets_with_urls.append(asset)

        logger.debug(f"Retrieved {len(assets_with_urls)} reference assets for basket {basket_id}")
        return assets_with_urls

    def get_project_id_for_basket(self, basket_id: UUID | str) -> Optional[str]:
        """
        Get project_id for a basket (queries work-platform DB).

        Args:
            basket_id: Basket UUID

        Returns:
            Project ID or None if not found
        """
        # This will be handled in work-platform routes, not substrate client
        # Placeholder for now - actual implementation in agent_orchestration.py
        raise NotImplementedError(
            "get_project_id_for_basket should be called from work-platform routes, "
            "not substrate_client (wrong DB)"
        )

    # ========================================================================
    # Work Outputs (Work Supervision Lifecycle)
    # ========================================================================

    def create_work_output(
        self,
        basket_id: UUID | str,
        work_ticket_id: UUID | str,
        output_type: str,
        agent_type: str,
        title: str,
        body: dict,
        confidence: float,
        source_context_ids: Optional[list] = None,
        tool_call_id: Optional[str] = None,
        metadata: Optional[dict] = None,
    ) -> dict:
        """
        Create a work output in substrate-API for user supervision.

        Args:
            basket_id: Basket UUID
            work_ticket_id: Work session UUID (cross-DB reference)
            output_type: Type of output (finding, recommendation, insight, etc.)
            agent_type: Agent that produced this (research, content, reporting)
            title: Output title
            body: Structured output content (JSONB)
            confidence: Confidence score (0-1)
            source_context_ids: Block IDs used as context (provenance)
            tool_call_id: Claude's tool_use id for traceability
            metadata: Additional metadata

        Returns:
            Created work output record
        """
        request_body = {
            "basket_id": str(basket_id),
            "work_ticket_id": str(work_ticket_id),
            "output_type": output_type,
            "agent_type": agent_type,
            "title": title,
            "body": body,
            "confidence": confidence,
            "source_context_ids": source_context_ids or [],
            "tool_call_id": tool_call_id,
            "metadata": metadata or {},
        }

        return self._request(
            "POST",
            f"/api/baskets/{basket_id}/work-outputs",
            json=request_body
        )

    def list_work_outputs(
        self,
        basket_id: UUID | str,
        work_ticket_id: Optional[UUID | str] = None,
        supervision_status: Optional[str] = None,
        agent_type: Optional[str] = None,
        output_type: Optional[str] = None,
        limit: int = 100,
        offset: int = 0,
    ) -> dict:
        """
        List work outputs for a basket with optional filters.

        Args:
            basket_id: Basket UUID
            work_ticket_id: Filter by work session
            supervision_status: Filter by status (pending_review, approved, etc.)
            agent_type: Filter by agent type
            output_type: Filter by output type
            limit: Max results
            offset: Pagination offset

        Returns:
            {"outputs": [...], "total": int, "basket_id": str}
        """
        params = {"limit": limit, "offset": offset}
        if work_ticket_id:
            params["work_ticket_id"] = str(work_ticket_id)
        if supervision_status:
            params["supervision_status"] = supervision_status
        if agent_type:
            params["agent_type"] = agent_type
        if output_type:
            params["output_type"] = output_type

        return self._request(
            "GET",
            f"/api/baskets/{basket_id}/work-outputs",
            params=params
        )

    def get_work_output(
        self,
        basket_id: UUID | str,
        output_id: UUID | str,
    ) -> dict:
        """
        Get a specific work output.

        Args:
            basket_id: Basket UUID
            output_id: Output UUID

        Returns:
            Work output record
        """
        return self._request(
            "GET",
            f"/api/baskets/{basket_id}/work-outputs/{output_id}"
        )

    def update_work_output_status(
        self,
        basket_id: UUID | str,
        output_id: UUID | str,
        supervision_status: str,
        reviewer_notes: Optional[str] = None,
        reviewer_id: Optional[UUID | str] = None,
    ) -> dict:
        """
        Update work output supervision status.

        Args:
            basket_id: Basket UUID
            output_id: Output UUID
            supervision_status: New status (approved, rejected, revision_requested)
            reviewer_notes: Notes from reviewer
            reviewer_id: User ID of reviewer

        Returns:
            Updated work output record
        """
        request_body = {
            "supervision_status": supervision_status,
        }
        if reviewer_notes:
            request_body["reviewer_notes"] = reviewer_notes
        if reviewer_id:
            request_body["reviewer_id"] = str(reviewer_id)

        return self._request(
            "PATCH",
            f"/api/baskets/{basket_id}/work-outputs/{output_id}",
            json=request_body
        )

    def get_supervision_stats(self, basket_id: UUID | str) -> dict:
        """
        Get supervision statistics for a basket.

        Args:
            basket_id: Basket UUID

        Returns:
            {"total_outputs": int, "pending_review": int, "approved": int, ...}
        """
        return self._request(
            "GET",
            f"/api/baskets/{basket_id}/work-outputs/stats"
        )

    def mark_work_output_promoted(
        self,
        basket_id: UUID | str,
        output_id: UUID | str,
        proposal_id: str,
        promotion_method: str,
        promoted_by: UUID | str,
    ) -> dict:
        """
        Mark a work output as promoted to substrate.

        Called after a P1 proposal is created from this output.

        Args:
            basket_id: Basket UUID
            output_id: Output UUID
            proposal_id: Created proposal ID
            promotion_method: "auto" or "manual"
            promoted_by: User ID who triggered promotion

        Returns:
            Updated work output record
        """
        request_body = {
            "proposal_id": proposal_id,
            "promotion_method": promotion_method,
            "promoted_by": str(promoted_by),
        }

        return self._request(
            "PATCH",
            f"/api/baskets/{basket_id}/work-outputs/{output_id}/promote",
            json=request_body
        )

    def skip_work_output_promotion(
        self,
        basket_id: UUID | str,
        output_id: UUID | str,
        skipped_by: UUID | str,
        reason: Optional[str] = None,
    ) -> dict:
        """
        Mark a work output as intentionally not promoted.

        Args:
            basket_id: Basket UUID
            output_id: Output UUID
            skipped_by: User ID who skipped promotion
            reason: Optional reason for skipping

        Returns:
            Updated work output record
        """
        request_body = {
            "skipped_by": str(skipped_by),
        }
        if reason:
            request_body["reason"] = reason

        return self._request(
            "PATCH",
            f"/api/baskets/{basket_id}/work-outputs/{output_id}/skip-promotion",
            json=request_body
        )

    def __enter__(self):
        """Context manager entry."""
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        """Context manager exit - close HTTP client."""
        self.client.close()


# Global singleton instance
_substrate_client: Optional[SubstrateClient] = None


def get_substrate_client() -> SubstrateClient:
    """
    Get singleton SubstrateClient instance.

    Returns:
        SubstrateClient instance
    """
    global _substrate_client
    if _substrate_client is None:
        _substrate_client = SubstrateClient()
    return _substrate_client


# Convenience functions
health_check = lambda: get_substrate_client().health_check()
get_basket_blocks = lambda basket_id, **kwargs: get_substrate_client().get_basket_blocks(
    basket_id, **kwargs
)
initiate_work = lambda **kwargs: get_substrate_client().initiate_work(**kwargs)
