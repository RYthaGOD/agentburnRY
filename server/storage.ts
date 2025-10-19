import {
  projects,
  transactions,
  payments,
  usedSignatures,
  type Project,
  type InsertProject,
  type Transaction,
  type InsertTransaction,
  type Payment,
  type InsertPayment,
  type UsedSignature,
  type InsertUsedSignature,
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
    const [project] = await db
      .insert(projects)
      .values(insertProject)
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
}

export const storage = new DatabaseStorage();
