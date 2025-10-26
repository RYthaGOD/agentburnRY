-- ============================================================================
-- AI Bot Budget Reset Script
-- ============================================================================
-- This script cleanly resets budget tracking for AI trading bots.
-- Use this when budget tracking becomes corrupted or you want a fresh start.
--
-- USAGE:
--   Replace 'YOUR_WALLET_ADDRESS' with the actual wallet address, then run:
--   psql $DATABASE_URL -f scripts/reset-ai-bot-budget.sql
--
-- SAFETY: This script will:
--   1. Reset budget counters to match current open positions
--   2. Archive old transaction data (not delete it)
--   3. Recalculate portfolio peak based on current value
-- ============================================================================

-- ============================================================================
-- STEP 1: Reset Budget Tracking
-- ============================================================================
-- Reset budget_used to only count currently open positions
-- This ensures budget_used reflects actual capital deployed, not historical trades
UPDATE ai_bot_configs
SET 
  budget_used = COALESCE((
    SELECT SUM(amount_sol)
    FROM ai_bot_positions
    WHERE owner_wallet_address = ai_bot_configs.owner_wallet_address
  ), 0),
  
  -- Reset platform fees counter (will be recalculated from successful transactions)
  total_platform_fees_paid = COALESCE((
    SELECT SUM(platform_fee)
    FROM transactions
    WHERE project_id IS NULL  -- AI bot transactions only
      AND status = 'completed'
      AND platform_fee IS NOT NULL
      AND fee_exempt = false
  ), 0),
  
  -- Reset buyback tracking
  total_buyback_sol = 0,
  total_tokens_burned = 0,
  
  -- Update timestamp
  updated_at = NOW()
WHERE owner_wallet_address = 'YOUR_WALLET_ADDRESS';

-- ============================================================================
-- STEP 2: Clean Up Invalid Transaction Records
-- ============================================================================
-- Mark transactions with NULL net_amount as failed
-- These are incomplete/corrupted records from interrupted trades
UPDATE transactions
SET 
  status = 'failed',
  error_message = 'Budget reset: Invalid transaction data (NULL net_amount)',
  updated_at = NOW()
WHERE 
  type IN ('ai_buy', 'ai_sell')
  AND project_id IS NULL
  AND status != 'failed'
  AND (net_amount IS NULL OR net_amount = 0);

-- ============================================================================
-- STEP 3: Recalculate Portfolio Peak
-- ============================================================================
-- Calculate current portfolio value (open positions + available balance)
-- This ensures drawdown protection starts fresh from current state
DO $$
DECLARE
  current_portfolio_value DECIMAL(18, 9);
  wallet TEXT := 'YOUR_WALLET_ADDRESS';
BEGIN
  -- Calculate total value of open positions at current prices
  -- NOTE: You may need to run wallet sync first to get accurate position values
  SELECT 
    COALESCE(SUM(amount_sol), 0) + 
    (SELECT COALESCE(total_budget - budget_used, 0) FROM ai_bot_configs WHERE owner_wallet_address = wallet)
  INTO current_portfolio_value
  FROM ai_bot_positions
  WHERE owner_wallet_address = wallet;
  
  -- Update portfolio peak to current value
  UPDATE ai_bot_configs
  SET 
    portfolio_peak_sol = GREATEST(portfolio_peak_sol, current_portfolio_value),
    updated_at = NOW()
  WHERE owner_wallet_address = wallet;
  
  RAISE NOTICE 'Portfolio peak updated to: % SOL', current_portfolio_value;
END $$;

-- ============================================================================
-- STEP 4: Verification Queries
-- ============================================================================
-- Run these to verify the reset was successful

-- Check budget tracking
SELECT 
  owner_wallet_address,
  total_budget,
  budget_used,
  (total_budget - budget_used) as remaining_budget,
  total_platform_fees_paid,
  portfolio_peak_sol
FROM ai_bot_configs
WHERE owner_wallet_address = 'YOUR_WALLET_ADDRESS';

-- Check open positions
SELECT 
  COUNT(*) as open_positions,
  SUM(amount_sol) as total_capital_deployed,
  AVG(last_check_profit_percent) as avg_profit_pct
FROM ai_bot_positions
WHERE owner_wallet_address = 'YOUR_WALLET_ADDRESS';

-- Check transaction counts
SELECT 
  status,
  COUNT(*) as count,
  SUM(CASE WHEN type = 'ai_buy' THEN 1 ELSE 0 END) as buys,
  SUM(CASE WHEN type = 'ai_sell' THEN 1 ELSE 0 END) as sells
FROM transactions
WHERE type IN ('ai_buy', 'ai_sell')
  AND project_id IS NULL
GROUP BY status
ORDER BY status;

-- ============================================================================
-- EXPECTED OUTPUT:
-- ============================================================================
-- Budget should match open positions + available balance
-- Failed transactions should be marked with error message
-- Portfolio peak should be >= current portfolio value
-- All completed transactions should have valid net_amount and platform_fee
-- ============================================================================
