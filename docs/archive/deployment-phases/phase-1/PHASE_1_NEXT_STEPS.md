# Phase 1 Next Steps - Application Layer Implementation

**Date:** 2025-11-13
**Status:** Database migrations ✅ Complete | Application layer ⏳ Pending
**Reference:** [AGENT_SUBSTRATE_ARCHITECTURE.md](AGENT_SUBSTRATE_ARCHITECTURE.md) (Phase 1, lines 1056-1126)

---

## Current State ✅

### Completed
- [x] **Migration 1:** agent_catalog evolved, project_agents enhanced, work_sessions cleaned
- [x] **Migration 2:** asset_type_catalog created, reference_assets created, blocks.derived_from_asset_id added
- [x] **Migration 3:** Supabase Storage bucket created, RLS policies configured
- [x] **Verification:** All 11 checks passed
- [x] **Git:** Committed and pushed to main

### Database State
- ✅ 7 tables created/updated
- ✅ 7 asset types seeded
- ✅ 17 indexes for performance
- ✅ 22 RLS policies (17 DB + 5 Storage)
- ✅ Storage bucket `yarnnn-assets` ready (50MB, private)

---

## Remaining Phase 1 Deliverables

Per AGENT_SUBSTRATE_ARCHITECTURE.md, the following application-layer work remains:

### Critical Path 🔥

#### 1. substrate-API: Reference Assets Endpoints
**Priority:** P0 (blocking all other work)
**Estimated Time:** 4-6 hours

**Required Endpoints:**
```python
POST   /substrate/baskets/{basketId}/assets           # Upload reference asset
GET    /substrate/baskets/{basketId}/assets           # List assets (with filters)
GET    /substrate/baskets/{basketId}/assets/{assetId} # Get asset metadata
DELETE /substrate/baskets/{basketId}/assets/{assetId} # Delete asset
POST   /substrate/baskets/{basketId}/assets/{assetId}/signed-url # Get signed download URL
```

**Implementation Notes:**
- **Location:** Create `substrate-api/api/src/app/reference_assets/routes.py`
- **Dependencies:**
  - Supabase Storage client (for file uploads/downloads)
  - Service role key from environment
  - Workspace auth dependency (already exists)
- **Key Features:**
  - Multipart/form-data handling for file uploads
  - Generate description embeddings (optional in Phase 1)
  - Signed URL generation for secure downloads
  - RLS enforcement via workspace_id dependency

**Files to Create:**
- `substrate-api/api/src/app/reference_assets/__init__.py`
- `substrate-api/api/src/app/reference_assets/routes.py`
- `substrate-api/api/src/app/reference_assets/schemas.py`
- `substrate-api/api/src/app/reference_assets/services/storage_service.py`

**Files to Modify:**
- `substrate-api/api/src/app/__init__.py` (register router)
- Or equivalent main app file that registers routes

**Success Criteria:**
- [ ] Can upload file via POST /substrate/baskets/{basketId}/assets
- [ ] File appears in Supabase Storage bucket
- [ ] Metadata row created in reference_assets table
- [ ] Can list assets via GET with filters
- [ ] Can download file via signed URL
- [ ] Can delete asset (removes both DB row and storage file)

---

### Parallel Work Track 1: work-platform BFF Routes

#### 2. work-platform: Asset Proxy Routes
**Priority:** P1 (enables UI development)
**Estimated Time:** 2-3 hours

**Required Routes:**
```typescript
POST   /api/baskets/{basketId}/assets           // Proxy to substrate-API
GET    /api/baskets/{basketId}/assets           // Proxy to substrate-API
GET    /api/baskets/{basketId}/assets/{assetId} // Proxy to substrate-API
DELETE /api/baskets/{basketId}/assets/{assetId} // Proxy to substrate-API
```

**Implementation Notes:**
- **Location:** `work-platform/web/app/api/baskets/[basketId]/assets/route.ts`
- **Pattern:** Similar to existing work-sessions proxy
- **Auth:** Get Supabase session, forward token to substrate-API
- **File Upload:** Handle multipart/form-data passthrough

**Files to Create:**
- `work-platform/web/app/api/baskets/[basketId]/assets/route.ts`
- `work-platform/web/app/api/baskets/[basketId]/assets/[assetId]/route.ts`

**Success Criteria:**
- [ ] All asset operations proxy correctly to substrate-API
- [ ] Auth tokens passed correctly
- [ ] File uploads work via Next.js API route
- [ ] Errors returned with appropriate status codes

---

#### 3. work-platform: Agent Config Routes
**Priority:** P1 (enables config UI)
**Estimated Time:** 2-3 hours

**Required Routes:**
```typescript
GET    /api/projects/{projectId}/agents/{agentId}/config // Get agent config
PUT    /api/projects/{projectId}/agents/{agentId}/config // Update agent config
```

**Implementation Notes:**
- **Location:** `work-platform/web/app/api/projects/[projectId]/agents/[agentId]/config/route.ts`
- **Database:** Queries work-platform DB directly (project_agents table)
- **Validation:** Validate config against agent_catalog.config_schema (JSON Schema)
- **Audit:** Auto-creates agent_config_history entry (via trigger)

**Files to Create:**
- `work-platform/web/app/api/projects/[projectId]/agents/[agentId]/config/route.ts`

**Success Criteria:**
- [ ] Can GET current config for an agent
- [ ] Can PUT updated config
- [ ] Config validated against schema
- [ ] Config history entry auto-created
- [ ] config_version incremented on update

---

### Parallel Work Track 2: UI Components

#### 4. Context Page: Assets Tab
**Priority:** P2 (user-facing feature)
**Estimated Time:** 6-8 hours

**Component Location:** `work-platform/web/app/(authenticated)/context/[basketId]/page.tsx`

**Features:**
- **Upload Interface:**
  - Drag-and-drop file upload
  - Asset type selector (7 types from catalog)
  - Agent scope selector (multi-select: research, content, reporting)
  - Description input (optional)
  - Tags input (optional)
  - Permanence toggle (permanent/temporary)

- **Assets Grid/List:**
  - Thumbnail preview for images
  - File name, type, size, created date
  - Filter by asset type, category, agent scope
  - Search by filename/description
  - Delete action with confirmation

**UI Libraries:**
- Use existing shadcn/ui components
- react-dropzone for file uploads
- lucide-react icons

**Success Criteria:**
- [ ] User can upload brand voice screenshot
- [ ] User can assign asset to specific agents
- [ ] User can view all assets in basket
- [ ] User can filter/search assets
- [ ] User can delete assets

---

#### 5. Agent Dashboard: Config Forms
**Priority:** P2 (user-facing feature)
**Estimated Time:** 8-12 hours (all 3 agents)

**Component Location:** `work-platform/web/app/(authenticated)/projects/[projectId]/agents/[agentType]/page.tsx`

**Per Agent Type:**

**Research Agent Config:**
```typescript
{
  watchlist: {
    competitors: string[],      // Array of company names
    topics: string[],            // Array of topic keywords
    data_sources: object[]       // External sources config
  },
  alert_rules: object,           // Notification thresholds
  output_preferences: object     // Report formatting
}
```

**Content Agent Config:**
```typescript
{
  brand_voice: object,           // Voice parameters
  platforms: object,             // Platform-specific settings
  content_rules: object          // Guidelines and constraints
}
```

**Reporting Agent Config:**
```typescript
{
  report_preferences: object,    // Format, frequency, etc.
  data_sources: object,          // Which data to include
  formatting: object             // Style preferences
}
```

**UI Pattern:**
- Form sections per config key
- JSON Schema-driven validation (client-side)
- Save/Cancel buttons
- Version indicator
- "Last updated" timestamp

**Success Criteria:**
- [ ] User can configure Research agent watchlist
- [ ] User can configure Content agent brand voice
- [ ] User can configure Reporting agent preferences
- [ ] Config persists across sessions
- [ ] Config version increments on save

---

### Future Work (Not Phase 1)

#### 6. Agent Execution Enhancement
**Priority:** P3 (Phase 2 dependency)
**Estimated Time:** 2-3 hours

Update agent execution to include reference_assets and agent_config in payload.

**Files to Modify:**
- `work-platform/api/src/services/work_session_executor.py`
- `work-platform/api/src/adapters/memory_adapter.py`

**Changes:**
```python
# Current (Phase 0):
agent.execute(context_blocks=[...])

# Phase 1 target:
agent.execute(
    context_blocks=[...],
    reference_assets=[...],  # NEW
    agent_config={...}       # NEW
)
```

**Note:** This can be deferred until UI components are ready and we want to test end-to-end.

---

## Implementation Order (Recommended)

### Week 1: Backend Foundation
1. **Day 1-2:** substrate-API reference assets endpoints (P0)
   - Create routes, schemas, storage service
   - Test with Postman/curl
   - Verify file upload/download works

2. **Day 2-3:** work-platform BFF proxy routes (P1)
   - Asset proxy routes
   - Agent config routes
   - Integration tests

### Week 2: Frontend Implementation
3. **Day 4-5:** Context page Assets tab (P2)
   - Upload interface
   - Asset grid
   - Filter/search

4. **Day 6-8:** Agent dashboard config forms (P2)
   - Research agent config
   - Content agent config
   - Reporting agent config

### Week 3: Integration & Testing
5. **Day 9:** Agent execution enhancement (P3)
   - Update executor to pass assets
   - Update adapters

6. **Day 10:** End-to-end testing
   - Upload asset → verify in agent payload
   - Configure agent → verify persisted
   - Create work session → verify config used

---

## Architecture Reference Checklist

Cross-checking against [AGENT_SUBSTRATE_ARCHITECTURE.md](AGENT_SUBSTRATE_ARCHITECTURE.md):

### Phase 1 Success Criteria (from doc)
- [x] Migrations run successfully ✅
- [x] Supabase Storage bucket created with correct RLS policies ✅
- [ ] substrate-API file upload endpoints deployed ⏳
- [ ] User can upload brand voice screenshot via UI ⏳
- [ ] Content Agent receives screenshot in execution payload ⏳
- [ ] User can configure Research agent watchlist ⏳
- [ ] Agent config persists across work sessions ⏳
- [x] No redundant columns remain (executed_by_agent_id removed) ✅

### Phase 1 Validation Checklist (from doc)
- [x] reference_assets table exists ✅
- [x] asset_type_catalog table exists with initial seed data ✅
- [x] blocks.derived_from_asset_id column exists ✅
- [x] project_agents.config column exists ✅
- [x] agent_catalog with dynamic schema support ✅
- [x] agent_catalog seeded with 3 agent types ✅
- [x] work_sessions.executed_by_agent_id column removed ✅
- [x] RLS policies enforce workspace-scoping ✅
- [x] Cross-DB work_session_id reference handled in app code ✅
- [x] No hardcoded CHECK constraints (FK to catalogs) ✅

**Database Layer:** 10/10 complete ✅
**Application Layer:** 0/7 complete ⏳

---

## Technical Considerations

### 1. Supabase Storage Integration
**Required Environment Variables:**
```bash
SUPABASE_URL=https://galytxxkrbksilekmhcw.supabase.co
SUPABASE_ANON_KEY={public_anon_key}
SUPABASE_SERVICE_ROLE_KEY={service_role_key}  # For substrate-API
```

**Storage Client Setup (Python):**
```python
from supabase import create_client, Client

supabase: Client = create_client(
    supabase_url=os.getenv("SUPABASE_URL"),
    supabase_key=os.getenv("SUPABASE_SERVICE_ROLE_KEY")  # Service role for admin access
)

# Upload file
with open(file_path, 'rb') as f:
    supabase.storage.from_('yarnnn-assets').upload(
        path=f'baskets/{basket_id}/assets/{asset_id}/{filename}',
        file=f,
        file_options={"content-type": mime_type}
    )

# Get signed URL
signed_url = supabase.storage.from_('yarnnn-assets').create_signed_url(
    path=storage_path,
    expires_in=3600  # 1 hour
)
```

### 2. File Upload Size Limits
- **Storage bucket limit:** 50MB per file
- **Next.js API route:** Default 4MB (need to increase in `next.config.js`)
- **FastAPI:** Default unlimited (but should add reasonable limit)

**Next.js Config:**
```typescript
// next.config.js
module.exports = {
  api: {
    bodyParser: {
      sizeLimit: '50mb',
    },
  },
}
```

### 3. Embedding Generation (Optional Phase 1)
Can defer embedding generation for asset descriptions.

**If implementing:**
```python
# Use existing OpenAI embedding service
from src.services.embedding_service import generate_embedding

description_embedding = await generate_embedding(description)
```

**If deferring:**
Set `description_embedding = None` in Phase 1, add background job in Phase 2.

---

## API Contract Examples

### Upload Asset
```bash
curl -X POST "http://localhost:8000/substrate/baskets/{basketId}/assets" \
  -H "Authorization: Bearer {token}" \
  -F "file=@brand-voice.png" \
  -F "asset_type=brand_voice_sample" \
  -F "description=Example of our brand voice" \
  -F "agent_scope=content,research" \
  -F "tags=brand,voice,example"
```

**Response:**
```json
{
  "id": "uuid",
  "basket_id": "uuid",
  "storage_path": "baskets/{basketId}/assets/{assetId}/brand-voice.png",
  "file_name": "brand-voice.png",
  "file_size_bytes": 245678,
  "mime_type": "image/png",
  "asset_type": "brand_voice_sample",
  "asset_category": "brand_identity",
  "agent_scope": ["content", "research"],
  "tags": ["brand", "voice", "example"],
  "created_at": "2025-11-13T10:30:00Z"
}
```

### Get Signed URL
```bash
curl -X POST "http://localhost:8000/substrate/baskets/{basketId}/assets/{assetId}/signed-url" \
  -H "Authorization: Bearer {token}"
```

**Response:**
```json
{
  "signed_url": "https://galytxxkrbksilekmhcw.supabase.co/storage/v1/object/sign/yarnnn-assets/baskets/{basketId}/assets/{assetId}/brand-voice.png?token={token}",
  "expires_at": "2025-11-13T11:30:00Z"
}
```

---

## Questions to Resolve

1. **Embedding generation:** Implement in Phase 1 or defer to Phase 2 background job?
   - **Recommendation:** Defer - not blocking any UX, can add later

2. **File preview/thumbnails:** Generate thumbnails for images?
   - **Recommendation:** Phase 2 - use storage URLs directly in Phase 1

3. **Asset versioning:** Should updating asset create new version or replace?
   - **Recommendation:** Phase 1 = replace (simpler), Phase 2 = versioning

4. **Temporary asset cleanup:** Implement cron job now or defer?
   - **Recommendation:** Defer to Phase 2 - manual cleanup acceptable initially

---

## Next Immediate Action

**Start with substrate-API reference assets endpoints** - this is the critical path blocking all other work.

**Recommended approach:**
1. Create `substrate-api/api/src/app/reference_assets/` module
2. Implement basic POST/GET/DELETE routes
3. Test with curl/Postman before building UI
4. Once working, proceed with BFF proxy routes

**Estimated timeline:**
- Substrate-API endpoints: 4-6 hours
- BFF proxy routes: 2-3 hours
- **Total backend:** 6-9 hours (1-2 days)

Then UI work can begin in parallel with backend testing.

---

**Status:** Ready to begin application layer implementation
**Blocker:** None - all database dependencies complete
**Risk:** Low - well-defined schema, clear API contracts
