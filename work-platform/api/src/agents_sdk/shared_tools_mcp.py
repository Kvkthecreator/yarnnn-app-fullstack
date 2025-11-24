"""
Shared Agent Tools - MCP Server Implementation

Official Claude Agent SDK pattern for tools shared across all specialist agents.
Currently provides: emit_work_output

Usage:
    from agents_sdk.shared_tools_mcp import create_shared_tools_server

    server = create_shared_tools_server()

    options = ClaudeAgentOptions(
        ...
        mcp_servers={"shared_tools": server},
        allowed_tools=["mcp__shared_tools__emit_work_output"],
    )
"""

import logging
import json
import os
from typing import Any, Dict, List, Optional
from claude_agent_sdk import tool, create_sdk_mcp_server
import httpx

logger = logging.getLogger(__name__)

# Substrate API configuration
SUBSTRATE_API_URL = os.getenv("SUBSTRATE_API_URL", "https://yarnnn-substrate-api.onrender.com")
SUBSTRATE_SERVICE_SECRET = os.getenv("SUBSTRATE_SERVICE_SECRET", "")


# Removed: Old emit_work_output_tool definition (now created via factory with closure)


def create_shared_tools_server(
    basket_id: str,
    work_ticket_id: str,
    agent_type: str,
    user_jwt: Optional[str] = None
):
    """
    Create MCP server for shared agent tools with context baked in.

    This factory function creates an MCP server where tools have access to
    agent context (basket_id, work_ticket_id, etc.) via closure.

    Args:
        basket_id: Basket ID for substrate operations
        work_ticket_id: Work ticket ID for output tracking
        agent_type: Agent type (research, content, reporting)
        user_jwt: Optional user JWT for substrate-API auth

    Returns:
        MCP server instance for use in ClaudeAgentOptions.mcp_servers

    Usage:
        from agents_sdk.shared_tools_mcp import create_shared_tools_server

        server = create_shared_tools_server(
            basket_id="basket_123",
            work_ticket_id="ticket_456",
            agent_type="research"
        )

        options = ClaudeAgentOptions(
            ...
            mcp_servers={"shared_tools": server},
            allowed_tools=["mcp__shared_tools__emit_work_output"],
        )
    """
    # Create tool with context closure
    @tool(
        "emit_work_output",
        """Emit a structured work output for user review.

Use this tool to record your findings, recommendations, insights, or draft content.
Each output you emit will be reviewed by the user before any action is taken.

IMPORTANT: You MUST use this tool for EVERY significant finding or output you generate.
Do not just describe your findings in text - emit them as structured outputs.

When to use:
- You discover a new fact or finding (output_type: "finding")
- You want to suggest an action (output_type: "recommendation")
- You identify a pattern or insight (output_type: "insight")
- You draft content for review (output_type: "draft_content")
- You analyze data (output_type: "data_analysis")
- You create a report section (output_type: "report_section")
""",
        {
            "output_type": str,
            "title": str,
            "body": dict,
            "confidence": float,
            "source_block_ids": list  # Optional
        }
    )
    async def emit_work_output_with_context(args: Dict[str, Any]) -> Dict[str, Any]:
        """
        Emit work output with context from closure.

        Context (basket_id, work_ticket_id, agent_type) is baked into this
        function via closure from the factory function.
        """
        output_type = args.get('output_type')
        title = args.get('title')
        body = args.get('body')
        confidence = args.get('confidence')
        source_block_ids = args.get('source_block_ids', [])

        logger.info(
            f"emit_work_output: type={output_type}, basket={basket_id}, "
            f"ticket={work_ticket_id}, agent={agent_type}"
        )

        try:
            # Call substrate-API to create work_output
            url = f"{SUBSTRATE_API_URL}/api/baskets/{basket_id}/work-outputs"

            # Convert body dict to JSON string (work_outputs.body is TEXT column)
            body_text = json.dumps(body) if isinstance(body, dict) else str(body)

            payload = {
                "basket_id": basket_id,
                "work_ticket_id": work_ticket_id,
                "output_type": output_type,
                "agent_type": agent_type,
                "title": title,
                "body": body_text,  # TEXT column (JSON string)
                "confidence": confidence,
                "source_context_ids": source_block_ids,  # Provenance
                "metadata": {}
            }

            headers = {
                "X-Service-Name": "work-platform-api",
                "X-Service-Secret": SUBSTRATE_SERVICE_SECRET,
            }
            if user_jwt:
                headers["Authorization"] = f"Bearer {user_jwt}"

            async with httpx.AsyncClient(timeout=30.0) as client:
                response = await client.post(url, json=payload, headers=headers)
                response.raise_for_status()
                work_output = response.json()

            logger.info(
                f"emit_work_output SUCCESS: output_id={work_output.get('id')}, "
                f"type={output_type}, title={title[:50]}"
            )

            return {
                "content": [{
                    "type": "text",
                    "text": json.dumps({
                        "status": "success",
                        "work_output_id": work_output.get('id'),
                        "output_type": output_type,
                        "title": title,
                        "message": f"Work output '{title}' created successfully"
                    }, indent=2)
                }]
            }

        except httpx.HTTPStatusError as e:
            logger.error(f"emit_work_output HTTP error: {e.response.status_code} {e.response.text}")
            return {
                "content": [{
                    "type": "text",
                    "text": json.dumps({
                        "status": "error",
                        "error": f"HTTP {e.response.status_code}: {e.response.text}",
                        "message": "Failed to create work output in substrate-API"
                    })
                }],
                "isError": True
            }

        except Exception as e:
            logger.error(f"emit_work_output FAILED: {e}", exc_info=True)
            return {
                "content": [{
                    "type": "text",
                    "text": json.dumps({
                        "status": "error",
                        "error": str(e),
                        "message": "Unexpected error creating work output"
                    })
                }],
                "isError": True
            }

    # Return MCP server with context-aware tool
    return create_sdk_mcp_server(
        name="shared-agent-tools",
        version="1.0.0",
        tools=[emit_work_output_with_context]
    )
