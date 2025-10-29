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

  // LEGACY: Manual AI bot execution route removed (project-based system deprecated)
  // Standalone AI bot now runs automatically via scheduler
  // See /api/ai-bot/* routes for new system

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

  // Manually trigger hivemind strategy regeneration with AI learning
  app.post("/api/ai-bot/regenerate-strategy/:ownerWalletAddress", async (req, res) => {
    try {
      const { ownerWalletAddress } = req.params;
      const { generateHivemindStrategy, saveHivemindStrategy } = await import("./hivemind-strategy");
      
      console.log(`[API] Manual strategy regeneration triggered for ${ownerWalletAddress}`);
      
      // Get recent trading performance to feed to AI
      const allPositions = await storage.getAIBotPositions(ownerWalletAddress);
      // Get closed positions from transaction history (sold positions)
      const completedPositions = allPositions.filter((p: any) => 
        p.lastCheckPriceSOL && parseFloat(p.lastCheckPriceSOL.toString()) > 0
      );
      const recentTrades = completedPositions.slice(0, 20); // Last 20 trades
      
      let recentPerformance: {
        winRate: number;
        avgProfit: number;
        totalTrades: number;
        recentTrades?: Array<{
          tokenSymbol: string;
          profit: number;
          holdTime: number;
          entryConfidence: number;
        }>;
      } | undefined = undefined;
      
      if (recentTrades.length >= 3) {
        const wins = recentTrades.filter((t: any) => (t.exitPriceSOL || 0) > (t.entryPriceSOL || 0)).length;
        const winRate = (wins / recentTrades.length) * 100;
        
        const profits = recentTrades.map((t: any) => {
          const entry = t.entryPriceSOL || 0;
          const exit = t.exitPriceSOL || 0;
          return entry > 0 ? ((exit - entry) / entry) * 100 : 0;
        });
        const avgProfit = profits.reduce((a: number, b: number) => a + b, 0) / profits.length;
        
        recentPerformance = {
          winRate,
          avgProfit,
          totalTrades: recentTrades.length,
          recentTrades: recentTrades.map((t: any) => ({
            tokenSymbol: t.tokenSymbol || 'UNKNOWN',
            profit: t.entryPriceSOL && t.exitPriceSOL 
              ? ((t.exitPriceSOL - t.entryPriceSOL) / t.entryPriceSOL) * 100 
              : 0,
            holdTime: t.exitedAt && t.createdAt 
              ? t.exitedAt.getTime() - t.createdAt.getTime() 
              : 0,
            entryConfidence: 75, // Default if not stored
          })),
        };
      }
      
      // Generate new strategy using AI
      const newStrategy = await generateHivemindStrategy(ownerWalletAddress, recentPerformance);
      
      // Save to database
      await saveHivemindStrategy(ownerWalletAddress, newStrategy);
      
      console.log(`[API] ✅ New AI-powered strategy generated and saved for ${ownerWalletAddress}`);
      
      res.json({
        success: true,
        message: "Strategy regenerated successfully using AI hivemind",
        strategy: newStrategy,
        performanceData: recentPerformance,
      });
    } catch (error: any) {
      console.error("[API] Error regenerating strategy:", error);
      res.status(500).json({ 
        success: false,
        message: error.message 
      });
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

  // Close all positions and restart bot
  app.post("/api/ai-bot/close-all-positions/:ownerWalletAddress", async (req, res) => {
    try {
      const { ownerWalletAddress } = req.params;

      // Verify wallet is whitelisted
      const { AI_BOT_WHITELISTED_WALLETS } = await import("@shared/config");
      const isWhitelisted = AI_BOT_WHITELISTED_WALLETS.includes(ownerWalletAddress);
      
      if (!isWhitelisted) {
        return res.status(403).json({ 
          message: "Access denied: Only whitelisted wallets can close all positions" 
        });
      }

      console.log(`[API] Closing all positions for ${ownerWalletAddress}...`);

      // Get bot config for treasury key
      const config = await storage.getAIBotConfig(ownerWalletAddress);
      if (!config || !config.treasuryKeyCiphertext || !config.treasuryKeyIv || !config.treasuryKeyAuthTag) {
        return res.status(404).json({ message: "AI bot config or treasury key not found" });
      }

      // Decrypt treasury key
      const { decrypt } = await import("./crypto");
      const treasuryKeyBase58 = decrypt(
        config.treasuryKeyCiphertext,
        config.treasuryKeyIv,
        config.treasuryKeyAuthTag
      );

      // Get all active positions
      const positions = await storage.getAIBotPositions(ownerWalletAddress);
      console.log(`[API] Found ${positions.length} positions to close`);

      if (positions.length === 0) {
        return res.json({ 
          success: true,
          message: "No positions to close",
          positionsClosed: 0,
          errors: []
        });
      }

      // Close each position
      const { sellTokenWithFallback } = await import("./jupiter");
      const results = [];
      const errors = [];

      for (const position of positions) {
        try {
          const tokenAmount = parseFloat(position.tokenAmount);
          if (tokenAmount === 0 || isNaN(tokenAmount)) {
            console.log(`[API] Skipping ${position.tokenSymbol}: Zero token amount`);
            await storage.deleteAIBotPosition(position.id);
            continue;
          }

          const tokenAmountRaw = Math.floor(tokenAmount);
          console.log(`[API] Selling ${position.tokenSymbol}: ${tokenAmountRaw} tokens`);

          // Sell with 5% slippage
          const sellResult = await sellTokenWithFallback(
            treasuryKeyBase58,
            position.tokenMint,
            tokenAmountRaw,
            500 // 5% slippage
          );

          if (sellResult.success && sellResult.signature) {
            console.log(`[API] ✅ Sold ${position.tokenSymbol}: ${sellResult.signature}`);
            results.push({
              tokenSymbol: position.tokenSymbol,
              success: true,
              signature: sellResult.signature
            });
          } else {
            console.error(`[API] ❌ Failed to sell ${position.tokenSymbol}: ${sellResult.error}`);
            errors.push({
              tokenSymbol: position.tokenSymbol,
              error: sellResult.error || "Unknown error"
            });
          }

          // Delete position from database
          await storage.deleteAIBotPosition(position.id);
        } catch (error: any) {
          console.error(`[API] Error closing position ${position.tokenSymbol}:`, error);
          errors.push({
            tokenSymbol: position.tokenSymbol,
            error: error.message
          });
        }
      }

      // Reset bot state
      await storage.createOrUpdateAIBotConfig({
        ownerWalletAddress,
        portfolioPeakSOL: "0",
        budgetUsed: "0",
      });

      console.log(`[API] ✅ Closed ${results.length} positions, ${errors.length} errors`);

      res.json({
        success: true,
        message: `Closed ${results.length} positions successfully`,
        positionsClosed: results.length,
        results,
        errors
      });
    } catch (error: any) {
      console.error("[API] Error closing all positions:", error);
      res.status(500).json({ 
        success: false,
        message: error.message 
      });
    }
  });

  // Get trade journal entries for analysis
  app.get("/api/ai-bot/trade-journal/:ownerWalletAddress", async (req, res) => {
    try {
      const { ownerWalletAddress } = req.params;
      const limit = req.query.limit ? parseInt(req.query.limit as string) : undefined;
      
      const entries = await storage.getTradeJournalEntries(ownerWalletAddress, limit);
      res.json({ success: true, entries });
    } catch (error: any) {
      console.error("[API] Error fetching trade journal:", error);
      res.status(500).json({ success: false, message: error.message });
    }
  });

  // Get trade pattern analysis
  app.get("/api/ai-bot/trade-patterns/:ownerWalletAddress", async (req, res) => {
    try {
      const { ownerWalletAddress } = req.params;
      const patterns = await storage.getTradePatterns(ownerWalletAddress);
      res.json({ success: true, patterns });
    } catch (error: any) {
      console.error("[API] Error fetching trade patterns:", error);
      res.status(500).json({ success: false, message: error.message });
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

      // Check subscription/free trades access
      const config = await storage.getAIBotConfig(ownerWalletAddress);
      if (!config) {
        return res.status(404).json({ message: "AI bot config not found" });
      }

      const { hasAIBotAccess, getAccessStatusMessage } = await import("./subscription-access");
      const hasAccess = hasAIBotAccess({
        freeTradesUsed: config.freeTradesUsed || 0,
        subscriptionActive: config.subscriptionActive || false,
        subscriptionExpiresAt: config.subscriptionExpiresAt || null,
      }, ownerWalletAddress);
      
      if (!hasAccess) {
        const statusMessage = getAccessStatusMessage({
          freeTradesUsed: config.freeTradesUsed || 0,
          subscriptionActive: config.subscriptionActive || false,
          subscriptionExpiresAt: config.subscriptionExpiresAt || null,
        }, ownerWalletAddress);
        return res.status(403).json({ 
          message: `AI Trading Bot access denied: ${statusMessage.message}` 
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

  // Trigger manual portfolio rebalancing (force immediate rebalance)
  app.post("/api/ai-bot/trigger-rebalance", async (req, res) => {
    try {
      console.log("[Manual Rebalance] 🔄 Triggering immediate portfolio rebalancing...");

      // Import and execute the rebalancing function
      const { rebalancePortfolioWithOpenAI } = await import("./ai-bot-scheduler");
      
      // Execute rebalancing asynchronously (don't wait for completion)
      rebalancePortfolioWithOpenAI().catch((error) => {
        console.error("[Manual Rebalance] Error during rebalancing:", error);
      });

      // Return immediately to user
      res.json({
        success: true,
        message: "Portfolio rebalancing triggered successfully. Check activity logs for results.",
        timestamp: new Date().toISOString(),
      });

    } catch (error: any) {
      console.error("[Manual Rebalance] Error:", error);
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

      // Check access: 10 free trades OR active subscription
      let config = await storage.getAIBotConfig(ownerWalletAddress);
      if (!config) {
        // Create default config for new user
        config = await storage.createOrUpdateAIBotConfig({
          ownerWalletAddress,
          enabled: false,
          totalBudget: "0",
          budgetPerTrade: "0.02",
        });
      }

      const currentTime = new Date();
      const freeTradesRemaining = Math.max(0, 10 - config.freeTradesUsed);
      const hasActiveSubscription = config.subscriptionActive && 
        config.subscriptionExpiresAt && 
        new Date(config.subscriptionExpiresAt) > currentTime;

      const hasAccess = freeTradesRemaining > 0 || hasActiveSubscription;

      if (!hasAccess) {
        return res.status(403).json({ 
          message: "No trading access. You've used your 10 free trades. Please purchase 2-week access for 0.15 SOL to continue.",
          requiresPayment: true,
          freeTradesUsed: config.freeTradesUsed,
        });
      }

      // If using a free trade (not on subscription), increment free trades used
      if (!hasActiveSubscription && freeTradesRemaining > 0) {
        await storage.incrementFreeTradesUsed(ownerWalletAddress);
        console.log(`[Free Trade] Used trade ${config.freeTradesUsed + 1}/10 for ${ownerWalletAddress}`);
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

      // Check access: 10 free trades OR active subscription
      const existingConfig = await storage.getAIBotConfig(ownerWalletAddress);
      if (existingConfig) {
        const now = new Date();
        const freeTradesRemaining = Math.max(0, 10 - existingConfig.freeTradesUsed);
        const hasActiveSubscription = existingConfig.subscriptionActive && 
          existingConfig.subscriptionExpiresAt && 
          new Date(existingConfig.subscriptionExpiresAt) > now;

        const hasAccess = freeTradesRemaining > 0 || hasActiveSubscription;

        if (!hasAccess) {
          return res.status(403).json({ 
            message: "No trading access. You've used your 10 free trades. Please purchase 2-week access for 0.15 SOL to continue.",
            requiresPayment: true,
            freeTradesUsed: existingConfig.freeTradesUsed,
          });
        }
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

      // Check subscription/free trades access
      const existingConfig = await storage.getAIBotConfig(ownerWalletAddress);
      if (existingConfig) {
        const { hasAIBotAccess, getAccessStatusMessage } = await import("./subscription-access");
        const hasAccess = hasAIBotAccess({
          freeTradesUsed: existingConfig.freeTradesUsed || 0,
          subscriptionActive: existingConfig.subscriptionActive || false,
          subscriptionExpiresAt: existingConfig.subscriptionExpiresAt || null,
        });
        
        if (!hasAccess) {
          const statusMessage = getAccessStatusMessage({
            freeTradesUsed: existingConfig.freeTradesUsed || 0,
            subscriptionActive: existingConfig.subscriptionActive || false,
            subscriptionExpiresAt: existingConfig.subscriptionExpiresAt || null,
          });
          return res.status(403).json({ 
            message: `AI Trading Bot access denied: ${statusMessage.message}` 
          });
        }
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

  // ============ AI RECOVERY MODE ENDPOINTS ============
  // Activate recovery mode (36-hour Grok-only mode for cost savings during recovery)
  // ADMIN ONLY: Restricted to whitelisted wallets
  app.post("/api/ai-bot/recovery-mode/activate", authRateLimit, async (req, res) => {
    try {
      const { ownerWalletAddress, signature, message, durationHours, reason } = req.body;
      
      if (!ownerWalletAddress || !signature || !message) {
        return res.status(400).json({ 
          message: "Missing required fields: ownerWalletAddress, signature, and message are required" 
        });
      }

      // Verify wallet is whitelisted (admin access only)
      const { AI_BOT_WHITELISTED_WALLETS } = await import("@shared/config");
      const isWhitelisted = AI_BOT_WHITELISTED_WALLETS.includes(ownerWalletAddress);
      
      if (!isWhitelisted) {
        return res.status(403).json({ 
          message: "Unauthorized: Recovery mode activation is restricted to admin wallets only" 
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

      // Default to 36 hours if not specified
      const hours = durationHours || 36;
      const endsAt = new Date(Date.now() + hours * 60 * 60 * 1000);

      auditLog("activate_recovery_mode", {
        walletAddress: ownerWalletAddress,
        durationHours: hours,
        endsAt: endsAt.toISOString(),
        reason: reason || "User initiated",
        ip: req.ip || "unknown",
      });

      // Create recovery mode configuration
      const recoveryMode = await storage.activateRecoveryMode({
        enabled: true,
        startedAt: new Date(),
        endsAt,
        recoveryProvider: "xAI Grok",
        reason: reason || "User initiated recovery mode",
        activatedBy: ownerWalletAddress,
      });

      console.log(`[Recovery Mode] 🔧 ACTIVATED by ${ownerWalletAddress} - Duration: ${hours}h, Ends: ${endsAt.toISOString()}`);

      res.json({
        success: true,
        message: `Recovery mode activated for ${hours} hours`,
        recoveryMode,
        endsAt: endsAt.toISOString(),
      });
    } catch (error: any) {
      console.error("Activate recovery mode error:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // Get recovery mode status
  app.get("/api/ai-bot/recovery-mode/status", async (req, res) => {
    try {
      const recoveryMode = await storage.getRecoveryModeStatus();
      
      if (!recoveryMode || !recoveryMode.enabled) {
        return res.json({
          active: false,
          message: "Recovery mode is not active. Using normal 4-team rotation.",
        });
      }

      const now = new Date();
      const isExpired = recoveryMode.endsAt && now > recoveryMode.endsAt;

      if (isExpired) {
        return res.json({
          active: false,
          message: "Recovery mode period has ended. System will resume 4-team rotation on next scan.",
          lastRecoveryMode: recoveryMode,
        });
      }

      const hoursRemaining = recoveryMode.endsAt 
        ? ((recoveryMode.endsAt.getTime() - now.getTime()) / (1000 * 60 * 60)).toFixed(1)
        : 'unlimited';

      res.json({
        active: true,
        recoveryMode,
        hoursRemaining,
        message: `Recovery mode active - using ${recoveryMode.recoveryProvider} only`,
      });
    } catch (error: any) {
      console.error("Get recovery mode status error:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // Manually deactivate recovery mode
  // ADMIN ONLY: Restricted to whitelisted wallets
  app.post("/api/ai-bot/recovery-mode/deactivate", authRateLimit, async (req, res) => {
    try {
      const { ownerWalletAddress, signature, message } = req.body;
      
      if (!ownerWalletAddress || !signature || !message) {
        return res.status(400).json({ 
          message: "Missing required fields: ownerWalletAddress, signature, and message are required" 
        });
      }

      // Verify wallet is whitelisted (admin access only)
      const { AI_BOT_WHITELISTED_WALLETS } = await import("@shared/config");
      const isWhitelisted = AI_BOT_WHITELISTED_WALLETS.includes(ownerWalletAddress);
      
      if (!isWhitelisted) {
        return res.status(403).json({ 
          message: "Unauthorized: Recovery mode deactivation is restricted to admin wallets only" 
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

      auditLog("deactivate_recovery_mode", {
        walletAddress: ownerWalletAddress,
        ip: req.ip || "unknown",
      });

      await storage.deactivateRecoveryMode();

      console.log(`[Recovery Mode] ✅ DEACTIVATED by ${ownerWalletAddress} - Resuming 4-team rotation`);

      res.json({
        success: true,
        message: "Recovery mode deactivated. System will resume 4-team rotation on next scan.",
      });
    } catch (error: any) {
      console.error("Deactivate recovery mode error:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // ============ LEGACY PROJECT-BASED AI BOT ROUTE REMOVED ============
  // Project-based AI bot has been replaced with standalone AI bot system
  // See /api/ai-bot/* routes above

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
      
      // Use constant-time comparison to prevent timing attacks
      const messagePrefix = message.substring(0, expectedMessagePrefix.length);
      const expectedBuffer = Buffer.from(expectedMessagePrefix, 'utf8');
      const actualBuffer = Buffer.from(messagePrefix, 'utf8');
      
      // Pad buffers to same length to ensure constant-time comparison works
      const maxLength = Math.max(expectedBuffer.length, actualBuffer.length);
      const paddedExpected = Buffer.alloc(maxLength);
      const paddedActual = Buffer.alloc(maxLength);
      expectedBuffer.copy(paddedExpected);
      actualBuffer.copy(paddedActual);
      
      let isValidPrefix = false;
      try {
        isValidPrefix = crypto.timingSafeEqual(paddedExpected, paddedActual);
      } catch (error) {
        isValidPrefix = false;
      }
      
      if (!isValidPrefix) {
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
      let removed = 0;
      let failed = 0;

      // Query actual balances and update/remove positions
      for (const position of zeroPositions) {
        try {
          const actualBalance = await getTokenBalance(position.tokenMint, publicKey);
          
          if (actualBalance > 0) {
            // Token exists on-chain - update position with actual balance
            await storage.updateAIBotPosition(position.id, {
              tokenAmount: actualBalance.toString(),
            });
            console.log(`[Fix Zero Positions] ✅ Fixed ${position.tokenSymbol}: ${actualBalance} tokens`);
            fixed++;
          } else {
            // Token doesn't exist on-chain (fully sold or never received) - remove position
            await storage.deleteAIBotPosition(position.id);
            console.log(`[Fix Zero Positions] 🗑️ Removed ${position.tokenSymbol}: No tokens on-chain (position closed)`);
            removed++;
          }
        } catch (error: any) {
          // If token account doesn't exist on-chain, treat as zero balance and remove
          const errorMsg = error?.message?.toLowerCase() || "";
          if (errorMsg.includes("could not find account") || errorMsg.includes("invalid param")) {
            await storage.deleteAIBotPosition(position.id);
            console.log(`[Fix Zero Positions] 🗑️ Removed ${position.tokenSymbol}: Token account doesn't exist on-chain`);
            removed++;
          } else {
            console.error(`[Fix Zero Positions] ❌ Error fixing ${position.tokenSymbol}:`, error);
            failed++;
          }
        }
      }

      res.json({
        message: `Fixed ${fixed} positions, removed ${removed} non-existent positions, ${failed} errors`,
        fixed,
        removed,
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

  // Import all wallet token holdings as AI bot positions
  app.post("/api/ai-bot/import-wallet-holdings", async (req, res) => {
    try {
      const { ownerWalletAddress } = req.body;
      
      if (!ownerWalletAddress) {
        return res.status(400).json({ message: "Owner wallet address required" });
      }
      
      console.log(`[Import Holdings] Starting import for wallet ${ownerWalletAddress.slice(0, 8)}...`);
      
      // Get AI bot config to access treasury wallet
      const config = await storage.getAIBotConfig(ownerWalletAddress);
      if (!config) {
        return res.status(404).json({ message: "AI bot config not found. Please set up the AI bot first." });
      }
      
      if (!config.treasuryKeyCiphertext || !config.treasuryKeyIv || !config.treasuryKeyAuthTag) {
        return res.status(404).json({ message: "No treasury key configured. Please add a treasury private key first." });
      }
      
      // Decrypt treasury key to get the actual trading wallet
      const { decrypt } = await import("./crypto");
      const treasuryKey = decrypt(
        config.treasuryKeyCiphertext,
        config.treasuryKeyIv,
        config.treasuryKeyAuthTag
      );
      
      const { loadKeypairFromPrivateKey } = await import("./solana-sdk");
      const keypair = loadKeypairFromPrivateKey(treasuryKey);
      const treasuryPublicKey = keypair.publicKey.toString();
      
      console.log(`[Import Holdings] Treasury wallet: ${treasuryPublicKey.slice(0, 8)}...`);
      
      // Get all token accounts from blockchain
      const { getAllTokenAccounts } = await import("./solana");
      const tokenAccounts = await getAllTokenAccounts(treasuryPublicKey);
      
      console.log(`[Import Holdings] Found ${tokenAccounts.length} token accounts on-chain`);
      
      // Get existing positions from database
      const existingPositions = await storage.getAIBotPositions(ownerWalletAddress);
      const existingMints = new Set(existingPositions.map(p => p.tokenMint));
      
      let imported = 0;
      let skipped = 0;
      let errors = 0;
      const importedTokens: any[] = [];
      
      // Process each token account
      for (const account of tokenAccounts) {
        try {
          const parsed = account.account.data.parsed;
          const tokenMint = parsed.info.mint;
          const uiAmount = parsed.info.tokenAmount.uiAmount;
          const amount = parsed.info.tokenAmount.amount;
          const decimals = parsed.info.tokenAmount.decimals;
          
          // Skip if zero balance
          if (uiAmount <= 0) {
            continue;
          }
          
          // Skip if already tracked
          if (existingMints.has(tokenMint)) {
            skipped++;
            console.log(`[Import Holdings] ⏭️ Skipping ${tokenMint.slice(0, 8)}... (already tracked)`);
            continue;
          }
          
          // Fetch token metadata from DexScreener
          console.log(`[Import Holdings] 📡 Fetching metadata for ${tokenMint.slice(0, 8)}...`);
          
          let tokenSymbol = tokenMint.slice(0, 6);
          let tokenName = tokenSymbol;
          
          try {
            const dexResponse = await fetch(
              `https://api.dexscreener.com/latest/dex/tokens/${tokenMint}`,
              { headers: { 'Accept': 'application/json' } }
            );
            
            if (dexResponse.ok) {
              const dexData = await dexResponse.json();
              const pairs = dexData.pairs || [];
              
              if (pairs.length > 0) {
                const mainPair = pairs[0];
                tokenSymbol = mainPair.baseToken?.symbol || tokenSymbol;
                tokenName = mainPair.baseToken?.name || tokenSymbol;
              }
            }
          } catch (error) {
            console.log(`[Import Holdings] ⚠️ Could not fetch metadata for ${tokenMint.slice(0, 8)}, using fallback`);
          }
          
          // Get current price from Jupiter
          const { getTokenPrice } = await import("./jupiter");
          let currentPriceSOL = 0;
          try {
            currentPriceSOL = await getTokenPrice(tokenMint);
          } catch (error) {
            console.log(`[Import Holdings] ⚠️ Could not fetch price for ${tokenSymbol}, using 0`);
          }
          
          // Create position in database (use current price as entry price since we don't know actual entry)
          const position = await storage.createAIBotPosition({
            ownerWalletAddress,
            tokenMint,
            tokenSymbol,
            tokenName,
            entryPriceSOL: currentPriceSOL.toString(),
            amountSOL: (currentPriceSOL * uiAmount).toString(),
            tokenAmount: String(amount),
            tokenDecimals: Number(decimals),
            buyTxSignature: "imported", // Mark as imported, not from a trade
            aiConfidenceAtBuy: 0, // Unknown since manually imported
            aiPotentialAtBuy: "0",
            rebuyCount: 0,
            isSwingTrade: 0,
          });
          
          imported++;
          importedTokens.push({
            symbol: tokenSymbol,
            name: tokenName,
            mint: tokenMint,
            amount: uiAmount,
            valueSOL: currentPriceSOL * uiAmount,
          });
          
          console.log(`[Import Holdings] ✅ Imported ${tokenSymbol}: ${uiAmount} tokens @ ${currentPriceSOL} SOL`);
          
        } catch (error: any) {
          console.error(`[Import Holdings] ❌ Error importing token:`, error);
          errors++;
        }
      }
      
      console.log(`[Import Holdings] ✅ Complete: ${imported} imported, ${skipped} skipped, ${errors} errors`);
      
      res.json({
        success: true,
        message: `Successfully imported ${imported} token holdings`,
        imported,
        skipped,
        errors,
        totalExisting: existingPositions.length,
        totalNow: existingPositions.length + imported,
        importedTokens,
      });
    } catch (error: any) {
      console.error("[Import Holdings] Error:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // AI Bot Subscription Routes (10 free trades, then 0.15 SOL for 2 weeks)
  app.get("/api/ai-bot/subscription/status/:ownerWalletAddress", async (req, res) => {
    try {
      const { ownerWalletAddress } = req.params;
      
      // Get or create config
      let config = await storage.getAIBotConfig(ownerWalletAddress);
      if (!config) {
        // Create default config for new user
        config = await storage.createOrUpdateAIBotConfig({
          ownerWalletAddress,
          enabled: false,
          totalBudget: "0",
          budgetPerTrade: "0.02",
        });
      }

      const now = new Date();
      const freeTradesRemaining = Math.max(0, 10 - config.freeTradesUsed);
      const hasActiveSubscription = config.subscriptionActive && 
        config.subscriptionExpiresAt && 
        new Date(config.subscriptionExpiresAt) > now;

      res.json({
        freeTradesUsed: config.freeTradesUsed,
        freeTradesRemaining,
        subscriptionActive: hasActiveSubscription,
        subscriptionExpiresAt: config.subscriptionExpiresAt,
        hasAccess: freeTradesRemaining > 0 || hasActiveSubscription,
        requiresPayment: freeTradesRemaining === 0 && !hasActiveSubscription,
      });
    } catch (error: any) {
      console.error("Get subscription status error:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/ai-bot/subscription/verify-payment", authRateLimit, async (req, res) => {
    try {
      const { ownerWalletAddress, txSignature, signature, message } = req.body;
      
      if (!ownerWalletAddress || !txSignature || !signature || !message) {
        return res.status(400).json({ 
          message: "Missing required fields: ownerWalletAddress, txSignature, signature, and message are required" 
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

      // Verify the transaction on-chain
      const { Connection, PublicKey } = await import("@solana/web3.js");
      const connection = new Connection(process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com");
      
      const TREASURY_WALLET = "jawKuQ3xtcYoAuqE9jyG2H35sv2pWJSzsyjoNpsxG38";
      const SUBSCRIPTION_PRICE_SOL = 0.15;
      const SUBSCRIPTION_PRICE_LAMPORTS = SUBSCRIPTION_PRICE_SOL * 1e9;

      let transaction;
      try {
        transaction = await connection.getTransaction(txSignature, {
          maxSupportedTransactionVersion: 0,
        });
      } catch (error: any) {
        return res.status(400).json({ 
          message: "Failed to verify transaction on blockchain. Please try again." 
        });
      }

      if (!transaction) {
        return res.status(400).json({ 
          message: "Transaction not found on blockchain. Please wait a moment and try again." 
        });
      }

      // Verify transaction succeeded
      if (transaction.meta?.err) {
        return res.status(400).json({ 
          message: "Transaction failed on blockchain" 
        });
      }

      // Verify sender is the wallet address
      const senderPubkey = transaction.transaction.message.getAccountKeys().get(0)?.toString();
      if (senderPubkey !== ownerWalletAddress) {
        return res.status(400).json({ 
          message: "Transaction sender does not match wallet address" 
        });
      }

      // Verify recipient and amount
      const postBalances = transaction.meta?.postBalances || [];
      const preBalances = transaction.meta?.preBalances || [];
      const accountKeys = transaction.transaction.message.getAccountKeys();
      
      let treasuryIndex = -1;
      for (let i = 0; i < accountKeys.length; i++) {
        if (accountKeys.get(i)?.toString() === TREASURY_WALLET) {
          treasuryIndex = i;
          break;
        }
      }

      if (treasuryIndex === -1) {
        return res.status(400).json({ 
          message: "Payment must be sent to the treasury wallet" 
        });
      }

      const amountReceived = postBalances[treasuryIndex] - preBalances[treasuryIndex];
      if (amountReceived < SUBSCRIPTION_PRICE_LAMPORTS) {
        return res.status(400).json({ 
          message: `Payment amount insufficient. Required: ${SUBSCRIPTION_PRICE_SOL} SOL, Received: ${amountReceived / 1e9} SOL` 
        });
      }

      // Activate subscription for 2 weeks
      const expiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000); // 2 weeks from now

      const updatedConfig = await storage.updateAIBotSubscription(ownerWalletAddress, {
        subscriptionActive: true,
        subscriptionExpiresAt: expiresAt,
        subscriptionPaymentTxSignature: txSignature,
      });

      auditLog("ai_bot_subscription_payment", {
        walletAddress: ownerWalletAddress,
        txSignature,
        amount: amountReceived / 1e9,
        expiresAt: expiresAt.toISOString(),
        ip: req.ip || "unknown",
      });

      console.log(`[Subscription] ✅ Activated 2-week subscription for ${ownerWalletAddress} until ${expiresAt.toISOString()}`);

      res.json({
        success: true,
        message: "Subscription activated successfully",
        expiresAt: expiresAt.toISOString(),
        freeTradesUsed: updatedConfig.freeTradesUsed,
      });
    } catch (error: any) {
      console.error("Verify payment error:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // Token Blacklist Management Routes
  app.get("/api/blacklist", async (req, res) => {
    try {
      const blacklistedTokens = await storage.getAllBlacklistedTokens();
      res.json(blacklistedTokens);
    } catch (error: any) {
      console.error("Get blacklist error:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/blacklist", authRateLimit, async (req, res) => {
    try {
      const { insertTokenBlacklistSchema } = await import("@shared/schema");
      const validatedData = insertTokenBlacklistSchema.parse(req.body);
      
      const blacklistEntry = await storage.addTokenToBlacklist(validatedData);
      
      console.log(`[Blacklist] Added token ${validatedData.tokenMint} (${validatedData.tokenSymbol || 'unknown'}) by ${validatedData.addedBy}`);
      
      res.json({
        success: true,
        message: "Token added to blacklist",
        entry: blacklistEntry,
      });
    } catch (error: any) {
      console.error("Add to blacklist error:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.delete("/api/blacklist/:tokenMint", authRateLimit, async (req, res) => {
    try {
      const { tokenMint } = req.params;
      
      const success = await storage.removeTokenFromBlacklist(tokenMint);
      
      if (!success) {
        return res.status(404).json({ message: "Token not found in blacklist" });
      }
      
      console.log(`[Blacklist] Removed token ${tokenMint} from blacklist`);
      
      res.json({
        success: true,
        message: "Token removed from blacklist",
      });
    } catch (error: any) {
      console.error("Remove from blacklist error:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // Public Stats API (no authentication required)
  app.get("/api/public/stats", async (req, res) => {
    try {
      const stats = await storage.getPublicStats();
      res.json(stats);
    } catch (error: any) {
      console.error("Get public stats error:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // Public Recent Trades API (no authentication required)
  app.get("/api/public/recent-trades", async (req, res) => {
    try {
      const { desc, sql } = await import("drizzle-orm");
      
      // Get 10 most recent completed trades
      const recentTrades = await db
        .select({
          id: tradeJournal.id,
          tokenSymbol: tradeJournal.tokenSymbol,
          tokenName: tradeJournal.tokenName,
          entryAt: tradeJournal.entryAt,
          exitAt: tradeJournal.exitAt,
          profitLossPercent: tradeJournal.profitLossPercent,
          tradingMode: tradeJournal.tradingMode,
          entryPriceSOL: tradeJournal.entryPriceSOL,
          exitPriceSOL: tradeJournal.exitPriceSOL,
        })
        .from(tradeJournal)
        .where(sql`${tradeJournal.exitAt} IS NOT NULL`)
        .orderBy(desc(tradeJournal.exitAt))
        .limit(10);
      
      res.json(recentTrades);
    } catch (error: any) {
      console.error("Get recent trades error:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // Token Analyzer API (no authentication required)
  app.get("/api/public/analyze-token/:tokenMint", async (req, res) => {
    try {
      const { tokenMint } = req.params;
      console.log("[Token Analyzer] Analyzing token:", tokenMint);
      
      // Basic validation
      if (!isValidSolanaAddress(tokenMint)) {
        console.log("[Token Analyzer] Invalid address:", tokenMint);
        return res.status(400).json({ message: "Invalid Solana token address" });
      }

      // Fetch real token data from DexScreener
      const { detectBundleActivity } = await import("./bundle-detection");
      const { analyzeTokenWithHiveMind } = await import("./grok-analysis");
      
      console.log("[Token Analyzer] Fetching token data from DexScreener...");
      const response = await fetch(
        `https://api.dexscreener.com/latest/dex/tokens/${tokenMint}`,
        { headers: { 'Accept': 'application/json' } }
      );
      
      if (!response.ok) {
        return res.status(404).json({ message: "Token not found on DexScreener" });
      }
      
      const dexData = await response.json();
      const pair = dexData.pairs?.[0]; // Use first (most liquid) pair
      
      if (!pair) {
        return res.status(404).json({ message: "No trading pairs found for this token" });
      }

      console.log("[Token Analyzer] Building token data structure...");
      // Build token data structure for analysis
      const tokenData = {
        mint: tokenMint,
        name: pair.baseToken?.name || 'Unknown',
        symbol: pair.baseToken?.symbol || 'UNKNOWN',
        priceUSD: parseFloat(pair.priceUsd || '0'),
        priceSOL: parseFloat(pair.priceNative || '0'),
        volumeUSD24h: pair.volume?.h24 || 0,
        marketCapUSD: pair.fdv || 0, // FDV = fully diluted valuation
        liquidityUSD: pair.liquidity?.usd || 0,
        holderCount: pair.holders || 0,
        priceChange24h: pair.priceChange?.h24 || 0,
      };

      console.log("[Token Analyzer] Running bundle detection...");
      // Get organic and quality scores with defensive null-checks
      const bundleAnalysis = await detectBundleActivity(tokenMint, pair);
      const organicScore = pair.profile?.organicScore ?? 50;
      const qualityScore = pair.profile?.qualityScore ?? 50;
      const bundleReasons = bundleAnalysis?.reasons || [];

      console.log("[Token Analyzer] Running AI hivemind analysis...");
      // Run AI hivemind analysis with full model consensus
      const aiResult = await analyzeTokenWithHiveMind(
        tokenData,
        "medium", // Default risk tolerance
        0.02, // Default budget per trade
        0.5, // Minimum agreement
        { forceInclude: true } // Include all models for thorough analysis
      );

      // Extract the consensus analysis
      const aiAnalysis = aiResult.analysis;
      
      // Map AI action to recommendation
      const recommendation = aiAnalysis.action.toUpperCase() as "BUY" | "SELL" | "HOLD";
      
      console.log("[Token Analyzer] Analysis complete:", {
        symbol: tokenData.symbol,
        recommendation,
        confidence: (aiAnalysis.confidence * 100).toFixed(1) + "%",
        consensus: aiResult.consensus
      });

      // Extract risks and opportunities from key factors
      const keyFactors = aiAnalysis.keyFactors || [];
      const risks = keyFactors.filter(f => 
        f.toLowerCase().includes('risk') || 
        f.toLowerCase().includes('concern') ||
        f.toLowerCase().includes('warning') ||
        f.toLowerCase().includes('low') && (f.toLowerCase().includes('liquidity') || f.toLowerCase().includes('volume'))
      );
      const opportunities = keyFactors.filter(f => 
        !risks.includes(f) && (
          f.toLowerCase().includes('potential') ||
          f.toLowerCase().includes('growing') ||
          f.toLowerCase().includes('strong') ||
          f.toLowerCase().includes('positive')
        )
      );

      const result = {
        tokenMint,
        symbol: tokenData.symbol,
        name: tokenData.name,
        price: tokenData.priceUSD,
        volume24h: tokenData.volumeUSD24h,
        liquidity: tokenData.liquidityUSD,
        organicScore,
        qualityScore,
        aiConfidence: Math.round(aiAnalysis.confidence * 100),
        recommendation,
        risks: risks.length > 0 ? risks : bundleReasons.filter(r => r.includes('low') || r.includes('suspicious')),
        opportunities: opportunities.length > 0 ? opportunities : [],
        analysis: aiAnalysis.reasoning,
        keyFactors: aiAnalysis.keyFactors,
        // Additional metrics
        holders: tokenData.holderCount,
        marketCap: tokenData.marketCapUSD,
        priceChange24h: tokenData.priceChange24h,
        isSuspicious: bundleAnalysis?.isSuspicious || false,
        // AI voting details
        consensus: aiResult.consensus,
        votingModels: aiResult.votes.filter(v => v.success).length,
      };

      res.json(result);
    } catch (error: any) {
      console.error("Token analysis error:", error);
      res.status(500).json({ message: error.message || "Failed to analyze token" });
    }
  });

  const httpServer = createServer(app);
  return httpServer;
}
