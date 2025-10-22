// AI Trading Bot Scheduler - Grok-powered PumpFun trading automation
// Scans PumpFun trending tokens, analyzes with Grok AI, and executes trades

import cron from "node-cron";
import { storage } from "./storage";
import { analyzeTokenWithGrok, isGrokConfigured, type TokenMarketData } from "./grok-analysis";
import { buyTokenWithJupiter } from "./jupiter";
import { sellTokenOnPumpFun } from "./pumpfun";
import { getTreasuryKey } from "./key-manager";
import { getWalletBalance } from "./solana";
import { deductTransactionFee } from "./transaction-fee";
import { realtimeService } from "./realtime";
import { Keypair } from "@solana/web3.js";
import { loadKeypairFromPrivateKey } from "./solana-sdk";
import type { Project } from "@shared/schema";

interface AIBotState {
  projectId: string;
  dailyTradesExecuted: number;
  lastResetDate: string; // YYYY-MM-DD
  activePositions: Map<string, { mint: string; entryPriceSOL: number; amountSOL: number }>;
}

const aiBotStates = new Map<string, AIBotState>();

/**
 * Fetch trending PumpFun tokens from DexScreener API
 * Uses free DexScreener API to get real-time trading data for Solana tokens
 */
async function fetchTrendingPumpFunTokens(): Promise<TokenMarketData[]> {
  try {
    console.log("[AI Bot] Fetching trending PumpFun tokens from DexScreener...");
    
    // Search for PumpFun tokens on Solana DEXes
    // We use multiple search terms to catch more PumpFun tokens
    const searchQueries = ['pump', 'raydium', 'jupiter'];
    const allPairs: any[] = [];
    
    for (const query of searchQueries) {
      try {
        const response = await fetch(
          `https://api.dexscreener.com/latest/dex/search?q=${query}`,
          {
            headers: {
              'Accept': 'application/json',
            },
          }
        );
        
        if (!response.ok) {
          console.error(`[AI Bot] DexScreener API error for query "${query}": ${response.status}`);
          continue;
        }

        const data = await response.json();
        if (data.pairs && Array.isArray(data.pairs)) {
          allPairs.push(...data.pairs);
        }
        
        // Rate limiting: DexScreener allows ~300 req/min, add small delay
        await new Promise(resolve => setTimeout(resolve, 500));
      } catch (error) {
        console.error(`[AI Bot] Failed to fetch query "${query}":`, error);
      }
    }
    
    // Filter for Solana chain only and deduplicate by token address
    const seenAddresses = new Set<string>();
    const uniquePairs = allPairs.filter((pair: any) => {
      if (pair.chainId !== 'solana') return false;
      if (!pair.baseToken?.address) return false;
      if (seenAddresses.has(pair.baseToken.address)) return false;
      seenAddresses.add(pair.baseToken.address);
      return true;
    });
    
    // Sort by 24h volume (highest first) and take top 50
    const sortedPairs = uniquePairs
      .filter((pair: any) => pair.volume?.h24 > 0) // Must have volume
      .sort((a: any, b: any) => (b.volume?.h24 || 0) - (a.volume?.h24 || 0))
      .slice(0, 50);
    
    // Map to TokenMarketData format
    const tokens: TokenMarketData[] = sortedPairs.map((pair: any) => ({
      mint: pair.baseToken.address,
      name: pair.baseToken.name || 'Unknown',
      symbol: pair.baseToken.symbol || 'UNKNOWN',
      priceUSD: parseFloat(pair.priceUsd || '0'),
      priceSOL: parseFloat(pair.priceNative || '0'),
      volumeUSD24h: pair.volume?.h24 || 0,
      marketCapUSD: pair.fdv || pair.marketCap || 0,
      liquidityUSD: pair.liquidity?.usd || 0,
      priceChange24h: pair.priceChange?.h24 || 0,
      priceChange1h: pair.priceChange?.h1 || 0,
      holderCount: undefined, // DexScreener doesn't provide holder count
    }));

    console.log(`[AI Bot] ✅ Fetched ${tokens.length} trending Solana tokens from DexScreener`);
    
    if (tokens.length > 0) {
      console.log(`[AI Bot] Top token: ${tokens[0].symbol} - $${tokens[0].volumeUSD24h.toLocaleString()} 24h volume`);
    }
    
    return tokens;
  } catch (error) {
    console.error("[AI Bot] Failed to fetch trending tokens from DexScreener:", error);
    return [];
  }
}

/**
 * Execute AI trading bot for a single project
 */
async function executeAITradingBot(project: Project) {
  try {
    console.log(`[AI Bot] Running for project ${project.id} (${project.name})`);

    // Check if AI bot is enabled
    if (!project.aiBotEnabled) {
      console.log(`[AI Bot] Disabled for project ${project.id}`);
      return;
    }

    // Validate Grok API key
    if (!isGrokConfigured()) {
      console.error("[AI Bot] XAI_API_KEY not configured");
      await storage.updateProject(project.id, {
        lastBotStatus: "failed",
        lastBotRunAt: new Date(),
      });
      return;
    }

    // Get or initialize bot state
    let botState = aiBotStates.get(project.id);
    const today = new Date().toISOString().split("T")[0];

    if (!botState || botState.lastResetDate !== today) {
      botState = {
        projectId: project.id,
        dailyTradesExecuted: 0,
        lastResetDate: today,
        activePositions: new Map(),
      };
      aiBotStates.set(project.id, botState);
    }

    // Check daily trade limit
    const maxDailyTrades = project.aiBotMaxDailyTrades || 10;
    if (botState.dailyTradesExecuted >= maxDailyTrades) {
      console.log(`[AI Bot] Daily trade limit reached (${maxDailyTrades})`);
      await storage.updateProject(project.id, {
        lastBotStatus: "skipped",
        lastBotRunAt: new Date(),
      });
      return;
    }

    // Get wallet keypair
    const treasuryKeyBase58 = await getTreasuryKey(project.id);
    if (!treasuryKeyBase58) {
      console.error(`[AI Bot] No treasury key configured for project ${project.id}`);
      await storage.updateProject(project.id, {
        lastBotStatus: "failed",
        lastBotRunAt: new Date(),
      });
      return;
    }

    const treasuryKeypair = loadKeypairFromPrivateKey(treasuryKeyBase58);

    // Check total budget and remaining balance
    const totalBudget = parseFloat(project.aiBotTotalBudget || "0");
    const budgetUsed = parseFloat(project.aiBotBudgetUsed || "0");
    const remainingBudget = totalBudget - budgetUsed;
    const budgetPerTrade = parseFloat(project.aiBotBudgetPerTrade || "0");

    if (totalBudget > 0 && remainingBudget <= 0) {
      console.log(`[AI Bot] Budget exhausted: ${budgetUsed}/${totalBudget} SOL used`);
      await storage.updateProject(project.id, {
        lastBotStatus: "skipped",
        lastBotRunAt: new Date(),
      });
      return;
    }

    // Reserve 0.01 SOL for transaction fees
    const FEE_RESERVE = 0.01;
    
    if (totalBudget > 0 && remainingBudget < budgetPerTrade + FEE_RESERVE) {
      console.log(`[AI Bot] Insufficient budget: ${remainingBudget.toFixed(4)} SOL remaining (need ${budgetPerTrade} SOL + ${FEE_RESERVE} SOL fee reserve)`);
      await storage.updateProject(project.id, {
        lastBotStatus: "skipped",
        lastBotRunAt: new Date(),
      });
      return;
    }

    // Check SOL balance (with fee reserve)
    const solBalance = await getWalletBalance(treasuryKeypair.publicKey.toString());
    
    if (solBalance < budgetPerTrade + FEE_RESERVE) {
      console.log(`[AI Bot] Insufficient SOL balance: ${solBalance.toFixed(4)} SOL (need ${budgetPerTrade} SOL + ${FEE_RESERVE} SOL for fees)`);
      await storage.updateProject(project.id, {
        lastBotStatus: "failed",
        lastBotRunAt: new Date(),
      });
      return;
    }

    console.log(`[AI Bot] Budget status: ${budgetUsed.toFixed(4)}/${totalBudget.toFixed(4)} SOL used (${remainingBudget.toFixed(4)} remaining)`);

    // Fetch trending tokens
    const trendingTokens = await fetchTrendingPumpFunTokens();
    
    // Filter by volume threshold
    const minVolumeUSD = parseFloat(project.aiBotMinVolumeUSD || "1000");
    const filteredTokens = trendingTokens.filter((t) => t.volumeUSD24h >= minVolumeUSD);

    if (filteredTokens.length === 0) {
      console.log("[AI Bot] No tokens meet volume criteria");
      await storage.updateProject(project.id, {
        lastBotStatus: "skipped",
        lastBotRunAt: new Date(),
      });
      return;
    }

    console.log(`[AI Bot] Analyzing ${filteredTokens.length} tokens...`);

    // Analyze tokens with Grok AI
    const riskTolerance = (project.aiBotRiskTolerance || "medium") as "low" | "medium" | "high";
    
    for (const token of filteredTokens) {
      // Check if we've hit daily limit
      if (botState.dailyTradesExecuted >= maxDailyTrades) {
        break;
      }

      const analysis = await analyzeTokenWithGrok(token, riskTolerance, budgetPerTrade);

      // Check minimum potential threshold
      const minPotential = parseFloat(project.aiBotMinPotentialPercent || "20");
      if (analysis.potentialUpsidePercent < minPotential) {
        console.log(`[AI Bot] ${token.symbol}: Potential ${analysis.potentialUpsidePercent}% below threshold ${minPotential}%`);
        continue;
      }

      // Execute trade based on AI recommendation
      if (analysis.action === "buy" && analysis.confidence >= 0.6) {
        const amountSOL = analysis.suggestedBuyAmountSOL || budgetPerTrade;
        
        console.log(`[AI Bot] BUY signal: ${token.symbol} - ${amountSOL} SOL (confidence: ${(analysis.confidence * 100).toFixed(1)}%)`);
        console.log(`[AI Bot] Reasoning: ${analysis.reasoning}`);

        // Buy using Jupiter Ultra API for better routing and pricing
        const treasuryPrivateKey = await getTreasuryKey(project.id);
        if (!treasuryPrivateKey) {
          console.log(`[AI Bot] No private key available for project ${project.id}`);
          continue;
        }
        
        const result = await buyTokenWithJupiter(
          treasuryPrivateKey,
          token.mint,
          amountSOL,
          1000 // 10% slippage (1000 bps)
        );

        if (result.success && result.signature) {
          // Update budget tracking
          const newBudgetUsed = budgetUsed + amountSOL;
          await storage.updateProject(project.id, {
            aiBotBudgetUsed: newBudgetUsed.toString(),
          });
          console.log(`[AI Bot] Budget updated: ${newBudgetUsed.toFixed(4)}/${totalBudget.toFixed(4)} SOL used`);

          // Record transaction
          await storage.createTransaction({
            projectId: project.id,
            type: "ai_buy",
            amount: amountSOL.toString(),
            tokenAmount: "0", // Would need to calculate from tx
            txSignature: result.signature,
            status: "completed",
            expectedPriceSOL: token.priceSOL.toString(),
            actualPriceSOL: token.priceSOL.toString(),
          });

          // Deduct transaction fee (0.5% after 60 transactions)
          const feeResult = await deductTransactionFee(
            project.id,
            amountSOL,
            treasuryKeypair
          );

          if (feeResult.feeDeducted > 0) {
            console.log(`[AI Bot] Transaction fee deducted: ${feeResult.feeDeducted} SOL`);
          }

          // Broadcast real-time update
          realtimeService.broadcast({
            type: "transaction_event",
            data: {
              projectId: project.id,
              transactionType: "ai_buy",
              signature: result.signature,
              amount: amountSOL,
              token: token.symbol,
              analysis: analysis.reasoning,
            },
            timestamp: Date.now(),
          });

          // Track position
          botState.activePositions.set(token.mint, {
            mint: token.mint,
            entryPriceSOL: token.priceSOL,
            amountSOL,
          });

          botState.dailyTradesExecuted++;
          console.log(`[AI Bot] Trade executed successfully (${botState.dailyTradesExecuted}/${maxDailyTrades})`);
        } else {
          console.error(`[AI Bot] Trade failed: ${result.error}`);
        }
      }
    }

    // Update project status
    await storage.updateProject(project.id, {
      lastBotStatus: "success",
      lastBotRunAt: new Date(),
    });

    console.log(`[AI Bot] Run complete for project ${project.id}`);
  } catch (error) {
    console.error(`[AI Bot] Error for project ${project.id}:`, error);
    await storage.updateProject(project.id, {
      lastBotStatus: "failed",
      lastBotRunAt: new Date(),
    });
  }
}

/**
 * Run AI trading bot for all enabled projects
 */
async function runAITradingBots() {
  try {
    console.log("[AI Bot Scheduler] Scanning for active projects...");

    const projects = await storage.getAllProjects();
    const enabledProjects = projects.filter((p) => p.aiBotEnabled);

    if (enabledProjects.length === 0) {
      console.log("[AI Bot Scheduler] No projects with AI bot enabled");
      return;
    }

    console.log(`[AI Bot Scheduler] Running for ${enabledProjects.length} projects`);

    // Run bots in parallel (with reasonable concurrency)
    await Promise.all(enabledProjects.map((p) => executeAITradingBot(p)));

    console.log("[AI Bot Scheduler] All bots completed");
  } catch (error) {
    console.error("[AI Bot Scheduler] Error:", error);
  }
}

/**
 * Start AI trading bot scheduler
 * Runs based on project-specific intervals
 */
export function startAITradingBotScheduler() {
  if (process.env.NODE_ENV === "development") {
    console.log("[AI Bot Scheduler] Disabled in development mode");
    return;
  }

  if (!isGrokConfigured()) {
    console.warn("[AI Bot Scheduler] XAI_API_KEY not configured - AI bot disabled");
    return;
  }

  console.log("[AI Bot Scheduler] Starting...");

  // Run every 5 minutes (projects control their own intervals via aiBotAnalysisInterval)
  cron.schedule("*/5 * * * *", () => {
    runAITradingBots().catch((error) => {
      console.error("[AI Bot Scheduler] Unexpected error:", error);
    });
  });

  console.log("[AI Bot Scheduler] Active (checks every 5 minutes)");
}

/**
 * Manual trigger for testing
 */
export async function triggerAIBotManually(projectId: string) {
  const project = await storage.getProject(projectId);
  if (!project) {
    throw new Error("Project not found");
  }
  await executeAITradingBot(project);
}
