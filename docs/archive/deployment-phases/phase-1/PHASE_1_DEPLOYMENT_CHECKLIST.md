# Phase 1 Deployment - Pre-Flight Checklist

**Date:** 2025-11-13
**Database:** Shared Supabase PostgreSQL (work-platform + substrate-API in same DB)
**Connection:** `postgresql://postgres.galytxxkrbksilekmhcw:4ogIUdwWzVyPH0nU@aws-0-ap-northeast-2.pooler.supabase.com:6543/postgres`

---

## ✅ Current State Verification

### Existing Tables
- ✅ `projects` - exists
- ✅ `project_agents` - exists (has FK to agent_catalog)
- ✅ `work_sessions` - exists (has project_agent_id, agent_work_request_id)
- ✅ `baskets` - exists
- ✅ `blocks` - exists (has embedding vector(1536))
- ✅ `agent_catalog` - exists with billing schema

### Current agent_catalog Schema
```
- id (uuid)
- agent_type (text, unique, lowercase constraint)
- name (text)
- description (text)
- monthly_price_cents (integer, positive check)
- trial_work_requests (integer, >= 0)
- is_active (boolean, default true)
- created_at, updated_at (timestamptz)
```

**Seeded Agents:**
- `research` - Research Agent ($19.00/mo)
- `content` - Content Creator Agent ($29.00/mo)
- `reporting` - Reporting Agent ($39.00/mo)

### Current project_agents Schema
```
- id (uuid)
- project_id (uuid, FK to projects)
- agent_type (text, FK to agent_catalog)
- display_name (text)
- is_active (boolean, default true)
- created_at (timestamptz)
- created_by_user_id (uuid)
- UNIQUE constraint: (project_id, agent_type)
```

**Missing for Phase 1:**
- ❌ `config` jsonb column
- ❌ `config_version` integer column
- ❌ `config_updated_at` timestamptz column
- ❌ `config_updated_by` uuid column

### Current work_sessions Schema
```
- id, project_id, basket_id, workspace_id (uuids)
- initiated_by_user_id (uuid)
- task_type (text)
- task_intent (text)
- task_parameters (jsonb)
- status (text)
- executed_by_agent_id (text) ← LEGACY, needs removal
- project_agent_id (uuid, FK to project_agents)
- agent_work_request_id (uuid, FK to agent_work_requests)
- task_configuration (jsonb)
- task_document_id (uuid)
- approval_strategy (text)
- created_at, started_at, ended_at (timestamptz)
- metadata (jsonb)
```

**Issue Found:**
- ⚠️ `executed_by_agent_id` (text) still exists - should be removed in Migration 1

### Current blocks Schema
```
- id, basket_id, parent_block_id (uuid)
- semantic_type (text)
- content, title, body_md (text)
- version (integer)
- state (block_state enum)
- scope (scope_level enum)
- canonical_value (text)
- origin_ref (uuid)
- workspace_id (uuid)
- embedding (vector(1536))
- ... many other columns
```

**Missing for Phase 1:**
- ❌ `derived_from_asset_id` uuid column

### Storage Bucket Status
- ❌ `yarnnn-assets` bucket does NOT exist yet

---

## 🚨 Critical Findings & Decisions

### Finding 1: Shared Database (NOT Separate DBs)
**Impact:** All tables (work-platform + substrate) are in the SAME database.

**Implications:**
1. ✅ Can use FK constraints for reference_assets → baskets
2. ✅ Can use FK constraints for blocks.derived_from_asset_id → reference_assets
3. ⚠️ Cross-service FK from reference_assets.work_session_id is actually SAME-DB FK
4. ✅ Simplifies Migration 2 (no cross-DB concerns)
5. ⚠️ Need to be careful with RLS policies (different service roles)

**Decision:** Proceed as planned, but adjust comments in migration scripts to reflect shared DB reality.

### Finding 2: agent_catalog Has Billing Schema (NOT Dynamic Config Schema)
**Impact:** Current agent_catalog is for billing/trial management, NOT agent configurations.

**Comparison:**

| Current Schema | Phase 1 Design |
|----------------|----------------|
| `id` (uuid PK) | `agent_type` (text PK) |
| `agent_type` (text unique) | `display_name` |
| `name` | `description` |
| `description` | `icon` |
| `monthly_price_cents` | `config_schema` (jsonb) |
| `trial_work_requests` | `is_active`, `is_beta` |
| `is_active` | `deprecated_at` |
| `created_at`, `updated_at` | `schema_version` |

**Options:**

**Option A: Evolve Existing agent_catalog (RECOMMENDED)**
- Add new columns for config schema (config_schema, icon, is_beta, deprecated_at, schema_version, notes)
- Keep billing columns (monthly_price_cents, trial_work_requests)
- Change PK from `id` to `agent_type` (requires FK updates)
- Pros: Single source of truth, no duplicate data
- Cons: Breaking change to PK structure

**Option B: Create Separate agent_config_catalog**
- Create new table for config schemas
- Keep agent_catalog for billing
- agent_type links both tables
- Pros: Non-breaking
- Cons: Two sources of truth

**Decision Required:** Which approach to take?

### Finding 3: executed_by_agent_id Deprecation
**Status:** Column exists but is redundant with project_agent_id.

**Migration Plan:**
1. Verify all work_sessions have project_agent_id populated
2. Drop executed_by_agent_id column
3. No data migration needed (already using project_agent_id)

---

## 📋 Migration Plan

### Pre-Migration Checks

```bash
# 1. Database backup
export PG_DUMP_URL="postgresql://postgres.galytxxkrbksilekmhcw:4ogIUdwWzVyPH0nU@aws-0-ap-northeast-2.pooler.supabase.com:6543/postgres?sslmode=require"

pg_dump "$PG_DUMP_URL" \
  --schema=public \
  --file="backups/pre_phase1_backup_$(date +%Y%m%d_%H%M%S).sql"

# 2. Verify work_sessions integrity
psql "$PG_DUMP_URL" -c "
SELECT
  COUNT(*) as total_sessions,
  COUNT(project_agent_id) as with_project_agent,
  COUNT(executed_by_agent_id) as with_legacy_agent,
  COUNT(*) - COUNT(project_agent_id) as missing_project_agent
FROM work_sessions;"

# 3. Check FK constraint usage
psql "$PG_DUMP_URL" -c "
SELECT COUNT(*) FROM project_agents WHERE agent_type NOT IN (
  SELECT agent_type FROM agent_catalog
);"
```

### Migration 1: Work-Platform Tables

**File:** `supabase/migrations/20251113_phase1_agent_configs.sql`

**Changes:**
1. Update `agent_catalog` table:
   - Add config_schema, icon, is_beta, deprecated_at, schema_version, notes columns
   - Keep existing billing columns
   - Add created_by_user_id for audit
   - Consider PK migration strategy

2. Update `project_agents` table:
   - Add config (jsonb) column
   - Add config_version (integer) column
   - Add config_updated_at (timestamptz) column
   - Add config_updated_by (uuid) column
   - Add index on (project_id, is_active)

3. Update `work_sessions` table:
   - Drop executed_by_agent_id column

4. Create `agent_config_history` audit table:
   - Track config changes over time
   - Support rollback/debugging

**Estimated Time:** 5 minutes (no data migration)

**Rollback:** Automated rollback script included

### Migration 2: Substrate Tables

**File:** `supabase/migrations/20251113_phase1_reference_assets.sql`

**Changes:**
1. Create `asset_type_catalog` table:
   - Dynamic asset type management
   - No hardcoded enums
   - Seed initial types

2. Create `reference_assets` table:
   - File metadata storage
   - Links to Supabase Storage
   - Basket-scoped RLS
   - Embedding for semantic search
   - Lifecycle management (permanent/temporary)

3. Update `blocks` table:
   - Add derived_from_asset_id (uuid) column
   - Add index for provenance queries
   - FK to reference_assets.id

4. Create indexes and RLS policies

**Estimated Time:** 3 minutes (no data migration)

**Rollback:** Automated rollback script included

### Migration 3: Supabase Storage Setup

**Method:** Supabase Dashboard OR SQL

**Changes:**
1. Create `yarnnn-assets` bucket:
   - Private bucket (public: false)
   - Region: ap-northeast-2
   - File size limit: 50MB per file

2. Setup RLS policies:
   - Users can upload to their workspace folders
   - Users can read from their workspace folders
   - Service role has full access

**Estimated Time:** 2 minutes (manual setup)

**Verification:**
```bash
# Check bucket created
psql "$PG_DUMP_URL" -c "SELECT id, name, public FROM storage.buckets WHERE name = 'yarnnn-assets';"

# Check RLS policies
psql "$PG_DUMP_URL" -c "SELECT policyname FROM pg_policies WHERE tablename = 'objects' AND schemaname = 'storage' AND policyname LIKE '%yarnnn-assets%';"
```

---

## ⚠️ Potential Issues & Mitigations

### Issue 1: agent_catalog PK Migration
**Risk:** Changing PK from `id` to `agent_type` requires FK updates.

**Mitigation:**
- Use ON UPDATE CASCADE on FK constraints
- Test on staging first
- Consider Option B (separate config catalog) if too risky

### Issue 2: Cross-Service RLS Policies
**Risk:** work-platform API and substrate-API use different service roles.

**Mitigation:**
- Test service role access after migration
- Verify both services can access reference_assets
- Add service_role policy if needed

### Issue 3: Storage Bucket Permissions
**Risk:** RLS policies too restrictive or too permissive.

**Mitigation:**
- Start with strict policies (workspace-scoped)
- Test upload/download flows
- Add service role escape hatch

### Issue 4: Vector Embedding Null Values
**Risk:** reference_assets.description_embedding nullable during Phase 1.

**Mitigation:**
- Accept null embeddings initially
- Background job can populate later (Phase 2)
- Query logic handles null gracefully

### Issue 5: Temporary Asset Cleanup
**Risk:** Expired temporary assets not cleaned up automatically.

**Mitigation:**
- Create manual cleanup script for Phase 1
- Schedule as cron job (Phase 2)
- Add expires_at index for performance

---

## 🎯 Success Criteria

### Database Schema
- ✅ All tables created without errors
- ✅ All FK constraints validated
- ✅ All indexes created
- ✅ All RLS policies active

### Data Integrity
- ✅ No orphaned records
- ✅ All existing project_agents still valid
- ✅ All work_sessions still queryable
- ✅ All blocks.basket_id still valid

### Service Integration
- ✅ work-platform can query reference_assets
- ✅ substrate-api can create/update reference_assets
- ✅ File uploads reach Supabase Storage
- ✅ File downloads work with proper auth

### Performance
- ✅ No slow queries introduced
- ✅ Indexes used effectively
- ✅ Vector search still fast

---

## 📝 Post-Migration Verification

```bash
export PG_DUMP_URL="postgresql://postgres.galytxxkrbksilekmhcw:4ogIUdwWzVyPH0nU@aws-0-ap-northeast-2.pooler.supabase.com:6543/postgres?sslmode=require"

# 1. Verify all tables exist
psql "$PG_DUMP_URL" -c "
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public'
AND table_name IN (
  'agent_catalog',
  'project_agents',
  'work_sessions',
  'asset_type_catalog',
  'reference_assets',
  'blocks',
  'agent_config_history'
) ORDER BY table_name;"

# 2. Verify agent_catalog columns
psql "$PG_DUMP_URL" -c "\d agent_catalog"

# 3. Verify project_agents.config column
psql "$PG_DUMP_URL" -c "\d project_agents"

# 4. Verify work_sessions no longer has executed_by_agent_id
psql "$PG_DUMP_URL" -c "\d work_sessions" | grep executed_by_agent_id

# 5. Verify reference_assets table
psql "$PG_DUMP_URL" -c "\d reference_assets"

# 6. Verify blocks.derived_from_asset_id
psql "$PG_DUMP_URL" -c "\d blocks" | grep derived_from_asset_id

# 7. Check storage bucket
psql "$PG_DUMP_URL" -c "SELECT id, name, public FROM storage.buckets WHERE name = 'yarnnn-assets';"

# 8. Verify RLS policies count
psql "$PG_DUMP_URL" -c "
SELECT
  tablename,
  COUNT(*) as policy_count
FROM pg_policies
WHERE schemaname = 'public'
AND tablename IN ('agent_catalog', 'project_agents', 'reference_assets', 'asset_type_catalog')
GROUP BY tablename;"

# 9. Test sample insert (rollback after)
psql "$PG_DUMP_URL" -c "
BEGIN;
-- Test asset_type_catalog insert
INSERT INTO asset_type_catalog (asset_type, display_name, category, allowed_mime_types)
VALUES ('test_type', 'Test Type', 'test', ARRAY['image/*'])
RETURNING asset_type;
ROLLBACK;"

# 10. Performance check - verify index usage
psql "$PG_DUMP_URL" -c "
SELECT
  schemaname,
  tablename,
  indexname
FROM pg_indexes
WHERE schemaname = 'public'
AND tablename IN ('reference_assets', 'project_agents', 'blocks')
ORDER BY tablename, indexname;"
```

---

## 🚀 Deployment Order

1. **Database Backup** (5 min)
   - Export full schema + data
   - Verify backup integrity

2. **Run Migration 1** (5 min)
   - Execute work-platform table changes
   - Verify with post-migration checks

3. **Run Migration 2** (3 min)
   - Execute substrate table changes
   - Verify with post-migration checks

4. **Setup Supabase Storage** (2 min)
   - Create bucket via dashboard
   - Configure RLS policies

5. **Smoke Test** (5 min)
   - Test file upload
   - Test asset creation
   - Test config update

**Total Time:** ~20 minutes

---

## 📞 Decision Points Required

### Decision 1: agent_catalog PK Strategy
**Options:**
- **A:** Evolve existing table (change PK to agent_type)
- **B:** Create separate agent_config_catalog

**Recommendation:** Choose based on risk tolerance. Option B is safer for production.

**User Input Needed:** Which approach?

### Decision 2: Migration Execution Method
**Options:**
- **A:** Direct psql via dump_schema.sh connection
- **B:** Supabase Dashboard SQL Editor
- **C:** Automated migration script

**Recommendation:** Option A (direct psql) for consistency.

**User Input Needed:** Confirm execution method?

### Decision 3: Rollback Strategy
**Options:**
- **A:** Full database restore from backup
- **B:** Individual column/table drops
- **C:** Forward-only migration (no rollback)

**Recommendation:** Option B (surgical rollback) with Option A as last resort.

**User Input Needed:** Confirm rollback strategy?

---

## 📚 Files to Create

1. `supabase/migrations/20251113_phase1_agent_configs.sql` - Migration 1
2. `supabase/migrations/20251113_phase1_reference_assets.sql` - Migration 2
3. `supabase/migrations/20251113_phase1_rollback.sql` - Rollback script
4. `scripts/phase1_verify.sh` - Post-migration verification script
5. `scripts/phase1_cleanup_temp_assets.sh` - Temporary asset cleanup (cron job)

---

## ✅ Ready to Proceed Checklist

- [x] Database connection verified
- [x] Current schema documented
- [x] Critical issues identified
- [x] Migration plan created
- [x] Rollback strategy defined
- [x] Verification queries prepared
- [ ] **Decision 1 resolved** (agent_catalog PK strategy)
- [ ] **Decision 2 resolved** (migration execution method)
- [ ] **Decision 3 resolved** (rollback strategy)
- [ ] Backup taken
- [ ] Migrations ready to execute

---

**Status:** ⚠️ Awaiting user decisions on 3 decision points before proceeding with migration execution.
