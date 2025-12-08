"""
Context Tools for Thinking Partner Agent

These tools allow TP to read, write, and list context items.
Foundation tier writes create governance proposals for user approval.

v3.0 Terminology:
- item_type: Type of context item (problem, customer, vision, brand, etc.)
- item_key: Optional key for non-singleton types
- content: Structured JSONB data
- tier: Governance tier (foundation, working, ephemeral)

See: /docs/implementation/THINKING_PARTNER_IMPLEMENTATION_PLAN.md
"""

import logging
from typing import Any, Dict, List, Optional
from uuid import UUID

logger = logging.getLogger(__name__)

# Tool definitions for Anthropic API
CONTEXT_TOOLS = [
    {
        "name": "read_context",
        "description": """Read a context item by type. Returns the item's content, completeness score, and tier.

Use this to understand the user's current context before making suggestions or taking actions.

Available item types:
- Foundation tier (stable, user-established): problem, customer, vision, brand
- Working tier (accumulating): competitor, trend_digest, competitor_snapshot, reference

Example: read_context(item_type="problem") returns the user's problem statement.""",
        "input_schema": {
            "type": "object",
            "properties": {
                "item_type": {
                    "type": "string",
                    "enum": ["problem", "customer", "vision", "brand", "competitor", "trend_digest", "competitor_snapshot", "reference"],
                    "description": "The type of context item to read. Must be one of the defined types."
                },
                "fields": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Optional: specific fields to return. If omitted, returns all fields."
                },
                "item_key": {
                    "type": "string",
                    "description": "For non-singleton types like 'competitor', specify which one (e.g., competitor name)"
                }
            },
            "required": ["item_type"]
        }
    },
    {
        "name": "write_context",
        "description": """Create or update a context item.

IMPORTANT: You can ONLY write to these defined item types:
- Foundation tier (require user approval): problem, customer, vision, brand
- Working tier (written directly): competitor, trend_digest, competitor_snapshot, reference

Use 'reference' for user-shared data (reports, research, raw information) that doesn't fit other types.
Do NOT invent new item types beyond these.

Example: write_context(item_type="reference", item_key="korean_fin_2024", content={"title": "Korean Financial Data", "data": "..."})""",
        "input_schema": {
            "type": "object",
            "properties": {
                "item_type": {
                    "type": "string",
                    "enum": ["problem", "customer", "vision", "brand", "competitor", "trend_digest", "competitor_snapshot", "reference"],
                    "description": "The type of context item. Must be one of the defined types."
                },
                "content": {
                    "type": "object",
                    "description": "The field values to set. Keys should match the schema fields."
                },
                "item_key": {
                    "type": "string",
                    "description": "For non-singleton types, the unique key (e.g., competitor name)"
                },
                "title": {
                    "type": "string",
                    "description": "Optional display title for the item"
                }
            },
            "required": ["item_type", "content"]
        }
    },
    {
        "name": "list_context",
        "description": """List all context items for the current basket, grouped by tier.

Returns completeness scores to help identify what context is missing or incomplete.
Use this to understand the overall context state and suggest what to fill in.

Returns:
- foundation: Core context items (problem, customer, vision, brand)
- working: Accumulating context (competitors, trends, etc.)
- ephemeral: Temporary context (session notes, drafts)""",
        "input_schema": {
            "type": "object",
            "properties": {
                "tier": {
                    "type": "string",
                    "enum": ["foundation", "working", "ephemeral"],
                    "description": "Optional: filter to specific tier"
                }
            }
        }
    }
]


async def execute_context_tool(
    tool_name: str,
    tool_input: Dict[str, Any],
    context: Dict[str, Any],
) -> Dict[str, Any]:
    """
    Execute a context tool and return the result.

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

    if not basket_id:
        return {"error": "No basket_id in context"}

    if tool_name == "read_context":
        return await read_context(
            basket_id=basket_id,
            item_type=tool_input.get("item_type"),
            fields=tool_input.get("fields"),
            item_key=tool_input.get("item_key"),
        )
    elif tool_name == "write_context":
        return await write_context(
            basket_id=basket_id,
            user_id=user_id,
            session_id=session_id,
            item_type=tool_input.get("item_type"),
            content=tool_input.get("content", {}),
            item_key=tool_input.get("item_key"),
            title=tool_input.get("title"),
        )
    elif tool_name == "list_context":
        return await list_context(
            basket_id=basket_id,
            tier=tool_input.get("tier"),
        )
    else:
        return {"error": f"Unknown context tool: {tool_name}"}


async def read_context(
    basket_id: str,
    item_type: str,
    fields: Optional[List[str]] = None,
    item_key: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Read a context item by type.

    Args:
        basket_id: Basket UUID
        item_type: Type of context item
        fields: Optional list of specific fields to return
        item_key: For non-singleton types, the specific key

    Returns:
        Context item data or error
    """
    from app.utils.supabase_client import supabase_admin_client as supabase

    try:
        query = (
            supabase.table("context_items")
            .select("*, context_entry_schemas(display_name, field_schema)")
            .eq("basket_id", basket_id)
            .eq("item_type", item_type)
            .eq("status", "active")
        )

        if item_key:
            query = query.eq("item_key", item_key)
        else:
            query = query.is_("item_key", "null")

        # Use limit(1) instead of single() to handle duplicate rows gracefully
        # PGRST116 error occurs when .single() returns 0 or 2+ rows
        result = query.order("updated_at", desc=True).limit(1).execute()

        if not result.data or len(result.data) == 0:
            return {
                "found": False,
                "item_type": item_type,
                "message": f"No {item_type} context item found. You can create one with write_context."
            }

        # Get first item from array (we used limit(1) instead of single())
        item = result.data[0]
        schema_info = item.pop("context_entry_schemas", {}) or {}
        content = item.get("content", {})

        # Filter to requested fields if specified
        if fields:
            content = {k: v for k, v in content.items() if k in fields}

        return {
            "found": True,
            "item_type": item_type,
            "item_key": item.get("item_key"),
            "title": item.get("title") or schema_info.get("display_name"),
            "tier": item.get("tier"),
            "content": content,
            "completeness_score": item.get("completeness_score", 0),
            "updated_at": item.get("updated_at"),
        }

    except Exception as e:
        logger.error(f"[read_context] Error reading {item_type}: {e}")
        return {"error": f"Failed to read context: {str(e)}"}


async def write_context(
    basket_id: str,
    user_id: str,
    session_id: Optional[str],
    item_type: str,
    content: Dict[str, Any],
    item_key: Optional[str] = None,
    title: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Write a context item. Foundation tier respects workspace governance settings.

    Args:
        basket_id: Basket UUID
        user_id: User UUID for audit
        session_id: TP session ID for tracking
        item_type: Type of context item
        content: Field values to set
        item_key: For non-singleton types
        title: Optional display title

    Returns:
        Result of write operation
    """
    from app.utils.supabase_client import supabase_admin_client as supabase

    try:
        # Get schema to determine tier and validate
        # Use limit(1) instead of single() to avoid PGRST116 error when schema doesn't exist
        schema_result = (
            supabase.table("context_entry_schemas")
            .select("category, is_singleton, field_schema")
            .eq("anchor_role", item_type)
            .limit(1)
            .execute()
        )

        # If schema exists, use it for validation and tier determination
        schema_exists = schema_result.data and len(schema_result.data) > 0

        if schema_exists:
            schema = schema_result.data[0]
            category = schema.get("category", "market")
            is_singleton = schema.get("is_singleton", True)
            field_schema = schema.get("field_schema", {})

            # Map category to tier
            tier = "foundation" if category == "foundation" else "working"

            # For singleton types, item_key must be null
            if is_singleton:
                item_key = None

            # Calculate completeness against schema
            completeness = _calculate_completeness(content, field_schema)
        else:
            # Schema doesn't exist - allow write to working tier with no validation
            # This enables agent-generated content types like analysis, finding, insight
            logger.info(f"[write_context] No schema for item_type '{item_type}', using working tier")
            tier = "working"
            is_singleton = False  # Allow multiple items with item_key
            # Treat as 100% complete since no schema to validate against
            completeness = {"score": 1.0, "required_fields": 0, "filled_fields": 0, "missing_fields": []}

        # Foundation tier → check governance settings
        if tier == "foundation":
            # Check workspace governance settings for auto-approval
            auto_approve = await _check_governance_auto_approve(supabase, basket_id)

            if auto_approve:
                # Auto-approve: write directly
                logger.info(f"[write_context] Auto-approving foundation write for {item_type}")
            else:
                # Require approval: create governance proposal
                return await _create_governance_proposal(
                    supabase=supabase,
                    basket_id=basket_id,
                    user_id=user_id,
                    session_id=session_id,
                    item_type=item_type,
                    content=content,
                    item_key=item_key,
                    title=title,
                    completeness=completeness,
                )

        # Direct write (working/ephemeral tier OR auto-approved foundation)
        item_data = {
            "basket_id": basket_id,
            "tier": tier,
            "item_type": item_type,
            "item_key": item_key,
            "title": title,
            "content": content,
            "schema_id": item_type if schema_exists else None,  # Only set if schema exists (FK constraint)
            "completeness_score": completeness["score"],
            "status": "active",
            "created_by": f"agent:thinking_partner",
            "updated_by": f"agent:thinking_partner",
        }

        result = (
            supabase.table("context_items")
            .upsert(item_data, on_conflict="basket_id,item_type,item_key")
            .execute()
        )

        if not result.data:
            return {"error": "Failed to save context item"}

        logger.info(f"[write_context] Wrote {item_type} to basket {basket_id}")

        # Different message for foundation vs working tier
        if tier == "foundation":
            message = f"Updated {item_type} (auto-approved per workspace settings)."
        else:
            message = f"Updated {item_type} context item."

        return {
            "success": True,
            "action": "written",
            "item_type": item_type,
            "tier": tier,
            "completeness_score": completeness["score"],
            "message": message
        }

    except Exception as e:
        logger.error(f"[write_context] Error writing {item_type}: {e}")
        return {"error": f"Failed to write context: {str(e)}"}


async def _create_governance_proposal(
    supabase,
    basket_id: str,
    user_id: str,
    session_id: Optional[str],
    item_type: str,
    content: Dict[str, Any],
    item_key: Optional[str],
    title: Optional[str],
    completeness: Dict[str, Any],
) -> Dict[str, Any]:
    """Create a governance proposal for foundation tier write."""

    try:
        # Check if there's an existing item to show as "before"
        existing_query = (
            supabase.table("context_items")
            .select("id, content")
            .eq("basket_id", basket_id)
            .eq("item_type", item_type)
            .eq("status", "active")
        )

        if item_key:
            existing_query = existing_query.eq("item_key", item_key)
        else:
            existing_query = existing_query.is_("item_key", "null")

        existing = existing_query.execute()
        existing_content = existing.data[0].get("content") if existing.data else None

        # Create proposal
        proposal_data = {
            "basket_id": basket_id,
            "proposal_type": "context_item",
            "status": "pending",
            "proposed_by": f"agent:thinking_partner",
            "proposed_changes": {
                "item_type": item_type,
                "item_key": item_key,
                "title": title,
                "content": content,
                "previous_content": existing_content,
                "operation": "update" if existing_content else "create",
            },
            "metadata": {
                "source": "thinking_partner",
                "session_id": session_id,
                "completeness_score": completeness["score"],
            }
        }

        result = supabase.table("governance_proposals").insert(proposal_data).execute()

        if not result.data:
            return {"error": "Failed to create governance proposal"}

        proposal_id = result.data[0]["id"]
        logger.info(f"[write_context] Created governance proposal {proposal_id} for {item_type}")

        return {
            "success": True,
            "action": "proposed",
            "proposal_id": proposal_id,
            "item_type": item_type,
            "tier": "foundation",
            "requires_approval": True,
            "message": f"Proposed change to {item_type}. This is a foundation context item and requires your approval. Please review in the Governance tab."
        }

    except Exception as e:
        logger.error(f"[_create_governance_proposal] Error: {e}")
        return {"error": f"Failed to create proposal: {str(e)}"}


async def list_context(
    basket_id: str,
    tier: Optional[str] = None,
) -> Dict[str, Any]:
    """
    List all context items for a basket, grouped by tier.

    Args:
        basket_id: Basket UUID
        tier: Optional filter to specific tier

    Returns:
        Context items grouped by tier with completeness info
    """
    from app.utils.supabase_client import supabase_admin_client as supabase

    try:
        query = (
            supabase.table("context_items")
            .select("item_type, item_key, title, tier, completeness_score, updated_at, context_entry_schemas(display_name, icon)")
            .eq("basket_id", basket_id)
            .eq("status", "active")
        )

        if tier:
            query = query.eq("tier", tier)

        result = query.order("item_type").execute()

        # Group by tier
        grouped = {
            "foundation": [],
            "working": [],
            "ephemeral": [],
        }

        for item in result.data or []:
            schema_info = item.pop("context_entry_schemas", {}) or {}
            tier_key = item.get("tier", "working")

            grouped[tier_key].append({
                "item_type": item["item_type"],
                "item_key": item.get("item_key"),
                "title": item.get("title") or schema_info.get("display_name"),
                "icon": schema_info.get("icon"),
                "completeness_score": item.get("completeness_score", 0),
                "updated_at": item.get("updated_at"),
            })

        # Get schemas to show what's missing
        schemas = (
            supabase.table("context_entry_schemas")
            .select("anchor_role, display_name, category, is_singleton")
            .execute()
        )

        existing_types = {item["item_type"] for item in result.data or []}
        missing = []

        for schema in schemas.data or []:
            if schema["anchor_role"] not in existing_types:
                tier_key = "foundation" if schema["category"] == "foundation" else "working"
                missing.append({
                    "item_type": schema["anchor_role"],
                    "display_name": schema["display_name"],
                    "tier": tier_key,
                    "is_singleton": schema["is_singleton"],
                })

        # Calculate overall completeness
        total_items = len(result.data or [])
        total_score = sum((item.get("completeness_score") or 0) for item in result.data or [])
        overall_completeness = total_score / total_items if total_items > 0 else 0

        return {
            "items": grouped,
            "missing": missing,
            "summary": {
                "total_items": total_items,
                "foundation_count": len(grouped["foundation"]),
                "working_count": len(grouped["working"]),
                "ephemeral_count": len(grouped["ephemeral"]),
                "missing_count": len(missing),
                "overall_completeness": round(overall_completeness, 2),
            }
        }

    except Exception as e:
        logger.error(f"[list_context] Error: {e}")
        return {"error": f"Failed to list context: {str(e)}"}


def _calculate_completeness(content: Dict[str, Any], field_schema: Dict[str, Any]) -> Dict[str, Any]:
    """Calculate completeness score for content against schema."""
    fields = field_schema.get("fields", [])
    required_count = 0
    filled_count = 0
    missing_fields = []

    for field in fields:
        if field.get("required", False):
            required_count += 1
            key = field.get("key")
            value = content.get(key)

            if value is not None and value != "" and value != []:
                filled_count += 1
            else:
                missing_fields.append(key)

    score = filled_count / required_count if required_count > 0 else 1.0

    return {
        "score": score,
        "required_fields": required_count,
        "filled_fields": filled_count,
        "missing_fields": missing_fields,
    }


async def _check_governance_auto_approve(supabase, basket_id: str) -> bool:
    """
    Check workspace governance settings to determine if foundation tier
    writes should be auto-approved.

    Returns True if auto-approve is enabled (ep_manual_edit = 'direct').
    Returns True by default if no settings found (permissive default).
    """
    try:
        # Get workspace_id from basket
        # Use limit(1) instead of single() to avoid PGRST116 error when row doesn't exist
        basket_result = (
            supabase.table("baskets")
            .select("workspace_id")
            .eq("id", basket_id)
            .limit(1)
            .execute()
        )

        if not basket_result.data or len(basket_result.data) == 0:
            logger.warning(f"[_check_governance_auto_approve] Basket {basket_id} not found, defaulting to auto-approve")
            return True

        workspace_id = basket_result.data[0].get("workspace_id")
        if not workspace_id:
            logger.warning(f"[_check_governance_auto_approve] No workspace_id for basket {basket_id}, defaulting to auto-approve")
            return True

        # Get workspace governance settings
        # Use limit(1) instead of single() to avoid PGRST116 error when row doesn't exist
        settings_result = (
            supabase.table("workspace_governance_settings")
            .select("ep_manual_edit")
            .eq("workspace_id", workspace_id)
            .limit(1)
            .execute()
        )

        if not settings_result.data or len(settings_result.data) == 0:
            logger.info(f"[_check_governance_auto_approve] No governance settings for workspace {workspace_id}, defaulting to auto-approve")
            return True

        ep_manual_edit = settings_result.data[0].get("ep_manual_edit", "direct")

        # 'direct' = auto-approve, 'proposal' = require approval, 'hybrid' = auto-approve (for now)
        auto_approve = ep_manual_edit in ("direct", "hybrid")

        logger.debug(f"[_check_governance_auto_approve] workspace={workspace_id}, ep_manual_edit={ep_manual_edit}, auto_approve={auto_approve}")

        return auto_approve

    except Exception as e:
        logger.error(f"[_check_governance_auto_approve] Error checking settings: {e}, defaulting to auto-approve")
        return True
