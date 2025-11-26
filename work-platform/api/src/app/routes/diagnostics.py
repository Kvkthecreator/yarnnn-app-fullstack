"""
Diagnostic endpoints for troubleshooting agent execution.

Helps debug Skills availability, working directory, and agent configuration.
"""

import os
import logging
from fastapi import APIRouter
from pathlib import Path

router = APIRouter(prefix="/diagnostics", tags=["diagnostics"])
logger = logging.getLogger(__name__)


@router.get("/skills")
async def check_skills_availability():
    """
    Check if Skills are accessible at runtime.

    Returns:
        - working_directory: Current working directory
        - claude_dir_exists: Whether .claude directory exists
        - skills_dir_exists: Whether .claude/skills exists
        - available_skills: List of installed Skills
        - skill_details: Details about each Skill (SKILL.md exists, etc.)
    """
    cwd = os.getcwd()
    claude_dir = Path(cwd) / ".claude"
    skills_dir = claude_dir / "skills"

    result = {
        "working_directory": cwd,
        "claude_dir_exists": claude_dir.exists(),
        "claude_dir_path": str(claude_dir),
        "skills_dir_exists": skills_dir.exists(),
        "skills_dir_path": str(skills_dir),
        "available_skills": [],
        "skill_details": {}
    }

    if skills_dir.exists():
        # List all skill directories
        skill_dirs = [d for d in skills_dir.iterdir() if d.is_dir() and not d.name.startswith('.')]
        result["available_skills"] = [d.name for d in skill_dirs]

        # Check each skill for SKILL.md
        for skill_dir in skill_dirs:
            skill_name = skill_dir.name
            skill_md = skill_dir / "SKILL.md"

            result["skill_details"][skill_name] = {
                "directory_exists": True,
                "skill_md_exists": skill_md.exists(),
                "skill_md_path": str(skill_md),
                "skill_md_size": skill_md.stat().st_size if skill_md.exists() else 0,
                "files": [f.name for f in skill_dir.iterdir() if f.is_file()][:10]  # First 10 files
            }

    # Check environment variables that might affect Skills
    result["environment"] = {
        "PYTHONPATH": os.getenv("PYTHONPATH"),
        "PATH": os.getenv("PATH", "")[:200] + "...",  # Truncate PATH
        "HOME": os.getenv("HOME"),
        "USER": os.getenv("USER"),
        "ANTHROPIC_API_KEY": "***" + os.getenv("ANTHROPIC_API_KEY", "NOT_SET")[-4:] if os.getenv("ANTHROPIC_API_KEY") else "NOT_SET",
    }

    # Check if Claude CLI is installed/accessible (binary name is 'claude')
    import subprocess
    try:
        claude_cli_check = subprocess.run(
            ["which", "claude"],
            capture_output=True,
            text=True,
            timeout=5
        )
        result["claude_cli"] = {
            "found": claude_cli_check.returncode == 0,
            "path": claude_cli_check.stdout.strip() if claude_cli_check.returncode == 0 else None,
            "binary_name": "claude"
        }
    except Exception as e:
        result["claude_cli"] = {
            "found": False,
            "error": str(e),
            "binary_name": "claude"
        }

    logger.info(f"Skills diagnostic: {len(result['available_skills'])} skills found")

    return result


@router.get("/agent-config")
async def check_agent_configuration():
    """
    Check agent SDK configuration.

    Returns info about how agents are configured.
    """
    from agents_sdk.reporting_agent_sdk import ReportingAgentSDK, REPORTING_AGENT_SYSTEM_PROMPT
    from shared.session import AgentSession

    # Create a test instance to inspect configuration
    try:
        # Create a mock session to avoid database dependency
        from unittest.mock import MagicMock
        mock_session = MagicMock(spec=AgentSession)
        mock_session.id = "test-session-123"
        mock_session.claude_session_id = None
        mock_session.parent_session_id = None

        agent = ReportingAgentSDK(
            basket_id="test-basket",
            workspace_id="test-workspace",
            work_ticket_id="test-ticket",
            session=mock_session
        )

        config = {
            "model": agent.model,
            "default_format": agent.default_format,
            "options": {
                "model": agent._options.model,
                "allowed_tools": agent._options.allowed_tools,
                "setting_sources": agent._options.setting_sources,
                "mcp_servers_count": len(agent._options.mcp_servers) if agent._options.mcp_servers else 0,
            },
            "system_prompt_length": len(REPORTING_AGENT_SYSTEM_PROMPT),
            "system_prompt_preview": REPORTING_AGENT_SYSTEM_PROMPT[:500] + "...",
            "system_prompt_has_skill_instructions": "Use Skill tool" in REPORTING_AGENT_SYSTEM_PROMPT,
            "system_prompt_has_pptx_instructions": 'skill_id: "pptx"' in REPORTING_AGENT_SYSTEM_PROMPT,
        }

        return {
            "status": "success",
            "config": config
        }
    except Exception as e:
        logger.error(f"Failed to create test agent: {e}", exc_info=True)
        import traceback
        return {
            "status": "error",
            "error": str(e),
            "traceback": traceback.format_exc()
        }


@router.post("/test-basic-sdk")
async def test_basic_sdk():
    """
    Test basic SDK functionality WITHOUT Skills.

    This will confirm:
    1. SDK can connect
    2. SDK can receive text responses
    3. SDK iterator works properly

    Returns basic response info.
    """
    from claude_agent_sdk import ClaudeSDKClient, ClaudeAgentOptions

    print("[BASIC SDK TEST] Starting...", flush=True)

    try:
        options = ClaudeAgentOptions(
            model="claude-sonnet-4-5",
            system_prompt="You are a helpful assistant. Respond concisely.",
            allowed_tools=[],  # NO tools, just basic chat
            setting_sources=["user", "project"],
        )

        response_text = ""
        message_count = 0

        async with ClaudeSDKClient(options=options) as client:
            print("[BASIC SDK TEST] Connecting...", flush=True)
            await client.connect()

            print("[BASIC SDK TEST] Sending simple prompt...", flush=True)
            await client.query("Say hello and count to 3.")

            print("[BASIC SDK TEST] Iterating responses...", flush=True)
            async for message in client.receive_response():
                message_count += 1
                print(f"[BASIC SDK TEST] Message #{message_count}", flush=True)

                if hasattr(message, 'content') and isinstance(message.content, list):
                    for block in message.content:
                        if hasattr(block, 'text'):
                            response_text += block.text
                            print(f"[BASIC SDK TEST] Got text: {block.text[:50]}...", flush=True)

            print(f"[BASIC SDK TEST] Complete: {message_count} messages, {len(response_text)} chars", flush=True)

        return {
            "status": "success",
            "message_count": message_count,
            "response_text": response_text,
            "response_length": len(response_text)
        }

    except Exception as e:
        print(f"[BASIC SDK TEST] FAILED: {e}", flush=True)
        import traceback
        return {
            "status": "error",
            "error": str(e),
            "traceback": traceback.format_exc()
        }


@router.post("/test-skill-invocation")
async def test_skill_invocation():
    """
    Test if Skill tool can actually be invoked by the Claude SDK.

    Creates a minimal agent and asks it to generate a simple PPTX file.
    This will tell us if Skills work at all or if there's a deeper issue.

    Returns:
        - status: success/error
        - tool_calls: List of tools the agent actually called
        - response_text: Agent's response
        - skill_invoked: Whether Skill tool was used
        - error: Error message if failed
    """
    from claude_agent_sdk import ClaudeSDKClient, ClaudeAgentOptions
    import asyncio

    # Use print for visibility (logger.info may be filtered)
    print("[SKILL TEST] Starting minimal Skill tool test", flush=True)

    try:
        # Create minimal options with ONLY Skill tool
        options = ClaudeAgentOptions(
            model="claude-sonnet-4-5",
            system_prompt="""You are a presentation creator.

**CRITICAL INSTRUCTION**: When asked to create a PPTX presentation, you MUST use the Skill tool.

To create a PowerPoint presentation:
1. Use the Skill tool with skill_id="pptx"
2. Provide clear slide content
3. The Skill will return a file_id

Example:
User: "Create a 2-slide presentation about AI"
You: [Use Skill tool with skill_id="pptx" to generate the presentation]

DO NOT just describe what you would create - actually USE the Skill tool to create it.""",
            allowed_tools=["Skill"],
            setting_sources=["user", "project"],
        )

        tool_calls = []
        response_text = ""
        skill_invoked = False
        message_count = 0

        # Create SDK client and test
        print("[SKILL TEST] Creating SDK client...", flush=True)
        async with ClaudeSDKClient(options=options) as client:
            print("[SKILL TEST] Connecting to SDK...", flush=True)
            await client.connect()

            # Simple test prompt
            test_prompt = "Create a simple 2-slide PowerPoint presentation about testing. Slide 1: Title 'Test Presentation'. Slide 2: Content 'This is a test'."

            print(f"[SKILL TEST] Sending prompt: {test_prompt[:100]}...", flush=True)
            await client.query(test_prompt)

            # Collect responses
            print("[SKILL TEST] Starting to iterate over responses...", flush=True)
            async for message in client.receive_response():
                message_count += 1
                print(f"[SKILL TEST] Message #{message_count}: type={type(message).__name__}", flush=True)

                if hasattr(message, 'content') and isinstance(message.content, list):
                    print(f"[SKILL TEST] Processing {len(message.content)} content blocks", flush=True)
                    for idx, block in enumerate(message.content):
                        if not hasattr(block, 'type'):
                            print(f"[SKILL TEST] Block #{idx} missing type", flush=True)
                            continue

                        block_type = block.type
                        print(f"[SKILL TEST] Block #{idx}: type={block_type}", flush=True)

                        # Track text
                        if block_type == 'text' and hasattr(block, 'text'):
                            text_preview = block.text[:100] if block.text else ""
                            response_text += block.text
                            print(f"[SKILL TEST] Text block: {text_preview}...", flush=True)

                        # Track tool uses
                        elif block_type == 'tool_use':
                            tool_name = getattr(block, 'name', 'unknown')
                            tool_input = getattr(block, 'input', {})
                            tool_calls.append({
                                "tool": tool_name,
                                "input": str(tool_input)[:200]  # Truncate for safety
                            })
                            print(f"[SKILL TEST] Tool use: {tool_name}", flush=True)

                            if tool_name == "Skill":
                                skill_invoked = True
                                print(f"[SKILL TEST] ✅ Skill tool was invoked!", flush=True)

                        # Track tool results
                        elif block_type == 'tool_result':
                            tool_name = getattr(block, 'tool_name', 'unknown')
                            print(f"[SKILL TEST] Tool result from: {tool_name}", flush=True)
                else:
                    print(f"[SKILL TEST] Message has no content or content is not a list", flush=True)

            print(f"[SKILL TEST] Iteration complete: {message_count} messages received", flush=True)

        result = {
            "status": "success",
            "test_prompt": test_prompt,
            "tool_calls": tool_calls,
            "tool_count": len(tool_calls),
            "skill_invoked": skill_invoked,
            "response_text": response_text[:500] if response_text else "(no text response)",
            "response_length": len(response_text),
        }

        if skill_invoked:
            print("[SKILL TEST] ✅ SUCCESS: Skill tool was invoked", flush=True)
        else:
            print(f"[SKILL TEST] ⚠️ WARNING: Skill tool was NOT invoked. Agent called: {tool_calls}", flush=True)

        return result

    except Exception as e:
        print(f"[SKILL TEST] ❌ FAILED with exception: {e}", flush=True)
        import traceback
        return {
            "status": "error",
            "error": str(e),
            "traceback": traceback.format_exc()
        }


@router.post("/test-basic-sdk")
async def test_basic_sdk():
    """
    Test basic SDK functionality WITHOUT Skills.

    This will confirm:
    1. SDK can connect
    2. SDK can receive text responses
    3. SDK iterator works properly

    Returns basic response info.
    """
    from claude_agent_sdk import ClaudeSDKClient, ClaudeAgentOptions

    print("[BASIC SDK TEST] Starting...", flush=True)

    try:
        options = ClaudeAgentOptions(
            model="claude-sonnet-4-5",
            system_prompt="You are a helpful assistant. Respond concisely.",
            allowed_tools=[],  # NO tools, just basic chat
            setting_sources=["user", "project"],
        )

        response_text = ""
        message_count = 0

        async with ClaudeSDKClient(options=options) as client:
            print("[BASIC SDK TEST] Connecting...", flush=True)
            await client.connect()

            print("[BASIC SDK TEST] Sending simple prompt...", flush=True)
            await client.query("Say hello and count to 3.")

            print("[BASIC SDK TEST] Iterating responses...", flush=True)
            async for message in client.receive_response():
                message_count += 1
                print(f"[BASIC SDK TEST] Message #{message_count}", flush=True)

                if hasattr(message, 'content') and isinstance(message.content, list):
                    for block in message.content:
                        if hasattr(block, 'text'):
                            response_text += block.text
                            print(f"[BASIC SDK TEST] Got text: {block.text[:50]}...", flush=True)

            print(f"[BASIC SDK TEST] Complete: {message_count} messages, {len(response_text)} chars", flush=True)

        return {
            "status": "success",
            "message_count": message_count,
            "response_text": response_text,
            "response_length": len(response_text)
        }

    except Exception as e:
        print(f"[BASIC SDK TEST] FAILED: {e}", flush=True)
        import traceback
        return {
            "status": "error",
            "error": str(e),
            "traceback": traceback.format_exc()
        }


@router.post("/test-minimal-sdk")
async def test_minimal_sdk():
    """
    ABSOLUTE MINIMAL SDK TEST (Phase 1 - Core Hardening)

    Goal: Understand exact message structure from SDK
    - No tools
    - No MCP servers
    - No setting_sources
    - Just: query → receive_response → inspect structure

    This is the foundation for all other SDK functionality.
    """
    from claude_agent_sdk import ClaudeSDKClient, ClaudeAgentOptions

    print("[MINIMAL SDK] Starting...", flush=True)

    try:
        options = ClaudeAgentOptions(
            model="claude-sonnet-4-5",
            system_prompt="You are a helpful assistant.",
        )

        messages_received = []

        async with ClaudeSDKClient(options=options) as client:
            await client.connect()
            await client.query("Say hello and count to 3.")

            async for message in client.receive_response():
                msg_index = len(messages_received)
                msg_info = {
                    "index": msg_index,
                    "type": type(message).__name__,
                    "has_content": hasattr(message, 'content'),
                    "content_type": type(message.content).__name__ if hasattr(message, 'content') else None,
                }

                if hasattr(message, 'content'):
                    content = message.content
                    if isinstance(content, list):
                        msg_info["blocks"] = []
                        for idx, block in enumerate(content):
                            block_info = {
                                "type": type(block).__name__,
                                "has_type": hasattr(block, 'type'),
                                "has_text": hasattr(block, 'text'),
                            }
                            if hasattr(block, 'type'):
                                block_info["block_type"] = block.type
                            if hasattr(block, 'text'):
                                block_info["text"] = block.text
                            msg_info["blocks"].append(block_info)

                messages_received.append(msg_info)

        return {
            "status": "success",
            "message_count": len(messages_received),
            "messages": messages_received
        }

    except Exception as e:
        import traceback
        return {
            "status": "error",
            "error": str(e),
            "traceback": traceback.format_exc()
        }
