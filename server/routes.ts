import type { Express } from "express";
import { createServer, type Server } from "http";
import * as crypto from "crypto";
import { storage } from "./storage";
import { insertProjectSchema, insertTransactionSchema, insertPaymentSchema, setProjectKeysSchema } from "@shared/schema";
import { fromZodError } from "zod-validation-error";
import { verifyPayment, getWalletBalance, isValidSolanaAddress } from "./solana";
import { PRICING } from "@shared/config";
import { storeProjectKeys, getKeyMetadata, deleteProjectKeys, getTreasuryKey } from "./key-manager";

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
      
      // Get the existing project first
      const existingProject = await storage.getProject(req.params.id);
      if (!existingProject) {
        return res.status(404).json({ message: "Project not found" });
      }

      // If trying to activate a project, verify payment first (unless whitelisted)
      if (updates.isActive === true && !existingProject.isActive) {
        const { WHITELISTED_WALLETS } = await import("@shared/config");
        const isWhitelisted = WHITELISTED_WALLETS.includes(existingProject.ownerWalletAddress);

        if (!isWhitelisted) {
          // Check for valid payment
          const payments = await storage.getPaymentsByProject(req.params.id);
          const now = new Date();
          const validPayment = payments.find(p => 
            p.verified && new Date(p.expiresAt) > now
          );

          if (!validPayment) {
            return res.status(403).json({ 
              message: "Payment required to activate project. Please complete payment first." 
            });
          }
        }
      }

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
      const { ownerWalletAddress, signature, message } = req.body;
      
      if (!ownerWalletAddress || !signature || !message) {
        return res.status(400).json({ 
          message: "Missing required fields: ownerWalletAddress, signature, and message are required" 
        });
      }

      const project = await storage.getProject(req.params.projectId);
      if (!project) {
        return res.status(404).json({ message: "Project not found" });
      }

      // Verify ownership
      if (project.ownerWalletAddress !== ownerWalletAddress) {
        return res.status(403).json({ message: "Unauthorized: You don't own this project" });
      }

      // Create a hash of the signature for replay attack prevention
      const signatureHash = crypto.createHash("sha256").update(signature).digest("hex");

      // Check if this signature has already been used (replay attack prevention)
      const isUsed = await storage.isSignatureUsed(signatureHash);
      if (isUsed) {
        return res.status(400).json({ 
          message: "Signature already used: This request has already been processed" 
        });
      }

      // Verify wallet signature to prove ownership
      const { verifyWalletSignature } = await import("./solana-sdk");
      const isValidSignature = await verifyWalletSignature(
        ownerWalletAddress,
        message,
        signature
      );

      if (!isValidSignature) {
        return res.status(403).json({ 
          message: "Invalid signature: Could not verify wallet ownership" 
        });
      }

      // Verify message contains the project ID and is recent (within 5 minutes)
      const expectedMessagePrefix = `Execute buyback for project ${project.id}`;
      if (!message.startsWith(expectedMessagePrefix)) {
        return res.status(400).json({ 
          message: "Invalid message format" 
        });
      }

      // Extract timestamp from message (format: "Execute buyback for project {id} at {timestamp}")
      const timestampMatch = message.match(/at (\d+)$/);
      if (!timestampMatch) {
        return res.status(400).json({ 
          message: "Message must include timestamp" 
        });
      }

      const messageTimestamp = parseInt(timestampMatch[1]);
      const nowTimestamp = Date.now();
      const fiveMinutesInMs = 5 * 60 * 1000;

      if (Math.abs(nowTimestamp - messageTimestamp) > fiveMinutesInMs) {
        return res.status(400).json({ 
          message: "Signature expired: Please sign a new message" 
        });
      }

      // Check for valid payment (unless whitelisted)
      const { WHITELISTED_WALLETS } = await import("@shared/config");
      const isWhitelisted = WHITELISTED_WALLETS.includes(project.ownerWalletAddress);

      console.log(`Manual buyback - Project owner: ${project.ownerWalletAddress}`);
      console.log(`Manual buyback - Is whitelisted: ${isWhitelisted}`);
      console.log(`Manual buyback - Whitelist contains ${WHITELISTED_WALLETS.length} wallets`);

      if (!isWhitelisted) {
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
      }

      // Check if treasury private key is configured in encrypted storage
      const treasuryPrivateKey = await getTreasuryKey(project.id);
      if (!treasuryPrivateKey) {
        return res.status(400).json({
          message: "Treasury private key not configured. Please add your automation keys in Settings.",
        });
      }

      // Record the signature as used to prevent replay attacks
      // Set expiration to 10 minutes from now (signature timeout + buffer)
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
      try {
        await storage.recordUsedSignature({
          projectId: project.id,
          signatureHash,
          messageTimestamp: new Date(messageTimestamp),
          expiresAt,
        });
      } catch (error: any) {
        // Handle unique constraint violation (signature already used)
        if (error.code === '23505' || error.message?.includes('unique')) {
          return res.status(400).json({ 
            message: "Signature already used: This request has already been processed" 
          });
        }
        throw error; // Re-throw other errors
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

  // Manual burn endpoint - burn tokens already in treasury wallet
  app.post("/api/projects/:projectId/manual-burn", async (req, res) => {
    try {
      const { ownerWalletAddress, signature, message, amount } = req.body;
      
      if (!ownerWalletAddress || !signature || !message || !amount) {
        return res.status(400).json({ 
          message: "Missing required fields: ownerWalletAddress, signature, message, and amount are required" 
        });
      }

      const burnAmount = parseFloat(amount);
      if (isNaN(burnAmount) || burnAmount <= 0) {
        return res.status(400).json({ 
          message: "Invalid amount: Must be a positive number" 
        });
      }

      const project = await storage.getProject(req.params.projectId);
      if (!project) {
        return res.status(404).json({ message: "Project not found" });
      }

      // Verify ownership
      if (project.ownerWalletAddress !== ownerWalletAddress) {
        return res.status(403).json({ message: "Unauthorized: You don't own this project" });
      }

      // Create a hash of the signature for replay attack prevention
      const signatureHash = crypto.createHash("sha256").update(signature).digest("hex");

      // Check if this signature has already been used
      const isUsed = await storage.isSignatureUsed(signatureHash);
      if (isUsed) {
        return res.status(400).json({ 
          message: "Signature already used: This request has already been processed" 
        });
      }

      // Verify wallet signature to prove ownership
      const { verifyWalletSignature, getTokenBalance, burnTokens, loadKeypairFromPrivateKey } = await import("./solana-sdk");
      const isValidSignature = await verifyWalletSignature(
        ownerWalletAddress,
        message,
        signature
      );

      if (!isValidSignature) {
        return res.status(403).json({ 
          message: "Invalid signature: Could not verify wallet ownership" 
        });
      }

      // Verify message format and timestamp
      const expectedMessagePrefix = `Burn ${amount} tokens for project ${project.id}`;
      if (!message.startsWith(expectedMessagePrefix)) {
        return res.status(400).json({ 
          message: "Invalid message format" 
        });
      }

      const timestampMatch = message.match(/at (\d+)$/);
      if (!timestampMatch) {
        return res.status(400).json({ 
          message: "Message must include timestamp" 
        });
      }

      const messageTimestamp = parseInt(timestampMatch[1]);
      const nowTimestamp = Date.now();
      const fiveMinutesInMs = 5 * 60 * 1000;

      if (Math.abs(nowTimestamp - messageTimestamp) > fiveMinutesInMs) {
        return res.status(400).json({ 
          message: "Message expired: Please generate a new signature (must be within 5 minutes)" 
        });
      }

      // Get treasury private key
      const { getTreasuryKey } = await import("./key-manager");
      const treasuryKey = await getTreasuryKey(project.id);
      
      if (!treasuryKey) {
        return res.status(400).json({ 
          message: "Treasury private key not configured. Please configure it in Settings first." 
        });
      }

      // Check current token balance
      console.log(`Checking token balance for treasury: ${project.treasuryWalletAddress}, token: ${project.tokenMintAddress}`);
      const currentBalance = await getTokenBalance(
        project.tokenMintAddress,
        project.treasuryWalletAddress
      );
      console.log(`Current token balance: ${currentBalance}`);

      if (currentBalance === 0) {
        return res.status(400).json({ 
          message: `No tokens found in treasury wallet. Please verify:
• Treasury Wallet Address: ${project.treasuryWalletAddress}
• Token Mint Address: ${project.tokenMintAddress}
• The wallet has received these tokens (associated token account must exist)` 
        });
      }

      if (currentBalance < burnAmount) {
        return res.status(400).json({ 
          message: `Insufficient balance: Treasury has ${currentBalance} tokens but you're trying to burn ${burnAmount}` 
        });
      }

      // Store signature hash to prevent replay attacks
      try {
        await storage.recordUsedSignature({
          projectId: project.id,
          signatureHash,
          messageTimestamp: new Date(messageTimestamp),
          expiresAt: new Date(messageTimestamp + fiveMinutesInMs),
        });
      } catch (error: any) {
        if (error.code === '23505' || error.message?.includes('unique')) {
          return res.status(400).json({ 
            message: "Signature already used: This request has already been processed" 
          });
        }
        throw error;
      }

      console.log(`Manual burn initiated for ${project.name}: ${burnAmount} tokens`);

      // Execute burn
      try {
        const walletKeypair = loadKeypairFromPrivateKey(treasuryKey);
        const signature = await burnTokens(
          project.tokenMintAddress,
          walletKeypair,
          burnAmount
        );

        // Log successful burn transaction
        await storage.createTransaction({
          projectId: project.id,
          type: "burn",
          amount: "0", // No SOL spent for manual burns
          tokenAmount: burnAmount.toString(),
          txSignature: signature,
          status: "completed",
          errorMessage: null,
        });

        console.log(`Manual burn completed: ${signature}`);

        res.json({
          success: true,
          message: `Successfully burned ${burnAmount} tokens`,
          signature,
          projectId: project.id,
        });
      } catch (burnError: any) {
        console.error("Burn execution error:", burnError);

        // Log failed burn transaction
        await storage.createTransaction({
          projectId: project.id,
          type: "burn",
          amount: "0",
          tokenAmount: burnAmount.toString(),
          txSignature: "",
          status: "failed",
          errorMessage: burnError.message,
        });

        throw new Error(`Failed to execute burn: ${burnError.message}`);
      }
    } catch (error: any) {
      console.error("Manual burn error:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // ============ SECURE KEY MANAGEMENT ENDPOINTS ============
  // All key management endpoints require wallet signature authentication
  
  // Get key metadata (never returns actual keys - only status info)
  app.get("/api/projects/:id/keys/metadata", async (req, res) => {
    try {
      const project = await storage.getProject(req.params.id);
      if (!project) {
        return res.status(404).json({ message: "Project not found" });
      }

      const metadata = await getKeyMetadata(project.id);
      res.json(metadata);
    } catch (error: any) {
      console.error("Get key metadata error:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // Set/update private keys (requires wallet signature authentication)
  app.post("/api/projects/:id/keys", async (req, res) => {
    try {
      const { ownerWalletAddress, signature, message, keys } = req.body;
      
      if (!ownerWalletAddress || !signature || !message || !keys) {
        return res.status(400).json({ 
          message: "Missing required fields: ownerWalletAddress, signature, message, and keys are required" 
        });
      }

      const project = await storage.getProject(req.params.id);
      if (!project) {
        return res.status(404).json({ message: "Project not found" });
      }

      // Verify ownership
      if (project.ownerWalletAddress !== ownerWalletAddress) {
        return res.status(403).json({ message: "Unauthorized: You don't own this project" });
      }

      // Create a hash of the signature for replay attack prevention
      const signatureHash = crypto.createHash("sha256").update(signature).digest("hex");

      // Check if this signature has already been used
      const isUsed = await storage.isSignatureUsed(signatureHash);
      if (isUsed) {
        return res.status(400).json({ 
          message: "Signature already used: Please sign a new message" 
        });
      }

      // Verify wallet signature to prove ownership
      const { verifyWalletSignature } = await import("./solana-sdk");
      const isValidSignature = await verifyWalletSignature(
        ownerWalletAddress,
        message,
        signature
      );

      if (!isValidSignature) {
        return res.status(403).json({ 
          message: "Invalid signature: Could not verify wallet ownership" 
        });
      }

      // Verify message contains the project ID and is recent (within 5 minutes)
      const expectedMessagePrefix = `Set keys for project ${project.id}`;
      if (!message.startsWith(expectedMessagePrefix)) {
        return res.status(400).json({ 
          message: "Invalid message format" 
        });
      }

      // Extract timestamp from message
      const timestampMatch = message.match(/at (\d+)$/);
      if (!timestampMatch) {
        return res.status(400).json({ 
          message: "Message must include timestamp" 
        });
      }

      const messageTimestamp = parseInt(timestampMatch[1]);
      const nowTimestamp = Date.now();
      const fiveMinutesInMs = 5 * 60 * 1000;

      if (Math.abs(nowTimestamp - messageTimestamp) > fiveMinutesInMs) {
        return res.status(400).json({ 
          message: "Signature expired: Please sign a new message" 
        });
      }

      // Validate keys schema
      const validatedKeys = setProjectKeysSchema.parse(keys);

      // Record the signature as used to prevent replay attacks
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
      try {
        await storage.recordUsedSignature({
          projectId: project.id,
          signatureHash,
          messageTimestamp: new Date(messageTimestamp),
          expiresAt,
        });
      } catch (error: any) {
        if (error.code === '23505' || error.message?.includes('unique')) {
          return res.status(400).json({ 
            message: "Signature already used: This request has already been processed" 
          });
        }
        throw error;
      }

      // Store encrypted keys
      await storeProjectKeys(project.id, validatedKeys);

      // NEVER log or return the actual keys
      console.log(`Private keys updated for project ${project.id}`);
      
      res.json({
        success: true,
        message: "Private keys stored securely",
        projectId: project.id,
      });
    } catch (error: any) {
      // Don't log the full error as it might contain keys
      console.error("Set keys error:", error.message);
      
      if (error.name === "ZodError") {
        const validationError = fromZodError(error);
        return res.status(400).json({ message: validationError.message });
      }
      
      res.status(500).json({ message: "Failed to store keys" });
    }
  });

  // Delete private keys (requires wallet signature authentication)
  app.delete("/api/projects/:id/keys", async (req, res) => {
    try {
      const { ownerWalletAddress, signature, message } = req.body;
      
      if (!ownerWalletAddress || !signature || !message) {
        return res.status(400).json({ 
          message: "Missing required fields: ownerWalletAddress, signature, and message are required" 
        });
      }

      const project = await storage.getProject(req.params.id);
      if (!project) {
        return res.status(404).json({ message: "Project not found" });
      }

      // Verify ownership
      if (project.ownerWalletAddress !== ownerWalletAddress) {
        return res.status(403).json({ message: "Unauthorized: You don't own this project" });
      }

      // Create a hash of the signature for replay attack prevention
      const signatureHash = crypto.createHash("sha256").update(signature).digest("hex");

      // Check if this signature has already been used
      const isUsed = await storage.isSignatureUsed(signatureHash);
      if (isUsed) {
        return res.status(400).json({ 
          message: "Signature already used: Please sign a new message" 
        });
      }

      // Verify wallet signature to prove ownership
      const { verifyWalletSignature } = await import("./solana-sdk");
      const isValidSignature = await verifyWalletSignature(
        ownerWalletAddress,
        message,
        signature
      );

      if (!isValidSignature) {
        return res.status(403).json({ 
          message: "Invalid signature: Could not verify wallet ownership" 
        });
      }

      // Verify message contains the project ID and is recent (within 5 minutes)
      const expectedMessagePrefix = `Delete keys for project ${project.id}`;
      if (!message.startsWith(expectedMessagePrefix)) {
        return res.status(400).json({ 
          message: "Invalid message format" 
        });
      }

      // Extract timestamp from message
      const timestampMatch = message.match(/at (\d+)$/);
      if (!timestampMatch) {
        return res.status(400).json({ 
          message: "Message must include timestamp" 
        });
      }

      const messageTimestamp = parseInt(timestampMatch[1]);
      const nowTimestamp = Date.now();
      const fiveMinutesInMs = 5 * 60 * 1000;

      if (Math.abs(nowTimestamp - messageTimestamp) > fiveMinutesInMs) {
        return res.status(400).json({ 
          message: "Signature expired: Please sign a new message" 
        });
      }

      // Record the signature as used to prevent replay attacks
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
      try {
        await storage.recordUsedSignature({
          projectId: project.id,
          signatureHash,
          messageTimestamp: new Date(messageTimestamp),
          expiresAt,
        });
      } catch (error: any) {
        if (error.code === '23505' || error.message?.includes('unique')) {
          return res.status(400).json({ 
            message: "Signature already used: This request has already been processed" 
          });
        }
        throw error;
      }

      // Delete all keys for this project
      const success = await deleteProjectKeys(project.id);
      
      if (!success) {
        return res.status(404).json({ message: "No keys found to delete" });
      }

      console.log(`Private keys deleted for project ${project.id}`);
      
      res.json({
        success: true,
        message: "Private keys deleted successfully",
        projectId: project.id,
      });
    } catch (error: any) {
      console.error("Delete keys error:", error);
      res.status(500).json({ message: error.message });
    }
  });

  const httpServer = createServer(app);
  return httpServer;
}
