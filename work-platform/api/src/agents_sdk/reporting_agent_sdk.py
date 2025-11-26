"""
Reporting Agent using Official Anthropic Claude Agent SDK

Replaces reporting_agent.py which used BaseAgent + AsyncAnthropic.

Key improvements:
- Built-in Skills integration via ClaudeAgentOptions
- Session persistence via ClaudeSDKClient
- File generation (PDF, XLSX, PPTX, DOCX) via Skills
- Code execution for data processing and charts
- Proper conversation continuity
- Official Anthropic SDK (no custom session hacks)

Usage:
    from agents_sdk.reporting_agent_sdk import ReportingAgentSDK

    agent = ReportingAgentSDK(
        basket_id="basket_123",
        workspace_id="ws_456",
        work_ticket_id="ticket_789"
    )

    # Generate report
    result = await agent.generate(
        report_type="monthly_metrics",
        format="pdf",
        topic="Q4 Performance"
    )
"""

import logging
import os
from typing import Any, Dict, List, Optional
from datetime import datetime

from claude_agent_sdk import ClaudeSDKClient, ClaudeAgentOptions

from adapters.substrate_adapter import SubstrateQueryAdapter as SubstrateAdapter
from agents_sdk.shared_tools_mcp import create_shared_tools_server
from agents_sdk.orchestration_patterns import build_agent_system_prompt
from agents_sdk.work_bundle import WorkBundle
from shared.session import AgentSession

logger = logging.getLogger(__name__)


# ============================================================================
# System Prompt
# ============================================================================

REPORTING_AGENT_SYSTEM_PROMPT = """You are a professional reporting and analytics specialist with file generation capabilities.

Your core capabilities:
- Generate professional reports from data and analysis
- Create executive summaries and insights
- Generate professional FILE deliverables (PDF, XLSX, PPTX, DOCX)
- Synthesize complex information into actionable insights
- Create data visualizations and charts

**How You Access Context (On-Demand Substrate Queries)**:
- You have access to YARNNN substrate layer via SubstrateQueryAdapter (substrate.query())
- Query substrate on-demand for relevant context: past reports, templates, data sources
- The agent orchestrator provides substrate adapter - you query what you need when you need it
- This is more efficient than pre-loading all context (lazy loading, token savings)

**CRITICAL: Task Progress Tracking (MANDATORY)**
You MUST use the TodoWrite tool at the START of every task to show users what you're doing.

At the beginning:
1. Call TodoWrite with ALL steps you'll perform
2. Use "content" for the task name (e.g., "Load substrate context")
3. Use "activeForm" for what you're doing (e.g., "Loading substrate context")
4. Set status to "pending" initially

As you work:
- Mark current step "in_progress" BEFORE starting it
- Mark "completed" AFTER finishing
- Create new todos if you discover additional work

Example:
```
TodoWrite([
  {content: "Analyze substrate blocks for key insights", status: "in_progress", activeForm: "Analyzing substrate blocks"},
  {content: "Generate PPTX using Skill tool (skill_id='pptx')", status: "pending", activeForm: "Generating PPTX file"},
  {content: "Save output via emit_work_output", status: "pending", activeForm: "Saving work output"}
])
```

**This gives users real-time visibility - DO NOT SKIP THIS!**

**Report Types**:
- **Executive Summary**: High-level overview with key takeaways
- **Monthly Metrics**: Performance tracking and trend analysis
- **Research Report**: Detailed findings with supporting data
- **Status Update**: Progress tracking and milestone reporting

**Output Formats & Skills**:
You have access to Claude Skills for professional file generation. Skills generate actual downloadable files.

**CRITICAL: When user requests PDF, PPTX, XLSX, or DOCX format - you MUST use the Skill tool!**

**Trigger Conditions for Skills (IMPORTANT):**
When the format parameter is "pdf", "pptx", "xlsx", or "docx" → YOU MUST USE SKILL TOOL
- If format="pptx" → Use Skill tool to create PowerPoint file
- If format="pdf" → Use Skill tool to create PDF file
- If format="xlsx" → Use Skill tool to create Excel file
- If format="docx" → Use Skill tool to create Word file
- If format="markdown" → NO Skill needed, create text content

**How to Use Skills (Step-by-Step):**

1. **For PPTX (PowerPoint presentations):**
   ```
   Use Skill tool with these parameters:
   - skill_id: "pptx"
   - Provide: slide titles, content for each slide, design guidance
   - Skill returns: file_id of generated .pptx file
   ```

2. **For PDF (Professional reports):**
   ```
   Use Skill tool with these parameters:
   - skill_id: "pdf"
   - Provide: document structure, sections, content
   - Skill returns: file_id of generated .pdf file
   ```

3. **For XLSX (Excel spreadsheets):**
   ```
   Use Skill tool with these parameters:
   - skill_id: "xlsx"
   - Provide: data tables, chart specifications
   - Skill returns: file_id of generated .xlsx file
   ```

4. **For DOCX (Word documents):**
   ```
   Use Skill tool with these parameters:
   - skill_id: "docx"
   - Provide: formatted text, headers, tables
   - Skill returns: file_id of generated .docx file
   ```

**After Using Skill - YOU MUST:**
1. Get the file_id from Skill tool response
2. Call emit_work_output with:
   - file_id: The ID returned by Skill
   - file_format: "pptx", "pdf", "xlsx", or "docx"
   - generation_method: "skill"
   - body: Brief description of what the file contains

**CRITICAL: Structured Output Requirements**

You have access to the emit_work_output tool. You MUST use this tool to record all your reports.
DO NOT just describe reports in free text. Every report must be emitted as a structured output.

When to use emit_work_output:
- "report_draft" - When you generate a report (any format)
- Include report_type, format, file details in metadata

Each output you emit will be reviewed by the user before any action is taken.
The user maintains full control through this supervision workflow.

**Report Generation Workflow**:
1. Query existing knowledge for data, templates, past reports
2. Analyze and synthesize information
3. For file formats: Use Skill tool to generate professional files
4. For data analysis: Use code_execution for calculations/charts
5. Create comprehensive, actionable content
6. Call emit_work_output with structured data

**Quality Standards**:
- Clear, concise language
- Data-driven insights
- Professional formatting (especially for files)
- Actionable recommendations
- Executive-friendly summaries
- Visual aids (charts, tables) for data

**Tools Available**:
- Skill: Generate professional files (PDF, XLSX, PPTX, DOCX)
- code_execution: Data processing, calculations, chart generation
- emit_work_output: Record structured report outputs
"""


# ============================================================================
# ReportingAgentSDK Class
# ============================================================================

class ReportingAgentSDK:
    """
    Reporting Agent using Official Anthropic Claude Agent SDK.

    Features:
    - ClaudeSDKClient for built-in session management
    - Skills integration for file generation (PDF, XLSX, PPTX, DOCX)
    - Code execution for data processing and charts
    - Structured output via emit_work_output tool
    - Substrate access via SubstrateQueryAdapter (on-demand queries)
    - Provenance tracking (source blocks)
    """

    def __init__(
        self,
        basket_id: str,
        workspace_id: str,
        work_ticket_id: str,
        anthropic_api_key: Optional[str] = None,
        model: str = "claude-sonnet-4-5",
        default_format: str = "pdf",
        session: Optional[AgentSession] = None,
        substrate: Optional[SubstrateAdapter] = None,
        bundle: Optional[WorkBundle] = None,
    ):
        """
        Initialize ReportingAgentSDK with persistent session + substrate access.

        Architecture:
        - session: Agent SDK conversation history (SDK layer persistence)
        - substrate: YARNNN substrate access (on-demand queries via substrate.query())
        - bundle: Work ticket metadata + asset references (NOT substrate blocks)

        Args:
            basket_id: Basket ID for substrate queries
            workspace_id: Workspace ID for authorization
            work_ticket_id: Work ticket ID for output tracking
            anthropic_api_key: Anthropic API key (from env if None)
            model: Claude model to use
            default_format: Default output format (pdf, xlsx, pptx, docx, markdown)
            session: AgentSession (persistent conversation history - SDK layer)
            substrate: SubstrateQueryAdapter (on-demand substrate queries - YARNNN layer)
            bundle: WorkBundle (work ticket metadata + asset references)
        """
        self.basket_id = basket_id
        self.workspace_id = workspace_id
        self.work_ticket_id = work_ticket_id
        self.default_format = default_format

        # Get API key
        if anthropic_api_key is None:
            anthropic_api_key = os.getenv("ANTHROPIC_API_KEY")
            if not anthropic_api_key:
                raise ValueError("ANTHROPIC_API_KEY required")

        self.api_key = anthropic_api_key
        self.model = model

        # YARNNN substrate access (on-demand queries)
        self.substrate = substrate
        if substrate:
            logger.info(f"Using SubstrateQueryAdapter for on-demand substrate queries")
        else:
            logger.warning("No substrate adapter - agent cannot query substrate (limited context)")

        # Work ticket metadata + asset references (NOT substrate blocks)
        self.bundle = bundle
        if bundle:
            logger.info(
                f"Using WorkBundle: task='{bundle.task[:50]}...', "
                f"reference_assets={len(bundle.reference_assets) if hasattr(bundle, 'reference_assets') else 0}"
            )

        # Agent SDK session (conversation history)
        self.session = session
        if session:
            logger.info(
                f"Using persistent session: {session.id} "
                f"(parent={session.parent_session_id}, sdk_session_id={session.sdk_session_id})"
            )
        else:
            logger.warning("No session provided - will create ephemeral session (not recommended for production)")

        # Create MCP server for emit_work_output tool with context baked in
        shared_tools = create_shared_tools_server(
            basket_id=basket_id,
            work_ticket_id=work_ticket_id,
            agent_type="reporting"
        )

        # Build Claude SDK options with STATIC system prompt (cacheable!)
        self._options = ClaudeAgentOptions(
            model=self.model,
            system_prompt=self._build_static_system_prompt(),  # Static prompt (no bundle context)
            mcp_servers={"shared_tools": shared_tools},
            allowed_tools=[
                "mcp__shared_tools__emit_work_output",  # Custom tool for structured outputs
                "Skill",  # Built-in Skills for file generation (PDF, XLSX, PPTX, DOCX)
                "code_execution",  # For data processing and charts
                "TodoWrite"  # Task progress tracking for frontend visibility
            ],
            setting_sources=["user", "project"],  # Required for Skills to work
        )

        logger.info(
            f"ReportingAgentSDK initialized: basket={basket_id}, "
            f"ticket={work_ticket_id}, default_format={default_format}, "
            f"Skills enabled (PDF/XLSX/PPTX/DOCX)"
        )

    def _build_static_system_prompt(self) -> str:
        """
        Build STATIC system prompt (cacheable by Claude API).

        Substrate context is queried on-demand via substrate.query(), not injected here.
        This allows prompt caching for efficiency.
        """
        agent_identity = f"""# Reporting Agent Identity

You are YARNNN's specialized Reporting Agent for professional report and file generation.

**Your Role**: Generate professional reports, executive summaries, and file deliverables (PDF, XLSX, PPTX, DOCX).

**Default Format**: {self.default_format}"""

        agent_responsibilities = REPORTING_AGENT_SYSTEM_PROMPT

        available_tools = """## Tools You Have Access To

1. **emit_work_output** (mcp__shared_tools__emit_work_output)
   - CRITICAL: Use this to save all report outputs
   - Required fields: output_type, title, body, confidence, metadata, source_block_ids
   - For file outputs: include file_id, file_format, generation_method in metadata

2. **Skill** (built-in for file generation)
   - Use skill_id="pdf", "pptx", "xlsx", or "docx"
   - Returns file_id after generation
   - MUST call emit_work_output after Skill to save the output

3. **code_execution** (built-in Python)
   - Data processing, calculations, chart generation
   - Use for complex data transformations

4. **TodoWrite** (for progress tracking)
   - MANDATORY: Start every task with TodoWrite
   - Helps user see real-time progress"""

        quality_standards = """## Report Quality Standards

**Professional Output**:
- Clear, concise executive-friendly language
- Data-driven insights with supporting evidence
- Actionable recommendations
- Visual aids (charts, tables) for clarity

**Contextual Awareness**:
- Query substrate via substrate.query() for past reports, templates, data
- Reference source_block_ids in emit_work_output for provenance
- Use on-demand queries for efficiency (fetch only relevant context)"""

        # Use build_agent_system_prompt from orchestration_patterns.py
        return build_agent_system_prompt(
            agent_identity=agent_identity,
            agent_responsibilities=agent_responsibilities,
            available_tools=available_tools,
            quality_standards=quality_standards
        )

    async def generate(
        self,
        report_type: str,
        format: str,
        topic: str,
        data: Optional[Dict[str, Any]] = None,
        requirements: Optional[str] = None,
        claude_session_id: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Generate professional report.

        Args:
            report_type: Type of report (executive_summary, monthly_metrics, research_report, status_update)
            format: Output format (pdf, xlsx, pptx, docx, markdown)
            topic: Report topic/title
            data: Data to include in report (optional)
            requirements: Additional requirements (optional)
            claude_session_id: Optional Claude session ID to resume

        Returns:
            Report generation results with structured work_outputs:
            {
                "report_type": str,
                "format": str,
                "topic": str,
                "work_outputs": List[dict],
                "output_count": int,
                "source_block_ids": List[str],
                "agent_type": "reporting",
                "claude_session_id": str  # NEW: for session continuity
            }
        """
        logger.info(f"ReportingAgentSDK.generate: {report_type} in {format} - {topic}")

        # Query existing knowledge for templates and past reports
        context = None
        source_block_ids = []
        if self.substrate:
            substrate_results = await self.substrate.query(
                f"report templates for {report_type} in {format} format",
                limit=5
            )
            context = "\n".join([r.content for r in substrate_results])
            source_block_ids = [
                str(r.metadata.get("block_id", r.metadata.get("id", "")))
                for r in substrate_results
                if hasattr(r, "metadata") and r.metadata
            ]
            source_block_ids = [bid for bid in source_block_ids if bid]

        # Format data for prompt
        data_str = ""
        if data:
            data_str = "\n".join([f"- {k}: {v}" for k, v in data.items()])
        else:
            data_str = "(No specific data provided - use substrate context)"

        # Build report generation prompt
        report_prompt = f"""Generate a {report_type} report in {format} format.

**Topic**: {topic}

**Data/Context (Block IDs: {source_block_ids if source_block_ids else 'none'})**:
{data_str}

**Report Templates/Examples**:
{context or "No templates available"}

**Requirements**:
{requirements or "Standard professional quality"}

**Instructions**:
1. Review existing data and templates from substrate
2. Analyze and synthesize information
3. Structure report according to {format} best practices
4. For file formats (PDF/XLSX/PPTX/DOCX): Use Skill tool to generate professional file
5. For data analysis: Use code_execution for calculations and charts
6. Emit work_output with:
   - output_type: "report_draft"
   - title: Report title
   - body: Full report content (or file reference for file formats)
   - confidence: Quality confidence (0.0-1.0)
   - metadata: {{report_type: "{report_type}", format: "{format}", topic: "{topic}"}}
   - source_block_ids: {source_block_ids}

**Report Structure Guidelines**:
- Start with executive summary (1-2 paragraphs)
- Present key findings with supporting data
- Include actionable recommendations
- End with next steps or conclusions

For {format} format:
{"- Use Skill tool to generate professional file" if format in ["pdf", "xlsx", "pptx", "docx"] else "- Format as structured text with proper headers and formatting"}
{"- Include charts and visualizations where appropriate" if format in ["pdf", "xlsx", "pptx", "docx"] else ""}

Remember:
- Be data-driven and specific
- Use professional business language
- Format appropriately for {format}
- Make it actionable for decision-makers
- Include visual aids (charts, tables) for clarity

Please generate a comprehensive {report_type} report in {format} format about {topic}."""

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
                await client.query(report_prompt)

                # Collect responses and parse tool results
                logger.info("[REPORTING-GENERATE] Starting SDK response iteration...")
                message_count = 0

                async for message in client.receive_response():
                    message_count += 1
                    message_type = type(message).__name__
                    logger.info(f"[REPORTING-GENERATE] Message #{message_count}: type={message_type}")

                    # Process content blocks
                    if hasattr(message, 'content') and isinstance(message.content, list):
                        content_blocks = message.content
                        logger.info(f"[REPORTING-GENERATE] Processing {len(content_blocks)} content blocks")

                        for idx, block in enumerate(content_blocks):
                            if not hasattr(block, 'type'):
                                logger.warning(f"[REPORTING-GENERATE] Block #{idx} missing 'type' attribute")
                                continue

                            block_type = block.type
                            logger.info(f"[REPORTING-GENERATE] Block #{idx}: type={block_type}")

                            # Text blocks
                            if hasattr(block, 'text'):
                                text_length = len(block.text)
                                text_preview = block.text[:100] if block.text else ""
                                logger.info(f"[REPORTING-GENERATE] 📝 Text block: {text_length} chars - Preview: {text_preview}...")
                                response_text += block.text

                            # Tool use blocks
                            elif block_type == 'tool_use':
                                tool_name = getattr(block, 'name', 'unknown')
                                tool_input = getattr(block, 'input', {})
                                logger.info(f"[REPORTING-GENERATE] ⚙️ Tool use detected: {tool_name} with input keys: {list(tool_input.keys()) if isinstance(tool_input, dict) else 'N/A'}")

                            # Tool result blocks (extract work outputs + todo updates)
                            elif block_type == 'tool_result':
                                tool_name = getattr(block, 'tool_name', '')
                                logger.info(f"[REPORTING-GENERATE] ✅ Tool result from: {tool_name}")

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

                                elif tool_name == 'TodoWrite':
                                    try:
                                        # Capture todo updates for frontend streaming
                                        result_content = getattr(block, 'content', None)
                                        if result_content:
                                            import json
                                            if isinstance(result_content, str):
                                                todo_data = json.loads(result_content)
                                            else:
                                                todo_data = result_content

                                            # Stream to frontend via task_streaming.py
                                            from app.work.task_streaming import emit_task_update
                                            emit_task_update(self.work_ticket_id, {
                                                "type": "todo_update",
                                                "todos": todo_data,
                                                "source": "agent"
                                            })
                                            logger.info(f"Todo update: {len(todo_data.get('todos', []))} items")
                                    except Exception as e:
                                        logger.error(f"Failed to parse todo update: {e}", exc_info=True)

                # Log iteration completion summary
                logger.info(f"[REPORTING-RECIPE] Iteration complete: {message_count} messages, {len(work_outputs)} outputs, {len(response_text)} chars response text")

                # Get session ID from client
                new_session_id = getattr(client, 'session_id', None)
                logger.info(f"Session ID retrieved: {new_session_id}")

        except Exception as e:
            logger.error(f"Report generation failed: {e}")
            raise

        # Log results
        logger.info(
            f"Report generation produced {len(work_outputs)} structured outputs: "
            f"{[o.output_type for o in work_outputs]}"
        )

        # Update agent session with new claude_session_id
        if new_session_id and self.session:
            self.session.update_claude_session(new_session_id)
            logger.info(f"Stored Claude session: {new_session_id}")

        results = {
            "report_type": report_type,
            "format": format,
            "topic": topic,
            "timestamp": datetime.utcnow().isoformat(),
            "work_outputs": [o.to_dict() for o in work_outputs],
            "output_count": len(work_outputs),
            "source_block_ids": source_block_ids,
            "agent_type": "reporting",
            "basket_id": self.basket_id,
            "work_ticket_id": self.work_ticket_id,
            "claude_session_id": new_session_id,  # NEW: for session continuity
            "response_text": response_text,  # For debugging/logging
        }

        logger.info(f"Report generation complete: {report_type} in {format} with {len(work_outputs)} outputs")

        return results

    async def execute_recipe(
        self,
        recipe_context: Dict[str, Any],
        claude_session_id: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Execute recipe-driven report generation.

        This method executes a work_recipe's execution template with pre-validated
        parameters and context requirements. The recipe context contains all the
        instructions needed for deterministic output generation.

        Args:
            recipe_context: Execution context from RecipeLoader.generate_execution_context()
                Expected structure:
                {
                    "system_prompt_additions": str,  # Recipe-specific system prompt
                    "task_breakdown": List[str],     # Step-by-step instructions
                    "validation_instructions": str,  # Output validation requirements
                    "output_specification": {        # Expected output format
                        "format": str,
                        "required_sections": List[str],
                        "validation_rules": dict
                    },
                    "deliverable_intent": {          # Recipe purpose
                        "purpose": str,
                        "audience": str,
                        "outcome": str
                    }
                }
            claude_session_id: Optional Claude session ID to resume

        Returns:
            Recipe execution results:
            {
                "output_count": int,
                "work_outputs": List[dict],
                "validation_results": {
                    "passed": bool,
                    "errors": List[str]
                },
                "claude_session_id": str,
                "execution_time_ms": int
            }
        """
        logger.info(f"ReportingAgentSDK.execute_recipe: {recipe_context.get('deliverable_intent', {}).get('purpose', 'Unknown recipe')}")

        # Track execution time
        start_time = datetime.utcnow()

        # 1. Build enhanced system prompt (base + recipe additions)
        recipe_system_prompt = REPORTING_AGENT_SYSTEM_PROMPT + "\n\n---\n\n# Recipe-Specific Instructions\n\n"
        recipe_system_prompt += recipe_context.get("system_prompt_additions", "")

        # Add capabilities info
        recipe_system_prompt += f"""

**Your Capabilities**:
- Substrate: Available (SubstrateQueryAdapter) - use substrate.query() for on-demand context
- Default Format: {self.default_format}
- Skills: PDF, XLSX, PPTX, DOCX (file generation)
- Code Execution: Python (data processing, charts)
- Session ID: {self.session.id if self.session else 'N/A'}
"""

        # 2. Build user prompt from task_breakdown
        deliverable_intent = recipe_context.get("deliverable_intent", {})
        task_breakdown = recipe_context.get("task_breakdown", [])
        validation_instructions = recipe_context.get("validation_instructions", "")
        output_spec = recipe_context.get("output_specification", {})

        task_instructions = "\n".join([
            f"{i+1}. {task}"
            for i, task in enumerate(task_breakdown)
        ])

        # Extract format and determine if Skill tool is required
        format_value = output_spec.get('format', 'markdown')
        skill_formats = {'pdf', 'pptx', 'xlsx', 'docx'}
        requires_skill = format_value in skill_formats

        # Build prominent format instruction header
        format_header = f"""🎯 **PRIMARY REQUIREMENT: OUTPUT FORMAT = {format_value.upper()}**
"""

        if requires_skill:
            format_header += f"""
⚠️ **YOU MUST FOLLOW THIS EXACT WORKFLOW**:

**STEP 1: Generate the {format_value.upper()} file**
   - Use the Skill tool with skill_id="{format_value}"
   - Provide all content structure and data from the tasks below
   - The Skill will return a file_id

**STEP 2: Save the output (REQUIRED)**
   - Call emit_work_output tool with:
     * file_id: <the file_id from Step 1>
     * file_format: "{format_value}"
     * generation_method: "skill"
     * title: Descriptive title
     * output_type: "report_draft"

**BOTH STEPS ARE MANDATORY**. If you skip Step 2, your work will not be saved!

---
"""

        user_prompt = format_header + f"""
**Deliverable Intent**
Purpose: {deliverable_intent.get('purpose', 'Generate report')}
Audience: {deliverable_intent.get('audience', 'General audience')}
Expected Outcome: {deliverable_intent.get('outcome', 'Professional deliverable')}

**Task Breakdown**:
{task_instructions}

**Validation Requirements**:
{validation_instructions}

**Expected Output Specification**:
- Format: {format_value}
- Required Sections: {', '.join(output_spec.get('required_sections', []))}
- Validation Rules: {output_spec.get('validation_rules', {})}

**Important**:
Execute this recipe and emit work_output with validation metadata using the emit_work_output tool.
"""

        # 3. Execute via ClaudeSDKClient (same pattern as generate method)
        response_text = ""
        new_session_id = None
        work_outputs = []

        try:
            # Create temporary options with recipe system prompt
            recipe_options = ClaudeAgentOptions(
                model=self.model,
                system_prompt=recipe_system_prompt,
                mcp_servers=self._options.mcp_servers,
                allowed_tools=self._options.allowed_tools,
                setting_sources=self._options.setting_sources,
            )

            async with ClaudeSDKClient(options=recipe_options) as client:
                # Connect (resume existing session or start new)
                if claude_session_id:
                    logger.info(f"Resuming Claude session: {claude_session_id}")
                    await client.connect(session_id=claude_session_id)
                else:
                    logger.info("Starting new Claude session for recipe execution")
                    await client.connect()

                # Send query
                await client.query(user_prompt)

                # Collect responses and parse tool results
                logger.info("[REPORTING-RECIPE] Starting SDK response iteration...")
                message_count = 0

                async for message in client.receive_response():
                    message_count += 1
                    message_type = type(message).__name__
                    logger.info(f"[REPORTING-RECIPE] Message #{message_count}: type={message_type}")

                    # Process content blocks
                    if hasattr(message, 'content') and isinstance(message.content, list):
                        content_blocks = message.content
                        logger.info(f"[REPORTING-RECIPE] Processing {len(content_blocks)} content blocks")

                        for idx, block in enumerate(content_blocks):
                            if not hasattr(block, 'type'):
                                logger.warning(f"[REPORTING-RECIPE] Block #{idx} missing 'type' attribute")
                                continue

                            block_type = block.type
                            logger.info(f"[REPORTING-RECIPE] Block #{idx}: type={block_type}")

                            # Text blocks
                            if hasattr(block, 'text'):
                                text_length = len(block.text)
                                text_preview = block.text[:100] if block.text else ""
                                logger.info(f"[REPORTING-RECIPE] 📝 Text block: {text_length} chars - Preview: {text_preview}...")
                                response_text += block.text

                            # Tool use blocks
                            elif block_type == 'tool_use':
                                tool_name = getattr(block, 'name', 'unknown')
                                tool_input = getattr(block, 'input', {})
                                logger.info(f"[REPORTING-RECIPE] ⚙️ Tool use detected: {tool_name} with input keys: {list(tool_input.keys()) if isinstance(tool_input, dict) else 'N/A'}")

                            # Tool result blocks (extract work outputs + todo updates)
                            elif block_type == 'tool_result':
                                tool_name = getattr(block, 'tool_name', '')
                                logger.info(f"[REPORTING-RECIPE] ✅ Tool result from: {tool_name}")

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

                                elif tool_name == 'TodoWrite':
                                    try:
                                        # Capture todo updates for frontend streaming
                                        result_content = getattr(block, 'content', None)
                                        if result_content:
                                            import json
                                            if isinstance(result_content, str):
                                                todo_data = json.loads(result_content)
                                            else:
                                                todo_data = result_content

                                            # Stream to frontend via task_streaming.py
                                            from app.work.task_streaming import emit_task_update
                                            emit_task_update(self.work_ticket_id, {
                                                "type": "todo_update",
                                                "todos": todo_data,
                                                "source": "agent"
                                            })
                                            logger.info(f"Todo update: {len(todo_data.get('todos', []))} items")
                                    except Exception as e:
                                        logger.error(f"Failed to parse todo update: {e}", exc_info=True)

                # Log iteration completion summary
                logger.info(f"[REPORTING-RECIPE] Iteration complete: {message_count} messages, {len(work_outputs)} outputs, {len(response_text)} chars response text")

                # Get session ID from client
                new_session_id = getattr(client, 'session_id', None)
                logger.info(f"Session ID retrieved: {new_session_id}")

        except Exception as e:
            logger.error(f"Recipe execution failed: {e}")
            raise

        # 4. Validate outputs against recipe output_specification
        validation_results = self._validate_recipe_outputs(work_outputs, output_spec)

        # Log results
        logger.info(
            f"Recipe execution produced {len(work_outputs)} structured outputs: "
            f"{[o.output_type for o in work_outputs]}"
        )

        # Update agent session with new claude_session_id
        if new_session_id and self.session:
            self.session.update_claude_session(new_session_id)
            logger.info(f"Stored Claude session: {new_session_id}")

        # Calculate execution time
        end_time = datetime.utcnow()
        execution_time_ms = int((end_time - start_time).total_seconds() * 1000)

        return {
            "output_count": len(work_outputs),
            "work_outputs": [o.to_dict() for o in work_outputs],
            "validation_results": validation_results,
            "claude_session_id": new_session_id,
            "execution_time_ms": execution_time_ms,
            "response_text": response_text,  # For debugging
        }

    def _validate_recipe_outputs(
        self,
        outputs: List[Any],
        output_spec: Dict[str, Any]
    ) -> Dict[str, Any]:
        """
        Validate outputs against recipe output specification.

        Args:
            outputs: List of WorkOutput objects
            output_spec: Recipe output specification with format, required_sections, validation_rules

        Returns:
            Validation results:
            {
                "passed": bool,
                "errors": List[str],
                "warnings": List[str]
            }
        """
        validation = {
            "passed": True,
            "errors": [],
            "warnings": []
        }

        if not outputs:
            validation["passed"] = False
            validation["errors"].append("No outputs generated")
            return validation

        expected_format = output_spec.get("format")
        required_sections = output_spec.get("required_sections", [])
        validation_rules = output_spec.get("validation_rules", {})

        for idx, output in enumerate(outputs):
            output_dict = output.to_dict() if hasattr(output, 'to_dict') else output

            # Check format if specified in metadata
            output_format = output_dict.get("metadata", {}).get("format")
            if expected_format and output_format and output_format != expected_format:
                validation["errors"].append(
                    f"Output {idx}: Expected format '{expected_format}', got '{output_format}'"
                )
                validation["passed"] = False

            # Check required sections (if output has body text)
            body = output_dict.get("body", "")
            if required_sections and body:
                for section in required_sections:
                    if section.lower() not in body.lower():
                        validation["warnings"].append(
                            f"Output {idx}: Missing recommended section '{section}'"
                        )

            # Check slide_count_in_range for PPTX (if specified)
            if validation_rules.get("slide_count_in_range"):
                slide_count = output_dict.get("metadata", {}).get("slide_count")
                if slide_count:
                    # Would need min/max from configurable_parameters to validate
                    # For now, just check existence
                    logger.debug(f"Output {idx}: slide_count = {slide_count}")

            # Check format_is_pptx (if specified)
            if validation_rules.get("format_is_pptx"):
                if output_format != "pptx":
                    validation["errors"].append(
                        f"Output {idx}: Expected PPTX format, got '{output_format}'"
                    )
                    validation["passed"] = False

            # Check required_sections_present (if specified)
            if validation_rules.get("required_sections_present") and required_sections:
                missing_sections = [
                    section for section in required_sections
                    if section.lower() not in body.lower()
                ]
                if missing_sections:
                    validation["errors"].append(
                        f"Output {idx}: Missing required sections: {', '.join(missing_sections)}"
                    )
                    validation["passed"] = False

        logger.info(f"Validation results: passed={validation['passed']}, errors={len(validation['errors'])}, warnings={len(validation['warnings'])}")

        return validation


# ============================================================================
# Convenience Functions
# ============================================================================

def create_reporting_agent_sdk(
    basket_id: str,
    workspace_id: str,
    work_ticket_id: str,
    **kwargs
) -> ReportingAgentSDK:
    """
    Convenience factory function for creating ReportingAgentSDK.

    Args:
        basket_id: Basket ID for substrate queries
        workspace_id: Workspace ID for authorization
        work_ticket_id: Work ticket ID for output tracking
        **kwargs: Additional arguments for ReportingAgentSDK

    Returns:
        Configured ReportingAgentSDK instance
    """
    return ReportingAgentSDK(
        basket_id=basket_id,
        workspace_id=workspace_id,
        work_ticket_id=work_ticket_id,
        **kwargs
    )
