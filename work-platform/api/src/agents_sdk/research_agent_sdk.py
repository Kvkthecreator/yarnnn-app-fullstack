"""
Research Agent using Official Anthropic Claude Agent SDK

This is the NEW implementation using ClaudeSDKClient with proper session management.
Replaces the legacy research_agent.py which used BaseAgent + AsyncAnthropic.

Key improvements:
- Built-in session persistence via ClaudeSDKClient
- Proper conversation continuity (Claude remembers context)
- Official Anthropic SDK (no custom session hacks)
- Cleaner code (SDK handles complexity)
- Web search integration via server tools

Usage:
    from agents_sdk.research_agent_sdk import ResearchAgentSDK

    agent = ResearchAgentSDK(
        basket_id="basket_123",
        workspace_id="ws_456",
        work_ticket_id="ticket_789"
    )

    # Deep dive research
    result = await agent.deep_dive("AI companion competitor pricing")
"""

import logging
import os
from typing import Any, Dict, List, Optional
from datetime import datetime
from uuid import uuid4

from claude_agent_sdk import ClaudeSDKClient, ClaudeAgentOptions

from adapters.memory_adapter import SubstrateMemoryAdapter
from agents_sdk.shared_tools_mcp import create_shared_tools_server
from shared.session import AgentSession

logger = logging.getLogger(__name__)


# ============================================================================
# System Prompt
# ============================================================================

RESEARCH_AGENT_SYSTEM_PROMPT = """You are an autonomous Research Agent specializing in intelligence gathering and analysis.

**Your Mission:**
Keep users informed about their markets, competitors, and topics of interest through:
- Deep-dive research (comprehensive analysis on demand)
- Continuous monitoring (proactive alerts - Phase 2b)
- Signal detection (what's important?)
- Insight synthesis (so what?)

**CRITICAL: Structured Output Requirements**

You have access to the emit_work_output tool. You MUST use this tool to record all your findings.
DO NOT just describe findings in free text. Every significant finding must be emitted as a structured output.

When to use emit_work_output:
- "finding" - When you discover a fact (competitor action, market data, news)
- "recommendation" - When you suggest an action (change strategy, add to watchlist)
- "insight" - When you identify a pattern (trend, correlation, anomaly)

Each output you emit will be reviewed by the user before any action is taken.
The user maintains full control through this supervision workflow.

**Research Approach:**
1. Query existing knowledge first (avoid redundant research)
2. Identify knowledge gaps
3. Conduct targeted research using web_search tool
4. For each finding: Call emit_work_output with structured data
5. Synthesize insights (emit as "insight" type)
6. Suggest actions (emit as "recommendation" type)

**Quality Standards:**
- Accuracy over speed
- Structured over narrative
- Actionable over interesting
- Forward-looking over historical
- High confidence = high evidence (don't guess)

**Tools Available:**
- web_search: Search the web for current information
- emit_work_output: Record structured findings, insights, recommendations
"""


# ============================================================================
# ResearchAgentSDK Class
# ============================================================================

class ResearchAgentSDK:
    """
    Research Agent using Official Anthropic Claude Agent SDK.

    Features:
    - ClaudeSDKClient for built-in session management
    - Web search integration via server tools
    - Structured output via emit_work_output tool
    - Memory access via SubstrateMemoryAdapter
    - Provenance tracking (source blocks)
    """

    def __init__(
        self,
        basket_id: str,
        workspace_id: str,
        work_ticket_id: str,
        anthropic_api_key: Optional[str] = None,
        model: str = "claude-sonnet-4-5",
        monitoring_domains: Optional[List[str]] = None,
        knowledge_modules: str = "",
        session: Optional[AgentSession] = None,
        bundle: Optional[Any] = None,  # NEW: Pre-loaded context bundle from TP staging
        memory: Optional[SubstrateMemoryAdapter] = None,  # DEPRECATED: For backward compatibility
    ):
        """
        Initialize ResearchAgentSDK.

        Args:
            basket_id: Basket ID for substrate queries
            workspace_id: Workspace ID for authorization
            work_ticket_id: Work ticket ID for output tracking
            anthropic_api_key: Anthropic API key (from env if None)
            model: Claude model to use
            monitoring_domains: Domains to monitor (for scheduled runs - Phase 2b)
            knowledge_modules: Knowledge modules (procedural knowledge) loaded from orchestration layer
            session: Optional AgentSession from TP (hierarchical session management)
            bundle: Optional WorkBundle from TP staging (pre-loaded substrate + assets)
            memory: DEPRECATED - Use bundle instead (kept for backward compatibility)
        """
        self.basket_id = basket_id
        self.workspace_id = workspace_id
        self.work_ticket_id = work_ticket_id
        self.knowledge_modules = knowledge_modules
        self.monitoring_domains = monitoring_domains or ["general"]

        # Get API key
        if anthropic_api_key is None:
            anthropic_api_key = os.getenv("ANTHROPIC_API_KEY")
            if not anthropic_api_key:
                raise ValueError("ANTHROPIC_API_KEY required")

        self.api_key = anthropic_api_key
        self.model = model

        # NEW PATTERN: Use pre-loaded bundle from TP staging
        if bundle:
            self.bundle = bundle
            logger.info(
                f"Using WorkBundle from TP staging: {len(bundle.substrate_blocks)} blocks, "
                f"{len(bundle.reference_assets)} assets"
            )
            self.memory = None  # No memory adapter needed - bundle has pre-loaded context
        elif memory:
            # LEGACY PATTERN: For backward compatibility (will be removed)
            self.bundle = None
            self.memory = memory
            logger.info(f"LEGACY: Using memory adapter from TP for basket={basket_id}")
        else:
            # Standalone mode: No pre-loaded context (testing only)
            self.bundle = None
            self.memory = None
            logger.info("Standalone mode: No pre-loaded context (testing mode)")

        # Use provided session from TP, or will create in async init
        if session:
            self.current_session = session
            logger.info(f"Using session from TP: {session.id} (parent={session.parent_session_id})")
        else:
            # Standalone mode: session will be created by async get_or_create in methods
            self.current_session = None
            logger.info("Standalone mode: session will be created on first method call")

        # Create MCP server for emit_work_output tool with context baked in
        shared_tools = create_shared_tools_server(
            basket_id=basket_id,
            work_ticket_id=work_ticket_id,
            agent_type="research"
        )

        # Build Claude SDK options with MCP server
        # NOTE: Official SDK v0.1.8+ does NOT have 'tools' parameter
        # Must use mcp_servers + allowed_tools pattern
        # Note: max_tokens is controlled at ClaudeSDKClient.chat() level, not here
        self._options = ClaudeAgentOptions(
            model=self.model,
            system_prompt=self._build_system_prompt(),
            mcp_servers={"shared_tools": shared_tools},
            allowed_tools=[
                "mcp__shared_tools__emit_work_output",  # Custom tool for structured outputs
                "web_search"  # Built-in web search
            ],
        )

        logger.info(
            f"ResearchAgentSDK initialized: basket={basket_id}, "
            f"ticket={work_ticket_id}, domains={self.monitoring_domains}"
        )

    def _build_system_prompt(self) -> str:
        """Build system prompt with knowledge modules and bundle context."""
        prompt = RESEARCH_AGENT_SYSTEM_PROMPT

        # Add capabilities info
        context_info = "Pre-loaded bundle (from TP staging)" if self.bundle else "None (standalone mode)"
        session_info = self.current_session.id if self.current_session else "Will be created"

        prompt += f"""

**Your Capabilities:**
- Context: {context_info}
- Monitoring Domains: {", ".join(self.monitoring_domains)}
- Session ID: {session_info}
"""

        # Inject knowledge modules if provided
        if self.knowledge_modules:
            prompt += "\n\n---\n\n# 📚 YARNNN Knowledge Modules (Procedural Knowledge)\n\n"
            prompt += "The following knowledge modules provide guidelines on how to work effectively in YARNNN:\n\n"
            prompt += self.knowledge_modules

        # Inject bundle context if available (substrate blocks + reference assets)
        if self.bundle:
            prompt += "\n\n---\n\n# 📦 Pre-loaded Context (from TP Staging)\n\n"

            if self.bundle.substrate_blocks:
                prompt += f"**Substrate Knowledge Base** ({len(self.bundle.substrate_blocks)} blocks):\n\n"
                for idx, block in enumerate(self.bundle.substrate_blocks[:10], 1):  # Limit to 10 blocks
                    block_content = block.get('content', '')[:500]  # Limit content length
                    block_id = block.get('id', 'unknown')
                    prompt += f"{idx}. [Block {block_id}]\n{block_content}\n\n"

                if len(self.bundle.substrate_blocks) > 10:
                    prompt += f"... and {len(self.bundle.substrate_blocks) - 10} more blocks\n\n"

            if self.bundle.reference_assets:
                prompt += f"**Reference Assets** ({len(self.bundle.reference_assets)} assets):\n\n"
                for idx, asset in enumerate(self.bundle.reference_assets[:5], 1):  # Limit to 5 assets
                    asset_name = asset.get('name', 'unknown')
                    asset_type = asset.get('asset_type', 'unknown')
                    prompt += f"{idx}. {asset_name} ({asset_type})\n"

                if len(self.bundle.reference_assets) > 5:
                    prompt += f"... and {len(self.bundle.reference_assets) - 5} more assets\n\n"

            if self.bundle.agent_config:
                prompt += f"\n**Agent Configuration**: {list(self.bundle.agent_config.keys())}\n"

        return prompt

    async def deep_dive(
        self,
        topic: str,
        claude_session_id: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Execute deep-dive research on a specific topic.

        Args:
            topic: Research topic
            claude_session_id: Optional Claude session ID to resume

        Returns:
            Research findings with structured work_outputs:
            {
                "topic": str,
                "timestamp": str,
                "work_outputs": List[dict],
                "output_count": int,
                "source_block_ids": List[str],
                "agent_type": "research",
                "claude_session_id": str  # NEW: for session continuity
            }
        """
        logger.info(f"ResearchAgentSDK.deep_dive: {topic}")

        # Extract source block IDs for provenance tracking
        source_block_ids = []
        context_summary = "No prior context available"

        if self.bundle:
            # NEW PATTERN: Use pre-loaded bundle from TP staging
            source_block_ids = [
                str(block.get('id', ''))
                for block in self.bundle.substrate_blocks
                if block.get('id')
            ]
            context_summary = f"{len(self.bundle.substrate_blocks)} substrate blocks pre-loaded"
            logger.info(f"Using bundle context: {len(self.bundle.substrate_blocks)} blocks, {len(self.bundle.reference_assets)} assets")

        elif self.memory:
            # LEGACY PATTERN: Query memory adapter (will be removed)
            memory_results = await self.memory.query(topic, limit=10)
            context = "\n".join([r.content for r in memory_results])
            source_block_ids = [
                str(r.metadata.get("block_id", r.metadata.get("id", "")))
                for r in memory_results
                if hasattr(r, "metadata") and r.metadata
            ]
            source_block_ids = [bid for bid in source_block_ids if bid]
            context_summary = context if context else "No prior context available"
            logger.info(f"LEGACY: Using memory adapter query results")

        # Build research prompt
        research_prompt = f"""Conduct comprehensive research on: {topic}

**Pre-loaded Context:** {context_summary}
**Source Block IDs:** {source_block_ids if source_block_ids else 'none'}

**Research Objectives:**
1. Provide comprehensive overview
2. Identify key trends and patterns
3. Analyze implications
4. Generate actionable insights

**CRITICAL INSTRUCTION:**
You MUST use the emit_work_output tool to record your findings. Do NOT just describe findings in text.

For each significant finding, insight, or recommendation you discover:
1. Call emit_work_output with structured data
2. Use appropriate output_type (finding, recommendation, insight)
3. Include source_block_ids from the context blocks used: {source_block_ids}
4. Assign confidence scores based on evidence quality

Example workflow:
- Find a key fact → emit_work_output(output_type="finding", ...)
- Identify a pattern → emit_work_output(output_type="insight", ...)
- Suggest action → emit_work_output(output_type="recommendation", ...)

You may emit multiple outputs. Each will be reviewed by the user.

Please conduct thorough research and synthesis, emitting structured outputs for all significant findings."""

        # Execute with Claude SDK
        response_text = ""
        new_session_id = None
        work_outputs = []

        try:
            # NOTE: api_key comes from ANTHROPIC_API_KEY env var (SDK reads it automatically)
            async with ClaudeSDKClient(
                options=self._options
            ) as client:
                # Connect (resume existing session or start new)
                if claude_session_id:
                    logger.info(f"Resuming Claude session: {claude_session_id}")
                    await client.connect(session_id=claude_session_id)
                else:
                    logger.info("Starting new Claude session")
                    await client.connect()

                # Send query
                await client.query(research_prompt)

                # Collect responses and parse tool results
                async for message in client.receive_response():
                    logger.debug(f"SDK message type: {type(message).__name__}")

                    # Process content blocks
                    if hasattr(message, 'content') and isinstance(message.content, list):
                        for block in message.content:
                            if not hasattr(block, 'type'):
                                continue

                            block_type = block.type
                            logger.debug(f"SDK block type: {block_type}")

                            # Text blocks
                            if hasattr(block, 'text'):
                                response_text += block.text

                            # Tool result blocks (extract work outputs)
                            elif block_type == 'tool_result':
                                tool_name = getattr(block, 'tool_name', '')
                                logger.debug(f"Tool result from: {tool_name}")

                                if tool_name == 'emit_work_output':
                                    try:
                                        result_content = getattr(block, 'content', None)
                                        if result_content:
                                            import json
                                            if isinstance(result_content, str):
                                                output_data = json.loads(result_content)
                                            else:
                                                output_data = result_content

                                            # Convert to WorkOutput object if needed
                                            from shared.work_output_tools import WorkOutput
                                            if isinstance(output_data, dict):
                                                work_output = WorkOutput(**output_data)
                                            else:
                                                work_output = output_data
                                            work_outputs.append(work_output)
                                            logger.info(f"Captured work output: {output_data.get('title', 'untitled')}")
                                    except Exception as e:
                                        logger.error(f"Failed to parse work output: {e}", exc_info=True)

                # Get session ID from client
                new_session_id = getattr(client, 'session_id', None)
                logger.debug(f"Session ID retrieved: {new_session_id}")

        except Exception as e:
            logger.error(f"Research deep_dive failed: {e}")
            raise

        # Log results
        logger.info(
            f"Deep-dive produced {len(work_outputs)} structured outputs: "
            f"{[o.output_type for o in work_outputs]}"
        )

        # Update agent session with new claude_session_id
        if new_session_id:
            self.current_session.update_claude_session(new_session_id)

        results = {
            "topic": topic,
            "timestamp": datetime.utcnow().isoformat(),
            "work_outputs": [o.to_dict() for o in work_outputs],
            "output_count": len(work_outputs),
            "source_block_ids": source_block_ids,
            "agent_type": "research",
            "basket_id": self.basket_id,
            "work_ticket_id": self.work_ticket_id,
            "claude_session_id": new_session_id,  # NEW: for session continuity
            "response_text": response_text,  # For debugging/logging
        }

        logger.info(f"Deep-dive research complete: {topic} with {len(work_outputs)} outputs")

        return results

    async def monitor(self) -> Dict[str, Any]:
        """
        Execute continuous monitoring across all configured domains.

        NOT IMPLEMENTED in Phase 2a (focus on deep_dive for now).
        Will be added in Phase 2b for scheduled execution.

        Raises:
            NotImplementedError: Always (not yet implemented)
        """
        raise NotImplementedError(
            "monitor() will be implemented in Phase 2b (scheduled execution). "
            "Use deep_dive() for on-demand research."
        )


# ============================================================================
# Convenience Functions
# ============================================================================

def create_research_agent_sdk(
    basket_id: str,
    workspace_id: str,
    work_ticket_id: str,
    **kwargs
) -> ResearchAgentSDK:
    """
    Convenience factory function for creating ResearchAgentSDK.

    Args:
        basket_id: Basket ID for substrate queries
        workspace_id: Workspace ID for authorization
        work_ticket_id: Work ticket ID for output tracking
        **kwargs: Additional arguments for ResearchAgentSDK

    Returns:
        Configured ResearchAgentSDK instance
    """
    return ResearchAgentSDK(
        basket_id=basket_id,
        workspace_id=workspace_id,
        work_ticket_id=work_ticket_id,
        **kwargs
    )
