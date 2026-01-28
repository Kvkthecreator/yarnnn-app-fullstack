# Work Ticket Tracking Page Refactor - Summary

**Date:** 2025-11-26
**Issue:** Tracking page not showing execution details (todos or work outputs)
**Root Cause:** Agent execution not producing outputs + UI not surfacing diagnostic info

---

## Problem Analysis

### What User Reported
- Tracking page showing no todo list (execution steps)
- No work results/outputs displayed
- Need better visibility into agent execution for autonomous work

### What Investigation Found

**Database Analysis** of recent `executive-summary-deck` work tickets:
```sql
5 recent tickets, ALL showing:
- status: "completed"
- execution_time_ms: 70-300 seconds (reasonable duration)
- metadata.output_count: 0
- metadata.final_todos: [] (empty array)
- work_outputs count: 0 (except 1 ticket with text-only output)
```

**Root Cause Identified:**
1. **Agent not calling tools properly** - Reporting agent completing but NOT:
   - Using `TodoWrite` for progress updates (hence empty `final_todos`)
   - Using `Skill` tool for PPTX generation (recipe requirement)
   - Calling `emit_work_output` to save results

2. **UI masking the problem** - Original tracking page:
   - Only showed todos for running tickets (not completed)
   - Only showed historical todos if they existed
   - No diagnostic information when outputs missing
   - No comparison of expected vs actual results

**Architecture Confirmed Working:**
- TodoWrite → emit_task_update → TASK_UPDATES → metadata.final_todos ✅
- Skill tool → file_id → emit_work_output → work_outputs table ✅
- SSE streaming for real-time updates ✅
- The infrastructure is solid, agent just not using it

---

## Solution: Comprehensive Tracking Page Refactor

### Key Improvements

#### 1. **Warning Banner** for Problematic Executions
```tsx
{isProblematicExecution && (
  <Card className="p-4 border-amber-500/30 bg-amber-50/50">
    <AlertTriangle />
    <h3>Execution Completed Without Outputs</h3>
    <p>Agent executed for {duration}s but did not produce any work outputs</p>
    <p>Expected: PPTX output via Skill tool • Actual: No outputs</p>
  </Card>
)}
```

**Triggers when:** status=completed AND no outputs AND not failed

#### 2. **Execution Trace** Section (Always Visible)

**For Running Tickets:**
- Live TaskProgressList with SSE streaming
- Shows real-time TodoWrite updates

**For Completed Tickets:**
```tsx
{hasExecutionSteps ? (
  // Show detailed steps from metadata.final_todos
) : (
  // Show warning + basic metadata
  <div className="text-amber-600 bg-amber-50">
    ⚠️ No execution steps recorded
    The agent completed but did not log detailed steps via TodoWrite
  </div>

  // Execution Metadata fallback:
  • Workflow: recipe_reporting
  • Recipe: executive-summary-deck
  • Execution time: 193.9s
  • Outputs generated: 0
)}
```

#### 3. **Enhanced Work Outputs** Section

**When Outputs Exist:**
- Show all outputs with metadata
- File format badges (PPTX, PDF, etc.)
- Generation method indicator
- Preview for text outputs
- Download button for files

**When Missing (for completed tickets):**
```tsx
<Card className="border-amber-500/20 bg-amber-50/30">
  <h2>No Work Outputs</h2>
  <p>The agent completed but did not generate any work outputs.</p>

  <div className="bg-amber-100 border">
    <p>Expected Output:</p>
    <ul>
      <li>Format: PPTX file</li>
      <li>Generation method: Skill tool</li>
      <li>Output type: report_draft or final_report</li>
    </ul>
  </div>

  <p className="text-xs">
    This may indicate a bug in agent execution or missing emit_work_output call.
    Check agent logs for more details.
  </p>
</Card>
```

#### 4. **Diagnostics Panel** (New - Right Column)
```tsx
<Card className="bg-gray-50/50">
  <h2>Diagnostics</h2>
  <div className="space-y-3 text-xs">
    • Ticket ID: 1dabc100...
    • Agent Type: reporting
    • Status: completed
    • Outputs: 0 (amber if zero, green if present)
    • Execution Steps: 0 (amber if zero, green if present)
    • Execution Time: 193.9s
  </div>
</Card>
```

#### 5. **Configuration Section** Enhanced
- Shows both actual AND expected output format
- Badges for comparison:
  - `reporting` (agent type)
  - `PPTX` (metadata format)
  - `Expected: PPTX` (recipe requirement)

---

## Files Changed

### Modified
- **`work-platform/web/app/projects/[id]/work-tickets/[ticketId]/track/TicketTrackingClient.tsx`**
  - Complete refactor (360 → 503 lines)
  - Added warning banners for problematic executions
  - Enhanced execution trace with fallback metadata display
  - New "No Work Outputs" explanatory card
  - Diagnostics panel for debugging
  - Icons for sections (FileText, Package, AlertTriangle)
  - Better conditional rendering (isRunning, isCompleted, isFailed)
  - Output preview improvements (500 char preview, char count)

### Unchanged (Already Working)
- `work-platform/web/app/projects/[id]/work-tickets/[ticketId]/track/page.tsx` - Server component with auth
- `work-platform/web/components/TaskProgressList.tsx` - SSE streaming component
- `work-platform/web/hooks/useTaskTracking.tsx` - Real-time task tracking hook

---

## User-Facing Improvements

### For Autonomous Work Scenarios

**1. Always Show Execution Details** (even after completion)
- Historical execution steps visible in "Execution Trace"
- Fallback to metadata when todos missing
- Shows what happened even hours/days later

**2. Diagnostic Information**
- Ticket ID for debugging
- Output count prominently displayed
- Execution time for performance tracking
- Color-coded status indicators (green = good, amber = missing)

**3. Expected vs Actual**
- Configuration shows both requested and actual format
- Warning banner explains discrepancies
- "No Work Outputs" card lists what SHOULD have been created

**4. Better Empty States**
- Explains WHY data is missing
- Provides context (execution time, workflow type)
- Suggests next steps (check logs)

### For Development/Debugging

**Visibility into Agent Behavior:**
- Can see if agent called TodoWrite (execution steps count)
- Can see if agent called emit_work_output (outputs count)
- Can see execution metadata even when structured data missing
- Warnings highlight when agent didn't follow recipe requirements

---

## Next Steps (Separate Issues)

### Agent Execution Fix (Critical)
**Problem:** Reporting agent not using tools properly
**Evidence:** 5/5 recent tickets show zero outputs, zero todos
**Impact:** Users get "completed" tickets with no deliverables

**Recommended Investigation:**
1. Check reporting_agent_sdk.py system prompt enforcement
2. Test recipe execution with manual validation
3. Add agent-level logging for tool calls
4. Consider adding validation before marking ticket "completed"

### Recipe Migration (Low Priority)
**Current:** Recipes hardcoded in TypeScript frontend
**Desired:** Recipes in database (work_recipes table)
**Status:** Schema ready, migration straightforward, not blocking

---

## Testing Recommendations

1. **Create new work ticket** with executive-summary-deck recipe
2. **Monitor in real-time:**
   - Should see live progress in "Execution Progress"
   - TodoWrite updates should stream via SSE
   - Should see todos appear in real-time

3. **After completion:**
   - Check "Execution Trace" shows historical steps
   - Verify "Work Outputs" section populated
   - Confirm no warning banners

4. **If outputs still missing:**
   - Warning banner should appear
   - Diagnostics panel shows zeros in amber
   - "No Work Outputs" card explains expectations
   - User has full context for reporting issue

---

## Technical Notes

### Architecture Validated
- **Three-stream real-time:** Server Render + Supabase Realtime + SSE ✅
- **TodoWrite capture:** emit_task_update → TASK_UPDATES → metadata ✅
- **Work outputs:** Skill → file_id → emit_work_output → DB ✅

### UI Patterns
- Conditional rendering based on status (isRunning, isCompleted, isFailed)
- Color-coded diagnostic indicators (green/amber)
- Warning banners for unexpected states
- Fallback content when structured data missing
- Icon-enhanced section headers for scannability

### UX Philosophy
- **Transparency:** Always show what happened (or didn't)
- **Context:** Explain why data is missing
- **Actionability:** Tell users what to do next
- **Debugging:** Surface diagnostic info without clutter
