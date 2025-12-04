"""
Recipe Tools for Thinking Partner Agent

These tools allow TP to list available work recipes and trigger their execution.
Recipe execution creates work_tickets that are processed by the canonical queue.

See: /docs/implementation/THINKING_PARTNER_IMPLEMENTATION_PLAN.md
"""

import logging
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
from uuid import uuid4

logger = logging.getLogger(__name__)

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

Example: trigger_recipe(recipe_slug="deep_research", parameters={"topic": "AI agents"})""",
        "input_schema": {
            "type": "object",
            "properties": {
                "recipe_slug": {
                    "type": "string",
                    "description": "The recipe identifier (e.g., 'deep_research', 'blog_post', 'competitor_analysis')"
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

# Available recipes (could be loaded from DB in future)
AVAILABLE_RECIPES = [
    {
        "slug": "deep_research",
        "name": "Deep Research",
        "description": "Comprehensive research on a topic with web search and synthesis",
        "category": "research",
        "context_required": ["problem", "customer"],
        "context_optional": ["competitor", "vision"],
        "parameters": {
            "topic": {"type": "string", "required": True, "description": "Research topic"},
            "depth": {"type": "string", "enum": ["quick", "standard", "deep"], "default": "standard"},
            "scope": {"type": "string", "enum": ["general", "competitor", "market", "technical"], "default": "general"},
        },
        "outputs": ["finding", "insight", "recommendation"],
    },
    {
        "slug": "competitor_analysis",
        "name": "Competitor Analysis",
        "description": "Analyze a specific competitor's strengths, weaknesses, and positioning",
        "category": "research",
        "context_required": ["problem", "customer"],
        "context_optional": ["competitor", "brand"],
        "parameters": {
            "competitor_name": {"type": "string", "required": True, "description": "Name of competitor to analyze"},
            "focus_areas": {"type": "array", "items": {"type": "string"}, "description": "Specific areas to focus on"},
        },
        "outputs": ["finding", "insight", "competitor"],
    },
    {
        "slug": "trend_digest",
        "name": "Trend Digest",
        "description": "Generate a digest of current trends in the user's market",
        "category": "research",
        "context_required": ["problem", "customer"],
        "context_optional": ["competitor", "vision"],
        "parameters": {
            "timeframe": {"type": "string", "enum": ["week", "month", "quarter"], "default": "week"},
        },
        "outputs": ["trend_digest"],
    },
    {
        "slug": "blog_post",
        "name": "Blog Post",
        "description": "Generate a blog post draft based on context and topic",
        "category": "content",
        "context_required": ["brand", "customer"],
        "context_optional": ["problem", "vision"],
        "parameters": {
            "topic": {"type": "string", "required": True, "description": "Blog post topic"},
            "tone": {"type": "string", "enum": ["professional", "casual", "technical"], "default": "professional"},
            "length": {"type": "string", "enum": ["short", "medium", "long"], "default": "medium"},
        },
        "outputs": ["draft"],
    },
    {
        "slug": "social_post",
        "name": "Social Media Post",
        "description": "Generate social media content for various platforms",
        "category": "content",
        "context_required": ["brand"],
        "context_optional": ["customer", "problem"],
        "parameters": {
            "platform": {"type": "string", "enum": ["linkedin", "twitter", "facebook"], "required": True},
            "topic": {"type": "string", "required": True},
        },
        "outputs": ["draft"],
    },
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
    List available work recipes.

    Args:
        category: Optional filter by category

    Returns:
        List of available recipes
    """
    recipes = AVAILABLE_RECIPES

    if category:
        recipes = [r for r in recipes if r["category"] == category]

    # Format for agent consumption
    formatted = []
    for recipe in recipes:
        formatted.append({
            "slug": recipe["slug"],
            "name": recipe["name"],
            "description": recipe["description"],
            "category": recipe["category"],
            "context_required": recipe["context_required"],
            "parameters": list(recipe["parameters"].keys()),
            "outputs": recipe["outputs"],
        })

    return {
        "recipes": formatted,
        "count": len(formatted),
        "categories": list(set(r["category"] for r in recipes)),
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
    Trigger a work recipe by creating a work_ticket.

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
        Result with work_ticket_id
    """
    from app.utils.supabase_client import supabase_admin_client as supabase

    try:
        # Find recipe
        recipe = next((r for r in AVAILABLE_RECIPES if r["slug"] == recipe_slug), None)

        if not recipe:
            available = [r["slug"] for r in AVAILABLE_RECIPES]
            return {
                "error": f"Unknown recipe: {recipe_slug}",
                "available_recipes": available,
            }

        # Validate required parameters
        missing_params = []
        for param_name, param_def in recipe["parameters"].items():
            if param_def.get("required") and param_name not in parameters:
                missing_params.append(param_name)

        if missing_params:
            return {
                "error": f"Missing required parameters: {missing_params}",
                "recipe": recipe_slug,
                "required_parameters": {
                    k: v for k, v in recipe["parameters"].items()
                    if v.get("required")
                }
            }

        # Check context requirements
        context_result = await _check_context_requirements(
            supabase, basket_id, recipe["context_required"]
        )

        if context_result["missing"]:
            return {
                "error": f"Missing required context: {context_result['missing']}",
                "recipe": recipe_slug,
                "message": f"Please fill in {', '.join(context_result['missing'])} context before running this recipe.",
                "suggestion": "Use write_context to add the missing context items."
            }

        # Determine source based on schedule
        source = "schedule" if schedule_id else "thinking_partner"

        # Create work ticket
        ticket_data = {
            "basket_id": basket_id,
            "workspace_id": workspace_id,
            "agent_type": recipe_slug,  # Use recipe slug as agent type
            "status": "pending",
            "priority": min(max(priority, 1), 10),
            "source": source,
            "mode": mode,
            "cycle_number": cycle_number,
            "metadata": {
                "recipe_slug": recipe_slug,
                "recipe_name": recipe["name"],
                "parameters": parameters,
                "context_required": recipe["context_required"],
                "triggered_by": "schedule" if schedule_id else "thinking_partner",
                "tp_session_id": session_id,
                "triggered_at": datetime.now(timezone.utc).isoformat(),
            }
        }

        # Add schedule_id if provided
        if schedule_id:
            ticket_data["schedule_id"] = schedule_id

        result = supabase.table("work_tickets").insert(ticket_data).execute()

        if not result.data:
            return {"error": "Failed to create work ticket"}

        ticket_id = result.data[0]["id"]
        logger.info(f"[trigger_recipe] Created work_ticket {ticket_id} for {recipe_slug}")

        return {
            "success": True,
            "work_ticket_id": ticket_id,
            "recipe": {
                "slug": recipe_slug,
                "name": recipe["name"],
            },
            "status": "queued",
            "mode": mode,
            "cycle_number": cycle_number if mode == "continuous" else None,
            "schedule_id": schedule_id,
            "message": f"Started {recipe['name']}. The results will appear in your supervision queue when complete.",
            "expected_outputs": recipe["outputs"],
        }

    except Exception as e:
        logger.error(f"[trigger_recipe] Error: {e}")
        return {"error": f"Failed to trigger recipe: {str(e)}"}


async def _check_context_requirements(
    supabase,
    basket_id: str,
    required_types: List[str],
) -> Dict[str, Any]:
    """Check if required context items exist."""
    result = (
        supabase.table("context_items")
        .select("item_type")
        .eq("basket_id", basket_id)
        .in_("item_type", required_types)
        .eq("status", "active")
        .execute()
    )

    existing = {item["item_type"] for item in result.data or []}
    missing = [t for t in required_types if t not in existing]

    return {
        "existing": list(existing),
        "missing": missing,
        "complete": len(missing) == 0,
    }
