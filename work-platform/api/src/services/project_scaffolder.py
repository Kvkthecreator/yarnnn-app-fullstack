"""
Project Scaffolder - Phase 6.5 Refactor: Project-First Onboarding with Pre-Scaffolded Sessions

Creates user-facing PROJECTS with complete agent infrastructure pre-loaded.

ARCHITECTURE:
- Projects = User-facing containers (work-platform domain)
- Baskets = Storage infrastructure (substrate domain)
- Agent Sessions = Pre-scaffolded execution contexts (TP + 3 specialists)

HIERARCHICAL SESSIONS:
- TP session: Root (parent_session_id=NULL)
- Specialist sessions: Children (parent_session_id=TP.id)
- All 4 sessions created upfront for immediate use

BENEFITS:
- No cold-start penalty (sessions ready immediately)
- Enables both direct agent invocation AND TP orchestration
- Complete hierarchical structure from day 1
- Supports future dual-path architecture (direct vs chat-guided)

This is for NEW user onboarding. Existing agent execution flows remain unchanged.
"""

from __future__ import annotations

import logging
import uuid
from typing import Optional
from datetime import datetime

from clients.substrate_client import get_substrate_client
from app.utils.supabase_client import supabase_client, supabase_admin_client
from utils.permissions import (
    check_agent_work_request_allowed,
    record_work_request,
    PermissionDeniedError,
)
from fastapi import HTTPException, status

logger = logging.getLogger(__name__)


async def create_intent_block(
    basket_id: str,
    workspace_id: str,
    intent_content: str,
    project_name: str,
) -> Optional[str]:
    """
    Create a foundational intent block directly in the blocks table.

    This is a guaranteed block created during project scaffolding - no LLM needed.
    The intent block serves as the foundational context for all agent work.

    Args:
        basket_id: Target basket UUID
        workspace_id: Workspace UUID
        intent_content: User's project intent (one sentence)
        project_name: Project name for context

    Returns:
        Block ID if created, None if failed
    """
    try:
        block_id = str(uuid.uuid4())

        block_data = {
            "id": block_id,
            "basket_id": basket_id,
            "workspace_id": workspace_id,
            "title": f"Project Intent: {project_name}",
            "content": intent_content,
            "semantic_type": "intent",
            "anchor_role": "intent",
            "anchor_status": "accepted",
            "anchor_confidence": 1.0,  # User-provided, highest confidence
            "state": "ACCEPTED",  # Skip PROPOSED since user explicitly provided
            "confidence_score": 1.0,
            "metadata": {
                "source": "project_scaffolder",
                "created_during": "project_onboarding",
                "is_foundational": True,
            },
        }

        result = (
            supabase_admin_client.table("blocks")
            .insert(block_data)
            .execute()
        )

        if result.data:
            logger.info(
                f"[PROJECT SCAFFOLDING] Created intent block {block_id} for basket {basket_id}"
            )
            return block_id
        else:
            logger.warning(
                f"[PROJECT SCAFFOLDING] Intent block creation returned no data for basket {basket_id}"
            )
            return None

    except Exception as e:
        logger.error(f"[PROJECT SCAFFOLDING] Failed to create intent block: {e}")
        # Don't fail project creation if block creation fails
        return None


class ProjectScaffoldingError(Exception):
    """Raised when project scaffolding fails at a specific step."""

    def __init__(
        self,
        message: str,
        step: str,
        details: Optional[dict] = None,
        project_id: Optional[str] = None,
        basket_id: Optional[str] = None,
        dump_id: Optional[str] = None,
    ):
        self.message = message
        self.step = step  # "create_basket", "create_dump", "create_project", "create_work_request"
        self.details = details or {}
        self.project_id = project_id
        self.basket_id = basket_id
        self.dump_id = dump_id
        super().__init__(message)


async def scaffold_new_project(
    user_id: str,
    workspace_id: str,
    project_name: str,
    project_intent: str,
    initial_context: str = "",
    description: Optional[str] = None,
) -> dict:
    """
    Scaffold new project with basket-first infrastructure (NEW users).

    Phase 6.5 Refactor: Creates PROJECT (pure container) with BASKET (storage) and ALL AGENT SESSIONS.

    Flow:
    1. Check permissions (trial/subscription)
    2. Create basket (substrate-api) with origin_template='project_onboarding'
    3. Create intent block (foundational anchor) from project_intent
    4. Create raw_dump (substrate-api) with initial context (if provided)
    5. Create project (work-platform DB) linking to basket
    6. Pre-scaffold ALL agent sessions (TP + research + content + reporting)
    7. Record work_request (for trial tracking with research agent)

    Args:
        user_id: User ID from JWT
        workspace_id: Workspace ID for context
        project_name: User-provided project name
        project_intent: One-sentence project intent (required, creates foundational intent block)
        initial_context: Initial context/notes to seed project (optional)
        description: Optional project description

    Returns:
        {
            "project_id": "...",
            "project_name": "...",
            "basket_id": "...",
            "dump_id": "...",
            "intent_block_id": "...",
            "agent_session_ids": {
                "thinking_partner": "...",
                "research": "...",
                "content": "...",
                "reporting": "..."
            },  # All 4 agent sessions pre-scaffolded
            "work_request_id": "...",
            "status": "active",
            "is_trial_request": true/false,
            "remaining_trials": 7,
            "next_step": "Navigate to project dashboard to begin work"
        }

    Raises:
        PermissionDeniedError: If trial exhausted and not subscribed
        ProjectScaffoldingError: If scaffolding fails at any step
    """
    logger.info(
        f"[PROJECT SCAFFOLDING] Creating project for user={user_id}, "
        f"workspace={workspace_id}"
    )

    basket_id = None
    dump_id = None
    project_id = None
    intent_block_id = None
    agent_session_ids = {}
    work_request_id = None

    try:
        # ================================================================
        # Step 1: Check Permissions (Phase 5 trial/subscription)
        # ================================================================
        try:
            # Use 'research' for permission check and work_request (default agent)
            agent_type = "research"

            permission_info = await check_agent_work_request_allowed(
                user_id=user_id,
                workspace_id=workspace_id,
                agent_type=agent_type,
            )
            logger.debug(
                f"[PROJECT SCAFFOLDING] Permission check passed: "
                f"subscribed={permission_info.get('is_subscribed')}, "
                f"remaining_trials={permission_info.get('remaining_trial_requests')}"
            )
        except PermissionDeniedError as e:
            logger.warning(f"[PROJECT SCAFFOLDING] Permission denied: {e}")
            raise

        # ================================================================
        # Step 2: Create Basket (substrate-api via HTTP - Phase 3 BFF)
        # ================================================================
        substrate_client = get_substrate_client()

        basket_metadata = {
            "created_via": "project_scaffolder",
            "origin": "new_project_onboarding",
            "origin_template": "project_onboarding",
            "auto_scaffolded_sessions": ["thinking_partner", "research", "content", "reporting"],
        }

        try:
            logger.debug(f"[PROJECT SCAFFOLDING] Creating basket: {project_name}")
            basket_response = substrate_client.create_basket(
                workspace_id=workspace_id,
                name=project_name,
                metadata=basket_metadata,
                user_id=user_id,
            )
            basket_id = basket_response["basket_id"]
            logger.info(
                f"[PROJECT SCAFFOLDING] Created basket {basket_id} via substrate-api"
            )

        except Exception as e:
            logger.error(f"[PROJECT SCAFFOLDING] Failed to create basket: {e}")
            raise ProjectScaffoldingError(
                message=f"Failed to create basket: {str(e)}",
                step="create_basket",
                details={"error": str(e), "basket_name": project_name},
            )

        # ================================================================
        # Step 3: Create Intent Block (foundational anchor - guaranteed)
        # ================================================================
        try:
            logger.debug(
                f"[PROJECT SCAFFOLDING] Creating intent block for basket {basket_id}"
            )
            intent_block_id = await create_intent_block(
                basket_id=basket_id,
                workspace_id=workspace_id,
                intent_content=project_intent,
                project_name=project_name,
            )
            if intent_block_id:
                logger.info(
                    f"[PROJECT SCAFFOLDING] Created intent block {intent_block_id}"
                )
            else:
                logger.warning(
                    f"[PROJECT SCAFFOLDING] Intent block creation returned None (non-fatal)"
                )

        except Exception as e:
            # Log but don't fail - intent block is important but not critical
            logger.warning(f"[PROJECT SCAFFOLDING] Intent block creation failed: {e}")

        # ================================================================
        # Step 4: Create Raw Dump (substrate-api via HTTP) - Optional
        # ================================================================
        if initial_context and initial_context.strip():
            dump_metadata = {
                "source": "project_scaffolder",
                "is_initial_context": True,
            }

            try:
                logger.debug(
                    f"[PROJECT SCAFFOLDING] Creating raw_dump for basket {basket_id}"
                )
                dump_response = substrate_client.create_dump(
                    basket_id=basket_id,
                    content=initial_context,
                    metadata=dump_metadata,
                )
                dump_id = dump_response.get("dump_id") or dump_response.get("id")
                logger.info(
                    f"[PROJECT SCAFFOLDING] Created raw_dump {dump_id} for basket {basket_id}"
                )

            except Exception as e:
                logger.error(f"[PROJECT SCAFFOLDING] Failed to create raw_dump: {e}")
                raise ProjectScaffoldingError(
                    message=f"Failed to create raw_dump: {str(e)}",
                    step="create_dump",
                    details={"error": str(e)},
                    basket_id=basket_id,
                )
        else:
            logger.debug("[PROJECT SCAFFOLDING] No initial_context provided, skipping raw_dump")

        # ================================================================
        # Step 5: Create Project (work-platform DB)
        # ================================================================

        # Production schema aligned via migration 20251108_project_agents_architecture.sql
        # Projects are now pure containers (no project_type field)
        project_data = {
            "workspace_id": workspace_id,
            "user_id": user_id,
            "name": project_name,
            "basket_id": basket_id,
            "description": description,
            "status": "active",
            "origin_template": "onboarding_v1",
            "onboarded_at": datetime.utcnow().isoformat(),
            "metadata": {
                "dump_id": dump_id,
                "intent_block_id": intent_block_id,
                "project_intent": project_intent,
                "initial_context_length": len(initial_context) if initial_context else 0,
                "auto_scaffolded_sessions": ["thinking_partner", "research", "content", "reporting"],
            },
        }

        try:
            logger.debug(
                f"[PROJECT SCAFFOLDING] Creating project record for basket {basket_id}"
            )
            response = supabase_admin_client.table("projects").insert(project_data).execute()

            if not response.data or len(response.data) == 0:
                raise Exception("No project created in database")

            project_id = response.data[0]["id"]
            logger.info(
                f"[PROJECT SCAFFOLDING] Created project {project_id} linking to basket {basket_id}"
            )

        except Exception as e:
            logger.error(f"[PROJECT SCAFFOLDING] Failed to create project: {e}")
            raise ProjectScaffoldingError(
                message=f"Failed to create project: {str(e)}",
                step="create_project",
                details={"error": str(e)},
                basket_id=basket_id,
                dump_id=dump_id,
            )

        # ================================================================
        # Step 6: Pre-Scaffold ALL Agent Sessions (TP + Specialists)
        # ================================================================
        try:
            logger.debug(
                f"[PROJECT SCAFFOLDING] Pre-scaffolding all agent sessions for project {project_id}"
            )

            # Import AgentSession for session management
            from shared.session import AgentSession

            # Step 6.1: Create TP session (root of hierarchy, parent_session_id=NULL)
            tp_session = await AgentSession.get_or_create(
                basket_id=basket_id,
                workspace_id=workspace_id,
                agent_type="thinking_partner",
                user_id=user_id,
            )
            agent_session_ids["thinking_partner"] = tp_session.id
            logger.info(
                f"[PROJECT SCAFFOLDING] Created TP session {tp_session.id} (root)"
            )

            # Step 6.2: Pre-create specialist sessions (children of TP)
            specialist_types = ["research", "content", "reporting"]
            for agent_type in specialist_types:
                specialist_session = await AgentSession.get_or_create(
                    basket_id=basket_id,
                    workspace_id=workspace_id,
                    agent_type=agent_type,
                    user_id=user_id,
                )

                # Link as child of TP session (hierarchical structure)
                if not specialist_session.parent_session_id:
                    specialist_session.parent_session_id = tp_session.id
                    specialist_session.created_by_session_id = tp_session.id
                    # Update session in database with parent linkage
                    update_response = supabase_admin_client.table("agent_sessions").update({
                        "parent_session_id": tp_session.id,
                        "created_by_session_id": tp_session.id
                    }).eq("id", specialist_session.id).execute()

                    if not update_response.data:
                        logger.warning(
                            f"[PROJECT SCAFFOLDING] Failed to link {agent_type} session to TP parent"
                        )

                agent_session_ids[agent_type] = specialist_session.id
                logger.info(
                    f"[PROJECT SCAFFOLDING] Created {agent_type} session {specialist_session.id} "
                    f"(parent={tp_session.id})"
                )

            logger.info(
                f"[PROJECT SCAFFOLDING] Pre-scaffolded 4 agent sessions: "
                f"TP + {len(specialist_types)} specialists"
            )

        except Exception as e:
            logger.error(f"[PROJECT SCAFFOLDING] Failed to create agent sessions: {e}")
            raise ProjectScaffoldingError(
                message=f"Failed to create agent sessions: {str(e)}",
                step="create_agent_sessions",
                details={"error": str(e)},
                project_id=project_id,
                basket_id=basket_id,
                dump_id=dump_id,
            )

        # ================================================================
        # Step 7: Create Agent Work Request (for trial tracking)
        # ================================================================
        request_payload = {
            "project_id": project_id,
            "project_name": project_name,
            "project_intent": project_intent,
            "intent_block_id": intent_block_id,
            "scaffolding_timestamp": "now()",
            "dump_id": dump_id,
        }

        try:
            logger.debug(
                f"[PROJECT SCAFFOLDING] Recording work_request for project {project_id}"
            )
            work_request_id = await record_work_request(
                user_id=user_id,
                workspace_id=workspace_id,
                basket_id=basket_id,
                agent_type=agent_type,
                work_mode="general",
                request_payload=request_payload,
                permission_info=permission_info,
            )
            logger.info(
                f"[PROJECT SCAFFOLDING] Recorded work_request {work_request_id} "
                f"(trial={not permission_info.get('is_subscribed')})"
            )

        except Exception as e:
            logger.error(f"[PROJECT SCAFFOLDING] Failed to create work_request: {e}")
            raise ProjectScaffoldingError(
                message=f"Failed to create work_request: {str(e)}",
                step="create_work_request",
                details={"error": str(e)},
                project_id=project_id,
                basket_id=basket_id,
                dump_id=dump_id,
            )

        # ================================================================
        # Step 8: Return Orchestration Result
        # ================================================================
        logger.info(
            f"[PROJECT SCAFFOLDING] ✅ SUCCESS: project={project_id}, "
            f"basket={basket_id}, intent_block={intent_block_id}, sessions={len(agent_session_ids)}, work_request={work_request_id}"
        )

        return {
            "project_id": project_id,
            "project_name": project_name,
            "basket_id": basket_id,
            "dump_id": dump_id,
            "intent_block_id": intent_block_id,
            "agent_session_ids": agent_session_ids,
            "work_request_id": work_request_id,
            "status": "active",
            "is_trial_request": not permission_info.get("is_subscribed", False),
            "remaining_trials": permission_info.get("remaining_trial_requests"),
            "next_step": f"Navigate to /projects/{project_id} to begin work",
        }

    except PermissionDeniedError:
        # Re-raise permission errors as-is (handled by endpoint)
        raise

    except ProjectScaffoldingError:
        # Re-raise scaffolding errors as-is (handled by endpoint)
        raise

    except Exception as e:
        logger.exception(f"[PROJECT SCAFFOLDING] Unexpected error during scaffolding: {e}")
        raise ProjectScaffoldingError(
            message=f"Unexpected scaffolding error: {str(e)}",
            step="unknown",
            details={"error": str(e), "type": type(e).__name__},
            project_id=project_id,
            basket_id=basket_id,
            dump_id=dump_id,
        )
