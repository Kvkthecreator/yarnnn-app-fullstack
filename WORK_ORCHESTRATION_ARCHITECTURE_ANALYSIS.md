# Work Orchestration Architecture Analysis
**Date**: 2025-11-24
**Context**: Investigation of work request → agent invocation flow and Skills integration issue

---

## Executive Summary

**Problem**: User created work request with intent "skeleton PPT" but agent generated TEXT instead of using Skills to create actual PPTX file.

**Root Cause**: `format` parameter is NOT flowing from frontend → work ticket → agent execution.

**Architecture**: YARNNN uses a multi-layer orchestration pattern that differs from "textbook" Agent SDK approach, creating complexity but enabling advanced features (tracking, trial limits, project scaffolding, WorkBundle pre-loading).

---

## Current Architecture: The Complete Flow

### 1. Entry Points (Three Paths)

YARNNN has **THREE different orchestration paths**:

#### Path A: Direct Workflow Endpoints (Deterministic)
```
POST /work/reporting/execute
POST /work/research/execute
POST /work/content/execute
```

**Characteristics**:
- ✅ Explicit parameters (including `output_format`)
- ✅ Direct specialist invocation (no TP)
- ✅ Full context loading (WorkBundle pattern)
- ✅ Recipe-driven execution support
- ✅ Format parameter flows correctly: `request.output_format` → `agent.generate(format=...)`

**Request Model** ([workflow_reporting.py:34-45](work-platform/api/src/app/routes/workflow_reporting.py#L34-L45)):
```python
class ReportingWorkflowRequest(BaseModel):
    basket_id: str
    task_description: str
    output_format: Optional[str] = "markdown"  # ✅ FORMAT PARAMETER HERE
    priority: Optional[int] = 5
    recipe_id: Optional[str] = None
    recipe_parameters: Optional[Dict[str, Any]] = None
```

**Execution** ([workflow_reporting.py:289-293](work-platform/api/src/app/routes/workflow_reporting.py#L289-L293)):
```python
result = await reporting_sdk.execute_deep_dive(
    task_description=request.task_description,
    output_format=request.output_format,  # ✅ FORMAT PASSED TO AGENT
    claude_session_id=reporting_session.claude_session_id,
)
```

**Status**: ✅ **FORMAT PARAMETER WORKS CORRECTLY**

---

#### Path B: Thinking Partner Gateway (TP Orchestration)
```
POST /agents/chat  (TP chat)
  → TP calls work_orchestration tool
    → Calls run_agent_task()
      → Creates work_request + work_ticket
        → Executes specialist agent
```

**Characteristics**:
- Natural language input (no structured parameters)
- TP decides which agent to invoke
- TP's `work_orchestration` tool creates work infrastructure
- **ISSUE**: TP doesn't extract `format` parameter from natural language

**Tool Definition** ([tp_tools_mcp.py:25-97](work-platform/api/src/agents_sdk/tp_tools_mcp.py#L25-L97)):
```python
@tool(
    "work_orchestration",
    "Delegate work to specialized agents (research, content, reporting)",
    {
        "agent_type": str,
        "task": str,
        "parameters": dict  # ❌ NO FORMAT EXTRACTION FROM NATURAL LANGUAGE
    }
)
async def work_orchestration_tool(args: Dict[str, Any]) -> Dict[str, Any]:
    # Maps to AgentTaskRequest but doesn't extract format from task description
    request = AgentTaskRequest(
        agent_type=agent_type,
        task_type=task_type,
        basket_id=basket_id,
        parameters={
            "topic": task,
            **parameters  # Generic params, no format specified
        }
    )
```

**Status**: ⚠️ **FORMAT PARAMETER NOT EXTRACTED FROM NATURAL LANGUAGE**

---

#### Path C: Project Work Sessions (Frontend-Driven)
```
Frontend: Create work session with task_description
  ↓
POST /projects/{id}/work-sessions  (creates work_ticket)
  ↓
POST /projects/{id}/work-sessions/{ticket_id}/execute
  ↓
WorkTicketExecutor.execute_work_ticket()
  ↓
AgentSDKClient.create_agent() → agent.generate()
```

**Characteristics**:
- User creates work sessions via project UI
- Work ticket stores task configuration
- Executor reads `task_configuration` from work_ticket
- **ISSUE**: Work ticket creation doesn't capture `format` parameter

**Work Ticket Creation** ([project_work_tickets.py:47-312](work-platform/api/src/app/routes/project_work_tickets.py#L47-L312)):
```python
class CreateWorkTicketRequest(BaseModel):
    agent_id: str
    task_description: str  # ❌ NO FORMAT FIELD
    research_config: Optional[ResearchTaskConfiguration] = None
    content_config: Optional[ContentTaskConfiguration] = None
    reporting_config: Optional[ReportingTaskConfiguration] = None  # Has report_spec but no output_format
```

**Work Ticket Execution** ([work_session_executor.py:218-223](work-platform/api/src/services/work_session_executor.py#L218-L223)):
```python
result = await agent.generate(
    report_type=task_config.get("report_type", "general"),
    format=task_config.get("format", "pdf"),  # ❌ DEFAULTS TO "pdf", not user's choice
    topic=task_description,
    claude_session_id=agent_session.claude_session_id,
)
```

**Status**: ❌ **FORMAT PARAMETER MISSING FROM WORK TICKET CREATION**

---

## Architecture Comparison

### Textbook Agent SDK Approach (Simple)

```python
# Direct Agent SDK invocation (minimal layers)
from claude_agent_sdk import query, ClaudeAgentOptions

result = await query(
    prompt="Create a PowerPoint presentation about testing",
    options=ClaudeAgentOptions(
        allowed_tools=["Skill", "code_execution"]
    )
)
```

**Layers**: 1 (direct SDK call)
**Complexity**: Low
**Features**: Basic agent execution only

---

### YARNNN Current Approach (Multi-Layer)

```
User Request
  ↓
Frontend (work session creation)
  ↓
Backend API (project_work_tickets.py)
  ↓
Work Ticket (database record for tracking)
  ↓
WorkTicketExecutor (orchestration service)
  ↓
AgentSDKClient (agent factory)
  ↓
ReportingAgentSDK (specialist agent wrapper)
  ↓
ClaudeSDKClient (official SDK)
  ↓
Claude API
```

**Layers**: 8 (frontend → backend → DB → executor → client → SDK wrapper → SDK → API)
**Complexity**: High
**Features**:
- ✅ Trial limits & billing tracking (work_requests)
- ✅ Project scaffolding (pre-created agent_sessions)
- ✅ Execution tracking (work_tickets)
- ✅ Context pre-loading (WorkBundle pattern)
- ✅ Recipe-driven execution
- ✅ Session continuity across requests
- ✅ Checkpoint handling
- ❌ **Format parameter lost in layers**

---

## WorkBundle Role in Orchestration

**Definition** ([work_bundle.py](work-platform/api/src/agents_sdk/work_bundle.py)):

```python
class WorkBundle:
    """
    Complete context bundle for specialist agent execution.

    Created by TP during staging phase (work_orchestration tool).
    Contains everything agent needs - no additional substrate queries required.

    This is an in-memory structure, not persisted to database.
    """
```

**Purpose**: Pre-load all context before agent execution (staging boundary pattern)

**Contents**:
- Work tracking IDs (work_request_id, work_ticket_id, basket_id, workspace_id, user_id)
- Task definition (task, agent_type, priority)
- Pre-loaded context (substrate_blocks, reference_assets, agent_config, user_requirements)

**Usage in TP Orchestration**:
1. TP calls `work_orchestration` tool
2. Tool creates work_request + work_ticket
3. **STAGING BOUNDARY**: Load substrate blocks, reference assets, agent config
4. Create WorkBundle with pre-loaded context
5. Pass bundle to specialist agent (no queries during execution)

**Usage in Direct Workflows** ([workflow_reporting.py:242-254](work-platform/api/src/app/routes/workflow_reporting.py#L242-L254)):
```python
context_bundle = WorkBundle(
    work_request_id=work_request_id,
    work_ticket_id=work_ticket_id,
    basket_id=request.basket_id,
    workspace_id=workspace_id,
    user_id=user_id,
    task=execution_context["deliverable_intent"].get("purpose") if execution_context else request.task_description,
    agent_type="reporting",
    priority=f"p{request.priority}",
    substrate_blocks=substrate_blocks,  # Pre-loaded from DB
    reference_assets=reference_assets,  # Pre-loaded from DB
    agent_config=execution_context if execution_context else {},  # Recipe context or empty
)
```

**Key Insight**: WorkBundle is YARNNN's staging boundary - it pre-loads context so agents don't query substrate during execution. This differs from textbook Agent SDK where agents query context on-demand.

---

## The Missing Format Parameter Issue

### Path A (Direct Workflows): ✅ Works

```
User specifies output_format → Request model captures it → Agent receives it
```

### Path B (TP Gateway): ⚠️ Doesn't Extract Format

**Problem**: TP receives natural language ("create a ppt skeleton") but doesn't extract format from text.

**Current TP Prompt** ([thinking_partner_sdk.py:118-127](work-platform/api/src/agents_sdk/thinking_partner_sdk.py#L118-L127)):
```
**Your Approach:**

When user makes a request:
1. **Understand Intent**: What does user want?
2. **Collect Requirements**: Natural conversation to gather details
   - What platform? (for content)
   - What format? (for reports)  ← ✅ TP SHOULD ASK THIS
   - What priority? (for work orchestration)
   - Any specific requirements?
```

**Issue**: TP prompt tells it to collect format, but it doesn't consistently extract it from natural language like "ppt skeleton" or "skeleton PPT".

**Potential Solutions**:
1. TP extracts format from keywords (ppt/pdf/xlsx/docx) → passes to `work_orchestration` parameters
2. TP asks clarifying question: "What format would you like? (pptx, pdf, xlsx, docx, markdown)"
3. TP defaults to intelligent inference: "skeleton PPT" → format="pptx"

### Path C (Project Work Sessions): ❌ Format Field Missing

**Problem**: Work ticket creation model doesn't have `format` field.

**Current Model** ([task_configurations.py:288-312](work-platform/api/src/models/task_configurations.py#L288-L312)):
```python
class CreateWorkTicketRequest(BaseModel):
    agent_id: str
    task_description: str  # ❌ NO FORMAT FIELD

    # Agent-specific configurations
    research_config: Optional[ResearchTaskConfiguration] = None
    content_config: Optional[ContentTaskConfiguration] = None
    reporting_config: Optional[ReportingTaskConfiguration] = None
```

**ReportingTaskConfiguration** ([task_configurations.py:247-263](work-platform/api/src/models/task_configurations.py#L247-L263)):
```python
class ReportingTaskConfiguration(BaseModel):
    report_spec: ReportSpec  # Has report_type, time_period, sections
    data_sources: ReportDataSources
    audience: ReportAudience
    # ❌ NO OUTPUT_FORMAT FIELD
```

**Executor Defaults** ([work_session_executor.py:218-223](work-platform/api/src/services/work_session_executor.py#L218-L223)):
```python
result = await agent.generate(
    report_type=task_config.get("report_type", "general"),
    format=task_config.get("format", "pdf"),  # ❌ ALWAYS DEFAULTS TO "pdf"
    topic=task_description,
)
```

**Fix Required**:
1. Add `output_format` field to `CreateWorkTicketRequest` or `ReportingTaskConfiguration`
2. Frontend captures format selection (dropdown: markdown, pdf, pptx, xlsx, docx)
3. Work ticket stores format in `task_configuration`
4. Executor reads format from config instead of defaulting to "pdf"

---

## Agent SDK Integration: How Skills Get Triggered

**ReportingAgentSDK System Prompt** ([reporting_agent_sdk.py:65-76](work-platform/api/src/agents_sdk/reporting_agent_sdk.py#L65-L76)):

```
**CRITICAL: When user requests PDF, PPTX, XLSX, or DOCX format - you MUST use the Skill tool!**

**Trigger Conditions for Skills (IMPORTANT):**
When the format parameter is "pdf", "pptx", "xlsx", or "docx" → YOU MUST USE SKILL TOOL
- If format="pptx" → Use Skill tool to create PowerPoint file
- If format="pdf" → Use Skill tool to create PDF file
- If format="xlsx" → Use Skill tool to create Excel file
- If format="docx" → Use Skill tool to create Word file
- If format="markdown" → NO Skill needed, create text content
```

**How Agent Receives Format** ([reporting_agent_sdk.py:353-397](work-platform/api/src/agents_sdk/reporting_agent_sdk.py#L353-L397)):

```python
report_prompt = f"""Generate a {report_type} report in {format} format.

**Topic**: {topic}

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

For {format} format:
{"- Use Skill tool to generate professional file" if format in ["pdf", "xlsx", "pptx", "docx"] else "- Format as structured text with proper headers and formatting"}
"""
```

**Execution Flow**:
1. Agent receives prompt with `format` variable
2. If `format="pptx"`, prompt instructs: "Use Skill tool to create PowerPoint file"
3. Agent invokes `Skill` tool with `skill="pptx"`
4. Skill tool runs `.claude/skills/pptx/` scripts (html2pptx.js)
5. Returns file_id
6. Agent calls `emit_work_output` with:
   - `file_id`: From Skill tool
   - `file_format`: "pptx"
   - `generation_method`: "skill"

**Why It Fails**: If `format` is missing or defaults to wrong value, prompt doesn't trigger Skill usage.

---

## Recommendations: Streamlined Orchestration

### Option 1: Hybrid Approach (Keep Multi-Layer, Fix Format Flow)

**Keep**:
- Multi-layer orchestration (needed for trial limits, tracking, scaffolding)
- WorkBundle pattern (efficient context pre-loading)
- Three paths (direct workflows, TP gateway, project sessions)

**Fix**:
1. **Path C Fix**: Add `output_format` to work ticket creation
   ```python
   class CreateWorkTicketRequest(BaseModel):
       agent_id: str
       task_description: str
       output_format: Optional[str] = "markdown"  # ← ADD THIS
       # ... rest of fields
   ```

2. **Frontend Update**: Add format selector to work session creation UI
   ```tsx
   <select name="output_format">
     <option value="markdown">Markdown (Text)</option>
     <option value="pptx">PowerPoint (.pptx)</option>
     <option value="pdf">PDF Document</option>
     <option value="xlsx">Excel Spreadsheet</option>
     <option value="docx">Word Document</option>
   </select>
   ```

3. **TP Enhancement**: Add format extraction to `work_orchestration` tool
   ```python
   # Extract format from natural language keywords
   format_keywords = {
       "ppt": "pptx", "pptx": "pptx", "powerpoint": "pptx",
       "pdf": "pdf",
       "excel": "xlsx", "xlsx": "xlsx", "spreadsheet": "xlsx",
       "word": "docx", "docx": "docx", "doc": "docx"
   }

   detected_format = None
   for keyword, format_val in format_keywords.items():
       if keyword in task.lower():
           detected_format = format_val
           break

   parameters["format"] = detected_format or "markdown"
   ```

**Pros**:
- ✅ Minimal changes to existing architecture
- ✅ Preserves advanced features (tracking, trials, recipes)
- ✅ Fixes immediate Skills issue

**Cons**:
- Still complex multi-layer architecture
- Format extraction from natural language is heuristic (may fail edge cases)

---

### Option 2: Simplified Direct Invocation (Closer to Textbook SDK)

**Concept**: Add lightweight direct invocation path that bypasses work_request/work_ticket layers for simple requests.

```python
# New endpoint: POST /agents/quick-invoke
class QuickInvokeRequest(BaseModel):
    agent_type: Literal["research", "content", "reporting"]
    task_description: str
    output_format: Optional[str] = "markdown"
    basket_id: str

async def quick_invoke(request: QuickInvokeRequest):
    """Lightweight agent invocation - bypasses work_request tracking."""

    # Create agent directly (no work_request/work_ticket)
    if request.agent_type == "reporting":
        agent = ReportingAgentSDK(
            basket_id=request.basket_id,
            # ... minimal config
        )

        result = await agent.generate(
            report_type="general",
            format=request.output_format,
            topic=request.task_description
        )

    return result
```

**When to Use**:
- Quick one-off requests (no tracking needed)
- Internal tools (admin dashboards)
- Development/testing

**When NOT to Use**:
- User-facing production (need trial limits)
- Billable requests (need tracking)
- Multi-step workflows (need orchestration)

**Pros**:
- ✅ Closer to textbook Agent SDK (minimal layers)
- ✅ Fast and simple for appropriate use cases
- ✅ Format parameter flows directly

**Cons**:
- No trial limit enforcement
- No execution tracking (work_tickets)
- Can't leverage project scaffolding
- Separate code path to maintain

---

### Option 3: Recipe-First Architecture (Recommended Long-Term)

**Concept**: Make recipes the primary interface, with free-form as fallback.

**User Flow**:
1. User selects recipe: "PowerPoint Report", "Excel Dashboard", "PDF Executive Summary"
2. Recipe defines output_format automatically (pptx, xlsx, pdf)
3. User provides recipe parameters (time period, sections, etc.)
4. Backend executes recipe with correct format

**Benefits**:
- ✅ Format is implicit in recipe choice (no format field needed)
- ✅ Guided UX (users know what they'll get)
- ✅ Consistent quality (recipes are validated)
- ✅ Easier to maintain (fewer edge cases)

**Migration Path**:
1. Create common recipes for each format:
   - "PowerPoint Report" (format=pptx)
   - "PDF Document" (format=pdf)
   - "Excel Spreadsheet" (format=xlsx)
   - "Text Report" (format=markdown)
2. Update UI to show recipe gallery
3. Keep free-form as "Custom" option with explicit format field

**Example Recipe**:
```yaml
# .claude/work-recipes/powerpoint-report.yaml
slug: powerpoint-report
name: PowerPoint Report
description: Generate a professional PowerPoint presentation
agent_type: reporting
output_format: pptx  # ← Format is in recipe definition

parameters:
  topic: string
  slides_count: integer (default: 5)
  template: string (default: professional)
```

---

## Summary Matrix

| Path | Format Flow | Status | Fix Complexity |
|------|------------|--------|----------------|
| **Direct Workflows** (`/work/reporting/execute`) | ✅ Works correctly | Production-ready | N/A |
| **TP Gateway** (`work_orchestration` tool) | ⚠️ Doesn't extract format from natural language | Needs enhancement | Medium (add extraction logic) |
| **Project Work Sessions** (frontend-driven) | ❌ Format field missing | Broken for Skills | Low (add field + UI) |

**Immediate Action** (Option 1):
1. Add `output_format` field to `CreateWorkTicketRequest` model
2. Add format selector dropdown to work session creation UI
3. Update executor to read format from `task_config` instead of defaulting
4. Enhance TP's `work_orchestration` tool to extract format from keywords

**Long-Term Vision** (Option 3):
- Migrate to recipe-first architecture
- Format implicit in recipe choice
- Guided UX with recipe gallery
- Keep free-form as advanced option

---

## Technical Debt Notes

**Current Issues**:
1. Three different orchestration paths with different capabilities
2. Format parameter missing from one of three paths
3. Complex multi-layer architecture (8 layers from user → Claude API)
4. WorkBundle pattern adds staging complexity (but enables efficiency)
5. TP natural language extraction is heuristic (brittle for edge cases)

**Architecture Strengths**:
1. Trial limits & billing tracking (critical for monetization)
2. Project scaffolding (seamless multi-session continuity)
3. Context pre-loading (efficient substrate queries)
4. Recipe-driven execution (quality + consistency)
5. Checkpoint handling (long-running workflows)

**Trade-off**: Complexity vs Features. YARNNN chose features (justified for production SaaS), but format parameter got lost in the layers.

---

## Next Steps

1. **Immediate Fix** (this sprint):
   - [ ] Add `output_format` to `CreateWorkTicketRequest`
   - [ ] Update frontend work session creation UI
   - [ ] Test Skills invocation with format parameter

2. **TP Enhancement** (next sprint):
   - [ ] Add format extraction to `work_orchestration` tool
   - [ ] Update TP prompt with format extraction examples
   - [ ] Add clarifying questions when format ambiguous

3. **Long-Term Migration** (roadmap):
   - [ ] Create recipe library for common formats
   - [ ] Build recipe gallery UI
   - [ ] Migrate users to recipe-first workflow
   - [ ] Keep free-form as "Custom" advanced option

---

**Document Status**: Analysis Complete
**Author**: Claude Code
**Review Required**: System Architect, Product Manager
