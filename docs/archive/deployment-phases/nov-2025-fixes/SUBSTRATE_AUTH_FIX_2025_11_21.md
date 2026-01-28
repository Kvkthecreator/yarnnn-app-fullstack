# Substrate API Authentication Fix - November 21, 2025

## Problem Summary

**Error**: Work-platform → substrate-API calls failing with 401 Unauthorized
```
DEBUG: Substrate API GET https://yarnnn-substrate-api.onrender.com/baskets/.../blocks: 401
ERROR: Substrate API error: HTTP 401 error
ERROR: Circuit breaker: Opening circuit after 5 failures
```

**Impact**:
- Every TP chat message attempts 3 substrate-API calls (context blocks, reference assets, etc.)
- All 3 fail with 401
- Adds 3-5 seconds to every request
- Triggers circuit breaker after 5 failures
- Backend instability and frequent crashes

## Root Cause Analysis

### Authentication Architecture (Both APIs)

Both substrate-API and work-platform-API use the SAME authentication middleware pattern:

**[AuthMiddleware.java](../substrate-api/api/src/middleware/auth.py:29-83)**:
1. Extract Bearer token from Authorization header
2. Try to verify as Supabase JWT token (user authentication)
3. If JWT fails, try to verify as integration token (service-to-service auth)
4. If both fail, return 401

**Integration Token System**:
- Stored in `integration_tokens` table (shared database)
- Format: `yit_XXXXXXXXXXXXX` (prefix + 32 random bytes)
- Hashed with SHA256 before storage
- Verified by querying `token_hash` column
- Includes `user_id` and `workspace_id` for ownership

### The Bug

**Location**: [substrate_client.py:187-193](../../work-platform/api/src/clients/substrate_client.py#L187-L193)

```python
def _get_headers(self) -> dict[str, str]:
    """Get request headers with service authentication."""
    return {
        "Authorization": f"Bearer {self.service_secret}",  # ❌ WRONG
        "X-Service-Name": "platform-api",
        "Content-Type": "application/json",
    }
```

**Problem**:
- `self.service_secret` comes from `SUBSTRATE_SERVICE_SECRET` env var
- This is just an arbitrary string, NOT a valid integration token
- substrate-API tries to verify it as:
  1. JWT (fails - not a valid JWT)
  2. Integration token (fails - hash doesn't exist in database)
- Result: 401 Unauthorized

**Why This Happened**:
- Legacy code from before integration tokens system was implemented
- "Service secret" was a placeholder concept that never materialized
- Integration tokens system was added later but SubstrateClient wasn't updated

## Solution: Use Integration Tokens

### Architecture Pattern: Service-to-Service Auth

```
┌─────────────────────┐
│  work-platform-API  │
│                     │
│  1. Get user JWT    │────────┐
│     from request    │        │
│                     │        │
│  2. Create          │        │ Both verify against
│     integration     │        │ integration_tokens
│     token for       │        │ table
│     workspace       │        │
│                     │        │
│  3. Use token to    │        │
│     call substrate  │────────┘
└─────────────────────┘
         │
         │ Bearer yit_XXX
         ▼
┌─────────────────────┐
│   substrate-API     │
│                     │
│  1. Receive token   │
│  2. Verify via      │
│     integration_    │
│     tokens table    │
│  3. Extract         │
│     workspace_id    │
└─────────────────────┘
```

### Implementation Steps

#### Step 1: Create Service Integration Token

**Via API** (Recommended):
```bash
# Get user JWT from frontend
# Use frontend to call work-platform API

curl -X POST https://yarnnn-work-platform-api.onrender.com/integrations/tokens \
  -H "Authorization: Bearer <USER_JWT>" \
  -H "Content-Type: application/json" \
  -d '{"description": "work-platform → substrate-API service token"}'

# Response:
{
  "token": "yit_XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
  "token_id": "uuid",
  "description": "work-platform → substrate-API service token",
  "created_at": "2025-11-21T..."
}
```

**Via Database** (Alternative):
```python
import secrets
import hashlib
from datetime import datetime, timezone

# Generate token
raw_token = "yit_" + secrets.token_urlsafe(32)
token_hash = hashlib.sha256(raw_token.encode("utf-8")).hexdigest()

# Insert into database
sb.table("integration_tokens").insert({
    "token_hash": token_hash,
    "user_id": "<YOUR_USER_ID>",
    "workspace_id": "<YOUR_WORKSPACE_ID>",
    "description": "work-platform → substrate-API service token",
    "created_at": datetime.now(timezone.utc).isoformat(),
}).execute()

# Save raw_token securely (can't recover from hash!)
print(f"Token: {raw_token}")
```

#### Step 2: Update Render Environment Variable

**In Render Dashboard**:
1. Go to: yarnnn-work-platform-api service
2. Environment tab
3. Update: `SUBSTRATE_SERVICE_SECRET` → `<INTEGRATION_TOKEN>`
4. Value should be: `yit_XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX`
5. Save → triggers auto-deploy

#### Step 3: No Code Changes Needed!

The existing code already sends the token correctly:
```python
# substrate_client.py line 190
"Authorization": f"Bearer {self.service_secret}",
```

This works because:
- Token format is correct: `Bearer yit_XXX`
- substrate-API will verify via integration_tokens table
- No code changes required, just update env var

### Verification

After updating env var and redeploying:

**Expected Logs** (work-platform):
```
INFO: Substrate API GET /baskets/.../blocks: 200 OK
DEBUG: Retrieved 5 context blocks
INFO: Memory adapter initialized successfully
```

**Expected Logs** (substrate-API):
```
DEBUG: AuthMiddleware: JWT verification failed (expected)
DEBUG: Integration token verified for workspace_id=...
INFO: GET /baskets/.../blocks 200 OK
```

**Test Command**:
```bash
# Test substrate-API with integration token
curl -X GET https://yarnnn-substrate-api.onrender.com/baskets/<BASKET_ID>/blocks \
  -H "Authorization: Bearer yit_XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX"

# Should return 200 OK with blocks
```

## Benefits

1. ✅ **Proper Authentication**: Uses official integration tokens system
2. ✅ **No Code Changes**: Just update env var
3. ✅ **Workspace Isolation**: Token scoped to specific workspace
4. ✅ **Revocable**: Can revoke token if compromised
5. ✅ **Auditable**: `last_used_at` tracking
6. ✅ **Shared System**: Both APIs use same auth mechanism

## Security Considerations

**Token Security**:
- Integration tokens are long-lived (no expiration)
- Store in Render env vars (encrypted at rest)
- Revoke via API if compromised: `DELETE /integrations/tokens/{token_id}`
- Never commit to git (already in .gitignore via .env pattern)

**RLS Bypass**:
- Integration tokens bypass Supabase RLS
- substrate-API handles authorization at application level
- workspace_id scoping prevents cross-workspace access

## Testing Checklist

After deploying fix:

- [ ] TP chat completes without hanging
- [ ] Render logs show 200 OK for substrate-API calls
- [ ] No 401 errors in logs
- [ ] Circuit breaker stays closed
- [ ] Memory context loads successfully
- [ ] Backend stability improves (no frequent crashes)

## Rollback Plan

If issues occur:

1. Revert env var to previous value
2. Redeploy work-platform-API
3. System will fail gracefully (circuit breaker)
4. Investigate token creation/verification

## Future Enhancements

1. **Token Rotation**: Periodic rotation for security
2. **Multiple Tokens**: Different tokens for different purposes
3. **Token Monitoring**: Alert on failed auth attempts
4. **Lazy Memory Loading**: After stability, implement tool-based memory queries

## Related Documentation

- [Integration Tokens API](../../work-platform/api/src/app/routes/integration_tokens.py)
- [Substrate Client](../../work-platform/api/src/clients/substrate_client.py)
- [Auth Middleware](../../substrate-api/api/src/middleware/auth.py)
- [TP Chat Fixes](./TP_CHAT_FIXES_2025_11_21.md)

---

**Status**: READY TO DEPLOY

**Action Required**:
1. Create integration token via API or database
2. Update SUBSTRATE_SERVICE_SECRET in Render
3. Monitor logs for successful auth
