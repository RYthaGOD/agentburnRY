import { sql } from "drizzle-orm";
import { pgTable, text, varchar, timestamp, decimal, integer, boolean } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Simplified Projects table (agent burn configuration only)
export const projects = pgTable("projects", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  tokenMintAddress: text("token_mint_address").notNull(),
  tokenDecimals: integer("token_decimals").notNull().default(9),
  treasuryWalletAddress: text("treasury_wallet_address").notNull(),
  burnAddress: text("burn_address").notNull(),
  ownerWalletAddress: text("owner_wallet_address").notNull(),
  
  // Agentic Burn Configuration
  agentBurnEnabled: boolean("agentic_burn_enabled").notNull().default(false),
  aiConfidenceThreshold: integer("ai_confidence_threshold").notNull().default(70), // 0-100
  maxBurnPercentage: decimal("max_burn_percentage", { precision: 5, scale: 2 }).notNull().default("5"), // Max % of supply per burn
  requirePositiveSentiment: boolean("require_positive_sentiment").notNull().default(true),
  burnServiceFeeUSD: decimal("burn_service_fee_usd", { precision: 18, scale: 6 }).notNull().default("0.005"), // x402 micropayment fee
  
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Transaction history for burns
export const transactions = pgTable("transactions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id").references(() => projects.id),
  type: text("type").notNull(), // "burn", "claim", "buyback"
  amount: decimal("amount", { precision: 18, scale: 9 }).notNull(),
  tokenAmount: decimal("token_amount", { precision: 30, scale: 9 }),
  txSignature: text("tx_signature").notNull(),
  status: text("status").notNull(), // "pending", "completed", "failed"
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// Encrypted private keys for automated burns
export const projectSecrets = pgTable("project_secrets", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id").notNull().unique().references(() => projects.id),
  treasuryKeyCiphertext: text("treasury_key_ciphertext"),
  treasuryKeyIv: text("treasury_key_iv"),
  treasuryKeyAuthTag: text("treasury_key_auth_tag"),
  treasuryKeyFingerprint: text("treasury_key_fingerprint"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// x402 Micropayment tracking table (CRITICAL FOR HACKATHON)
export const x402Micropayments = pgTable("x402_micropayments", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  ownerWalletAddress: text("owner_wallet_address").notNull(),
  
  // Payment details
  paymentType: text("payment_type").notNull(), // "burn_execution", "data_api", "ai_analysis"
  resourceUrl: text("resource_url").notNull(), // API endpoint that required payment
  amountUSDC: decimal("amount_usdc", { precision: 18, scale: 6 }).notNull(), // Amount in USDC (6 decimals)
  amountMicroUSDC: text("amount_micro_usdc").notNull(), // Raw micro-USDC amount as string
  
  // Transaction details
  txSignature: text("tx_signature").notNull(),
  network: text("network").notNull().default("solana-mainnet"), // "solana-devnet" or "solana-mainnet"
  status: text("status").notNull().default("pending"), // "pending", "confirmed", "failed"
  
  // x402 protocol metadata
  x402Version: integer("x402_version").notNull().default(1),
  paymentScheme: text("payment_scheme").notNull().default("exact"), // "exact" or "metered"
  facilitatorUrl: text("facilitator_url"),
  description: text("description"),
  
  createdAt: timestamp("created_at").notNull().defaultNow(),
  confirmedAt: timestamp("confirmed_at"),
});

// Jito BAM Bundle tracking table (CRITICAL FOR HACKATHON)
export const bamBundles = pgTable("bam_bundles", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  ownerWalletAddress: text("owner_wallet_address").notNull(),
  
  // Bundle details
  bundleId: text("bundle_id").notNull().unique(), // Jito bundle UUID
  bundleType: text("bundle_type").notNull(), // "trade_burn", "arbitrage", "liquidation"
  transactionCount: integer("transaction_count").notNull(), // Number of txs in bundle (max 5)
  txSignatures: text("tx_signatures").array().notNull(), // Array of transaction signatures
  
  // Bundle execution details
  status: text("status").notNull().default("pending"), // "pending", "landed", "failed", "rejected"
  slot: integer("slot"), // Solana slot where bundle landed
  blockTime: timestamp("block_time"), // When bundle was included in block
  
  // MEV protection stats
  tipAmountLamports: text("tip_amount_lamports").notNull(), // Tip paid to Jito (in lamports)
  tipAccountUsed: text("tip_account_used").notNull(), // Which tip account received the tip
  
  // Business context
  burnAmountTokens: decimal("burn_amount_tokens", { precision: 30, scale: 9 }), // Tokens burned in bundle
  
  // Performance metrics
  submittedAt: timestamp("submitted_at").notNull().defaultNow(),
  landedAt: timestamp("landed_at"),
  executionTimeMs: integer("execution_time_ms"), // Time from submit to land
  errorMessage: text("error_message"),
  
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// Agent Burn History (CRITICAL FOR HACKATHON - tracks AI-powered burn executions)
export const agentBurns = pgTable("agent_burns", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  ownerWalletAddress: text("owner_wallet_address").notNull(),
  
  // Burn parameters
  tokenMintAddress: text("token_mint_address").notNull(),
  burnAmountSOL: decimal("burn_amount_sol", { precision: 18, scale: 9 }).notNull(),
  tokensBurned: decimal("tokens_burned", { precision: 30, scale: 9 }),
  
  // AI Decision criteria (user-configurable)
  aiConfidenceThreshold: integer("ai_confidence_threshold").notNull().default(70), // % confidence required
  maxBurnPercentage: decimal("max_burn_percentage", { precision: 5, scale: 2 }).notNull().default("5"), // Max % of supply
  requirePositiveSentiment: boolean("require_positive_sentiment").notNull().default(true),
  
  // AI Decision results
  aiConfidence: integer("ai_confidence"), // Actual confidence from DeepSeek (0-100)
  aiReasoning: text("ai_reasoning"), // DeepSeek's analysis output
  aiApproved: boolean("ai_approved").notNull().default(false),
  
  // Switchboard Oracle data (accessed via x402)
  oracleSolPriceUSD: decimal("oracle_sol_price_usd", { precision: 18, scale: 6 }), // SOL price from oracle
  oracleTokenLiquidityUSD: decimal("oracle_token_liquidity_usd", { precision: 18, scale: 2 }), // Token liquidity
  oracleToken24hVolumeUSD: decimal("oracle_token_24h_volume_usd", { precision: 18, scale: 2 }), // 24h volume
  oracleFeedIds: text("oracle_feed_ids").array(), // Switchboard feed IDs used
  oracleX402CostUSD: decimal("oracle_x402_cost_usd", { precision: 10, scale: 6 }), // Cost to access oracle data
  
  // Step timing (in milliseconds) - showcases 5-step agent economy
  step0DurationMs: integer("step0_duration_ms"), // Switchboard oracle data fetch
  step1DurationMs: integer("step1_duration_ms"), // DeepSeek AI analysis
  step2DurationMs: integer("step2_duration_ms"), // x402 micropayment (burn service)
  step3DurationMs: integer("step3_duration_ms"), // Jupiter swap
  step4DurationMs: integer("step4_duration_ms"), // Jito BAM bundle
  totalDurationMs: integer("total_duration_ms"),
  
  // Related records
  paymentId: varchar("payment_id"), // Link to x402_micropayments table
  bundleId: varchar("bundle_id"), // Link to bam_bundles table
  
  // Execution status
  status: text("status").notNull().default("pending"), // "pending", "completed", "failed"
  currentStep: integer("current_step").notNull().default(0), // Which step (0-5)
  errorMessage: text("error_message"),
  errorStep: integer("error_step"), // Which step failed (0-5)
  
  createdAt: timestamp("created_at").notNull().defaultNow(),
  completedAt: timestamp("completed_at"),
});

// Relations
export const projectsRelations = relations(projects, ({ many }) => ({
  transactions: many(transactions),
}));

export const transactionsRelations = relations(transactions, ({ one }) => ({
  project: one(projects, {
    fields: [transactions.projectId],
    references: [projects.id],
  }),
}));

export const projectSecretsRelations = relations(projectSecrets, ({ one }) => ({
  project: one(projects, {
    fields: [projectSecrets.projectId],
    references: [projects.id],
  }),
}));

// Zod schemas for validation
export const insertProjectSchema = createInsertSchema(projects).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
}).extend({
  tokenMintAddress: z.string().min(32, "Invalid Solana token address"),
  treasuryWalletAddress: z.string().min(32, "Invalid Solana wallet address"),
  ownerWalletAddress: z.string().min(32, "Invalid Solana wallet address"),
  aiConfidenceThreshold: z.number().min(0).max(100),
  maxBurnPercentage: z.string().refine(val => parseFloat(val) >= 0 && parseFloat(val) <= 100, "Max burn percentage must be between 0 and 100"),
});

export type Project = typeof projects.$inferSelect;
export type InsertProject = z.infer<typeof insertProjectSchema>;

export const insertTransactionSchema = createInsertSchema(transactions).omit({
  id: true,
  createdAt: true,
});

export type Transaction = typeof transactions.$inferSelect;
export type InsertTransaction = z.infer<typeof insertTransactionSchema>;

export const insertProjectSecretSchema = createInsertSchema(projectSecrets).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type ProjectSecret = typeof projectSecrets.$inferSelect;
export type InsertProjectSecret = z.infer<typeof insertProjectSecretSchema>;

export const insertX402MicropaymentSchema = createInsertSchema(x402Micropayments).omit({
  id: true,
  createdAt: true,
});

export type X402Micropayment = typeof x402Micropayments.$inferSelect;
export type InsertX402Micropayment = z.infer<typeof insertX402MicropaymentSchema>;

export const insertBamBundleSchema = createInsertSchema(bamBundles).omit({
  id: true,
  createdAt: true,
});

export type BamBundle = typeof bamBundles.$inferSelect;
export type InsertBamBundle = z.infer<typeof insertBamBundleSchema>;

export const insertAgentBurnSchema = createInsertSchema(agentBurns).omit({
  id: true,
  createdAt: true,
});

export type AgentBurn = typeof agentBurns.$inferSelect;
export type InsertAgentBurn = z.infer<typeof insertAgentBurnSchema>;
