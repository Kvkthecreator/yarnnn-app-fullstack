"""
Thinking Partner Agent - Interactive ideation, context management, and work orchestration.

Unlike task-oriented agents (research, content), ThinkingPartnerAgent is conversational:
- Maintains conversation context via session_id
- Has full taxonomy access (can read/write all context tiers)
- Can trigger work recipes via work_tickets
- Foundation tier writes create governance proposals

Tools:
- read_context: Read any context item
- write_context: Update context (foundation → governance, working → direct)
- list_context: List all context items grouped by tier
- list_recipes: List available work recipes
- trigger_recipe: Queue a work recipe
- emit_work_output: Capture insights during conversation

See: /docs/implementation/THINKING_PARTNER_IMPLEMENTATION_PLAN.md
"""

from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional

from .base_agent import BaseAgent, AgentContext
from .tools.context_tools import CONTEXT_TOOLS, execute_context_tool
from .tools.recipe_tools import RECIPE_TOOLS, execute_recipe_tool
from clients.anthropic_client import ExecutionResult

logger = logging.getLogger(__name__)


THINKING_PARTNER_SYSTEM_PROMPT = """You are a Thinking Partner Agent - an interactive collaborator for ideation, context management, and work orchestration.

## Your Role

You help users:
1. **Manage Context** - Read, update, and organize their project context
2. **Ideate & Brainstorm** - Explore ideas through Socratic questioning
3. **Orchestrate Work** - Trigger research, content, and other work recipes
4. **Capture Insights** - Document valuable insights as work outputs

## Tools Available

### Context Tools
- `read_context(item_type)` - Read a context item (problem, customer, vision, brand, competitor, etc.)
- `write_context(item_type, content)` - Update context. Foundation tier creates governance proposals.
- `list_context()` - List all context items grouped by tier

### Recipe Tools
- `list_recipes()` - List available work recipes
- `trigger_recipe(recipe_slug, parameters)` - Queue a work recipe for execution

### Output Tools
- `emit_work_output(title, body, output_type)` - Capture insights, recommendations, findings

## Context Tiers

1. **Foundation** (problem, customer, vision, brand)
   - Stable, user-established context
   - Your writes create governance proposals for user approval

2. **Working** (competitor, trend_digest, etc.)
   - Accumulating context from research
   - Your writes apply directly

3. **Ephemeral** (session-specific)
   - Temporary context during conversation

## Interaction Style

- Conversational and collaborative
- Ask probing questions to understand needs
- Offer multiple perspectives
- Suggest relevant recipes when appropriate
- Capture key insights with emit_work_output

## Guidelines

1. **Start by understanding context** - Use list_context to see what's established
2. **Read before writing** - Check existing content before proposing changes
3. **Explain governance** - When proposing foundation changes, explain they need approval
4. **Be proactive** - Suggest recipes that could help
5. **Capture value** - Use emit_work_output for important insights"""


class ThinkingPartnerAgent(BaseAgent):
    """
    Thinking Partner Agent for interactive ideation and work orchestration.

    Unlike task agents, TP is conversational with:
    - Session persistence via session_id
    - Full context taxonomy access
    - Recipe triggering capability
    - Governance-aware context writes
    """

    AGENT_TYPE = "thinking_partner"
    SYSTEM_PROMPT = THINKING_PARTNER_SYSTEM_PROMPT

    def __init__(
        self,
        basket_id: str,
        workspace_id: str,
        work_ticket_id: Optional[str],  # TP doesn't require a ticket
        user_id: str,
        session_id: Optional[str] = None,
        user_jwt: Optional[str] = None,
        model: str = "claude-sonnet-4-20250514",
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
            model: Claude model to use
        """
        super().__init__(
            basket_id=basket_id,
            workspace_id=workspace_id,
            work_ticket_id=work_ticket_id or "tp_session",  # Fallback for base class
            user_id=user_id,
            user_jwt=user_jwt,
            model=model,
        )
        self.session_id = session_id

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
        """Build system prompt with context section."""
        prompt_parts = [self.SYSTEM_PROMPT]

        if context_prompt:
            prompt_parts.append(f"""
# Current Context

{context_prompt}
""")

        return "\n\n".join(prompt_parts)

    def _get_tp_tools(self) -> List[Dict[str, Any]]:
        """Get all TP tool definitions for Anthropic API."""
        # Context tools
        tools = CONTEXT_TOOLS.copy()

        # Recipe tools
        tools.extend(RECIPE_TOOLS)

        # emit_work_output (from base emit tool)
        tools.append({
            "name": "emit_work_output",
            "description": """Capture and save an insight, finding, or recommendation from the conversation.

Use this when you identify something valuable that should be persisted:
- Insights realized during discussion
- Action items identified
- Recommendations to explore
- Findings from analysis

The output goes to the user's supervision queue for review.""",
            "input_schema": {
                "type": "object",
                "properties": {
                    "title": {
                        "type": "string",
                        "description": "Brief title for the output"
                    },
                    "body": {
                        "type": "string",
                        "description": "Full content of the insight/finding/recommendation"
                    },
                    "output_type": {
                        "type": "string",
                        "enum": ["insight", "finding", "recommendation", "summary"],
                        "description": "Type of output"
                    },
                    "confidence": {
                        "type": "number",
                        "description": "Confidence level 0-1. Default: 0.8",
                        "default": 0.8
                    }
                },
                "required": ["title", "body", "output_type"]
            }
        })

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

        # emit_work_output - use existing implementation
        if tool_name == "emit_work_output":
            return await self._emit_work_output(tool_input)

        return {"error": f"Unknown tool: {tool_name}"}

    async def _emit_work_output(self, tool_input: Dict[str, Any]) -> Dict[str, Any]:
        """Emit a work output from the conversation."""
        from app.utils.supabase_client import supabase_admin_client as supabase

        try:
            output_data = {
                "basket_id": self.basket_id,
                "work_ticket_id": None,  # TP outputs don't have tickets
                "agent_type": self.AGENT_TYPE,
                "title": tool_input.get("title", "Untitled"),
                "body": tool_input.get("body", ""),
                "output_type": tool_input.get("output_type", "insight"),
                "confidence": tool_input.get("confidence", 0.8),
                "supervision_status": "pending",
                "metadata": {
                    "source": "thinking_partner",
                    "session_id": self.session_id,
                }
            }

            result = supabase.table("work_outputs").insert(output_data).execute()

            if not result.data:
                return {"error": "Failed to save work output"}

            output_id = result.data[0]["id"]
            logger.info(f"[TP] Emitted work output {output_id}")

            return {
                "success": True,
                "output_id": output_id,
                "title": tool_input.get("title"),
                "type": tool_input.get("output_type"),
                "message": "Output saved and queued for review."
            }

        except Exception as e:
            logger.error(f"[TP] emit_work_output error: {e}")
            return {"error": f"Failed to emit output: {str(e)}"}

    async def _execute_conversation_turn(
        self,
        system_prompt: str,
        user_message: str,
        tools: List[Dict[str, Any]],
    ) -> ExecutionResult:
        """
        Execute a single conversation turn with tool handling.

        Uses agentic loop to handle tool calls until final response.
        """
        import anthropic

        messages = [{"role": "user", "content": user_message}]
        all_tool_calls = []
        all_work_outputs = []

        # Create Anthropic client
        client = anthropic.Anthropic()

        max_iterations = 10
        iteration = 0

        while iteration < max_iterations:
            iteration += 1

            # Call Claude
            response = client.messages.create(
                model=self.model,
                max_tokens=4096,
                system=system_prompt,
                messages=messages,
                tools=tools,
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
                return ExecutionResult(
                    response_text=response_text,
                    tool_calls=all_tool_calls,
                    work_outputs=all_work_outputs,
                    input_tokens=response.usage.input_tokens,
                    output_tokens=response.usage.output_tokens,
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

                # Track work outputs from emit_work_output
                if tool_name == "emit_work_output" and result.get("success"):
                    all_work_outputs.append({
                        "id": result.get("output_id"),
                        "title": tool_input.get("title"),
                        "type": tool_input.get("output_type"),
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
            input_tokens=0,
            output_tokens=0,
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


# Backward compatibility alias
ThinkingPartnerExecutor = ThinkingPartnerAgent
create_thinking_partner_executor = create_thinking_partner_agent
