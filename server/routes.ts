import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { insertProjectSchema, insertTransactionSchema, insertPaymentSchema } from "@shared/schema";
import { fromZodError } from "zod-validation-error";
import { verifyPayment, getWalletBalance, isValidSolanaAddress } from "./solana";
import { PRICING } from "@shared/config";

export async function registerRoutes(app: Express): Promise<Server> {
  // Project routes
  app.get("/api/projects", async (req, res) => {
    try {
      const projects = await storage.getAllProjects();
      res.json(projects);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/projects/:id", async (req, res) => {
    try {
      const project = await storage.getProject(req.params.id);
      if (!project) {
        return res.status(404).json({ message: "Project not found" });
      }
      res.json(project);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/projects/owner/:walletAddress", async (req, res) => {
    try {
      const projects = await storage.getProjectsByOwner(req.params.walletAddress);
      res.json(projects);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/projects", async (req, res) => {
    try {
      const validatedData = insertProjectSchema.parse(req.body);
      const project = await storage.createProject(validatedData);
      res.status(201).json(project);
    } catch (error: any) {
      if (error.name === "ZodError") {
        const validationError = fromZodError(error);
        return res.status(400).json({ message: validationError.message });
      }
      res.status(500).json({ message: error.message });
    }
  });

  app.patch("/api/projects/:id", async (req, res) => {
    try {
      const updates = insertProjectSchema.partial().parse(req.body);
      const project = await storage.updateProject(req.params.id, updates);
      if (!project) {
        return res.status(404).json({ message: "Project not found" });
      }
      res.json(project);
    } catch (error: any) {
      if (error.name === "ZodError") {
        const validationError = fromZodError(error);
        return res.status(400).json({ message: validationError.message });
      }
      res.status(500).json({ message: error.message });
    }
  });

  app.delete("/api/projects/:id", async (req, res) => {
    try {
      const success = await storage.deleteProject(req.params.id);
      if (!success) {
        return res.status(404).json({ message: "Project not found" });
      }
      res.status(204).send();
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Transaction routes
  app.get("/api/transactions", async (req, res) => {
    try {
      const transactions = await storage.getAllTransactions();
      res.json(transactions);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/transactions/recent", async (req, res) => {
    try {
      const limit = parseInt(req.query.limit as string) || 10;
      const transactions = await storage.getRecentTransactions(limit);
      res.json(transactions);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/transactions/project/:projectId", async (req, res) => {
    try {
      const transactions = await storage.getTransactionsByProject(req.params.projectId);
      res.json(transactions);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/transactions", async (req, res) => {
    try {
      const validatedData = insertTransactionSchema.parse(req.body);
      const transaction = await storage.createTransaction(validatedData);
      res.status(201).json(transaction);
    } catch (error: any) {
      if (error.name === "ZodError") {
        const validationError = fromZodError(error);
        return res.status(400).json({ message: validationError.message });
      }
      res.status(500).json({ message: error.message });
    }
  });

  // Payment routes
  app.get("/api/payments/project/:projectId", async (req, res) => {
    try {
      const payments = await storage.getPaymentsByProject(req.params.projectId);
      res.json(payments);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/payments", async (req, res) => {
    try {
      const validatedData = insertPaymentSchema.parse(req.body);
      const payment = await storage.createPayment(validatedData);
      res.status(201).json(payment);
    } catch (error: any) {
      if (error.name === "ZodError") {
        const validationError = fromZodError(error);
        return res.status(400).json({ message: validationError.message });
      }
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/payments/:id/verify", async (req, res) => {
    try {
      const payment = await storage.verifyPayment(req.params.id);
      if (!payment) {
        return res.status(404).json({ message: "Payment not found" });
      }
      res.json(payment);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Verify payment on Solana blockchain
  app.post("/api/verify-payment-onchain", async (req, res) => {
    try {
      const { txSignature, projectId, tier, ownerWalletAddress } = req.body;
      
      if (!txSignature || !projectId || !tier || !ownerWalletAddress) {
        return res.status(400).json({
          message: "Missing required fields: txSignature, projectId, tier, ownerWalletAddress",
        });
      }

      // Verify the project exists and belongs to the user
      const project = await storage.getProject(projectId);
      if (!project) {
        return res.status(404).json({ message: "Project not found" });
      }

      if (project.ownerWalletAddress !== ownerWalletAddress) {
        return res.status(403).json({
          message: "Unauthorized: You don't own this project",
        });
      }

      // Check if this transaction signature has already been used
      const existingPayments = await storage.getPaymentsByProject(projectId);
      const duplicatePayment = existingPayments.find(p => p.txSignature === txSignature);
      
      if (duplicatePayment) {
        return res.status(400).json({
          message: "This transaction has already been used for payment",
        });
      }

      // Check if project is already active with a valid payment
      const now = new Date();
      const activePayment = existingPayments.find(p => 
        p.verified && new Date(p.expiresAt) > now
      );

      if (activePayment) {
        return res.status(400).json({
          message: "Project already has an active subscription",
          expiresAt: activePayment.expiresAt,
        });
      }

      // Get expected amount based on tier
      const tierData = PRICING[tier as keyof typeof PRICING];
      if (!tierData) {
        return res.status(400).json({ message: "Invalid tier" });
      }

      const expectedAmount = tierData.priceSOL;

      // Verify the payment on Solana blockchain
      const verification = await verifyPayment(txSignature, expectedAmount);

      if (!verification.verified) {
        return res.status(400).json({
          message: verification.error || "Payment verification failed",
        });
      }

      // Verify the payment came from the project owner's wallet
      if (verification.fromAddress && verification.fromAddress !== ownerWalletAddress) {
        return res.status(400).json({
          message: "Payment must come from the project owner's wallet address",
        });
      }

      // Create payment record in database
      const payment = await storage.createPayment({
        projectId,
        walletAddress: verification.fromAddress || ownerWalletAddress,
        amount: verification.amount!.toString(),
        currency: "SOL",
        txSignature: txSignature,
        tier: tier,
        verified: true,
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days from now
      });

      // Activate the project
      await storage.updateProject(projectId, { isActive: true });

      res.json({
        success: true,
        payment,
        message: "Payment verified and project activated",
      });
    } catch (error: any) {
      console.error("Payment verification error:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // Manual buyback execution (requires private keys configured in environment)
  app.post("/api/execute-buyback/:projectId", async (req, res) => {
    try {
      const { ownerWalletAddress } = req.body;
      
      if (!ownerWalletAddress) {
        return res.status(400).json({ message: "Owner wallet address required" });
      }

      const project = await storage.getProject(req.params.projectId);
      if (!project) {
        return res.status(404).json({ message: "Project not found" });
      }

      // Verify ownership
      if (project.ownerWalletAddress !== ownerWalletAddress) {
        return res.status(403).json({ message: "Unauthorized: You don't own this project" });
      }

      // Verify project is active
      if (!project.isActive) {
        return res.status(400).json({ message: "Project is not active" });
      }

      // Check for valid payment
      const now = new Date();
      const payments = await storage.getPaymentsByProject(project.id);
      const validPayments = payments.filter(p => 
        p.verified && new Date(p.expiresAt) > now
      );
      
      const validPayment = validPayments.sort((a, b) => 
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      )[0];

      if (!validPayment) {
        return res.status(400).json({ 
          message: "No active subscription found. Please make a payment first." 
        });
      }

      // Check if treasury private key is configured
      const treasuryPrivateKey = process.env[`TREASURY_KEY_${project.id}`];
      if (!treasuryPrivateKey) {
        return res.status(400).json({
          message: "Treasury private key not configured. Set TREASURY_KEY_" + project.id + " in environment variables.",
        });
      }

      // Import the scheduler to execute buyback
      const { scheduler } = await import("./scheduler");
      
      // Execute buyback immediately (bypassing schedule check)
      await (scheduler as any).executeBuyback(project.id);

      res.json({
        success: true,
        message: "Buyback execution initiated",
        projectId: project.id,
      });
    } catch (error: any) {
      console.error("Manual buyback execution error:", error);
      res.status(500).json({ message: error.message });
    }
  });

  const httpServer = createServer(app);
  return httpServer;
}
