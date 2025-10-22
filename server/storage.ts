import {
  projects,
  transactions,
  payments,
  usedSignatures,
  projectSecrets,
  aiBotConfigs,
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
  createOrUpdateAIBotConfig(config: Partial<InsertAIBotConfig> & { ownerWalletAddress: string }): Promise<AIBotConfig>;
  deleteAIBotConfig(ownerWalletAddress: string): Promise<boolean>;
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
}

export const storage = new DatabaseStorage();
