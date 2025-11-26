"""
Substrate Query Adapter: On-demand substrate access for agents.

Architecture (2025-11):
- Agents query substrate ON-DEMAND via SubstrateQueryAdapter.query()
- No pre-loading of substrate context into WorkBundle
- Lazy loading = token efficiency + agent autonomy

Flow:
Agent execution → substrate.query("brand voice examples") → substrate_client → substrate-api
"""

from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional
from uuid import UUID

# Import YARNNN agent interfaces (internalized SDK)
try:
    from shared.interfaces import MemoryProvider, Context
except ImportError:
    # Fallback if interfaces not available yet
    class MemoryProvider:
        pass

    class Context:
        def __init__(self, content: str, metadata: Optional[Dict[str, Any]] = None):
            self.content = content
            self.metadata = metadata or {}

# Import our Phase 3 substrate_client
from clients.substrate_client import get_substrate_client

logger = logging.getLogger(__name__)


class SubstrateQueryAdapter(MemoryProvider):
    """
    On-demand substrate query adapter for YARNNN agents.

    Implements SDK's MemoryProvider interface using substrate_client HTTP calls.

    All substrate operations go through HTTP (Phase 3 BFF pattern):
    - Query → get_basket_blocks()
    - Store → create_dump()
    - Get all → get_basket_blocks(limit=large)

    Phase 1+2 Enhancement:
    - Injects reference_assets into Context.metadata
    - Injects agent_config into Context.metadata
    - Provides enhanced context for agent execution

    This ensures:
    - Zero direct database access in work-platform ✅
    - Circuit breaker and retry logic preserved ✅
    - Service-to-service auth respected ✅
    """

    def __init__(
        self,
        basket_id: str | UUID,
        workspace_id: str,
        user_token: Optional[str] = None,  # User JWT token for substrate-API auth
        agent_type: Optional[str] = None,
        project_id: Optional[str] = None,
        work_ticket_id: Optional[str] = None
    ):
        """
        Initialize substrate query adapter with agent execution context.

        Args:
            basket_id: Basket ID to operate on
            workspace_id: Workspace ID for authorization context
            user_token: User JWT token for substrate-API authentication
            agent_type: Agent type for scoping assets ('research', 'content', 'reporting')
            project_id: Project ID for fetching agent config
            work_ticket_id: Work session ID for temporary assets
        """
        self.basket_id = str(basket_id)
        self.workspace_id = workspace_id
        self.user_token = user_token
        self.agent_type = agent_type
        self.project_id = project_id
        self.work_ticket_id = work_ticket_id

        # Create client with user token if provided, otherwise use singleton
        from clients.substrate_client import SubstrateClient
        self.client = SubstrateClient(user_token=user_token) if user_token else get_substrate_client()

        # Cache for assets + config (fetch once per session)
        self._assets_cache: Optional[List[Dict]] = None
        self._config_cache: Optional[Dict] = None

        logger.info(
            f"Initialized SubstrateQueryAdapter for basket {self.basket_id}, "
            f"agent_type={agent_type}, project_id={project_id}"
        )

    async def _get_reference_assets(self) -> List[Dict]:
        """
        Fetch and cache reference assets scoped to agent.

        Returns:
            List of asset dictionaries with signed URLs
        """
        if self._assets_cache is not None:
            return self._assets_cache

        if not self.agent_type:
            logger.debug("No agent_type specified, skipping asset fetch")
            self._assets_cache = []
            return []

        try:
            self._assets_cache = self.client.get_reference_assets(
                basket_id=self.basket_id,
                agent_type=self.agent_type,
                work_ticket_id=self.work_ticket_id,
                permanence="permanent"  # Only permanent assets for now
            )
            logger.info(
                f"Loaded {len(self._assets_cache)} reference assets for {self.agent_type} agent"
            )
            return self._assets_cache
        except Exception as e:
            logger.warning(f"Failed to load reference assets: {e}")
            self._assets_cache = []
            return []

    async def _get_agent_config(self) -> Dict[str, Any]:
        """
        Fetch and cache agent config from work-platform DB.

        Returns:
            Agent config dictionary
        """
        if self._config_cache is not None:
            return self._config_cache

        if not self.agent_type:
            logger.debug("No agent_type, skipping config fetch")
            self._config_cache = {}
            return {}

        try:
            # Query work-platform DB via supabase_admin_client
            from app.utils.supabase_client import supabase_admin_client

            # Determine basket_id for query
            basket_id = self.basket_id

            # If we only have project_id, fetch basket_id from projects table
            if not basket_id and self.project_id:
                project_response = supabase_admin_client.table("projects").select(
                    "basket_id"
                ).eq("id", self.project_id).limit(1).execute()

                if project_response.data and len(project_response.data) > 0:
                    basket_id = project_response.data[0].get("basket_id")

            if not basket_id:
                logger.debug("No basket_id available, skipping config fetch")
                self._config_cache = {}
                return {}

            # Query agent_sessions for state/metadata (config was removed in Phase 2e)
            response = supabase_admin_client.table("agent_sessions").select(
                "state, metadata"
            ).eq("basket_id", basket_id).eq(
                "agent_type", self.agent_type
            ).limit(1).execute()

            if response.data and len(response.data) > 0:
                # Merge state and metadata as config replacement
                state = response.data[0].get("state", {})
                metadata = response.data[0].get("metadata", {})
                self._config_cache = {**state, **metadata}

                if self._config_cache:
                    logger.info(f"Loaded state/metadata for {self.agent_type} agent")
            else:
                logger.debug(f"No active {self.agent_type} agent session found")
                self._config_cache = {}

            return self._config_cache

        except Exception as e:
            logger.warning(f"Failed to load agent session state: {e}")
            self._config_cache = {}
            return {}

    async def query(
        self,
        query: str,
        filters: Optional[Dict[str, Any]] = None,
        limit: int = 20
    ) -> List[Context]:
        """
        Query substrate for relevant context via HTTP.

        Phase 1+2 Enhancement:
        - Returns blocks as Context objects
        - Injects reference_assets into first Context.metadata
        - Injects agent_config into first Context.metadata

        Args:
            query: Semantic query string (currently unused - TODO: add semantic search)
            filters: Optional filters (states, semantic_type, etc.)
            limit: Maximum results to return

        Returns:
            List of Context items (first item contains assets + config in metadata)
        """
        logger.info(f"Querying substrate: query='{query[:50]}...', limit={limit}")

        try:
            # Extract filter parameters
            states = filters.get("states") if filters else None
            if not states:
                # Default to mature blocks
                states = ["ACCEPTED", "LOCKED"]

            # Call substrate-api via HTTP (Phase 3 BFF)
            blocks = self.client.get_basket_blocks(
                basket_id=self.basket_id,
                states=states,
                limit=limit
            )

            # Convert substrate blocks to SDK Context format
            contexts = [self._block_to_context(block) for block in blocks]

            # Phase 1+2: Inject assets + config into first context metadata
            if contexts or (self.agent_type and self.project_id):
                # Fetch assets + config
                assets = await self._get_reference_assets()
                config = await self._get_agent_config()

                # Create metadata context if we have assets or config
                if assets or config:
                    metadata = {}
                    if assets:
                        metadata["reference_assets"] = assets
                        logger.info(f"Injected {len(assets)} reference assets into context")
                    if config:
                        metadata["agent_config"] = config
                        logger.info("Injected agent config into context")

                    # Create metadata context as first item
                    metadata_context = Context(
                        content="[AGENT EXECUTION CONTEXT]",
                        metadata=metadata
                    )
                    contexts.insert(0, metadata_context)

            logger.debug(f"Retrieved {len(contexts)} context items from substrate")
            return contexts

        except Exception as e:
            # Graceful degradation: substrate-api not available
            # Return empty context so agent can still execute
            logger.warning(
                f"Substrate-api unavailable, returning empty context. "
                f"Agent will execute without substrate context. Error: {str(e)}"
            )
            return []

    async def store(self, context: Context) -> str:
        """
        Store context in substrate via HTTP.

        Args:
            context: Context object to store

        Returns:
            ID of created dump/block
        """
        logger.info("Storing context in substrate")

        # Call substrate-api via HTTP (Phase 3 BFF)
        result = self.client.create_dump(
            basket_id=self.basket_id,
            content=context.content,
            metadata=context.metadata or {}
        )

        dump_id = result.get("id") or result.get("dump_id")
        logger.debug(f"Stored context as dump {dump_id}")

        return dump_id

    async def get_all(
        self,
        filters: Optional[Dict[str, Any]] = None
    ) -> List[Context]:
        """
        Get all context items from substrate.

        Args:
            filters: Optional filters

        Returns:
            List of all Context items
        """
        logger.info("Retrieving all context items from substrate")

        # Use query with large limit
        return await self.query("", filters=filters, limit=10000)

    def _block_to_context(self, block: dict) -> Context:
        """
        Convert substrate block to SDK Context format.

        Args:
            block: Substrate block dictionary

        Returns:
            Context object
        """
        # Format block content for agent consumption
        title = block.get("title", "")
        body = block.get("body", "")
        content = f"{title}\n\n{body}".strip() if title else body

        # Preserve substrate metadata
        metadata = {
            "id": block.get("id"),
            "block_id": block.get("id"),
            "semantic_type": block.get("semantic_type"),
            "state": block.get("state"),
            "anchor_role": block.get("anchor_role"),
            "confidence": block.get("confidence"),
            "created_at": block.get("created_at"),
        }

        return Context(content=content, metadata=metadata)

    def _context_to_block_data(self, context: Context) -> dict:
        """
        Convert SDK Context to substrate block creation data.

        Args:
            context: Context object

        Returns:
            Dictionary for block creation
        """
        # Extract title from content (first line if multi-line)
        lines = context.content.split("\n", 1)
        title = lines[0][:200] if lines else "Agent Finding"
        body = lines[1] if len(lines) > 1 else context.content

        return {
            "title": title,
            "body": body,
            "semantic_type": context.metadata.get("semantic_type", "knowledge"),
            "state": context.metadata.get("state", "mature"),
            "confidence": context.metadata.get("confidence", 0.7),
        }
