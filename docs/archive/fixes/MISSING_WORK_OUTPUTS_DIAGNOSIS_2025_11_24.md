# Missing Work Outputs Diagnosis (Nov 24, 2025)

## Problem Statement

**Symptom**: Recipe execution completes successfully (200 OK, 86 seconds) but produces ZERO work_outputs despite agent running.

**Evidence**:
- Work ticket: `06aa8e96-678a-4766-bf72-b057ff52021a` status=`completed`
- Metadata: `{"output_count": 0, "execution_time_ms": 85998}`
- Agent session `conversation_history: []` (EMPTY)
- Agent session `sdk_session_id: null` (NOT SAVED)
- No rows in `work_outputs` table for this work ticket

## Root Cause Analysis

### Finding 1: Conversation History NOT Persisted

**Location**: `reporting_agent_sdk.py` lines 477-480

```python
# Update agent session with new claude_session_id
if new_session_id:
    self.current_session.update_claude_session(new_session_id)
    logger.info(f"Stored Claude session: {new_session_id}")
```

**Problem**: `update_claude_session()` only stores `sdk_session_id`, but does NOT store `conversation_history`.

**Evidence from session.py lines 201-227**:
```python
def update_claude_session(self, sdk_session_id: str) -> None:
    """Update Claude SDK session ID (synchronous wrapper for compatibility)."""
    self.sdk_session_id = sdk_session_id
    self.claude_session_id = sdk_session_id  # Keep alias in sync

    # ... schedules async save() but ONLY saves sdk_session_id
```

**Result**: The agent's conversation (including Claude's responses and tool invocations) is NEVER stored in the database.

---

### Finding 2: Work Outputs ARE Being Captured Correctly in Code

**Location**: `reporting_agent_sdk.py` lines 637-672

The code DOES capture work outputs from tool results:

```python
# Tool result blocks (extract work outputs)
elif block_type == 'tool_result':
    tool_name = getattr(block, 'tool_name', '')
    logger.debug(f"Tool result from: {tool_name}")

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
```

**This code is correct** - it should capture tool results properly.

---

### Finding 3: Agent May Not Be Calling emit_work_output

**Hypothesis**: The agent runs for 86 seconds but never actually calls the `emit_work_output` tool.

**Why this might happen**:

1. **System Prompt Ambiguity**: The system prompt says to use Skills for file generation, but might not be clear enough that `emit_work_output` MUST be called AFTER using the Skill tool.

   **Evidence** from `reporting_agent_sdk.py` lines 111-117:
   ```
   **After Using Skill - YOU MUST:**
   1. Get the file_id from Skill tool response
   2. Call emit_work_output with:
      - file_id: The ID returned by Skill
      - file_format: "pptx", "pdf", "xlsx", or "docx"
      - generation_method: "skill"
      - body: Brief description of what the file contains
   ```

   But the recipe system prompt might be OVERRIDING these instructions.

2. **Recipe Context May Not Emphasize emit_work_output**:

   **Evidence** from `reporting_agent_sdk.py` lines 599-601:
   ```python
   **Important**:
   Execute this recipe and emit work_output with validation metadata using the emit_work_output tool.
   ```

   This is only ONE line at the end, easily missed.

3. **Skill Tool Might Be Failing Silently**: If the Skill tool fails to generate the PPTX, Claude might not know what to do next and just finish without emitting an output.

---

## Diagnostic Questions to Answer

To determine which hypothesis is correct, we need to check:

### Q1: Did Claude call the Skill tool?
**How to check**: Look at Render backend logs during the 86-second execution window for:
- `[INFO] Using Skill tool: skill_id=pptx`
- Skill tool responses with file_id

### Q2: Did the Skill tool succeed or fail?
**How to check**: Look for Skill tool errors in logs:
- `Skill tool failed: ...`
- `file_id` returned or error message

### Q3: Did Claude call emit_work_output?
**How to check**: Look for MCP server logs:
- `emit_work_output: type=..., basket=..., ticket=...`
- `emit_work_output SUCCESS: output_id=...`
- OR `emit_work_output FAILED: ...`

### Q4: What did Claude actually say in its response?
**How to check**: Look for response text in logs:
- The `response_text` variable captures all text blocks from Claude
- Should see reasoning about what it's doing

---

## Immediate Next Steps

1. **Check Render Logs**: User needs to provide backend logs from the execution window:
   - Timestamp: Around the time of work ticket creation (check `work_tickets.created_at`)
   - Service: `yarnnn-app-fullstack` or similar
   - Search for: `work_ticket_id=06aa8e96-678a-4766-bf72-b057ff52021a`

2. **Add More Logging**: If logs don't show enough detail, add debug logging:
   ```python
   # In reporting_agent_sdk.py execute_recipe method
   logger.info(f"[DEBUG] Response text: {response_text[:500]}")
   logger.info(f"[DEBUG] Work outputs captured: {len(work_outputs)}")
   logger.info(f"[DEBUG] Tool results seen: {[block.type for block in message.content if hasattr(block, 'type')]}")
   ```

3. **Test with Simplified Recipe**: Try a minimal recipe that:
   - Doesn't use Skills (just markdown output)
   - Has very explicit emit_work_output instructions
   - Can verify if basic emit_work_output works

---

## Hypotheses Ranked by Likelihood

### 1. MOST LIKELY: Agent Didn't Call emit_work_output
**Probability**: 70%

**Reasoning**:
- `output_count: 0` confirms no outputs were captured
- Code for capturing outputs looks correct
- Most likely explanation: Claude never invoked the tool

**Fix**: Strengthen system prompt to make emit_work_output mandatory

---

### 2. LIKELY: Skill Tool Failed Silently
**Probability**: 20%

**Reasoning**:
- Skills integration might have configuration issues
- If Skill fails, Claude might not know what to do
- No file_id means can't emit output (might cause confusion)

**Fix**: Add better error handling for Skill tool failures

---

### 3. POSSIBLE: emit_work_output MCP Server Failing
**Probability**: 8%

**Reasoning**:
- Substrate API call might be failing (400/500 error)
- MCP server logs would show this
- Tool would appear to Claude as "failed"

**Fix**: Check substrate-API logs for POST /api/baskets/{id}/work-outputs

---

### 4. UNLIKELY: Response Parsing Bug
**Probability**: 2%

**Reasoning**:
- Code looks correct
- Would affect all recipe executions (not just this one)
- No error logs about parsing failures

**Fix**: Add defensive logging around tool result parsing

---

## User's Question: "is there anyway to check the agent's reply aside from the tool invocation?"

**Answer**: YES, the `response_text` variable in the code captures all text blocks from Claude's response. However, this is only logged, not stored in the database.

**To see what Claude actually said**:
1. Check Render backend logs for log entries with `work_ticket_id=06aa8e96-678a-4766-bf72-b057ff52021a`
2. Look for lines like:
   - `[INFO] Recipe execution produced X structured outputs`
   - `[INFO] Report generation complete: ...`
   - `[DEBUG] SDK message type: ...`
   - `[DEBUG] SDK block type: ...`

**Better Solution for Future**:
Store `response_text` in work_ticket metadata so it's queryable:

```python
# In workflow_reporting.py after execution completes
supabase.table("work_tickets").update({
    "status": "completed",
    "completed_at": "now()",
    "metadata": {
        "workflow": "recipe_reporting",
        "execution_time_ms": execution_time_ms,
        "output_count": result.get("output_count", 0),
        "recipe_slug": recipe.slug if recipe else None,
        "claude_response_preview": result.get("response_text", "")[:1000],  # First 1000 chars
    },
}).eq("id", work_ticket_id).execute()
```

---

## Recommended Fixes

### Fix 1: Store conversation_history (CRITICAL)

**File**: `reporting_agent_sdk.py` lines 689-693

**Change**:
```python
# Update agent session with new claude_session_id AND conversation_history
if new_session_id and self.current_session:
    self.current_session.sdk_session_id = new_session_id
    self.current_session.claude_session_id = new_session_id

    # TODO: Capture conversation_history from ClaudeSDKClient
    # self.current_session.conversation_history = client.get_conversation_history()

    await self.current_session.save()  # Properly await save
    logger.info(f"Stored Claude session: {new_session_id}")
```

**Problem**: ClaudeSDKClient might not expose conversation history. Need to check SDK docs.

---

### Fix 2: Store response_text in work_ticket metadata

**File**: `workflow_reporting.py` lines 300-309

**Change**:
```python
supabase.table("work_tickets").update({
    "status": "completed",
    "completed_at": "now()",
    "metadata": {
        "workflow": "recipe_reporting" if recipe else "deterministic_reporting",
        "execution_time_ms": execution_time_ms,
        "output_count": result.get("output_count", 0),
        "recipe_slug": recipe.slug if recipe else None,
        "claude_response_preview": result.get("response_text", "")[:1000],  # NEW
    },
}).eq("id", work_ticket_id).execute()
```

---

### Fix 3: Strengthen system prompt for emit_work_output

**File**: `reporting_agent_sdk.py` lines 552-570

**Change**: Add more emphasis:
```python
recipe_system_prompt += """

**CRITICAL INSTRUCTION - MANDATORY TOOL USE**:
At the end of this recipe execution, you MUST call emit_work_output tool.
This is NOT optional. Every recipe execution MUST produce at least one work_output.

If you used the Skill tool to generate a file:
- Extract the file_id from the Skill response
- Call emit_work_output with file_id, file_format, and generation_method="skill"

If you did not generate a file:
- Call emit_work_output with body containing your analysis/report text
- Set generation_method="text"

DO NOT end the conversation without calling emit_work_output.
"""
```

---

## Conclusion

Most likely the agent never called `emit_work_output` because:
1. System prompt not emphatic enough about mandatory tool use
2. OR Skill tool failed and agent didn't know what to do next
3. OR Substrate API rejected the emit_work_output request

**Next Action**: Check Render logs to determine which scenario occurred.
