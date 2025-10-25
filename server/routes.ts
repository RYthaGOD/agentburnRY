import type { Express } from "express";
import { createServer, type Server } from "http";
import * as crypto from "crypto";
import { storage } from "./storage";
import { insertProjectSchema, insertTransactionSchema, insertPaymentSchema, setProjectKeysSchema } from "@shared/schema";
import { fromZodError } from "zod-validation-error";
import { verifyPayment, getWalletBalance, isValidSolanaAddress } from "./solana";
import { PRICING } from "@shared/config";
import { storeProjectKeys, getKeyMetadata, deleteProjectKeys, getTreasuryKey } from "./key-manager";
import { 
  strictRateLimit, 
  authRateLimit,
  validateSolanaAddresses,
  auditLog,
} from "./security";

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

  app.post("/api/projects", validateSolanaAddresses, async (req, res) => {
    try {
      const validatedData = insertProjectSchema.parse(req.body);
      
      // Fetch token decimals from blockchain if not provided
      if (!validatedData.tokenDecimals && validatedData.tokenMintAddress) {
        const { getTokenDecimals } = await import("./solana-mint");
        try {
          const decimals = await getTokenDecimals(validatedData.tokenMintAddress);
          validatedData.tokenDecimals = decimals;
        } catch (error) {
          console.error("Failed to fetch token decimals, using default:", error);
          validatedData.tokenDecimals = 9; // Fallback to default
        }
      }
      
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

      // If trying to activate a project, verify payment or trial first (unless whitelisted)
      if (updates.isActive === true && !existingProject.isActive) {
        const { WHITELISTED_WALLETS } = await import("@shared/config");
        const isWhitelisted = WHITELISTED_WALLETS.includes(existingProject.ownerWalletAddress);

        if (!isWhitelisted) {
          const now = new Date();
          
          // Check for active trial
          const hasActiveTrial = existingProject.trialEndsAt && new Date(existingProject.trialEndsAt) > now;
          
          if (!hasActiveTrial) {
            // Check for valid payment
            const payments = await storage.getPaymentsByProject(req.params.id);
            const validPayment = payments.find(p => 
              p.verified && new Date(p.expiresAt) > now
            );

            if (!validPayment) {
              return res.status(403).json({ 
                message: "Payment or active trial required to activate project. Please complete payment first." 
              });
            }
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

  // Real-time monitoring endpoints
  app.get("/api/projects/:id/metrics", async (req, res) => {
    try {
      const project = await storage.getProject(req.params.id);
      if (!project) {
        return res.status(404).json({ message: "Project not found" });
      }

      // Get latest price from realtime service or database
      const { realtimeService } = await import("./realtime");
      let latestPriceSOL = project.latestPriceSOL;
      let priceTimestamp = project.priceTimestamp;

      // Try to get fresher price from cache
      const cachedPrice = await realtimeService.getLatestPrice(project.tokenMintAddress);
      if (cachedPrice !== null) {
        latestPriceSOL = cachedPrice.toString();
        priceTimestamp = new Date();
      }

      res.json({
        projectId: project.id,
        tokenMintAddress: project.tokenMintAddress,
        latestPriceSOL,
        priceTimestamp,
        lastBotRunAt: project.lastBotRunAt,
        lastBotStatus: project.lastBotStatus,
        volumeBotEnabled: project.volumeBotEnabled,
        buyBotEnabled: project.buyBotEnabled,
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/projects/:id/transactions/recent", async (req, res) => {
    try {
      const limit = parseInt(req.query.limit as string) || 10;
      const transactions = await storage.getTransactionsByProject(req.params.id);
      
      // Sort by created date and limit
      const recentTransactions = transactions
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
        .slice(0, limit);

      res.json(recentTransactions);
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
  // Manual buyback execution - requires authentication signature
  app.post("/api/execute-buyback/:projectId", authRateLimit, validateSolanaAddresses, async (req, res) => {
    auditLog("Manual buyback execution attempted", {
      projectId: req.params.projectId,
      ip: req.ip,
    });
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

  // Manual AI bot execution - scan and trade
  app.post("/api/execute-ai-bot/:projectId", authRateLimit, validateSolanaAddresses, async (req, res) => {
    auditLog("Manual AI bot execution attempted", {
      projectId: req.params.projectId,
      ip: req.ip,
    });
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

      // Check if this signature has already been used
      const isUsed = await storage.isSignatureUsed(signatureHash);
      if (isUsed) {
        return res.status(400).json({ 
          message: "Signature already used: This request has already been processed" 
        });
      }

      // Verify wallet signature
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

      // Verify message format and timestamp
      const expectedMessagePrefix = `Execute AI bot for project ${project.id}`;
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
          message: "Signature expired: Please sign a new message" 
        });
      }

      // Check for valid payment (unless whitelisted)
      const { WHITELISTED_WALLETS } = await import("@shared/config");
      const isWhitelisted = WHITELISTED_WALLETS.includes(project.ownerWalletAddress);

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

      // Check if treasury private key is configured
      const treasuryPrivateKey = await getTreasuryKey(project.id);
      if (!treasuryPrivateKey) {
        return res.status(400).json({
          message: "Treasury private key not configured. Please add your automation keys in Settings.",
        });
      }

      // Record signature as used
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

      // Execute AI bot scan and trade
      const { triggerAIBotManually } = await import("./ai-bot-scheduler");
      await triggerAIBotManually(project.id);

      res.json({
        success: true,
        message: "AI bot scan and trade initiated",
        projectId: project.id,
      });
    } catch (error: any) {
      console.error("Manual AI bot execution error:", error);
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

      // Execute burn using SPL Token burn instruction (permanently destroys tokens)
      try {
        const walletKeypair = loadKeypairFromPrivateKey(treasuryKey);
        const signature = await burnTokens(
          project.tokenMintAddress,
          walletKeypair,
          burnAmount,
          project.tokenDecimals
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

  // Manual trigger of automated buyback process
  app.post("/api/projects/:projectId/execute-automated-process", async (req, res) => {
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

      // Verify wallet signature
      const { verifyWalletSignature } = await import("./solana-sdk");
      const isValidSignature = await verifyWalletSignature(
        ownerWalletAddress,
        message,
        signature
      );

      if (!isValidSignature) {
        return res.status(401).json({ message: "Invalid signature" });
      }

      // Extract timestamp from message format: "Execute automated process for project {id} at {timestamp}"
      const timestampMatch = message.match(/at (\d+)$/);
      if (!timestampMatch) {
        return res.status(400).json({ message: "Invalid message format" });
      }

      const messageTimestamp = parseInt(timestampMatch[1], 10);
      
      // Check timestamp (5 minute expiry)
      const now = Date.now();
      const fiveMinutesInMs = 5 * 60 * 1000;
      if (now - messageTimestamp > fiveMinutesInMs) {
        return res.status(400).json({ message: "Message expired. Please try again." });
      }

      // Prevent replay attacks
      const signatureHash = crypto.createHash('sha256').update(signature).digest('hex');
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

      console.log(`Manual automated process triggered for ${project.name}`);

      // Execute the automated buyback process using the scheduler
      const { scheduler } = await import("./scheduler");
      
      // Execute the buyback
      await scheduler.executeBuyback(project.id);

      res.json({
        success: true,
        message: `Automated process executed successfully`,
        projectId: project.id,
      });
    } catch (error: any) {
      console.error("Manual automated process error:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // ============ STANDALONE AI BOT CONFIG ROUTES (NOT TIED TO PROJECTS) ============

  // Get AI bot config for a wallet
  app.get("/api/ai-bot/config/:ownerWalletAddress", async (req, res) => {
    try {
      const config = await storage.getAIBotConfig(req.params.ownerWalletAddress);
      if (!config) {
        return res.status(404).json({ message: "AI bot config not found" });
      }
      res.json(config);
    } catch (error: any) {
      console.error("Get AI bot config error:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // Get active positions for a wallet
  app.get("/api/ai-bot/positions/:ownerWalletAddress", async (req, res) => {
    try {
      const { getActivePositions } = await import("./ai-bot-scheduler");
      const positions = await getActivePositions(req.params.ownerWalletAddress);
      res.json(positions);
    } catch (error: any) {
      console.error("Get active positions error:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // Get hivemind strategy for a wallet
  app.get("/api/ai-bot/hivemind-strategy/:ownerWalletAddress", async (req, res) => {
    try {
      const { getLatestStrategy } = await import("./hivemind-strategy");
      const strategy = await getLatestStrategy(req.params.ownerWalletAddress);
      
      if (!strategy) {
        return res.status(404).json({ message: "No hivemind strategy found yet. Strategy will be generated on next deep scan." });
      }
      
      res.json(strategy);
    } catch (error: any) {
      console.error("Error fetching hivemind strategy:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // Get scheduler status for dashboard (shows real-time scheduler activity)
  app.get("/api/ai-bot/scheduler-status", async (req, res) => {
    try {
      const { getSchedulerStatus } = await import("./ai-bot-scheduler");
      const status = getSchedulerStatus();
      res.json(status);
    } catch (error: any) {
      console.error("Error fetching scheduler status:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // Get wallet holdings analysis (SOL + all SPL tokens)
  app.get("/api/ai-bot/holdings/:ownerWalletAddress", async (req, res) => {
    try {
      const { getAllTokenAccounts, getWalletBalance } = await import("./solana");
      const { getBatchTokenPrices } = await import("./jupiter");
      const walletAddress = req.params.ownerWalletAddress;

      // Get SOL balance
      const solBalance = await getWalletBalance(walletAddress);

      // Get all SPL token accounts
      const tokenAccounts = await getAllTokenAccounts(walletAddress);

      // Process token holdings and collect mints for batch price fetching
      const tokenData = [];
      const mints = [];
      
      for (const account of tokenAccounts) {
        try {
          const parsedData = account.account.data.parsed.info;
          const mint = parsedData.mint;
          const balance = parsedData.tokenAmount.uiAmount;

          // Skip zero balance tokens
          if (balance === 0 || balance === null) continue;

          tokenData.push({
            mint,
            balance,
            decimals: parsedData.tokenAmount.decimals,
          });
          mints.push(mint);
        } catch (tokenError) {
          console.error(`[Holdings] Error processing token:`, tokenError);
        }
      }

      // Fetch ALL token prices in a single batch API call (avoids rate limiting!)
      const priceMap = await getBatchTokenPrices(mints);

      // Build holdings array with prices from the batch response
      const holdings = tokenData.map((token) => {
        const priceSOL = priceMap.get(token.mint) || 0;
        return {
          ...token,
          priceSOL,
          valueSOL: token.balance * priceSOL,
        };
      });

      // Calculate total token value (only count tokens with known prices)
      const totalTokenValueSOL = holdings.reduce((sum, h) => sum + h.valueSOL, 0);
      const totalValueSOL = solBalance + totalTokenValueSOL;

      // Sort by value (highest first)
      holdings.sort((a, b) => b.valueSOL - a.valueSOL);

      // Calculate portfolio metrics
      const solPercentage = totalValueSOL > 0 ? (solBalance / totalValueSOL) * 100 : 100;
      const largestTokenValue = holdings.length > 0 ? holdings[0].valueSOL : 0;
      const largestTokenPercentage = totalValueSOL > 0 ? (largestTokenValue / totalValueSOL) * 100 : 0;
      
      // Calculate diversification score (0-100)
      // Considers concentration of largest position (whether SOL or token)
      const largestPositionPercentage = Math.max(solPercentage, largestTokenPercentage);
      const diversificationScore = Math.min(100, Math.max(0, 100 - largestPositionPercentage));

      res.json({
        solBalance,
        totalValueSOL,
        solPercentage,
        holdings,
        holdingCount: holdings.length,
        largestTokenPercentage,
        diversificationScore,
      });
    } catch (error: any) {
      console.error("Error fetching wallet holdings:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // Portfolio analysis and rebalancing with OpenAI (forced for testing)
  app.post("/api/ai-bot/analyze-rebalance", async (req, res) => {
    try {
      const { ownerWalletAddress } = req.body;
      
      if (!ownerWalletAddress) {
        return res.status(400).json({ 
          message: "Missing required field: ownerWalletAddress" 
        });
      }

      // Check AI bot whitelist
      const { AI_BOT_WHITELISTED_WALLETS } = await import("@shared/config");
      if (!AI_BOT_WHITELISTED_WALLETS.includes(ownerWalletAddress)) {
        return res.status(403).json({ 
          message: "AI Trading Bot access restricted to whitelisted wallets only" 
        });
      }

      console.log(`[Portfolio Analysis] Testing OpenAI with full portfolio analysis for ${ownerWalletAddress.slice(0, 8)}...`);

      // Get current positions
      const { getActivePositions } = await import("./ai-bot-scheduler");
      const positions = await getActivePositions(ownerWalletAddress);
      
      if (positions.length === 0) {
        return res.json({
          message: "No active positions to analyze",
          positions: [],
          recommendations: [],
          portfolio: null,
        });
      }

      // Get portfolio data
      const { getWalletBalance } = await import("./solana");
      const { getBatchTokenPrices } = await import("./jupiter");
      
      const solBalance = await getWalletBalance(ownerWalletAddress);
      const mints = positions.map(p => p.mint);
      const priceMap = await getBatchTokenPrices(mints);

      // Prepare positions for batch AI analysis with FORCED OpenAI
      const positionsForAnalysis = positions.map(p => {
        const currentPriceSOL = priceMap.get(p.mint) || 0;
        const profitPercent = p.entryPriceSOL > 0 
          ? ((currentPriceSOL - p.entryPriceSOL) / p.entryPriceSOL) * 100 
          : 0;
        
        return {
          mint: p.mint,
          symbol: p.tokenSymbol,
          currentPriceSOL,
          profitPercent,
          entryPriceSOL: p.entryPriceSOL,
          amountSOL: p.amountSOL,
          isSwingTrade: p.isSwingTrade === 1,
        };
      });

      console.log(`[Portfolio Analysis] 🧠 Running FULL HIVEMIND ANALYSIS (INCLUDING OPENAI) on ${positionsForAnalysis.length} positions...`);

      // Batch analyze with FORCED OpenAI inclusion
      const { analyzeTokenWithHiveMind } = await import("./grok-analysis");
      
      // Analyze each position with full hivemind (including OpenAI)
      const batchAnalysis = new Map();
      for (const pos of positionsForAnalysis) {
        try {
          // Fetch market data for this token
          const response = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${pos.mint}`);
          if (!response.ok) throw new Error(`DexScreener error`);
          
          const data = await response.json();
          const pair = data.pairs?.[0];
          
          if (!pair) {
            batchAnalysis.set(pos.mint, {
              confidence: 0,
              recommendation: "SELL",
              reasoning: "No market data - likely illiquid",
              errored: true
            });
            continue;
          }

          // Build market data for AI analysis
          const tokenData = {
            mint: pos.mint,
            name: pair.baseToken?.name || pos.symbol,
            symbol: pos.symbol,
            priceUSD: parseFloat(pair.priceUsd || "0"),
            priceSOL: pos.currentPriceSOL,
            volumeUSD24h: parseFloat(pair.volume?.h24 || "0"),
            marketCapUSD: parseFloat(pair.fdv || pair.marketCap || "0"),
            liquidityUSD: parseFloat(pair.liquidity?.usd || "0"),
            priceChange24h: parseFloat(pair.priceChange?.h24 || "0"),
            priceChange1h: parseFloat(pair.priceChange?.h1 || "0"),
          };

          // FORCE OPENAI INCLUSION for testing
          const result = await analyzeTokenWithHiveMind(
            tokenData,
            "medium",
            0.05,
            0.5,
            { forceInclude: true } // Force include OpenAI
          );

          // Determine recommendation based on AI consensus
          let recommendation: "HOLD" | "SELL" | "ADD" = "HOLD";
          if (result.analysis.action === "sell") {
            recommendation = "SELL";
          } else if (result.analysis.action === "buy") {
            recommendation = "ADD";
          }

          batchAnalysis.set(pos.mint, {
            confidence: result.analysis.confidence * 100,
            recommendation,
            reasoning: result.analysis.reasoning,
            errored: false
          });
        } catch (error) {
          console.error(`[Portfolio Analysis] Error analyzing ${pos.symbol}:`, error);
          batchAnalysis.set(pos.mint, {
            confidence: 0,
            recommendation: "HOLD",
            reasoning: `Analysis error: ${error instanceof Error ? error.message : String(error)}`,
            errored: true
          });
        }
      }

      // Build recommendations
      const recommendations = [];
      let totalValueSOL = solBalance;

      for (const pos of positionsForAnalysis) {
        const aiDecision = batchAnalysis.get(pos.mint) || {
          confidence: 0,
          recommendation: "HOLD",
          reasoning: "Analysis failed",
          errored: true
        };

        const currentValueSOL = pos.amountSOL * (1 + pos.profitPercent / 100);
        totalValueSOL += currentValueSOL;

        recommendations.push({
          symbol: pos.symbol,
          mint: pos.mint,
          entryPriceSOL: pos.entryPriceSOL,
          currentPriceSOL: pos.currentPriceSOL,
          profitPercent: pos.profitPercent,
          amountSOL: pos.amountSOL,
          currentValueSOL,
          isSwingTrade: pos.isSwingTrade,
          aiRecommendation: aiDecision.recommendation,
          aiConfidence: aiDecision.confidence,
          aiReasoning: aiDecision.reasoning,
          action: aiDecision.recommendation === "SELL" ? "SELL NOW" : "HOLD",
        });
      }

      // Calculate portfolio concentration
      const portfolioMetrics = {
        totalValueSOL,
        solBalance,
        solPercentage: (solBalance / totalValueSOL) * 100,
        positionCount: positions.length,
        largestPosition: recommendations.reduce((max, r) => 
          r.currentValueSOL > max ? r.currentValueSOL : max, 0
        ),
        largestPositionPercent: (recommendations.reduce((max, r) => 
          r.currentValueSOL > max ? r.currentValueSOL : max, 0
        ) / totalValueSOL) * 100,
      };

      console.log(`[Portfolio Analysis] ✅ Analysis complete - ${recommendations.filter(r => r.action === "SELL NOW").length} SELL signals, ${recommendations.filter(r => r.action === "HOLD").length} HOLD signals`);

      res.json({
        message: "Portfolio analysis complete (OpenAI included)",
        portfolio: portfolioMetrics,
        positions: recommendations,
        sellCount: recommendations.filter(r => r.action === "SELL NOW").length,
        holdCount: recommendations.filter(r => r.action === "HOLD").length,
        timestamp: new Date().toISOString(),
      });

    } catch (error: any) {
      console.error("[Portfolio Analysis] Error:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // Manual execution of standalone AI bot (no project required)
  app.post("/api/ai-bot/execute", authRateLimit, async (req, res) => {
    try {
      const { ownerWalletAddress, signature, message } = req.body;
      
      if (!ownerWalletAddress || !signature || !message) {
        return res.status(400).json({ 
          message: "Missing required fields: ownerWalletAddress, signature, and message are required" 
        });
      }

      // Verify wallet signature
      const { verifyWalletSignature } = await import("./solana-sdk");
      const isValidSignature = await verifyWalletSignature(
        ownerWalletAddress,
        message,
        signature
      );

      if (!isValidSignature) {
        return res.status(401).json({ message: "Invalid signature" });
      }

      // Extract timestamp from message
      const timestampMatch = message.match(/at (\d+)$/);
      if (!timestampMatch) {
        return res.status(400).json({ message: "Invalid message format" });
      }

      const messageTimestamp = parseInt(timestampMatch[1], 10);
      const now = Date.now();
      const fiveMinutesInMs = 5 * 60 * 1000;
      if (now - messageTimestamp > fiveMinutesInMs) {
        return res.status(400).json({ message: "Message expired. Please try again." });
      }

      // Check AI bot whitelist (RESTRICTED FEATURE)
      const { AI_BOT_WHITELISTED_WALLETS } = await import("@shared/config");
      const isWhitelisted = AI_BOT_WHITELISTED_WALLETS.includes(ownerWalletAddress);
      
      if (!isWhitelisted) {
        return res.status(403).json({ 
          message: "AI Trading Bot access is restricted. Your wallet is not whitelisted for this feature." 
        });
      }

      // Get AI bot config
      const config = await storage.getAIBotConfig(ownerWalletAddress);
      if (!config) {
        return res.status(404).json({ message: "AI bot config not found. Please configure the bot first." });
      }

      auditLog("execute_standalone_ai_bot", {
        walletAddress: ownerWalletAddress,
        ip: req.ip || "unknown",
      });

      console.log(`Manual standalone AI bot execution for wallet ${ownerWalletAddress}`);

      // Execute the standalone AI trading bot
      const { triggerStandaloneAIBot } = await import("./ai-bot-scheduler");
      const scanLogs = await triggerStandaloneAIBot(ownerWalletAddress);

      res.json({
        success: true,
        message: "AI bot scan completed successfully",
        ownerWalletAddress,
        logs: scanLogs,
      });
    } catch (error: any) {
      console.error("Manual standalone AI bot execution error:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // Create or update AI bot config
  app.post("/api/ai-bot/config", authRateLimit, async (req, res) => {
    try {
      const { ownerWalletAddress, signature, message, ...configData } = req.body;
      
      if (!ownerWalletAddress || !signature || !message) {
        return res.status(400).json({ 
          message: "Missing required fields: ownerWalletAddress, signature, and message are required" 
        });
      }

      // Verify wallet signature
      const { verifyWalletSignature } = await import("./solana-sdk");
      const isValidSignature = await verifyWalletSignature(
        ownerWalletAddress,
        message,
        signature
      );

      if (!isValidSignature) {
        return res.status(401).json({ message: "Invalid signature" });
      }

      // Extract timestamp from message
      const timestampMatch = message.match(/at (\d+)$/);
      if (!timestampMatch) {
        return res.status(400).json({ message: "Invalid message format" });
      }

      const messageTimestamp = parseInt(timestampMatch[1], 10);
      const now = Date.now();
      const fiveMinutesInMs = 5 * 60 * 1000;
      if (now - messageTimestamp > fiveMinutesInMs) {
        return res.status(400).json({ message: "Message expired. Please try again." });
      }

      // Check AI bot whitelist (RESTRICTED FEATURE)
      const { AI_BOT_WHITELISTED_WALLETS } = await import("@shared/config");
      const isWhitelisted = AI_BOT_WHITELISTED_WALLETS.includes(ownerWalletAddress);
      
      if (!isWhitelisted) {
        return res.status(403).json({ 
          message: "AI Trading Bot access is restricted. Your wallet is not whitelisted for this feature." 
        });
      }

      auditLog("update_ai_bot_config", {
        walletAddress: ownerWalletAddress,
        ip: req.ip || "unknown",
      });

      const config = await storage.createOrUpdateAIBotConfig({
        ownerWalletAddress,
        ...configData,
      });

      res.json(config);
    } catch (error: any) {
      console.error("Update AI bot config error:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // Delete AI bot config
  app.delete("/api/ai-bot/config/:ownerWalletAddress", authRateLimit, async (req, res) => {
    try {
      const { ownerWalletAddress, signature, message } = req.body;
      
      if (!ownerWalletAddress || !signature || !message) {
        return res.status(400).json({ 
          message: "Missing required fields: ownerWalletAddress, signature, and message are required" 
        });
      }

      if (ownerWalletAddress !== req.params.ownerWalletAddress) {
        return res.status(403).json({ message: "Unauthorized" });
      }

      // Verify wallet signature
      const { verifyWalletSignature } = await import("./solana-sdk");
      const isValidSignature = await verifyWalletSignature(
        ownerWalletAddress,
        message,
        signature
      );

      if (!isValidSignature) {
        return res.status(401).json({ message: "Invalid signature" });
      }

      const success = await storage.deleteAIBotConfig(ownerWalletAddress);
      if (!success) {
        return res.status(404).json({ message: "AI bot config not found" });
      }

      res.json({ success: true, message: "AI bot config deleted" });
    } catch (error: any) {
      console.error("Delete AI bot config error:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // Save AI bot treasury key (encrypted)
  app.post("/api/ai-bot/config/treasury-key", authRateLimit, async (req, res) => {
    try {
      const { ownerWalletAddress, signature, message, treasuryPrivateKey } = req.body;
      
      if (!ownerWalletAddress || !signature || !message || !treasuryPrivateKey) {
        return res.status(400).json({ 
          message: "Missing required fields: ownerWalletAddress, signature, message, and treasuryPrivateKey are required" 
        });
      }

      // Verify wallet signature
      const { verifyWalletSignature } = await import("./solana-sdk");
      const isValidSignature = await verifyWalletSignature(
        ownerWalletAddress,
        message,
        signature
      );

      if (!isValidSignature) {
        return res.status(401).json({ message: "Invalid signature" });
      }

      // Extract timestamp from message
      const timestampMatch = message.match(/at (\d+)$/);
      if (!timestampMatch) {
        return res.status(400).json({ message: "Invalid message format" });
      }

      const messageTimestamp = parseInt(timestampMatch[1], 10);
      const now = Date.now();
      const fiveMinutesInMs = 5 * 60 * 1000;
      if (now - messageTimestamp > fiveMinutesInMs) {
        return res.status(400).json({ message: "Message expired. Please try again." });
      }

      // Check AI bot whitelist (RESTRICTED FEATURE)
      const { AI_BOT_WHITELISTED_WALLETS } = await import("@shared/config");
      const isWhitelisted = AI_BOT_WHITELISTED_WALLETS.includes(ownerWalletAddress);
      
      if (!isWhitelisted) {
        return res.status(403).json({ 
          message: "AI Trading Bot access is restricted. Your wallet is not whitelisted for this feature." 
        });
      }

      // Validate the private key format (Solana private keys are base58 encoded)
      const { loadKeypairFromPrivateKey } = await import("./solana-sdk");
      try {
        loadKeypairFromPrivateKey(treasuryPrivateKey);
      } catch (error) {
        return res.status(400).json({ 
          message: "Invalid private key format. Must be a valid base58-encoded Solana private key." 
        });
      }

      // Encrypt the private key
      const { encrypt } = await import("./crypto");
      const { ciphertext, iv, authTag } = encrypt(treasuryPrivateKey);
      
      // Generate fingerprint for verification (hash of public key)
      const treasuryKeypair = loadKeypairFromPrivateKey(treasuryPrivateKey);
      const fingerprint = treasuryKeypair.publicKey.toString().slice(0, 8);

      auditLog("save_ai_bot_treasury_key", {
        walletAddress: ownerWalletAddress,
        fingerprint,
        ip: req.ip || "unknown",
      });

      // Get existing config or create new one
      let config = await storage.getAIBotConfig(ownerWalletAddress);
      if (!config) {
        config = await storage.createOrUpdateAIBotConfig({
          ownerWalletAddress,
          enabled: false,
          totalBudget: "0",
          budgetPerTrade: "0.1",
        });
      }

      // Update with encrypted key
      const updated = await storage.createOrUpdateAIBotConfig({
        ownerWalletAddress,
        treasuryKeyCiphertext: ciphertext,
        treasuryKeyIv: iv,
        treasuryKeyAuthTag: authTag,
        treasuryKeyFingerprint: fingerprint,
      });

      res.json({ 
        success: true, 
        message: "Treasury key encrypted and saved successfully",
        fingerprint 
      });
    } catch (error: any) {
      console.error("Save AI bot treasury key error:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // Delete AI bot treasury key
  app.delete("/api/ai-bot/config/treasury-key", authRateLimit, async (req, res) => {
    try {
      const { ownerWalletAddress, signature, message } = req.body;
      
      if (!ownerWalletAddress || !signature || !message) {
        return res.status(400).json({ 
          message: "Missing required fields: ownerWalletAddress, signature, and message are required" 
        });
      }

      // Verify wallet signature
      const { verifyWalletSignature } = await import("./solana-sdk");
      const isValidSignature = await verifyWalletSignature(
        ownerWalletAddress,
        message,
        signature
      );

      if (!isValidSignature) {
        return res.status(401).json({ message: "Invalid signature" });
      }

      // Extract timestamp from message
      const timestampMatch = message.match(/at (\d+)$/);
      if (!timestampMatch) {
        return res.status(400).json({ message: "Invalid message format" });
      }

      const messageTimestamp = parseInt(timestampMatch[1], 10);
      const now = Date.now();
      const fiveMinutesInMs = 5 * 60 * 1000;
      if (now - messageTimestamp > fiveMinutesInMs) {
        return res.status(400).json({ message: "Message expired. Please try again." });
      }

      auditLog("delete_ai_bot_treasury_key", {
        walletAddress: ownerWalletAddress,
        ip: req.ip || "unknown",
      });

      // Remove encrypted key fields
      await storage.createOrUpdateAIBotConfig({
        ownerWalletAddress,
        treasuryKeyCiphertext: null,
        treasuryKeyIv: null,
        treasuryKeyAuthTag: null,
        treasuryKeyFingerprint: null,
      });

      res.json({ success: true, message: "Treasury key deleted successfully" });
    } catch (error: any) {
      console.error("Delete AI bot treasury key error:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // ============ PROJECT-BASED AI BOT ROUTES (LEGACY) ============

  // Manual trigger of AI trading bot
  app.post("/api/projects/:projectId/trigger-ai-bot", authRateLimit, async (req, res) => {
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

      // Verify wallet signature
      const { verifyWalletSignature } = await import("./solana-sdk");
      const isValidSignature = await verifyWalletSignature(
        ownerWalletAddress,
        message,
        signature
      );

      if (!isValidSignature) {
        return res.status(401).json({ message: "Invalid signature" });
      }

      // Extract timestamp from message format: "Trigger AI bot for project {id} at {timestamp}"
      const timestampMatch = message.match(/at (\d+)$/);
      if (!timestampMatch) {
        return res.status(400).json({ message: "Invalid message format" });
      }

      const messageTimestamp = parseInt(timestampMatch[1], 10);
      
      // Check timestamp (5 minute expiry)
      const now = Date.now();
      const fiveMinutesInMs = 5 * 60 * 1000;
      if (now - messageTimestamp > fiveMinutesInMs) {
        return res.status(400).json({ message: "Message expired. Please try again." });
      }

      // Prevent replay attacks
      const signatureHash = crypto.createHash('sha256').update(signature).digest('hex');
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

      auditLog("trigger_ai_bot", {
        projectId: project.id,
        walletAddress: ownerWalletAddress,
        ip: req.ip || "unknown",
      });

      console.log(`Manual AI bot trigger for ${project.name}`);

      // Execute the AI trading bot
      const { triggerAIBotManually } = await import("./ai-bot-scheduler");
      await triggerAIBotManually(project.id);

      res.json({
        success: true,
        message: `AI trading bot executed successfully`,
        projectId: project.id,
      });
    } catch (error: any) {
      console.error("Manual AI bot trigger error:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // Get wallet balances for a project
  app.get("/api/projects/:projectId/wallet-balances", async (req, res) => {
    try {
      const project = await storage.getProject(req.params.projectId);
      if (!project) {
        return res.status(404).json({ message: "Project not found" });
      }

      // Validate wallet addresses
      if (!project.treasuryWalletAddress || !project.tokenMintAddress) {
        return res.status(400).json({ 
          message: "Project missing required wallet configuration" 
        });
      }

      // Validate Solana address format
      const { PublicKey } = await import("@solana/web3.js");
      try {
        new PublicKey(project.treasuryWalletAddress);
      } catch (error) {
        return res.status(400).json({ 
          message: "Invalid treasury wallet address format. Please check your project configuration." 
        });
      }

      try {
        new PublicKey(project.tokenMintAddress);
      } catch (error) {
        return res.status(400).json({ 
          message: "Invalid token mint address format. Please check your project configuration." 
        });
      }

      if (project.isPumpfunToken && project.pumpfunCreatorWallet) {
        try {
          new PublicKey(project.pumpfunCreatorWallet);
        } catch (error) {
          return res.status(400).json({ 
            message: "Invalid PumpFun creator wallet address format. Please check your project configuration." 
          });
        }
      }

      const { getSolBalance, getTokenBalance } = await import("./solana-sdk");

      // Get treasury wallet balances with error handling
      let treasurySOL = 0;
      let treasuryTokens = 0;
      
      try {
        treasurySOL = await getSolBalance(project.treasuryWalletAddress);
      } catch (error) {
        console.error("Error fetching treasury SOL balance:", error);
        return res.status(500).json({ 
          message: "Unable to fetch treasury SOL balance. Please check your wallet address and try again." 
        });
      }

      try {
        treasuryTokens = await getTokenBalance(
          project.tokenMintAddress,
          project.treasuryWalletAddress
        );
      } catch (error) {
        console.error("Error fetching treasury token balance:", error);
        return res.status(500).json({ 
          message: "Unable to fetch treasury token balance. Please check your token mint address and try again." 
        });
      }

      // Get PumpFun creator wallet balance if applicable
      let pumpfunCreatorSOL = 0;
      if (project.isPumpfunToken && project.pumpfunCreatorWallet) {
        try {
          pumpfunCreatorSOL = await getSolBalance(project.pumpfunCreatorWallet);
        } catch (error) {
          console.error("Error fetching PumpFun creator SOL balance:", error);
          // Don't fail the entire request if PumpFun balance fails
          pumpfunCreatorSOL = 0;
        }
      }

      res.json({
        treasury: {
          solBalance: treasurySOL,
          tokenBalance: treasuryTokens,
          walletAddress: project.treasuryWalletAddress,
        },
        pumpfunCreator: project.isPumpfunToken && project.pumpfunCreatorWallet ? {
          solBalance: pumpfunCreatorSOL,
          walletAddress: project.pumpfunCreatorWallet,
        } : null,
      });
    } catch (error: any) {
      console.error("Error fetching wallet balances:", error);
      res.status(500).json({ 
        message: "An unexpected error occurred while fetching wallet balances. Please try again." 
      });
    }
  });

  // Manual claim PumpFun creator rewards endpoint
  app.post("/api/projects/:projectId/manual-claim", async (req, res) => {
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

      // Check if this is a PumpFun token
      if (!project.isPumpfunToken || !project.pumpfunCreatorWallet) {
        return res.status(400).json({ 
          message: "This project is not configured as a PumpFun token. Enable PumpFun integration in project settings first." 
        });
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

      // Verify message format and timestamp
      const expectedMessagePrefix = `Claim creator rewards for project ${project.id}`;
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

      // Get PumpFun creator private key
      const { getPumpFunKey } = await import("./key-manager");
      const creatorPrivateKey = await getPumpFunKey(project.id);
      
      if (!creatorPrivateKey) {
        return res.status(400).json({ 
          message: "PumpFun creator private key not configured. Please configure it in Settings first." 
        });
      }

      // Check if there are unclaimed rewards BEFORE storing signature
      const { hasUnclaimedRewards, claimCreatorRewardsFull } = await import("./pumpfun");
      const hasRewards = await hasUnclaimedRewards(
        project.pumpfunCreatorWallet,
        project.tokenMintAddress
      );

      if (!hasRewards) {
        return res.status(400).json({ 
          message: "No unclaimed rewards available for this project at this time." 
        });
      }

      // Store signature hash to prevent replay attacks (after successful preflight checks)
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

      console.log(`Manual claim initiated for ${project.name}`);

      // Execute claim
      try {
        const claimResult = await claimCreatorRewardsFull(
          project.pumpfunCreatorWallet,
          creatorPrivateKey,
          project.tokenMintAddress
        );

        if (claimResult.success && claimResult.signature) {
          // Log successful claim transaction
          await storage.createTransaction({
            projectId: project.id,
            type: "claim",
            amount: claimResult.amount?.toString() || "0",
            tokenAmount: "0",
            txSignature: claimResult.signature,
            status: "completed",
            errorMessage: null,
          });

          console.log(`Manual claim completed: ${claimResult.signature}`);

          res.json({
            success: true,
            message: `Successfully claimed ${claimResult.amount || 0} SOL in creator rewards`,
            signature: claimResult.signature,
            amount: claimResult.amount || 0,
            projectId: project.id,
          });
        } else {
          throw new Error(claimResult.error || "Failed to claim rewards");
        }
      } catch (claimError: any) {
        console.error("Claim execution error:", claimError);

        // Log failed claim transaction
        await storage.createTransaction({
          projectId: project.id,
          type: "buyback",
          amount: "0",
          tokenAmount: "0",
          txSignature: "",
          status: "failed",
          errorMessage: claimError.message,
        });

        throw new Error(`Failed to execute claim: ${claimError.message}`);
      }
    } catch (error: any) {
      console.error("Manual claim error:", error);
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
  // Set project keys - HIGHLY SENSITIVE - Requires wallet signature authentication
  app.post("/api/projects/:id/keys", strictRateLimit, validateSolanaAddresses, async (req, res) => {
    auditLog("Private keys update attempted", {
      projectId: req.params.id,
      ip: req.ip,
    });
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
  // Delete project keys - HIGHLY SENSITIVE - Requires wallet signature authentication  
  app.delete("/api/projects/:id/keys", strictRateLimit, validateSolanaAddresses, async (req, res) => {
    auditLog("Private keys deletion attempted", {
      projectId: req.params.id,
      ip: req.ip,
    });
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

  // Utility: Fix positions with zero tokenAmount by querying blockchain
  app.post("/api/ai-bot/fix-zero-positions/:walletAddress", async (req, res) => {
    try {
      const { walletAddress } = req.params;
      
      console.log(`[Fix Zero Positions] Starting for wallet ${walletAddress}...`);
      
      // Get all positions with zero tokenAmount
      const { getTokenBalance } = await import("./solana-sdk");
      const positions = await storage.getAIBotPositions(walletAddress);
      const zeroPositions = positions.filter(p => {
        const amount = parseFloat(p.tokenAmount);
        return amount === 0 || isNaN(amount);
      });

      if (zeroPositions.length === 0) {
        return res.json({
          message: "No positions with zero tokenAmount found",
          fixed: 0,
          total: positions.length,
        });
      }

      console.log(`[Fix Zero Positions] Found ${zeroPositions.length} positions with zero tokenAmount`);

      // Get the wallet's private key to derive public key
      const config = await storage.getAIBotConfig(walletAddress);
      if (!config) {
        console.log(`[Fix Zero Positions] AI bot config not found for wallet ${walletAddress}`);
        return res.status(404).json({ message: "AI bot config not found" });
      }

      console.log(`[Fix Zero Positions] Config found: ${config.id}`);
      console.log(`[Fix Zero Positions] Has ciphertext: ${!!config.treasuryKeyCiphertext}`);
      console.log(`[Fix Zero Positions] Has IV: ${!!config.treasuryKeyIv}`);
      console.log(`[Fix Zero Positions] Has auth tag: ${!!config.treasuryKeyAuthTag}`);

      // AI bot configs store treasury keys directly in the config table
      if (!config.treasuryKeyCiphertext || !config.treasuryKeyIv || !config.treasuryKeyAuthTag) {
        console.log(`[Fix Zero Positions] Missing encrypted key components`);
        return res.status(404).json({ message: "No treasury key configured for this AI bot" });
      }

      // Decrypt the treasury key
      console.log(`[Fix Zero Positions] Decrypting treasury key...`);
      const { decrypt } = await import("./crypto");
      const treasuryKey = decrypt(
        config.treasuryKeyCiphertext,
        config.treasuryKeyIv,
        config.treasuryKeyAuthTag
      );
      console.log(`[Fix Zero Positions] Treasury key decrypted successfully`);

      const { loadKeypairFromPrivateKey } = await import("./solana-sdk");
      const keypair = loadKeypairFromPrivateKey(treasuryKey);
      const publicKey = keypair.publicKey.toString();

      let fixed = 0;
      let failed = 0;

      // Query actual balances and update positions
      for (const position of zeroPositions) {
        try {
          const actualBalance = await getTokenBalance(position.tokenMint, publicKey);
          
          if (actualBalance > 0) {
            await storage.updateAIBotPosition(position.id, {
              tokenAmount: actualBalance.toString(),
            });
            console.log(`[Fix Zero Positions] ✅ Fixed ${position.tokenSymbol}: ${actualBalance} tokens`);
            fixed++;
          } else {
            console.log(`[Fix Zero Positions] ⚠️ ${position.tokenSymbol}: Balance is still 0 (likely sold or never received)`);
            failed++;
          }
        } catch (error) {
          console.error(`[Fix Zero Positions] ❌ Error fixing ${position.tokenSymbol}:`, error);
          failed++;
        }
      }

      res.json({
        message: `Fixed ${fixed} positions, ${failed} failed or empty`,
        fixed,
        failed,
        total: zeroPositions.length,
        positions: zeroPositions.map(p => ({
          symbol: p.tokenSymbol,
          mint: p.tokenMint,
        })),
      });
    } catch (error: any) {
      console.error("[Fix Zero Positions] Error:", error);
      res.status(500).json({ message: error.message });
    }
  });

  const httpServer = createServer(app);
  return httpServer;
}
