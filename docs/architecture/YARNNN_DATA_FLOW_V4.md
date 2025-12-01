# YARNNN Data Flow v4.3

**Complete Work Flow with Separated Governance**

**Version**: 4.3
**Date**: 2025-12-01
**Status**: ✅ Canonical
**Supersedes**: v4.2 (streamlined project creation with two anchor blocks)

---

## 🎯 Overview

This document traces complete data flows through YARNNN's two-layer architecture with **separated governance**:

- **Work Supervision** (work-platform): Reviews work output quality
- **Substrate Governance** (substrate-API): P1 proposals with semantic dedup
- **Direct Block CRUD** (user-authored): Trusted content bypasses governance

**Key Insight**: YARNNN's value emerges from tight integration between work orchestration (Layer 2) and substrate core (Layer 1), but with INDEPENDENT governance systems. User-authored content is trusted and managed directly.

---

## 📋 Complete Work Session Flow

### Phase 1: Project Creation (with Two Anchor Blocks)

Every new project is created with TWO foundational anchor blocks that establish the "what and why":

```
User Action: Create new project
  Form collects: Topic (what) + Intent (why)
  ↓
POST /api/projects/new (work-platform BFF)
  body: {project_topic, project_intent}
  ↓
work-platform → substrate-API: POST /api/baskets
  ↓
Basket created (substrate-API DB)
  ↓
work-platform: INSERT INTO blocks (Topic anchor block)
  anchor_role: 'topic', semantic_type: 'context'
  state: ACCEPTED, confidence: 1.0
  ↓
work-platform: INSERT INTO blocks (Vision anchor block)
  anchor_role: 'vision', semantic_type: 'intent'
  state: ACCEPTED, confidence: 1.0
  ↓
work-platform DB: INSERT INTO projects
  ↓
Response: {project_id, basket_id, topic_block_id, vision_block_id}
```

**Key Points**:
- **No raw_dump** created from topic/intent (direct blocks, no P1 extraction)
- **Two guaranteed anchors**: Topic (what) + Vision (why)
- Seed file upload (optional) → creates raw_dump → P1 extraction for additional blocks

**Tables Modified**:
- `baskets` (substrate-API)
- `blocks` (substrate-API - two anchor blocks)
- `projects` (work-platform)

---

### Phase 1b: Direct Block Management (User-Authored)

Users can directly create, edit, and delete blocks on the Context page. User-authored content is **trusted** and bypasses governance.

```
User Action: Create block on Context page
  ↓
POST /api/projects/{id}/context/blocks (work-platform BFF)
  ↓
work-platform → substrate-API: POST /api/baskets/{basket_id}/blocks
  body: {title, content, semantic_type, workspace_id}
  ↓
substrate-API: INSERT INTO blocks
  (state: ACCEPTED, confidence: 1.0, author_type: user)
  ↓
substrate-API: queue_embedding_generation(block_id)
  ↓
substrate-API: emit_timeline_event(block_created)
  ↓
Response: {block with id, state, timestamps}
```

```
User Action: Edit existing block
  ↓
PUT /api/projects/{id}/context/{blockId} (work-platform BFF)
  ↓
work-platform → substrate-API: PUT /api/baskets/{basket_id}/blocks/{block_id}
  ↓
substrate-API: Validate state != LOCKED
  ↓
substrate-API: UPDATE blocks SET title/content/semantic_type, updated_at
  ↓
substrate-API: Clear embedding (regenerate async)
  ↓
substrate-API: emit_timeline_event(block_updated)
  ↓
Response: {updated block}
```

```
User Action: Delete block
  ↓
DELETE /api/projects/{id}/context/{blockId} (work-platform BFF)
  ↓
work-platform → substrate-API: DELETE /api/baskets/{basket_id}/blocks/{block_id}
  ↓
substrate-API: Validate state != LOCKED
  ↓
substrate-API: UPDATE blocks SET state='SUPERSEDED'
  ↓
substrate-API: emit_timeline_event(block_deleted)
  ↓
Response: {deletion confirmation}
```

**Tables Modified**:
- `blocks` (substrate-API - direct CRUD)
- `timeline_events` (substrate-API - audit trail)

**Key Points**:
- User-authored blocks created in **ACCEPTED** state (trusted)
- Confidence set to **1.0** (user-provided = trusted)
- LOCKED blocks cannot be modified or deleted
- Soft-delete via SUPERSEDED state (not hard delete)
- Embeddings regenerated asynchronously after mutations

---

### Phase 2: Work Request Creation

```
User Action: Create work request
  ↓
POST /api/work/requests (work-platform)
  ↓
work-platform DB: INSERT INTO work_requests
  ↓
work-platform DB: INSERT INTO work_tickets (status: pending)
  ↓
Response: {work_request_id, work_ticket_id}
```

**Tables Modified**:
- `work_requests` (work-platform)
- `work_tickets` (work-platform)

---

### Phase 3: Agent Execution

```
Agent Starts (Claude SDK session)
  ↓
work-platform DB: UPDATE work_tickets SET status='in_progress'
  ↓
Agent Tool Call: query_context(query_text)
  ↓
work-platform → substrate-API: POST /substrate/semantic/search
  ↓
substrate-API: SELECT * FROM blocks + embeddings (semantic search)
  ↓
Response: [block1, block2, block3] (relevant context)
  ↓
Agent reasons with Claude + context
  ↓
Agent Tool Call: emit_work_output(output_type, content)
  ↓
work-platform → substrate-API: POST /work/outputs/new
  ↓
substrate-API DB: INSERT INTO work_outputs (status: pending_review)
  ↓
Agent continues until task complete
  ↓
work-platform DB: UPDATE work_tickets SET status='pending_review'
```

**Tables Modified**:
- `work_tickets` (work-platform - status updates)
- `work_outputs` (substrate-API - basket-scoped RLS)
- Timeline queries to `blocks`, `embeddings` (substrate-API - read-only)

**Key Point**: work_outputs stored in substrate-API for basket-scoped RLS, but referenced by work-platform

---

### Phase 4: Work Supervision (Layer 2)

```
User Action: Review work outputs
  ↓
GET /api/work/tickets/{ticket_id}/outputs (work-platform)
  ↓
work-platform → substrate-API: GET /work/outputs?work_ticket_id={id}
  ↓
Response: [output1 (pending_review), output2 (pending_review)]
  ↓
User Decision: Approve output1, Reject output2
  ↓
POST /api/work/outputs/{output1_id}/review (work-platform)
  body: {status: "approved", feedback: "Good work"}
  ↓
work-platform → substrate-API: PATCH /work/outputs/{output1_id}
  ↓
substrate-API DB: UPDATE work_outputs
  SET status='approved', reviewed_at=NOW()
  WHERE id=output1_id
  ↓
POST /api/work/outputs/{output2_id}/review (work-platform)
  body: {status: "rejected", feedback: "Needs more evidence"}
  ↓
work-platform → substrate-API: PATCH /work/outputs/{output2_id}
  ↓
substrate-API DB: UPDATE work_outputs SET status='rejected'
  ↓
work-platform DB: UPDATE work_tickets SET status='completed'
```

**Tables Modified**:
- `work_outputs` (substrate-API - status, review fields)
- `work_tickets` (work-platform - status transition)

**Key Point**: Work supervision ends here. NO automatic substrate mutation.

---

### Phase 5: Substrate Governance (Layer 1) - [FUTURE]

**Current State**: No automatic bridge. Approved work_outputs do NOT auto-create blocks.

**Future Bridge Flow** (Deferred):
```
work_output.status = 'approved'
  ↓
[Manual or Automated Trigger]
  ↓
substrate-API: INSERT INTO proposals
  (content=work_output.body, source=work_output_id)
  ↓
P1 Pipeline: Semantic Deduplication Check
  ↓
P1 Pipeline: Quality Validation
  ↓
P1 Pipeline: Merge Detection
  ↓
(If needed) User approves proposal
  ↓
substrate-API DB: INSERT INTO blocks (state: ACCEPTED)
  ↓
substrate-API DB: UPDATE proposals SET status='approved'
  ↓
Timeline event: block_created
  ↓
Notify work-platform of result (optional)
```

**Decision**: Deferred until usage patterns understood. Maintains substrate integrity.

---

## 🔄 Alternative Flow: Direct Substrate Proposal (No Work Platform)

Users can still create substrate proposals directly without work-platform:

```
User Action: Create proposal (via substrate frontend or API)
  ↓
POST /api/proposals (substrate-API)
  ↓
substrate-API DB: INSERT INTO proposals
  ↓
P1 Pipeline (same as above)
  ↓
Block created
```

**Key Point**: Substrate governance works independently of work-platform.

---

## 📊 Data Flow Diagram

```
┌──────────────────────────────────────────────────────────┐
│ User creates project (Topic + Intent)                    │
└────────────┬─────────────────────────────────────────────┘
             ↓
┌──────────────────────────────────────────────────────────┐
│ TWO ANCHOR BLOCKS created automatically:                 │
│ → Topic block (anchor_role: 'topic') - WHAT              │
│ → Vision block (anchor_role: 'vision') - WHY             │
└────────────┬─────────────────────────────────────────────┘
             ↓
┌──────────────────────────────────────────────────────────┐
│ work-platform: projects, work_requests, work_tickets     │
└────────────┬─────────────────────────────────────────────┘
             ↓
┌──────────────────────────────────────────────────────────┐
│ substrate-API: baskets, blocks (with anchors)            │
└────────────┬───────────────────────┬────────────────────┘
             ↓                       ↓
┌────────────────────────┐  ┌───────────────────────────────┐
│ Agent executes         │  │ DIRECT BLOCK CRUD (User)      │
│ (queries context)      │  │ → Create/Edit/Delete blocks   │
└────────────┬───────────┘  │ → ACCEPTED state, conf=1.0    │
             ↓              │ → Bypasses governance          │
┌────────────────────────┐  └───────────────────────────────┘
│ Agent emits work_outputs│
│ (stored in substrate)   │
└────────────┬────────────┘
             ↓
┌──────────────────────────────────────────────────────────┐
│ WORK SUPERVISION: User reviews outputs (work-platform)   │
│ → approved/rejected (no substrate mutation)              │
└────────────┬─────────────────────────────────────────────┘
             ↓
┌──────────────────────────────────────────────────────────┐
│ [FUTURE] Approved outputs → substrate proposals          │
└────────────┬─────────────────────────────────────────────┘
             ↓
┌──────────────────────────────────────────────────────────┐
│ SUBSTRATE GOVERNANCE: P1 pipeline validates              │
│ → blocks created (state: ACCEPTED)                       │
└──────────────────────────────────────────────────────────┘
```

**Three Paths to Blocks**:
1. **Project scaffolding** (Automatic): Project creation → Topic + Vision anchor blocks → ACCEPTED (trusted, immediate)
2. **User-authored** (Direct): User → Block CRUD on Context page → ACCEPTED (trusted, immediate)
3. **Agent-generated** (Governed): Agent → work_output → [future] proposal → governance → ACCEPTED

---

## 🗄️ Table Interactions Summary

### Work-Platform Tables (Direct Access)

| Table | Create | Read | Update | Delete |
|-------|--------|------|--------|--------|
| `projects` | ✅ | ✅ | ✅ | ⏸️ |
| `work_requests` | ✅ | ✅ | ❌ | ❌ |
| `work_tickets` | ✅ | ✅ | ✅ (status) | ❌ |
| `work_checkpoints` | ✅ | ✅ | ✅ (resolve) | ❌ |
| `agent_sessions` | ✅ | ✅ | ✅ | ❌ |

### Substrate-API Tables (HTTP Access via substrate_client)

| Table | Create | Read | Update | Delete |
|-------|--------|------|--------|--------|
| `baskets` | ✅ (HTTP) | ✅ (HTTP) | ✅ (HTTP) | ❌ |
| `raw_dumps` | ✅ (HTTP) | ✅ (HTTP) | ❌ | ❌ |
| `blocks` | ✅ (HTTP, user-authored) | ✅ (HTTP) | ✅ (HTTP, non-LOCKED) | ✅ (soft, non-LOCKED) |
| `work_outputs` | ✅ (HTTP) | ✅ (HTTP) | ✅ (HTTP) | ❌ |
| `proposals` | ⏸️ (future) | ✅ (HTTP) | ❌ | ❌ |
| `documents` | ❌ | ✅ (HTTP) | ❌ | ❌ |

**Key**: ✅ = Supported, ❌ = Not supported, ⏸️ = Deferred/partial

**Block CRUD Notes**:
- Create: User-authored blocks only (ACCEPTED state, confidence=1.0)
- Update: Title, content, semantic_type (LOCKED blocks protected)
- Delete: Soft-delete to SUPERSEDED state (LOCKED blocks protected)

---

## 📚 See Also

- **[YARNNN_LAYERED_ARCHITECTURE_V4.md](./YARNNN_LAYERED_ARCHITECTURE_V4.md)** - Two-layer architecture
- **[YARNNN_PLATFORM_CANON_V4.md](../canon/YARNNN_PLATFORM_CANON_V4.md)** - Separated governance philosophy
- **[Legacy Unified Governance](../archive/legacy-unified-governance/README.md)** - Why it was deprecated

---

**Two layers. Separated governance. Direct user control. Strong foundations (Topic + Vision). This is YARNNN v4.3.**
