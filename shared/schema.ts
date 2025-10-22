import { sql } from "drizzle-orm";
import { pgTable, text, varchar, timestamp, decimal, integer, boolean } from "drizzle-orm/pg-core";
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
  projectId: varchar("project_id").notNull().references(() => projects.id),
  type: text("type").notNull(), // claim, buyback, burn, volume_buy, volume_sell, limit_buy, ai_buy, ai_sell
  amount: decimal("amount", { precision: 18, scale: 9 }).notNull(),
  tokenAmount: decimal("token_amount", { precision: 18, scale: 9 }),
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
  totalBudget: decimal("total_budget", { precision: 18, scale: 9 }).notNull().default("0"),
  budgetUsed: decimal("budget_used", { precision: 18, scale: 9 }).notNull().default("0"),
  budgetPerTrade: decimal("budget_per_trade", { precision: 18, scale: 9 }).notNull().default("0.1"),
  analysisInterval: integer("analysis_interval").notNull().default(60), // Minutes between scans
  minVolumeUSD: decimal("min_volume_usd", { precision: 18, scale: 2 }).notNull().default("5000"),
  minPotentialPercent: decimal("min_potential_percent", { precision: 18, scale: 2 }).notNull().default("150"),
  maxDailyTrades: integer("max_daily_trades").notNull().default(5),
  riskTolerance: text("risk_tolerance").notNull().default("medium"), // "low", "medium", "high"
  
  // Encrypted treasury key for AI bot trading
  treasuryKeyCiphertext: text("treasury_key_ciphertext"),
  treasuryKeyIv: text("treasury_key_iv"),
  treasuryKeyAuthTag: text("treasury_key_auth_tag"),
  treasuryKeyFingerprint: text("treasury_key_fingerprint"),
  
  // Status tracking
  lastBotRunAt: timestamp("last_bot_run_at"),
  lastBotStatus: text("last_bot_status"), // "success", "failed", "skipped"
  
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
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

// No relations for aiBotConfigs - it's standalone

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
  treasuryPrivateKey: z.string().min(1, "Treasury private key is required"),
  pumpfunPrivateKey: z.string().optional(),
});

export type Project = typeof projects.$inferSelect;
export type InsertProject = z.infer<typeof insertProjectSchema>;
export type Transaction = typeof transactions.$inferSelect;
export type InsertTransaction = z.infer<typeof insertTransactionSchema>;
export type Payment = typeof payments.$inferSelect;
export type InsertPayment = z.infer<typeof insertPaymentSchema>;
export type UsedSignature = typeof usedSignatures.$inferSelect;
export type InsertUsedSignature = z.infer<typeof insertUsedSignatureSchema>;
export type ProjectSecret = typeof projectSecrets.$inferSelect;
export type InsertProjectSecret = z.infer<typeof insertProjectSecretSchema>;
export type SetProjectKeys = z.infer<typeof setProjectKeysSchema>;
