import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { insertProjectSchema, insertTransactionSchema } from "@shared/schema";
import { fromZodError } from "zod-validation-error";
import { db } from "./db";
import { eq } from "drizzle-orm";

export async function registerRoutes(app: Express): Promise<Server> {
  // Health check
  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok", service: "GigaBrain Agent Burn System" });
  });

  // ===================================
  // PROJECT ROUTES (Burn Configuration)
  // ===================================
  
  // Get all projects for a wallet
  app.get("/api/projects", async (req, res) => {
    try {
      const ownerWalletAddress = req.query.ownerWalletAddress as string;
      
      if (!ownerWalletAddress) {
        return res.status(400).json({ message: "ownerWalletAddress query parameter is required" });
      }
      
      const projects = await storage.getProjects(ownerWalletAddress);
      res.json(projects);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Get single project
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

  // Create new burn configuration
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

  // Update burn configuration
  app.patch("/api/projects/:id", async (req, res) => {
    try {
      const project = await storage.updateProject(req.params.id, req.body);
      if (!project) {
        return res.status(404).json({ message: "Project not found" });
      }
      res.json(project);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Delete burn configuration
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

  // ===================================
  // TRANSACTION ROUTES (Burn History)
  // ===================================
  
  // Get all transactions
  app.get("/api/transactions", async (req, res) => {
    try {
      const transactions = await storage.getAllTransactions();
      res.json(transactions);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Get recent transactions with limit
  app.get("/api/transactions/recent", async (req, res) => {
    try {
      const limit = parseInt(req.query.limit as string) || 10;
      const transactions = await storage.getAllTransactions();
      
      const recentTransactions = transactions
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
        .slice(0, limit);

      res.json(recentTransactions);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Get transactions for a project
  app.get("/api/projects/:id/transactions/recent", async (req, res) => {
    try {
      const limit = parseInt(req.query.limit as string) || 10;
      const transactions = await storage.getTransactionsByProject(req.params.id);
      
      const recentTransactions = transactions
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
        .slice(0, limit);

      res.json(recentTransactions);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // ================================================
  // AGENTIC BURN ROUTES (Core Hackathon Feature)
  // ================================================
  
  // Execute agent burn with DeepSeek AI decision-making
  app.post("/api/agent-burn/execute", async (req, res) => {
    try {
      const {
        requesterPrivateKey,
        tokenMint,
        buyAmountSOL,
        slippageBps,
        burnServiceFeeUSD,
        criteria,
      } = req.body;

      if (!requesterPrivateKey || !tokenMint || !buyAmountSOL) {
        return res.status(400).json({ 
          message: "Missing required fields: requesterPrivateKey, tokenMint, buyAmountSOL" 
        });
      }

      const { executeAgentBurn } = await import("./agent-burn-service");
      const { loadKeypairFromPrivateKey } = await import("./solana-sdk");
      
      const requesterKeypair = loadKeypairFromPrivateKey(requesterPrivateKey);

      const result = await executeAgentBurn({
        requesterKeypair,
        tokenMint,
        buyAmountSOL: parseFloat(buyAmountSOL),
        slippageBps: slippageBps ? parseInt(slippageBps) : undefined,
        burnServiceFeeUSD: burnServiceFeeUSD ? parseFloat(burnServiceFeeUSD) : undefined,
        criteria,
      });

      if (!result.success) {
        return res.status(400).json({
          message: result.error || "Agent burn failed",
          step: result.step,
        });
      }

      res.json({
        success: true,
        message: "Agent burn executed successfully",
        data: result,
      });
    } catch (error: any) {
      console.error("Agent burn error:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // Demo agent burn endpoint (simplified for testing)
  app.post("/api/agent-burn/demo", async (req, res) => {
    try {
      const {
        tokenMint,
        buyAmountSOL,
        confidenceThreshold,
        maxBurnPercentage,
        requirePositiveSentiment,
      } = req.body;

      if (!tokenMint || !buyAmountSOL) {
        return res.status(400).json({ 
          message: "Missing required fields: tokenMint, buyAmountSOL" 
        });
      }

      // Get demo wallet private key from environment
      const demoPrivateKey = process.env.DEMO_WALLET_PRIVATE_KEY;
      if (!demoPrivateKey) {
        return res.status(500).json({ 
          message: "DEMO_WALLET_PRIVATE_KEY not configured in environment" 
        });
      }

      const { demoAgentBurn } = await import("./agent-burn-service");

      const result = await demoAgentBurn(
        demoPrivateKey,
        tokenMint,
        parseFloat(buyAmountSOL),
        {
          confidenceThreshold: confidenceThreshold ? parseInt(confidenceThreshold) : 70,
          maxBurnPercentage: maxBurnPercentage ? parseFloat(maxBurnPercentage) : 5,
          requirePositiveSentiment: requirePositiveSentiment !== false,
        }
      );

      res.json({
        success: true,
        message: "Demo agent burn completed",
        data: result,
      });
    } catch (error: any) {
      console.error("Demo agent burn error:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // Check wallet balance endpoint
  app.get("/api/wallet/balance", async (req, res) => {
    try {
      const userPrivateKey = process.env.USER_WALLET_PRIVATE_KEY;
      if (!userPrivateKey) {
        return res.json({ 
          success: false,
          error: "USER_WALLET_PRIVATE_KEY not configured" 
        });
      }

      const { loadKeypairFromPrivateKey } = await import("./solana-sdk");
      const { Connection, PublicKey, LAMPORTS_PER_SOL } = await import("@solana/web3.js");
      const { getAssociatedTokenAddress } = await import("@solana/spl-token");

      const userKeypair = loadKeypairFromPrivateKey(userPrivateKey);
      const connection = new Connection(process.env.SOLANA_RPC_URL || "https://api.devnet.solana.com");
      
      // Get SOL balance
      const solBalance = await connection.getBalance(userKeypair.publicKey);
      
      // Get USDC balance (devnet USDC mint)
      const USDC_MINT = new PublicKey("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU"); // Devnet USDC
      let usdcBalance = 0;
      try {
        const usdcTokenAccount = await getAssociatedTokenAddress(USDC_MINT, userKeypair.publicKey);
        const usdcAccountInfo = await connection.getTokenAccountBalance(usdcTokenAccount);
        usdcBalance = parseFloat(usdcAccountInfo.value.uiAmount || "0");
      } catch (e) {
        // No USDC account yet
      }

      return res.json({
        success: true,
        wallet: userKeypair.publicKey.toBase58(),
        balances: {
          sol: solBalance / LAMPORTS_PER_SOL,
          usdc: usdcBalance,
        },
        ready: solBalance > 10000000 && usdcBalance >= 0.01, // 0.01 SOL + 0.01 USDC minimum
      });
    } catch (error: any) {
      return res.status(500).json({ 
        success: false,
        error: error.message 
      });
    }
  });

  // Real agent burn endpoint using user's funded devnet wallet
  app.post("/api/agent-burn/real", async (req, res) => {
    try {
      const {
        tokenMint,
        buyAmountSOL,
        confidenceThreshold,
        maxBurnPercentage,
        requirePositiveSentiment,
      } = req.body;

      if (!tokenMint || !buyAmountSOL) {
        return res.status(400).json({ 
          message: "Missing required fields: tokenMint, buyAmountSOL" 
        });
      }

      // Get user wallet private key from environment
      const userPrivateKey = process.env.USER_WALLET_PRIVATE_KEY;
      if (!userPrivateKey) {
        return res.status(500).json({ 
          message: "USER_WALLET_PRIVATE_KEY not configured in environment - please add your devnet wallet private key" 
        });
      }

      console.log(`\n🔐 Starting REAL agent burn with user's funded devnet wallet`);
      console.log(`⚠️  WARNING: This will spend REAL devnet USDC and SOL`);

      const { realAgentBurnFromWallet } = await import("./agent-burn-service");

      const result = await realAgentBurnFromWallet(
        userPrivateKey,
        tokenMint,
        parseFloat(buyAmountSOL),
        {
          confidenceThreshold: confidenceThreshold ? parseInt(confidenceThreshold) : 70,
          maxBurnPercentage: maxBurnPercentage ? parseFloat(maxBurnPercentage) : 5,
          requirePositiveSentiment: requirePositiveSentiment !== false,
        }
      );

      res.json({
        success: true,
        message: "Real agent burn executed on devnet with actual transactions",
        data: result,
      });
    } catch (error: any) {
      console.error("Real agent burn error:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // Get agent burn stats for a wallet
  app.get("/api/agent-burn/stats/:walletAddress", async (req, res) => {
    try {
      const { walletAddress } = req.params;
      const { agentBurns } = await import("../shared/schema");
      
      const burns = await db.select().from(agentBurns).where(eq(agentBurns.ownerWalletAddress, walletAddress));
      
      // Calculate aggregate stats
      const totalBurns = burns.length;
      const completedBurns = burns.filter(b => b.status === "completed").length;
      const failedBurns = burns.filter(b => b.status === "failed").length;
      const totalTokensBurned = burns.reduce((sum, b) => sum + parseFloat(b.tokensBurned || "0"), 0);
      const totalSOLSpent = burns.reduce((sum, b) => sum + parseFloat(b.burnAmountSOL), 0);
      const avgAIConfidence = burns.length > 0 
        ? burns.reduce((sum, b) => sum + (b.aiConfidence || 0), 0) / burns.length 
        : 0;
      const totalX402Fees = completedBurns * 0.005; // $0.005 per burn
      const avgExecutionTime = burns.length > 0 
        ? burns.reduce((sum, b) => sum + (b.totalDurationMs || 0), 0) / burns.length 
        : 0;

      res.json({
        totalBurns,
        completedBurns,
        failedBurns,
        successRate: totalBurns > 0 ? (completedBurns / totalBurns) * 100 : 0,
        totalTokensBurned,
        totalSOLSpent,
        avgAIConfidence: Math.round(avgAIConfidence),
        totalX402Fees,
        avgExecutionTimeMs: Math.round(avgExecutionTime),
        recentBurns: burns.slice(-5).reverse(), // Last 5 burns
      });
    } catch (error: any) {
      console.error("Error fetching agent burn stats:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // ================================================
  // x402 MICROPAYMENT ROUTES (Hackathon Feature)
  // ================================================
  
  // Get x402 payments for a wallet
  app.get("/api/x402/payments/:walletAddress", async (req, res) => {
    try {
      const { walletAddress } = req.params;
      const { x402Micropayments } = await import("../shared/schema");
      
      const payments = await db.select()
        .from(x402Micropayments)
        .where(eq(x402Micropayments.ownerWalletAddress, walletAddress));

      res.json(payments);
    } catch (error: any) {
      console.error("Error fetching x402 payments:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // ================================================
  // JITO BAM BUNDLE ROUTES (Hackathon Feature)
  // ================================================
  
  // Get BAM bundles for a wallet
  app.get("/api/bam/bundles/:walletAddress", async (req, res) => {
    try {
      const { walletAddress } = req.params;
      const { bamBundles } = await import("../shared/schema");
      
      const bundles = await db.select()
        .from(bamBundles)
        .where(eq(bamBundles.ownerWalletAddress, walletAddress));

      res.json(bundles);
    } catch (error: any) {
      console.error("Error fetching BAM bundles:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // Get bundle status by bundle ID
  app.get("/api/bam/bundles/status/:bundleId", async (req, res) => {
    try {
      const { bundleId } = req.params;
      const { bamBundles } = await import("../shared/schema");
      
      const bundle = await db.select()
        .from(bamBundles)
        .where(eq(bamBundles.bundleId, bundleId))
        .limit(1);

      if (bundle.length === 0) {
        return res.status(404).json({ message: "Bundle not found" });
      }

      res.json(bundle[0]);
    } catch (error: any) {
      console.error("Error fetching bundle status:", error);
      res.status(500).json({ message: error.message });
    }
  });

  const server = createServer(app);
  return server;
}
