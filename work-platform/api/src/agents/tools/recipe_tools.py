"""
Recipe Tools for Thinking Partner Agent

These tools allow TP to list available work recipes and trigger their execution.
Recipes are loaded from the work_recipes database table (single source of truth).
Recipe execution flows through the unified /api/work/queue endpoint.

See:
- /docs/architecture/ADR_UNIFIED_WORK_ORCHESTRATION.md
- /docs/implementation/THINKING_PARTNER_IMPLEMENTATION_PLAN.md
"""

import logging
import os
from typing import Any, Dict, List, Optional
import httpx

logger = logging.getLogger(__name__)

# Work Platform URL for internal API calls
WORK_PLATFORM_URL = os.getenv("WORK_PLATFORM_URL", "http://localhost:3000")

# Tool definitions for Anthropic API
RECIPE_TOOLS = [
    {
        "name": "list_recipes",
        "description": """List available work recipes that can be triggered.

Work recipes are predefined workflows like research, content generation, or reporting.
Each recipe has required context and produces specific outputs.

Returns recipe slug, name, description, required context, and output types.""",
        "input_schema": {
            "type": "object",
            "properties": {
                "category": {
                    "type": "string",
                    "description": "Optional: filter by category (research, content, reporting)"
                }
            }
        }
    },
    {
        "name": "trigger_recipe",
        "description": """Queue a work recipe for execution. Creates a work_ticket.

The recipe will run asynchronously and produce work_outputs for review.
You can check the status later or the user will see outputs in their supervision queue.

Example: trigger_recipe(recipe_slug="research-deep-dive", parameters={"research_scope": "market trends"})""",
        "input_schema": {
            "type": "object",
            "properties": {
                "recipe_slug": {
                    "type": "string",
                    "description": "The recipe identifier (e.g., 'research-deep-dive', 'social-media-post', 'executive-summary-deck')"
                },
                "parameters": {
                    "type": "object",
                    "description": "Recipe-specific parameters"
                },
                "priority": {
                    "type": "integer",
                    "description": "Priority 1-10, higher is more urgent. Default: 5",
                    "default": 5
                }
            },
            "required": ["recipe_slug"]
        }
    }
]


async def execute_recipe_tool(
    tool_name: str,
    tool_input: Dict[str, Any],
    context: Dict[str, Any],
) -> Dict[str, Any]:
    """
    Execute a recipe tool and return the result.

    Args:
        tool_name: Name of the tool to execute
        tool_input: Tool input parameters
        context: Execution context with basket_id, user_id, etc.

    Returns:
        Tool result dict
    """
    basket_id = context.get("basket_id")
    user_id = context.get("user_id")
    session_id = context.get("session_id")
    workspace_id = context.get("workspace_id")

    if not basket_id:
        return {"error": "No basket_id in context"}

    if tool_name == "list_recipes":
        return await list_recipes(
            category=tool_input.get("category"),
        )
    elif tool_name == "trigger_recipe":
        return await trigger_recipe(
            basket_id=basket_id,
            workspace_id=workspace_id,
            user_id=user_id,
            session_id=session_id,
            recipe_slug=tool_input.get("recipe_slug"),
            parameters=tool_input.get("parameters", {}),
            priority=tool_input.get("priority", 5),
        )
    else:
        return {"error": f"Unknown recipe tool: {tool_name}"}


async def list_recipes(
    category: Optional[str] = None,
) -> Dict[str, Any]:
    """
    List available work recipes from the database.

    Args:
        category: Optional filter by category (research, content, reporting)

    Returns:
        List of available recipes with their metadata
    """
    from app.utils.supabase_client import supabase_admin_client as supabase

    try:
        # Query work_recipes table
        query = supabase.table("work_recipes").select(
            "slug, name, description, category, agent_type, "
            "context_requirements, configurable_parameters, "
            "schedulable, default_frequency"
        ).eq("status", "active")

        if category:
            query = query.eq("category", category)

        result = query.execute()

        if not result.data:
            return {
                "recipes": [],
                "count": 0,
                "categories": [],
                "message": "No recipes found. Recipes may need to be seeded in the database."
            }

        # Format for agent consumption
        formatted = []
        categories_seen = set()

        for recipe in result.data:
            categories_seen.add(recipe.get("category", ""))

            # Extract context requirements (supports both new and legacy formats)
            ctx_req = recipe.get("context_requirements", {}) or {}

            # New format: context_items.required_types
            required_context = ctx_req.get("context_items", {}).get("required_types", [])

            # Legacy fallback: substrate_blocks.semantic_types (deprecated Dec 2025)
            if not required_context:
                required_context = ctx_req.get("required", [])
            if not required_context and isinstance(ctx_req.get("substrate_blocks"), dict):
                required_context = ctx_req.get("substrate_blocks", {}).get("semantic_types", [])

            # Extract parameter names
            params = recipe.get("configurable_parameters", {}) or {}
            param_names = list(params.keys())

            formatted.append({
                "slug": recipe["slug"],
                "name": recipe["name"],
                "description": recipe.get("description", ""),
                "category": recipe.get("category", recipe.get("agent_type", "")),
                "agent_type": recipe.get("agent_type", ""),
                "context_required": required_context,
                "parameters": param_names,
                "schedulable": recipe.get("schedulable", True),
                "default_frequency": recipe.get("default_frequency"),
            })

        return {
            "recipes": formatted,
            "count": len(formatted),
            "categories": list(categories_seen),
        }

    except Exception as e:
        logger.error(f"[list_recipes] Error loading recipes: {e}")
        return {
            "error": f"Failed to load recipes: {str(e)}",
            "recipes": [],
            "count": 0,
        }


async def trigger_recipe(
    basket_id: str,
    workspace_id: Optional[str],
    user_id: str,
    session_id: Optional[str],
    recipe_slug: str,
    parameters: Dict[str, Any],
    priority: int = 5,
    schedule_id: Optional[str] = None,
    mode: str = "one_shot",
    cycle_number: int = 1,
) -> Dict[str, Any]:
    """
    Trigger a work recipe via the unified /api/work/queue endpoint.

    This creates both a work_request (audit trail) and work_ticket (execution).
    The queue processor will pick up pending tickets and execute them.

    Args:
        basket_id: Basket UUID
        workspace_id: Workspace UUID
        user_id: User UUID
        session_id: TP session ID
        recipe_slug: Recipe to trigger
        parameters: Recipe parameters
        priority: Ticket priority (1-10)
        schedule_id: Optional FK to project_schedules for recurring work
        mode: 'one_shot' (default) or 'continuous' for scheduled work
        cycle_number: For continuous mode, which execution cycle this is

    Returns:
        Result with work_request_id and work_ticket_id
    """
    try:
        # Build request payload for unified queue endpoint
        queue_payload = {
            "basket_id": basket_id,
            "recipe_slug": recipe_slug,
            "parameters": parameters,
            "priority": min(max(priority, 1), 10),
            "source": "schedule" if schedule_id else "thinking_partner",
            "tp_session_id": session_id,
            "user_id": user_id,
            "workspace_id": workspace_id,
        }

        # Add schedule info if provided
        if schedule_id:
            queue_payload["schedule_id"] = schedule_id
            queue_payload["scheduling_intent"] = {
                "mode": "recurring" if mode == "continuous" else "one_shot",
            }

        # Call unified queue endpoint
        service_secret = os.getenv("SUBSTRATE_SERVICE_SECRET", "")

        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(
                f"{WORK_PLATFORM_URL}/api/work/queue",
                json=queue_payload,
                headers={
                    "Authorization": f"Bearer {service_secret}",
                    "Content-Type": "application/json",
                },
            )

        if response.status_code == 200:
            result = response.json()
            logger.info(
                f"[trigger_recipe] Queued {recipe_slug}: "
                f"work_request={result.get('work_request_id')}, "
                f"work_ticket={result.get('work_ticket_id')}"
            )

            return {
                "success": True,
                "work_request_id": result.get("work_request_id"),
                "work_ticket_id": result.get("work_ticket_id"),
                "recipe_slug": recipe_slug,
                "status": "queued",
                "mode": mode,
                "cycle_number": cycle_number if mode == "continuous" else None,
                "schedule_id": schedule_id,
                "message": result.get("message", f"Work queued. Results will appear in supervision queue."),
            }

        elif response.status_code == 400:
            error_data = response.json()
            return {
                "error": error_data.get("detail", "Validation failed"),
                "recipe": recipe_slug,
                "missing_context": error_data.get("missing_context"),
                "suggestion": "Use write_context to add the missing context items." if error_data.get("missing_context") else None,
            }

        elif response.status_code == 404:
            # Recipe not found - fetch available recipes for helpful error
            available = await list_recipes()
            return {
                "error": f"Recipe not found: {recipe_slug}",
                "available_recipes": [r["slug"] for r in available.get("recipes", [])],
            }

        else:
            logger.error(f"[trigger_recipe] Queue endpoint error: {response.status_code} - {response.text}")
            return {
                "error": f"Failed to queue recipe: {response.status_code}",
                "details": response.text[:200] if response.text else None,
            }

    except httpx.TimeoutException:
        logger.error("[trigger_recipe] Timeout calling queue endpoint")
        return {"error": "Request timed out. Please try again."}

    except Exception as e:
        logger.error(f"[trigger_recipe] Error: {e}")
        return {"error": f"Failed to trigger recipe: {str(e)}"}
