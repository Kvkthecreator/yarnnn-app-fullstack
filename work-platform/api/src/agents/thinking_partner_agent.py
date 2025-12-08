"""
Thinking Partner Agent - Conversational orchestrator for context and work.

TP is the user's intelligent collaborator. It:
- Thinks WITH the user through Socratic dialogue
- Manages project context (read/write/list)
- Orchestrates work by triggering specialist agents via recipes

Key distinction: TP does NOT execute work or create outputs itself.
It discusses, clarifies, and when ready, hands off to specialists (research, content, etc.)

Tools:
- read_context: Read context items
- write_context: Update context (with governance awareness for foundation tier)
- list_context: See established context
- list_recipes: List available work recipes
- trigger_recipe: Hand off work to specialist agents

Flow: User → TP (conversation, context) → trigger_recipe → Work Ticket → Specialist Agent → Outputs

Phase 5 Optimizations:
- Model tiering: Uses Sonnet for orchestration, can downgrade to Haiku for simple queries
- Prompt caching: System prompt cached with ephemeral cache control
- Token budget: Reserved space for context and tools
"""

from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional

from .base_agent import BaseAgent, AgentContext
from .tools.context_tools import CONTEXT_TOOLS, execute_context_tool
from .tools.recipe_tools import RECIPE_TOOLS, execute_recipe_tool
from .model_config import (
    ModelTier,
    get_model_id,
    get_operation_config,
    get_token_budget,
    build_cached_system_prompt,
    CacheConfig,
    DEFAULT_CACHE_CONFIG,
)
from clients.anthropic_client import ExecutionResult

logger = logging.getLogger(__name__)


THINKING_PARTNER_SYSTEM_PROMPT = """You are a Thinking Partner - an intelligent conversational collaborator that helps users clarify their thinking and orchestrate AI-powered work.

## Your Role

You are the user's strategic thinking partner. You:
1. **Think WITH the user** - Engage in Socratic dialogue to explore and refine ideas
2. **Manage Context** - Help build and organize their project's foundational context
3. **Orchestrate Work** - When ready, hand off well-defined tasks to specialist agents

You do NOT execute work yourself. You think, discuss, clarify, and when the user is ready, you trigger specialist agents (research, content, reporting) to do the actual work.

## Tools Available

### Context Tools
- `read_context(item_type)` - Read a context item
- `write_context(item_type, content)` - Update context
- `list_context()` - See all established context (lightweight, just types and titles)

### Recipe Tools
- `list_recipes(category)` - See available work recipes and their requirements
- `trigger_recipe(recipe_slug, parameters)` - Hand off work to specialist agents

## Context Tiers

**Foundation** (stable, user-established - ASK before changing):
- `problem` - What problem are you solving?
- `customer` - Who are you serving?
- `vision` - Where are you headed?
- `brand` - How do you present yourself?

**Working** (accumulating knowledge - can write directly):
- `competitor` - Competitor intelligence (non-singleton, use item_key)
- `trend_digest` - Market trends
- `reference` - User-shared data, reports, research (non-singleton, use item_key)

## IMPORTANT: Context Writing Protocol

### Foundation tier: ALWAYS ASK FIRST
Before modifying foundation context (problem, customer, vision, brand):
1. Call `list_context()` to see current state
2. Tell the user what exists: "You have a problem statement established..."
3. Ask before writing: "Would you like me to update your problem statement with this?"
4. Only write after explicit user confirmation

### Working tier: Ask for bulk inputs, write directly for incremental
- For NEW user-shared data (reports, research): Ask "Should I save this as a reference?"
- For incremental updates (adding a competitor): Can write directly
- Use `reference` type with item_key for user-provided data

### What NOT to do
- Do NOT auto-categorize user input into multiple context items
- Do NOT invent item types (only use: problem, customer, vision, brand, competitor, trend_digest, reference)
- Do NOT write to foundation tier without asking

## How to Engage

1. **Be conversational** - Have a real dialogue, not a checklist
2. **Foundation as grounding** - Reference existing foundation context to inform conversation, but don't treat it as a checklist to fill
3. **Working context is the focus** - Most conversations are about gathering and refining working context
4. **Ask before writing** - Especially for foundation tier and new bulk data
5. **Be concise** - Short, focused responses. Don't over-explain.

## Recipe Handoff Flow

When a user wants work done (research, content, etc.):
1. Check if required context exists (`list_context`)
2. If missing, help them fill it via conversation + `write_context` (with permission)
3. Once ready, use `trigger_recipe` to queue the work
4. Explain: "I've queued [recipe] - [agent] will work on this and results will appear in your Work Tickets"

## Example Interactions

### User shares detailed information
User: [shares Korean financial data]

Good response: "Thanks for sharing this financial data. I can save this to your project context for reference. Would you like me to store this as a 'reference' item?"

NOT: Automatically breaking it into analysis/finding/insight items

### User wants to update problem statement
User: "Actually our problem is more about X"

Good response: "I see you have a problem statement established: [current summary]. Would you like me to update it to focus on X?"

NOT: Immediately overwriting the foundation context"""


class ThinkingPartnerAgent(BaseAgent):
    """
    Thinking Partner Agent for interactive ideation and work orchestration.

    Unlike task agents, TP is conversational with:
    - Session persistence via session_id
    - Full context taxonomy access
    - Recipe triggering capability
    - Governance-aware context writes

    Phase 5 Optimizations:
    - Model tiering: Sonnet for orchestration, Haiku for simple queries
    - Prompt caching: Static system prompt cached for cost reduction
    - Token budget: Manages context/tool reservations
    """

    AGENT_TYPE = "thinking_partner"
    SYSTEM_PROMPT = THINKING_PARTNER_SYSTEM_PROMPT

    # Cache configuration for TP
    CACHE_CONFIG = CacheConfig(
        min_cacheable_tokens=1024,
        cache_control_type="ephemeral",
        cache_system_prompt=True,
        cache_static_context=True,  # Foundation tier context
        cache_tools=True,
        cache_conversation=False,    # Don't cache dynamic conversation
    )

    def __init__(
        self,
        basket_id: str,
        workspace_id: str,
        work_ticket_id: Optional[str],  # TP doesn't require a ticket
        user_id: str,
        session_id: Optional[str] = None,
        user_jwt: Optional[str] = None,
        model: Optional[str] = None,  # None = auto-select based on operation
        operation: str = "tp_conversation",  # For model tiering
    ):
        """
        Initialize ThinkingPartnerAgent.

        Args:
            basket_id: Basket ID for context
            workspace_id: Workspace ID for authorization
            work_ticket_id: Optional work ticket (TP usually doesn't have one)
            user_id: User ID for audit trail
            session_id: TP session ID for tool context
            user_jwt: Optional user JWT for substrate auth
            model: Claude model to use (None = auto-select)
            operation: Operation type for model tiering
        """
        # Get operation config for model tiering
        self.operation = operation
        op_config = get_operation_config(operation)

        # Auto-select model based on operation if not specified
        selected_model = model or get_model_id(op_config.default_tier)

        super().__init__(
            basket_id=basket_id,
            workspace_id=workspace_id,
            work_ticket_id=work_ticket_id or "tp_session",  # Fallback for base class
            user_id=user_id,
            user_jwt=user_jwt,
            model=selected_model,
        )
        self.session_id = session_id
        self.token_budget = get_token_budget(operation)

    async def execute(
        self,
        message: str,
        context_prompt: str = "",
        **kwargs,
    ) -> ExecutionResult:
        """
        Execute Thinking Partner conversation turn.

        Args:
            message: User's message
            context_prompt: Pre-built context section (from routes)
            **kwargs: Additional parameters

        Returns:
            ExecutionResult with response and any tool calls/outputs
        """
        logger.info(
            f"[THINKING_PARTNER] Processing: message={len(message)} chars, "
            f"session={self.session_id}"
        )

        # Build minimal context (context is pre-provisioned in routes)
        context = AgentContext(
            basket_id=self.basket_id,
            workspace_id=self.workspace_id,
            work_ticket_id=self.work_ticket_id or "tp_session",
            user_id=self.user_id,
            task=message,
            agent_type=self.AGENT_TYPE,
            user_jwt=self.user_jwt,
        )

        # Build system prompt with context
        system_prompt = self._build_tp_system_prompt(context_prompt)

        # Build tool definitions
        tools = self._get_tp_tools()

        # Execute with Anthropic client
        result = await self._execute_conversation_turn(
            system_prompt=system_prompt,
            user_message=message,
            tools=tools,
        )

        logger.info(
            f"[THINKING_PARTNER] Complete: "
            f"response={len(result.response_text or '')} chars, "
            f"tool_calls={len(result.tool_calls)}, "
            f"outputs={len(result.work_outputs)}, "
            f"tokens={result.input_tokens}+{result.output_tokens}"
        )

        return result

    def _build_tp_system_prompt(self, context_prompt: str) -> str:
        """Build system prompt with context section (legacy string format)."""
        prompt_parts = [self.SYSTEM_PROMPT]

        if context_prompt:
            prompt_parts.append(f"""
# Current Context

{context_prompt}
""")

        return "\n\n".join(prompt_parts)

    def _build_cached_system_prompt(
        self,
        foundation_context: Optional[str] = None,
        working_context: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        """
        Build system prompt with cache control blocks.

        Optimized structure for Anthropic prompt caching:
        1. Base system prompt (cached, ~2K tokens)
        2. Foundation context (cached, stable)
        3. Working context (not cached, dynamic)

        Args:
            foundation_context: Foundation tier context (problem, customer, brand, vision)
            working_context: Working tier context (dynamic, from research)

        Returns:
            List of content blocks with cache_control
        """
        blocks = []

        # Block 1: Base system prompt (always cached)
        blocks.append({
            "type": "text",
            "text": self.SYSTEM_PROMPT,
            "cache_control": {"type": self.CACHE_CONFIG.cache_control_type}
        })

        # Block 2: Foundation context (cached - stable, user-established)
        if foundation_context:
            blocks.append({
                "type": "text",
                "text": f"\n\n# Foundation Context\n\n{foundation_context}",
                "cache_control": {"type": self.CACHE_CONFIG.cache_control_type}
            })

        # Block 3: Working context (NOT cached - dynamic, changes frequently)
        if working_context:
            blocks.append({
                "type": "text",
                "text": f"\n\n# Working Context\n\n{working_context}",
                # No cache_control - this is dynamic
            })

        return blocks

    def _get_tp_tools(self) -> List[Dict[str, Any]]:
        """Get all TP tool definitions for Anthropic API."""
        # Context tools
        tools = CONTEXT_TOOLS.copy()

        # Recipe tools
        tools.extend(RECIPE_TOOLS)

        # Note: emit_work_output removed - TP orchestrates, specialists create outputs

        return tools

    def _get_tool_context(self) -> Dict[str, Any]:
        """Get context for tool execution."""
        return {
            "basket_id": self.basket_id,
            "workspace_id": self.workspace_id,
            "work_ticket_id": self.work_ticket_id,
            "user_id": self.user_id,
            "session_id": self.session_id,
            "agent_type": self.AGENT_TYPE,
            "user_jwt": self.user_jwt,
        }

    async def _execute_tool(
        self,
        tool_name: str,
        tool_input: Dict[str, Any],
    ) -> Dict[str, Any]:
        """
        Execute a tool and return the result.

        Routes to appropriate tool handler based on tool name.
        """
        context = self._get_tool_context()

        # Context tools
        if tool_name in ["read_context", "write_context", "list_context"]:
            return await execute_context_tool(tool_name, tool_input, context)

        # Recipe tools
        if tool_name in ["list_recipes", "trigger_recipe"]:
            return await execute_recipe_tool(tool_name, tool_input, context)

        return {"error": f"Unknown tool: {tool_name}"}

    async def _execute_conversation_turn(
        self,
        system_prompt: str,
        user_message: str,
        tools: List[Dict[str, Any]],
    ) -> ExecutionResult:
        """
        Execute a single conversation turn with tool handling.

        Uses agentic loop to handle tool calls until final response.
        Phase 5: Uses cached system prompt for cost optimization.
        """
        import anthropic

        messages = [{"role": "user", "content": user_message}]
        all_tool_calls = []
        all_work_outputs = []

        # Token tracking for Phase 5 budget management
        total_input_tokens = 0
        total_output_tokens = 0
        total_cache_read = 0
        total_cache_creation = 0

        # Create Anthropic client
        client = anthropic.Anthropic()

        max_iterations = 10
        iteration = 0

        while iteration < max_iterations:
            iteration += 1

            # Call Claude with cached system prompt format
            # Using array format with cache_control for prompt caching
            response = client.messages.create(
                model=self.model,
                max_tokens=self.token_budget.max_output if hasattr(self, 'token_budget') else 4096,
                system=[{
                    "type": "text",
                    "text": system_prompt,
                    "cache_control": {"type": "ephemeral"}  # Enable caching
                }],
                messages=messages,
                tools=tools,
            )

            # Track token usage
            usage = response.usage
            total_input_tokens += usage.input_tokens
            total_output_tokens += usage.output_tokens

            # Check for cache usage (if available)
            if hasattr(usage, 'cache_read_input_tokens'):
                total_cache_read += usage.cache_read_input_tokens or 0
            if hasattr(usage, 'cache_creation_input_tokens'):
                total_cache_creation += usage.cache_creation_input_tokens or 0

            logger.debug(
                f"[TP] Turn {iteration}: tokens={usage.input_tokens}+{usage.output_tokens}, "
                f"cache_read={getattr(usage, 'cache_read_input_tokens', 0)}"
            )

            # Extract response content
            response_text = ""
            tool_uses = []

            for block in response.content:
                if hasattr(block, "text"):
                    response_text += block.text
                elif block.type == "tool_use":
                    tool_uses.append({
                        "id": block.id,
                        "name": block.name,
                        "input": block.input,
                    })

            # If no tool calls, we're done
            if not tool_uses:
                logger.info(
                    f"[TP] Complete: total_tokens={total_input_tokens}+{total_output_tokens}, "
                    f"cache_read={total_cache_read}, cache_creation={total_cache_creation}"
                )
                return ExecutionResult(
                    response_text=response_text,
                    tool_calls=all_tool_calls,
                    work_outputs=all_work_outputs,
                    input_tokens=total_input_tokens,
                    output_tokens=total_output_tokens,
                    cache_read_tokens=total_cache_read,
                    cache_creation_tokens=total_cache_creation,
                )

            # Execute tools
            tool_results = []
            for tool_use in tool_uses:
                tool_name = tool_use["name"]
                tool_input = tool_use["input"]

                logger.info(f"[TP] Executing tool: {tool_name}")

                # Execute tool
                result = await self._execute_tool(tool_name, tool_input)

                # Track tool call
                all_tool_calls.append({
                    "name": tool_name,
                    "input": tool_input,
                    "result": result,
                })

                # Track triggered recipes for visibility
                if tool_name == "trigger_recipe" and result.get("success"):
                    all_work_outputs.append({
                        "id": result.get("work_ticket_id"),
                        "title": f"Queued: {result.get('recipe', {}).get('name', 'Recipe')}",
                        "type": "work_ticket",
                    })

                tool_results.append({
                    "type": "tool_result",
                    "tool_use_id": tool_use["id"],
                    "content": str(result),
                })

            # Add assistant message and tool results to conversation
            messages.append({
                "role": "assistant",
                "content": response.content,
            })
            messages.append({
                "role": "user",
                "content": tool_results,
            })

        # Max iterations reached
        logger.warning(f"[TP] Max iterations ({max_iterations}) reached")
        return ExecutionResult(
            response_text="I apologize, but I reached my processing limit. Please try a simpler request.",
            tool_calls=all_tool_calls,
            work_outputs=all_work_outputs,
            input_tokens=total_input_tokens,
            output_tokens=total_output_tokens,
            cache_read_tokens=total_cache_read,
            cache_creation_tokens=total_cache_creation,
        )


# Convenience factory function
def create_thinking_partner_agent(
    basket_id: str,
    workspace_id: str,
    user_id: str,
    session_id: Optional[str] = None,
    work_ticket_id: Optional[str] = None,
    user_jwt: Optional[str] = None,
    **kwargs,
) -> ThinkingPartnerAgent:
    """
    Create a ThinkingPartnerAgent instance.

    Args:
        basket_id: Basket ID
        workspace_id: Workspace ID
        user_id: User ID
        session_id: Optional TP session ID
        work_ticket_id: Optional work ticket ID
        user_jwt: Optional user JWT for substrate auth
        **kwargs: Additional arguments

    Returns:
        Configured ThinkingPartnerAgent
    """
    return ThinkingPartnerAgent(
        basket_id=basket_id,
        workspace_id=workspace_id,
        work_ticket_id=work_ticket_id,
        user_id=user_id,
        session_id=session_id,
        user_jwt=user_jwt,
        **kwargs,
    )
