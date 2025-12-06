"""
Base Agent - Shared agent execution logic

First-principled design:
- Work-oriented context (project, request, ticket)
- Direct Anthropic API via AnthropicDirectClient
- Tool execution via substrate-API HTTP
- Streaming support for frontend progress updates
- No conversation history persistence

Usage:
    from agents.base_agent import BaseAgent

    class ResearchAgent(BaseAgent):
        AGENT_TYPE = "research"
        SYSTEM_PROMPT = "You are a research agent..."

        async def execute(self, task: str) -> ExecutionResult:
            context = await self._build_context()
            return await self._execute_with_context(task, context)
"""

from __future__ import annotations

import logging
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any, AsyncGenerator, Dict, List, Optional

from clients.anthropic_client import AnthropicDirectClient, ExecutionResult
from adapters.substrate_adapter import SubstrateQueryAdapter

logger = logging.getLogger(__name__)


@dataclass
class AgentContext:
    """
    Work-oriented context for agent execution.

    First-principled: No conversation history, just work context.

    Note: As of Dec 2025, `knowledge_context` replaces the legacy `substrate_blocks`
    terminology to align with the unified context_items architecture.
    """
    basket_id: str
    workspace_id: str
    work_ticket_id: str
    user_id: str

    # Work metadata
    task: str
    agent_type: str
    priority: str = "medium"

    # Reference assets (documents, screenshots, etc.)
    reference_assets: List[Dict[str, Any]] = field(default_factory=list)

    # Prior work outputs (for context, not duplication)
    prior_outputs: List[Dict[str, Any]] = field(default_factory=list)

    # Knowledge context (queried on-demand from substrate/context_items)
    # Replaces legacy "substrate_blocks" - now supports multi-modal context items
    knowledge_context: List[Dict[str, Any]] = field(default_factory=list)

    # Agent config (from agent_sessions or defaults)
    agent_config: Dict[str, Any] = field(default_factory=dict)

    # User JWT for substrate-API auth
    user_jwt: Optional[str] = None


class BaseAgent(ABC):
    """
    Base class for all agents.

    Subclasses must define:
    - AGENT_TYPE: str (e.g., "research", "content", "reporting")
    - SYSTEM_PROMPT: str (base system prompt for the agent)
    - execute(): Main execution method
    """

    AGENT_TYPE: str = "base"
    SYSTEM_PROMPT: str = ""

    def __init__(
        self,
        basket_id: str,
        workspace_id: str,
        work_ticket_id: str,
        user_id: str,
        user_jwt: Optional[str] = None,
        model: str = "claude-sonnet-4-20250514",
    ):
        """
        Initialize base agent.

        Args:
            basket_id: Basket ID for substrate context
            workspace_id: Workspace ID for authorization
            work_ticket_id: Work ticket ID for output tracking
            user_id: User ID for audit trail
            user_jwt: User JWT for substrate-API auth
            model: Claude model to use
        """
        self.basket_id = basket_id
        self.workspace_id = workspace_id
        self.work_ticket_id = work_ticket_id
        self.user_id = user_id
        self.user_jwt = user_jwt
        self.model = model

        # Initialize Anthropic client
        self.client = AnthropicDirectClient(model=model)

        # Initialize substrate adapter
        self.substrate = SubstrateQueryAdapter(
            basket_id=basket_id,
            workspace_id=workspace_id,
            user_token=user_jwt,
            agent_type=self.AGENT_TYPE,
            work_ticket_id=work_ticket_id,
        )

        logger.info(
            f"{self.__class__.__name__} initialized: basket={basket_id}, "
            f"ticket={work_ticket_id}, model={model}"
        )

    async def _load_prior_outputs(self, limit: int = 50) -> List[Dict[str, Any]]:
        """
        Load prior approved work outputs for this basket/agent.

        Args:
            limit: Maximum outputs to load

        Returns:
            List of prior work output summaries
        """
        from app.utils.supabase_client import supabase_admin_client as supabase

        try:
            response = supabase.table("work_outputs").select(
                "id, title, output_type, body, confidence, created_at"
            ).eq("basket_id", self.basket_id).eq(
                "agent_type", self.AGENT_TYPE
            ).eq("supervision_status", "approved").order(
                "created_at", desc=True
            ).limit(limit).execute()

            prior_outputs = response.data or []
            logger.info(f"Loaded {len(prior_outputs)} prior outputs")
            return prior_outputs

        except Exception as e:
            logger.warning(f"Failed to load prior outputs: {e}")
            return []

    async def _load_reference_assets(self) -> List[Dict[str, Any]]:
        """
        Load reference assets (documents, screenshots) for this basket.

        Returns:
            List of asset metadata with signed URLs
        """
        try:
            return self.substrate.client.get_reference_assets(
                basket_id=self.basket_id,
                agent_type=self.AGENT_TYPE,
                work_ticket_id=self.work_ticket_id,
            )
        except Exception as e:
            logger.warning(f"Failed to load reference assets: {e}")
            return []

    async def _query_knowledge_context(self, query: str, limit: int = 10) -> List[Dict[str, Any]]:
        """
        Query substrate/context_items for relevant knowledge context.

        Args:
            query: Semantic query string
            limit: Maximum results

        Returns:
            List of knowledge context items as dicts
        """
        try:
            contexts = await self.substrate.query(query, limit=limit)
            items = []
            for ctx in contexts:
                if ctx.content and ctx.content != "[AGENT EXECUTION CONTEXT]":
                    items.append({
                        "id": ctx.metadata.get("id"),
                        "content": ctx.content,
                        "item_type": ctx.metadata.get("semantic_type"),  # Renamed for clarity
                        "confidence": ctx.metadata.get("confidence"),
                    })
            logger.info(f"Queried knowledge context: {len(items)} relevant items")
            return items
        except Exception as e:
            logger.warning(f"Knowledge context query failed: {e}")
            return []

    async def _build_context(
        self,
        task: str,
        include_prior_outputs: bool = True,
        include_assets: bool = True,
        knowledge_query: Optional[str] = None,
    ) -> AgentContext:
        """
        Build work-oriented context for agent execution.

        Args:
            task: Task description
            include_prior_outputs: Whether to load prior outputs
            include_assets: Whether to load reference assets
            knowledge_query: Optional query for knowledge context (substrate/context_items)

        Returns:
            AgentContext with all loaded context
        """
        # Load prior outputs (avoid duplication)
        prior_outputs = []
        if include_prior_outputs:
            prior_outputs = await self._load_prior_outputs()

        # Load reference assets
        reference_assets = []
        if include_assets:
            reference_assets = await self._load_reference_assets()

        # Query knowledge context for task-relevant items
        knowledge_context = []
        if knowledge_query:
            knowledge_context = await self._query_knowledge_context(knowledge_query)

        return AgentContext(
            basket_id=self.basket_id,
            workspace_id=self.workspace_id,
            work_ticket_id=self.work_ticket_id,
            user_id=self.user_id,
            task=task,
            agent_type=self.AGENT_TYPE,
            reference_assets=reference_assets,
            prior_outputs=prior_outputs,
            knowledge_context=knowledge_context,
            user_jwt=self.user_jwt,
        )

    def _build_system_prompt(self, context: AgentContext) -> str:
        """
        Build full system prompt with context.

        Subclasses can override to customize prompt construction.

        Args:
            context: Agent context

        Returns:
            Full system prompt string
        """
        prompt_parts = [self.SYSTEM_PROMPT]

        # Add reference assets context
        if context.reference_assets:
            assets_text = "\n".join([
                f"- {a.get('title', 'Untitled')} ({a.get('asset_type', 'document')})"
                for a in context.reference_assets[:10]
            ])
            prompt_parts.append(f"""
## Reference Assets
You have access to these reference materials:
{assets_text}
""")

        # Add prior outputs context (avoid duplication)
        if context.prior_outputs:
            outputs_text = "\n".join([
                f"- {o.get('title', 'Untitled')} ({o.get('output_type', 'finding')})"
                for o in context.prior_outputs[:5]
            ])
            prompt_parts.append(f"""
## Prior Work
Previous research/outputs for this basket (avoid duplication):
{outputs_text}
""")

        # Add knowledge context
        if context.knowledge_context:
            context_text = "\n".join([
                f"- [{item.get('id', 'unknown')[:8]}] {item.get('content', '')[:200]}..."
                for item in context.knowledge_context[:5]
            ])
            prompt_parts.append(f"""
## Knowledge Context
Relevant context from project knowledge base:
{context_text}
""")

        return "\n\n".join(prompt_parts)

    def _get_tool_context(self) -> Dict[str, Any]:
        """
        Get tool context for emit_work_output and other tools.

        Returns:
            Tool context dict
        """
        return {
            "basket_id": self.basket_id,
            "work_ticket_id": self.work_ticket_id,
            "agent_type": self.AGENT_TYPE,
            "user_jwt": self.user_jwt,
        }

    async def _execute_with_context(
        self,
        user_message: str,
        context: AgentContext,
        tools: Optional[List[str]] = None,
    ) -> ExecutionResult:
        """
        Execute agent with assembled context.

        Args:
            user_message: User message (task)
            context: Assembled agent context
            tools: List of tool names to enable

        Returns:
            ExecutionResult from AnthropicDirectClient
        """
        tools = tools or ["emit_work_output"]

        system_prompt = self._build_system_prompt(context)
        tool_context = self._get_tool_context()

        logger.info(
            f"[EXECUTE] {self.AGENT_TYPE}: "
            f"system_prompt={len(system_prompt)} chars, "
            f"user_message={len(user_message)} chars, "
            f"tools={tools}"
        )

        result = await self.client.execute(
            system_prompt=system_prompt,
            user_message=user_message,
            tools=tools,
            tool_context=tool_context,
        )

        logger.info(
            f"[EXECUTE] Complete: "
            f"outputs={len(result.work_outputs)}, "
            f"tool_calls={len(result.tool_calls)}, "
            f"tokens={result.input_tokens}+{result.output_tokens}"
        )

        return result

    async def execute_streaming(
        self,
        user_message: str,
        context: AgentContext,
        tools: Optional[List[str]] = None,
    ) -> AsyncGenerator[Dict[str, Any], None]:
        """
        Execute agent with streaming response.

        Args:
            user_message: User message (task)
            context: Assembled agent context
            tools: List of tool names to enable

        Yields:
            Streaming events from AnthropicDirectClient
        """
        tools = tools or ["emit_work_output"]

        system_prompt = self._build_system_prompt(context)
        tool_context = self._get_tool_context()

        async for event in self.client.execute_streaming(
            system_prompt=system_prompt,
            user_message=user_message,
            tools=tools,
            tool_context=tool_context,
        ):
            yield event

    @abstractmethod
    async def execute(self, task: str, **kwargs) -> ExecutionResult:
        """
        Execute the agent task.

        Subclasses must implement this method.

        Args:
            task: Task description
            **kwargs: Additional task-specific parameters

        Returns:
            ExecutionResult with response, outputs, and token usage
        """
        pass
