"""
Thinking Partner Agent using Official Anthropic Claude Agent SDK

This is the NEW implementation using ClaudeSDKClient with proper session management.
Replaces the legacy thinking_partner.py which used raw AsyncAnthropic API.

Key improvements:
- Built-in session persistence via ClaudeSDKClient
- Proper conversation continuity (Claude remembers context)
- Official Anthropic SDK (no custom session hacks)
- Cleaner code (SDK handles complexity)

Usage:
    from agents_sdk.thinking_partner_sdk import ThinkingPartnerAgentSDK

    agent = ThinkingPartnerAgentSDK(
        basket_id="basket_123",
        workspace_id="ws_456",
        user_id="user_789"
    )

    # First message (creates new session)
    result = await agent.chat("I need LinkedIn content about AI")
    session_id = result["claude_session_id"]

    # Follow-up message (resumes session)
    result = await agent.chat(
        "Make it more professional",
        claude_session_id=session_id
    )
"""

import logging
import os
import json
from typing import Any, Dict, List, Optional
from uuid import uuid4

from claude_agent_sdk import ClaudeSDKClient, ClaudeAgentOptions, AgentDefinition

from adapters.substrate_adapter import SubstrateQueryAdapter
from shared.work_output_tools import EMIT_WORK_OUTPUT_TOOL, parse_work_outputs_from_response
from shared.session import AgentSession

logger = logging.getLogger(__name__)


# ============================================================================
# System Prompt
# ============================================================================

THINKING_PARTNER_SYSTEM_PROMPT = """You are the Thinking Partner - a meta-agent that orchestrates specialized agents and provides intelligent assistance to users.

**Your Role:**
You are the user's intelligent assistant for managing their knowledge workspace and agent workflows. You help users:
- Create content (LinkedIn posts, reports, articles)
- Conduct research (competitive intelligence, market analysis)
- Manage knowledge (organize insights, track patterns)
- Coordinate agent workflows (decide what agents to run, when)

**Gateway/Mirror/Meta Pattern:**
1. **Gateway**: You receive ALL user interaction via chat
2. **Mirror**: You orchestrate YARNNN infrastructure via tools
3. **Meta**: You emit your own intelligence (insights, recommendations)

**Your Capabilities:**

**Specialist Subagents (for quick read-only queries)**:
- **research_specialist**: Fast answers from existing knowledge ("What do we know about X?")
- **content_specialist**: Content guidance and style advice from past outputs
- **reporting_specialist**: Data insights and reporting guidance from past reports

These subagents are LIGHTWEIGHT - they query memory and provide instant answers.
Use them for conversational queries that don't need new work.

**Tools Available (for tracked work)**:
1. **work_orchestration**: Delegate to specialist agents (creates work_requests/work_tickets)
   - research: Deep analysis, web search, competitive intelligence (uses ResearchAgentSDK)
   - content: LinkedIn posts, articles, creative content (uses ContentAgentSDK)
   - reporting: PDF reports, Excel dashboards, file generation (uses ReportingAgentSDK)

2. **infra_reader**: Query YARNNN orchestration state
   - Check work_requests, work_tickets, work_outputs
   - Review agent_sessions, execution history
   - Access work completion status

3. **steps_planner**: Plan multi-step workflows
   - Break down complex requests into steps
   - Decide agent sequences
   - Optimize execution order

4. **emit_work_output**: Emit your own insights
   - Pattern recognition ("I notice...")
   - Recommendations ("You should...")
   - Meta-insights (system-level intelligence)

**Memory & Context Architecture:**

**IMPORTANT**: You do NOT have automatic memory access during chat phase.
Memory queries happen at the STAGING BOUNDARY when creating work requests.

**Three-Phase Pattern:**
1. **Chat Phase (Current)**: You collect requirements via natural conversation
   - NO substrate queries happen here
   - Claude SDK session handles conversation history
   - You rely on user input and prior conversation context

2. **Staging Phase (work_orchestration tool)**: Context loading at boundary
   - Substrate blocks loaded (long-term knowledge base)
   - Reference assets loaded (task-specific resources)
   - Agent config loaded (agent settings)
   - Everything bundled together for specialist

3. **Delegation Phase**: Specialist receives complete bundle
   - Agent gets pre-loaded context (NO queries during execution)
   - Agent executes with full context
   - Work outputs returned to you

**Your Approach:**

When user makes a request:
1. **Understand Intent**: What does user want?
2. **Collect Requirements**: Natural conversation to gather details
   - What platform? (for content)
   - What format? (for reports)
   - What priority? (for work orchestration)
   - Any specific requirements?
3. **Check Work State**: Any relevant ongoing/past work? (infra_reader if needed)
4. **Decide Action** (KEY DECISION):
   - **Quick query?** → Use specialist subagent (research_specialist, content_specialist, reporting_specialist)
     * "What do we know about X?" → research_specialist
     * "What content style works best?" → content_specialist
     * "What are our key metrics?" → reporting_specialist
   - **New work needed?** → Use work_orchestration tool (triggers STAGING + DELEGATION)
     * "Research competitors" → work_orchestration(agent_type="research")
       * STAGING: Loads substrate blocks, reference assets, config
       * DELEGATION: Passes bundle to ResearchAgentSDK
     * "Create LinkedIn post" → work_orchestration(agent_type="content")
       * STAGING: Loads substrate blocks (brand voice examples), assets, config
       * DELEGATION: Passes bundle to ContentAgentSDK
     * "Generate report" → work_orchestration(agent_type="reporting")
       * STAGING: Loads substrate blocks (data), assets, config
       * DELEGATION: Passes bundle to ReportingAgentSDK
   - **Complex workflow?** → Use steps_planner, then work_orchestration for each step
5. **Execute & Synthesize**: Run agent(s), combine outputs intelligently
6. **Emit Meta-Intelligence**: Any patterns worth noting? (emit_work_output)

**Decision Matrix:**
- User wants ANSWER from existing knowledge → Specialist subagent (fast, no work_request)
- User wants NEW DELIVERABLE (content, research, report) → work_orchestration tool (tracked, staged)
- User wants guidance/advice → Direct answer or specialist subagent
- User wants multi-step execution → steps_planner + work_orchestration

**Conversation Style:**
- Conversational, not robotic
- Proactive: Suggest what might be helpful
- Transparent: Explain your reasoning ("I'll create a work request for research")
- Efficient: Don't re-run work unnecessarily
- Pattern-aware: Notice user preferences

**Important:**
- You do NOT query substrate during chat - context loading happens at staging boundary
- Collect ALL requirements during chat phase before calling work_orchestration
- Explain what you're doing and why
- Ask for clarification when intent is ambiguous
- Specialist subagents query memory (read-only, fast - for quick answers)
- work_orchestration tool triggers staging + delegation (for new deliverables)
- Emit insights about patterns you notice (user preferences, recurring topics)
"""


# ============================================================================
# Specialist Subagent Definitions (for quick read-only queries)
# ============================================================================

RESEARCH_SPECIALIST = AgentDefinition(
    description="Quick research queries and knowledge lookups. Use for fast answers from existing knowledge. Does NOT create work_requests.",
    prompt="""You are a research specialist for quick knowledge queries.

**Your Role**: Provide fast answers to research questions using EXISTING knowledge only.

**When to Use You**:
- User asks "What do we know about X?"
- Quick fact lookups from substrate
- Summarizing existing research outputs
- Checking recent findings

**What You DO**:
- Query memory for relevant blocks/documents
- Synthesize existing knowledge
- Provide concise, sourced answers
- Cite block IDs for provenance

**What You DON'T DO**:
- Run new web searches (that requires work_orchestration tool!)
- Create work_outputs (read-only mode)
- Make API calls to external services
- Generate new research (that's for ResearchAgent via work_orchestration)

**Your Approach**:
1. Query memory with user's question
2. Find relevant blocks/documents
3. Synthesize answer with citations
4. Return: "Based on [block_123], we know X..."

You're for SPEED - answering from what we already know."""
)

CONTENT_SPECIALIST = AgentDefinition(
    description="Quick content guidance and style advice. Use for content questions that don't need new drafts. Does NOT create work_requests.",
    prompt="""You are a content specialist for quick content guidance.

**Your Role**: Provide fast content advice using EXISTING knowledge only.

**When to Use You**:
- User asks "What content style works best for us?"
- Quick review of past content performance
- Platform best practice reminders
- Brand voice guidance from examples

**What You DO**:
- Query memory for past content outputs
- Analyze what performed well
- Provide platform-specific advice
- Remind user of brand voice patterns

**What You DON'T DO**:
- Create new content drafts (that requires work_orchestration tool!)
- Generate posts/articles (that's for ContentAgent via work_orchestration)
- Make content creation decisions
- Produce deliverables

**Your Approach**:
1. Query memory for relevant content examples
2. Identify patterns (tone, format, engagement)
3. Provide actionable guidance
4. Return: "Based on your past LinkedIn posts, your voice is..."

You're for GUIDANCE - helping user understand their content strategy."""
)

REPORTING_SPECIALIST = AgentDefinition(
    description="Quick data insights and reporting guidance. Use for data questions that don't need new reports. Does NOT create work_requests.",
    prompt="""You are a reporting specialist for quick data insights.

**Your Role**: Provide fast data analysis using EXISTING knowledge only.

**When to Use You**:
- User asks "What metrics are important?"
- Quick review of past reports
- Data interpretation help
- Reporting format recommendations

**What You DO**:
- Query memory for past report outputs
- Summarize key metrics and trends
- Provide data interpretation guidance
- Suggest report structures

**What You DON'T DO**:
- Generate new reports/files (that requires work_orchestration tool!)
- Create charts/dashboards (that's for ReportingAgent via work_orchestration)
- Process raw data
- Produce deliverables

**Your Approach**:
1. Query memory for relevant data/reports
2. Identify key metrics and patterns
3. Provide analytical insights
4. Return: "Looking at your past reports, the key KPIs are..."

You're for INSIGHTS - helping user understand their data landscape."""
)


# ============================================================================
# ThinkingPartnerAgentSDK Class
# ============================================================================

class ThinkingPartnerAgentSDK:
    """
    Thinking Partner using Official Anthropic Claude Agent SDK.

    Features:
    - ClaudeSDKClient for built-in session management
    - Conversation continuity across multiple exchanges
    - Tool integration (work_orchestration, infra_reader, etc.)
    - Substrate access via SubstrateQueryAdapter (on-demand queries)
    """

    def __init__(
        self,
        basket_id: str,
        workspace_id: str,
        user_id: str,
        user_token: Optional[str] = None,  # NEW: User JWT token for substrate-API auth
        anthropic_api_key: Optional[str] = None,
        model: str = "claude-sonnet-4-5",
    ):
        """
        Initialize ThinkingPartnerAgentSDK.

        Args:
            basket_id: Basket ID for substrate queries
            workspace_id: Workspace ID for authorization
            user_id: User ID for personalization
            user_token: User JWT token for substrate-API authentication
            anthropic_api_key: Anthropic API key (from env if None)
            model: Claude model to use
        """
        self.basket_id = basket_id
        self.workspace_id = workspace_id
        self.user_id = user_id
        self.user_token = user_token
        self.model = model

        # NO substrate adapter for TP chat phase
        # Substrate queries happen during staging phase (work_orchestration tool)
        # Specialists get SubstrateQueryAdapter when delegated
        self.substrate = None
        logger.info(f"TP initialized (chat-only mode, substrate queries happen at staging)")

        # Get API key
        if anthropic_api_key is None:
            anthropic_api_key = os.getenv("ANTHROPIC_API_KEY")
            if not anthropic_api_key:
                raise ValueError("ANTHROPIC_API_KEY required")

        self.api_key = anthropic_api_key

        # Track current AgentSession (for work ticket linking)
        self.current_session: Optional[AgentSession] = None

        # Cache for specialist sessions (hierarchical session management)
        self._specialist_sessions: Dict[str, Optional[AgentSession]] = {
            "research": None,
            "content": None,
            "reporting": None
        }

        # Build agent options
        self._options = self._build_options()

        logger.info(
            f"ThinkingPartnerAgentSDK initialized: basket={basket_id}, "
            f"workspace={workspace_id}, user={user_id}, "
            f"subagents=['research_specialist', 'content_specialist', 'reporting_specialist'], "
            f"tools=['work_orchestration', 'infra_reader', 'steps_planner', 'emit_work_output']"
        )

    async def _load_specialist_sessions(self) -> None:
        """
        Load existing specialist sessions for this basket.

        Called after TP session is created to populate _specialist_sessions cache
        with any existing child sessions.

        This enables TP to resume conversations with specialists across multiple
        work_requests.
        """
        if not self.current_session or not self.current_session.id:
            logger.warning("Cannot load specialist sessions: TP session not initialized")
            return

        try:
            from app.utils.supabase import supabase_admin
            supabase = supabase_admin()

            # Query for specialist sessions that are children of TP session
            result = supabase.table("agent_sessions").select("*").eq(
                "basket_id", self.basket_id
            ).eq(
                "parent_session_id", self.current_session.id
            ).execute()

            # Populate cache
            for session_data in result.data:
                agent_type = session_data.get('agent_type')
                if agent_type in self._specialist_sessions:
                    self._specialist_sessions[agent_type] = AgentSession(**session_data)
                    logger.info(
                        f"Loaded specialist session: {agent_type} "
                        f"(session_id={session_data['id']})"
                    )

            logger.info(
                f"Loaded {len([s for s in self._specialist_sessions.values() if s])} "
                f"specialist sessions for TP session {self.current_session.id}"
            )

        except Exception as e:
            logger.error(f"Failed to load specialist sessions: {e}", exc_info=True)
            # Non-critical error - TP can still create new sessions on-demand

    async def _get_or_create_specialist_session(
        self,
        agent_type: str
    ) -> AgentSession:
        """
        Get or create persistent specialist session as child of TP.

        This implements hierarchical session management:
        - Each specialist (research, content, reporting) has ONE persistent session per basket
        - Specialist sessions are children of TP session (parent_session_id → TP)
        - Specialist sessions accumulate conversation history across work_requests
        - TP grants memory access to specialists when delegating

        Args:
            agent_type: Specialist agent type ('research', 'content', 'reporting')

        Returns:
            AgentSession instance for the specialist (loaded from DB or newly created)

        Raises:
            ValueError: If agent_type not recognized or TP session not initialized
            RuntimeError: If database operations fail
        """
        if agent_type not in self._specialist_sessions:
            raise ValueError(f"Unknown agent_type: {agent_type}")

        if not self.current_session or not self.current_session.id:
            raise ValueError("Cannot create specialist session: TP session not initialized")

        # Check cache first
        if self._specialist_sessions[agent_type]:
            logger.info(f"Using cached {agent_type} session")
            return self._specialist_sessions[agent_type]

        # Get or create specialist session
        try:
            specialist_session = await AgentSession.get_or_create(
                basket_id=self.basket_id,
                workspace_id=self.workspace_id,
                agent_type=agent_type,
                user_id=self.user_id
            )

            # Link to TP as parent if not already linked
            if not specialist_session.parent_session_id:
                specialist_session.parent_session_id = self.current_session.id
                specialist_session.created_by_session_id = self.current_session.id
                await specialist_session.save()
                logger.info(
                    f"Linked {agent_type} session to TP parent: "
                    f"{specialist_session.id} → {self.current_session.id}"
                )

            # Cache for future use
            self._specialist_sessions[agent_type] = specialist_session

            logger.info(
                f"Got specialist session: {agent_type} "
                f"(session_id={specialist_session.id}, "
                f"parent={specialist_session.parent_session_id})"
            )

            return specialist_session

        except Exception as e:
            logger.error(f"Failed to get_or_create specialist session: {e}", exc_info=True)
            raise RuntimeError(f"Specialist session creation failed: {e}") from e

    def _build_options(self) -> ClaudeAgentOptions:
        """Build ClaudeAgentOptions with tools, subagents, and configuration."""
        # Build specialist subagents for quick read-only queries
        subagents = {
            "research_specialist": RESEARCH_SPECIALIST,
            "content_specialist": CONTENT_SPECIALIST,
            "reporting_specialist": REPORTING_SPECIALIST,
        }

        # NOTE: ClaudeAgentOptions does NOT have a 'tools' parameter in official SDK v0.1.8+
        # Tools must be registered via mcp_servers parameter with @tool decorator
        # For now, TP works with native subagents only (no custom tools)
        # max_tokens is controlled at the ClaudeSDKClient.chat() level, not in options
        return ClaudeAgentOptions(
            model=self.model,
            system_prompt=self._get_system_prompt(),
            agents=subagents,  # Native subagents for quick queries!
        )

    def _get_system_prompt(self) -> str:
        """Get Thinking Partner system prompt with current context."""
        prompt = THINKING_PARTNER_SYSTEM_PROMPT

        # Add context about current state
        prompt += f"""

**Current Context:**
- Basket ID: {self.basket_id}
- Workspace ID: {self.workspace_id}
- User ID: {self.user_id}
- Substrate: {"Available" if self.substrate else "Queries at staging boundary"}
"""
        return prompt

    def _create_work_orchestration_tool(self) -> Dict[str, Any]:
        """Tool for delegating to specialized agents."""
        return {
            "name": "work_orchestration",
            "description": """Delegate work to specialized agents.

Available agents:
- research: Deep analysis, competitive intelligence, web monitoring, market research
- content: LinkedIn posts, articles, creative content creation
- reporting: Data visualization, analytics dashboards, synthesis reports

Use this when user requests work that requires specialized capabilities.
The agent will execute and return structured work_outputs for review.

Examples:
- "Research AI agent pricing" → research agent
- "Create LinkedIn post about..." → content agent
- "Analyze Q4 metrics" → reporting agent
""",
            "input_schema": {
                "type": "object",
                "properties": {
                    "agent_type": {
                        "type": "string",
                        "enum": ["research", "content", "reporting"],
                        "description": "Which specialized agent to use"
                    },
                    "task": {
                        "type": "string",
                        "description": "Clear task description for the agent"
                    },
                    "parameters": {
                        "type": "object",
                        "description": "Optional agent-specific parameters",
                        "properties": {
                            "research_depth": {"type": "string", "enum": ["quick", "deep"]},
                            "platform": {"type": "string"},
                            "style": {"type": "string"},
                        }
                    }
                },
                "required": ["agent_type", "task"]
            }
        }

    def _create_infra_reader_tool(self) -> Dict[str, Any]:
        """Tool for querying YARNNN orchestration infrastructure."""
        return {
            "name": "infra_reader",
            "description": """Query YARNNN work orchestration state.

Use this to check:
- Recent work_requests (what user asked for)
- Work_tickets status (pending, running, completed, failed)
- Work_outputs (deliverables from agents)
- Agent_sessions (active agent conversations)
- Execution history (what's been done)

Useful before delegating to agents to avoid redundant work.

Examples:
- Check if we have recent research on a topic
- See status of ongoing work
- Review past outputs for context
""",
            "input_schema": {
                "type": "object",
                "properties": {
                    "query_type": {
                        "type": "string",
                        "enum": [
                            "recent_work_requests",
                            "work_tickets_by_status",
                            "work_outputs_by_type",
                            "agent_sessions",
                            "work_history"
                        ],
                        "description": "What infrastructure data to query"
                    },
                    "filters": {
                        "type": "object",
                        "description": "Optional filters",
                        "properties": {
                            "agent_type": {"type": "string"},
                            "status": {"type": "string"},
                            "output_type": {"type": "string"},
                            "limit": {"type": "integer"},
                        }
                    }
                },
                "required": ["query_type"]
            }
        }

    def _create_steps_planner_tool(self) -> Dict[str, Any]:
        """Tool for planning multi-step workflows."""
        return {
            "name": "steps_planner",
            "description": """Plan multi-step workflows for complex requests.

Use this when user request requires multiple agents or steps.

The planner will:
1. Break down request into logical steps
2. Decide which agents to use for each step
3. Determine dependencies (sequential vs parallel)
4. Optimize execution order

Returns execution plan you can follow.

Examples:
- "Research competitors then create content" → 2 steps (research → content)
- "Analyze metrics and create report" → 2 steps (reporting → content)
""",
            "input_schema": {
                "type": "object",
                "properties": {
                    "user_request": {
                        "type": "string",
                        "description": "The user's complex request"
                    },
                    "existing_context": {
                        "type": "string",
                        "description": "Relevant context from memory or infrastructure"
                    }
                },
                "required": ["user_request"]
            }
        }

    async def _load_reference_assets(self, agent_type: str) -> list:
        """
        Load reference assets (task-specific resources) during staging.

        Args:
            agent_type: "research" | "content" | "reporting"

        Returns:
            List of asset dicts
        """
        try:
            from clients.substrate_client import SubstrateClient

            logger.debug(f"Staging: Loading reference assets for basket={self.basket_id}, agent_type={agent_type}")
            client = SubstrateClient(user_token=self.user_token)
            assets = client.get_reference_assets(
                basket_id=self.basket_id,
                agent_type=agent_type,
                work_ticket_id=None,
                permanence="permanent"
            )
            logger.info(f"Staging: Loaded {len(assets)} reference assets for {agent_type}")
            return assets
        except Exception as e:
            logger.error(f"Failed to load reference assets (basket={self.basket_id}, agent={agent_type}): {e}", exc_info=True)
            return []

    async def _load_agent_config(self, agent_type: str) -> dict:
        """
        Load agent configuration from work-platform database during staging.

        Args:
            agent_type: "research" | "content" | "reporting"

        Returns:
            Agent config dict
        """
        try:
            from app.utils.supabase_client import supabase_admin_client

            # Query agent_sessions for state/metadata (config was removed in Phase 2e)
            response = supabase_admin_client.table("agent_sessions").select(
                "state, metadata"
            ).eq("basket_id", self.basket_id).eq(
                "agent_type", agent_type
            ).limit(1).execute()

            if response.data and len(response.data) > 0:
                # Merge state and metadata as config replacement
                state = response.data[0].get("state", {})
                metadata = response.data[0].get("metadata", {})
                config = {**state, **metadata}

                if config:
                    logger.info(f"Staging: Loaded state/metadata for {agent_type}")
                return config
            return {}
        except Exception as e:
            logger.warning(f"Failed to load agent session state: {e}")
            return {}

    async def _execute_work_orchestration(self, tool_input: Dict[str, Any]) -> str:
        """
        Execute work_orchestration tool - STAGING + DELEGATION.

        NEW PATTERN (Work Request Roll-Up + Staging):
        Phase 1 (Chat): User requirements collected via natural conversation
        Phase 2 (STAGING - THIS METHOD):
            - Load substrate blocks (long-term knowledge) ← Query 1
            - Load reference assets (task-specific) ← Query 2
            - Load agent config (agent settings) ← Query 3
            - Create work_request + work_ticket
            - Bundle everything into WorkBundle
        Phase 3 (Delegation):
            - Pass complete bundle to specialist agent
            - Agent executes with pre-loaded context (NO substrate queries!)
            - Return work_outputs to TP

        Hierarchical Session Pattern:
        - TP session is parent (agent_type="thinking_partner")
        - Specialist sessions are children (parent_session_id → TP)
        - Each specialist maintains conversation continuity across work_requests

        Args:
            tool_input: {agent_type, task, parameters}

        Returns:
            JSON string with execution results for Claude to continue reasoning
        """
        agent_type = tool_input.get('agent_type')
        task = tool_input.get('task')
        parameters = tool_input.get('parameters', {})

        logger.info(f"Executing work_orchestration: agent_type={agent_type}, task={task[:100]}")

        try:
            # ================================================================
            # PHASE 2: STAGING - Create context adapters + load metadata
            # ================================================================

            logger.info(f"STAGING PHASE: Creating context for {agent_type} work request")

            # Create SubstrateQueryAdapter for on-demand substrate access
            # (agents query substrate lazily, not pre-loaded)
            from adapters.substrate_adapter import SubstrateQueryAdapter
            substrate_adapter = SubstrateQueryAdapter(
                basket_id=self.basket_id,
                workspace_id=self.workspace_id,
                user_token=self.user_token,
                agent_type=agent_type,
            )

            # Load reference assets (task-specific resources)
            reference_assets = await self._load_reference_assets(agent_type)

            # Load agent configuration (agent settings)
            agent_config = await self._load_agent_config(agent_type)

            logger.info(
                f"STAGING COMPLETE: SubstrateQueryAdapter created, "
                f"{len(reference_assets)} assets, config={bool(agent_config)}"
            )

            # ================================================================
            # Create work_request and work_ticket for tracking
            # ================================================================

            # Get or create persistent specialist session as child of TP
            specialist_session = await self._get_or_create_specialist_session(agent_type)

            # Create work_ticket for output tracking
            from app.routes.work_orchestration import _create_work_ticket

            task_intent = f"{agent_type}:{task[:100]}"
            work_ticket_id = await _create_work_ticket(
                basket_id=self.basket_id,
                workspace_id=self.workspace_id,
                user_id=self.user_id,
                agent_type=agent_type,
                task_intent=task_intent
            )

            # Create work_request record (links to TP session)
            from app.utils.supabase_client import supabase_admin_client

            work_request_data = {
                "basket_id": self.basket_id,
                "workspace_id": self.workspace_id,
                "user_id": self.user_id,
                "agent_type": agent_type,
                "agent_session_id": self.current_session.id,  # Links to TP session!
                "work_mode": "autonomous",
                "request_intent": task_intent,
                "priority": priority,
                "status": "pending"
            }

            response = supabase_admin_client.table("work_requests").insert(
                work_request_data
            ).execute()

            if not response.data or len(response.data) == 0:
                raise Exception("Failed to create work_request")

            work_request_id = response.data[0]["id"]
            logger.info(f"Created work_request: {work_request_id}")

            # ================================================================
            # Create WorkBundle (metadata only - NO substrate_blocks)
            # ================================================================

            from agents_sdk.work_bundle import WorkBundle

            bundle = WorkBundle(
                work_request_id=work_request_id,
                work_ticket_id=work_ticket_id,
                basket_id=self.basket_id,
                workspace_id=self.workspace_id,
                user_id=self.user_id,
                task=task,
                agent_type=agent_type,
                priority=priority,
                reference_assets=reference_assets,
                agent_config=agent_config,
                user_requirements=parameters  # Additional params from chat
            )

            logger.info(f"WorkBundle created (metadata only):\n{bundle.get_context_summary()}")

            # ================================================================
            # PHASE 3: DELEGATION - Pass bundle to specialist agent
            # ================================================================

            logger.info(f"DELEGATION PHASE: Executing {agent_type} with pre-loaded context")

            # Import specialist agents SDK
            from agents_sdk import ResearchAgentSDK, ContentAgentSDK, ReportingAgentSDK
            from work_orchestration import KnowledgeModuleLoader

            # Load knowledge modules for specialist
            km_loader = KnowledgeModuleLoader()
            knowledge_modules = km_loader.load_for_agent(agent_type)

            # Execute specialist agent with substrate adapter + bundle
            result = None

            if agent_type == "research":
                agent = ResearchAgentSDK(
                    basket_id=self.basket_id,
                    workspace_id=self.workspace_id,
                    work_ticket_id=work_ticket_id,
                    knowledge_modules=knowledge_modules,
                    session=specialist_session,  # Persistent session from TP!
                    substrate=substrate_adapter,  # On-demand substrate queries!
                    bundle=bundle  # Metadata-only bundle!
                )
                # Execute with session resumption
                result = await agent.deep_dive(
                    topic=task,
                    claude_session_id=specialist_session.sdk_session_id  # Resume conversation!
                )

            elif agent_type == "content":
                platform = parameters.get('platform', 'linkedin')
                content_type = parameters.get('content_type', 'post')

                agent = ContentAgentSDK(
                    basket_id=self.basket_id,
                    workspace_id=self.workspace_id,
                    work_ticket_id=work_ticket_id,
                    knowledge_modules=knowledge_modules,
                    session=specialist_session,
                    substrate=substrate_adapter,  # On-demand substrate queries!
                    bundle=bundle
                )
                result = await agent.create(
                    platform=platform,
                    topic=task,
                    content_type=content_type,
                    claude_session_id=specialist_session.sdk_session_id
                )

            elif agent_type == "reporting":
                report_format = parameters.get('format', 'pdf')

                agent = ReportingAgentSDK(
                    basket_id=self.basket_id,
                    workspace_id=self.workspace_id,
                    work_ticket_id=work_ticket_id,
                    knowledge_modules=knowledge_modules,
                    session=specialist_session,
                    substrate=substrate_adapter,  # On-demand substrate queries!
                    bundle=bundle
                )
                result = await agent.generate(
                    report_type=task,
                    output_format=report_format,
                    claude_session_id=specialist_session.sdk_session_id
                )

            else:
                raise ValueError(f"Unknown agent_type: {agent_type}")

            # Extract work_outputs from result
            work_outputs = result.get('work_outputs', [])

            response = {
                "status": "success",
                "agent_type": agent_type,
                "task": task,
                "work_outputs_count": len(work_outputs),
                "work_outputs": work_outputs[:3],  # Return first 3 for context
                "work_request_id": work_request_id,
                "work_ticket_id": work_ticket_id,
                "specialist_session_id": specialist_session.id,
                "claude_session_id": specialist_session.sdk_session_id,
                "context_loaded": {
                    "substrate_adapter": True,
                    "reference_assets": len(reference_assets),
                    "agent_config": bool(agent_config)
                },
                "message": f"Agent {agent_type} completed with {len(work_outputs)} outputs (on-demand substrate)"
            }

            logger.info(
                f"work_orchestration SUCCESS: {agent_type} produced {len(work_outputs)} outputs "
                f"(SubstrateQueryAdapter + {len(reference_assets)} assets, "
                f"session={specialist_session.id}, parent={specialist_session.parent_session_id})"
            )
            return json.dumps(response)

        except Exception as e:
            logger.error(f"work_orchestration FAILED: {e}", exc_info=True)
            return json.dumps({
                "status": "error",
                "agent_type": agent_type,
                "error": str(e),
                "message": f"Failed to execute {agent_type} agent: {str(e)}"
            })

    async def _execute_infra_reader(self, tool_input: Dict[str, Any]) -> str:
        """
        Execute infra_reader tool - queries work orchestration state.

        Args:
            tool_input: {query_type, filters}

        Returns:
            JSON string with query results
        """
        query_type = tool_input.get('query_type')
        filters = tool_input.get('filters', {})

        logger.info(f"Executing infra_reader: query_type={query_type}, filters={filters}")

        try:
            from app.utils.supabase import supabase_admin

            supabase = supabase_admin()
            results = []

            if query_type == "recent_work_requests":
                limit = filters.get('limit', 10)
                response = supabase.table("work_requests").select(
                    "id, agent_type, work_mode, status, created_at"
                ).eq("basket_id", self.basket_id).order(
                    "created_at", desc=True
                ).limit(limit).execute()
                results = response.data

            elif query_type == "work_tickets_by_status":
                status = filters.get('status', 'completed')
                response = supabase.table("work_tickets").select(
                    "id, task_type, status, started_at, ended_at"
                ).eq("basket_id", self.basket_id).eq("status", status).limit(10).execute()
                results = response.data

            elif query_type == "agent_sessions":
                response = supabase.table("agent_sessions").select(
                    "id, agent_type, last_active_at, created_at"
                ).eq("basket_id", self.basket_id).execute()
                results = response.data

            return json.dumps({
                "status": "success",
                "query_type": query_type,
                "results_count": len(results),
                "results": results[:5]  # Limit to avoid token overflow
            })

        except Exception as e:
            logger.error(f"infra_reader FAILED: {e}", exc_info=True)
            return json.dumps({
                "status": "error",
                "query_type": query_type,
                "error": str(e)
            })

    async def _execute_steps_planner(self, tool_input: Dict[str, Any]) -> str:
        """
        Execute steps_planner tool - plans multi-step workflows.

        Uses Claude to generate execution plan.

        Args:
            tool_input: {user_request, existing_context}

        Returns:
            JSON string with execution plan
        """
        user_request = tool_input.get('user_request')
        existing_context = tool_input.get('existing_context', '')

        logger.info(f"Executing steps_planner: request={user_request[:100]}")

        try:
            # Use Claude to generate plan
            planning_prompt = f"""Given this user request:
"{user_request}"

Existing context:
{existing_context}

Create a structured execution plan with steps, agents, and dependencies.

Return JSON format:
{{
  "steps": [
    {{"step_num": 1, "agent": "research", "task": "...", "dependencies": []}},
    {{"step_num": 2, "agent": "content", "task": "...", "dependencies": [1]}}
  ]
}}"""

            from anthropic import AsyncAnthropic
            client = AsyncAnthropic(api_key=os.getenv("ANTHROPIC_API_KEY"))

            response = await client.messages.create(
                model="claude-sonnet-4-5",
                max_tokens=2000,
                messages=[{"role": "user", "content": planning_prompt}]
            )

            plan_text = response.content[0].text

            return json.dumps({
                "status": "success",
                "user_request": user_request,
                "plan": plan_text
            })

        except Exception as e:
            logger.error(f"steps_planner FAILED: {e}", exc_info=True)
            return json.dumps({
                "status": "error",
                "error": str(e)
            })

    async def chat(
        self,
        user_message: str,
        claude_session_id: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Handle user chat message with session management.

        This is the primary interface for Thinking Partner.

        Args:
            user_message: User's message
            claude_session_id: Optional session to resume

        Returns:
            {
                "message": str,  # TP's response
                "claude_session_id": str,  # For resumption (NEW - actually works!)
                "session_id": str,  # AgentSession ID
                "work_outputs": List[dict],  # Any outputs TP emitted
                "actions_taken": List[str]  # What TP did
            }
        """
        logger.info(f"TP chat (SDK): {user_message[:100]}")

        # Start or resume AgentSession (for work ticket linking)
        if not self.current_session:
            # Use database-backed session management
            self.current_session = await AgentSession.get_or_create(
                basket_id=self.basket_id,
                workspace_id=self.workspace_id,
                agent_type="thinking_partner",
                user_id=self.user_id
            )
            logger.info(f"Initialized TP session: {self.current_session.id}")

            # Load existing specialist sessions (hierarchical)
            await self._load_specialist_sessions()

        # NO automatic memory loading during chat phase
        # Memory queries happen during staging phase (work_orchestration tool)
        # TP chat relies on Claude SDK session for conversation history
        full_prompt = user_message

        # Create SDK client with options
        # NOTE: api_key comes from ANTHROPIC_API_KEY env var (SDK reads it automatically)
        # See: https://docs.claude.com/en/docs/agent-sdk/python#environment-setup
        async with ClaudeSDKClient(
            options=self._options
        ) as client:
            # Connect with initial prompt
            if claude_session_id:
                # Resume existing session
                logger.info(f"Resuming Claude session: {claude_session_id}")
                await client.connect(session_id=claude_session_id)
            else:
                # Start new session
                await client.connect()

            # Send query
            await client.query(full_prompt)

            # Collect responses
            response_text = ""
            actions_taken = []
            work_outputs = []

            async for message in client.receive_response():
                logger.debug(f"SDK message type: {type(message).__name__}")

                # Extract text content
                if hasattr(message, 'text'):
                    response_text += message.text

                # Process content blocks (text, tool_use, tool_result)
                if hasattr(message, 'content') and isinstance(message.content, list):
                    for block in message.content:
                        if not hasattr(block, 'type'):
                            continue

                        block_type = block.type
                        logger.debug(f"SDK block type: {block_type}")

                        # Text blocks
                        if hasattr(block, 'text'):
                            response_text += block.text

                        # Tool use blocks - EXECUTE CUSTOM TOOLS
                        elif block_type == 'tool_use':
                            tool_name = getattr(block, 'name', 'unknown')
                            tool_input = getattr(block, 'input', {})
                            tool_id = getattr(block, 'id', None)

                            actions_taken.append(f"Used tool: {tool_name}")
                            logger.info(f"TP used tool: {tool_name} with input: {tool_input}")

                            # NOTE: Custom tools (work_orchestration, infra_reader, steps_planner)
                            # should be registered as MCP servers, NOT manually executed here.
                            # Manually calling client.query() interferes with SDK's tool execution flow
                            # and causes the receive_response() loop to hang waiting for responses.
                            #
                            # For now, we just log that these tools were used.
                            # TODO: Migrate these to proper MCP servers like we did for specialist agents.
                            if tool_name in ('work_orchestration', 'infra_reader', 'steps_planner'):
                                logger.warning(
                                    f"Tool {tool_name} called but not registered as MCP server. "
                                    f"This tool will not execute. Migrate to MCP pattern."
                                )

                        # Tool result blocks (CRITICAL - extract work outputs)
                        elif block_type == 'tool_result':
                            tool_name = getattr(block, 'tool_name', '')
                            logger.debug(f"Tool result from: {tool_name}")

                            if tool_name == 'emit_work_output':
                                try:
                                    result_content = getattr(block, 'content', None)
                                    if result_content:
                                        # Parse work output from tool result
                                        import json
                                        if isinstance(result_content, str):
                                            output_data = json.loads(result_content)
                                        else:
                                            output_data = result_content

                                        work_outputs.append(output_data)
                                        logger.info(f"Captured work output: {output_data.get('title', 'untitled')}")
                                except Exception as e:
                                    logger.error(f"Failed to parse work output: {e}", exc_info=True)

            # Get session ID from client
            new_session_id = getattr(client, 'session_id', None)
            logger.debug(f"Session ID retrieved: {new_session_id}")

            # Persist session ID to database for resumption
            if new_session_id and self.current_session:
                self.current_session.update_claude_session(new_session_id)
                logger.info(f"Stored Claude session: {new_session_id}")

            result = {
                "message": response_text or "Processing...",
                "claude_session_id": new_session_id,
                "session_id": self.current_session.id if self.current_session else None,
                "work_outputs": work_outputs,
                "actions_taken": actions_taken,
            }

            logger.info(
                f"TP chat complete (SDK): {len(response_text)} chars, "
                f"{len(actions_taken)} actions"
            )

            return result

    def _start_session(self) -> AgentSession:
        """Start a new agent session."""
        session = AgentSession(
            agent_id=f"thinking_partner_{self.user_id}",
            claude_ticket_id=None,  # SDK manages this now
            metadata={
                "agent_type": "thinking_partner",
                "basket_id": self.basket_id,
                "workspace_id": self.workspace_id,
                "user_id": self.user_id,
            }
        )
        return session


# ============================================================================
# Convenience Functions
# ============================================================================

def create_thinking_partner_sdk(
    basket_id: str,
    workspace_id: str,
    user_id: str,
    **kwargs
) -> ThinkingPartnerAgentSDK:
    """
    Convenience factory for creating ThinkingPartnerAgentSDK.

    Args:
        basket_id: Basket ID
        workspace_id: Workspace ID
        user_id: User ID
        **kwargs: Additional arguments for ThinkingPartnerAgentSDK

    Returns:
        Configured ThinkingPartnerAgentSDK instance
    """
    return ThinkingPartnerAgentSDK(
        basket_id=basket_id,
        workspace_id=workspace_id,
        user_id=user_id,
        **kwargs
    )
