"""
Context Provisioner - Fetch structured context for recipe execution.

This service provides context items to agents/recipes before execution.
It bridges the gap between context_items table and agent prompt construction.

v3.0 Terminology:
- item_type: Type of context item (replaces anchor_role)
- item_key: Optional key for non-singleton types (replaces entry_key)
- content: Structured JSONB data (replaces data)
- tier: Governance tier (foundation, working, ephemeral)

Canon Compliance:
- Context items are CONSUMED, not created by this service
- Agents receive pre-fetched context for prompts
- Staleness/freshness is tracked but not enforced here

Usage:
    from services.context_provisioner import ContextProvisioner

    provisioner = ContextProvisioner()
    context = await provisioner.provision_context(
        basket_id="...",
        required_types=["problem", "customer", "vision"],
        resolve_assets=True
    )

See: /docs/architecture/ADR_CONTEXT_ITEMS_UNIFIED.md
"""

import logging
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from infra.utils.supabase_client import supabase_admin_client as supabase

logger = logging.getLogger(__name__)


class ContextProvisionResult:
    """Result of context provisioning for recipe execution."""

    def __init__(
        self,
        items: Dict[str, Dict[str, Any]],
        missing_types: List[str],
        stale_types: List[str],
        completeness: Dict[str, float],
    ):
        self.items = items
        self.missing_types = missing_types
        self.stale_types = stale_types
        self.completeness = completeness
        self.provisioned_at = datetime.now(timezone.utc)

    # Aliases for backward compatibility during transition
    @property
    def entries(self) -> Dict[str, Dict[str, Any]]:
        return self.items

    @property
    def missing_roles(self) -> List[str]:
        return self.missing_types

    @property
    def stale_roles(self) -> List[str]:
        return self.stale_types

    @property
    def is_complete(self) -> bool:
        """True if all required types are present and complete."""
        return len(self.missing_types) == 0

    @property
    def has_stale_content(self) -> bool:
        """True if any types have stale content needing refresh."""
        return len(self.stale_types) > 0

    def get_item(self, item_type: str) -> Optional[Dict[str, Any]]:
        """Get item data for a specific type."""
        return self.items.get(item_type)

    # Alias for backward compatibility
    def get_entry(self, anchor_role: str) -> Optional[Dict[str, Any]]:
        return self.get_item(anchor_role)

    def to_prompt_context(self, types: Optional[List[str]] = None) -> str:
        """
        Format context items for LLM prompt injection.

        Args:
            types: Specific types to include (default: all)

        Returns:
            Formatted string suitable for LLM prompt
        """
        target_types = types or list(self.items.keys())
        sections = []

        for item_type in target_types:
            item = self.items.get(item_type)
            if item:
                content = item.get("content", {})
                display_name = item.get("title") or item.get(
                    "schema_display_name", item_type.replace("_", " ").title()
                )

                section_lines = [f"## {display_name}"]

                for key, value in content.items():
                    if value is not None and value != "" and value != []:
                        # Format the key nicely
                        label = key.replace("_", " ").title()

                        if isinstance(value, list):
                            section_lines.append(f"\n**{label}:**")
                            for val in value:
                                section_lines.append(f"- {val}")
                        elif isinstance(value, dict) and "url" in value:
                            # Resolved asset
                            section_lines.append(
                                f"**{label}:** [Asset: {value.get('file_name', 'file')}]"
                            )
                        else:
                            section_lines.append(f"**{label}:** {value}")

                sections.append("\n".join(section_lines))

        if not sections:
            return "No context available."

        return "\n\n".join(sections)

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary for JSON serialization."""
        return {
            "items": self.items,
            "missing_types": self.missing_types,
            "stale_types": self.stale_types,
            "completeness": self.completeness,
            "provisioned_at": self.provisioned_at.isoformat(),
            "is_complete": self.is_complete,
            "has_stale_content": self.has_stale_content,
            # Aliases for backward compat
            "entries": self.items,
            "missing_roles": self.missing_types,
            "stale_roles": self.stale_types,
        }


class ContextProvisioner:
    """
    Service for provisioning structured context to recipes/agents.

    This is the canonical way for agents to receive context items.
    It handles:
    - Bulk fetching of required context types
    - Asset reference resolution (optional)
    - Staleness detection for working tier items with TTL
    - Completeness tracking per type
    """

    def __init__(self):
        if not supabase:
            raise RuntimeError("Supabase client required for context provisioning")

    async def provision_context(
        self,
        basket_id: str,
        required_types: List[str],
        resolve_assets: bool = False,
        check_staleness: bool = True,
        tiers: Optional[List[str]] = None,
    ) -> ContextProvisionResult:
        """
        Provision context items for recipe execution.

        Args:
            basket_id: Target basket UUID
            required_types: List of item types to fetch
            resolve_assets: Whether to resolve asset:// references to URLs
            check_staleness: Whether to check for stale items
            tiers: Optional tier filter (foundation, working, ephemeral)

        Returns:
            ContextProvisionResult with items, missing types, and metadata
        """
        logger.info(
            f"[ContextProvisioner] Provisioning context for basket={basket_id}, "
            f"types={required_types}"
        )

        try:
            # Fetch items with schema info
            query = (
                supabase.table("context_items")
                .select("*, context_entry_schemas(field_schema, display_name, icon, category)")
                .eq("basket_id", basket_id)
                .in_("item_type", required_types)
                .eq("status", "active")
            )

            if tiers:
                query = query.in_("tier", tiers)

            result = query.execute()

            items: Dict[str, Dict[str, Any]] = {}
            completeness: Dict[str, float] = {}
            stale_types: List[str] = []

            for item in result.data or []:
                item_type = item["item_type"]
                schema_info = item.pop("context_entry_schemas", {}) or {}

                # Add schema info to item
                item["schema_display_name"] = schema_info.get("display_name")
                item["schema_icon"] = schema_info.get("icon")
                item["schema_category"] = schema_info.get("category")

                # Track completeness
                completeness[item_type] = item.get("completeness_score", 0.0)

                # Check staleness for working tier items with TTL
                if check_staleness and item.get("tier") == "working":
                    field_schema = schema_info.get("field_schema", {})
                    refresh_ttl_hours = field_schema.get("refresh_ttl_hours")

                    if refresh_ttl_hours:
                        updated_at = item.get("updated_at")
                        if updated_at:
                            try:
                                if isinstance(updated_at, str):
                                    updated = datetime.fromisoformat(
                                        updated_at.replace("Z", "+00:00")
                                    )
                                else:
                                    updated = updated_at

                                age_hours = (
                                    datetime.now(timezone.utc) - updated
                                ).total_seconds() / 3600
                                if age_hours > refresh_ttl_hours:
                                    stale_types.append(item_type)
                            except Exception as e:
                                logger.warning(
                                    f"Failed to check staleness for {item_type}: {e}"
                                )

                # Resolve assets if requested
                if resolve_assets:
                    content = item.get("content", {})
                    item["content"] = await self._resolve_assets(content, schema_info)

                items[item_type] = item

            # Determine missing types
            missing_types = [t for t in required_types if t not in items]

            if missing_types:
                logger.info(
                    f"[ContextProvisioner] Missing types for basket={basket_id}: {missing_types}"
                )

            return ContextProvisionResult(
                items=items,
                missing_types=missing_types,
                stale_types=stale_types,
                completeness=completeness,
            )

        except Exception as e:
            logger.error(f"[ContextProvisioner] Failed to provision context: {e}")
            raise

    async def _resolve_assets(
        self, content: Dict[str, Any], schema_info: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Resolve asset:// references to actual asset info with URLs."""
        field_schema = schema_info.get("field_schema", {})
        asset_fields = {
            f.get("key"): f
            for f in field_schema.get("fields", [])
            if f.get("type") == "asset"
        }

        resolved = {}

        for key, value in content.items():
            if (
                key in asset_fields
                and isinstance(value, str)
                and value.startswith("asset://")
            ):
                asset_id = value.replace("asset://", "")

                try:
                    asset_result = (
                        supabase.table("reference_assets")
                        .select("id, file_name, mime_type, storage_path")
                        .eq("id", asset_id)
                        .single()
                        .execute()
                    )

                    if asset_result.data:
                        storage_path = asset_result.data["storage_path"]
                        signed_url_result = supabase.storage.from_(
                            "yarnnn-assets"
                        ).create_signed_url(storage_path, 3600)

                        resolved[key] = {
                            "asset_id": asset_id,
                            "file_name": asset_result.data.get("file_name"),
                            "mime_type": asset_result.data.get("mime_type"),
                            "url": (
                                signed_url_result.get("signedURL")
                                if signed_url_result
                                else None
                            ),
                        }
                    else:
                        resolved[key] = None
                except Exception as e:
                    logger.warning(f"Failed to resolve asset {asset_id}: {e}")
                    resolved[key] = None
            else:
                resolved[key] = value

        return resolved

    async def get_foundation_context(
        self, basket_id: str, resolve_assets: bool = False
    ) -> ContextProvisionResult:
        """
        Convenience method to fetch all foundation context.

        Foundation types: problem, customer, vision, brand
        """
        return await self.provision_context(
            basket_id=basket_id,
            required_types=["problem", "customer", "vision", "brand"],
            resolve_assets=resolve_assets,
            check_staleness=False,
            tiers=["foundation"],
        )

    async def get_recipe_context(
        self,
        basket_id: str,
        recipe_context_types: Optional[List[str]] = None,
        include_foundation: bool = True,
        resolve_assets: bool = False,
        # Backward-compatible alias
        recipe_context_roles: Optional[List[str]] = None,
    ) -> ContextProvisionResult:
        """
        Fetch context for a specific recipe execution.

        Args:
            basket_id: Target basket
            recipe_context_types: Types required by the recipe
            include_foundation: Also fetch foundation types
            resolve_assets: Resolve asset references
            recipe_context_roles: Alias for recipe_context_types (backward compat)

        Returns:
            Combined context for recipe execution
        """
        # Support both parameter names for backward compatibility
        context_types = recipe_context_types or recipe_context_roles or []
        types = list(context_types)

        if include_foundation:
            foundation = ["problem", "customer", "vision", "brand"]
            types = list(set(types + foundation))

        return await self.provision_context(
            basket_id=basket_id,
            required_types=types,
            resolve_assets=resolve_assets,
            check_staleness=True,
        )


# Global instance
context_provisioner = ContextProvisioner()
