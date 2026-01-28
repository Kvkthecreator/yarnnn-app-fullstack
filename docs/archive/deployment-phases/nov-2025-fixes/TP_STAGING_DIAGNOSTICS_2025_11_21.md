# TP Staging Pattern - Production Diagnostics (Nov 21, 2025)

## Status: Deployed & Monitoring

**Deployed Commits**:
- `5845628f` - Work Request Roll-Up + Staging Pattern COMPLETE
- `f9789aa8` - Error handling improvements

**Render URL**: https://yarnnn-app-fullstack.onrender.com
**Frontend URL**: https://www.yarnnn.com

---

## Current Observations

### ✅ Working
1. **Backend Deployment**: Service is live (200 OK on `/api/tp/chat`)
2. **Frontend Deployment**: Chat interface loads correctly
3. **localStorage Fix**: Corruption handling deployed

### ❓ Unknown
1. **Staging Queries**: Haven't seen actual work_orchestration execution yet
2. **User Token Flow**: Need to verify `has_token=True` in logs
3. **Bundle Creation**: Need to confirm WorkBundle is created successfully

### ⚠️ Known Issues (Not from our code)
1. **401 Errors** - `/api/baskets/...`
   - This is from OLD frontend code (Overview page)
   - NOT from new TP staging pattern
   - Can be fixed separately

---

## What to Test

### Test 1: Send Message to TP (No work orchestration)
**Action**: Send simple message like "hello" or "what can you help with?"

**Expected**:
- ✅ Message sends successfully
- ✅ TP responds with greeting/capabilities
- ✅ NO staging queries (chat phase only)

**Logs to Look For**:
```
INFO: TP chat: user=..., basket=..., message=hello
INFO: TP chat complete: XXX chars, 0 outputs, X actions
```

### Test 2: Trigger Work Orchestration (WITH staging)
**Action**: Send message like "research AI agent frameworks"

**Expected**:
- ✅ TP decides to use work_orchestration tool
- ✅ STAGING PHASE: 3 queries to substrate-API
- ✅ WorkBundle created
- ✅ Specialist agent receives bundle

**Critical Logs to Look For**:
```
DEBUG: Staging: Loading substrate blocks for basket=..., has_token=True
INFO: Staging: Loaded X substrate blocks
DEBUG: Staging: Loading reference assets for basket=..., agent_type=research
INFO: Staging: Loaded X reference assets for research
INFO: Staging: Loaded config for research
INFO: WorkBundle created: ...
INFO: DELEGATION PHASE: Executing research with pre-loaded context
```

**If `has_token=False`**:
- Problem: JWT extraction failing in thinking_partner.py
- Solution: Check verify_jwt() return value mapping

**If `has_token=True` + 401 errors**:
- Problem: substrate-API not accepting the JWT
- Solution: Check substrate-API auth middleware

**If no errors**:
- SUCCESS! Staging pattern working correctly

---

## Enhanced Logging Features

Our recent deployment includes:

1. **Frontend localStorage Validation**:
   - Corrupted data auto-clears
   - Prevents "Processing..." stuck state
   - Console warnings visible in browser devtools

2. **Backend Staging Diagnostics**:
   - `DEBUG: Staging: Loading substrate blocks for basket=X, has_token=True/False`
   - `ERROR: Failed to load substrate blocks (basket=X): [full trace]`
   - Shows exactly where staging queries fail

---

## Next Steps (Based on Test Results)

### If Test 1 Passes
- ✅ Chat phase working correctly
- ✅ TP conversation continuity via Claude SDK
- ✅ No substrate queries during chat (as designed)

### If Test 2 Triggers Staging Successfully
- ✅ work_orchestration tool working
- ✅ WorkBundle creation successful
- ✅ Specialist agents receiving pre-loaded context
- ✅ **ARCHITECTURE COMPLETE**

### If Test 2 Shows `has_token=False`
- Fix verify_jwt() return value extraction
- Ensure `user.get("token")` matches jwt.py return dict

### If Test 2 Shows 401 with `has_token=True`
- Check substrate-API auth middleware
- Verify JWT signature/issuer matching

---

## Current Architecture Flow

```
User: "research AI agents"
  ↓
Frontend: POST /api/tp/chat
  ↓
Backend: verify_jwt(request)
  ↓ Returns: {"user_id": "...", "token": "eyJ..."}
  ↓
thinking_partner.py: user_token = user.get("token")
  ↓
ThinkingPartnerAgentSDK(user_token="eyJ...")
  ↓
TP.chat() - Claude SDK decides to use work_orchestration
  ↓
STAGING BOUNDARY:
  ├─ _load_substrate_blocks() → SubstrateClient(user_token="eyJ...")
  ├─ _load_reference_assets() → SubstrateClient(user_token="eyJ...")
  └─ _load_agent_config() → work-platform DB (no auth needed)
  ↓
WorkBundle(substrate_blocks=[...], reference_assets=[...], ...)
  ↓
ResearchAgentSDK(bundle=bundle)
  ↓
agent.deep_dive(topic="AI agents") - NO QUERIES, uses bundle
  ↓
work_outputs emitted
  ↓
TP synthesizes response
  ↓
Frontend displays result
```

---

## Files to Monitor

**Frontend**:
- Browser DevTools Console (localStorage warnings)
- Network tab (`/api/tp/chat` requests)

**Backend** (Render logs):
- `INFO: TP chat: ...` (chat initiated)
- `DEBUG: Staging: Loading substrate blocks ...` (staging queries)
- `INFO: Staging: Loaded X ...` (staging success)
- `ERROR: Failed to load substrate blocks ...` (staging failure)
- `INFO: work_orchestration SUCCESS: ...` (delegation complete)

---

**Last Updated**: Nov 21, 2025 16:27 GMT
**Status**: Monitoring production behavior
