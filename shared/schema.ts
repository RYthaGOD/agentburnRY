import { sql } from "drizzle-orm";
import { pgTable, text, varchar, timestamp, decimal, integer, boolean, index, uniqueIndex } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const projects = pgTable("projects", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  tokenMintAddress: text("token_mint_address").notNull(),
  tokenDecimals: integer("token_decimals").notNull().default(9), // SPL token decimal places (typically 6, 8, or 9)
  treasuryWalletAddress: text("treasury_wallet_address").notNull(),
  burnAddress: text("burn_address").notNull(),
  schedule: text("schedule").notNull(), // hourly, daily, weekly, custom
  customCronExpression: text("custom_cron_expression"),
  buybackAmountSol: decimal("buyback_amount_sol", { precision: 18, scale: 9 }),
  isActive: boolean("is_active").notNull().default(false),
  ownerWalletAddress: text("owner_wallet_address").notNull(),
  isPumpfunToken: boolean("is_pumpfun_token").notNull().default(false),
  pumpfunCreatorWallet: text("pumpfun_creator_wallet"), // Wallet to claim PumpFun rewards
  trialEndsAt: timestamp("trial_ends_at"), // 10-day trial for first 100 signups
  
  // Volume Bot Settings
  volumeBotEnabled: boolean("volume_bot_enabled").notNull().default(false),
  volumeBotBuyAmountSOL: decimal("volume_bot_buy_amount_sol", { precision: 18, scale: 9 }),
  volumeBotSellPercentage: decimal("volume_bot_sell_percentage", { precision: 5, scale: 2 }), // 0-100%
  volumeBotMinPriceSOL: decimal("volume_bot_min_price_sol", { precision: 18, scale: 9 }),
  volumeBotMaxPriceSOL: decimal("volume_bot_max_price_sol", { precision: 18, scale: 9 }),
  volumeBotIntervalMinutes: integer("volume_bot_interval_minutes"), // Trading frequency
  
  // Buy Bot Settings (Limit Orders)
  buyBotEnabled: boolean("buy_bot_enabled").notNull().default(false),
  buyBotLimitOrders: text("buy_bot_limit_orders"), // JSON array: [{ priceSOL: "0.001", amountSOL: "0.1" }]
  buyBotMaxSlippage: decimal("buy_bot_max_slippage", { precision: 5, scale: 2 }), // 0-100%
  
  // AI Trading Bot Settings (Grok-powered PumpFun trading)
  aiBotEnabled: boolean("ai_bot_enabled").notNull().default(false),
  aiBotTotalBudget: decimal("ai_bot_total_budget", { precision: 18, scale: 9 }), // Total SOL budget allocated for AI trading
  aiBotBudgetUsed: decimal("ai_bot_budget_used", { precision: 18, scale: 9 }).notNull().default("0"), // Total SOL spent so far
  aiBotBudgetPerTrade: decimal("ai_bot_budget_per_trade", { precision: 18, scale: 9 }), // Max SOL per trade
  aiBotAnalysisInterval: integer("ai_bot_analysis_interval"), // Minutes between market scans
  aiBotMinVolumeUSD: decimal("ai_bot_min_volume_usd", { precision: 18, scale: 2 }), // Min 24h volume filter
  aiBotMinPotentialPercent: decimal("ai_bot_min_potential_percent", { precision: 18, scale: 2 }), // Min upside % (enforced minimum 150%)
  aiBotMaxDailyTrades: integer("ai_bot_max_daily_trades"), // Daily trade limit
  aiBotRiskTolerance: text("ai_bot_risk_tolerance"), // "low", "medium", "high"
  
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  
  // Real-time monitoring metrics
  lastBotRunAt: timestamp("last_bot_run_at"),
  lastBotStatus: text("last_bot_status"), // "success", "failed", "skipped"
  latestPriceSOL: decimal("latest_price_sol", { precision: 18, scale: 9 }),
  priceTimestamp: timestamp("price_timestamp"),
});

export const transactions = pgTable("transactions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id").references(() => projects.id), // Nullable for standalone AI bot transactions
  type: text("type").notNull(), // claim, buyback, burn, volume_buy, volume_sell, limit_buy, ai_buy, ai_sell
  amount: decimal("amount", { precision: 18, scale: 9 }).notNull(), // Gross SOL amount (before fee for buys)
  netAmount: decimal("net_amount", { precision: 18, scale: 9 }), // Net SOL actually swapped (after fee deduction)
  platformFee: decimal("platform_fee", { precision: 18, scale: 9 }), // Platform fee deducted (1% for AI bot trades)
  feeExempt: boolean("fee_exempt").notNull().default(false), // Whether this transaction was fee-exempt
  feeTxSignature: text("fee_tx_signature"), // Signature of the fee transfer transaction (if applicable)
  tokenAmount: decimal("token_amount", { precision: 30, scale: 9 }), // Increased to handle tokens with trillion+ supply
  txSignature: text("tx_signature").notNull(),
  status: text("status").notNull(), // pending, completed, failed
  errorMessage: text("error_message"),
  
  // Accuracy monitoring for trading bots
  expectedPriceSOL: decimal("expected_price_sol", { precision: 18, scale: 9 }),
  actualPriceSOL: decimal("actual_price_sol", { precision: 18, scale: 9 }),
  priceDeviationBps: integer("price_deviation_bps"), // Basis points (1bp = 0.01%)
  
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const payments = pgTable("payments", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id").notNull().references(() => projects.id),
  walletAddress: text("wallet_address").notNull(),
  amount: decimal("amount", { precision: 18, scale: 9 }).notNull(),
  currency: text("currency").notNull(), // SOL, USDC
  txSignature: text("tx_signature").notNull(),
  tier: text("tier").notNull(), // starter, pro, enterprise
  verified: boolean("verified").notNull().default(false),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// Table to prevent replay attacks on manual buyback executions
export const usedSignatures = pgTable("used_signatures", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id").notNull().references(() => projects.id),
  signatureHash: text("signature_hash").notNull().unique(),
  messageTimestamp: timestamp("message_timestamp").notNull(),
  expiresAt: timestamp("expires_at").notNull(), // Auto-cleanup after expiry
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// Standalone AI Trading Bot Configuration (not tied to projects)
export const aiBotConfigs = pgTable("ai_bot_configs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  ownerWalletAddress: text("owner_wallet_address").notNull().unique(),
  
  // Bot settings
  enabled: boolean("enabled").notNull().default(false),
  totalBudget: decimal("total_budget", { precision: 18, scale: 9 }).notNull().default("0"), // 0 = unlimited (use all available capital)
  budgetUsed: decimal("budget_used", { precision: 18, scale: 9 }).notNull().default("0"), // Total SOL currently in active positions
  budgetPerTrade: decimal("budget_per_trade", { precision: 18, scale: 9 }).notNull().default("0.02"), // Base trade size (scales with portfolio)
  portfolioPercentPerTrade: integer("portfolio_percent_per_trade").notNull().default(10), // % of portfolio per trade (enables compounding)
  analysisInterval: integer("analysis_interval").notNull().default(60), // Minutes between scans
  minVolumeUSD: decimal("min_volume_usd", { precision: 18, scale: 2 }).notNull().default("5000"),
  minPotentialPercent: decimal("min_potential_percent", { precision: 18, scale: 2 }).notNull().default("150"),
  maxDailyTrades: integer("max_daily_trades").notNull().default(5), // DEPRECATED - no longer enforced, unlimited trades
  riskTolerance: text("risk_tolerance").notNull().default("medium"), // "low", "medium", "high"
  profitTargetPercent: decimal("profit_target_percent", { precision: 18, scale: 2 }).notNull().default("50"), // DEPRECATED - AI makes all sell decisions
  
  // AI-driven sell decisions (ALWAYS ENABLED - these control AI behavior)
  enableAiSellDecisions: boolean("enable_ai_sell_decisions").notNull().default(true), // DEPRECATED - always true, AI always makes decisions
  minAiSellConfidence: integer("min_ai_sell_confidence").notNull().default(50), // INCREASED: Faster exits for drawdown protection (was 40)
  holdIfHighConfidence: integer("hold_if_high_confidence").notNull().default(70), // Hold when AI confidence >= this (0-100)
  
  // Organic volume filtering (wash trading detection)
  minOrganicScore: integer("min_organic_score").notNull().default(40), // 0-100, filters wash trading
  minQualityScore: integer("min_quality_score").notNull().default(30), // 0-100, overall token quality
  minLiquidityUSD: decimal("min_liquidity_usd", { precision: 18, scale: 2 }).notNull().default("5000"), // Minimum liquidity
  minTransactions24h: integer("min_transactions_24h").notNull().default(20), // Minimum 24h transaction count
  
  // Encrypted treasury key for AI bot trading
  treasuryKeyCiphertext: text("treasury_key_ciphertext"),
  treasuryKeyIv: text("treasury_key_iv"),
  treasuryKeyAuthTag: text("treasury_key_auth_tag"),
  treasuryKeyFingerprint: text("treasury_key_fingerprint"),
  
  // STRICT DRAWDOWN PROTECTION: Track portfolio peak for drawdown monitoring
  portfolioPeakSOL: decimal("portfolio_peak_sol", { precision: 18, scale: 9 }).notNull().default("0"),
  bypassDrawdownProtection: boolean("bypass_drawdown_protection").notNull().default(false), // Allow AI to continue trading even during drawdowns
  
  // Automatic Buyback & Burn Configuration
  buybackEnabled: boolean("buyback_enabled").notNull().default(false), // Enable automatic buyback on profitable trades
  buybackTokenMint: text("buyback_token_mint"), // Token mint address to buyback (e.g., MY BOT token)
  buybackPercentage: decimal("buyback_percentage", { precision: 5, scale: 2 }).notNull().default("5"), // % of profit to use for buyback (default 5%)
  totalBuybackSOL: decimal("total_buyback_sol", { precision: 18, scale: 9 }).notNull().default("0"), // Total SOL spent on buybacks
  totalTokensBurned: decimal("total_tokens_burned", { precision: 30, scale: 9 }).notNull().default("0"), // Total tokens permanently burned (increased for high-supply tokens)
  
  // Platform Fee Tracking (1% fee on all trades, with exemptions)
  totalPlatformFeesPaid: decimal("total_platform_fees_paid", { precision: 18, scale: 9 }).notNull().default("0"), // Cumulative platform fees paid in SOL
  isFeeExempt: boolean("is_fee_exempt").notNull().default(false), // Computed field - true if wallet is in exemption list
  
  // Subscription & Free Trades (20 free trades, then 0.15 SOL for 2 weeks unlimited access)
  freeTradesUsed: integer("free_trades_used").notNull().default(0), // Count of free trades used (0-20)
  subscriptionActive: boolean("subscription_active").notNull().default(false), // True if user has paid for 2-week access
  subscriptionExpiresAt: timestamp("subscription_expires_at"), // When 2-week subscription ends
  subscriptionPaymentTxSignature: text("subscription_payment_tx_signature"), // SOL payment transaction signature for 0.15 SOL
  
  // Real-time Performance Metrics
  totalTrades: integer("total_trades").notNull().default(0), // Total completed trades
  winningTrades: integer("winning_trades").notNull().default(0), // Trades with profit > 0
  losingTrades: integer("losing_trades").notNull().default(0), // Trades with loss
  totalProfitSOL: decimal("total_profit_sol", { precision: 18, scale: 9 }).notNull().default("0"), // Cumulative realized profit
  totalLossSOL: decimal("total_loss_sol", { precision: 18, scale: 9 }).notNull().default("0"), // Cumulative realized loss
  netProfitSOL: decimal("net_profit_sol", { precision: 18, scale: 9 }).notNull().default("0"), // Total profit - total loss
  winRate: decimal("win_rate", { precision: 5, scale: 2 }).notNull().default("0"), // Percentage of winning trades (0-100)
  averageProfitPercent: decimal("average_profit_percent", { precision: 10, scale: 2 }).notNull().default("0"), // Average profit per winning trade
  averageLossPercent: decimal("average_loss_percent", { precision: 10, scale: 2 }).notNull().default("0"), // Average loss per losing trade
  roiPercent: decimal("roi_percent", { precision: 10, scale: 2 }).notNull().default("0"), // Return on investment (net profit / total invested * 100)
  bestTradePercent: decimal("best_trade_percent", { precision: 10, scale: 2 }).notNull().default("0"), // Best single trade profit %
  worstTradePercent: decimal("worst_trade_percent", { precision: 10, scale: 2 }).notNull().default("0"), // Worst single trade loss %
  averageHoldTimeMinutes: integer("average_hold_time_minutes").notNull().default(0), // Average position hold duration
  scalpTradeCount: integer("scalp_trade_count").notNull().default(0), // Count of SCALP trades
  swingTradeCount: integer("swing_trade_count").notNull().default(0), // Count of SWING trades
  lastPerformanceUpdateAt: timestamp("last_performance_update_at"), // When performance was last recalculated
  
  // Multi-Strategy Trading System (runs alongside AI-driven SCALP/SWING)
  // Strategy 1: Mean Reversion - Buy oversold, sell overbought
  meanReversionEnabled: boolean("mean_reversion_enabled").notNull().default(false),
  meanReversionRSIOversold: integer("mean_reversion_rsi_oversold").notNull().default(30), // Buy when RSI < this
  meanReversionRSIOverbought: integer("mean_reversion_rsi_overbought").notNull().default(70), // Sell when RSI > this
  meanReversionPositionSizePercent: integer("mean_reversion_position_size_percent").notNull().default(5), // % of portfolio per trade
  meanReversionProfitTargetPercent: integer("mean_reversion_profit_target_percent").notNull().default(10), // Take profit target
  meanReversionStopLossPercent: integer("mean_reversion_stop_loss_percent").notNull().default(8), // Stop loss
  meanReversionTradeCount: integer("mean_reversion_trade_count").notNull().default(0), // Track trades from this strategy
  
  // Strategy 2: Momentum Breakout - Catch explosive moves early
  momentumBreakoutEnabled: boolean("momentum_breakout_enabled").notNull().default(false),
  momentumBreakoutPriceChangePercent: integer("momentum_breakout_price_change_percent").notNull().default(15), // Min 1h price spike
  momentumBreakoutVolumeMultiplier: decimal("momentum_breakout_volume_multiplier", { precision: 5, scale: 2 }).notNull().default("2.0"), // Volume vs avg
  momentumBreakoutPositionSizePercent: integer("momentum_breakout_position_size_percent").notNull().default(7), // % of portfolio per trade
  momentumBreakoutProfitTargetPercent: integer("momentum_breakout_profit_target_percent").notNull().default(20), // Take profit target
  momentumBreakoutStopLossPercent: integer("momentum_breakout_stop_loss_percent").notNull().default(10), // Stop loss
  momentumBreakoutTradeCount: integer("momentum_breakout_trade_count").notNull().default(0), // Track trades from this strategy
  
  // Strategy 3: Grid Trading - Multiple entry/exit levels for ranging markets
  gridTradingEnabled: boolean("grid_trading_enabled").notNull().default(false),
  gridTradingLevels: integer("grid_trading_levels").notNull().default(5), // Number of price levels
  gridTradingPriceGapPercent: integer("grid_trading_price_gap_percent").notNull().default(5), // % gap between levels
  gridTradingPerLevelSizePercent: integer("grid_trading_per_level_size_percent").notNull().default(2), // % per level
  gridTradingTradeCount: integer("grid_trading_trade_count").notNull().default(0), // Track trades from this strategy
  
  // Status tracking
  lastBotRunAt: timestamp("last_bot_run_at"),
  lastBotStatus: text("last_bot_status"), // "success", "failed", "skipped"
  
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Active AI bot positions (trades that haven't been sold yet)
// 🔧 FIX #4: Added unique constraint to prevent duplicate positions at database level
export const aiBotPositions = pgTable("ai_bot_positions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  ownerWalletAddress: text("owner_wallet_address").notNull(),
  tokenMint: text("token_mint").notNull(),
  tokenSymbol: text("token_symbol"),
  tokenName: text("token_name"),
  tokenDecimals: integer("token_decimals").notNull().default(6), // Token decimal places (6 for PumpFun, 9 for most Solana tokens)
  entryPriceSOL: decimal("entry_price_sol", { precision: 18, scale: 9 }).notNull(),
  amountSOL: decimal("amount_sol", { precision: 18, scale: 9 }).notNull(),
  tokenAmount: decimal("token_amount", { precision: 30, scale: 9 }).notNull(), // Stored in RAW UNITS (needs division by 10^decimals)
  buyTxSignature: text("buy_tx_signature").notNull(),
  buyTimestamp: timestamp("buy_timestamp").notNull().defaultNow(),
  lastCheckTimestamp: timestamp("last_check_timestamp").notNull().defaultNow(),
  lastCheckPriceSOL: decimal("last_check_price_sol", { precision: 18, scale: 9 }),
  lastCheckProfitPercent: decimal("last_check_profit_percent", { precision: 10, scale: 2 }),
  peakProfitPercent: decimal("peak_profit_percent", { precision: 10, scale: 2 }).notNull().default("0"), // Track highest profit achieved (for profit-hunting strategy)
  aiConfidenceAtBuy: integer("ai_confidence_at_buy"),
  aiPotentialAtBuy: decimal("ai_potential_at_buy", { precision: 10, scale: 2 }),
  rebuyCount: integer("rebuy_count").notNull().default(0), // Track number of times we've added to this position (max 2)
  isSwingTrade: integer("is_swing_trade").notNull().default(0), // 1 = swing trade (high confidence 85%+), 0 = regular trade
  strategyType: text("strategy_type").notNull().default("AI_DRIVEN"), // "AI_DRIVEN", "MEAN_REVERSION", "MOMENTUM_BREAKOUT", "GRID_TRADING"
  strategyProfitTarget: decimal("strategy_profit_target", { precision: 10, scale: 2 }), // Profit target % for this specific strategy
  strategyStopLoss: decimal("strategy_stop_loss", { precision: 10, scale: 2 }), // Stop loss % for this specific strategy
  
  // Confidence Hysteresis System (prevents premature exits from temporary confidence dips)
  lowConfidenceSampleCount: integer("low_confidence_sample_count").notNull().default(0), // Number of consecutive checks with low AI confidence
  lastSellSignalAt: timestamp("last_sell_signal_at"), // Track when AI last recommended selling (prevent rapid flip-flopping)
  
  // Trailing Stop-Loss (arms after securing profit to protect gains)
  trailingStopPriceSOL: decimal("trailing_stop_price_sol", { precision: 18, scale: 9 }), // Trailing stop price (only set after profit secured)
  trailingStopArmed: integer("trailing_stop_armed").notNull().default(0), // 1 = armed after 1.5%+ profit, 0 = not armed yet
  
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  // Unique constraint to prevent duplicate positions for the same token (atomic safeguard against race conditions)
  ownerTokenUnique: uniqueIndex("ai_bot_positions_owner_token_unique").on(table.ownerWalletAddress, table.tokenMint),
}));

// Hivemind strategy recommendations (AI-tailored strategies between deep scans)
export const hivemindStrategies = pgTable("hivemind_strategies", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  ownerWalletAddress: text("owner_wallet_address").notNull(),
  
  // Market assessment from hivemind
  marketCondition: text("market_condition"), // "bullish", "bearish", "neutral", "volatile"
  marketConfidence: integer("market_confidence"), // 0-100, how confident the hivemind is in this assessment
  reasoning: text("reasoning"), // Why the hivemind chose this strategy
  
  // Recommended strategy adjustments
  recommendedRiskTolerance: text("recommended_risk_tolerance"), // "low", "medium", "high"
  recommendedMinConfidence: integer("recommended_min_confidence"), // 0-100
  recommendedMinPotential: decimal("recommended_min_potential", { precision: 10, scale: 2 }), // Min upside %
  recommendedMaxMarketCap: decimal("recommended_max_market_cap", { precision: 18, scale: 2 }), // Focus on tokens below this
  recommendedMinLiquidity: decimal("recommended_min_liquidity", { precision: 18, scale: 2 }), // Min liquidity USD
  recommendedTradeMultiplier: decimal("recommended_trade_multiplier", { precision: 5, scale: 2 }), // 0.5-2.0x base trade size
  
  // Complete trading parameters (all controlled by hivemind)
  budgetPerTrade: decimal("budget_per_trade", { precision: 10, scale: 4 }), // SOL per trade
  minVolumeUSD: decimal("min_volume_usd", { precision: 18, scale: 2 }), // Min 24h volume
  minLiquidityUSD: decimal("min_liquidity_usd", { precision: 18, scale: 2 }), // Min pool liquidity
  minOrganicScore: integer("min_organic_score"), // 0-100
  minQualityScore: integer("min_quality_score"), // 0-100
  minTransactions24h: integer("min_transactions_24h"), // Min txn count
  minPotentialPercent: decimal("min_potential_percent", { precision: 10, scale: 2 }), // Min upside %
  maxDailyTrades: integer("max_daily_trades"), // Max trades per day
  profitTargetMultiplier: decimal("profit_target_multiplier", { precision: 5, scale: 2 }), // Take profit multiplier
  
  // Token category focus
  focusCategories: text("focus_categories"), // JSON array: ["very_low_cap", "new_launches", "trending", "recovery_plays"]
  
  // Validity
  validFrom: timestamp("valid_from").notNull().defaultNow(),
  validUntil: timestamp("valid_until").notNull(), // Expires after 30 minutes (next deep scan)
  isActive: boolean("is_active").notNull().default(true),
  
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// Encrypted private key storage for automated buybacks
export const projectSecrets = pgTable("project_secrets", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id").notNull().unique().references(() => projects.id),
  
  // Treasury wallet encrypted key
  treasuryKeyCiphertext: text("treasury_key_ciphertext"),
  treasuryKeyIv: text("treasury_key_iv"),
  treasuryKeyAuthTag: text("treasury_key_auth_tag"),
  treasuryKeyFingerprint: text("treasury_key_fingerprint"), // HMAC for change detection
  
  // PumpFun creator wallet encrypted key (optional)
  pumpfunKeyCiphertext: text("pumpfun_key_ciphertext"),
  pumpfunKeyIv: text("pumpfun_key_iv"),
  pumpfunKeyAuthTag: text("pumpfun_key_auth_tag"),
  pumpfunKeyFingerprint: text("pumpfun_key_fingerprint"),
  
  lastRotatedAt: timestamp("last_rotated_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const projectsRelations = relations(projects, ({ many }) => ({
  transactions: many(transactions),
  payments: many(payments),
  usedSignatures: many(usedSignatures),
}));

export const transactionsRelations = relations(transactions, ({ one }) => ({
  project: one(projects, {
    fields: [transactions.projectId],
    references: [projects.id],
  }),
}));

export const paymentsRelations = relations(payments, ({ one }) => ({
  project: one(projects, {
    fields: [payments.projectId],
    references: [projects.id],
  }),
}));

export const usedSignaturesRelations = relations(usedSignatures, ({ one }) => ({
  project: one(projects, {
    fields: [usedSignatures.projectId],
    references: [projects.id],
  }),
}));

export const projectSecretsRelations = relations(projectSecrets, ({ one }) => ({
  project: one(projects, {
    fields: [projectSecrets.projectId],
    references: [projects.id],
  }),
}));

// Token blacklist - prevents AI bot from trading specific tokens
export const tokenBlacklist = pgTable("token_blacklist", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tokenMint: text("token_mint").notNull().unique(), // Token address to blacklist
  tokenSymbol: text("token_symbol"), // Optional symbol for reference
  tokenName: text("token_name"), // Optional name for reference
  reason: text("reason"), // Why this token was blacklisted (bundle_activity, rug_pull, scam, poor_performance, manual)
  severity: text("severity").notNull().default("warning"), // "warning" or "critical"
  addedBy: text("added_by").notNull(), // Wallet address of who added it, or "system" for auto-detected
  notes: text("notes"), // Additional details about why token was flagged
  
  // Bundle activity detection metadata
  bundleDetectionScore: integer("bundle_detection_score"), // 0-100 score indicating likelihood of bundle activity
  suspiciousWalletCount: integer("suspicious_wallet_count"), // Number of suspicious coordinated wallets detected
  avgTimeBetweenTxs: integer("avg_time_between_txs_ms"), // Average milliseconds between coordinated transactions
  
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// Trade Journal - tracks all trades with outcomes, patterns, and insights
export const tradeJournal = pgTable("trade_journal", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  ownerWalletAddress: text("owner_wallet_address").notNull(), // Trader who made this trade
  
  // Trade identification
  buyTxSignature: text("buy_tx_signature").notNull(), // Link to buy transaction
  sellTxSignature: text("sell_tx_signature"), // Link to sell transaction (null if position still open)
  
  // Token information
  tokenMint: text("token_mint").notNull(),
  tokenSymbol: text("token_symbol").notNull(),
  tokenName: text("token_name"),
  
  // Trade execution
  tradeMode: text("trade_mode").notNull(), // "SCALP" or "SWING"
  entryPriceSOL: decimal("entry_price_sol", { precision: 18, scale: 9 }).notNull(),
  exitPriceSOL: decimal("exit_price_sol", { precision: 18, scale: 9 }), // Null if still open
  amountSOL: decimal("amount_sol", { precision: 18, scale: 9 }).notNull(),
  tokenAmount: decimal("token_amount", { precision: 30, scale: 9 }).notNull(),
  
  // Performance
  profitLossSOL: decimal("profit_loss_sol", { precision: 18, scale: 9 }), // Actual profit/loss in SOL
  profitLossPercent: decimal("profit_loss_percent", { precision: 10, scale: 2 }), // Percentage return
  holdDurationMinutes: integer("hold_duration_minutes"), // How long position was held
  
  // AI Decision Making
  aiConfidenceAtBuy: decimal("ai_confidence_at_buy", { precision: 5, scale: 2 }).notNull(), // AI confidence when buying (0-100)
  aiConfidenceAtSell: decimal("ai_confidence_at_sell", { precision: 5, scale: 2 }), // AI confidence when selling
  potentialUpsideAtBuy: decimal("potential_upside_at_buy", { precision: 10, scale: 2 }), // AI's projected upside % at entry
  
  // Market Conditions at Entry
  organicScoreAtBuy: integer("organic_score_at_buy"), // 0-100
  qualityScoreAtBuy: integer("quality_score_at_buy"), // 0-100
  liquidityUSDAtBuy: decimal("liquidity_usd_at_buy", { precision: 18, scale: 2 }),
  volumeUSD24hAtBuy: decimal("volume_usd_24h_at_buy", { precision: 18, scale: 2 }),
  
  // Exit Analysis
  exitReason: text("exit_reason").notNull(), // "profit_target", "stop_loss", "ai_sell", "timeout", "manual", "trailing_stop"
  wasSuccessful: boolean("was_successful").notNull(), // Did we make money?
  metProfitTarget: boolean("met_profit_target"), // Did we hit our profit target?
  hitStopLoss: boolean("hit_stop_loss"), // Did we hit stop-loss?
  
  // Pattern Detection & Learning
  failureReason: text("failure_reason"), // Why this trade failed (if it did)
  tokenCharacteristics: text("token_characteristics"), // JSON: Notable patterns about this token
  marketCondition: text("market_condition"), // "bullish", "bearish", "neutral", "volatile" at time of trade
  lessonsLearned: text("lessons_learned"), // What can we learn from this trade?
  
  // Timestamps
  entryAt: timestamp("entry_at").notNull(),
  exitAt: timestamp("exit_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  // Index for fast lookup during sell execution
  index("trade_journal_buy_tx_idx").on(table.buyTxSignature),
]);

// AI System Recovery Mode Configuration - Global singleton table
export const aiRecoveryMode = pgTable("ai_recovery_mode", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  enabled: boolean("enabled").notNull().default(false),
  startedAt: timestamp("started_at"),
  endsAt: timestamp("ends_at"),
  recoveryProvider: text("recovery_provider").notNull().default("xAI Grok"), // Which single model to use during recovery
  reason: text("reason"), // Why recovery mode was activated
  activatedBy: text("activated_by"), // Wallet address that activated it
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// No relations for aiBotConfigs, tokenBlacklist, tradeJournal, or aiRecoveryMode - all are standalone

export const insertProjectSchema = createInsertSchema(projects).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
}).extend({
  tokenMintAddress: z.string().min(32, "Invalid Solana address"),
  treasuryWalletAddress: z.string().min(32, "Invalid Solana address"),
  burnAddress: z.string().min(32, "Invalid Solana address"),
  ownerWalletAddress: z.string().min(32, "Invalid Solana address"),
  buybackAmountSol: z.string().optional(),
  pumpfunCreatorWallet: z.string().min(32, "Invalid Solana address").optional(),
  
  // Volume bot validations
  volumeBotBuyAmountSOL: z.string().optional(),
  volumeBotSellPercentage: z.string().optional(),
  volumeBotMinPriceSOL: z.string().optional(),
  volumeBotMaxPriceSOL: z.string().optional(),
  volumeBotIntervalMinutes: z.number().min(1).max(1440).optional(),
  
  // Buy bot validations
  buyBotLimitOrders: z.string().optional(), // JSON string
  buyBotMaxSlippage: z.string().optional(),
  
  // AI bot validations
  aiBotBudgetPerTrade: z.string().optional(),
  aiBotAnalysisInterval: z.number().min(5).max(1440).optional(), // 5 min to 24 hours
  aiBotMinVolumeUSD: z.string().optional(),
  aiBotMinPotentialPercent: z.string().optional(),
  aiBotMaxDailyTrades: z.number().min(1).max(100).optional(),
  aiBotRiskTolerance: z.enum(["low", "medium", "high"]).optional(),
});

export const insertTransactionSchema = createInsertSchema(transactions).omit({
  id: true,
  createdAt: true,
});

export const insertPaymentSchema = createInsertSchema(payments).omit({
  id: true,
  createdAt: true,
});

export const insertUsedSignatureSchema = createInsertSchema(usedSignatures).omit({
  id: true,
  createdAt: true,
});

export const insertProjectSecretSchema = createInsertSchema(projectSecrets).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  lastRotatedAt: true,
});

// Input schema for setting/updating keys (accepts plaintext, stored encrypted)
export const setProjectKeysSchema = z.object({
  treasuryPrivateKey: z.string()
    .min(1, "Treasury private key is required")
    .transform(val => val.trim()),
  pumpfunPrivateKey: z.string()
    .optional()
    .transform(val => val ? val.trim() : val),
});

// AI Bot Config schema
export const insertAIBotConfigSchema = createInsertSchema(aiBotConfigs).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
}).extend({
  totalBudget: z.string().min(0, "Total budget must be positive"),
  budgetPerTrade: z.string().min(0, "Budget per trade must be positive"),
  analysisInterval: z.number().min(5).max(1440), // 5 min to 24 hours
  minVolumeUSD: z.string().min(0, "Minimum volume must be positive"),
  minPotentialPercent: z.string().min(0, "Minimum potential must be positive"),
  maxDailyTrades: z.number().min(1).max(100),
  riskTolerance: z.enum(["low", "medium", "high"]),
  minAiSellConfidence: z.number().min(0).max(100).optional(),
  holdIfHighConfidence: z.number().min(0).max(100).optional(),
}).refine(
  (data) => {
    // Ensure hold threshold > sell threshold to avoid conflicts
    if (data.minAiSellConfidence !== undefined && data.holdIfHighConfidence !== undefined) {
      return data.holdIfHighConfidence > data.minAiSellConfidence;
    }
    return true;
  },
  {
    message: "Hold threshold (holdIfHighConfidence) must be greater than sell threshold (minAiSellConfidence)",
  }
);

export type Project = typeof projects.$inferSelect;
export type InsertProject = z.infer<typeof insertProjectSchema>;
export type Transaction = typeof transactions.$inferSelect;
export type InsertTransaction = z.infer<typeof insertTransactionSchema>;
export type Payment = typeof payments.$inferSelect;
export type InsertPayment = z.infer<typeof insertPaymentSchema>;
export type UsedSignature = typeof usedSignatures.$inferSelect;
export type SelectTradeJournal = typeof tradeJournal.$inferSelect;
export type InsertUsedSignature = z.infer<typeof insertUsedSignatureSchema>;
export type ProjectSecret = typeof projectSecrets.$inferSelect;
export type InsertProjectSecret = z.infer<typeof insertProjectSecretSchema>;
export type SetProjectKeys = z.infer<typeof setProjectKeysSchema>;
export type AIBotConfig = typeof aiBotConfigs.$inferSelect;
export type InsertAIBotConfig = z.infer<typeof insertAIBotConfigSchema>;

export const insertAIBotPositionSchema = createInsertSchema(aiBotPositions).omit({
  id: true,
  createdAt: true,
  buyTimestamp: true,
  lastCheckTimestamp: true,
});

export type AIBotPosition = typeof aiBotPositions.$inferSelect;
export type InsertAIBotPosition = z.infer<typeof insertAIBotPositionSchema>;

export const insertHivemindStrategySchema = createInsertSchema(hivemindStrategies).omit({
  id: true,
  createdAt: true,
  validFrom: true,
});

export type HivemindStrategy = typeof hivemindStrategies.$inferSelect;
export type InsertHivemindStrategy = z.infer<typeof insertHivemindStrategySchema>;

export const insertTokenBlacklistSchema = createInsertSchema(tokenBlacklist).omit({
  id: true,
  createdAt: true,
}).extend({
  tokenMint: z.string().min(32, "Invalid Solana token address"),
  addedBy: z.string().min(32, "Invalid wallet address"),
});

export type TokenBlacklist = typeof tokenBlacklist.$inferSelect;
export type InsertTokenBlacklist = z.infer<typeof insertTokenBlacklistSchema>;

export const insertTradeJournalSchema = createInsertSchema(tradeJournal).omit({
  id: true,
  createdAt: true,
});

export type TradeJournal = typeof tradeJournal.$inferSelect;
export type InsertTradeJournal = z.infer<typeof insertTradeJournalSchema>;

export const insertAIRecoveryModeSchema = createInsertSchema(aiRecoveryMode).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type AIRecoveryMode = typeof aiRecoveryMode.$inferSelect;
export type InsertAIRecoveryMode = z.infer<typeof insertAIRecoveryModeSchema>;
