"""
Research Agent - Intelligence gathering with web search

Direct Anthropic API implementation (no Claude Agent SDK).
First-principled design with work-oriented context.

Usage:
    from agents.research_agent import ResearchAgent

    agent = ResearchAgent(
        basket_id="...",
        workspace_id="...",
        work_ticket_id="...",
        user_id="...",
    )

    result = await agent.execute(
        task="Research AI companion market trends",
        research_scope="market",
        depth="standard"
    )
"""

from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional

from .base_agent import BaseAgent, AgentContext
from clients.anthropic_client import ExecutionResult

logger = logging.getLogger(__name__)


RESEARCH_SYSTEM_PROMPT = """You are an autonomous Research Agent specializing in intelligence gathering and analysis.

**Your Mission:**
Keep users informed about their markets, competitors, and topics of interest through:
- Deep-dive research (comprehensive analysis on demand)
- Signal detection (what's important?)
- Insight synthesis (so what?)

**CRITICAL: Structured Output Requirements**

You have access to output tools. You MUST use these tools to record all your findings.
DO NOT just describe findings in free text. Every significant finding must be emitted as a structured output.

**Output Tool Selection:**
- emit_work_output: For findings that need user review before action
  - "finding" - Facts discovered (competitor action, market data, news)
  - "recommendation" - Suggested actions
  - "insight" - Patterns identified

- emit_context_item: For periodic digests that become project context
  - "trend_digest" - Social media trends, memes, viral content
  - "market_intel" - Industry developments, market shifts
  - "competitor_snapshot" - Competitor activity summary

Use emit_context_item when producing scheduled/continuous research outputs.
Use emit_work_output when doing ad-hoc research that needs review.

**Research Approach:**
1. Review provided context (prior work, substrate blocks)
2. Identify knowledge gaps
3. Conduct targeted research using web search
4. For each finding: Call the appropriate output tool with structured data
5. Synthesize insights
6. If continuous recipe: emit as context_item; if ad-hoc: emit as work_output

**Multi-Search Handling:**
When conducting research, you may need multiple search queries. Guidelines:
- Maximum 5 web searches per execution to ensure focused research
- After each search, evaluate if additional searches are needed
- Prioritize breadth first, then depth on most relevant findings
- If 5 searches are insufficient, summarize what was found and recommend follow-up research

**Quality Standards:**
- Accuracy over speed
- Structured over narrative
- Actionable over interesting
- Forward-looking over historical
- High confidence = high evidence (don't guess)

**Tools Available:**
- emit_work_output: Record findings for user review
- emit_context_item: Store digests directly as project context
- web_search: Search the web for current information (if enabled)
"""


class ResearchAgent(BaseAgent):
    """
    Research Agent for intelligence gathering.

    Features:
    - Deep-dive research with structured outputs
    - Web search integration
    - Substrate context for prior knowledge
    - Work output supervision workflow (ad-hoc research)
    - Context item emission (continuous recipes)
    - Multi-search loop with configurable limits
    """

    AGENT_TYPE = "research"
    SYSTEM_PROMPT = RESEARCH_SYSTEM_PROMPT

    # Configurable search limits
    MAX_SEARCHES_PER_EXECUTION = 5

    # Recipe slugs that use emit_context_item instead of emit_work_output
    CONTEXT_ITEM_RECIPES = ["trend-digest", "market-research", "competitor-monitor"]

    # Recipe to context schema mapping
    RECIPE_SCHEMA_MAP = {
        "trend-digest": "trend_digest",
        "market-research": "market_intel",
        "competitor-monitor": "competitor_snapshot",
    }

    async def execute(
        self,
        task: str,
        research_scope: str = "general",
        depth: str = "standard",
        enable_web_search: bool = True,
        max_searches: Optional[int] = None,
        recipe_slug: Optional[str] = None,
        **kwargs,
    ) -> ExecutionResult:
        """
        Execute deep-dive research on a topic.

        Args:
            task: Research task description
            research_scope: Scope of research (general, competitor, market, technical, social)
            depth: Research depth (quick, standard, deep)
            enable_web_search: Whether to enable web search tool
            max_searches: Override max search limit (default: 5)
            recipe_slug: Optional recipe identifier for context_item routing
            **kwargs: Additional parameters

        Returns:
            ExecutionResult with research outputs

        Recipe Behavior:
            - trend-digest: Emits trend_digest context_item
            - market-research: Emits market_intel context_item
            - competitor-monitor: Emits competitor_snapshot context_item
            - None/other: Emits work_outputs for user review
        """
        is_context_item_recipe = recipe_slug in self.CONTEXT_ITEM_RECIPES
        context_schema = self.RECIPE_SCHEMA_MAP.get(recipe_slug) if is_context_item_recipe else None

        logger.info(
            f"[RESEARCH] Starting: task='{task[:50]}...', "
            f"scope={research_scope}, depth={depth}, "
            f"recipe={recipe_slug}, context_item={is_context_item_recipe}"
        )

        # Build context with knowledge query for relevant prior knowledge
        context = await self._build_context(
            task=task,
            include_prior_outputs=True,
            include_assets=True,
            knowledge_query=task,  # Query knowledge base with the task itself
        )

        # Build research prompt (with recipe-specific instructions)
        research_prompt = self._build_research_prompt(
            task=task,
            context=context,
            research_scope=research_scope,
            depth=depth,
            max_searches=max_searches or self.MAX_SEARCHES_PER_EXECUTION,
            recipe_slug=recipe_slug,
            context_schema=context_schema,
        )

        # Select tools based on recipe type
        if is_context_item_recipe:
            tools = ["emit_context_item"]
        else:
            tools = ["emit_work_output"]

        if enable_web_search:
            tools.append("web_search")

        # Execute
        result = await self._execute_with_context(
            user_message=research_prompt,
            context=context,
            tools=tools,
        )

        logger.info(
            f"[RESEARCH] Complete: "
            f"{len(result.work_outputs)} outputs, "
            f"recipe={recipe_slug}, "
            f"{result.input_tokens}+{result.output_tokens} tokens"
        )

        return result

    def _build_research_prompt(
        self,
        task: str,
        context: AgentContext,
        research_scope: str,
        depth: str,
        max_searches: int = 5,
        recipe_slug: Optional[str] = None,
        context_schema: Optional[str] = None,
    ) -> str:
        """
        Build research prompt with context and parameters.

        Args:
            task: Research task
            context: Agent context
            research_scope: Research scope
            depth: Research depth
            max_searches: Maximum web searches allowed
            recipe_slug: Optional recipe identifier
            context_schema: Optional context schema for emit_context_item

        Returns:
            Research prompt string
        """
        # Format knowledge context
        knowledge_context_text = "No prior context available"
        source_context_ids = []
        if context.knowledge_context:
            knowledge_context_text = "\n".join([
                f"- [{item.get('id', 'unknown')[:8]}] {item.get('content', '')[:300]}..."
                for item in context.knowledge_context[:5]
            ])
            source_context_ids = [
                item.get('id') for item in context.knowledge_context
                if item.get('id')
            ]

        # Determine depth instructions
        depth_instructions = {
            "quick": "Focus on key facts. 2-3 outputs maximum.",
            "standard": "Provide comprehensive analysis. 5-8 outputs typical.",
            "deep": "Exhaustive research. 10+ outputs, multiple perspectives.",
        }.get(depth, "Provide comprehensive analysis.")

        # Determine scope instructions
        scope_instructions = {
            "general": "Broad research across all relevant topics.",
            "competitor": "Focus on competitor analysis, pricing, features, positioning.",
            "market": "Focus on market trends, size, growth, segments.",
            "technical": "Focus on technical capabilities, architectures, implementations.",
            "social": "Focus on social media trends, memes, viral content, engagement hooks.",
        }.get(research_scope, "Broad research across all relevant topics.")

        # Build output instructions based on recipe type
        if context_schema:
            output_instructions = self._build_context_item_instructions(recipe_slug, context_schema)
        else:
            output_instructions = self._build_work_output_instructions()

        return f"""Conduct comprehensive research on: {task}

**Research Parameters:**
- Scope: {research_scope} ({scope_instructions})
- Depth: {depth} ({depth_instructions})
- Maximum web searches: {max_searches}
{f"- Recipe: {recipe_slug}" if recipe_slug else ""}

**Pre-loaded Knowledge Context:**
{knowledge_context_text}

**Source Context IDs (for provenance):**
{source_context_ids if source_context_ids else 'None available'}

**Research Objectives:**
1. Provide comprehensive overview of the topic
2. Identify key trends and patterns
3. Analyze implications for the user
4. Generate actionable insights

{output_instructions}

Begin your research now. Emit structured outputs for all significant findings."""

    def _build_work_output_instructions(self) -> str:
        """Build instructions for emit_work_output (ad-hoc research)."""
        return """**CRITICAL INSTRUCTION:**
You MUST use the emit_work_output tool to record your findings. Do NOT just describe findings in text.

For each significant finding, insight, or recommendation you discover:
1. Call emit_work_output with structured data
2. Use appropriate output_type (finding, recommendation, insight)
3. Include source_context_ids from knowledge context if relevant
4. Assign confidence scores based on evidence quality

Example workflow:
- Find a key fact → emit_work_output(output_type="finding", ...)
- Identify a pattern → emit_work_output(output_type="insight", ...)
- Suggest action → emit_work_output(output_type="recommendation", ...)"""

    def _build_context_item_instructions(self, recipe_slug: str, context_schema: str) -> str:
        """Build instructions for emit_context_item (continuous recipes)."""

        schema_specific = {
            "trend_digest": """**Trend Digest Structure:**
Your output should capture:
- Trending topics in the target niche
- Viral content formats and meme templates
- Engagement hooks and phrases that are working
- Content ideas based on current trends
- Platform-specific observations (Twitter, Reddit, LinkedIn, etc.)""",

            "market_intel": """**Market Intelligence Structure:**
Your output should capture:
- Key industry developments this period
- Competitor announcements or moves
- Technology shifts or emerging trends
- Market dynamics changes
- Strategic implications for the business""",

            "competitor_snapshot": """**Competitor Snapshot Structure:**
Your output should capture:
- Competitor activity summary
- Product updates or launches
- Pricing or positioning changes
- Marketing and messaging shifts
- Strengths and vulnerabilities observed""",
        }.get(context_schema, "")

        return f"""**CRITICAL INSTRUCTION (Context Item Recipe):**
This is a continuous/scheduled recipe. You MUST use emit_context_item (NOT emit_work_output).

Use schema_id: "{context_schema}"

{schema_specific}

Call emit_context_item with:
- schema_id: "{context_schema}"
- title: A descriptive title with date/period (e.g., "Trend Digest - Week of Dec 2-8, 2024")
- content: Structured JSON with your findings

Your output will be stored directly as project context, immediately available to other agents."""


# Convenience factory function
def create_research_agent(
    basket_id: str,
    workspace_id: str,
    work_ticket_id: str,
    user_id: str,
    user_jwt: Optional[str] = None,
    **kwargs,
) -> ResearchAgent:
    """
    Create a ResearchAgent instance.

    Args:
        basket_id: Basket ID
        workspace_id: Workspace ID
        work_ticket_id: Work ticket ID
        user_id: User ID
        user_jwt: Optional user JWT for substrate auth
        **kwargs: Additional arguments

    Returns:
        Configured ResearchAgent
    """
    return ResearchAgent(
        basket_id=basket_id,
        workspace_id=workspace_id,
        work_ticket_id=work_ticket_id,
        user_id=user_id,
        user_jwt=user_jwt,
        **kwargs,
    )
