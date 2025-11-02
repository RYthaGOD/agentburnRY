import {
  projects,
  transactions,
  payments,
  usedSignatures,
  projectSecrets,
  aiBotConfigs,
  aiBotPositions,
  hivemindStrategies,
  tokenBlacklist,
  tradeJournal,
  aiRecoveryMode,
  x402Micropayments,
  bamBundles,
  type Project,
  type InsertProject,
  type Transaction,
  type InsertTransaction,
  type Payment,
  type InsertPayment,
  type UsedSignature,
  type InsertUsedSignature,
  type ProjectSecret,
  type InsertProjectSecret,
  type AIBotConfig,
  type InsertAIBotConfig,
  type AIBotPosition,
  type InsertAIBotPosition,
  type HivemindStrategy,
  type InsertHivemindStrategy,
  type TokenBlacklist,
  type InsertTokenBlacklist,
  type TradeJournal,
  type InsertTradeJournal,
  type AIRecoveryMode,
  type InsertAIRecoveryMode,
  type X402Micropayment,
  type InsertX402Micropayment,
  type BamBundle,
  type InsertBamBundle,
} from "@shared/schema";
import { db } from "./db";
import { eq, desc } from "drizzle-orm";

export interface IStorage {
  // Project operations
  getProject(id: string): Promise<Project | undefined>;
  getProjectsByOwner(ownerWalletAddress: string): Promise<Project[]>;
  getAllProjects(): Promise<Project[]>;
  createProject(project: InsertProject): Promise<Project>;
  updateProject(id: string, project: Partial<InsertProject>): Promise<Project | undefined>;
  deleteProject(id: string): Promise<boolean>;

  // Transaction operations
  getTransaction(id: string): Promise<Transaction | undefined>;
  getTransactionsByProject(projectId: string): Promise<Transaction[]>;
  getAllTransactions(): Promise<Transaction[]>;
  getRecentTransactions(limit: number): Promise<Transaction[]>;
  createTransaction(transaction: InsertTransaction): Promise<Transaction>;
  updateTransaction(txSignature: string, updates: Partial<InsertTransaction>): Promise<Transaction | undefined>;

  // Payment operations
  getPayment(id: string): Promise<Payment | undefined>;
  getPaymentsByProject(projectId: string): Promise<Payment[]>;
  createPayment(payment: InsertPayment): Promise<Payment>;
  verifyPayment(id: string): Promise<Payment | undefined>;

  // Used signature operations (for replay attack prevention)
  isSignatureUsed(signatureHash: string): Promise<boolean>;
  recordUsedSignature(signature: InsertUsedSignature): Promise<UsedSignature>;

  // Project secrets operations (encrypted private keys)
  getProjectSecrets(projectId: string): Promise<ProjectSecret | undefined>;
  setProjectSecrets(secrets: InsertProjectSecret): Promise<ProjectSecret>;
  updateProjectSecrets(projectId: string, secrets: Partial<InsertProjectSecret>): Promise<ProjectSecret | undefined>;
  deleteProjectSecrets(projectId: string): Promise<boolean>;

  // AI Bot Config operations (standalone, not tied to projects)
  getAIBotConfig(ownerWalletAddress: string): Promise<AIBotConfig | undefined>;
  getAllAIBotConfigs(): Promise<AIBotConfig[]>;
  createOrUpdateAIBotConfig(config: Partial<InsertAIBotConfig> & { ownerWalletAddress: string }): Promise<AIBotConfig>;
  deleteAIBotConfig(ownerWalletAddress: string): Promise<boolean>;
  
  // AI Bot Subscription operations
  updateAIBotSubscription(ownerWalletAddress: string, updates: {
    subscriptionActive: boolean;
    subscriptionExpiresAt: Date;
    subscriptionPaymentTxSignature: string;
  }): Promise<AIBotConfig>;
  incrementFreeTradesUsed(ownerWalletAddress: string): Promise<AIBotConfig>;

  // AI Bot Position operations (active trades)
  getAIBotPositions(ownerWalletAddress: string): Promise<AIBotPosition[]>;
  getAIBotPosition(id: string): Promise<AIBotPosition | undefined>;
  createAIBotPosition(position: InsertAIBotPosition): Promise<AIBotPosition>;
  updateAIBotPosition(id: string, updates: Partial<InsertAIBotPosition>): Promise<AIBotPosition | undefined>;
  deleteAIBotPosition(id: string): Promise<boolean>;

  // Hivemind Strategy operations
  getHivemindStrategies(ownerWalletAddress: string): Promise<HivemindStrategy[]>;
  createHivemindStrategy(strategy: InsertHivemindStrategy): Promise<HivemindStrategy>;

  // Token Blacklist operations
  getAllBlacklistedTokens(): Promise<TokenBlacklist[]>;
  isTokenBlacklisted(tokenMint: string): Promise<boolean>;
  addTokenToBlacklist(blacklistEntry: InsertTokenBlacklist): Promise<TokenBlacklist>;
  removeTokenFromBlacklist(tokenMint: string): Promise<boolean>;

  // Trade Journal operations (learning from trades)
  getTradeJournalEntries(ownerWalletAddress: string, limit?: number): Promise<TradeJournal[]>;
  createTradeJournalEntry(entry: InsertTradeJournal): Promise<TradeJournal>;
  updateTradeJournalEntry(id: string, updates: Partial<InsertTradeJournal>): Promise<TradeJournal | undefined>;
  getTradePatterns(ownerWalletAddress: string): Promise<{
    winRate: number;
    avgProfit: number;
    totalTrades: number;
    commonFailureReasons: { reason: string; count: number }[];
    bestTokenCharacteristics: any[];
  }>;

  // Recovery Mode operations (AI system recovery)
  activateRecoveryMode(config: {
    enabled: boolean;
    startedAt: Date;
    endsAt: Date;
    recoveryProvider: string;
    reason: string;
    activatedBy: string;
  }): Promise<any>;
  getRecoveryModeStatus(): Promise<any | undefined>;
  deactivateRecoveryMode(): Promise<void>;

  // Public stats (no authentication required)
  getPublicStats(): Promise<{
    totalTrades: number;
    winRate: string;
    avgROI: string;
    totalProfit: string;
    activeUsers: number;
    avgHoldTime: number;
    bestTrade: string;
    last24hTrades: number;
    scalpTrades: number;
    swingTrades: number;
  }>;

  // x402 Micropayment operations
  getAllMicropayments(): Promise<X402Micropayment[]>;
  createMicropayment(payment: InsertX402Micropayment): Promise<X402Micropayment>;

  // BAM Bundle operations
  getAllBamBundles(): Promise<BamBundle[]>;
  createBamBundle(bundle: InsertBamBundle): Promise<BamBundle>;
  updateBamBundleStatus(bundleId: string, updates: Partial<InsertBamBundle>): Promise<BamBundle | undefined>;
}

export class DatabaseStorage implements IStorage {
  // Project operations
  async getProject(id: string): Promise<Project | undefined> {
    const [project] = await db.select().from(projects).where(eq(projects.id, id));
    return project || undefined;
  }

  async getProjectsByOwner(ownerWalletAddress: string): Promise<Project[]> {
    return db
      .select()
      .from(projects)
      .where(eq(projects.ownerWalletAddress, ownerWalletAddress))
      .orderBy(desc(projects.createdAt));
  }

  async getAllProjects(): Promise<Project[]> {
    return db.select().from(projects).orderBy(desc(projects.createdAt));
  }

  async createProject(insertProject: InsertProject): Promise<Project> {
    // Check if this is one of the first 100 signups for automatic trial
    const totalProjects = await db.select().from(projects);
    const projectCount = totalProjects.length;
    
    // Grant 10-day trial to first 100 signups
    let trialEndsAt = insertProject.trialEndsAt;
    if (projectCount < 100 && !trialEndsAt) {
      const tenDaysFromNow = new Date();
      tenDaysFromNow.setDate(tenDaysFromNow.getDate() + 10);
      trialEndsAt = tenDaysFromNow;
    }
    
    const [project] = await db
      .insert(projects)
      .values({ ...insertProject, trialEndsAt })
      .returning();
    return project;
  }

  async updateProject(id: string, updates: Partial<InsertProject>): Promise<Project | undefined> {
    const [project] = await db
      .update(projects)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(projects.id, id))
      .returning();
    return project || undefined;
  }

  async deleteProject(id: string): Promise<boolean> {
    // Delete all related records first to avoid foreign key constraint violations
    // Order matters: delete in reverse dependency order
    
    // 1. Delete project secrets (encrypted keys)
    await db.delete(projectSecrets).where(eq(projectSecrets.projectId, id));
    
    // 2. Delete used signatures (replay attack prevention)
    await db.delete(usedSignatures).where(eq(usedSignatures.projectId, id));
    
    // 3. Delete all transactions
    await db.delete(transactions).where(eq(transactions.projectId, id));
    
    // 4. Delete all payments
    await db.delete(payments).where(eq(payments.projectId, id));
    
    // 5. Finally delete the project itself
    const result = await db.delete(projects).where(eq(projects.id, id));
    return result.rowCount ? result.rowCount > 0 : false;
  }

  // Transaction operations
  async getTransaction(id: string): Promise<Transaction | undefined> {
    const [transaction] = await db
      .select()
      .from(transactions)
      .where(eq(transactions.id, id));
    return transaction || undefined;
  }

  async getTransactionsByProject(projectId: string): Promise<Transaction[]> {
    return db
      .select()
      .from(transactions)
      .where(eq(transactions.projectId, projectId))
      .orderBy(desc(transactions.createdAt));
  }

  async getAllTransactions(): Promise<Transaction[]> {
    return db
      .select()
      .from(transactions)
      .orderBy(desc(transactions.createdAt));
  }

  async getRecentTransactions(limit: number): Promise<Transaction[]> {
    return db
      .select()
      .from(transactions)
      .orderBy(desc(transactions.createdAt))
      .limit(limit);
  }

  async createTransaction(insertTransaction: InsertTransaction): Promise<Transaction> {
    const [transaction] = await db
      .insert(transactions)
      .values(insertTransaction)
      .returning();
    return transaction;
  }

  async updateTransaction(txSignature: string, updates: Partial<InsertTransaction>): Promise<Transaction | undefined> {
    const [transaction] = await db
      .update(transactions)
      .set(updates)
      .where(eq(transactions.txSignature, txSignature))
      .returning();
    return transaction || undefined;
  }

  // Payment operations
  async getPayment(id: string): Promise<Payment | undefined> {
    const [payment] = await db
      .select()
      .from(payments)
      .where(eq(payments.id, id));
    return payment || undefined;
  }

  async getPaymentsByProject(projectId: string): Promise<Payment[]> {
    return db
      .select()
      .from(payments)
      .where(eq(payments.projectId, projectId))
      .orderBy(desc(payments.createdAt));
  }

  async createPayment(insertPayment: InsertPayment): Promise<Payment> {
    const [payment] = await db
      .insert(payments)
      .values(insertPayment)
      .returning();
    return payment;
  }

  async verifyPayment(id: string): Promise<Payment | undefined> {
    const [payment] = await db
      .update(payments)
      .set({ verified: true })
      .where(eq(payments.id, id))
      .returning();
    return payment || undefined;
  }

  // Used signature operations (for replay attack prevention)
  async isSignatureUsed(signatureHash: string): Promise<boolean> {
    const [signature] = await db
      .select()
      .from(usedSignatures)
      .where(eq(usedSignatures.signatureHash, signatureHash));
    return !!signature;
  }

  async recordUsedSignature(insertSignature: InsertUsedSignature): Promise<UsedSignature> {
    const [signature] = await db
      .insert(usedSignatures)
      .values(insertSignature)
      .returning();
    return signature;
  }

  // Project secrets operations (encrypted private keys)
  async getProjectSecrets(projectId: string): Promise<ProjectSecret | undefined> {
    const [secrets] = await db
      .select()
      .from(projectSecrets)
      .where(eq(projectSecrets.projectId, projectId));
    return secrets || undefined;
  }

  async setProjectSecrets(insertSecrets: InsertProjectSecret): Promise<ProjectSecret> {
    // Use upsert pattern: try insert, if exists, update
    const existing = await this.getProjectSecrets(insertSecrets.projectId);
    
    if (existing) {
      const [updated] = await db
        .update(projectSecrets)
        .set({ ...insertSecrets, updatedAt: new Date() })
        .where(eq(projectSecrets.projectId, insertSecrets.projectId))
        .returning();
      return updated;
    } else {
      const [created] = await db
        .insert(projectSecrets)
        .values(insertSecrets)
        .returning();
      return created;
    }
  }

  async updateProjectSecrets(projectId: string, updates: Partial<InsertProjectSecret>): Promise<ProjectSecret | undefined> {
    const [secrets] = await db
      .update(projectSecrets)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(projectSecrets.projectId, projectId))
      .returning();
    return secrets || undefined;
  }

  async deleteProjectSecrets(projectId: string): Promise<boolean> {
    const result = await db
      .delete(projectSecrets)
      .where(eq(projectSecrets.projectId, projectId));
    return result.rowCount ? result.rowCount > 0 : false;
  }

  // AI Bot Config operations
  async getAIBotConfig(ownerWalletAddress: string): Promise<AIBotConfig | undefined> {
    const [config] = await db
      .select()
      .from(aiBotConfigs)
      .where(eq(aiBotConfigs.ownerWalletAddress, ownerWalletAddress));
    return config || undefined;
  }

  async getAllAIBotConfigs(): Promise<AIBotConfig[]> {
    const configs = await db.select().from(aiBotConfigs);
    return configs;
  }

  async createOrUpdateAIBotConfig(
    config: Partial<InsertAIBotConfig> & { ownerWalletAddress: string }
  ): Promise<AIBotConfig> {
    // Check if config exists for this wallet
    const existing = await this.getAIBotConfig(config.ownerWalletAddress);

    if (existing) {
      // Update existing config
      const [updated] = await db
        .update(aiBotConfigs)
        .set({ ...config, updatedAt: new Date() })
        .where(eq(aiBotConfigs.ownerWalletAddress, config.ownerWalletAddress))
        .returning();
      return updated;
    } else {
      // Create new config
      const [created] = await db
        .insert(aiBotConfigs)
        .values(config as InsertAIBotConfig)
        .returning();
      return created;
    }
  }

  async deleteAIBotConfig(ownerWalletAddress: string): Promise<boolean> {
    const result = await db
      .delete(aiBotConfigs)
      .where(eq(aiBotConfigs.ownerWalletAddress, ownerWalletAddress));
    return result.rowCount ? result.rowCount > 0 : false;
  }

  async updateAIBotSubscription(ownerWalletAddress: string, updates: {
    subscriptionActive: boolean;
    subscriptionExpiresAt: Date;
    subscriptionPaymentTxSignature: string;
  }): Promise<AIBotConfig> {
    const [updated] = await db
      .update(aiBotConfigs)
      .set({
        subscriptionActive: updates.subscriptionActive,
        subscriptionExpiresAt: updates.subscriptionExpiresAt,
        subscriptionPaymentTxSignature: updates.subscriptionPaymentTxSignature,
        updatedAt: new Date(),
      })
      .where(eq(aiBotConfigs.ownerWalletAddress, ownerWalletAddress))
      .returning();
    return updated;
  }

  async incrementFreeTradesUsed(ownerWalletAddress: string): Promise<AIBotConfig> {
    const { sql: rawSql } = await import("drizzle-orm");
    const [updated] = await db
      .update(aiBotConfigs)
      .set({
        freeTradesUsed: rawSql`${aiBotConfigs.freeTradesUsed} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(aiBotConfigs.ownerWalletAddress, ownerWalletAddress))
      .returning();
    return updated;
  }

  // AI Bot Position operations
  async getAIBotPositions(ownerWalletAddress: string): Promise<AIBotPosition[]> {
    return db
      .select()
      .from(aiBotPositions)
      .where(eq(aiBotPositions.ownerWalletAddress, ownerWalletAddress))
      .orderBy(desc(aiBotPositions.buyTimestamp));
  }

  async getAIBotPosition(id: string): Promise<AIBotPosition | undefined> {
    const [position] = await db
      .select()
      .from(aiBotPositions)
      .where(eq(aiBotPositions.id, id));
    return position || undefined;
  }

  async createAIBotPosition(position: InsertAIBotPosition): Promise<AIBotPosition> {
    const [created] = await db
      .insert(aiBotPositions)
      .values(position)
      .returning();
    return created;
  }

  async updateAIBotPosition(id: string, updates: Partial<InsertAIBotPosition>): Promise<AIBotPosition | undefined> {
    const [updated] = await db
      .update(aiBotPositions)
      .set(updates)
      .where(eq(aiBotPositions.id, id))
      .returning();
    return updated || undefined;
  }

  async deleteAIBotPosition(id: string): Promise<boolean> {
    const result = await db
      .delete(aiBotPositions)
      .where(eq(aiBotPositions.id, id));
    return result.rowCount ? result.rowCount > 0 : false;
  }

  async deleteAIBotPositionByMint(ownerWalletAddress: string, tokenMint: string): Promise<boolean> {
    const { and } = await import("drizzle-orm");
    const result = await db
      .delete(aiBotPositions)
      .where(
        and(
          eq(aiBotPositions.ownerWalletAddress, ownerWalletAddress),
          eq(aiBotPositions.tokenMint, tokenMint)
        )
      );
    return result.rowCount ? result.rowCount > 0 : false;
  }

  // Hivemind Strategy operations
  async getHivemindStrategies(ownerWalletAddress: string): Promise<HivemindStrategy[]> {
    return db
      .select()
      .from(hivemindStrategies)
      .where(eq(hivemindStrategies.ownerWalletAddress, ownerWalletAddress))
      .orderBy(desc(hivemindStrategies.createdAt));
  }

  async createHivemindStrategy(strategy: InsertHivemindStrategy): Promise<HivemindStrategy> {
    const [created] = await db
      .insert(hivemindStrategies)
      .values(strategy)
      .returning();
    return created;
  }

  // Token Blacklist operations
  async getAllBlacklistedTokens(): Promise<TokenBlacklist[]> {
    return db
      .select()
      .from(tokenBlacklist)
      .orderBy(desc(tokenBlacklist.createdAt));
  }

  async isTokenBlacklisted(tokenMint: string): Promise<boolean> {
    const [entry] = await db
      .select()
      .from(tokenBlacklist)
      .where(eq(tokenBlacklist.tokenMint, tokenMint));
    return !!entry;
  }

  async addTokenToBlacklist(blacklistEntry: InsertTokenBlacklist): Promise<TokenBlacklist> {
    const [created] = await db
      .insert(tokenBlacklist)
      .values(blacklistEntry)
      .onConflictDoNothing() // If already exists, skip
      .returning();
    
    // If conflict occurred, fetch the existing entry
    if (!created) {
      const [existing] = await db
        .select()
        .from(tokenBlacklist)
        .where(eq(tokenBlacklist.tokenMint, blacklistEntry.tokenMint));
      return existing;
    }
    
    return created;
  }

  async removeTokenFromBlacklist(tokenMint: string): Promise<boolean> {
    const result = await db
      .delete(tokenBlacklist)
      .where(eq(tokenBlacklist.tokenMint, tokenMint));
    return result.rowCount ? result.rowCount > 0 : false;
  }

  // Trade Journal operations
  async getTradeJournalEntries(ownerWalletAddress: string, limit?: number): Promise<TradeJournal[]> {
    const query = db
      .select()
      .from(tradeJournal)
      .where(eq(tradeJournal.ownerWalletAddress, ownerWalletAddress))
      .orderBy(desc(tradeJournal.createdAt));
    
    if (limit) {
      return query.limit(limit);
    }
    
    return query;
  }

  async createTradeJournalEntry(entry: InsertTradeJournal): Promise<TradeJournal> {
    const [created] = await db
      .insert(tradeJournal)
      .values(entry)
      .returning();
    return created;
  }

  async updateTradeJournalEntry(id: string, updates: Partial<InsertTradeJournal>): Promise<TradeJournal | undefined> {
    const [updated] = await db
      .update(tradeJournal)
      .set(updates)
      .where(eq(tradeJournal.id, id))
      .returning();
    return updated || undefined;
  }

  async getTradePatterns(ownerWalletAddress: string): Promise<{
    winRate: number;
    avgProfit: number;
    totalTrades: number;
    commonFailureReasons: { reason: string; count: number }[];
    bestTokenCharacteristics: any[];
  }> {
    // Get all completed trades (those with exit data)
    const completedTrades = await db
      .select()
      .from(tradeJournal)
      .where(eq(tradeJournal.ownerWalletAddress, ownerWalletAddress));
    
    const finished = completedTrades.filter(t => t.exitAt !== null);
    
    if (finished.length === 0) {
      return {
        winRate: 0,
        avgProfit: 0,
        totalTrades: 0,
        commonFailureReasons: [],
        bestTokenCharacteristics: [],
      };
    }
    
    // Calculate win rate
    const wins = finished.filter(t => t.wasSuccessful).length;
    const winRate = (wins / finished.length) * 100;
    
    // Calculate average profit (including losses)
    const totalProfit = finished.reduce((sum, t) => {
      const profit = parseFloat(t.profitLossPercent || "0");
      return sum + profit;
    }, 0);
    const avgProfit = totalProfit / finished.length;
    
    // Find common failure reasons
    const failureReasonMap = new Map<string, number>();
    finished.filter(t => !t.wasSuccessful && t.failureReason).forEach(t => {
      const reason = t.failureReason!;
      failureReasonMap.set(reason, (failureReasonMap.get(reason) || 0) + 1);
    });
    
    const commonFailureReasons = Array.from(failureReasonMap.entries())
      .map(([reason, count]) => ({ reason, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5); // Top 5 failure reasons
    
    // Find characteristics of winning trades
    const winningTrades = finished.filter(t => t.wasSuccessful);
    const bestTokenCharacteristics = winningTrades
      .filter(t => t.tokenCharacteristics)
      .map(t => {
        try {
          return JSON.parse(t.tokenCharacteristics!);
        } catch {
          return null;
        }
      })
      .filter(c => c !== null);
    
    return {
      winRate,
      avgProfit,
      totalTrades: finished.length,
      commonFailureReasons,
      bestTokenCharacteristics,
    };
  }

  // Public Stats (aggregated from all users)
  async getPublicStats(): Promise<{
    totalTrades: number;
    winRate: string;
    avgROI: string;
    totalProfit: string;
    activeUsers: number;
    avgHoldTime: number;
    bestTrade: string;
    last24hTrades: number;
    scalpTrades: number;
    swingTrades: number;
    totalCapitalSOL: string;
    capitalInPositionsSOL: string;
    availableCapitalSOL: string;
    activePositionsCount: number;
  }> {
    // Get all completed trades from trade journal
    const allTrades = await db.select().from(tradeJournal);
    const completedTrades = allTrades.filter(t => t.exitAt !== null);
    
    // Get active AI bot configs for portfolio metrics
    const activeConfigs = await db.select().from(aiBotConfigs);
    const enabledConfigs = activeConfigs.filter(c => c.enabled);
    
    // Calculate portfolio metrics (using budgetUsed for capital in positions)
    const totalCapitalSOL = enabledConfigs.reduce((sum, c) => {
      return sum + parseFloat(c.totalBudget || "0");
    }, 0);
    
    const capitalInPositionsSOL = enabledConfigs.reduce((sum, c) => {
      return sum + parseFloat(c.budgetUsed || "0");
    }, 0);
    
    // Cap available capital at 0 minimum (can't be negative)
    // Note: capitalInPositions > totalCapital can occur when positions gain value
    const availableCapitalSOL = Math.max(0, totalCapitalSOL - capitalInPositionsSOL);
    
    // Count active positions across all users
    const allPositions = await db.select().from(aiBotPositions);
    const activePositionsCount = allPositions.length;
    
    if (completedTrades.length === 0) {
      return {
        totalTrades: 0,
        winRate: "0.0",
        avgROI: "0.0",
        totalProfit: "0.00",
        activeUsers: enabledConfigs.length,
        avgHoldTime: 0,
        bestTrade: "0.0",
        last24hTrades: 0,
        scalpTrades: 0,
        swingTrades: 0,
        totalCapitalSOL: totalCapitalSOL.toFixed(2),
        capitalInPositionsSOL: capitalInPositionsSOL.toFixed(2),
        availableCapitalSOL: availableCapitalSOL.toFixed(2),
        activePositionsCount,
      };
    }

    // Calculate total trades
    const totalTrades = completedTrades.length;

    // Calculate win rate
    const wins = completedTrades.filter(t => t.wasSuccessful).length;
    const winRate = ((wins / totalTrades) * 100).toFixed(1);

    // Calculate average ROI
    const totalROI = completedTrades.reduce((sum, t) => {
      return sum + parseFloat(t.profitLossPercent || "0");
    }, 0);
    const avgROI = (totalROI / totalTrades).toFixed(1);

    // Calculate total profit
    const totalProfitSOL = completedTrades.reduce((sum, t) => {
      return sum + parseFloat(t.profitLossSOL || "0");
    }, 0);
    const totalProfit = totalProfitSOL.toFixed(2);

    // Calculate average hold time
    const totalHoldTime = completedTrades.reduce((sum, t) => {
      return sum + (t.holdDurationMinutes || 0);
    }, 0);
    const avgHoldTime = Math.round(totalHoldTime / totalTrades);

    // Find best trade
    const bestTradePercent = completedTrades.reduce((max, t) => {
      const percent = parseFloat(t.profitLossPercent || "0");
      return percent > max ? percent : max;
    }, 0);
    const bestTrade = bestTradePercent.toFixed(1);

    // Count trades in last 24 hours
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const last24hTrades = completedTrades.filter(t => 
      t.exitAt && new Date(t.exitAt) > oneDayAgo
    ).length;

    // Count SCALP vs SWING trades
    const scalpTrades = completedTrades.filter(t => t.tradeMode === "SCALP").length;
    const swingTrades = completedTrades.filter(t => t.tradeMode === "SWING").length;

    return {
      totalTrades,
      winRate,
      avgROI,
      totalProfit,
      activeUsers: enabledConfigs.length,
      avgHoldTime,
      bestTrade,
      last24hTrades,
      scalpTrades,
      swingTrades,
      totalCapitalSOL: totalCapitalSOL.toFixed(2),
      capitalInPositionsSOL: capitalInPositionsSOL.toFixed(2),
      availableCapitalSOL: availableCapitalSOL.toFixed(2),
      activePositionsCount,
    };
  }

  // Recovery Mode operations (AI system recovery)
  async activateRecoveryMode(config: {
    enabled: boolean;
    startedAt: Date;
    endsAt: Date;
    recoveryProvider: string;
    reason: string;
    activatedBy: string;
  }): Promise<AIRecoveryMode> {
    // Insert new recovery mode configuration
    const [recoveryMode] = await db
      .insert(aiRecoveryMode)
      .values(config)
      .returning();
    
    return recoveryMode;
  }

  async getRecoveryModeStatus(): Promise<AIRecoveryMode | undefined> {
    // Get the most recent recovery mode configuration
    const [config] = await db
      .select()
      .from(aiRecoveryMode)
      .orderBy(desc(aiRecoveryMode.createdAt))
      .limit(1);
    
    return config || undefined;
  }

  async deactivateRecoveryMode(): Promise<void> {
    // Get the most recent recovery mode
    const current = await this.getRecoveryModeStatus();
    
    if (current) {
      // Update to disable it
      await db
        .update(aiRecoveryMode)
        .set({ 
          enabled: false, 
          updatedAt: new Date() 
        })
        .where(eq(aiRecoveryMode.id, current.id));
    }
  }

  // x402 Micropayment operations
  async getAllMicropayments(): Promise<X402Micropayment[]> {
    return db.select().from(x402Micropayments).orderBy(desc(x402Micropayments.createdAt));
  }

  async createMicropayment(payment: InsertX402Micropayment): Promise<X402Micropayment> {
    const [micropayment] = await db
      .insert(x402Micropayments)
      .values(payment)
      .returning();
    return micropayment;
  }

  // BAM Bundle operations
  async getAllBamBundles(): Promise<BamBundle[]> {
    return db.select().from(bamBundles).orderBy(desc(bamBundles.submittedAt));
  }

  async createBamBundle(bundle: InsertBamBundle): Promise<BamBundle> {
    const [bamBundle] = await db
      .insert(bamBundles)
      .values(bundle)
      .returning();
    return bamBundle;
  }

  async updateBamBundleStatus(bundleId: string, updates: Partial<InsertBamBundle>): Promise<BamBundle | undefined> {
    const [bundle] = await db
      .update(bamBundles)
      .set(updates)
      .where(eq(bamBundles.bundleId, bundleId))
      .returning();
    return bundle || undefined;
  }
}

export const storage = new DatabaseStorage();
