"""
Agent Tools Package

This package contains tool implementations for agents.
Tools are registered with the Anthropic API and executed by agents.

Tools:
- context_tools: Read/write context items
- recipe_tools: List/trigger work recipes
- emit_work_output: Capture insights (in base tool set)
"""

from .context_tools import (
    CONTEXT_TOOLS,
    execute_context_tool,
    read_context,
    write_context,
    list_context,
)

from .recipe_tools import (
    RECIPE_TOOLS,
    execute_recipe_tool,
    list_recipes,
    trigger_recipe,
)

__all__ = [
    "CONTEXT_TOOLS",
    "execute_context_tool",
    "read_context",
    "write_context",
    "list_context",
    "RECIPE_TOOLS",
    "execute_recipe_tool",
    "list_recipes",
    "trigger_recipe",
]
