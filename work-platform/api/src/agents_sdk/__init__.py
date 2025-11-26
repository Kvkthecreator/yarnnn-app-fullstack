"""
Agent SDK - Official Anthropic Claude Agent SDK Integration for YARNNN

ALL AGENTS NOW USE OFFICIAL CLAUDE AGENT SDK (claude-agent-sdk>=0.1.8)

This package contains SDK-based agents that use:
- ClaudeSDKClient for session management and conversation continuity
- Native subagents via ClaudeAgentOptions.agents parameter
- Skills integration via setting_sources parameter
- SubstrateQueryAdapter for on-demand substrate queries (BFF pattern)
- Structured outputs via emit_work_output tool

Architecture (2025-11):
- Session: Agent SDK manages conversation history
- Substrate: Queried on-demand via SubstrateQueryAdapter.query()
- WorkBundle: Metadata + asset pointers only (NOT substrate blocks)

Agents (ALL using official SDK):
- ThinkingPartnerAgentSDK: Multi-agent orchestration gateway
- ResearchAgentSDK: Intelligence gathering with web search
- ContentAgentSDK: Creative text generation with platform specialists
- ReportingAgentSDK: Professional file generation with Skills
"""

from .thinking_partner_sdk import (
    ThinkingPartnerAgentSDK,
)

from .research_agent_sdk import (
    ResearchAgentSDK,
    create_research_agent_sdk,
)

from .content_agent_sdk import (
    ContentAgentSDK,
    create_content_agent_sdk,
)

from .reporting_agent_sdk import (
    ReportingAgentSDK,
    create_reporting_agent_sdk,
)

__all__ = [
    # Thinking Partner
    "ThinkingPartnerAgentSDK",
    # Research Agent
    "ResearchAgentSDK",
    "create_research_agent_sdk",
    # Content Agent
    "ContentAgentSDK",
    "create_content_agent_sdk",
    # Reporting Agent
    "ReportingAgentSDK",
    "create_reporting_agent_sdk",
]

__version__ = "3.0.0-official-sdk"
