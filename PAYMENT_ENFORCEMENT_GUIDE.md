# Payment Enforcement System

## Overview

BurnBot requires users to pay in SOL before activating their projects. This document explains the multi-layer payment enforcement system that prevents unauthorized access.

## Three-Layer Enforcement

### 1. **Backend Validation** (Primary Defense)

**Location:** `server/routes.ts` - PATCH `/api/projects/:id` endpoint

When a user tries to activate a project (`isActive: true`), the backend:

```typescript
1. Checks if wallet is whitelisted → Allow activation
2. If NOT whitelisted:
   a. Query payments table for this project
   b. Check for valid, non-expired payment
   c. If NO valid payment → Return 403 error
   d. If valid payment → Allow activation
```

**Error Response:**
```json
{
  "message": "Payment required to activate project. Please complete payment first."
}
```

### 2. **Scheduler Validation** (Automated Execution)

**Location:** `server/scheduler.ts`

Before executing automated buybacks, the scheduler:

```typescript
For each active project:
  1. Check if wallet is whitelisted → Execute buyback
  2. If NOT whitelisted:
     a. Check for valid payment
     b. If NO payment → Skip execution
     c. If valid payment → Execute buyback
```

**Console Logs:**
- Whitelisted: `"Project {name} - owner wallet is whitelisted, bypassing payment check"`
- No payment: `"Project {name} has no valid payment - skipping"`

### 3. **Frontend User Experience** (UX Layer)

**Location:** `client/src/pages/project-details.tsx`

When a user tries to activate:

```typescript
1. Frontend checks for valid payment
2. If NO payment:
   a. Show PaymentModal
   b. User sends SOL to treasury
   c. User enters transaction signature
   d. Frontend verifies on-chain
   e. Project activated automatically
3. If payment exists → Update project directly
```

**UI Indicators:**
- Form description shows: `"Payment required to activate"`
- Whitelisted users see: `"Free Access (Free Access)"`
- Crown badge (👑) displayed for whitelisted projects

## Payment Flow

### For Regular Users

1. **Create Project** → `isActive: false` (default)
2. **Try to Activate** → Payment modal appears
3. **Send 0.2 or 0.4 SOL** → Treasury wallet
4. **Submit TX Signature** → On-chain verification
5. **Verification Success** → Project activated automatically
6. **Scheduler Runs** → Executes automated buybacks

### For Whitelisted Users

1. **Create Project** → `isActive: false` (default)
2. **Activate Project** → No payment required
3. **Scheduler Runs** → Executes immediately

## Whitelisted Wallets

**Configuration:** `shared/config.ts`

```typescript
export const WHITELISTED_WALLETS = [
  "4D5a61DsihdeEV2SbfkpYsZemTrrczxAwyBfR47xF5uS",  // Owner wallet
  "jawKuQ3xtcYoAuqE9jyG2H35sv2pWJSzsyjoNpsxG38",  // Treasury wallet
];
```

**Benefits:**
- No payment required
- Unlimited projects
- Immediate activation
- "Free Access" badge in UI

## Payment Verification API

**Endpoint:** `POST /api/verify-payment-onchain`

**Request:**
```json
{
  "txSignature": "5Kqy...",
  "projectId": "uuid",
  "tier": "STARTER" | "PRO",
  "ownerWalletAddress": "wallet_address"
}
```

**Verification Steps:**
1. Fetch transaction from Solana blockchain
2. Verify sender wallet address
3. Verify recipient (treasury) wallet
4. Verify amount matches tier price
5. Create payment record in database
6. Activate project automatically

## Payment Records

**Table:** `payments`

```sql
CREATE TABLE payments (
  id VARCHAR PRIMARY KEY,
  project_id VARCHAR NOT NULL,
  wallet_address TEXT NOT NULL,
  amount DECIMAL(18,9) NOT NULL,
  currency TEXT NOT NULL,  -- 'SOL'
  tx_signature TEXT NOT NULL,
  tier TEXT NOT NULL,  -- 'starter', 'pro'
  verified BOOLEAN NOT NULL DEFAULT false,
  expires_at TIMESTAMP NOT NULL,  -- 30 days from payment
  created_at TIMESTAMP NOT NULL
);
```

**Expiration:** Payments expire 30 days after creation

## Security Features

### Prevents Unauthorized Access

❌ **Cannot bypass payment by:**
- Direct API calls (backend validates)
- Database manipulation (scheduler validates)
- Frontend tricks (backend enforces)

✅ **Enforcement points:**
- Project update endpoint
- Automated scheduler
- Payment verification API

### Whitelist System

- Hardcoded in `shared/config.ts`
- Requires code deployment to modify
- Cannot be bypassed via API
- Checked at runtime (no caching)

## Testing Payment Enforcement

### Test as Regular User

1. Create project without payment
2. Try to activate → Should show payment modal
3. Submit invalid TX → Should show error
4. Submit valid TX → Should activate project

### Test as Whitelisted User

1. Create project with whitelisted wallet
2. Activate immediately → Should succeed
3. Check UI → Should show "Free Access" badge
4. Scheduler runs → Should execute without payment

## Common Issues

### "Payment required" error when activating

**Cause:** No valid payment found
**Solution:** 
1. Send 0.2 SOL (Starter) or 0.4 SOL (Pro) to treasury
2. Copy transaction signature
3. Use PaymentModal to verify payment

### Project not executing despite payment

**Causes:**
1. Payment expired (>30 days)
2. Wrong wallet address paid
3. Insufficient amount sent

**Solution:** 
- Check payment expiration in database
- Verify transaction on Solscan
- Make new payment if needed

### Whitelisted wallet not working

**Cause:** Wallet address mismatch
**Solution:**
- Verify exact address in `shared/config.ts`
- Check for typos or extra spaces
- Restart server after config changes

## Admin Operations

### Add Whitelisted Wallet

1. Edit `shared/config.ts`
2. Add wallet to `WHITELISTED_WALLETS` array
3. Deploy changes
4. Restart application

```typescript
export const WHITELISTED_WALLETS = [
  "4D5a61DsihdeEV2SbfkpYsZemTrrczxAwyBfR47xF5uS",
  "jawKuQ3xtcYoAuqE9jyG2H35sv2pWJSzsyjoNpsxG38",
  "NewWalletAddressHere",  // Add here
];
```

### Manual Payment Override

For support purposes, manually create payment record:

```sql
INSERT INTO payments (
  id, project_id, wallet_address, amount, 
  currency, tx_signature, tier, verified, 
  expires_at, created_at
) VALUES (
  gen_random_uuid(),
  'project-id-here',
  'wallet-address',
  0.2,
  'SOL',
  'manual-override-signature',
  'starter',
  true,
  NOW() + INTERVAL '30 days',
  NOW()
);
```

## Monitoring

### Check Payment Status

```sql
-- View all active payments
SELECT p.name, pay.tier, pay.expires_at, pay.verified
FROM payments pay
JOIN projects p ON pay.project_id = p.id
WHERE pay.verified = true 
  AND pay.expires_at > NOW()
ORDER BY pay.expires_at DESC;
```

### Check Whitelisted Projects

```sql
-- View all projects from whitelisted wallets
SELECT id, name, owner_wallet_address, is_active
FROM projects
WHERE owner_wallet_address IN (
  '4D5a61DsihdeEV2SbfkpYsZemTrrczxAwyBfR47xF5uS',
  'jawKuQ3xtcYoAuqE9jyG2H35sv2pWJSzsyjoNpsxG38'
);
```

### Check Failed Activations

Check server logs for:
- `"Payment required to activate project"` - User tried without payment
- `"bypassing payment check"` - Whitelisted wallet activated
- `"has no valid payment - skipping"` - Scheduler skipped unpaid project

## Conclusion

The three-layer enforcement system ensures that:
1. **Backend prevents** unauthorized activation
2. **Scheduler prevents** unauthorized execution
3. **Frontend guides** users through payment flow

Whitelisted wallets bypass all checks for administrative and testing purposes.

---

**Last Updated:** October 19, 2025
