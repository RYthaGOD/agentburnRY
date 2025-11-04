import {
  projects,
  transactions,
  projectSecrets,
  x402Micropayments,
  bamBundles,
  agentBurns,
  usedSignatures,
  type Project,
  type InsertProject,
  type Transaction,
  type InsertTransaction,
  type ProjectSecret,
  type InsertProjectSecret,
} from "@shared/schema";
import { db } from "./db";
import { eq, desc } from "drizzle-orm";

export interface IStorage {
  // Project operations (burn configurations)
  getProject(id: string): Promise<Project | undefined>;
  getProjects(ownerWalletAddress: string): Promise<Project[]>;
  getAllProjects(): Promise<Project[]>;
  createProject(project: InsertProject): Promise<Project>;
  updateProject(id: string, project: Partial<InsertProject>): Promise<Project | undefined>;
  deleteProject(id: string): Promise<boolean>;

  // Transaction operations (burn history)
  getTransaction(id: string): Promise<Transaction | undefined>;
  getTransactionsByProject(projectId: string): Promise<Transaction[]>;
  getAllTransactions(): Promise<Transaction[]>;
  getRecentTransactions(limit: number): Promise<Transaction[]>;
  createTransaction(transaction: InsertTransaction): Promise<Transaction>;
  updateTransaction(txSignature: string, updates: Partial<InsertTransaction>): Promise<Transaction | undefined>;

  // Project secrets operations (encrypted private keys)
  getProjectSecrets(projectId: string): Promise<ProjectSecret | undefined>;
  setProjectSecrets(secrets: InsertProjectSecret): Promise<ProjectSecret>;
  updateProjectSecrets(projectId: string, secrets: Partial<InsertProjectSecret>): Promise<ProjectSecret | undefined>;
  deleteProjectSecrets(projectId: string): Promise<boolean>;
  
  // Replay attack prevention operations
  isSignatureUsed(signatureHash: string): Promise<boolean>;
  recordUsedSignature(data: { signatureHash: string }): Promise<void>;
}

class DbStorage implements IStorage {
  // ===================================
  // PROJECT OPERATIONS
  // ===================================
  
  async getProject(id: string): Promise<Project | undefined> {
    const [project] = await db.select().from(projects).where(eq(projects.id, id)).limit(1);
    return project;
  }

  async getProjects(ownerWalletAddress: string): Promise<Project[]> {
    return await db.select()
      .from(projects)
      .where(eq(projects.ownerWalletAddress, ownerWalletAddress))
      .orderBy(desc(projects.createdAt));
  }

  async getAllProjects(): Promise<Project[]> {
    return await db.select().from(projects).orderBy(desc(projects.createdAt));
  }

  async createProject(project: InsertProject): Promise<Project> {
    const [newProject] = await db.insert(projects).values(project).returning();
    return newProject;
  }

  async updateProject(id: string, updates: Partial<InsertProject>): Promise<Project | undefined> {
    const [updated] = await db
      .update(projects)
      .set(updates)
      .where(eq(projects.id, id))
      .returning();
    return updated;
  }

  async deleteProject(id: string): Promise<boolean> {
    const result = await db.delete(projects).where(eq(projects.id, id)).returning();
    return result.length > 0;
  }

  // ===================================
  // TRANSACTION OPERATIONS
  // ===================================

  async getTransaction(id: string): Promise<Transaction | undefined> {
    const [transaction] = await db.select().from(transactions).where(eq(transactions.id, id)).limit(1);
    return transaction;
  }

  async getTransactionsByProject(projectId: string): Promise<Transaction[]> {
    return await db.select()
      .from(transactions)
      .where(eq(transactions.projectId, projectId))
      .orderBy(desc(transactions.createdAt));
  }

  async getAllTransactions(): Promise<Transaction[]> {
    return await db.select().from(transactions).orderBy(desc(transactions.createdAt));
  }

  async getRecentTransactions(limit: number): Promise<Transaction[]> {
    return await db.select()
      .from(transactions)
      .orderBy(desc(transactions.createdAt))
      .limit(limit);
  }

  async createTransaction(transaction: InsertTransaction): Promise<Transaction> {
    const [newTransaction] = await db.insert(transactions).values(transaction).returning();
    return newTransaction;
  }

  async updateTransaction(txSignature: string, updates: Partial<InsertTransaction>): Promise<Transaction | undefined> {
    const [updated] = await db
      .update(transactions)
      .set(updates)
      .where(eq(transactions.txSignature, txSignature))
      .returning();
    return updated;
  }

  // ===================================
  // PROJECT SECRETS OPERATIONS
  // ===================================

  async getProjectSecrets(projectId: string): Promise<ProjectSecret | undefined> {
    const [secrets] = await db.select()
      .from(projectSecrets)
      .where(eq(projectSecrets.projectId, projectId))
      .limit(1);
    return secrets;
  }

  async setProjectSecrets(secrets: InsertProjectSecret): Promise<ProjectSecret> {
    const existing = await this.getProjectSecrets(secrets.projectId);
    if (existing) {
      const [updated] = await db
        .update(projectSecrets)
        .set(secrets)
        .where(eq(projectSecrets.projectId, secrets.projectId))
        .returning();
      return updated;
    } else {
      const [newSecrets] = await db.insert(projectSecrets).values(secrets).returning();
      return newSecrets;
    }
  }

  async updateProjectSecrets(projectId: string, updates: Partial<InsertProjectSecret>): Promise<ProjectSecret | undefined> {
    const [updated] = await db
      .update(projectSecrets)
      .set(updates)
      .where(eq(projectSecrets.projectId, projectId))
      .returning();
    return updated;
  }

  async deleteProjectSecrets(projectId: string): Promise<boolean> {
    const result = await db.delete(projectSecrets).where(eq(projectSecrets.projectId, projectId)).returning();
    return result.length > 0;
  }

  // ===================================
  // REPLAY ATTACK PREVENTION OPERATIONS
  // ===================================

  async isSignatureUsed(signatureHash: string): Promise<boolean> {
    const [result] = await db.select()
      .from(usedSignatures)
      .where(eq(usedSignatures.signatureHash, signatureHash))
      .limit(1);
    return result !== undefined;
  }

  async recordUsedSignature(data: { signatureHash: string }): Promise<void> {
    await db.insert(usedSignatures).values({
      signatureHash: data.signatureHash,
    });
  }
}

export const storage = new DbStorage();
