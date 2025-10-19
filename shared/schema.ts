import { sql } from "drizzle-orm";
import { pgTable, text, varchar, timestamp, decimal, integer, boolean } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const projects = pgTable("projects", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  tokenMintAddress: text("token_mint_address").notNull(),
  treasuryWalletAddress: text("treasury_wallet_address").notNull(),
  burnAddress: text("burn_address").notNull(),
  schedule: text("schedule").notNull(), // hourly, daily, weekly, custom
  customCronExpression: text("custom_cron_expression"),
  buybackAmountSol: decimal("buyback_amount_sol", { precision: 18, scale: 9 }),
  isActive: boolean("is_active").notNull().default(false),
  ownerWalletAddress: text("owner_wallet_address").notNull(),
  isPumpfunToken: boolean("is_pumpfun_token").notNull().default(false),
  pumpfunCreatorWallet: text("pumpfun_creator_wallet"), // Wallet to claim PumpFun rewards
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const transactions = pgTable("transactions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id").notNull().references(() => projects.id),
  type: text("type").notNull(), // buyback, burn
  amount: decimal("amount", { precision: 18, scale: 9 }).notNull(),
  tokenAmount: decimal("token_amount", { precision: 18, scale: 9 }),
  txSignature: text("tx_signature").notNull(),
  status: text("status").notNull(), // pending, completed, failed
  errorMessage: text("error_message"),
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

export type Project = typeof projects.$inferSelect;
export type InsertProject = z.infer<typeof insertProjectSchema>;
export type Transaction = typeof transactions.$inferSelect;
export type InsertTransaction = z.infer<typeof insertTransactionSchema>;
export type Payment = typeof payments.$inferSelect;
export type InsertPayment = z.infer<typeof insertPaymentSchema>;
export type UsedSignature = typeof usedSignatures.$inferSelect;
export type InsertUsedSignature = z.infer<typeof insertUsedSignatureSchema>;
