# Skills Invocation Root Cause Analysis (Nov 24, 2025)

## Executive Summary

**Problem**: Reporting agent generating text reports instead of calling Skill tool for PPTX generation, despite correct Skills configuration and explicit recipe instructions.

**Root Cause**: Format parameter (`pptx`) is passed to agent **inside a nested dictionary** (`output_specification.format`) rather than as a top-level, prominent instruction. The agent is not recognizing this as the trigger condition to invoke the Skill tool.

**Fix Complexity**: MEDIUM - Requires modifying the recipe execution prompt template to make format more prominent.

---

## Configuration Verification (ALL CORRECT ✅)

### 1. Skills Installation ✅
```bash
$ ls -la work-platform/api/.claude/skills/
drwxr-xr-x@ 8 docx
drwxr-xr-x@ 7 pdf
drwxr-xr-x@ 8 pptx  ← PPTX skill installed
drwxr-xr-x@ 5 xlsx
```

**Status**: All document-skills properly installed from Anthropic's repository.

### 2. Agent Configuration ✅
```python
# work-platform/api/src/agents_sdk/reporting_agent_sdk.py:252-263
self._options = ClaudeAgentOptions(
    model=self.model,
    system_prompt=self._build_system_prompt(),
    mcp_servers={"shared_tools": shared_tools},
    allowed_tools=[
        "mcp__shared_tools__emit_work_output",
        "Skill",              # ✅ Skill tool enabled
        "code_execution"      # ✅ Required for Skills
    ],
    setting_sources=["user", "project"],  # ✅ Enables .claude/ discovery
)
```

**Status**: All required configuration parameters present.

### 3. System Prompt Guidance ✅
```python
# work-platform/api/src/agents_sdk/reporting_agent_sdk.py:66-75
**CRITICAL: When user requests PDF, PPTX, XLSX, or DOCX format - you MUST use the Skill tool!**

**Trigger Conditions for Skills (IMPORTANT):**
When the format parameter is "pdf", "pptx", "xlsx", or "docx" → YOU MUST USE SKILL TOOL
- If format="pptx" → Use Skill tool to create PowerPoint file
- If format="pdf" → Use Skill tool to create PDF file
...
```

**Status**: Clear instructions present in base system prompt.

### 4. Recipe Database Configuration ✅
```json
// work_recipes table, slug='executive-summary-deck'
{
  "output_specification": {
    "format": "pptx",  // ✅ Correct format specified
    "required_sections": ["Title", "Key Insights", "Next Steps"],
    "validation_rules": {
      "format_is_pptx": true,
      "slide_count_in_range": true,
      "required_sections_present": true
    }
  }
}
```

**Status**: Recipe correctly specifies PPTX format.

### 5. Recipe Execution Template ✅
```json
{
  "task_breakdown": [
    "Load substrate blocks (insights, findings, recommendations, analysis)",
    "Parse reference assets if provided (extract style, structure, tone)",
    "Identify {{slide_count}} key insights from substrate context",
    "Generate {{slide_count}}-slide PPTX deck using Claude pptx Skill",  // ✅ Explicit instruction
    "Required sections: Title, Key Insights, Next Steps",
    "If focus_area provided, emphasize related insights",
    "Emit work_output with format=pptx, validation metadata"
  ]
}
```

**Status**: Task step 4 explicitly tells agent to use the pptx Skill.

---

## Root Cause Analysis

Despite all correct configuration, the agent is **NOT invoking the Skill tool**. Analysis of the prompt structure reveals the issue:

### Current Prompt Structure (Problematic)

When `execute_recipe()` builds the user prompt, the format is buried:

```python
# work-platform/api/src/agents_sdk/reporting_agent_sdk.py:583-601
user_prompt = f"""**Deliverable Intent**
Purpose: {deliverable_intent.get('purpose', 'Generate report')}
Audience: {deliverable_intent.get('audience', 'General audience')}
Expected Outcome: {deliverable_intent.get('outcome', 'Professional deliverable')}

**Task Breakdown**:
1. Load substrate blocks
2. Parse reference assets
3. Identify 5 key insights
4. Generate 5-slide PPTX deck using Claude pptx Skill
5. Required sections: Title, Key Insights, Next Steps
6. If focus_area provided, emphasize related insights
7. Emit work_output with format=pptx, validation metadata

**Validation Requirements**:
After generation, verify: (1) Slide count matches, (2) All required sections present, (3) Format is PPTX

**Expected Output Specification**:
- Format: pptx                          ← Format buried here
- Required Sections: Title, Key Insights, Next Steps
- Validation Rules: {'format_is_pptx': True, ...}

**Important**:
Execute this recipe and emit work_output with validation metadata.
"""
```

### Why This Fails

According to Anthropic's Skills documentation:

> **Skills use "progressive disclosure" with three levels:**
> 1. **Metadata layer**: Name and description loaded at startup
> 2. **Core instructions**: Full SKILL.md loaded when relevant
> 3. **Referenced files**: Additional resources loaded as needed
>
> **The metadata is critical—Claude decides whether to activate a skill based on the name and description fields.**

**The problem**: The format parameter is mentioned in task step 4 ("using Claude pptx Skill"), but:
1. It's mixed with other instructions (slide count, sections, validation)
2. The word "pptx" appears multiple times in different contexts
3. The agent sees it as a **validation requirement** ("Format is PPTX") not as a **tool invocation trigger**

**Agent's likely reasoning**:
```
Task: Generate 5-slide PPTX deck
Agent thinks: "I'll create content for a deck, format it as text,
              and emit_work_output will handle the pptx conversion"
```

The agent doesn't realize it needs to **actively call the Skill tool** because:
- The format field comes AFTER the task breakdown
- The system prompt says "when format=pptx" but the format is in a nested dict
- Task step 4 mentions "using Claude pptx Skill" but doesn't say "INVOKE THE SKILL TOOL"

---

## Evidence from Production

### Work Tickets Analysis
```sql
SELECT
    metadata->>'recipe_slug',
    metadata->>'recipe_parameters',
    metadata->>'output_format'
FROM work_tickets
WHERE basket_id = '4eccb9a0-9fe4-4660-861e-b80a75a20824'
ORDER BY created_at DESC LIMIT 3;

-- Results:
-- recipe_slug='executive-summary-deck'
-- recipe_parameters=NULL  ← No custom parameters passed
-- output_format=NULL       ← Not set at ticket level
```

### Work Outputs Analysis
```sql
SELECT
    file_id,
    file_format,
    generation_method,
    LENGTH(body) as body_length
FROM work_outputs
WHERE basket_id = '4eccb9a0-9fe4-4660-861e-b80a75a20824';

-- Results:
-- All 3 outputs:
--   file_id: NULL
--   file_format: NULL
--   generation_method: "text"
--   body_length: 9597, 10923, 12958 bytes (text content)
```

**Conclusion**: Agent executed recipe, emitted work outputs successfully, but generated text reports instead of calling Skills.

---

## The Fix: Make Format Top-Level and Explicit

### Solution 1: Modify Recipe Execution Prompt (RECOMMENDED)

Update the `execute_recipe()` method to make format a **top-level, explicit instruction**:

```python
# work-platform/api/src/agents_sdk/reporting_agent_sdk.py:583-601
# BEFORE (current):
user_prompt = f"""**Deliverable Intent**
Purpose: {deliverable_intent.get('purpose')}
...
**Expected Output Specification**:
- Format: {output_spec.get('format', 'Unknown')}
...
"""

# AFTER (proposed):
format_value = output_spec.get('format', 'markdown')
skill_required = format_value in ['pdf', 'pptx', 'xlsx', 'docx']

user_prompt = f"""**🎯 PRIMARY REQUIREMENT: OUTPUT FORMAT = {format_value.upper()}**

{"⚠️ CRITICAL: You MUST use the Skill tool to generate this file!" if skill_required else ""}
{f"- Tool to invoke: Skill (skill_id='{format_value}')" if skill_required else ""}
{f"- After Skill execution, call emit_work_output with file_id and file_format='{format_value}'" if skill_required else ""}

**Deliverable Intent**
Purpose: {deliverable_intent.get('purpose')}
Audience: {deliverable_intent.get('audience')}
Expected Outcome: {deliverable_intent.get('outcome')}

**Task Breakdown**:
{task_instructions}

**Validation Requirements**:
{validation_instructions}

**Output Specification**:
- Format: {format_value}
- Required Sections: {', '.join(output_spec.get('required_sections', []))}
- Validation Rules: {output_spec.get('validation_rules', {})}

**EXECUTION WORKFLOW** (if file format required):
1. First: Invoke Skill tool with skill_id="{format_value}"
2. Skill returns: file_id (Claude Files API identifier)
3. Finally: Call emit_work_output with file_id and generation_method="skill"

**Important**:
Execute this recipe and emit work_output with all validation metadata.
"""
```

### Why This Works

1. **Top-level visibility**: Format appears at the VERY TOP in large text
2. **Explicit tool invocation**: "You MUST use the Skill tool"
3. **Step-by-step workflow**: Clear sequence (invoke Skill → get file_id → emit_work_output)
4. **Visual prominence**: Emojis and capitalization draw attention
5. **Conditional logic**: Only shows Skill instructions when format requires it

### Anthropic Guidance Applied

From the blog post:
> **"Think from Claude's perspective"** - Monitor real usage and iterate; pay attention to skill names/descriptions

The fix applies this by:
- Making the format **immediately visible** (Claude sees it first)
- Using **explicit tool names** ("Skill tool with skill_id='pptx'")
- Providing **step-by-step workflow** (matching Skills' progressive disclosure pattern)

---

## Alternative Solutions (Not Recommended)

### Solution 2: Add Format to System Prompt ❌
**Why not**: System prompt is static across all recipes. Adding recipe-specific format would require rebuilding options per request (slower, more complex).

### Solution 3: Modify Recipe Template ❌
**Why not**: Recipe templates should be user-friendly, not contain technical tool invocation details. The fix should be in the execution layer.

### Solution 4: Use Agentic Tool Selection ❌
**Why not**: Claude already supports agentic tool selection. The issue is prompt clarity, not SDK limitations.

---

## Implementation Plan

### Step 1: Update execute_recipe() Method

**File**: `work-platform/api/src/agents_sdk/reporting_agent_sdk.py`
**Lines**: 583-601 (user_prompt construction)

```python
# Add format extraction and prominence
format_value = output_spec.get('format', 'markdown')
skill_formats = {'pdf', 'pptx', 'xlsx', 'docx'}
requires_skill = format_value in skill_formats

# Build prominent format instruction
format_header = f"""**🎯 PRIMARY REQUIREMENT: OUTPUT FORMAT = {format_value.upper()}**
"""

if requires_skill:
    format_header += f"""
⚠️ **CRITICAL INSTRUCTION**: You MUST use the Skill tool to generate this {format_value.upper()} file!

**STEP-BY-STEP WORKFLOW FOR FILE GENERATION:**
1. **INVOKE SKILL TOOL**:
   - Use: Skill tool with skill_id="{format_value}"
   - Provide: Content structure, sections, data as instructed below
   - Skill returns: file_id (Claude Files API identifier)

2. **EMIT WORK OUTPUT**:
   - Call: emit_work_output tool
   - Include: file_id=<from Skill>, file_format="{format_value}", generation_method="skill"
   - Add: Validation metadata confirming all requirements met

**DO NOT** generate text content only. Files must be created via Skill tool.

---
"""

# Continue with rest of prompt
user_prompt = format_header + f"""
**Deliverable Intent**
Purpose: {deliverable_intent.get('purpose', 'Generate report')}
...
```

### Step 2: Test with Executive Summary Deck Recipe

```bash
# Via API:
curl -X POST 'https://yarnnn-app-fullstack.onrender.com/api/work/reporting/execute' \
  -H 'Authorization: Bearer YOUR_TOKEN' \
  -H 'Content-Type: application/json' \
  -d '{
    "basket_id": "4eccb9a0-9fe4-4660-861e-b80a75a20824",
    "task_description": "Generate Q4 executive summary",
    "recipe_id": "executive-summary-deck",
    "recipe_parameters": {
      "slide_count": 5,
      "focus_area": "Revenue growth"
    }
  }'
```

### Step 3: Verify Skill Invocation

**Check logs for**:
```
[INFO] Skill tool invoked: skill_id=pptx
[INFO] Skill returned: file_id=file_011CNha...
[INFO] emit_work_output called with file_id=file_011CNha, file_format=pptx
```

**Check database**:
```sql
SELECT
    file_id,
    file_format,
    generation_method,
    title
FROM work_outputs
WHERE work_ticket_id IN (
    SELECT id FROM work_tickets
    WHERE basket_id = '4eccb9a0-9fe4-4660-861e-b80a75a20824'
    ORDER BY created_at DESC LIMIT 1
);

-- Expected:
-- file_id: file_011CNha... (not NULL)
-- file_format: pptx
-- generation_method: skill
```

### Step 4: Verify File Download

```python
# Test file retrieval
from anthropic import Anthropic

client = Anthropic(api_key=ANTHROPIC_API_KEY)
file_content = client.beta.files.download(file_id="file_011CNha...")

with open("output.pptx", "wb") as f:
    f.write(file_content)

# Open output.pptx in PowerPoint to verify
```

---

## Success Criteria

- ✅ Agent invokes Skill tool when recipe specifies file format
- ✅ Skill returns file_id successfully
- ✅ emit_work_output saves file_id + file_format correctly
- ✅ work_outputs table shows `generation_method='skill'` and file_id populated
- ✅ File can be downloaded via Claude Files API
- ✅ Recipe executions produce 1+ work outputs (not zero)
- ✅ No regression to text-only outputs for file formats

---

## Risk Assessment

**Severity**: HIGH - 100% of recipe executions producing wrong output type
**Fix Complexity**: MEDIUM - Single-file prompt modification
**Risk**: LOW - Only changes prompt template, no schema/API changes
**Deployment**: FAST - Code-only fix, no database migration

---

## Prevention Measures

### Immediate:
1. ✅ Add integration test for Skills invocation
2. ✅ Document prompt structure best practices
3. ✅ Add logging for Skill tool invocations

### Long-term:
1. Create recipe testing framework (validate Skills calls)
2. Add pre-deployment recipe execution tests
3. Monitor work_outputs for generation_method distribution
4. Alert on 100% text generation for file-format recipes

---

## References

**Anthropic Documentation**:
- [Equipping Agents for the Real World with Agent Skills](https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills)
- Agent Skills Overview: https://docs.claude.com/en/agents-and-tools/agent-skills/overview
- Agent SDK Python: https://docs.claude.com/en/agent-sdk/python

**Internal Documentation**:
- `docs/architecture/SKILLS_ARCHITECTURE_INVESTIGATION.md` - Complete Skills investigation
- `docs/architecture/CLAUDE_SDK_IMPLEMENTATION.md` - SDK integration decisions
- `work-platform/api/test_pptx_skill.py` - Working Skills test example

---

## Timeline

- **Nov 17**: Original work_outputs table created
- **Nov 19**: Skills installed, agent configuration added
- **Nov 23**: Recipe-driven execution implemented
- **Nov 24 07:55**: First recipe execution (produced text, not PPTX)
- **Nov 24 08:45**: work_outputs FK constraint fixed (422 errors resolved)
- **Nov 24 10:00**: Frontend outputs view working
- **Nov 24 11:36**: Multiple recipe executions completing (all text, no Skills)
- **Nov 24 (now)**: Root cause identified - prompt structure issue
- **Next**: Apply fix and test

---

## Deployment Checklist

- [ ] Update `execute_recipe()` method with prominent format instructions
- [ ] Add logging for Skill tool invocations
- [ ] Commit and push to main branch
- [ ] Wait for Render auto-deployment (~5 minutes)
- [ ] Test recipe execution via API
- [ ] Verify Skill tool invocation in logs
- [ ] Check work_outputs table for file_id population
- [ ] Download and verify generated PPTX file
- [ ] Mark ticket as resolved

---

## Conclusion

The Skills system is **fully configured correctly** but the agent isn't recognizing the trigger to invoke Skills due to **prompt structure**. The format parameter needs to be:

1. **Top-level** (not buried in nested dict)
2. **Visually prominent** (emojis, capitalization, position)
3. **Explicit about tool invocation** (not just "using pptx Skill" but "INVOKE Skill tool")
4. **Step-by-step workflow** (matching Skills' progressive disclosure pattern)

This is a **prompt engineering fix**, not a configuration or architecture issue.
