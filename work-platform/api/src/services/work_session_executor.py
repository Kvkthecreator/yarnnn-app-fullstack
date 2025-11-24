"""
Work Session Executor: Orchestrates agent execution lifecycle.

This service manages the full execution flow:
1. Validate work session is ready for execution
2. Create and initialize agent
3. Provision context envelope
4. Execute agent task
5. Handle outputs (outputs, checkpoints)
6. Update work session status
7. Handle errors and retries

Phase 2: Agent Execution & Checkpoints
"""

from __future__ import annotations

import logging
from datetime import datetime
from typing import Any, Dict, List, Optional
from uuid import UUID

from supabase import create_client
import os

from services.agent_sdk_client import AgentSDKClient
from services.checkpoint_handler import CheckpointHandler
from clients.substrate_client import SubstrateClient
from shared.session import AgentSession

logger = logging.getLogger(__name__)


class WorkTicketExecutionError(Exception):
    """Raised when work session execution fails."""
    pass


class WorkTicketExecutor:
    """
    Orchestrates work session execution via Agent SDK.

    Responsibilities:
    - Status transitions (initialized → in_progress → completed/failed)
    - Agent instantiation and execution
    - Artifact creation and storage
    - Checkpoint handling
    - Error handling and logging
    """

    def __init__(
        self,
        supabase_url: Optional[str] = None,
        supabase_key: Optional[str] = None
    ):
        """
        Initialize work session executor.

        Args:
            supabase_url: Supabase project URL (defaults to env var)
            supabase_key: Supabase service role key (defaults to env var)
        """
        self.supabase_url = supabase_url or os.getenv("SUPABASE_URL")
        self.supabase_key = supabase_key or os.getenv("SUPABASE_SERVICE_ROLE_KEY")

        if not self.supabase_url or not self.supabase_key:
            raise ValueError(
                "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY environment variables required"
            )

        self.supabase = create_client(self.supabase_url, self.supabase_key)
        self.agent_client = AgentSDKClient()
        self.checkpoint_handler = CheckpointHandler(
            supabase_url=self.supabase_url,
            supabase_key=self.supabase_key
        )

        logger.info("[WORK SESSION EXECUTOR] Initialized")

    async def execute_work_ticket(self, ticket_id: str | UUID) -> Dict[str, Any]:
        """
        Execute a work session end-to-end.

        Args:
            ticket_id: UUID of work session to execute

        Returns:
            Execution result dictionary with:
            - ticket_id: UUID
            - status: "completed" | "checkpoint_required" | "failed"
            - outputs_count: Number of outputs created
            - checkpoint_id: UUID of checkpoint (if status=checkpoint_required)
            - error: Error message (if status=failed)

        Raises:
            WorkTicketExecutionError: If execution fails critically
        """
        ticket_id = str(ticket_id)
        logger.info(f"[WORK SESSION EXECUTOR] Starting execution for session {ticket_id}")

        try:
            # ================================================================
            # Step 1: Fetch and validate work ticket
            # ================================================================
            session = await self._fetch_work_ticket(ticket_id)

            # Phase 2e: DB uses "pending", not "initialized"
            if session["status"] not in ["pending", "initialized", "paused"]:
                raise WorkTicketExecutionError(
                    f"Work ticket {ticket_id} is not in executable state. "
                    f"Current status: {session['status']}"
                )

            # ================================================================
            # Step 2: Transition to running (Phase 2e: DB uses "running", not "in_progress")
            # ================================================================
            await self._update_session_status(ticket_id, "running")

            # ================================================================
            # Step 3: Fetch pre-existing agent_session (from scaffolding)
            # ================================================================
            # Work tickets are linked to agent_sessions (persistent, one per basket+agent_type)
            # This enables conversation continuity across multiple work requests
            agent_session_id = session["agent_session_id"]
            logger.info(f"[WORK SESSION EXECUTOR] Fetching agent_session {agent_session_id}")

            agent_session_response = self.supabase.table("agent_sessions").select(
                "*"
            ).eq("id", agent_session_id).single().execute()

            if not agent_session_response.data:
                raise WorkTicketExecutionError(
                    f"Agent session {agent_session_id} not found "
                    f"(work_ticket {ticket_id} references non-existent session)"
                )

            # Load AgentSession object from DB data
            agent_session = AgentSession(**agent_session_response.data)
            logger.info(
                f"[WORK SESSION EXECUTOR] Using agent_session {agent_session.id} "
                f"(type={agent_session.agent_type}, basket={agent_session.basket_id})"
            )

            # ================================================================
            # Step 4: Create agent instance with pre-existing session
            # ================================================================
            agent = await self.agent_client.create_agent(
                agent_type=session["task_type"],
                basket_id=session["basket_id"],
                workspace_id=session["workspace_id"],
                work_ticket_id=ticket_id,
                user_id=session["initiated_by_user_id"],
                agent_session=agent_session  # Pass persistent session for conversation continuity
            )

            # ================================================================
            # Step 5: Provision context envelope (if available)
            # ================================================================
            context_envelope = {}
            if session.get("task_document_id"):
                context_envelope = await self.agent_client.provision_context_envelope(
                    agent=agent,
                    task_document_id=UUID(session["task_document_id"]),
                    basket_id=UUID(session["basket_id"])
                )

            # ================================================================
            # Step 6: Execute agent task
            # ================================================================
            status, outputs, checkpoint_reason = await self.agent_client.execute_task(
                agent=agent,
                task_description=session["task_intent"],
                task_configuration=session.get("task_configuration", {}),
                context_envelope=context_envelope
            )

            # ================================================================
            # Step 6: Handle execution result
            # ================================================================
            if status == "failed":
                await self._handle_execution_failure(ticket_id, checkpoint_reason)
                return {
                    "ticket_id": ticket_id,
                    "status": "failed",
                    "error": checkpoint_reason,
                    "outputs_count": 0
                }

            # Save outputs to database
            output_ids = await self._save_outputs(ticket_id, outputs)

            # ================================================================
            # Step 7: Handle checkpoints or completion
            # ================================================================
            if status == "checkpoint_required":
                checkpoint_id = await self.checkpoint_handler.create_checkpoint(
                    work_ticket_id=ticket_id,
                    reason=checkpoint_reason,
                    output_ids=output_ids
                )

                await self._update_session_status(
                    ticket_id,
                    "pending_review",
                    metadata={"checkpoint_id": checkpoint_id}
                )

                logger.info(
                    f"[WORK SESSION EXECUTOR] ✅ Execution paused at checkpoint: "
                    f"session={ticket_id}, checkpoint={checkpoint_id}"
                )

                return {
                    "ticket_id": ticket_id,
                    "status": "checkpoint_required",
                    "outputs_count": len(output_ids),
                    "checkpoint_id": checkpoint_id
                }

            else:  # status == "completed"
                await self._update_session_status(
                    ticket_id,
                    "completed",
                    metadata={
                        "outputs_count": len(output_ids),
                        "completed_at": datetime.utcnow().isoformat()
                    }
                )

                logger.info(
                    f"[WORK SESSION EXECUTOR] ✅ Execution completed: "
                    f"session={ticket_id}, outputs={len(output_ids)}"
                )

                return {
                    "ticket_id": ticket_id,
                    "status": "completed",
                    "outputs_count": len(output_ids)
                }

        except Exception as e:
            logger.error(
                f"[WORK SESSION EXECUTOR] ❌ Execution failed for session {ticket_id}: {e}",
                exc_info=True
            )
            await self._handle_execution_failure(ticket_id, str(e))
            raise WorkTicketExecutionError(f"Execution failed: {str(e)}") from e

    async def _fetch_work_ticket(self, ticket_id: str) -> Dict[str, Any]:
        """Fetch work ticket from database (Phase 2e schema)."""
        response = self.supabase.table("work_tickets").select(
            "id, work_request_id, agent_session_id, basket_id, workspace_id, "
            "agent_type, status, metadata"
        ).eq("id", ticket_id).single().execute()

        if not response.data:
            raise WorkTicketExecutionError(f"Work ticket {ticket_id} not found")

        ticket = response.data

        # Extract legacy fields from metadata JSONB
        metadata = ticket.get("metadata", {})

        # Map Phase 2e fields to executor's expected format
        return {
            "id": ticket["id"],
            "work_request_id": ticket["work_request_id"],
            "agent_session_id": ticket["agent_session_id"],
            "basket_id": ticket["basket_id"],
            "workspace_id": ticket["workspace_id"],
            "status": ticket["status"],
            # Legacy fields from metadata
            "task_type": ticket["agent_type"],  # Phase 2e: agent_type replaces task_type
            "task_intent": metadata.get("task_intent", ""),
            "task_configuration": metadata.get("task_configuration", {}),
            "task_document_id": metadata.get("task_document_id"),
            "approval_strategy": metadata.get("approval_strategy", "final_only"),
            "initiated_by_user_id": metadata.get("initiated_by_user_id"),
            "metadata": metadata
        }

    async def _update_session_status(
        self,
        ticket_id: str,
        status: str,
        metadata: Optional[Dict[str, Any]] = None
    ):
        """Update work session status and metadata."""
        update_data = {"status": status}

        if metadata:
            # Merge with existing metadata
            current = self.supabase.table("work_tickets").select("metadata").eq(
                "id", ticket_id
            ).single().execute()

            existing_metadata = current.data.get("metadata", {}) if current.data else {}
            existing_metadata.update(metadata)
            update_data["metadata"] = existing_metadata

        self.supabase.table("work_tickets").update(update_data).eq(
            "id", ticket_id
        ).execute()

        logger.info(f"[WORK SESSION EXECUTOR] Updated session {ticket_id}: status={status}")

    async def _save_outputs(
        self,
        ticket_id: str,
        outputs: List[Dict[str, Any]]
    ) -> List[str]:
        """
        Save outputs to work_outputs table.

        Args:
            ticket_id: Work session ID
            outputs: List of output dicts from agent execution

        Returns:
            List of created output UUIDs
        """
        if not outputs:
            return []

        output_records = [
            {
                "work_ticket_id": ticket_id,
                "output_type": output["output_type"],
                "content": output["content"],
                "agent_confidence": output.get("metadata", {}).get("confidence"),
                "agent_reasoning": output.get("metadata", {}).get("reasoning"),
                "status": "pending"
            }
            for output in outputs
        ]

        response = self.supabase.table("work_outputs").insert(
            output_records
        ).execute()

        output_ids = [record["id"] for record in response.data]

        logger.info(
            f"[WORK SESSION EXECUTOR] Saved {len(output_ids)} outputs for session {ticket_id}"
        )

        return output_ids

    async def _handle_execution_failure(self, ticket_id: str, error_message: str):
        """Handle execution failure by updating status and logging."""
        await self._update_session_status(
            ticket_id,
            "failed",
            metadata={
                "error": error_message,
                "failed_at": datetime.utcnow().isoformat()
            }
        )

        logger.error(f"[WORK SESSION EXECUTOR] Session {ticket_id} failed: {error_message}")

    async def resume_from_checkpoint(
        self,
        ticket_id: str | UUID,
        checkpoint_id: str | UUID,
        user_feedback: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Resume execution from a checkpoint after user approval.

        Args:
            ticket_id: Work session UUID
            checkpoint_id: Checkpoint UUID
            user_feedback: Optional user feedback/instructions

        Returns:
            Execution result (same format as execute_work_ticket)

        Note:
            This will be implemented after basic execution works.
            For Phase 2, we'll focus on checkpoint creation first.
        """
        # TODO: Implement checkpoint resumption
        # 1. Validate checkpoint is approved
        # 2. Load checkpoint context
        # 3. Resume agent execution with user feedback
        # 4. Continue normal execution flow
        raise NotImplementedError("Checkpoint resumption coming in Phase 2.2")
