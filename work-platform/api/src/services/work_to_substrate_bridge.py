"""
Work-to-Substrate Bridge: Promotes approved work_outputs to substrate via P1 proposals.

Architecture (2025-11-27):
- Approved work_outputs → P1 proposals → substrate blocks
- Respects project-level promotion_mode (auto/manual)
- Preserves provenance (source_context_ids)
- Integrates with existing P1 governance flow

Flow:
1. Work output approved (supervision_status = 'approved')
2. Bridge checks project promotion_mode
3. If auto: immediately create P1 proposal
4. If manual: wait for explicit promote_to_substrate() call
5. P1 proposal goes through standard governance
6. On approval: block created, work_output linked
"""

from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional
from uuid import UUID
from datetime import datetime, timezone

from app.utils.supabase_client import supabase_admin_client as supabase
from clients.substrate_client import get_substrate_client

logger = logging.getLogger(__name__)


# Output types that can be promoted to substrate blocks
PROMOTABLE_OUTPUT_TYPES = ["finding", "recommendation", "insight", "report_section"]

# Default promotion settings
DEFAULT_SUPERVISION_SETTINGS = {
    "promotion_mode": "auto",
    "auto_promote_types": ["finding", "recommendation"],
    "require_review_before_promotion": False,
    "notify_on_promotion": True,
}


class WorkToSubstrateBridge:
    """
    Bridge service for promoting work_outputs to substrate.

    Handles:
    - Auto-promotion on approval (if configured)
    - Manual promotion via explicit call
    - P1 proposal creation with provenance
    - Tracking of promotion status
    """

    def __init__(self, user_id: str, user_token: Optional[str] = None):
        """
        Initialize bridge with user context.

        Args:
            user_id: User ID for audit trail
            user_token: Optional JWT for substrate-API auth
        """
        self.user_id = user_id
        self.user_token = user_token
        self.substrate_client = get_substrate_client()

    async def get_project_settings(self, basket_id: str) -> Dict[str, Any]:
        """
        Get promotion settings for a basket's project.

        Args:
            basket_id: Basket ID

        Returns:
            Work supervision settings dict
        """
        try:
            response = supabase.rpc(
                "get_basket_supervision_settings",
                {"p_basket_id": basket_id}
            ).execute()

            if response.data:
                return response.data
            return DEFAULT_SUPERVISION_SETTINGS.copy()

        except Exception as e:
            logger.warning(f"Failed to get supervision settings: {e}")
            return DEFAULT_SUPERVISION_SETTINGS.copy()

    async def on_work_output_approved(
        self,
        work_output_id: str,
        basket_id: str,
    ) -> Optional[Dict[str, Any]]:
        """
        Called when a work output is approved. Handles auto-promotion if configured.

        Args:
            work_output_id: Work output ID
            basket_id: Basket ID

        Returns:
            Promotion result if auto-promoted, None if manual mode
        """
        settings = await self.get_project_settings(basket_id)
        promotion_mode = settings.get("promotion_mode", "auto")

        logger.info(
            f"[BRIDGE] Work output approved: {work_output_id}, "
            f"promotion_mode={promotion_mode}"
        )

        if promotion_mode == "auto":
            # Get output details
            output = await self._get_work_output(work_output_id)
            if not output:
                logger.error(f"Work output not found: {work_output_id}")
                return None

            # Check if output type is auto-promotable
            auto_types = settings.get("auto_promote_types", ["finding", "recommendation"])
            if output.get("output_type") not in auto_types:
                logger.info(
                    f"[BRIDGE] Output type '{output.get('output_type')}' not in auto_promote_types, skipping"
                )
                return None

            # Auto-promote
            return await self.promote_to_substrate(
                work_output_id=work_output_id,
                promotion_method="auto",
            )
        else:
            logger.info(f"[BRIDGE] Manual mode - awaiting explicit promotion")
            return None

    async def promote_to_substrate(
        self,
        work_output_id: str,
        promotion_method: str = "manual",
        target_basket_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Promote a work output to substrate via P1 proposal.

        Args:
            work_output_id: Work output ID to promote
            promotion_method: "auto" or "manual"
            target_basket_id: Optional override basket (default: output's basket)

        Returns:
            Promotion result with proposal_id
        """
        logger.info(f"[BRIDGE] Promoting work output: {work_output_id}, method={promotion_method}")

        # Get work output
        output = await self._get_work_output(work_output_id)
        if not output:
            raise ValueError(f"Work output not found: {work_output_id}")

        # Validate output is approved
        if output.get("supervision_status") != "approved":
            raise ValueError(
                f"Cannot promote output with status '{output.get('supervision_status')}'. "
                f"Must be 'approved'."
            )

        # Validate output type is promotable
        if output.get("output_type") not in PROMOTABLE_OUTPUT_TYPES:
            raise ValueError(
                f"Output type '{output.get('output_type')}' is not promotable. "
                f"Promotable types: {PROMOTABLE_OUTPUT_TYPES}"
            )

        # Check not already promoted
        if output.get("substrate_proposal_id"):
            raise ValueError(
                f"Work output already promoted to proposal: {output.get('substrate_proposal_id')}"
            )

        basket_id = target_basket_id or output.get("basket_id")

        # Build P1 proposal
        proposal_data = self._build_proposal_from_output(output, basket_id)

        # Create proposal via substrate-API
        try:
            proposal_result = await self._create_substrate_proposal(
                basket_id=basket_id,
                proposal_data=proposal_data,
            )

            proposal_id = proposal_result.get("id") or proposal_result.get("proposal_id")

            # Mark output as promoted via substrate-API
            await self._mark_output_promoted(
                work_output_id=work_output_id,
                basket_id=basket_id,
                proposal_id=proposal_id,
                method=promotion_method,
            )

            logger.info(
                f"[BRIDGE] Successfully created proposal {proposal_id} "
                f"from work output {work_output_id}"
            )

            return {
                "success": True,
                "work_output_id": work_output_id,
                "proposal_id": proposal_id,
                "promotion_method": promotion_method,
                "basket_id": basket_id,
                "message": f"Work output promoted to substrate proposal",
            }

        except Exception as e:
            logger.error(f"[BRIDGE] Failed to create proposal: {e}")
            raise

    def _build_proposal_from_output(
        self,
        output: Dict[str, Any],
        basket_id: str,
    ) -> Dict[str, Any]:
        """
        Build P1 proposal data from work output.

        Args:
            output: Work output dict
            basket_id: Target basket ID

        Returns:
            Proposal data dict for substrate-API
        """
        output_type = output.get("output_type", "finding")
        title = output.get("title", "Agent Output")
        body = output.get("body", {})
        confidence = output.get("confidence", 0.7)
        source_ids = output.get("source_context_ids", [])

        # Build block content from output
        # Handle body as either dict or string
        if isinstance(body, dict):
            block_content = body.get("summary", "") or body.get("content", "")
            if body.get("details"):
                block_content += f"\n\n{body.get('details')}"
        else:
            block_content = str(body)

        # Map output_type to semantic_type
        semantic_type_map = {
            "finding": "fact",
            "recommendation": "action",
            "insight": "insight",
            "report_section": "knowledge",
        }
        semantic_type = semantic_type_map.get(output_type, "knowledge")

        # Build proposal ops
        create_block_op = {
            "type": "CreateBlock",
            "data": {
                "title": title,
                "body": block_content,
                "semantic_type": semantic_type,
                "confidence": confidence,
                "state": "PROPOSED",  # Will be ACCEPTED on proposal approval
                "metadata": {
                    "from_work_output": True,
                    "work_output_id": str(output.get("id")),
                    "output_type": output_type,
                    "agent_type": output.get("agent_type"),
                    "source_context_ids": [str(s) for s in source_ids] if source_ids else [],
                },
            },
        }

        # Build proposal
        proposal = {
            "proposal_kind": "Extraction",  # Work output extraction
            "ops": [create_block_op],
            "origin": "agent",
            "provenance": {
                "work_output_id": str(output.get("id")),
                "work_ticket_id": str(output.get("work_ticket_id")) if output.get("work_ticket_id") else None,
                "agent_type": output.get("agent_type"),
                "source_context_ids": [str(s) for s in source_ids] if source_ids else [],
            },
            "metadata": {
                "promoted_from_work_output": True,
                "output_type": output_type,
                "output_title": title,
                "output_confidence": confidence,
            },
        }

        return proposal

    async def _create_substrate_proposal(
        self,
        basket_id: str,
        proposal_data: Dict[str, Any],
    ) -> Dict[str, Any]:
        """
        Create P1 proposal via substrate-API.

        Args:
            basket_id: Basket ID
            proposal_data: Proposal data dict

        Returns:
            Created proposal response
        """
        # Use substrate client to create proposal
        # The substrate client should have a create_proposal method
        # If not, we'll make an HTTP call directly

        try:
            # Try using client method if available
            if hasattr(self.substrate_client, 'create_proposal'):
                return self.substrate_client.create_proposal(
                    basket_id=basket_id,
                    proposal_data=proposal_data,
                )
            else:
                # Direct HTTP call to substrate-API
                import httpx

                substrate_url = self.substrate_client.base_url
                url = f"{substrate_url}/api/baskets/{basket_id}/proposals"

                headers = {"Content-Type": "application/json"}
                if self.user_token:
                    headers["Authorization"] = f"Bearer {self.user_token}"

                async with httpx.AsyncClient(timeout=30.0) as client:
                    response = await client.post(url, json=proposal_data, headers=headers)
                    response.raise_for_status()
                    return response.json()

        except Exception as e:
            logger.error(f"Failed to create substrate proposal: {e}")
            raise

    async def _get_work_output(self, work_output_id: str, basket_id: Optional[str] = None) -> Optional[Dict[str, Any]]:
        """Get work output by ID via substrate-API."""
        try:
            # Need basket_id for substrate-API call
            # If not provided, we need to look it up first (this is a fallback)
            if not basket_id:
                # Try direct DB read as fallback for getting basket_id
                response = supabase.table("work_outputs").select(
                    "basket_id"
                ).eq("id", work_output_id).single().execute()
                if not response.data:
                    return None
                basket_id = response.data.get("basket_id")

            return self.substrate_client.get_work_output(
                basket_id=basket_id,
                output_id=work_output_id,
            )
        except Exception as e:
            logger.error(f"Failed to get work output: {e}")
            return None

    async def _mark_output_promoted(
        self,
        work_output_id: str,
        basket_id: str,
        proposal_id: str,
        method: str,
    ) -> None:
        """Mark work output as promoted via substrate-API."""
        try:
            self.substrate_client.mark_work_output_promoted(
                basket_id=basket_id,
                output_id=work_output_id,
                proposal_id=proposal_id,
                promotion_method=method,
                promoted_by=self.user_id,
            )
        except Exception as e:
            logger.error(f"Failed to mark output as promoted: {e}")
            raise

    async def get_pending_promotions(self, basket_id: str) -> List[Dict[str, Any]]:
        """
        Get approved outputs pending promotion.

        Args:
            basket_id: Basket ID

        Returns:
            List of work outputs pending promotion
        """
        try:
            # Use substrate-API to list approved outputs without promotion
            result = self.substrate_client.list_work_outputs(
                basket_id=basket_id,
                supervision_status="approved",
                limit=100,
            )

            outputs = result.get("outputs", [])

            # Filter to only those not yet promoted
            pending = [
                o for o in outputs
                if not o.get("substrate_proposal_id") and not o.get("promotion_method")
            ]

            return pending

        except Exception as e:
            logger.error(f"Failed to get pending promotions: {e}")
            return []

    async def skip_promotion(
        self,
        work_output_id: str,
        basket_id: str,
        reason: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Skip promotion for a work output (keep approved but don't promote).

        Args:
            work_output_id: Work output ID
            basket_id: Basket ID
            reason: Optional reason for skipping

        Returns:
            Result dict
        """
        try:
            self.substrate_client.skip_work_output_promotion(
                basket_id=basket_id,
                output_id=work_output_id,
                skipped_by=self.user_id,
                reason=reason,
            )

            logger.info(f"[BRIDGE] Skipped promotion for: {work_output_id}")

            return {
                "success": True,
                "work_output_id": work_output_id,
                "promotion_method": "skipped",
                "reason": reason,
            }

        except Exception as e:
            logger.error(f"Failed to skip promotion: {e}")
            raise


# Factory function
def create_bridge(user_id: str, user_token: Optional[str] = None) -> WorkToSubstrateBridge:
    """Create a WorkToSubstrateBridge instance."""
    return WorkToSubstrateBridge(user_id=user_id, user_token=user_token)
