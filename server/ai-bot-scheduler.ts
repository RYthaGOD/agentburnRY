// AI Trading Bot Scheduler - Grok-powered PumpFun trading automation
// Scans PumpFun trending tokens, analyzes with Grok AI, and executes trades

import cron from "node-cron";
import { storage } from "./storage";
import { analyzeTokenWithGrok, analyzeTokenWithHiveMind, isGrokConfigured, type TokenMarketData } from "./grok-analysis";
import { buyTokenWithJupiter, getTokenPrice, getSwapOrder, executeSwapOrder } from "./jupiter";
import OpenAI from "openai";
import { sellTokenOnPumpFun } from "./pumpfun";
import { getTreasuryKey } from "./key-manager";
import { getWalletBalance } from "./solana";
import { deductTransactionFee } from "./transaction-fee";
import { realtimeService } from "./realtime";
import { Keypair, Connection, PublicKey } from "@solana/web3.js";
import { loadKeypairFromPrivateKey, getConnection } from "./solana-sdk";
import type { Project } from "@shared/schema";

/**
 * Get AI client for analysis (Groq free or xAI paid)
 */
function getAIClient(): { client: OpenAI; model: string; provider: string } {
  // Prefer Groq (completely free)
  if (process.env.GROQ_API_KEY) {
    return {
      client: new OpenAI({
        baseURL: "https://api.groq.com/openai/v1",
        apiKey: process.env.GROQ_API_KEY,
      }),
      model: "llama-3.3-70b-versatile",
      provider: "Groq (free)",
    };
  }
  
  // Fallback to xAI Grok (paid)
  if (process.env.XAI_API_KEY) {
    return {
      client: new OpenAI({
        baseURL: "https://api.x.ai/v1",
        apiKey: process.env.XAI_API_KEY,
      }),
      model: "grok-4-fast-reasoning",
      provider: "xAI Grok",
    };
  }

  throw new Error("No AI API key configured");
}

interface AIBotState {
  projectId: string;
  dailyTradesExecuted: number;
  lastResetDate: string; // YYYY-MM-DD
  activePositions: Map<string, { mint: string; entryPriceSOL: number; amountSOL: number }>;
}

const aiBotStates = new Map<string, AIBotState>();

/**
 * Sell all tokens of a specific mint for SOL using Jupiter Ultra API
 */
async function sellTokenWithJupiter(
  walletPrivateKey: string,
  tokenMint: string,
  slippageBps: number = 1000
): Promise<{
  success: boolean;
  signature?: string;
  error?: string;
}> {
  try {
    const SOL_MINT = "So11111111111111111111111111111111111111112";
    const keypair = loadKeypairFromPrivateKey(walletPrivateKey);
    const walletAddress = keypair.publicKey.toString();
    
    // Get token balance
    const connection = getConnection();
    const tokenAccounts = await connection.getTokenAccountsByOwner(keypair.publicKey, {
      mint: new PublicKey(tokenMint),
    });

    if (tokenAccounts.value.length === 0) {
      throw new Error("No token account found");
    }

    const tokenAccountInfo = await connection.getTokenAccountBalance(tokenAccounts.value[0].pubkey);
    const tokenBalance = parseInt(tokenAccountInfo.value.amount);

    if (tokenBalance === 0) {
      throw new Error("Token balance is zero");
    }

    console.log(`[Jupiter] Selling ${tokenBalance} tokens of ${tokenMint} for SOL`);
    
    // Get swap order (sell token for SOL)
    const swapOrder = await getSwapOrder(
      tokenMint, // input: token we're selling
      SOL_MINT, // output: SOL we're getting
      tokenBalance, // sell all tokens
      walletAddress,
      slippageBps
    );
    
    // Execute swap
    const result = await executeSwapOrder(swapOrder, walletPrivateKey);
    
    console.log(`[Jupiter] Sell successful: ${result.transactionId}`);
    
    return {
      success: true,
      signature: result.transactionId,
    };
  } catch (error) {
    console.error(`[Jupiter] Sell failed:`, error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Calculate organic volume score (0-100)
 * Detects wash trading and filters for genuinely trending tokens
 */
function calculateOrganicVolumeScore(pair: any): number {
  let score = 100;
  
  // 1. Volume/Liquidity Ratio Check (high ratio = potential wash trading)
  const volumeUSD = pair.volume?.h24 || 0;
  const liquidityUSD = pair.liquidity?.usd || 0;
  
  if (liquidityUSD > 0) {
    const volumeLiquidityRatio = volumeUSD / liquidityUSD;
    
    // Healthy organic trading: 0.5-10x volume/liquidity ratio
    // Suspicious: >15x (wash trading), <0.3x (dead token)
    if (volumeLiquidityRatio > 15) {
      score -= 30; // Likely wash trading
    } else if (volumeLiquidityRatio > 10) {
      score -= 15;
    } else if (volumeLiquidityRatio < 0.3) {
      score -= 20; // Dead/low activity
    }
  }
  
  // 2. Transaction Count Analysis
  const txns24h = (pair.txns?.h24?.buys || 0) + (pair.txns?.h24?.sells || 0);
  if (txns24h > 0 && volumeUSD > 0) {
    const avgTxSize = volumeUSD / txns24h;
    
    // Organic: many small transactions ($10-$1000 avg)
    // Suspicious: few large transactions (>$10k avg)
    if (avgTxSize > 10000) {
      score -= 25; // Large transactions = potential wash trading
    } else if (avgTxSize > 5000) {
      score -= 15;
    } else if (avgTxSize < 10) {
      score -= 10; // Too small, might be bots
    } else {
      score += 10; // Good organic transaction size
    }
  }
  
  // 3. Buy/Sell Pressure Balance
  const buys = pair.txns?.h24?.buys || 0;
  const sells = pair.txns?.h24?.sells || 0;
  const totalTxns = buys + sells;
  
  if (totalTxns > 0) {
    const buyRatio = buys / totalTxns;
    
    // Healthy: 40-60% buy ratio
    // Suspicious: extreme imbalance
    if (buyRatio > 0.4 && buyRatio < 0.6) {
      score += 15; // Good balance = organic
    } else if (buyRatio > 0.7 || buyRatio < 0.3) {
      score -= 20; // Extreme imbalance = manipulation
    }
  }
  
  // 4. Price Change Consistency
  const priceChange1h = Math.abs(pair.priceChange?.h1 || 0);
  const priceChange24h = Math.abs(pair.priceChange?.h24 || 0);
  
  // Organic growth: steady gains
  // Pump & dump: massive short-term spikes
  if (priceChange1h > 100 || priceChange24h > 500) {
    score -= 30; // Likely pump & dump
  } else if (priceChange24h > 0 && priceChange24h < 200) {
    score += 10; // Healthy growth
  }
  
  // 5. Liquidity Depth (minimum requirement)
  if (liquidityUSD < 5000) {
    score -= 40; // Very low liquidity = risky/manipulated
  } else if (liquidityUSD < 10000) {
    score -= 20;
  } else if (liquidityUSD > 100000) {
    score += 15; // Deep liquidity = more organic
  }
  
  // 6. Market Cap/Liquidity Ratio
  const marketCap = pair.fdv || pair.marketCap || 0;
  if (marketCap > 0 && liquidityUSD > 0) {
    const mcLiqRatio = marketCap / liquidityUSD;
    
    // Healthy: 3-20x MC/Liquidity
    // Suspicious: >50x (unlocked supply dump risk)
    if (mcLiqRatio > 50) {
      score -= 25;
    } else if (mcLiqRatio > 30) {
      score -= 10;
    } else if (mcLiqRatio >= 3 && mcLiqRatio <= 20) {
      score += 10;
    }
  }
  
  return Math.max(0, Math.min(100, score));
}

/**
 * Calculate comprehensive token quality score (0-100)
 * Combines multiple factors for optimal token selection
 */
function calculateTokenQualityScore(pair: any, organicScore: number): number {
  let score = organicScore * 0.4; // Organic volume is 40% of total score
  
  // 1. Momentum Score (30% weight)
  const priceChange1h = pair.priceChange?.h1 || 0;
  const priceChange6h = pair.priceChange?.h6 || 0;
  const priceChange24h = pair.priceChange?.h24 || 0;
  
  let momentumScore = 0;
  // Positive momentum across timeframes
  if (priceChange1h > 0 && priceChange6h > 0 && priceChange24h > 0) {
    momentumScore = 30; // Strong uptrend
  } else if (priceChange1h > 0 && priceChange24h > 0) {
    momentumScore = 20; // Good momentum
  } else if (priceChange24h > 0) {
    momentumScore = 10; // Some momentum
  }
  
  // Bonus for accelerating momentum
  if (priceChange1h > priceChange24h / 24) {
    momentumScore += 10; // Recent acceleration
  }
  
  score += Math.min(30, momentumScore);
  
  // 2. Volume Trend (20% weight)
  const volumeChange = pair.volume?.h24ChangePercent || 0;
  let volumeScore = 0;
  
  if (volumeChange > 100) {
    volumeScore = 20; // Volume exploding
  } else if (volumeChange > 50) {
    volumeScore = 15; // Strong volume growth
  } else if (volumeChange > 0) {
    volumeScore = 10; // Growing volume
  }
  
  score += volumeScore;
  
  // 3. Transaction Activity (10% weight)
  const txns24h = (pair.txns?.h24?.buys || 0) + (pair.txns?.h24?.sells || 0);
  let activityScore = 0;
  
  if (txns24h > 1000) {
    activityScore = 10; // Very active
  } else if (txns24h > 500) {
    activityScore = 7;
  } else if (txns24h > 100) {
    activityScore = 5;
  } else if (txns24h > 50) {
    activityScore = 3;
  }
  
  score += activityScore;
  
  return Math.min(100, score);
}

/**
 * Fetch trending PumpFun tokens from DexScreener API with advanced filtering
 * Uses free DexScreener API to get real-time trading data for Solana tokens
 * Implements organic volume detection and wash trading filters
 */
async function fetchTrendingPumpFunTokens(config?: {
  minOrganicScore?: number;
  minQualityScore?: number;
  minLiquidityUSD?: number;
  minTransactions24h?: number;
}): Promise<TokenMarketData[]> {
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
    
    // Apply organic volume scoring and quality filtering
    const scoredPairs = uniquePairs
      .filter((pair: any) => pair.volume?.h24 > 0) // Must have volume
      .map((pair: any) => {
        const organicScore = calculateOrganicVolumeScore(pair);
        const qualityScore = calculateTokenQualityScore(pair, organicScore);
        return {
          ...pair,
          organicScore,
          qualityScore,
        };
      })
      .filter((pair: any) => {
        // Use config values or defaults
        const minOrganicScore = config?.minOrganicScore ?? 40;
        const minQualityScore = config?.minQualityScore ?? 30;
        const minLiquidity = config?.minLiquidityUSD ?? 5000;
        const minTxns = config?.minTransactions24h ?? 20;
        
        const txns24h = (pair.txns?.h24?.buys || 0) + (pair.txns?.h24?.sells || 0);
        const liquidityUSD = pair.liquidity?.usd || 0;
        
        return (
          pair.organicScore >= minOrganicScore &&
          pair.qualityScore >= minQualityScore &&
          liquidityUSD >= minLiquidity &&
          txns24h >= minTxns
        );
      })
      .sort((a: any, b: any) => b.qualityScore - a.qualityScore) // Sort by quality score (best first)
      .slice(0, 35); // Take top 35 highest quality tokens
    
    const minOrganicScore = config?.minOrganicScore ?? 40;
    const minQualityScore = config?.minQualityScore ?? 30;
    
    console.log(`[AI Bot] 📊 Filtered to ${scoredPairs.length} tokens with organic volume (min ${minOrganicScore}% organic, min ${minQualityScore}% quality)`);
    if (scoredPairs.length > 0) {
      const top = scoredPairs[0];
      console.log(`[AI Bot] 🏆 Top token: ${top.baseToken?.symbol} - Quality: ${top.qualityScore.toFixed(1)}%, Organic: ${top.organicScore.toFixed(1)}%`);
    }
    
    // Map to TokenMarketData format
    const tokens: TokenMarketData[] = scoredPairs.map((pair: any) => ({
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

    console.log(`[AI Bot] 🔍 Analyzing ${filteredTokens.length} tokens with AI...`);

    // Analyze tokens with Grok AI
    const riskTolerance = (project.aiBotRiskTolerance || "medium") as "low" | "medium" | "high";
    
    for (let i = 0; i < filteredTokens.length; i++) {
      const token = filteredTokens[i];
      
      // Check if we've hit daily limit
      if (botState.dailyTradesExecuted >= maxDailyTrades) {
        break;
      }

      console.log(`\n[AI Bot] 📊 Analyzing token ${i + 1}/${filteredTokens.length}: ${token.symbol} (${token.name})`);
      console.log(`[AI Bot]    💰 Price: $${token.priceUSD.toFixed(6)} (${token.priceSOL.toFixed(8)} SOL)`);
      console.log(`[AI Bot]    📈 Volume 24h: $${token.volumeUSD24h.toLocaleString()}`);
      console.log(`[AI Bot]    💎 Market Cap: $${token.marketCapUSD.toLocaleString()}`);
      console.log(`[AI Bot]    💧 Liquidity: $${(token.liquidityUSD || 0).toLocaleString()}`);
      console.log(`[AI Bot]    📊 Change 24h: ${(token.priceChange24h || 0) > 0 ? '+' : ''}${(token.priceChange24h || 0).toFixed(2)}%`);

      // Use Hive Mind for multi-model consensus
      const hiveMindResult = await analyzeTokenWithHiveMind(token, riskTolerance, budgetPerTrade, 0.6);
      const analysis = hiveMindResult.analysis;

      console.log(`[AI Bot] 🧠 Hive Mind Consensus: ${hiveMindResult.consensus}`);
      console.log(`[AI Bot]    Action: ${analysis.action.toUpperCase()}`);
      console.log(`[AI Bot]    Confidence: ${(analysis.confidence * 100).toFixed(1)}%`);
      console.log(`[AI Bot]    Potential Upside: ${analysis.potentialUpsidePercent.toFixed(1)}%`);
      console.log(`[AI Bot]    Model Votes:`);
      console.log(`[AI Bot]    💭 Reasoning: ${analysis.reasoning}`);

      // Check minimum potential threshold
      const minPotential = parseFloat(project.aiBotMinPotentialPercent || "20");
      if (analysis.potentialUpsidePercent < minPotential) {
        console.log(`[AI Bot] ❌ SKIP: Potential ${analysis.potentialUpsidePercent.toFixed(1)}% below threshold ${minPotential}%\n`);
        continue;
      }

      // Check confidence threshold
      if (analysis.confidence < 0.6) {
        console.log(`[AI Bot] ❌ SKIP: Confidence ${(analysis.confidence * 100).toFixed(1)}% below 60% threshold\n`);
        continue;
      }

      // Execute trade based on AI recommendation
      if (analysis.action === "buy") {
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

          // Track position (both in-memory and database)
          botState.activePositions.set(token.mint, {
            mint: token.mint,
            entryPriceSOL: token.priceSOL,
            amountSOL,
          });

          // Save position to database for persistence across restarts
          await storage.createAIBotPosition({
            ownerWalletAddress: project.ownerWalletAddress,
            tokenMint: token.mint,
            tokenSymbol: token.symbol,
            tokenName: token.name,
            entryPriceSOL: token.priceSOL.toString(),
            amountSOL: amountSOL.toString(),
            tokenAmount: "0", // Would need to calculate from tx
            buyTxSignature: result.signature,
            lastCheckPriceSOL: token.priceSOL.toString(),
            lastCheckProfitPercent: "0",
            aiConfidenceAtBuy: analysis.confidence,
            aiPotentialAtBuy: analysis.potentialUpsidePercent.toString(),
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
 * Run AI trading bot for all enabled projects (legacy)
 */
async function runProjectBasedAIBots() {
  try {
    console.log("[AI Bot Scheduler] Scanning for project-based AI bots...");

    const projects = await storage.getAllProjects();
    const enabledProjects = projects.filter((p) => p.aiBotEnabled);

    if (enabledProjects.length === 0) {
      console.log("[AI Bot Scheduler] No projects with AI bot enabled");
      return;
    }

    console.log(`[AI Bot Scheduler] Running for ${enabledProjects.length} project-based AI bots`);

    // Run bots in parallel (with reasonable concurrency)
    await Promise.all(enabledProjects.map((p) => executeAITradingBot(p)));

    console.log("[AI Bot Scheduler] All project-based bots completed");
  } catch (error) {
    console.error("[AI Bot Scheduler] Error running project-based bots:", error);
  }
}

/**
 * Run standalone AI trading bots (new architecture)
 */
async function runStandaloneAIBots() {
  try {
    console.log("[Standalone AI Bot Scheduler] Scanning for enabled configs...");

    const configs = await storage.getAllAIBotConfigs();
    const enabledConfigs = configs.filter((c: any) => c.enabled);

    if (enabledConfigs.length === 0) {
      console.log("[Standalone AI Bot Scheduler] No standalone AI bots enabled");
      return;
    }

    console.log(`[Standalone AI Bot Scheduler] Running for ${enabledConfigs.length} standalone AI bots`);

    // Run bots in parallel (with reasonable concurrency)
    await Promise.all(enabledConfigs.map((c: any) => executeStandaloneAIBot(c.ownerWalletAddress)));

    console.log("[Standalone AI Bot Scheduler] All standalone bots completed");
  } catch (error) {
    console.error("[Standalone AI Bot Scheduler] Error:", error);
  }
}

/**
 * Run both project-based and standalone AI trading bots
 */
async function runAITradingBots() {
  await Promise.all([
    runProjectBasedAIBots(),
    runStandaloneAIBots(),
  ]);
}

/**
 * Start AI trading bot scheduler
 * Runs based on project-specific intervals
 */
export function startAITradingBotScheduler() {
  if (!isGrokConfigured()) {
    console.warn("[AI Bot Scheduler] XAI_API_KEY or GROQ_API_KEY not configured - AI bot disabled");
    return;
  }

  // Log active AI providers
  const activeProviders = [];
  if (process.env.CEREBRAS_API_KEY) activeProviders.push("Cerebras");
  if (process.env.GOOGLE_AI_KEY) activeProviders.push("Google Gemini");
  if (process.env.DEEPSEEK_API_KEY) activeProviders.push("DeepSeek");
  if (process.env.CHATANYWHERE_API_KEY) activeProviders.push("ChatAnywhere");
  if (process.env.TOGETHER_API_KEY) activeProviders.push("Together AI");
  if (process.env.OPENROUTER_API_KEY) activeProviders.push("OpenRouter");
  if (process.env.GROQ_API_KEY) activeProviders.push("Groq");
  if (process.env.OPENAI_API_KEY) activeProviders.push("OpenAI");
  if (process.env.XAI_API_KEY) activeProviders.push("xAI Grok");

  console.log("[AI Bot Scheduler] Starting...");
  console.log(`[AI Bot Scheduler] Active AI providers (${activeProviders.length}): ${activeProviders.join(", ")}`);

  // Run every 10 minutes to reduce API usage
  const cronExpression = "*/10 * * * *";

  cron.schedule(cronExpression, () => {
    runAITradingBots().catch((error) => {
      console.error("[AI Bot Scheduler] Unexpected error:", error);
    });
  });

  console.log("[AI Bot Scheduler] Active (checks every 10 minutes)");
}

/**
 * Manual trigger for testing (project-based - legacy)
 */
export async function triggerAIBotManually(projectId: string) {
  const project = await storage.getProject(projectId);
  if (!project) {
    throw new Error("Project not found");
  }
  await executeAITradingBot(project);
}

interface ScanLog {
  timestamp: number;
  message: string;
  type: "info" | "success" | "warning" | "error";
  tokenData?: any;
}

/**
 * Execute standalone AI trading bot (no project required)
 * Uses AIBotConfig table instead of project data
 */
async function executeStandaloneAIBot(ownerWalletAddress: string, collectLogs = false): Promise<ScanLog[]> {
  const logs: ScanLog[] = [];
  const addLog = (message: string, type: ScanLog["type"] = "info", tokenData?: any) => {
    const log = { timestamp: Date.now(), message, type, tokenData };
    if (collectLogs) {
      logs.push(log);
    }
    console.log(message);
  };

  try {
    addLog(`[Standalone AI Bot] Running for wallet ${ownerWalletAddress}`, "info");

    // Get AI bot config
    const config = await storage.getAIBotConfig(ownerWalletAddress);
    if (!config) {
      throw new Error("AI bot config not found");
    }

    // Check if AI bot is enabled
    if (!config.enabled) {
      addLog(`[Standalone AI Bot] Disabled for wallet ${ownerWalletAddress}`, "warning");
      return logs;
    }

    // Validate Grok API key
    if (!isGrokConfigured()) {
      addLog("[Standalone AI Bot] XAI_API_KEY not configured", "error");
      return logs;
    }

    // Get or initialize bot state
    let botState = aiBotStates.get(ownerWalletAddress);
    const today = new Date().toISOString().split("T")[0];

    if (!botState || botState.lastResetDate !== today) {
      botState = {
        projectId: ownerWalletAddress, // Use wallet address as ID
        dailyTradesExecuted: 0,
        lastResetDate: today,
        activePositions: new Map(),
      };
      aiBotStates.set(ownerWalletAddress, botState);
    }

    // Check daily trade limit
    const maxDailyTrades = config.maxDailyTrades || 10;
    if (botState.dailyTradesExecuted >= maxDailyTrades) {
      addLog(`[Standalone AI Bot] Daily trade limit reached (${maxDailyTrades})`, "warning");
      return logs;
    }

    // Get wallet keypair from encrypted key in config
    if (!config.treasuryKeyCiphertext || !config.treasuryKeyIv || !config.treasuryKeyAuthTag) {
      addLog(`[Standalone AI Bot] No treasury key configured for wallet ${ownerWalletAddress}`, "error");
      return logs;
    }

    const { decrypt } = await import("./crypto");
    const treasuryKeyBase58 = decrypt(
      config.treasuryKeyCiphertext,
      config.treasuryKeyIv,
      config.treasuryKeyAuthTag
    );
    const treasuryKeypair = loadKeypairFromPrivateKey(treasuryKeyBase58);

    // Check total budget and remaining balance
    const totalBudget = parseFloat(config.totalBudget || "0");
    const budgetUsed = parseFloat(config.budgetUsed || "0");
    const remainingBudget = totalBudget - budgetUsed;
    const budgetPerTrade = parseFloat(config.budgetPerTrade || "0");

    if (totalBudget > 0 && remainingBudget <= 0) {
      addLog(`💰 Budget exhausted: ${budgetUsed}/${totalBudget} SOL used`, "warning");
      return logs;
    }

    // Reserve 0.01 SOL for transaction fees
    const FEE_RESERVE = 0.01;
    
    if (totalBudget > 0 && remainingBudget < budgetPerTrade + FEE_RESERVE) {
      addLog(`💰 Insufficient budget: ${remainingBudget.toFixed(4)} SOL remaining (need ${budgetPerTrade} SOL + ${FEE_RESERVE} SOL fee reserve)`, "warning");
      return logs;
    }

    // Check SOL balance (with fee reserve)
    const solBalance = await getWalletBalance(treasuryKeypair.publicKey.toString());
    
    if (solBalance < budgetPerTrade + FEE_RESERVE) {
      addLog(`💰 Insufficient SOL balance: ${solBalance.toFixed(4)} SOL (need ${budgetPerTrade} SOL + ${FEE_RESERVE} SOL for fees)`, "error");
      return logs;
    }

    addLog(`💰 Budget status: ${budgetUsed.toFixed(4)}/${totalBudget.toFixed(4)} SOL used (${remainingBudget.toFixed(4)} remaining)`, "success");

    // Fetch trending tokens with organic volume filtering
    addLog(`🔍 Fetching trending tokens from DexScreener with organic volume filters...`, "info");
    const trendingTokens = await fetchTrendingPumpFunTokens({
      minOrganicScore: config.minOrganicScore || 40,
      minQualityScore: config.minQualityScore || 30,
      minLiquidityUSD: parseFloat(config.minLiquidityUSD || "5000"),
      minTransactions24h: config.minTransactions24h || 20,
    });
    
    // Filter by volume threshold
    const minVolumeUSD = parseFloat(config.minVolumeUSD || "1000");
    const filteredTokens = trendingTokens.filter((t) => t.volumeUSD24h >= minVolumeUSD);

    if (filteredTokens.length === 0) {
      addLog(`❌ No tokens meet volume criteria (minimum $${minVolumeUSD.toLocaleString()})`, "warning");
      return logs;
    }

    addLog(`🔍 Analyzing ${filteredTokens.length} tokens with AI (Groq Llama 3.3-70B)...`, "info");

    // Analyze tokens with Grok AI
    const riskTolerance = (config.riskTolerance || "medium") as "low" | "medium" | "high";
    
    for (let i = 0; i < filteredTokens.length; i++) {
      const token = filteredTokens[i];
      
      // Check if we've hit daily limit
      if (botState.dailyTradesExecuted >= maxDailyTrades) {
        addLog(`⏹️ Daily trade limit reached (${maxDailyTrades})`, "warning");
        break;
      }

      addLog(`📊 Analyzing token ${i + 1}/${filteredTokens.length}: ${token.symbol} (${token.name})`, "info", {
        symbol: token.symbol,
        name: token.name,
        priceUSD: token.priceUSD,
        priceSOL: token.priceSOL,
        volumeUSD24h: token.volumeUSD24h,
        marketCapUSD: token.marketCapUSD,
        liquidityUSD: token.liquidityUSD,
        priceChange24h: token.priceChange24h,
      });

      // Use Hive Mind for multi-model consensus
      const hiveMindResult = await analyzeTokenWithHiveMind(token, riskTolerance, budgetPerTrade, 0.6);
      const analysis = hiveMindResult.analysis;

      addLog(`🧠 Hive Mind: ${hiveMindResult.consensus}`, "info", { symbol: token.symbol });
      hiveMindResult.votes.forEach(vote => {
        addLog(`  ${vote.success ? '✅' : '❌'} ${vote.provider}: ${vote.analysis.action.toUpperCase()} (${(vote.analysis.confidence * 100).toFixed(0)}%)`, 
          vote.success ? "info" : "warning", 
          { provider: vote.provider, success: vote.success }
        );
      });

      addLog(`🤖 AI Analysis: ${analysis.action.toUpperCase()} | Confidence: ${(analysis.confidence * 100).toFixed(1)}% | Potential: ${analysis.potentialUpsidePercent.toFixed(1)}%`, "info", {
        symbol: token.symbol,
        action: analysis.action,
        confidence: analysis.confidence,
        potentialUpside: analysis.potentialUpsidePercent,
        reasoning: analysis.reasoning,
      });

      // Check minimum potential threshold (hardcoded 50% minimum)
      const minPotential = Math.max(parseFloat(config.minPotentialPercent || "50"), 50);
      if (analysis.potentialUpsidePercent < minPotential) {
        addLog(`⏭️ SKIP ${token.symbol}: Potential ${analysis.potentialUpsidePercent.toFixed(1)}% below threshold ${minPotential}%`, "warning");
        continue;
      }

      // Check confidence threshold
      if (analysis.confidence < 0.6) {
        addLog(`⏭️ SKIP ${token.symbol}: Confidence ${(analysis.confidence * 100).toFixed(1)}% below 60% threshold`, "warning");
        continue;
      }

      // Execute trade based on AI recommendation
      if (analysis.action === "buy") {
        const amountSOL = analysis.suggestedBuyAmountSOL || budgetPerTrade;
        
        addLog(`🚀 BUY SIGNAL: ${token.symbol} - ${amountSOL} SOL (confidence: ${(analysis.confidence * 100).toFixed(1)}%)`, "success", {
          symbol: token.symbol,
          amount: amountSOL,
          confidence: analysis.confidence,
          reasoning: analysis.reasoning,
        });

        // Buy using Jupiter Ultra API for better routing and pricing
        const result = await buyTokenWithJupiter(
          treasuryKeyBase58,
          token.mint,
          amountSOL,
          1000 // 10% slippage (1000 bps)
        );

        if (result.success && result.signature) {
          // Update budget tracking
          const newBudgetUsed = budgetUsed + amountSOL;
          await storage.createOrUpdateAIBotConfig({
            ownerWalletAddress,
            budgetUsed: newBudgetUsed.toString(),
          });
          addLog(`💰 Budget updated: ${newBudgetUsed.toFixed(4)}/${totalBudget.toFixed(4)} SOL used`, "info");

          // Record transaction (no project ID for standalone)
          await storage.createTransaction({
            projectId: "", // Empty for standalone AI bot transactions
            type: "ai_buy",
            amount: amountSOL.toString(),
            tokenAmount: "0", // Would need to calculate from tx
            txSignature: result.signature,
            status: "completed",
            expectedPriceSOL: token.priceSOL.toString(),
            actualPriceSOL: token.priceSOL.toString(),
          });

          // Broadcast real-time update
          realtimeService.broadcast({
            type: "transaction_event",
            data: {
              projectId: ownerWalletAddress, // Use wallet address
              transactionType: "ai_buy",
              signature: result.signature,
              amount: amountSOL,
              token: token.symbol,
              analysis: analysis.reasoning,
            },
            timestamp: Date.now(),
          });

          // Track position (both in-memory and database)
          botState.activePositions.set(token.mint, {
            mint: token.mint,
            entryPriceSOL: token.priceSOL,
            amountSOL,
          });

          // Save position to database for persistence across restarts
          await storage.createAIBotPosition({
            ownerWalletAddress,
            tokenMint: token.mint,
            tokenSymbol: token.symbol,
            tokenName: token.name,
            entryPriceSOL: token.priceSOL.toString(),
            amountSOL: amountSOL.toString(),
            tokenAmount: "0", // Would need to calculate from tx
            buyTxSignature: result.signature,
            lastCheckPriceSOL: token.priceSOL.toString(),
            lastCheckProfitPercent: "0",
            aiConfidenceAtBuy: analysis.confidence,
            aiPotentialAtBuy: analysis.potentialUpsidePercent.toString(),
          });

          botState.dailyTradesExecuted++;
          addLog(`✅ Trade executed successfully! ${token.symbol} bought (${botState.dailyTradesExecuted}/${maxDailyTrades} trades today)`, "success", {
            symbol: token.symbol,
            txSignature: result.signature,
            amount: amountSOL,
          });
        } else {
          addLog(`❌ Trade failed: ${result.error}`, "error");
        }
      }
    }

    // Check active positions for profit-taking
    const profitTargetPercent = parseFloat(config.profitTargetPercent || "50");
    const enableAiSellDecisions = config.enableAiSellDecisions !== false; // Default true
    const minAiSellConfidence = config.minAiSellConfidence || 40;
    const holdIfHighConfidence = config.holdIfHighConfidence || 70;
    
    if (botState.activePositions.size > 0) {
      const modeText = enableAiSellDecisions 
        ? `AI-driven sell decisions (confidence thresholds: ${minAiSellConfidence}/${holdIfHighConfidence})`
        : `Fixed profit target (${profitTargetPercent}%)`;
      addLog(`📊 Checking ${botState.activePositions.size} active positions - Mode: ${modeText}`, "info");

      // Convert Map to array for iteration
      const positionsArray = Array.from(botState.activePositions.entries());
      for (const [mint, position] of positionsArray) {
        try {
          // Get current SOL price for the token
          const currentPriceSOL = await getTokenPrice(mint);
          if (!currentPriceSOL) {
            addLog(`⏭️ Skip position ${mint}: Unable to fetch current price`, "warning");
            continue;
          }

          // Calculate profit percentage
          const profitPercent = ((currentPriceSOL - position.entryPriceSOL) / position.entryPriceSOL) * 100;
          
          addLog(`💹 Position ${mint.slice(0, 8)}... | Entry: ${position.entryPriceSOL.toFixed(8)} SOL | Current: ${currentPriceSOL.toFixed(8)} SOL | Profit: ${profitPercent > 0 ? '+' : ''}${profitPercent.toFixed(2)}%`, "info");

          // Determine whether to sell based on AI or fixed profit target
          let shouldSell = false;
          let sellReason = "";

          if (enableAiSellDecisions) {
            // Use AI to make sell decision
            addLog(`🤖 Re-analyzing position with AI...`, "info");
            const aiDecision = await reanalyzePositionWithAI(mint, currentPriceSOL, profitPercent);
            
            // If AI analysis failed, fall back to fixed profit target logic
            if (aiDecision.errored) {
              addLog(`⚠️ AI analysis failed, using fallback logic - ${aiDecision.reasoning}`, "warning");
              // Conservative fallback: sell if in profit and profit target reached, otherwise hold
              if (profitPercent >= profitTargetPercent && profitPercent > 0) {
                shouldSell = true;
                sellReason = `AI analysis failed - selling at profit target (${profitPercent.toFixed(2)}%)`;
              } else {
                addLog(`🛡️ HOLDING on AI error (profit: ${profitPercent.toFixed(2)}%) - conservative fallback`, "info");
              }
            } else {
              addLog(`🧠 AI Decision: ${aiDecision.recommendation} (confidence: ${aiDecision.confidence}%) - ${aiDecision.reasoning}`, "info");

              // Respect explicit HOLD recommendation when AI has valid analysis
              if (aiDecision.recommendation === "HOLD") {
                addLog(`🎯 HOLDING - AI recommends HOLD (confidence: ${aiDecision.confidence}%)`, "success");
                shouldSell = false;
              }
              // Sell if AI confidence drops below minimum threshold (momentum weakening)
              else if (aiDecision.confidence < minAiSellConfidence) {
                shouldSell = true;
                sellReason = `AI confidence dropped to ${aiDecision.confidence}% (below ${minAiSellConfidence}% threshold)`;
              }
              // Sell if profit target reached AND AI doesn't have high confidence to hold
              else if (profitPercent >= profitTargetPercent && aiDecision.confidence < holdIfHighConfidence) {
                shouldSell = true;
                sellReason = `Profit target reached (${profitPercent.toFixed(2)}%) and AI confidence (${aiDecision.confidence}%) < hold threshold (${holdIfHighConfidence}%)`;
              }
              // Sell if AI explicitly recommends selling
              else if (aiDecision.recommendation === "SELL") {
                shouldSell = true;
                sellReason = `AI recommends SELL: ${aiDecision.reasoning}`;
              }
              // Hold if AI confidence is high (already covered by HOLD recommendation check above)
              else if (aiDecision.confidence >= holdIfHighConfidence) {
                addLog(`🎯 HOLDING despite ${profitPercent.toFixed(2)}% profit - AI confidence is HIGH (${aiDecision.confidence}% >= ${holdIfHighConfidence}%)`, "success");
              }
            }
          } else {
            // Use fixed profit target (legacy mode)
            if (profitPercent >= profitTargetPercent) {
              shouldSell = true;
              sellReason = `Fixed profit target reached (${profitPercent.toFixed(2)}% >= ${profitTargetPercent}%)`;
            }
          }

          // Execute sell if determined
          if (shouldSell) {
            addLog(`🎯 SELLING ${mint.slice(0, 8)}... - Reason: ${sellReason}`, "success");

            // Get token balance to sell
            const connection = getConnection();
            const tokenAccount = await connection.getTokenAccountsByOwner(treasuryKeypair.publicKey, {
              mint: new PublicKey(mint),
            });

            if (tokenAccount.value.length === 0) {
              addLog(`⚠️ No token account found for ${mint.slice(0, 8)}... - position may already be closed`, "warning");
              botState.activePositions.delete(mint);
              await storage.deleteAIBotPositionByMint(ownerWalletAddress, mint);
              continue;
            }

            // Sell using Jupiter Ultra API
            const sellResult = await sellTokenWithJupiter(
              treasuryKeyBase58,
              mint,
              1000 // 10% slippage
            );

            if (sellResult.success && sellResult.signature) {
              // Calculate SOL received (approximate based on price and original investment)
              const solReceived = position.amountSOL * (1 + profitPercent / 100);
              
              // Record sell transaction
              await storage.createTransaction({
                projectId: "", // Empty for standalone AI bot
                type: "ai_sell",
                amount: solReceived.toFixed(6), // SOL received from sale
                tokenAmount: "0", // We don't track exact token amount
                txSignature: sellResult.signature,
                status: "completed",
                expectedPriceSOL: currentPriceSOL.toString(),
                actualPriceSOL: currentPriceSOL.toString(),
              });

              // Update budget: return original investment to available budget
              const currentConfig = await storage.getAIBotConfig(ownerWalletAddress);
              if (currentConfig) {
                const currentBudgetUsed = parseFloat(currentConfig.budgetUsed || "0");
                const newBudgetUsed = Math.max(0, currentBudgetUsed - position.amountSOL);
                
                await storage.createOrUpdateAIBotConfig({
                  ownerWalletAddress,
                  budgetUsed: newBudgetUsed.toFixed(6),
                });
                
                addLog(`💰 Budget updated: ${currentBudgetUsed.toFixed(3)} → ${newBudgetUsed.toFixed(3)} SOL used (returned ${position.amountSOL.toFixed(3)} SOL)`, "info");
              }

              // Broadcast real-time update
              realtimeService.broadcast({
                type: "transaction_event",
                data: {
                  projectId: ownerWalletAddress,
                  transactionType: "ai_sell",
                  signature: sellResult.signature,
                  profit: profitPercent,
                  solReceived: solReceived.toFixed(6),
                },
                timestamp: Date.now(),
              });

              // Remove from active positions (both in-memory and database)
              botState.activePositions.delete(mint);
              await storage.deleteAIBotPositionByMint(ownerWalletAddress, mint);
              addLog(`✅ Sold successfully! Profit: ${profitPercent.toFixed(2)}% | Received: ${solReceived.toFixed(6)} SOL | TX: ${sellResult.signature.slice(0, 8)}...`, "success");
            } else {
              addLog(`❌ Sell failed: ${sellResult.error}`, "error");
            }
          }
        } catch (error) {
          addLog(`❌ Error checking position ${mint.slice(0, 8)}...: ${error instanceof Error ? error.message : String(error)}`, "error");
        }
      }
    }

    addLog(`✅ Run complete for wallet ${ownerWalletAddress}`, "success");
    return logs;
  } catch (error) {
    const errorMessage = `❌ Error: ${error instanceof Error ? error.message : String(error)}`;
    addLog(errorMessage, "error");
    console.error(`[Standalone AI Bot] Error for wallet ${ownerWalletAddress}:`, error);
    if (collectLogs) {
      return logs;
    }
    throw error;
  }
}

/**
 * Manual trigger for standalone AI bot (no project required)
 */
export async function triggerStandaloneAIBot(ownerWalletAddress: string): Promise<ScanLog[]> {
  return await executeStandaloneAIBot(ownerWalletAddress, true);
}

/**
 * Re-analyze a held position using AI to decide whether to hold or sell
 * Returns AI confidence (0-100) and recommendation (HOLD or SELL)
 */
async function reanalyzePositionWithAI(
  tokenMint: string,
  currentPriceSOL: number,
  profitPercent: number
): Promise<{
  confidence: number;
  recommendation: "HOLD" | "SELL";
  reasoning: string;
  errored: boolean;
}> {
  try {
    // Fetch current market data from DexScreener
    console.log(`[AI Re-analysis] Analyzing position ${tokenMint.slice(0, 8)}... (current profit: ${profitPercent.toFixed(2)}%)`);
    
    const response = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${tokenMint}`);
    if (!response.ok) {
      throw new Error(`DexScreener API error: ${response.statusText}`);
    }

    const data = await response.json();
    const pairs = data.pairs || [];
    
    if (pairs.length === 0) {
      return {
        confidence: 0,
        recommendation: "SELL",
        reasoning: "No market data available - position may be illiquid",
        errored: true
      };
    }

    // Get the main pair (usually first/most liquid)
    const pair = pairs[0];
    
    // Prepare market data for AI analysis
    const marketData = {
      symbol: pair.baseToken?.symbol || "UNKNOWN",
      priceSOL: currentPriceSOL,
      volumeUSD24h: parseFloat(pair.volume?.h24 || "0"),
      liquidityUSD: parseFloat(pair.liquidity?.usd || "0"),
      priceChange24h: parseFloat(pair.priceChange?.h24 || "0"),
      priceChange6h: parseFloat(pair.priceChange?.h6 || "0"),
      priceChange1h: parseFloat(pair.priceChange?.h1 || "0"),
      txns24h: (pair.txns?.h24?.buys || 0) + (pair.txns?.h24?.sells || 0),
      buysVsSells24h: pair.txns?.h24?.buys && pair.txns?.h24?.sells 
        ? (pair.txns.h24.buys / (pair.txns.h24.buys + pair.txns.h24.sells)) * 100
        : 50,
      currentProfit: profitPercent,
    };

    // Build AI analysis prompt focused on sell decision
    const prompt = `You are analyzing a currently held cryptocurrency position to determine whether to HOLD or SELL.

Token: ${marketData.symbol}
Current Profit/Loss: ${marketData.currentProfit.toFixed(2)}%

Current Market Data:
- Price (SOL): ${marketData.priceSOL.toFixed(9)}
- 24h Volume: $${marketData.volumeUSD24h.toLocaleString()}
- Liquidity: $${marketData.liquidityUSD.toLocaleString()}
- Price Change (1h): ${marketData.priceChange1h.toFixed(2)}%
- Price Change (6h): ${marketData.priceChange6h.toFixed(2)}%
- Price Change (24h): ${marketData.priceChange24h.toFixed(2)}%
- 24h Transactions: ${marketData.txns24h}
- Buy Pressure: ${marketData.buysVsSells24h.toFixed(1)}%

Analyze this position and provide:
1. CONFIDENCE (0-100): Your confidence in the token's prospects
   - 70-100: Strong upward momentum, hold for more gains
   - 40-69: Mixed signals, consider profit target
   - 0-39: Weakening momentum, consider selling

2. RECOMMENDATION: HOLD or SELL
   - HOLD: If you believe the token has strong upward potential
   - SELL: If momentum is weakening or reversal signs appear

3. REASONING: Brief explanation (2-3 sentences)

Consider:
- Is price momentum strengthening or weakening?
- Is liquidity sufficient for exit if needed?
- Are there signs of reversal (falling volume, declining buy pressure)?
- Is the current profit sustainable or at risk?

Respond in JSON format:
{
  "confidence": <number 0-100>,
  "recommendation": "<HOLD or SELL>",
  "reasoning": "<your analysis>"
}`;

    // Call AI analysis directly with OpenAI client
    const { client, model, provider } = getAIClient();
    
    const aiApiResponse = await client.chat.completions.create({
      model: model,
      messages: [
        {
          role: "system",
          content: "You are a professional cryptocurrency trading analyst. Analyze token positions and provide sell/hold recommendations. Always respond with valid JSON."
        },
        {
          role: "user",
          content: prompt
        }
      ],
      response_format: { type: "json_object" },
      temperature: 0.7,
      max_tokens: 500,
    });

    const analysisText = aiApiResponse.choices[0].message.content;
    if (!analysisText) {
      throw new Error("No response from AI");
    }

    // Parse AI response
    let aiResponse: any;
    try {
      aiResponse = JSON.parse(analysisText);
    } catch (parseError) {
      console.error("[AI Re-analysis] Failed to parse AI response:", analysisText);
      // Fallback: extract confidence and recommendation from text
      const confidenceMatch = analysisText.match(/confidence["\s:]+(\d+)/i);
      const recommendationMatch = analysisText.match(/recommendation["\s:]+([A-Z]+)/i);
      
      aiResponse = {
        confidence: confidenceMatch ? parseInt(confidenceMatch[1]) : 50,
        recommendation: recommendationMatch && recommendationMatch[1].toUpperCase() === "HOLD" ? "HOLD" : "SELL",
        reasoning: "AI analysis completed with text parsing fallback"
      };
    }

    const confidence = Math.min(100, Math.max(0, aiResponse.confidence || 50));
    const recommendation = aiResponse.recommendation?.toUpperCase() === "HOLD" ? "HOLD" : "SELL";
    const reasoning = aiResponse.reasoning || "Analysis completed";

    console.log(`[AI Re-analysis] ${tokenMint.slice(0, 8)}... → ${recommendation} (confidence: ${confidence}%) - ${reasoning}`);

    return {
      confidence,
      recommendation,
      reasoning,
      errored: false
    };

  } catch (error) {
    console.error("[AI Re-analysis] Error:", error);
    // On error, mark as errored - scheduler will fall back to fixed logic
    return {
      confidence: 0,
      recommendation: profitPercent > 0 ? "SELL" : "HOLD",
      reasoning: `Analysis error: ${error instanceof Error ? error.message : String(error)}`,
      errored: true
    };
  }
}

/**
 * Get active positions for a wallet address (reads from database)
 */
export async function getActivePositions(ownerWalletAddress: string): Promise<Array<{
  mint: string;
  entryPriceSOL: number;
  amountSOL: number;
  currentPriceSOL: number;
  profitPercent: number;
}>> {
  try {
    // Read positions from database (persisted across restarts)
    const dbPositions = await storage.getAIBotPositions(ownerWalletAddress);
    
    if (dbPositions.length === 0) {
      return [];
    }

    const positions = [];
    
    for (const position of dbPositions) {
      try {
        // Get current price for profit calculation
        const currentPriceSOL = await getTokenPrice(position.tokenMint);
        const entryPrice = parseFloat(position.entryPriceSOL);
        const profitPercent = currentPriceSOL 
          ? ((currentPriceSOL - entryPrice) / entryPrice) * 100
          : 0;

        positions.push({
          mint: position.tokenMint,
          entryPriceSOL: entryPrice,
          amountSOL: parseFloat(position.amountSOL),
          currentPriceSOL: currentPriceSOL || 0,
          profitPercent,
        });
      } catch (error) {
        console.error(`Error fetching price for ${position.tokenMint}:`, error);
        // Still include position but with 0 current price
        positions.push({
          mint: position.tokenMint,
          entryPriceSOL: parseFloat(position.entryPriceSOL),
          amountSOL: parseFloat(position.amountSOL),
          currentPriceSOL: 0,
          profitPercent: 0,
        });
      }
    }

    return positions;
  } catch (error) {
    console.error(`Error fetching active positions for ${ownerWalletAddress}:`, error);
    return [];
  }
}
