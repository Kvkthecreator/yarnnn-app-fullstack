"""
Context Provisioner - Fetch structured context for recipe execution.

This service provides context entries to agents/recipes before execution.
It bridges the gap between context_entries table and agent prompt construction.

Canon Compliance:
- Context entries are CONSUMED, not created by this service
- Agents receive pre-fetched context for prompts
- Staleness/freshness is tracked but not enforced here

Usage:
    from services.context_provisioner import ContextProvisioner

    provisioner = ContextProvisioner()
    context = await provisioner.provision_context(
        basket_id="...",
        required_roles=["problem", "customer", "vision"],
        resolve_assets=True
    )

See: /docs/architecture/ADR_CONTEXT_ENTRIES.md
"""

import logging
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
from uuid import UUID

from infra.utils.supabase_client import supabase_admin_client as supabase

logger = logging.getLogger(__name__)


class ContextProvisionResult:
    """Result of context provisioning for recipe execution."""

    def __init__(
        self,
        entries: Dict[str, Dict[str, Any]],
        missing_roles: List[str],
        stale_roles: List[str],
        completeness: Dict[str, float],
    ):
        self.entries = entries
        self.missing_roles = missing_roles
        self.stale_roles = stale_roles
        self.completeness = completeness
        self.provisioned_at = datetime.now(timezone.utc)

    @property
    def is_complete(self) -> bool:
        """True if all required roles are present and complete."""
        return len(self.missing_roles) == 0

    @property
    def has_stale_content(self) -> bool:
        """True if any roles have stale content needing refresh."""
        return len(self.stale_roles) > 0

    def get_entry(self, anchor_role: str) -> Optional[Dict[str, Any]]:
        """Get entry data for a specific anchor role."""
        return self.entries.get(anchor_role)

    def to_prompt_context(self, roles: Optional[List[str]] = None) -> str:
        """
        Format context entries for LLM prompt injection.

        Args:
            roles: Specific roles to include (default: all)

        Returns:
            Formatted string suitable for LLM prompt
        """
        target_roles = roles or list(self.entries.keys())
        sections = []

        for role in target_roles:
            entry = self.entries.get(role)
            if entry:
                data = entry.get("data", {})
                display_name = entry.get("display_name") or entry.get(
                    "schema_display_name", role.replace("_", " ").title()
                )

                section_lines = [f"## {display_name}"]

                for key, value in data.items():
                    if value is not None and value != "" and value != []:
                        # Format the key nicely
                        label = key.replace("_", " ").title()

                        if isinstance(value, list):
                            section_lines.append(f"\n**{label}:**")
                            for item in value:
                                section_lines.append(f"- {item}")
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
            "entries": self.entries,
            "missing_roles": self.missing_roles,
            "stale_roles": self.stale_roles,
            "completeness": self.completeness,
            "provisioned_at": self.provisioned_at.isoformat(),
            "is_complete": self.is_complete,
            "has_stale_content": self.has_stale_content,
        }


class ContextProvisioner:
    """
    Service for provisioning structured context to recipes/agents.

    This is the canonical way for agents to receive context entries.
    It handles:
    - Bulk fetching of required context roles
    - Asset reference resolution (optional)
    - Staleness detection for insight roles
    - Completeness tracking per role
    """

    def __init__(self):
        if not supabase:
            raise RuntimeError("Supabase client required for context provisioning")

    async def provision_context(
        self,
        basket_id: str,
        required_roles: List[str],
        resolve_assets: bool = False,
        check_staleness: bool = True,
    ) -> ContextProvisionResult:
        """
        Provision context entries for recipe execution.

        Args:
            basket_id: Target basket UUID
            required_roles: List of anchor roles to fetch
            resolve_assets: Whether to resolve asset:// references to URLs
            check_staleness: Whether to check for stale insight entries

        Returns:
            ContextProvisionResult with entries, missing roles, and metadata
        """
        logger.info(
            f"[ContextProvisioner] Provisioning context for basket={basket_id}, "
            f"roles={required_roles}"
        )

        try:
            # Fetch entries with schema info
            result = (
                supabase.table("context_entries")
                .select("*, context_entry_schemas(field_schema, display_name, icon, category)")
                .eq("basket_id", basket_id)
                .in_("anchor_role", required_roles)
                .eq("state", "active")
                .execute()
            )

            entries: Dict[str, Dict[str, Any]] = {}
            completeness: Dict[str, float] = {}
            stale_roles: List[str] = []

            for entry in result.data or []:
                anchor_role = entry["anchor_role"]
                schema_info = entry.pop("context_entry_schemas", {}) or {}

                # Add schema info to entry
                entry["schema_display_name"] = schema_info.get("display_name")
                entry["schema_icon"] = schema_info.get("icon")
                entry["schema_category"] = schema_info.get("category")

                # Track completeness
                completeness[anchor_role] = entry.get("completeness_score", 0.0)

                # Check staleness for insight roles
                if check_staleness and schema_info.get("category") == "insight":
                    field_schema = schema_info.get("field_schema", {})
                    refresh_ttl_hours = field_schema.get("refresh_ttl_hours")

                    if refresh_ttl_hours:
                        updated_at = entry.get("updated_at")
                        if updated_at:
                            try:
                                # Parse ISO timestamp
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
                                    stale_roles.append(anchor_role)
                            except Exception as e:
                                logger.warning(
                                    f"Failed to check staleness for {anchor_role}: {e}"
                                )

                # Resolve assets if requested
                if resolve_assets:
                    data = entry.get("data", {})
                    entry["data"] = await self._resolve_assets(data, schema_info)

                entries[anchor_role] = entry

            # Determine missing roles
            missing_roles = [r for r in required_roles if r not in entries]

            if missing_roles:
                logger.info(
                    f"[ContextProvisioner] Missing roles for basket={basket_id}: {missing_roles}"
                )

            return ContextProvisionResult(
                entries=entries,
                missing_roles=missing_roles,
                stale_roles=stale_roles,
                completeness=completeness,
            )

        except Exception as e:
            logger.error(f"[ContextProvisioner] Failed to provision context: {e}")
            raise

    async def _resolve_assets(
        self, data: Dict[str, Any], schema_info: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Resolve asset:// references to actual asset info with URLs."""
        field_schema = schema_info.get("field_schema", {})
        asset_fields = {
            f.get("key"): f
            for f in field_schema.get("fields", [])
            if f.get("type") == "asset"
        }

        resolved = {}

        for key, value in data.items():
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

        Foundation roles: problem, customer, vision, brand
        """
        return await self.provision_context(
            basket_id=basket_id,
            required_roles=["problem", "customer", "vision", "brand"],
            resolve_assets=resolve_assets,
            check_staleness=False,  # Foundation context doesn't go stale
        )

    async def get_recipe_context(
        self,
        basket_id: str,
        recipe_context_roles: List[str],
        include_foundation: bool = True,
        resolve_assets: bool = False,
    ) -> ContextProvisionResult:
        """
        Fetch context for a specific recipe execution.

        Args:
            basket_id: Target basket
            recipe_context_roles: Roles required by the recipe
            include_foundation: Also fetch foundation roles
            resolve_assets: Resolve asset references

        Returns:
            Combined context for recipe execution
        """
        roles = list(recipe_context_roles)

        if include_foundation:
            foundation = ["problem", "customer", "vision", "brand"]
            roles = list(set(roles + foundation))

        return await self.provision_context(
            basket_id=basket_id,
            required_roles=roles,
            resolve_assets=resolve_assets,
            check_staleness=True,
        )


# Global instance
context_provisioner = ContextProvisioner()
