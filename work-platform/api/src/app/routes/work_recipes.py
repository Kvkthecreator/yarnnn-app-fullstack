"""
Work Recipes API - Recipe Discovery for Work Request Templates

Provides endpoints for discovering and selecting work recipe templates.

Design Philosophy:
- Recipes are pre-defined templates with configurable parameters
- Frontend uses these endpoints to discover available recipes
- Recipe execution happens through existing workflow endpoints (e.g., /api/work/reporting/execute)
- Recipes enhance work_requests with bounded parameter validation
"""

import logging
from typing import Optional, List, Dict, Any
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel

from app.utils.jwt import verify_jwt
from services.recipe_loader import RecipeLoader, RecipeValidationError

router = APIRouter(prefix="/work/recipes", tags=["work_recipes"])
logger = logging.getLogger(__name__)


# ============================================================================
# Request/Response Models
# ============================================================================

class RecipeSummary(BaseModel):
    """Recipe summary for frontend display."""
    id: str
    slug: str
    name: str
    description: str
    category: str
    agent_type: str
    deliverable_intent: Dict[str, Any]
    configurable_parameters: Dict[str, Any]
    estimated_duration_seconds: List[int]  # [min, max]
    estimated_cost_cents: List[int]  # [min, max]


# ============================================================================
# Recipe Discovery Endpoints
# ============================================================================

@router.get("", response_model=List[RecipeSummary])
async def list_recipes(
    agent_type: Optional[str] = None,
    category: Optional[str] = None,
    user: dict = Depends(verify_jwt)
):
    """
    List all active work recipes.

    Query parameters:
    - agent_type: Filter by agent type (research, content, reporting)
    - category: Filter by category

    Returns:
        List of recipe summaries with configurable parameters and estimates
    """
    logger.info(f"[LIST RECIPES] agent_type={agent_type}, category={category}")

    try:
        loader = RecipeLoader()
        recipes = await loader.list_active_recipes(
            agent_type=agent_type,
            category=category
        )

        # Transform to response model
        return [
            RecipeSummary(
                id=r["id"],
                slug=r["slug"],
                name=r["name"],
                description=r.get("description", ""),
                category=r.get("category", ""),
                agent_type=r["agent_type"],
                deliverable_intent=r.get("deliverable_intent", {}),
                configurable_parameters=r.get("configurable_parameters", {}),
                estimated_duration_seconds=r.get("estimated_duration_seconds_range", [180, 360]),
                estimated_cost_cents=r.get("estimated_cost_cents_range", [300, 500]),
            )
            for r in recipes
        ]

    except Exception as e:
        logger.exception(f"[LIST RECIPES] Failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{slug}", response_model=RecipeSummary)
async def get_recipe(
    slug: str,
    user: dict = Depends(verify_jwt)
):
    """
    Get details of a specific recipe by slug.

    Args:
        slug: Recipe slug (e.g., "executive-summary-deck")

    Returns:
        Recipe details with configurable parameters
    """
    logger.info(f"[GET RECIPE] slug={slug}")

    try:
        loader = RecipeLoader()
        recipe = await loader.load_recipe(slug=slug)

        return RecipeSummary(
            id=recipe.id,
            slug=recipe.slug,
            name=recipe.name,
            description=recipe.description,
            category=recipe.category,
            agent_type=recipe.agent_type,
            deliverable_intent=recipe.deliverable_intent,
            configurable_parameters=recipe.configurable_parameters,
            estimated_duration_seconds=recipe.estimated_duration_seconds_range,
            estimated_cost_cents=recipe.estimated_cost_cents_range,
        )

    except RecipeValidationError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        logger.exception(f"[GET RECIPE] Failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))
