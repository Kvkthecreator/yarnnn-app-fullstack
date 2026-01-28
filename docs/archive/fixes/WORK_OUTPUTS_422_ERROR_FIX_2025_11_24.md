# Work Outputs 422 Error Fix (Nov 24, 2025)

## Problem Summary

**Symptom**: Recipe execution completes but produces ZERO work_outputs. Work ticket shows `output_count: 0`.

**Root Cause**: Database schema mismatch - the `work_outputs` table still has column `work_session_id` but the code is sending `work_ticket_id`.

## Evidence from Logs

Render logs show multiple emit_work_output calls **ARE happening** but substrate-API is rejecting them:

```
emit_work_output HTTP error: 422 {
  "detail": [{
    "type": "missing",
    "loc": ["body", "work_session_id"],
    "msg": "Field required"
  }]
}
```

**Agent WAS working correctly** - it called emit_work_output as expected!

**Problem**: Migration `20251119_work_outputs_file_support.sql` exists in codebase but was **NEVER applied** to production database.

## What Happened

1. **Nov 17**: Original `work_outputs` table created with `work_session_id` column
2. **Nov 19**: Migration created to rename `work_session_id` → `work_ticket_id` (Phase 2e alignment)
3. **Nov 19-24**: Code updated to use `work_ticket_id` everywhere
4. **BUT**: Migration never applied to Supabase production database
5. **Result**: Code sends `work_ticket_id`, database expects `work_session_id` → 422 error

## Migration File

**File**: `supabase/migrations/20251119_work_outputs_file_support.sql`

Key changes:
```sql
-- Rename work_session_id → work_ticket_id
ALTER TABLE public.work_outputs
  RENAME COLUMN work_session_id TO work_ticket_id;

-- Update foreign key constraint
ALTER TABLE public.work_outputs
  DROP CONSTRAINT IF EXISTS work_outputs_work_session_id_fkey,
  ADD CONSTRAINT work_outputs_work_ticket_id_fkey
    FOREIGN KEY (work_ticket_id)
    REFERENCES public.work_tickets(id)
    ON DELETE CASCADE;
```

## Solution

### Step 1: Apply Migration to Production

```bash
# Using psql
PG_DUMP_URL="postgresql://postgres.galytxxkrbksilekmhcw:4ogIUdwWzVyPH0nU@aws-0-ap-northeast-2.pooler.supabase.com:6543/postgres?sslmode=require"

psql "$PG_DUMP_URL" -f supabase/migrations/20251119_work_outputs_file_support.sql
```

**OR** via Supabase Dashboard:
1. Go to https://supabase.com/dashboard/project/galytxxkrbksilekmhcw/sql
2. Copy contents of `supabase/migrations/20251119_work_outputs_file_support.sql`
3. Paste and run

### Step 2: Verify Migration Applied

```sql
-- Check column exists
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'work_outputs'
AND column_name = 'work_ticket_id';

-- Should return: work_ticket_id | uuid

-- Check old column is gone
SELECT column_name
FROM information_schema.columns
WHERE table_name = 'work_outputs'
AND column_name = 'work_session_id';

-- Should return: (no rows)
```

### Step 3: Test Recipe Execution

1. Run the Executive Summary Deck recipe again
2. Check logs for successful emit_work_output:
   ```
   emit_work_output SUCCESS: output_id=...
   ```
3. Verify work_outputs table has new rows:
   ```sql
   SELECT id, title, output_type, agent_type, created_at
   FROM work_outputs
   WHERE work_ticket_id IN (
     SELECT id FROM work_tickets
     WHERE basket_id = '4eccb9a0-9fe4-4660-861e-b80a75a20824'
     ORDER BY created_at DESC LIMIT 1
   );
   ```

## Why This Happened

**Likely causes**:
1. Migration file created locally but manual SQL run forgotten
2. Migration not tracked in migration history table
3. Deployment process doesn't auto-apply migrations (requires manual step)

## Prevention

### Immediate Actions:
1. ✅ Apply missing migration
2. ✅ Document migration application process
3. ✅ Test recipe execution end-to-end

### Long-term Actions:
1. Set up migration tracking system
2. Add migration check to deployment checklist
3. Consider automated migration application (with safeguards)
4. Add integration test that validates schema matches code expectations

## Impact Assessment

**Before Fix**:
- ❌ 100% of emit_work_output calls failing with 422 error
- ❌ Zero work outputs being created
- ❌ User sees "completed" work tickets with no outputs
- ❌ Agent execution appears broken

**After Fix**:
- ✅ emit_work_output calls should succeed
- ✅ Work outputs persisted to database
- ✅ User can see/approve agent outputs
- ✅ Recipe-driven workflow fully functional

## Related Files

**Migration**:
- `supabase/migrations/20251119_work_outputs_file_support.sql` (needs to be applied)

**Code using work_ticket_id** (all correct):
- `work-platform/api/src/agents_sdk/shared_tools_mcp.py` line 135
- `substrate-api/api/src/app/work_outputs/routes.py` line 36 (schema)
- Frontend components (work tickets view)

**Database table**:
- Currently has: `work_session_id uuid NOT NULL` ← WRONG
- Should have: `work_ticket_id uuid NOT NULL` ← CORRECT (after migration)

## Commands to Execute

```bash
# 1. Connect to database and apply migration
psql "postgresql://postgres.galytxxkrbksilekmhcw:4ogIUdwWzVyPH0nU@aws-0-ap-northeast-2.pooler.supabase.com:6543/postgres?sslmode=require" \
  -f supabase/migrations/20251119_work_outputs_file_support.sql

# 2. Verify migration applied
psql "postgresql://postgres.galytxxkrbksilekmhcw:4ogIUdwWzVyPH0nU@aws-0-ap-northeast-2.pooler.supabase.com:6543/postgres?sslmode=require" \
  -c "\\d work_outputs" | grep work_ticket_id

# Expected output:
# work_ticket_id              | uuid    |           | not null |

# 3. Check for any existing work_outputs with old column (should be 0)
psql "postgresql://postgres.galytxxkrbksilekmhcw:4ogIUdwWzVyPH0nU@aws-0-ap-northeast-2.pooler.supabase.com:6543/postgres?sslmode=require" \
  -c "SELECT COUNT(*) FROM work_outputs;"

# 4. Test recipe execution via API
curl -X POST 'https://yarnnn-app-fullstack.onrender.com/api/work/reporting/execute' \
  -H 'Authorization: Bearer YOUR_TOKEN' \
  -H 'Content-Type: application/json' \
  -d '{
    "basket_id": "4eccb9a0-9fe4-4660-861e-b80a75a20824",
    "task_description": "Test work outputs creation",
    "output_format": "markdown",
    "recipe_id": "executive-summary-deck"
  }'

# 5. Check work_outputs created
psql "postgresql://postgres.galytxxkrbksilekmhcw:4ogIUdwWzVyPH0nU@aws-0-ap-northeast-2.pooler.supabase.com:6543/postgres?sslmode=require" \
  -c "SELECT id, title, agent_type, created_at FROM work_outputs ORDER BY created_at DESC LIMIT 5;"
```

## Success Criteria

- ✅ Migration applied without errors
- ✅ Column `work_ticket_id` exists in `work_outputs` table
- ✅ Column `work_session_id` does NOT exist
- ✅ Recipe execution completes AND creates work_outputs
- ✅ No 422 errors in Render logs for emit_work_output
- ✅ Work tickets show `output_count > 0` in metadata

## Timeline

- **Nov 17**: Original work_outputs table created
- **Nov 19**: Migration file created (but not applied)
- **Nov 24 (earlier)**: Recipe execution producing 0 outputs discovered
- **Nov 24 (now)**: Root cause identified - missing migration application
- **Next**: Apply migration and test

## Deployment Note

This is a **database-only fix** - no code deployment needed. Once migration is applied, the existing deployed code will immediately start working.
