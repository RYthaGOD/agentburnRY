// AI Trading Bot Scheduler - Grok-powered PumpFun trading automation
// Scans PumpFun trending tokens, analyzes with Grok AI, and executes trades

import cron from "node-cron";
import { storage } from "./storage";
import { analyzeTokenWithGrok, analyzeTokenWithHiveMind, isGrokConfigured, getAIClient, type TokenMarketData } from "./grok-analysis";
import { buyTokenWithJupiter, buyTokenWithFallback, getTokenPrice, getSwapOrder, executeSwapOrder, getWalletBalances } from "./jupiter";
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
 * AI Bot State Interface (used by standalone AI bot system)
 * Tracks in-memory state for active trading sessions
 */
interface AIBotState {
  projectId: string;
  dailyTradesExecuted: number;
  lastResetDate: string; // YYYY-MM-DD
  lastActivityTimestamp: number; // Track when bot was last active for cleanup
  activePositions: Map<string, { mint: string; entryPriceSOL: number; amountSOL: number }>;
}

/**
 * In-memory state tracking for standalone AI bot
 * Key: ownerWalletAddress
 */
const aiBotStates = new Map<string, AIBotState>();

/**
 * Cron job references for graceful shutdown
 */
let quickScanJob: cron.ScheduledTask | null = null;
let deepScanJob: cron.ScheduledTask | null = null;
let memoryCleanupJob: cron.ScheduledTask | null = null;
let positionMonitorJob: cron.ScheduledTask | null = null;
let portfolioRebalancerJob: cron.ScheduledTask | null = null;

/**
 * Stop all AI bot schedulers
 */
export function stopAllAIBotSchedulers() {
  console.log("[AI Bot Scheduler] Stopping all schedulers...");
  
  if (quickScanJob) {
    quickScanJob.stop();
    quickScanJob = null;
    console.log("[AI Bot Scheduler] Quick scan scheduler stopped");
  }
  
  if (deepScanJob) {
    deepScanJob.stop();
    deepScanJob = null;
    console.log("[AI Bot Scheduler] Deep scan scheduler stopped");
  }
  
  if (memoryCleanupJob) {
    memoryCleanupJob.stop();
    memoryCleanupJob = null;
    console.log("[AI Bot Scheduler] Memory cleanup scheduler stopped");
  }
  
  if (positionMonitorJob) {
    positionMonitorJob.stop();
    positionMonitorJob = null;
    console.log("[Position Monitor] Position monitoring scheduler stopped");
  }
  
  if (portfolioRebalancerJob) {
    portfolioRebalancerJob.stop();
    portfolioRebalancerJob = null;
    console.log("[Portfolio Rebalancer] Portfolio rebalancing scheduler stopped");
  }
  
  console.log("[AI Bot Scheduler] All schedulers stopped successfully");
}

/**
 * Trigger system shutdown when AI bot is disabled
 */
async function triggerSystemShutdown(reason: string) {
  console.log(`\n${"=".repeat(70)}`);
  console.log(`🛑 SYSTEM SHUTDOWN TRIGGERED`);
  console.log(`Reason: ${reason}`);
  console.log(`${"=".repeat(70)}\n`);
  
  // Stop all AI bot schedulers first
  stopAllAIBotSchedulers();
  
  // Import and call the shutdown function from index.ts
  const { triggerGracefulShutdown } = await import("./index");
  await triggerGracefulShutdown();
}

/**
 * Cleanup stale bot states and expired cache entries to prevent memory leaks
 * Runs every hour to remove inactive bots (24h+ inactivity) and expired cache
 */
function cleanupMemory() {
  const now = Date.now();
  const ONE_DAY_MS = 24 * 60 * 60 * 1000;
  
  // Cleanup 1: Remove bot states that haven't been active in 24 hours
  let removedBots = 0;
  for (const [walletAddress, botState] of Array.from(aiBotStates.entries())) {
    if (now - botState.lastActivityTimestamp > ONE_DAY_MS) {
      aiBotStates.delete(walletAddress);
      removedBots++;
    }
  }
  if (removedBots > 0) {
    console.log(`[Memory Cleanup] Removed ${removedBots} inactive bot state(s)`);
  }
  
  // Cleanup 2: Remove expired cache entries from tokenDataCache
  let removedTokenCache = 0;
  for (const [key, cache] of Array.from(tokenDataCache.entries())) {
    if (cache.expiresAt < now) {
      tokenDataCache.delete(key);
      removedTokenCache++;
    }
  }
  if (removedTokenCache > 0) {
    console.log(`[Memory Cleanup] Removed ${removedTokenCache} expired token cache entry(ies)`);
  }
  
  // Cleanup 3: Remove expired cache entries from analysisCache
  let removedAnalysisCache = 0;
  for (const [key, cache] of Array.from(analysisCache.entries())) {
    if (cache.expiresAt < now) {
      analysisCache.delete(key);
      removedAnalysisCache++;
    }
  }
  if (removedAnalysisCache > 0) {
    console.log(`[Memory Cleanup] Removed ${removedAnalysisCache} expired analysis cache entry(ies)`);
  }
  
  // Log memory stats
  console.log(`[Memory Cleanup] Current state: ${aiBotStates.size} active bots, ${tokenDataCache.size} token cache entries, ${analysisCache.size} analysis cache entries`);
}

/**
 * Global scheduler status for dashboard display
 */
interface ActivityLog {
  timestamp: number;
  type: 'info' | 'success' | 'warning' | 'error' | 'ai_thought';
  category: 'quick_scan' | 'position_monitor' | 'deep_scan' | 'rebalancer';
  message: string;
}

interface SchedulerStatus {
  quickScan: {
    lastRun: number | null;
    nextRun: number | null;
    status: 'idle' | 'running' | 'error';
    lastResult?: string;
  };
  deepScan: {
    lastRun: number | null;
    nextRun: number | null;
    status: 'idle' | 'running' | 'error';
    lastResult?: string;
  };
  positionMonitor: {
    lastRun: number | null;
    nextRun: number | null;
    status: 'idle' | 'running' | 'error';
    lastResult?: string;
  };
  portfolioRebalancer: {
    lastRun: number | null;
    nextRun: number | null;
    status: 'idle' | 'running' | 'error';
    lastResult?: string;
  };
  activityLogs: ActivityLog[];
}

const schedulerStatus: SchedulerStatus = {
  quickScan: { lastRun: null, nextRun: null, status: 'idle' },
  deepScan: { lastRun: null, nextRun: null, status: 'idle' },
  positionMonitor: { lastRun: null, nextRun: null, status: 'idle' },
  portfolioRebalancer: { lastRun: null, nextRun: null, status: 'idle' },
  activityLogs: [],
};

/**
 * Add activity log and broadcast via WebSocket
 */
function logActivity(category: ActivityLog['category'], type: ActivityLog['type'], message: string) {
  const log: ActivityLog = {
    timestamp: Date.now(),
    type,
    category,
    message,
  };
  
  // Keep only last 100 logs (optimized: pop instead of slice to avoid array recreation)
  schedulerStatus.activityLogs.unshift(log);
  if (schedulerStatus.activityLogs.length > 100) {
    schedulerStatus.activityLogs.pop(); // Remove oldest log instead of creating new array
  }
  
  // Broadcast to connected clients
  realtimeService.broadcast({
    type: 'ai_activity_log',
    data: log,
    timestamp: Date.now(),
  });
}

export function getSchedulerStatus(): SchedulerStatus {
  return { ...schedulerStatus };
}

/**
 * Cache for DexScreener token data to reduce API calls
 * Cached for 15 minutes to allow frequent scans without hammering API
 */
interface TokenCache {
  tokens: TokenMarketData[];
  timestamp: number;
  expiresAt: number;
}

const tokenDataCache: Map<string, TokenCache> = new Map();
const CACHE_DURATION_MS = 15 * 60 * 1000; // 15 minutes

/**
 * Cache for AI analysis results to avoid re-analyzing same tokens
 * Cached for 30 minutes - market conditions don't change that fast
 */
interface AnalysisCache {
  analysis: any;
  timestamp: number;
  expiresAt: number;
}

const analysisCache: Map<string, AnalysisCache> = new Map();
const ANALYSIS_CACHE_DURATION_MS = 30 * 60 * 1000; // 30 minutes

/**
 * Get cached token data or fetch fresh data if cache expired
 * Combines DexScreener trending tokens with low market cap PumpFun API tokens
 */
async function getCachedOrFetchTokens(config?: {
  minOrganicScore?: number;
  minQualityScore?: number;
  minLiquidityUSD?: number;
  minTransactions24h?: number;
}): Promise<TokenMarketData[]> {
  const cacheKey = JSON.stringify(config || {});
  const cached = tokenDataCache.get(cacheKey);
  const now = Date.now();

  if (cached && cached.expiresAt > now) {
    console.log(`[AI Bot Cache] Using cached data (${Math.floor((cached.expiresAt - now) / 1000)}s remaining)`);
    return cached.tokens;
  }

  console.log("[AI Bot Cache] Cache miss or expired, fetching fresh data...");
  
  // Fetch from ALL sources in parallel for maximum coverage
  const { fetchTrendingPumpStyleTokens, fetchNewlyMigratedPumpTokens, fetchLowCapPumpTokensViaDexScreener } = await import('./pumpfun-alternative');
  
  const [dexTokens, pumpfunTrendingTokens, pumpfunMigratedTokens, pumpfunLowCapTokens] = await Promise.all([
    fetchTrendingPumpFunTokens(config), // DexScreener trending (general Solana)
    fetchTrendingPumpStyleTokens(15), // DexScreener pump-style tokens (NEW!)
    fetchNewlyMigratedPumpTokens(20), // Newly migrated tokens via DexScreener (NEW!)
    fetchLowCapPumpTokensViaDexScreener(15), // Low-cap opportunities via DexScreener (NEW!)
  ]);
  
  // Combine all sources, removing duplicates by mint address
  const seenMints = new Set<string>();
  const allTokens = [
    ...dexTokens,
    ...pumpfunTrendingTokens,
    ...pumpfunMigratedTokens,
    ...pumpfunLowCapTokens
  ].filter(token => {
    if (seenMints.has(token.mint)) return false;
    seenMints.add(token.mint);
    return true;
  });

  console.log(`[AI Bot] 🎯 Token Discovery Summary:`);
  console.log(`  - DexScreener trending: ${dexTokens.length} tokens`);
  console.log(`  - PumpFun trending: ${pumpfunTrendingTokens.length} tokens`);
  console.log(`  - Newly migrated (PumpFun → Raydium): ${pumpfunMigratedTokens.length} tokens`);
  console.log(`  - Low-cap new tokens: ${pumpfunLowCapTokens.length} tokens`);
  console.log(`  - Total (deduplicated): ${allTokens.length} tokens`);
  
  // Filter out blacklisted tokens
  const blacklistedTokens = await storage.getAllBlacklistedTokens();
  const blacklistSet = new Set(blacklistedTokens.map(b => b.tokenMint));
  const filteredTokens = allTokens.filter(token => !blacklistSet.has(token.mint));
  
  if (filteredTokens.length < allTokens.length) {
    const blockedCount = allTokens.length - filteredTokens.length;
    console.log(`[AI Bot] 🚫 Filtered out ${blockedCount} blacklisted token(s)`);
  }
  
  tokenDataCache.set(cacheKey, {
    tokens: filteredTokens,
    timestamp: now,
    expiresAt: now + CACHE_DURATION_MS,
  });

  return filteredTokens;
}

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
    
    if (!swapOrder) {
      throw new Error('Unable to sell token - no liquidity available');
    }
    
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
  
  // 5. Liquidity Depth (minimum requirement - lowered for aggressive meme coin trading)
  if (liquidityUSD < 3000) {
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
        // DUAL-MODE FILTERS: Defaults optimized for SCALP mode (more inclusive)
        // SCALP: 35% organic, 25% quality, $5k liquidity
        // SWING: Uses hivemind strategy for tighter filters
        const minOrganicScore = config?.minOrganicScore ?? 35;
        const minQualityScore = config?.minQualityScore ?? 25;
        const minLiquidity = config?.minLiquidityUSD ?? 5000;
        const minTxns = config?.minTransactions24h ?? 15;
        
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
 * Fetch top trending tokens from PumpFun API
 * Gets the most actively traded tokens on PumpFun platform
 */
async function fetchPumpFunTrendingTokens(maxTokens: number = 15): Promise<TokenMarketData[]> {
  try {
    console.log("[AI Bot] 🔥 Fetching top trending tokens from PumpFun API...");
    
    // Fetch trending tokens from PumpFun API
    const response = await fetch('https://api.pumpfunapi.org/pumpfun/trending', {
      headers: {
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      console.error(`[AI Bot] PumpFun trending API error: ${response.status}`);
      return [];
    }

    const data = await response.json();
    
    // Check if data is an array or has a tokens array
    let trendingTokens: any[] = [];
    if (Array.isArray(data)) {
      trendingTokens = data;
    } else if (data.tokens && Array.isArray(data.tokens)) {
      trendingTokens = data.tokens;
    } else {
      console.error("[AI Bot] Unexpected PumpFun trending API response format");
      return [];
    }

    console.log(`[AI Bot] 📡 Received ${trendingTokens.length} trending tokens from PumpFun API`);

    // Process and enrich with market data
    const processedTokens: TokenMarketData[] = [];
    
    for (const token of trendingTokens.slice(0, maxTokens)) {
      try {
        // Get current price and market data from DexScreener
        const dexData = await fetch(
          `https://api.dexscreener.com/latest/dex/tokens/${token.mint}`,
          { headers: { 'Accept': 'application/json' } }
        );

        if (!dexData.ok) {
          console.log(`[AI Bot] ⏭️  Skipping trending ${token.symbol || token.mint} - no market data`);
          continue;
        }

        const dexJson = await dexData.json();
        const pairs = dexJson.pairs || [];
        
        if (pairs.length === 0) {
          console.log(`[AI Bot] ⏭️  Skipping trending ${token.symbol || token.mint} - no trading pairs`);
          continue;
        }

        // Use the first pair (usually the main liquidity pool)
        const pair = pairs[0];

        const tokenData: TokenMarketData = {
          mint: token.mint,
          name: token.name || 'Unknown',
          symbol: token.symbol || 'UNKNOWN',
          priceUSD: parseFloat(pair.priceUsd || '0'),
          priceSOL: parseFloat(pair.priceNative || '0'),
          volumeUSD24h: pair.volume?.h24 || 0,
          marketCapUSD: pair.fdv || pair.marketCap || 0,
          liquidityUSD: pair.liquidity?.usd || 0,
          priceChange24h: pair.priceChange?.h24 || 0,
          priceChange1h: pair.priceChange?.h1 || 0,
          holderCount: undefined,
        };

        processedTokens.push(tokenData);
        console.log(`[AI Bot] ✅ Trending token: ${tokenData.symbol} - MC: $${tokenData.marketCapUSD.toLocaleString()}, Vol: $${tokenData.volumeUSD24h.toLocaleString()}`);

        // Rate limiting
        await new Promise(resolve => setTimeout(resolve, 300));
      } catch (error) {
        console.error(`[AI Bot] Error processing trending token ${token.mint}:`, error);
        continue;
      }
    }

    console.log(`[AI Bot] 🔥 Fetched ${processedTokens.length} trending tokens from PumpFun`);
    
    return processedTokens;
  } catch (error) {
    console.error("[AI Bot] Failed to fetch trending tokens from PumpFun API:", error);
    return [];
  }
}

/**
 * Fetch newly migrated tokens (graduated from PumpFun to Raydium)
 * These tokens have shown strong community support and graduated to DEX listing
 */
async function fetchMigratedTokens(maxTokens: number = 10): Promise<TokenMarketData[]> {
  try {
    console.log("[AI Bot] 🚀 Scanning for newly migrated tokens (PumpFun → Raydium)...");
    
    // Fetch migrated tokens from PumpFun API
    const response = await fetch('https://api.pumpfunapi.org/pumpfun/migrated', {
      headers: {
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      console.error(`[AI Bot] PumpFun migrated API error: ${response.status}`);
      return [];
    }

    const data = await response.json();
    
    // Check if data is an array or has a tokens array
    let migratedTokens: any[] = [];
    if (Array.isArray(data)) {
      migratedTokens = data;
    } else if (data.tokens && Array.isArray(data.tokens)) {
      migratedTokens = data.tokens;
    } else {
      console.error("[AI Bot] Unexpected PumpFun migrated API response format");
      return [];
    }

    console.log(`[AI Bot] 📡 Received ${migratedTokens.length} migrated tokens from PumpFun API`);

    // Process recently migrated tokens (last 24-48 hours for fresh opportunities)
    const processedTokens: TokenMarketData[] = [];
    const now = Date.now();
    const MIGRATION_WINDOW_MS = 48 * 60 * 60 * 1000; // 48 hours
    
    for (const token of migratedTokens.slice(0, maxTokens)) {
      try {
        // Check if migration is recent
        if (token.migratedAt || token.migrationTimestamp) {
          const migrationTime = new Date(token.migratedAt || token.migrationTimestamp * 1000).getTime();
          if (now - migrationTime > MIGRATION_WINDOW_MS) {
            console.log(`[AI Bot] ⏭️  Skipping ${token.symbol || token.mint} - migrated too long ago`);
            continue;
          }
        }

        // Get current price and market data from DexScreener
        const dexData = await fetch(
          `https://api.dexscreener.com/latest/dex/tokens/${token.mint}`,
          { headers: { 'Accept': 'application/json' } }
        );

        if (!dexData.ok) {
          console.log(`[AI Bot] ⏭️  Skipping migrated ${token.symbol || token.mint} - no market data`);
          continue;
        }

        const dexJson = await dexData.json();
        const pairs = dexJson.pairs || [];
        
        if (pairs.length === 0) {
          console.log(`[AI Bot] ⏭️  Skipping migrated ${token.symbol || token.mint} - no trading pairs`);
          continue;
        }

        // Use the Raydium pair (look for Raydium DEX ID)
        const raydiumPair = pairs.find((p: any) => 
          p.dexId?.toLowerCase().includes('raydium')
        ) || pairs[0];

        const tokenData: TokenMarketData = {
          mint: token.mint,
          name: token.name || 'Unknown',
          symbol: token.symbol || 'UNKNOWN',
          priceUSD: parseFloat(raydiumPair.priceUsd || '0'),
          priceSOL: parseFloat(raydiumPair.priceNative || '0'),
          volumeUSD24h: raydiumPair.volume?.h24 || 0,
          marketCapUSD: raydiumPair.fdv || raydiumPair.marketCap || 0,
          liquidityUSD: raydiumPair.liquidity?.usd || 0,
          priceChange24h: raydiumPair.priceChange?.h24 || 0,
          priceChange1h: raydiumPair.priceChange?.h1 || 0,
          holderCount: undefined,
        };

        processedTokens.push(tokenData);
        console.log(`[AI Bot] ✅ Migrated token: ${tokenData.symbol} - MC: $${tokenData.marketCapUSD.toLocaleString()}, Vol: $${tokenData.volumeUSD24h.toLocaleString()}`);

        // Rate limiting
        await new Promise(resolve => setTimeout(resolve, 300));
      } catch (error) {
        console.error(`[AI Bot] Error processing migrated token ${token.mint}:`, error);
        continue;
      }
    }

    console.log(`[AI Bot] 🚀 Fetched ${processedTokens.length} newly migrated tokens (PumpFun → Raydium)`);
    
    return processedTokens;
  } catch (error) {
    console.error("[AI Bot] Failed to fetch migrated tokens from PumpFun API:", error);
    return [];
  }
}

/**
 * Fetch very low market cap tokens directly from PumpFun API
 * Targets brand new tokens with low market caps for aggressive meme trading
 */
async function fetchLowMarketCapPumpFunTokens(maxTokens: number = 10): Promise<TokenMarketData[]> {
  try {
    console.log("[AI Bot] 🔥 Scanning PumpFun API for very low market cap new tokens...");
    
    // Fetch latest new tokens from PumpFun API
    const response = await fetch('https://api.pumpfunapi.org/pumpfun/new/tokens', {
      headers: {
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      console.error(`[AI Bot] PumpFun API error: ${response.status}`);
      return [];
    }

    const data = await response.json();
    
    // Check if data is an array or has a tokens array
    let newTokens: any[] = [];
    if (Array.isArray(data)) {
      newTokens = data;
    } else if (data.tokens && Array.isArray(data.tokens)) {
      newTokens = data.tokens;
    } else {
      console.error("[AI Bot] Unexpected PumpFun API response format");
      return [];
    }

    console.log(`[AI Bot] 📡 Received ${newTokens.length} new tokens from PumpFun API`);

    // Filter and map to TokenMarketData format
    const processedTokens: TokenMarketData[] = [];
    
    for (const token of newTokens.slice(0, maxTokens)) {
      try {
        // Get current price and market data from Jupiter/DexScreener
        const dexData = await fetch(
          `https://api.dexscreener.com/latest/dex/tokens/${token.mint}`,
          { headers: { 'Accept': 'application/json' } }
        );

        if (!dexData.ok) {
          console.log(`[AI Bot] ⏭️  Skipping ${token.symbol || token.mint} - no market data yet`);
          continue;
        }

        const dexJson = await dexData.json();
        const pairs = dexJson.pairs || [];
        
        if (pairs.length === 0) {
          console.log(`[AI Bot] ⏭️  Skipping ${token.symbol || token.mint} - no trading pairs`);
          continue;
        }

        // Use the first pair (usually the main liquidity pool)
        const pair = pairs[0];
        const marketCapUSD = pair.fdv || pair.marketCap || 0;
        
        // Filter for VERY low market cap (under $100k for aggressive meme trading)
        if (marketCapUSD > 100000) {
          console.log(`[AI Bot] ⏭️  Skipping ${token.symbol || token.mint} - market cap too high ($${marketCapUSD.toLocaleString()})`);
          continue;
        }

        const tokenData: TokenMarketData = {
          mint: token.mint,
          name: token.name || 'Unknown',
          symbol: token.symbol || 'UNKNOWN',
          priceUSD: parseFloat(pair.priceUsd || '0'),
          priceSOL: parseFloat(pair.priceNative || '0'),
          volumeUSD24h: pair.volume?.h24 || 0,
          marketCapUSD: marketCapUSD,
          liquidityUSD: pair.liquidity?.usd || 0,
          priceChange24h: pair.priceChange?.h24 || 0,
          priceChange1h: pair.priceChange?.h1 || 0,
          holderCount: undefined,
          createdAt: token.timestamp ? new Date(token.timestamp * 1000) : undefined,
          description: token.metadata || undefined,
        };

        processedTokens.push(tokenData);
        console.log(`[AI Bot] ✅ Found low cap token: ${tokenData.symbol} - MC: $${marketCapUSD.toLocaleString()}, Vol: $${tokenData.volumeUSD24h.toLocaleString()}`);

        // Rate limiting
        await new Promise(resolve => setTimeout(resolve, 300));
      } catch (error) {
        console.error(`[AI Bot] Error processing token ${token.mint}:`, error);
        continue;
      }
    }

    console.log(`[AI Bot] 🔥 Found ${processedTokens.length} very low market cap tokens (<$100k MC) from PumpFun`);
    
    return processedTokens;
  } catch (error) {
    console.error("[AI Bot] Failed to fetch low market cap tokens from PumpFun API:", error);
    return [];
  }
}

/**
 * LEGACY: Project-based AI trading bot (executeAITradingBot) removed
 * New system uses standalone AI bot with aiBotConfigs table
 * See runStandaloneAIBots() and executeStandaloneAIBot() below
 */

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

    // Get AI bot whitelist
    const { AI_BOT_WHITELISTED_WALLETS } = await import("@shared/config");
    
    // Filter to only whitelisted wallets
    const whitelistedConfigs = enabledConfigs.filter((c: any) => 
      AI_BOT_WHITELISTED_WALLETS.includes(c.ownerWalletAddress)
    );
    
    if (whitelistedConfigs.length === 0) {
      console.log("[Standalone AI Bot Scheduler] No whitelisted wallets enabled for AI trading");
      return;
    }
    
    console.log(`[Standalone AI Bot Scheduler] ${whitelistedConfigs.length} whitelisted wallets active`);

    // Check and generate hivemind strategies for each bot before running deep scan
    const { shouldGenerateNewStrategy, generateHivemindStrategy, saveHivemindStrategy, getLatestStrategy } = await import("./hivemind-strategy");
    
    for (const config of whitelistedConfigs) {
      const ownerWalletAddress = config.ownerWalletAddress;
      
      // Check if we need a new strategy
      const needsNewStrategy = await shouldGenerateNewStrategy(ownerWalletAddress);
      
      if (needsNewStrategy) {
        try {
          // TODO: Calculate recent performance from positions/transactions
          // For now, use default (no performance data)
          const strategy = await generateHivemindStrategy(ownerWalletAddress);
          await saveHivemindStrategy(ownerWalletAddress, strategy);
          console.log(`[Hivemind] Generated new strategy for ${ownerWalletAddress}: ${strategy.marketSentiment} market, ${strategy.riskLevel} risk`);
        } catch (error) {
          console.error(`[Hivemind] Error generating strategy for ${ownerWalletAddress}:`, error);
        }
      } else {
        const currentStrategy = await getLatestStrategy(ownerWalletAddress);
        if (currentStrategy) {
          console.log(`[Hivemind] Using existing strategy for ${ownerWalletAddress}: ${currentStrategy.marketSentiment} market (${currentStrategy.reasoning})`);
        }
      }
    }

    // Run bots in parallel (with reasonable concurrency) - only whitelisted wallets
    await Promise.all(whitelistedConfigs.map((c: any) => executeStandaloneAIBot(c.ownerWalletAddress)));

    console.log("[Standalone AI Bot Scheduler] All standalone bots completed");
  } catch (error) {
    console.error("[Standalone AI Bot Scheduler] Error:", error);
  }
}

/**
 * Quick scan mode: Technical filters + fast DeepSeek AI for quick money-making trades
 * Runs every 2 minutes with cached data for speed (3x more opportunities) - OPTIMIZED FOR SPEED
 */
async function runQuickTechnicalScan() {
  schedulerStatus.quickScan.status = 'running';
  schedulerStatus.quickScan.lastRun = Date.now();
  schedulerStatus.quickScan.nextRun = Date.now() + (5 * 60 * 1000); // 5 minutes
  
  try {
    console.log("[Quick Scan] Starting enhanced scan (technical + fast AI)...");
    logActivity('quick_scan', 'info', '🔍 Starting Quick Scan (5min interval)');
    
    const configs = await storage.getAllAIBotConfigs();
    const enabledConfigs = configs.filter((c: any) => c.enabled);
    
    if (enabledConfigs.length === 0) {
      console.log("[Quick Scan] No enabled AI bots");
      return;
    }
    
    // Get AI bot whitelist
    const { AI_BOT_WHITELISTED_WALLETS } = await import("@shared/config");
    
    // Filter to only whitelisted wallets
    const whitelistedConfigs = enabledConfigs.filter((c: any) => 
      AI_BOT_WHITELISTED_WALLETS.includes(c.ownerWalletAddress)
    );
    
    if (whitelistedConfigs.length === 0) {
      console.log("[Quick Scan] No whitelisted wallets enabled for AI trading");
      return;
    }
    
    // Check if DeepSeek is available for fast AI analysis
    const hasDeepSeek = !!process.env.DEEPSEEK_API_KEY;
    
    for (const config of whitelistedConfigs) {
      try {
        // Get or initialize bot state
        let botState = aiBotStates.get(config.ownerWalletAddress);
        const today = new Date().toISOString().split("T")[0];

        if (!botState || botState.lastResetDate !== today) {
          botState = {
            projectId: config.ownerWalletAddress,
            dailyTradesExecuted: 0,
            lastResetDate: today,
            lastActivityTimestamp: Date.now(),
            activePositions: new Map(),
          };
          aiBotStates.set(config.ownerWalletAddress, botState);
        } else {
          // Update last activity timestamp
          botState.lastActivityTimestamp = Date.now();
        }

        // Get hivemind strategy (required for 100% autonomous operation)
        const { getLatestStrategy } = await import("./hivemind-strategy");
        const activeStrategy = await getLatestStrategy(config.ownerWalletAddress);
        
        if (!activeStrategy) {
          console.log(`[Quick Scan] No hivemind strategy for ${config.ownerWalletAddress.slice(0, 8)}... (will be generated on next deep scan)`);
          continue;
        }

        // Hivemind controls all parameters
        const maxDailyTrades = activeStrategy.maxDailyTrades;
        const minVolumeUSD = activeStrategy.minVolumeUSD;
        const minLiquidityUSD = activeStrategy.minLiquidityUSD;
        const minOrganicScore = activeStrategy.minOrganicScore;
        const minQualityScore = activeStrategy.minQualityScore;
        const minTransactions24h = activeStrategy.minTransactions24h;
        const budgetPerTrade = activeStrategy.budgetPerTrade;
        const riskLevel = activeStrategy.riskLevel;
        const minConfidenceThreshold = activeStrategy.minConfidenceThreshold / 100; // Convert to 0-1

        console.log(`[Quick Scan] 🧠 Hivemind: ${activeStrategy.marketSentiment} market, ${riskLevel} risk`);

        // Get cached tokens with hivemind filters
        const tokens = await getCachedOrFetchTokens({
          minOrganicScore,
          minQualityScore,
          minLiquidityUSD,
          minTransactions24h,
        });
        
        const filteredTokens = tokens.filter((t) => t.volumeUSD24h >= minVolumeUSD);
        
        // Quick technical filters with hivemind liquidity threshold
        const opportunities = filteredTokens.filter(token => {
          const has1hMomentum = (token.priceChange1h ?? 0) > 0;
          const has24hMomentum = (token.priceChange24h ?? 0) > 0;
          const hasVolume = token.volumeUSD24h >= minVolumeUSD;
          const hasLiquidity = (token.liquidityUSD ?? 0) >= minLiquidityUSD;
          return has1hMomentum && has24hMomentum && hasVolume && hasLiquidity;
        });
        
        if (opportunities.length === 0) {
          console.log(`[Quick Scan] No technical opportunities for ${config.ownerWalletAddress.slice(0, 8)}...`);
          continue;
        }

        console.log(`[Quick Scan] Found ${opportunities.length} technical opportunities for ${config.ownerWalletAddress.slice(0, 8)}...`);

        // Fetch existing positions once (optimization)
        const existingPositions = await storage.getAIBotPositions(config.ownerWalletAddress);

        // If DeepSeek available, analyze top 5 opportunities with fast AI (caching makes this efficient)
        if (hasDeepSeek && opportunities.length > 0) {
          const topOpportunities = opportunities.slice(0, 5); // Check top 5 - caching makes this efficient
          console.log(`[Quick Scan] 🧠 Analyzing top ${topOpportunities.length} with DeepSeek (FREE tier, 30min cache)...`);

          for (const token of topOpportunities) {
            // Quick DeepSeek-only analysis for high confidence trades
            const riskTolerance = riskLevel === "aggressive" ? "high" : riskLevel === "conservative" ? "low" : "medium";
            const quickAnalysis = await analyzeTokenWithDeepSeekOnly(
              token,
              riskTolerance,
              budgetPerTrade
            );

            // DUAL-MODE SYSTEM: SCALP (62%+) or SWING (75%+) thresholds
            const SCALP_THRESHOLD = 0.62; // Mode A: Quick micro-profits
            const SWING_THRESHOLD = 0.75; // Mode B: High-conviction holds
            const minThreshold = SCALP_THRESHOLD; // Always check for SCALP opportunities in quick scan
            
            // Determine trade mode based on confidence
            const tradeMode = determineTradeMode(quickAnalysis.confidence);
            const modeLabel = tradeMode.mode === "SCALP" ? "🎯 SCALP" : "🚀 SWING";
            
            // Execute trade if confidence meets minimum threshold (62% for SCALP, 75% for SWING)
            if (quickAnalysis.action === "buy" && quickAnalysis.confidence >= minThreshold) {
              console.log(`[Quick Scan] ${modeLabel}: ${token.symbol} - ${(quickAnalysis.confidence * 100).toFixed(1)}% confidence (${tradeMode.positionSizePercent}% position, ${tradeMode.profitTargetPercent}% target, ${tradeMode.stopLossPercent}% stop)`);
              
              // Execute trade immediately with mode-specific parameters!
              await executeQuickTrade(config, token, quickAnalysis, botState, existingPositions);
            } else if (quickAnalysis.confidence >= minThreshold && quickAnalysis.action !== "sell") {
              // High confidence but not BUY action - log for analysis
              console.log(`[Quick Scan] ⚠️ ${token.symbol}: ${quickAnalysis.action.toUpperCase()} ${(quickAnalysis.confidence * 100).toFixed(1)}% (meets ${(minThreshold * 100).toFixed(0)}% threshold but action is ${quickAnalysis.action}, not buy)`);
            } else {
              console.log(`[Quick Scan] ⏭️ ${token.symbol}: ${quickAnalysis.action.toUpperCase()} ${(quickAnalysis.confidence * 100).toFixed(1)}% (below ${(minThreshold * 100).toFixed(0)}% SCALP threshold)`);
            }
          }
        }
      } catch (error) {
        console.error(`[Quick Scan] Error for ${config.ownerWalletAddress}:`, error);
      }
    }
    
    console.log("[Quick Scan] Complete");
    logActivity('quick_scan', 'success', `✅ Quick Scan complete - analyzed ${enabledConfigs.length} wallets`);
    schedulerStatus.quickScan.status = 'idle';
    schedulerStatus.quickScan.lastResult = `Scanned ${enabledConfigs.length} wallets`;
  } catch (error) {
    console.error("[Quick Scan] Error:", error);
    schedulerStatus.quickScan.status = 'error';
    schedulerStatus.quickScan.lastResult = `Error: ${error instanceof Error ? error.message : 'Unknown'}`;
  }
}

/**
 * Get cached AI analysis or return null if not found/expired
 */
function getCachedAnalysis(tokenMint: string): any | null {
  const cached = analysisCache.get(tokenMint);
  const now = Date.now();
  
  if (cached && cached.expiresAt > now) {
    const remainingMinutes = Math.floor((cached.expiresAt - now) / 60000);
    console.log(`[AI Cache] Using cached analysis for ${tokenMint.slice(0, 8)}... (${remainingMinutes}m remaining)`);
    return cached.analysis;
  }
  
  return null;
}

/**
 * Cache AI analysis result for 30 minutes
 */
function cacheAnalysis(tokenMint: string, analysis: any): void {
  const now = Date.now();
  analysisCache.set(tokenMint, {
    analysis,
    timestamp: now,
    expiresAt: now + ANALYSIS_CACHE_DURATION_MS,
  });
}

/**
 * Fast single-model analysis with AUTOMATIC FAILOVER
 * Tries: DeepSeek Primary → DeepSeek Backup → OpenAI → Cerebras → Groq
 * Used for quick 75%+ confidence trades
 * Results cached for 30 minutes to reduce API calls
 */
async function analyzeTokenWithDeepSeekOnly(
  tokenData: TokenMarketData,
  riskTolerance: "low" | "medium" | "high",
  budgetPerTrade: number
): Promise<{
  action: "buy" | "sell" | "hold";
  confidence: number;
  reasoning: string;
  potentialUpsidePercent: number;
  riskLevel: "low" | "medium" | "high";
}> {
  // Check cache first
  const cached = getCachedAnalysis(tokenData.mint);
  if (cached) {
    return cached;
  }

  const prompt = `You are an aggressive Solana trading bot. Analyze this token for BUYING OPPORTUNITIES.

Token: ${tokenData.name} (${tokenData.symbol})
Price: $${tokenData.priceUSD.toFixed(6)} (${tokenData.priceSOL.toFixed(9)} SOL)
Market Cap: $${tokenData.marketCapUSD.toLocaleString()}
24h Volume: $${tokenData.volumeUSD24h.toLocaleString()}
Liquidity: $${(tokenData.liquidityUSD ?? 0).toLocaleString()}
Price Change 1h: ${(tokenData.priceChange1h ?? 0).toFixed(2)}%
Price Change 24h: ${(tokenData.priceChange24h ?? 0).toFixed(2)}%
Has positive momentum: ${(tokenData.priceChange1h ?? 0) > 0 && (tokenData.priceChange24h ?? 0) > 0}

Risk Tolerance: ${riskTolerance}
Budget: ${budgetPerTrade} SOL

IMPORTANT: This is a QUICK SCAN for active trading opportunities.
- If the token has positive momentum and good fundamentals → action should be "buy"
- If you see a trading opportunity with >60% confidence → action should be "buy"
- Only use "hold" if there's NO clear trading opportunity OR confidence is below 60%
- Use "sell" only for existing positions that should be exited

Be AGGRESSIVE with BUY recommendations for tokens with:
- Positive price momentum (1h and 24h)
- Strong volume relative to liquidity
- Good fundamentals

Respond ONLY with valid JSON:
{
  "action": "buy" | "sell" | "hold",
  "confidence": 0.0 to 1.0,
  "reasoning": "brief explanation",
  "potentialUpsidePercent": number,
  "riskLevel": "low" | "medium" | "high"
}`;

  // Try providers in order: DeepSeek Primary → DeepSeek Backup → OpenAI → Cerebras → Groq
  const providers = [
    { name: "DeepSeek", baseURL: "https://api.deepseek.com", apiKey: process.env.DEEPSEEK_API_KEY, model: "deepseek-chat" },
    { name: "DeepSeek #2", baseURL: "https://api.deepseek.com", apiKey: process.env.DEEPSEEK_API_KEY_2, model: "deepseek-chat" },
    { name: "OpenAI", baseURL: "https://api.openai.com/v1", apiKey: process.env.OPENAI_API_KEY, model: "gpt-4o-mini" },
    { name: "OpenAI #2", baseURL: "https://api.openai.com/v1", apiKey: process.env.OPENAI_API_KEY_2, model: "gpt-4o-mini" },
    { name: "Cerebras", baseURL: "https://api.cerebras.ai/v1", apiKey: process.env.CEREBRAS_API_KEY, model: "llama-3.3-70b" },
    { name: "Groq", baseURL: "https://api.groq.com/openai/v1", apiKey: process.env.GROQ_API_KEY, model: "llama-3.3-70b-versatile" },
  ];

  for (const provider of providers) {
    if (!provider.apiKey) continue; // Skip if key not available

    try {
      const client = new OpenAI({
        baseURL: provider.baseURL,
        apiKey: provider.apiKey,
      });

      const response = await client.chat.completions.create({
        model: provider.model,
        messages: [{ role: "user", content: prompt }],
        temperature: 0.3,
        max_tokens: 500,
      });

      const content = response.choices[0]?.message?.content || "{}";
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      const analysis = jsonMatch ? JSON.parse(jsonMatch[0]) : {
        action: "hold",
        confidence: 0,
        reasoning: "Failed to parse response",
        potentialUpsidePercent: 0,
        riskLevel: "high",
      };

      // Cache the analysis result
      cacheAnalysis(tokenData.mint, analysis);

      console.log(`[Quick Scan] ✅ ${provider.name} analysis succeeded for ${tokenData.symbol}`);
      logActivity('quick_scan', 'ai_thought', `🧠 ${provider.name}: ${tokenData.symbol} → ${analysis.action.toUpperCase()} (${(analysis.confidence * 100).toFixed(0)}%) - ${analysis.reasoning.substring(0, 100)}...`);
      return analysis;
    } catch (error: any) {
      const is402 = error?.status === 402;
      if (is402) {
        console.warn(`[Quick Scan] ${provider.name} exhausted (402) - trying next provider...`);
      } else {
        console.warn(`[Quick Scan] ${provider.name} failed - trying next provider...`);
      }
      // Continue to next provider
    }
  }

  // All providers failed - return safe default
  console.error("[Quick Scan] ❌ All AI providers failed - returning HOLD");
  return {
    action: "hold" as const,
    confidence: 0,
    reasoning: "All AI providers unavailable",
    potentialUpsidePercent: 0,
    riskLevel: "high" as const,
  };
}

/**
 * OPPORTUNISTIC ROTATION: Find weakest position to sell for better opportunity
 * Returns the position to sell and SOL it would free up, or null if no rotation needed
 */
async function findPositionToRotate(
  ownerWalletAddress: string,
  newOpportunity: {
    symbol: string;
    confidence: number;
    potentialUpside: number;
    requiredSOL: number;
  },
  currentPositions: any[],
  availableSOL: number
): Promise<{ position: any; expectedSOL: number } | null> {
  // Don't rotate if we have enough capital
  if (availableSOL >= newOpportunity.requiredSOL) {
    return null;
  }
  
  // Don't rotate if no positions to sell
  if (currentPositions.length === 0) {
    return null;
  }
  
  console.log(`[Opportunistic Rotation] 🔄 Evaluating ${currentPositions.length} positions for rotation...`);
  console.log(`[Opportunistic Rotation] New opportunity: ${newOpportunity.symbol} (${(newOpportunity.confidence * 100).toFixed(0)}% confidence, +${newOpportunity.potentialUpside}% upside)`);
  
  // Get current prices for all positions
  const mints = currentPositions.map(p => p.tokenMint);
  const { getBatchTokenPrices } = await import("./jupiter");
  const priceMap = await getBatchTokenPrices(mints);
  
  // Filter out positions that are too new (must hold at least 5 minutes)
  const MIN_HOLD_MINUTES = 5;
  const now = Date.now();
  const eligiblePositions = currentPositions.filter(position => {
    const positionAgeMinutes = (now - new Date(position.buyTimestamp).getTime()) / (1000 * 60);
    return positionAgeMinutes >= MIN_HOLD_MINUTES;
  });
  
  if (eligiblePositions.length === 0) {
    console.log(`[Opportunistic Rotation] ❌ No eligible positions (all held < ${MIN_HOLD_MINUTES} minutes)`);
    return null;
  }
  
  // Score each eligible position for rotation (lower score = better to sell)
  const scoredPositions = eligiblePositions.map(position => {
    const entryPrice = parseFloat(position.entryPriceSOL);
    const currentPrice = priceMap.get(position.tokenMint) || 0;
    const profitPercent = entryPrice > 0 ? ((currentPrice - entryPrice) / entryPrice) * 100 : 0;
    const entryConfidence = position.aiConfidenceAtBuy || 50; // Stored as integer percentage (e.g., 75)
    const tokenDecimals = position.tokenDecimals || 6;
    const rawAmount = parseFloat(position.tokenAmount);
    const tokenAmount = rawAmount / Math.pow(10, tokenDecimals);
    const estimatedValue = tokenAmount * currentPrice;
    const positionAgeMinutes = (now - new Date(position.buyTimestamp).getTime()) / (1000 * 60);
    
    // Rotation score (lower = better to sell):
    // - Positions with small profits (0-5%): Score 10 (take profits)
    // - Positions with small losses (0 to -10%): Score 20 (cut losses)
    // - Positions with lower entry confidence: Score +confidence penalty
    // - Positions with big profits (>10%): Score 100 (let winners run)
    // - Positions with big losses (<-15%): Score 5 (definitely cut)
    
    let score = 50; // Base score
    
    if (profitPercent > 10) {
      score = 100; // Don't sell winners
    } else if (profitPercent > 5) {
      score = 60; // Small winners - prefer to hold
    } else if (profitPercent > 0) {
      score = 10; // Tiny profits - good to rotate
    } else if (profitPercent > -10) {
      score = 20; // Small losses - acceptable to cut
    } else if (profitPercent > -15) {
      score = 15; // Medium losses - should cut
    } else {
      score = 5; // Big losses - definitely cut
    }
    
    // Confidence penalty: Lower confidence at entry = easier to sell
    const confidencePenalty = Math.max(0, (70 - entryConfidence) / 2);
    score += confidencePenalty;
    
    return {
      position,
      score,
      profitPercent,
      entryConfidence,
      estimatedValue,
      currentPrice,
      positionAgeMinutes,
    };
  }).filter(sp => sp.estimatedValue > 0); // Only consider positions we can price
  
  if (scoredPositions.length === 0) {
    console.log(`[Opportunistic Rotation] ❌ No positions available for rotation`);
    return null;
  }
  
  // Sort by score (lowest = best to sell)
  scoredPositions.sort((a, b) => a.score - b.score);
  
  const weakest = scoredPositions[0];
  
  // Convert new opportunity confidence to percentage for comparison (stored as integer percentage in DB)
  const newOpportunityConfidencePercent = newOpportunity.confidence * 100;
  
  // Only rotate if new opportunity is significantly better
  const MIN_CONFIDENCE_IMPROVEMENT = 25; // CONSERVATIVE: New opportunity should be 25% more confident (raised from 15%)
  const confidenceImprovement = newOpportunityConfidencePercent - weakest.entryConfidence;
  
  // Or if we're cutting a loss to capture a good opportunity
  const isCuttingLoss = weakest.profitPercent < -5;
  const isGoodNewOpportunity = newOpportunity.confidence >= 0.70;
  
  if (confidenceImprovement < MIN_CONFIDENCE_IMPROVEMENT && !(isCuttingLoss && isGoodNewOpportunity)) {
    console.log(`[Opportunistic Rotation] ⏭️ SKIP rotation: New opportunity not significantly better`);
    console.log(`   Weakest position: ${weakest.position.tokenSymbol} (${weakest.entryConfidence}% entry, ${weakest.profitPercent.toFixed(2)}% profit)`);
    console.log(`   New opportunity: ${newOpportunity.symbol} (${newOpportunityConfidencePercent.toFixed(0)}% confidence)`);
    console.log(`   Confidence improvement: ${confidenceImprovement.toFixed(0)}% (need ${MIN_CONFIDENCE_IMPROVEMENT}%)`);
    return null;
  }
  
  // Verify we'll have enough capital after selling
  const projectedCapital = availableSOL + weakest.estimatedValue;
  if (projectedCapital < newOpportunity.requiredSOL) {
    console.log(`[Opportunistic Rotation] ⏭️ SKIP rotation: Insufficient capital even after selling`);
    console.log(`   Current: ${availableSOL.toFixed(4)} SOL`);
    console.log(`   After selling ${weakest.position.tokenSymbol}: ${projectedCapital.toFixed(4)} SOL`);
    console.log(`   Required: ${newOpportunity.requiredSOL.toFixed(4)} SOL`);
    return null;
  }
  
  console.log(`[Opportunistic Rotation] ✅ ROTATION APPROVED:`);
  console.log(`   Selling: ${weakest.position.tokenSymbol} (${weakest.entryConfidence}% entry confidence, ${weakest.profitPercent.toFixed(2)}% profit, ${weakest.positionAgeMinutes.toFixed(0)} min old)`);
  console.log(`   For: ${newOpportunity.symbol} (${newOpportunityConfidencePercent.toFixed(0)}% confidence, +${confidenceImprovement.toFixed(0)}% improvement)`);
  console.log(`   Expected SOL: ${weakest.estimatedValue.toFixed(4)} SOL → ${projectedCapital.toFixed(4)} SOL total available`);
  
  return {
    position: weakest.position,
    expectedSOL: weakest.estimatedValue,
  };
}

/**
 * Execute a quick trade from the quick scan
 */
async function executeQuickTrade(
  config: any,
  token: TokenMarketData,
  analysis: any,
  botState: AIBotState,
  existingPositions: any[]
) {
  try {
    // Get treasury key
    if (!config.treasuryKeyCiphertext || !config.treasuryKeyIv || !config.treasuryKeyAuthTag) {
      console.log(`[Quick Scan] No treasury key configured for ${config.ownerWalletAddress.slice(0, 8)}...`);
      return;
    }

    const { decrypt } = await import("./crypto");
    const treasuryKeyBase58 = decrypt(
      config.treasuryKeyCiphertext,
      config.treasuryKeyIv,
      config.treasuryKeyAuthTag
    );

    // Get treasury public key for balance check
    const { loadKeypairFromPrivateKey } = await import("./solana-sdk");
    const keypair = loadKeypairFromPrivateKey(treasuryKeyBase58);
    const treasuryPublicKey = keypair.publicKey.toString();

    // Scan actual wallet balance
    const { getWalletBalance } = await import("./solana");
    let actualBalance = await getWalletBalance(treasuryPublicKey);
    const FEE_BUFFER = 0.03; // Always keep 0.03 SOL for fees
    let availableBalance = Math.max(0, actualBalance - FEE_BUFFER);

    console.log(`[Quick Scan] Wallet balance: ${actualBalance.toFixed(4)} SOL (available: ${availableBalance.toFixed(4)} SOL after fee buffer)`);

    // If balance is low, try to claim creator rewards
    if (availableBalance < 0.05) {
      console.log(`[Quick Scan] Low balance detected, attempting to claim creator rewards...`);
      const rewardsClaimed = await tryClaimCreatorRewards(treasuryPublicKey, treasuryKeyBase58);
      if (rewardsClaimed) {
        // Re-check balance after claiming and UPDATE availableBalance
        actualBalance = await getWalletBalance(treasuryPublicKey);
        availableBalance = Math.max(0, actualBalance - FEE_BUFFER);
        console.log(`[Quick Scan] After rewards claim: ${actualBalance.toFixed(4)} SOL (available: ${availableBalance.toFixed(4)} SOL)`);
      }
    }

    // Analyze complete wallet portfolio for accurate allocation decisions
    console.log(`[Quick Scan] 📊 Analyzing wallet portfolio for allocation strategy...`);
    const portfolio = await analyzePortfolio(treasuryPublicKey, actualBalance);
    
    console.log(`[Quick Scan] 💼 Portfolio: ${portfolio.totalValueSOL.toFixed(4)} SOL total, ${portfolio.holdingCount} positions, largest ${portfolio.largestPosition.toFixed(1)}%`);

    // Calculate dynamic trade amount based on AI confidence (using refreshed balance if rewards were claimed)
    const baseAmount = parseFloat(config.budgetPerTrade || "0.02");
    const portfolioPercent = config.portfolioPercentPerTrade || 10;
    let tradeAmount = calculateDynamicTradeAmount(baseAmount, analysis.confidence, availableBalance, portfolio.totalValueSOL, portfolioPercent);

    // OPPORTUNISTIC ROTATION: If insufficient funds, try selling weaker position for better opportunity
    if (tradeAmount <= 0 || availableBalance < tradeAmount) {
      const rotationCandidate = await findPositionToRotate(
        config.ownerWalletAddress,
        {
          symbol: token.symbol,
          confidence: analysis.confidence,
          potentialUpside: analysis.potentialUpsidePercent,
          requiredSOL: tradeAmount > 0 ? tradeAmount : baseAmount,
        },
        existingPositions,
        availableBalance
      );
      
      if (rotationCandidate) {
        console.log(`[Quick Scan] 🔄 ROTATING position - selling ${rotationCandidate.position.tokenSymbol} first, then buying ${token.symbol}...`);
        
        // Sell the weaker position FIRST before buying new token
        const { sellTokenWithFallback } = await import("./jupiter");
        
        // Use token amount from database (stored in RAW UNITS)
        // This is more reliable than querying blockchain (account may not exist or be closed)
        const tokenBalanceRaw = Math.floor(parseFloat(rotationCandidate.position.tokenAmount));
        
        console.log(`[Quick Scan] 💰 Selling ${rotationCandidate.position.tokenSymbol}: ${tokenBalanceRaw} raw tokens (from DB)`);
        
        const sellResult = await sellTokenWithFallback(
          treasuryKeyBase58,
          rotationCandidate.position.tokenMint,
          tokenBalanceRaw,
          3000 // 30% slippage for fast execution
        );
        
        if (sellResult.success && sellResult.signature) {
          // Calculate SOL received (will be refreshed when we check balance)
          const balanceAfterSell = await getWalletBalance(treasuryPublicKey);
          const solReceived = balanceAfterSell - actualBalance;
          availableBalance = Math.max(0, balanceAfterSell - FEE_BUFFER);
          actualBalance = balanceAfterSell;
          
          console.log(`[Quick Scan] ✅ Sold ${rotationCandidate.position.tokenSymbol} for ~${solReceived.toFixed(4)} SOL`);
          console.log(`[Quick Scan] 💰 New available balance: ${availableBalance.toFixed(4)} SOL`);
          
          // Delete the old position
          await storage.deleteAIBotPositionByMint(config.ownerWalletAddress, rotationCandidate.position.tokenMint);
          
          // Recalculate trade amount with new balance
          tradeAmount = calculateDynamicTradeAmount(baseAmount, analysis.confidence, availableBalance, portfolio.totalValueSOL, portfolioPercent);
          
          logActivity('quick_scan', 'success', `🔄 Rotated ${rotationCandidate.position.tokenSymbol} (${rotationCandidate.position.aiConfidenceAtBuy}%) → ${token.symbol} (${(analysis.confidence * 100).toFixed(0)}%)`);
        } else {
          console.log(`[Quick Scan] ❌ Rotation sell failed:`, sellResult.error);
          console.log(`[Quick Scan] ⏭️ SKIP ${token.symbol}: Insufficient funds after failed rotation`);
          return;
        }
      } else {
        console.log(`[Quick Scan] ⏭️ SKIP ${token.symbol}: Insufficient funds and no suitable position for rotation (available: ${availableBalance.toFixed(4)} SOL, need: ${tradeAmount.toFixed(4)} SOL)`);
        return;
      }
    }
    
    // Final check after potential rotation
    if (tradeAmount <= 0 || availableBalance < tradeAmount) {
      console.log(`[Quick Scan] ⏭️ SKIP ${token.symbol}: Still insufficient funds after rotation attempts`);
      return;
    }

    // PORTFOLIO CONCENTRATION CHECK: Prevent over-allocation
    // Max 25% of portfolio in any single position for diversification
    const MAX_POSITION_PERCENT = 25;
    
    // Skip concentration check if portfolio value is negligible
    if (portfolio.totalValueSOL > 0.001) {
      // Check if this token is already in portfolio
      const existingHolding = portfolio.holdings.find(h => h.mint === token.mint);
      const currentValueSOL = existingHolding ? existingHolding.valueSOL : 0;
      
      // Calculate post-trade allocation
      // IMPORTANT: Portfolio total stays roughly constant (SOL → tokens swap)
      // Post-trade position = current token value + new tokens bought with SOL
      // Post-trade portfolio = same total (just reallocated from SOL to tokens)
      const postTradePositionValue = currentValueSOL + tradeAmount;
      const postTradePercent = (postTradePositionValue / portfolio.totalValueSOL) * 100;
      
      if (postTradePercent > MAX_POSITION_PERCENT) {
        // Calculate max allowed trade to stay at exactly 25%
        // maxTrade = targetPercent * portfolioTotal - currentValue
        const maxAllowedSOL = (MAX_POSITION_PERCENT / 100 * portfolio.totalValueSOL) - currentValueSOL;
        
        if (maxAllowedSOL <= 0.001) {
          const currentPercent = (currentValueSOL / portfolio.totalValueSOL) * 100;
          console.log(`[Quick Scan] ⏭️ SKIP ${token.symbol}: Position would exceed ${MAX_POSITION_PERCENT}% concentration limit (current: ${currentPercent.toFixed(1)}%)`);
          return;
        }
        
        // Reduce trade size to stay under limit and cap at available balance
        tradeAmount = Math.min(tradeAmount, maxAllowedSOL, availableBalance);
        
        // Recalculate actual post-trade percentage after resizing
        const actualPostTradeValue = currentValueSOL + tradeAmount;
        const actualPostTradePercent = (actualPostTradeValue / portfolio.totalValueSOL) * 100;
        
        console.log(`[Quick Scan] ⚖️ Position size reduced to ${tradeAmount.toFixed(4)} SOL to maintain diversification (will be ${actualPostTradePercent.toFixed(1)}% of portfolio)`);
      }
    }

    // Calculate final projected allocation for logging
    const existingHoldingFinal = portfolio.holdings.find(h => h.mint === token.mint);
    const currentValueSOLFinal = existingHoldingFinal ? existingHoldingFinal.valueSOL : 0;
    const finalPostTradeValue = currentValueSOLFinal + tradeAmount;
    const finalProjectedPercent = portfolio.totalValueSOL > 0.001 ? (finalPostTradeValue / portfolio.totalValueSOL) * 100 : 0;

    console.log(`[Quick Scan] Dynamic trade amount: ${tradeAmount.toFixed(4)} SOL (confidence: ${(analysis.confidence * 100).toFixed(1)}%, will be ${finalProjectedPercent.toFixed(1)}% of portfolio)`);

    // Check if we already hold this token (using pre-fetched positions)
    const existingPosition = existingPositions.find(p => p.tokenMint === token.mint);
    
    if (existingPosition) {
      const entryPrice = parseFloat(existingPosition.entryPriceSOL);
      const currentPrice = token.priceSOL;
      const priceChangePercent = ((currentPrice - entryPrice) / entryPrice) * 100;
      const previousConfidence = existingPosition.aiConfidenceAtBuy || 0;
      const newConfidence = analysis.confidence * 100; // Convert to 0-100 scale
      const currentRebuyCount = existingPosition.rebuyCount || 0;
      
      // Check if we've hit max re-buys (2)
      if (currentRebuyCount >= 2) {
        console.log(`[Quick Scan] ⏭️ SKIP ${token.symbol} - Max re-buys reached (${currentRebuyCount}/2)`);
        console.log(`[Quick Scan]    Position opened at: ${entryPrice.toFixed(8)} SOL`);
        console.log(`[Quick Scan]    Current price: ${currentPrice.toFixed(8)} SOL (${priceChangePercent > 0 ? '+' : ''}${priceChangePercent.toFixed(2)}%)`);
        return;
      }
      
      // Only buy more if ALL conditions are met:
      // 1. Price has dropped at least 10% (drawback/dip)
      // 2. New AI confidence is higher than previous
      // 3. Haven't exceeded max 2 re-buys
      const hasDrawback = priceChangePercent <= -10; // Price down 10%+
      const hasHigherConfidence = newConfidence > previousConfidence;
      
      if (!hasDrawback || !hasHigherConfidence) {
        console.log(`[Quick Scan] ⏭️ SKIP ${token.symbol} - Already holding position:`);
        console.log(`[Quick Scan]    Previous entry: ${entryPrice.toFixed(8)} SOL (confidence: ${previousConfidence}%)`);
        console.log(`[Quick Scan]    Current price: ${currentPrice.toFixed(8)} SOL (${priceChangePercent > 0 ? '+' : ''}${priceChangePercent.toFixed(2)}%)`);
        console.log(`[Quick Scan]    New confidence: ${newConfidence.toFixed(1)}%`);
        console.log(`[Quick Scan]    Re-buys: ${currentRebuyCount}/2`);
        console.log(`[Quick Scan]    Drawback requirement: ${hasDrawback ? '✅' : '❌'} (need -10% dip, have ${priceChangePercent.toFixed(2)}%)`);
        console.log(`[Quick Scan]    Higher confidence: ${hasHigherConfidence ? '✅' : '❌'} (need >${previousConfidence}%, have ${newConfidence.toFixed(1)}%)`);
        return;
      }
      
      console.log(`[Quick Scan] ✅ Adding to position ${token.symbol} (re-buy ${currentRebuyCount + 1}/2):`);
      console.log(`[Quick Scan]    Price dropped ${Math.abs(priceChangePercent).toFixed(2)}% from entry (${entryPrice.toFixed(8)} → ${currentPrice.toFixed(8)} SOL)`);
      console.log(`[Quick Scan]    Confidence increased from ${previousConfidence}% → ${newConfidence.toFixed(1)}%`);
    }

    // Execute buy with Jupiter → PumpSwap fallback
    const result = await buyTokenWithFallback(
      treasuryKeyBase58,
      token.mint,
      tradeAmount,
      1000 // 10% slippage
    );
    
    if (result.success && result.route) {
      console.log(`[Quick Scan] ✅ Bought via ${result.route.toUpperCase()}`);
    }

    if (result.success && result.signature) {
      // Calculate actual tokens received
      const tokensReceived = result.outputAmount || 0;
      
      if (tokensReceived === 0) {
        console.log(`[Quick Scan] ⚠️ Swap succeeded but received 0 tokens - skipping position creation`);
        console.log(`[Quick Scan] This can happen with rug pulls or tokens with no liquidity`);
        return;
      }
      
      console.log(`[Quick Scan] ✅ Received ${tokensReceived} tokens from swap`);
      
      // Update budget tracking
      const budgetUsed = parseFloat(config.budgetUsed || "0");
      const newBudgetUsed = budgetUsed + tradeAmount;
      await storage.createOrUpdateAIBotConfig({
        ownerWalletAddress: config.ownerWalletAddress,
        budgetUsed: newBudgetUsed.toString(),
      });

      // Record transaction with actual tokens received
      await storage.createTransaction({
        projectId: null as any, // null for standalone AI bot transactions
        type: "ai_buy",
        amount: tradeAmount.toString(),
        tokenAmount: tokensReceived.toString(),
        txSignature: result.signature,
        status: "completed",
        expectedPriceSOL: token.priceSOL.toString(),
        actualPriceSOL: token.priceSOL.toString(),
      });

      // Broadcast update
      realtimeService.broadcast({
        type: "transaction_event",
        data: {
          projectId: config.ownerWalletAddress,
          transactionType: "ai_buy",
          signature: result.signature,
          amount: tradeAmount,
          token: token.symbol,
          analysis: `Quick Scan: ${analysis.reasoning} (${(analysis.confidence * 100).toFixed(1)}%)`,
        },
        timestamp: Date.now(),
      });

      // Save or update position in database
      if (existingPosition) {
        // Re-buy: Update existing position with new totals and increment rebuyCount
        // NOTE: Re-buys DO NOT count toward daily trade limit (only new positions do)
        const oldAmount = parseFloat(existingPosition.amountSOL);
        const oldEntryPrice = parseFloat(existingPosition.entryPriceSOL);
        const newTotalAmount = oldAmount + tradeAmount;
        // Weighted average entry price
        const newAvgEntryPrice = (oldEntryPrice * oldAmount + token.priceSOL * tradeAmount) / newTotalAmount;
        
        await storage.updateAIBotPosition(existingPosition.id, {
          entryPriceSOL: newAvgEntryPrice.toString(),
          amountSOL: newTotalAmount.toString(),
          buyTxSignature: result.signature, // Latest buy tx
          lastCheckPriceSOL: token.priceSOL.toString(),
          lastCheckProfitPercent: "0",
          aiConfidenceAtBuy: Math.round(analysis.confidence * 100),
          aiPotentialAtBuy: analysis.potentialUpsidePercent.toString(),
          rebuyCount: (existingPosition.rebuyCount || 0) + 1,
        });
        console.log(`[Quick Scan] Updated position with ${existingPosition.rebuyCount + 1} re-buys (avg entry: ${newAvgEntryPrice.toFixed(8)} SOL)`);
      } else {
        // New position: Create it
        const aiConfidence = Math.round(analysis.confidence * 100);
        const isSwingTrade = aiConfidence >= 85 ? 1 : 0; // High confidence = swing trade
        
        // Fetch token decimals for accurate portfolio calculation
        const { getTokenDecimals } = await import("./jupiter");
        const tokenDecimals = await getTokenDecimals(token.mint);
        
        await storage.createAIBotPosition({
          ownerWalletAddress: config.ownerWalletAddress,
          tokenMint: token.mint,
          tokenSymbol: token.symbol,
          tokenName: token.name,
          tokenDecimals,
          entryPriceSOL: token.priceSOL.toString(),
          amountSOL: tradeAmount.toString(),
          tokenAmount: tokensReceived.toString(),
          buyTxSignature: result.signature,
          lastCheckPriceSOL: token.priceSOL.toString(),
          lastCheckProfitPercent: "0",
          aiConfidenceAtBuy: aiConfidence,
          aiPotentialAtBuy: analysis.potentialUpsidePercent.toString(),
          isSwingTrade,
        });
        
        if (isSwingTrade) {
          console.log(`[Quick Scan] 🎯 SWING TRADE: High AI confidence (${aiConfidence}%) - using swing strategy for ${token.symbol}`);
        }
        console.log(`[Quick Scan] ✅ New position opened: ${token.symbol}`);
      }

      console.log(`[Quick Scan] Trade executed: ${token.symbol} - ${tradeAmount.toFixed(4)} SOL (tx: ${result.signature.slice(0, 8)}...)`);
    } else {
      console.error(`[Quick Scan] Trade failed for ${token.symbol}:`, result.error);
    }
  } catch (error) {
    console.error(`[Quick Scan] Error executing trade:`, error);
  }
}

/**
 * DUAL-MODE TRADING SYSTEM
 * Mode A "SCALP": Quick profits with lower risk (62-74% AI confidence)
 * Mode B "SWING": High-conviction longer holds (75%+ AI confidence)
 */
type TradeMode = "SCALP" | "SWING";

interface TradeModeConfig {
  mode: TradeMode;
  minConfidence: number;
  positionSizePercent: number; // % of portfolio
  maxHoldMinutes: number;
  stopLossPercent: number;
  profitTargetPercent: number;
}

/**
 * Determine trade mode based on AI confidence level
 * CONSERVATIVE APPROACH - Strict wealth-growing strategy
 */
function determineTradeMode(confidence: number): TradeModeConfig {
  if (confidence >= 0.80) {
    // Mode B: SWING - High conviction longer-term trades (RAISED from 75% to 80%)
    return {
      mode: "SWING",
      minConfidence: 80, // CONSERVATIVE: Higher threshold for SWING trades
      positionSizePercent: confidence >= 0.90 ? 9 : confidence >= 0.85 ? 7 : 5, // REDUCED: 5-9% (was 8-12%)
      maxHoldMinutes: 1440, // 24 hours
      stopLossPercent: confidence >= 0.85 ? -40 : -25, // TIGHTER: -25% to -40% (was -30% to -50%)
      profitTargetPercent: 15, // Let AI decide exit, but 15% minimum
    };
  } else if (confidence >= 0.65) {
    // Mode A: SCALP - Quick micro-profits with tight risk control (RAISED from 58% to 65%)
    return {
      mode: "SCALP",
      minConfidence: 65, // CONSERVATIVE: Higher threshold for SCALP trades
      positionSizePercent: confidence >= 0.75 ? 6 : confidence >= 0.70 ? 4 : 3, // REDUCED: 3-6% (was 5-7%)
      maxHoldMinutes: 30, // 30 minute review threshold for faster trading
      stopLossPercent: -10, // TIGHTER: -10% (was -15%) for better capital protection
      profitTargetPercent: confidence >= 0.75 ? 8 : confidence >= 0.70 ? 6 : 4, // Quick profit targets
    };
  } else {
    // Below minimum threshold - return conservative defaults (should be filtered out)
    return {
      mode: "SCALP",
      minConfidence: 65,
      positionSizePercent: 3,
      maxHoldMinutes: 30,
      stopLossPercent: -10,
      profitTargetPercent: 4,
    };
  }
}

/**
 * DUAL-MODE POSITION SIZING (SCALP vs SWING)
 * CONSERVATIVE STRATEGY - Strict wealth-growing approach
 * 
 * SCALP Mode (65-79% confidence) - SELECTIVE QUICK TRADES:
 * - Position: 3-6% of portfolio (REDUCED for capital preservation)
 * - Quick profits: +4-8% targets
 * - Tight stop: -10% for better capital protection (TIGHTENED from -15%)
 * - Max hold: 30 minutes
 * 
 * SWING Mode (80%+ confidence) - HIGH CONVICTION ONLY:
 * - Position: 5-9% of portfolio (REDUCED from 8-12% for lower risk)
 * - Larger profits: +15%+ targets
 * - Tighter stop: -25% to -40% (TIGHTENED from -30% to -50%)
 * - Longer holds: AI-driven exits
 */
function calculateDynamicTradeAmount(
  baseAmount: number,
  confidence: number,
  availableBalance: number,
  portfolioValue: number = 0,
  portfolioPercentPerTrade: number = 15 // Legacy parameter, overridden by mode
): number {
  // Determine trade mode based on AI confidence
  const modeConfig = determineTradeMode(confidence);
  const effectivePercentPerTrade = modeConfig.positionSizePercent;
  
  // Calculate percentage-based trade size (enables compounding as portfolio grows)
  const portfolioBasedAmount = (portfolioValue * effectivePercentPerTrade) / 100;
  
  // Use the LARGER of: base amount OR portfolio-based amount (allows growth)
  let tradeSize = Math.max(baseAmount, portfolioBasedAmount);
  
  // Mode-specific caps
  const dynamicMaxPosition = Math.max(
    0.02, // Minimum 0.02 SOL
    (portfolioValue * (modeConfig.positionSizePercent + 2)) / 100 // Small buffer above target
  );
  tradeSize = Math.min(tradeSize, dynamicMaxPosition);
  
  // Ensure minimum trade size (0.01 SOL minimum for Solana network)
  tradeSize = Math.max(tradeSize, 0.01);
  
  // Cap at available balance (can't trade more than we have)
  return Math.min(tradeSize, availableBalance);
}

/**
 * Try to claim PumpFun creator rewards to top up funds
 */
async function tryClaimCreatorRewards(
  treasuryPublicKey: string,
  treasuryPrivateKey: string
): Promise<boolean> {
  try {
    const { claimCreatorRewardsFull } = await import("./pumpfun");
    
    const result = await claimCreatorRewardsFull(
      treasuryPublicKey,
      treasuryPrivateKey
    );

    if (result.success && result.signature) {
      console.log(`[Creator Rewards] ✅ Claimed rewards: ${result.signature.slice(0, 8)}... (amount: ${result.amount || 'unknown'} SOL)`);
      return true;
    } else {
      console.log(`[Creator Rewards] No rewards available to claim`);
      return false;
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message.toLowerCase() : "";
    if (errorMsg.includes("no rewards") || errorMsg.includes("no fees") || errorMsg.includes("nothing to claim")) {
      console.log(`[Creator Rewards] No rewards available`);
    } else {
      console.error(`[Creator Rewards] Error claiming rewards:`, error);
    }
    return false;
  }
}

/**
 * Run standalone AI trading bots (deep scan with AI)
 * Legacy project-based system removed - now uses standalone AI bot architecture
 */
async function runAITradingBots() {
  console.log("[Deep Scan] Starting full AI analysis...");
  await runStandaloneAIBots();
  console.log("[Deep Scan] Complete");
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
  if (process.env.DEEPSEEK_API_KEY_2) activeProviders.push("DeepSeek #2");
  if (process.env.CHATANYWHERE_API_KEY) activeProviders.push("ChatAnywhere");
  if (process.env.TOGETHER_API_KEY) activeProviders.push("Together AI");
  if (process.env.OPENROUTER_API_KEY) activeProviders.push("OpenRouter");
  if (process.env.GROQ_API_KEY) activeProviders.push("Groq");
  if (process.env.OPENAI_API_KEY) activeProviders.push("OpenAI");
  if (process.env.OPENAI_API_KEY_2) activeProviders.push("OpenAI #2");
  if (process.env.XAI_API_KEY) activeProviders.push("xAI Grok");

  console.log("[AI Bot Scheduler] Starting...");
  console.log(`[AI Bot Scheduler] Active AI providers (${activeProviders.length}): ${activeProviders.join(", ")}`);

  // Quick scans every 2 minutes (dual-mode: scalp + swing opportunities) - OPTIMIZED FOR SPEED
  quickScanJob = cron.schedule("*/2 * * * *", () => {
    runQuickTechnicalScan().catch((error) => {
      console.error("[Quick Scan] Unexpected error:", error);
    });
  });

  // Deep scans every 15 minutes (full AI analysis with all 7 models)
  deepScanJob = cron.schedule("*/15 * * * *", () => {
    runAITradingBots().catch((error) => {
      console.error("[Deep Scan] Unexpected error:", error);
    });
  });

  // Memory cleanup every hour (remove stale bot states and expired cache)
  memoryCleanupJob = cron.schedule("0 * * * *", () => {
    cleanupMemory();
  });

  // Run initial cleanup on startup
  cleanupMemory();
  
  // Sync all portfolios on startup (removes orphaned positions)
  console.log("[AI Bot Scheduler] Syncing portfolios on startup...");
  (async () => {
    try {
      const configs = await storage.getAllAIBotConfigs();
      // Sync all configs (enabled or disabled) to ensure accurate position tracking
      
      for (const config of configs) {
        const treasuryKey = await getTreasuryKey(config.ownerWalletAddress);
        if (treasuryKey) {
          await syncPortfolioOnStartup(config.ownerWalletAddress, treasuryKey);
        }
      }
    } catch (error) {
      console.error("[AI Bot Scheduler] Error syncing portfolios:", error);
    }
  })();
  
  // Run initial quick scan immediately on startup (don't wait for cron)
  console.log("[AI Bot Scheduler] Running initial quick scan...");
  runQuickTechnicalScan().catch((error) => {
    console.error("[Quick Scan] Initial scan error:", error);
  });

  console.log("[AI Bot Scheduler] Active - OPTIMIZED FOR FAST TRADING ⚡");
  console.log("  - Quick scans: Every 2 minutes (58-74% scalp opportunities for quick profits) 🎯 ULTRA FAST");
  console.log("  - Position monitoring: Every 1.5 minutes (rapid exit detection) ⚡");
  console.log("  - Deep scans: Every 15 minutes (75%+ swing trades with 7-model consensus)");
  console.log("  - Strategy updates: Every 3 hours (adaptive hivemind rebalancing)");
  console.log("  - Memory cleanup: Every hour (removes inactive bots and expired cache)");
}

/**
 * LEGACY: triggerAIBotManually removed (project-based system deprecated)
 * Use standalone AI bot system instead via /api/ai-bot/* routes
 */

interface ScanLog {
  timestamp: number;
  message: string;
  type: "info" | "success" | "warning" | "error";
  tokenData?: any;
}

/**
 * Portfolio holding information
 */
interface PortfolioHolding {
  mint: string;
  symbol: string;
  amount: number;
  valueSOL: number;
  percentOfPortfolio: number;
}

/**
 * Complete portfolio analysis
 */
interface PortfolioAnalysis {
  totalValueSOL: number;
  solBalance: number;
  holdings: PortfolioHolding[];
  largestPosition: number; // Percent of portfolio
  holdingCount: number;
  diversificationScore: number; // 0-100, higher = more diversified
}

/**
 * Analyze complete wallet portfolio for accurate allocation decisions
 * Fetches all SPL token holdings and calculates concentration metrics
 */
async function analyzePortfolio(walletAddress: string, solBalance: number): Promise<PortfolioAnalysis> {
  try {
    // Fetch token balances from database (more reliable than Jupiter API which returns 404)
    const dbPositions = await storage.getAIBotPositions(walletAddress);
    
    // Parse holdings and calculate values
    const holdings: PortfolioHolding[] = [];
    let totalTokenValueSOL = 0;
    
    if (dbPositions && dbPositions.length > 0) {
      // Collect all token mints for batch price fetching
      const tokenMints = dbPositions.map(p => p.tokenMint);
      
      // Fetch ALL prices in a single batch API call (avoids rate limiting!)
      const { getBatchTokenPrices } = await import("./jupiter");
      const priceMap = await getBatchTokenPrices(tokenMints);
      
      // Build holdings array with prices from batch response
      // Note: Token amounts in DB are stored in RAW UNITS (need to divide by decimals)
      for (const position of dbPositions) {
        const priceSOL = priceMap.get(position.tokenMint);
        const rawAmount = parseFloat(position.tokenAmount);
        const decimals = position.tokenDecimals || 6; // Use stored decimals, fallback to 6 for old positions
        
        if (priceSOL && priceSOL > 0 && rawAmount > 0) {
          // Convert raw amount to decimal amount using token-specific decimals
          const amount = rawAmount / Math.pow(10, decimals);
          const valueSOL = amount * priceSOL;
          totalTokenValueSOL += valueSOL;
          
          holdings.push({
            mint: position.tokenMint,
            symbol: position.tokenSymbol || "UNKNOWN",
            amount: amount,
            valueSOL,
            percentOfPortfolio: 0, // Will calculate after we know total
          });
        } else if (rawAmount > 0 && !priceSOL) {
          // Log warning if we can't price a position (but don't fail)
          console.log(`[Portfolio] Warning: Could not price ${position.tokenSymbol || position.tokenMint.slice(0,8)} (no price data)`);
        }
      }
    }
    
    
    // Calculate total portfolio value (SOL + all tokens)
    const totalValueSOL = solBalance + totalTokenValueSOL;
    
    // Calculate percentage allocation for each holding
    holdings.forEach(holding => {
      holding.percentOfPortfolio = (holding.valueSOL / totalValueSOL) * 100;
    });
    
    // Sort by value (largest first)
    holdings.sort((a, b) => b.valueSOL - a.valueSOL);
    
    // Calculate concentration metrics
    const largestPosition = holdings.length > 0 ? holdings[0].percentOfPortfolio : 0;
    
    // Diversification score: 100 = perfect diversification, 0 = all in one token
    // Using Herfindahl-Hirschman Index (HHI) inverted
    const hhi = holdings.reduce((sum, h) => sum + Math.pow(h.percentOfPortfolio, 2), 0);
    const diversificationScore = holdings.length > 1 ? Math.max(0, 100 - hhi / 10) : 0;
    
    return {
      totalValueSOL,
      solBalance,
      holdings,
      largestPosition,
      holdingCount: holdings.length,
      diversificationScore,
    };
  } catch (error) {
    // Silent fallback - just log summary, not full error
    console.log(`[Portfolio] Using SOL-only fallback (${solBalance.toFixed(4)} SOL)`);
    // Return basic portfolio with just SOL if analysis fails
    return {
      totalValueSOL: solBalance,
      solBalance,
      holdings: [],
      largestPosition: 0,
      holdingCount: 0,
      diversificationScore: 0,
    };
  }
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

    // Check AI bot whitelist (RESTRICTED FEATURE)
    const { AI_BOT_WHITELISTED_WALLETS } = await import("@shared/config");
    const isWhitelisted = AI_BOT_WHITELISTED_WALLETS.includes(ownerWalletAddress);
    
    if (!isWhitelisted) {
      addLog(`[Standalone AI Bot] Access denied - wallet ${ownerWalletAddress} is not whitelisted for AI Trading Bot feature`, "error");
      return logs;
    }

    // Get AI bot config
    const config = await storage.getAIBotConfig(ownerWalletAddress);
    if (!config) {
      throw new Error("AI bot config not found");
    }

    // Check if AI bot is enabled - TRIGGER SYSTEM SHUTDOWN IF DISABLED
    if (!config.enabled) {
      addLog(`[Standalone AI Bot] 🛑 AI Bot disabled for wallet ${ownerWalletAddress}`, "warning");
      addLog(`[Standalone AI Bot] Triggering system shutdown...`, "error");
      
      // Trigger shutdown after returning logs
      setTimeout(() => {
        triggerSystemShutdown("AI Trading Bot disabled by user").catch((error) => {
          console.error("[Shutdown] Error during shutdown:", error);
          process.exit(1);
        });
      }, 1000); // Give 1 second for logs to be delivered
      
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
        lastActivityTimestamp: Date.now(),
        activePositions: new Map(),
      };
      aiBotStates.set(ownerWalletAddress, botState);
    } else {
      // Update last activity timestamp
      botState.lastActivityTimestamp = Date.now();
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

    // Scan actual wallet balance
    const FEE_BUFFER = 0.03; // Always keep 0.03 SOL for fees
    let actualBalance = await getWalletBalance(treasuryKeypair.publicKey.toString());
    let availableBalance = Math.max(0, actualBalance - FEE_BUFFER);

    addLog(`💰 Wallet balance: ${actualBalance.toFixed(4)} SOL (available: ${availableBalance.toFixed(4)} SOL after fee buffer)`, "info");

    // If balance is low, try to claim creator rewards
    if (availableBalance < 0.05) {
      addLog(`💰 Low balance detected (${availableBalance.toFixed(4)} SOL), attempting to claim creator rewards...`, "info");
      const rewardsClaimed = await tryClaimCreatorRewards(treasuryKeypair.publicKey.toString(), treasuryKeyBase58);
      if (rewardsClaimed) {
        // Re-check balance after claiming and UPDATE availableBalance for trade sizing
        actualBalance = await getWalletBalance(treasuryKeypair.publicKey.toString());
        availableBalance = Math.max(0, actualBalance - FEE_BUFFER);
        addLog(`💰 ✅ Rewards claimed! New balance: ${actualBalance.toFixed(4)} SOL (available: ${availableBalance.toFixed(4)} SOL)`, "success");
      } else {
        addLog(`💰 No rewards available to claim or claim failed`, "warning");
      }
    }

    if (availableBalance <= 0) {
      addLog(`💰 Insufficient funds: ${actualBalance.toFixed(4)} SOL (need at least ${FEE_BUFFER} SOL for fees)`, "error");
      return logs;
    }

    // Get active hivemind strategy FIRST (REQUIRED - hivemind controls 100%)
    const { getLatestStrategy } = await import("./hivemind-strategy");
    const activeStrategy = await getLatestStrategy(ownerWalletAddress);
    
    if (!activeStrategy) {
      addLog(`❌ No hivemind strategy available yet. Strategy will be generated on next deep scan cycle.`, "error");
      return logs;
    }
    
    // Hivemind controls ALL parameters
    const minConfidenceThreshold = activeStrategy.minConfidenceThreshold;
    const minPotentialPercent = activeStrategy.minPotentialPercent;
    const budgetPerTrade = activeStrategy.budgetPerTrade; // Hivemind-controlled trade size
    const minVolumeUSD = activeStrategy.minVolumeUSD;
    const minLiquidityUSD = activeStrategy.minLiquidityUSD;
    const minOrganicScore = activeStrategy.minOrganicScore;
    const minQualityScore = activeStrategy.minQualityScore;
    const minTransactions24h = activeStrategy.minTransactions24h;
    const riskLevel = activeStrategy.riskLevel;
    
    // AUTONOMOUS CAPITAL MANAGEMENT (No budget restrictions - use all available capital)
    const FEE_RESERVE = 0.01; // Always keep 0.01 SOL for transaction fees
    const totalBudget = parseFloat(config.totalBudget || "0");
    const budgetUsed = parseFloat(config.budgetUsed || "0"); // SOL currently in positions
    const walletBalance = await getWalletBalance(treasuryKeypair.publicKey.toString());
    
    // Calculate available capital: wallet - fee reserve - active positions
    const availableCapital = Math.max(0, walletBalance - FEE_RESERVE - budgetUsed);
    const totalPortfolioValue = walletBalance; // Total SOL in wallet (liquid + positions)
    
    addLog(`💰 Portfolio Value: ${totalPortfolioValue.toFixed(4)} SOL | In Positions: ${budgetUsed.toFixed(4)} SOL | Available: ${availableCapital.toFixed(4)} SOL`, "success");
    addLog(`   Fee Reserve: ${FEE_RESERVE} SOL | No budget limits - system self-manages for max profit`, "info");
    
    addLog(`🧠 Hivemind Strategy Active: ${activeStrategy.marketSentiment} market, ${riskLevel} risk`, "success");
    addLog(`   Confidence: ${minConfidenceThreshold}%, Upside: ${minPotentialPercent}%, Trade: ${budgetPerTrade.toFixed(3)} SOL`, "info");
    addLog(`   Volume: $${minVolumeUSD.toLocaleString()}, Liquidity: $${minLiquidityUSD.toLocaleString()}`, "info");
    
    // Map risk level to tolerance
    const riskTolerance = riskLevel === "aggressive" ? "high" : riskLevel === "conservative" ? "low" : "medium";

    // Analyze complete wallet portfolio for accurate allocation decisions
    addLog(`📊 Analyzing wallet portfolio for allocation strategy...`, "info");
    const portfolio = await analyzePortfolio(ownerWalletAddress, actualBalance);
    
    addLog(`💼 Portfolio Analysis:`, "success");
    addLog(`   Total Value: ${portfolio.totalValueSOL.toFixed(4)} SOL`, "info");
    addLog(`   SOL Balance: ${portfolio.solBalance.toFixed(4)} SOL (${((portfolio.solBalance / portfolio.totalValueSOL) * 100).toFixed(1)}%)`, "info");
    addLog(`   Token Holdings: ${portfolio.holdingCount} positions`, "info");
    addLog(`   Largest Position: ${portfolio.largestPosition.toFixed(1)}% of portfolio`, "info");
    addLog(`   Diversification Score: ${portfolio.diversificationScore.toFixed(0)}/100`, "info");
    
    // STRICT DRAWDOWN PROTECTION: Pause trading if portfolio drops >20% from peak
    const portfolioPeak = parseFloat(config.portfolioPeakSOL || portfolio.totalValueSOL.toString());
    const currentPortfolioValue = portfolio.totalValueSOL;
    
    // Update peak if current value is higher
    if (currentPortfolioValue > portfolioPeak) {
      await storage.createOrUpdateAIBotConfig({
        ownerWalletAddress,
        portfolioPeakSOL: currentPortfolioValue.toString(),
      });
      addLog(`📈 New portfolio peak: ${currentPortfolioValue.toFixed(4)} SOL`, "success");
    }
    
    // Calculate drawdown from peak
    const drawdownPercent = ((currentPortfolioValue - portfolioPeak) / portfolioPeak) * 100;
    const MAX_DRAWDOWN_PERCENT = -20; // Pause trading if portfolio drops >20%
    
    // Drawdown protection flag
    let skipNewTrades = false;
    
    if (drawdownPercent <= MAX_DRAWDOWN_PERCENT) {
      skipNewTrades = true;
      addLog(`🛑 DRAWDOWN PROTECTION ACTIVATED: Portfolio down ${Math.abs(drawdownPercent).toFixed(1)}% from peak (${portfolioPeak.toFixed(4)} SOL → ${currentPortfolioValue.toFixed(4)} SOL)`, "warning");
      addLog(`   Trading PAUSED to prevent further capital erosion. Positions will be monitored but no new trades executed.`, "warning");
      addLog(`   Resume trading when portfolio recovers above ${(portfolioPeak * 0.85).toFixed(4)} SOL (15% from peak)`, "info");
    } else if (drawdownPercent < -10) {
      // Warning zone (10-20% drawdown)
      addLog(`⚠️ Portfolio drawdown: ${Math.abs(drawdownPercent).toFixed(1)}% from peak - Approaching pause threshold (${MAX_DRAWDOWN_PERCENT}%)`, "warning");
    }
    
    if (portfolio.holdings.length > 0) {
      addLog(`   Top Holdings:`, "info");
      portfolio.holdings.slice(0, 5).forEach((holding, idx) => {
        addLog(`     ${idx + 1}. ${holding.symbol}: ${holding.valueSOL.toFixed(4)} SOL (${holding.percentOfPortfolio.toFixed(1)}%)`, "info");
      });
    }

    // Fetch all existing positions once (optimization: avoid repeated database queries)
    const allExistingPositions = await storage.getAIBotPositions(ownerWalletAddress);
    addLog(`📊 Currently holding ${allExistingPositions.length} active positions`, "info");

    // Fetch trending tokens with hivemind-controlled filters
    addLog(`🔍 Fetching trending tokens (hivemind filters)...`, "info");
    const trendingTokens = await getCachedOrFetchTokens({
      minOrganicScore,
      minQualityScore,
      minLiquidityUSD,
      minTransactions24h,
    });
    
    // Filter by hivemind volume threshold
    const filteredTokens = trendingTokens.filter((t) => t.volumeUSD24h >= minVolumeUSD);

    if (filteredTokens.length === 0) {
      addLog(`❌ No tokens meet volume criteria (minimum $${minVolumeUSD.toLocaleString()})`, "warning");
      return logs;
    }

    addLog(`🔍 Analyzing ${filteredTokens.length} tokens with AI (Groq Llama 3.3-70B)...`, "info");
    
    for (let i = 0; i < filteredTokens.length; i++) {
      const token = filteredTokens[i];

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

      // Use Hive Mind for multi-model consensus with smart OpenAI usage
      const hiveMindResult = await analyzeTokenWithHiveMind(
        token, 
        riskTolerance, 
        budgetPerTrade, 
        0.6,
        { isPeakHours: true, isHighConfidence: true } // Deep scans use OpenAI strategically
      );
      const analysis = hiveMindResult.analysis;

      addLog(`🧠 Hive Mind: ${hiveMindResult.consensus}`, "info", { symbol: token.symbol });
      hiveMindResult.votes.forEach(vote => {
        const action = vote.analysis?.action ? vote.analysis.action.toUpperCase() : 'HOLD';
        const confidence = vote.analysis?.confidence ? (vote.analysis.confidence * 100).toFixed(0) : '0';
        addLog(`  ${vote.success ? '✅' : '❌'} ${vote.provider}: ${action} (${confidence}%)`, 
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

      // Check hivemind minimum potential threshold
      if (analysis.potentialUpsidePercent < minPotentialPercent) {
        addLog(`⏭️ SKIP ${token.symbol}: Potential ${analysis.potentialUpsidePercent.toFixed(1)}% below hivemind threshold ${minPotentialPercent}%`, "warning");
        continue;
      }

      // Check hivemind confidence threshold
      const minConfidence = minConfidenceThreshold / 100; // Convert to 0-1 scale
      if (analysis.confidence < minConfidence) {
        addLog(`⏭️ SKIP ${token.symbol}: Confidence ${(analysis.confidence * 100).toFixed(1)}% below hivemind threshold ${minConfidenceThreshold}%`, "warning");
        continue;
      }

      // DRAWDOWN PROTECTION: Skip new trades if portfolio dropped >20% from peak
      if (skipNewTrades) {
        addLog(`🛑 SKIP ${token.symbol}: Drawdown protection active - no new trades until recovery`, "warning");
        continue;
      }
      
      // Execute trade based on AI recommendation
      if (analysis.action === "buy") {
        // Calculate dynamic trade amount based on hivemind budget and AI confidence
        const portfolioPercent = config.portfolioPercentPerTrade || 10;
        let tradeAmount = calculateDynamicTradeAmount(budgetPerTrade, analysis.confidence, availableBalance, portfolio.totalValueSOL, portfolioPercent);
        
        // OPPORTUNISTIC ROTATION: If insufficient funds, try selling weaker position for better opportunity
        if (tradeAmount <= 0 || availableBalance < tradeAmount) {
          const currentPositions = await storage.getAIBotPositions(ownerWalletAddress);
          const rotationCandidate = await findPositionToRotate(
            ownerWalletAddress,
            {
              symbol: token.symbol,
              confidence: analysis.confidence,
              potentialUpside: analysis.potentialUpsidePercent,
              requiredSOL: tradeAmount > 0 ? tradeAmount : budgetPerTrade,
            },
            currentPositions,
            availableBalance
          );
          
          if (rotationCandidate) {
            addLog(`🔄 ROTATING position - selling ${rotationCandidate.position.tokenSymbol} first, then buying ${token.symbol}...`, "info");
            
            // Sell the weaker position FIRST before buying new token
            const { sellTokenWithFallback } = await import("./jupiter");
            const { loadKeypairFromPrivateKey } = await import("./solana-sdk");
            
            // Use token amount from database (stored in RAW UNITS)
            // This is more reliable than querying blockchain (account may not exist or be closed)
            const tokenBalanceRaw = Math.floor(parseFloat(rotationCandidate.position.tokenAmount));
            const treasuryKeypair = loadKeypairFromPrivateKey(treasuryKeyBase58);
            
            addLog(`💰 Selling ${rotationCandidate.position.tokenSymbol}: ${tokenBalanceRaw} raw tokens (from DB)`, "info");
            
            const sellResult = await sellTokenWithFallback(
              treasuryKeyBase58,
              rotationCandidate.position.tokenMint,
              tokenBalanceRaw,
              3000 // 30% slippage for fast execution
            );
            
            if (sellResult.success && sellResult.signature) {
              // Calculate SOL received (refresh balance)
              const balanceAfterSell = await getWalletBalance(treasuryKeypair.publicKey.toString());
              const solReceived = balanceAfterSell - actualBalance;
              availableBalance = Math.max(0, balanceAfterSell - FEE_BUFFER);
              actualBalance = balanceAfterSell;
              
              addLog(`✅ Sold ${rotationCandidate.position.tokenSymbol} for ~${solReceived.toFixed(4)} SOL (${rotationCandidate.position.tokenSymbol} → ${token.symbol})`, "success");
              
              // Delete the old position
              await storage.deleteAIBotPositionByMint(ownerWalletAddress, rotationCandidate.position.tokenMint);
              
              // Recalculate trade amount with new balance
              tradeAmount = calculateDynamicTradeAmount(budgetPerTrade, analysis.confidence, availableBalance, portfolio.totalValueSOL, portfolioPercent);
              
              logActivity('deep_scan', 'success', `🔄 Deep Scan: Rotated ${rotationCandidate.position.tokenSymbol} → ${token.symbol}`);
            } else {
              addLog(`❌ Rotation sell failed: ${sellResult.error}`, "error");
              addLog(`⏭️ SKIP ${token.symbol}: Insufficient funds after failed rotation`, "warning");
              continue;
            }
          } else {
            addLog(`⏭️ SKIP ${token.symbol}: Insufficient funds and no suitable position for rotation (available: ${availableBalance.toFixed(4)} SOL)`, "warning");
            continue;
          }
        }
        
        // Final check after potential rotation
        if (tradeAmount <= 0 || availableBalance < tradeAmount) {
          addLog(`⏭️ SKIP ${token.symbol}: Still insufficient funds after rotation attempts`, "warning");
          continue;
        }

        // PORTFOLIO CONCENTRATION CHECK: Prevent over-allocation
        // Max 25% of portfolio in any single position for diversification
        const MAX_POSITION_PERCENT = 25;
        
        // Skip concentration check if portfolio value is negligible
        if (portfolio.totalValueSOL > 0.001) {
          // Check if this token is already in portfolio
          const existingHolding = portfolio.holdings.find(h => h.mint === token.mint);
          const currentValueSOL = existingHolding ? existingHolding.valueSOL : 0;
          
          // Calculate post-trade allocation
          // IMPORTANT: Portfolio total stays roughly constant (SOL → tokens swap)
          // Post-trade position = current token value + new tokens bought with SOL
          // Post-trade portfolio = same total (just reallocated from SOL to tokens)
          const postTradePositionValue = currentValueSOL + tradeAmount;
          const postTradePercent = (postTradePositionValue / portfolio.totalValueSOL) * 100;
          
          if (postTradePercent > MAX_POSITION_PERCENT) {
            // Calculate max allowed trade to stay at exactly 25%
            // maxTrade = targetPercent * portfolioTotal - currentValue
            const maxAllowedSOL = (MAX_POSITION_PERCENT / 100 * portfolio.totalValueSOL) - currentValueSOL;
            
            if (maxAllowedSOL <= 0.001) {
              const currentPercent = (currentValueSOL / portfolio.totalValueSOL) * 100;
              addLog(`⏭️ SKIP ${token.symbol}: Position would exceed ${MAX_POSITION_PERCENT}% concentration limit (current: ${currentPercent.toFixed(1)}%)`, "warning");
              continue;
            }
            
            // Reduce trade size to stay under limit and cap at available balance
            tradeAmount = Math.min(tradeAmount, maxAllowedSOL, availableBalance);
            
            // Recalculate actual post-trade percentage after resizing
            const actualPostTradeValue = currentValueSOL + tradeAmount;
            const actualPostTradePercent = (actualPostTradeValue / portfolio.totalValueSOL) * 100;
            
            addLog(`⚖️ Position size reduced to ${tradeAmount.toFixed(4)} SOL to maintain diversification (will be ${actualPostTradePercent.toFixed(1)}% of portfolio)`, "warning");
          }
        }

        // Calculate final projected allocation for logging
        const existingHolding = portfolio.holdings.find(h => h.mint === token.mint);
        const currentValueSOL = existingHolding ? existingHolding.valueSOL : 0;
        const finalPostTradeValue = currentValueSOL + tradeAmount;
        const finalProjectedPercent = portfolio.totalValueSOL > 0.001 ? (finalPostTradeValue / portfolio.totalValueSOL) * 100 : 0;

        addLog(`🚀 BUY SIGNAL: ${token.symbol} - ${tradeAmount.toFixed(4)} SOL (confidence: ${(analysis.confidence * 100).toFixed(1)}%, will be ${finalProjectedPercent.toFixed(1)}% of portfolio)`, "success", {
          symbol: token.symbol,
          amount: tradeAmount,
          confidence: analysis.confidence,
          reasoning: analysis.reasoning,
          portfolioAllocation: `${finalProjectedPercent.toFixed(1)}% of portfolio`,
        });

        // Check if we already hold this token (using pre-fetched positions)
        const existingPosition = allExistingPositions.find(p => p.tokenMint === token.mint);
        
        if (existingPosition) {
          const entryPrice = parseFloat(existingPosition.entryPriceSOL);
          const currentPrice = token.priceSOL;
          const priceChangePercent = ((currentPrice - entryPrice) / entryPrice) * 100;
          const previousConfidence = existingPosition.aiConfidenceAtBuy || 0;
          const newConfidence = analysis.confidence * 100; // Convert to 0-100 scale
          const currentRebuyCount = existingPosition.rebuyCount || 0;
          
          // Check if we've hit max re-buys (2)
          if (currentRebuyCount >= 2) {
            addLog(`⏭️ SKIP ${token.symbol} - Max re-buys reached (${currentRebuyCount}/2)`, "warning");
            addLog(`   Position opened at: ${entryPrice.toFixed(8)} SOL`, "info");
            addLog(`   Current price: ${currentPrice.toFixed(8)} SOL (${priceChangePercent > 0 ? '+' : ''}${priceChangePercent.toFixed(2)}%)`, "info");
            continue;
          }
          
          // Only buy more if ALL conditions are met:
          // 1. Price has dropped at least 10% (drawback/dip)
          // 2. New AI confidence is higher than previous
          // 3. Haven't exceeded max 2 re-buys
          const hasDrawback = priceChangePercent <= -10; // Price down 10%+
          const hasHigherConfidence = newConfidence > previousConfidence;
          
          if (!hasDrawback || !hasHigherConfidence) {
            addLog(`⏭️ SKIP ${token.symbol} - Already holding position:`, "warning");
            addLog(`   Previous entry: ${entryPrice.toFixed(8)} SOL (confidence: ${previousConfidence}%)`, "info");
            addLog(`   Current price: ${currentPrice.toFixed(8)} SOL (${priceChangePercent > 0 ? '+' : ''}${priceChangePercent.toFixed(2)}%)`, "info");
            addLog(`   New confidence: ${newConfidence.toFixed(1)}%`, "info");
            addLog(`   Re-buys: ${currentRebuyCount}/2`, "info");
            addLog(`   Drawback requirement: ${hasDrawback ? '✅' : '❌'} (need -10% dip, have ${priceChangePercent.toFixed(2)}%)`, "info");
            addLog(`   Higher confidence: ${hasHigherConfidence ? '✅' : '❌'} (need >${previousConfidence}%, have ${newConfidence.toFixed(1)}%)`, "info");
            continue;
          }
          
          addLog(`✅ Adding to position ${token.symbol} (re-buy ${currentRebuyCount + 1}/2):`, "success");
          addLog(`   Price dropped ${Math.abs(priceChangePercent).toFixed(2)}% from entry (${entryPrice.toFixed(8)} → ${currentPrice.toFixed(8)} SOL)`, "info");
          addLog(`   Confidence increased from ${previousConfidence}% → ${newConfidence.toFixed(1)}%`, "info");
        }

        // Buy with Jupiter → PumpSwap fallback for better success rate
        const result = await buyTokenWithFallback(
          treasuryKeyBase58,
          token.mint,
          tradeAmount,
          1000 // 10% slippage (1000 bps)
        );
        
        if (result.success && result.route) {
          addLog(`✅ Bought via ${result.route.toUpperCase()}`, "success");
        }

        if (result.success && result.signature) {
          // Calculate actual tokens received
          const tokensReceived = result.outputAmount || 0;
          
          if (tokensReceived === 0) {
            addLog(`⚠️ Swap succeeded but received 0 tokens - skipping position creation`, "warning");
            addLog(`This can happen with rug pulls or tokens with no liquidity`, "info");
            continue;
          }
          
          addLog(`✅ Received ${tokensReceived} tokens from swap`, "success");
          
          // Update budget tracking and available balance
          const newBudgetUsed = budgetUsed + tradeAmount;
          availableBalance -= tradeAmount;
          await storage.createOrUpdateAIBotConfig({
            ownerWalletAddress,
            budgetUsed: newBudgetUsed.toString(),
          });
          addLog(`💰 Budget updated: ${newBudgetUsed.toFixed(4)}/${totalBudget.toFixed(4)} SOL used (${availableBalance.toFixed(4)} SOL remaining)`, "info");

          // Record transaction with actual tokens received
          await storage.createTransaction({
            projectId: null as any, // null for standalone AI bot transactions
            type: "ai_buy",
            amount: tradeAmount.toString(),
            tokenAmount: tokensReceived.toString(),
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
              amount: tradeAmount,
              token: token.symbol,
              analysis: analysis.reasoning,
            },
            timestamp: Date.now(),
          });

          // Track position (both in-memory and database)
          botState.activePositions.set(token.mint, {
            mint: token.mint,
            entryPriceSOL: token.priceSOL,
            amountSOL: tradeAmount,
          });

          // Save or update position in database
          if (existingPosition) {
            // Re-buy: Update existing position with new totals and increment rebuyCount
            // NOTE: Re-buys DO NOT count toward daily trade limit (only new positions do)
            const oldAmount = parseFloat(existingPosition.amountSOL);
            const oldEntryPrice = parseFloat(existingPosition.entryPriceSOL);
            const newTotalAmount = oldAmount + tradeAmount;
            // Weighted average entry price
            const newAvgEntryPrice = (oldEntryPrice * oldAmount + token.priceSOL * tradeAmount) / newTotalAmount;
            
            await storage.updateAIBotPosition(existingPosition.id, {
              entryPriceSOL: newAvgEntryPrice.toString(),
              amountSOL: newTotalAmount.toString(),
              buyTxSignature: result.signature, // Latest buy tx
              lastCheckPriceSOL: token.priceSOL.toString(),
              lastCheckProfitPercent: "0",
              aiConfidenceAtBuy: Math.round(analysis.confidence * 100),
              aiPotentialAtBuy: analysis.potentialUpsidePercent.toString(),
              rebuyCount: (existingPosition.rebuyCount || 0) + 1,
            });
            addLog(`   Updated position with ${existingPosition.rebuyCount + 1} re-buys (avg entry: ${newAvgEntryPrice.toFixed(8)} SOL)`, "info");
            addLog(`✅ Position re-buy executed! ${token.symbol} added to position`, "success", {
              symbol: token.symbol,
              txSignature: result.signature,
              amount: tradeAmount,
            });
          } else {
            // New position: Create it
            const aiConfidence = Math.round(analysis.confidence * 100);
            const isSwingTrade = aiConfidence >= 85 ? 1 : 0; // High confidence = swing trade
            
            // Fetch token decimals for accurate portfolio calculation
            const { getTokenDecimals } = await import("./jupiter");
            const tokenDecimals = await getTokenDecimals(token.mint);
            
            await storage.createAIBotPosition({
              ownerWalletAddress,
              tokenMint: token.mint,
              tokenSymbol: token.symbol,
              tokenName: token.name,
              tokenDecimals,
              entryPriceSOL: token.priceSOL.toString(),
              amountSOL: tradeAmount.toString(),
              tokenAmount: tokensReceived.toString(),
              buyTxSignature: result.signature,
              lastCheckPriceSOL: token.priceSOL.toString(),
              lastCheckProfitPercent: "0",
              aiConfidenceAtBuy: aiConfidence,
              aiPotentialAtBuy: analysis.potentialUpsidePercent.toString(),
              isSwingTrade,
            });
            
            if (isSwingTrade) {
              addLog(`🎯 SWING TRADE: High AI confidence (${aiConfidence}%) - holding for bigger gains`, "success");
            }
            
            addLog(`✅ New position opened! ${token.symbol}`, "success", {
              symbol: token.symbol,
              txSignature: result.signature,
              amount: tradeAmount,
            });
          }
        } else {
          addLog(`❌ Trade failed: ${result.error}`, "error");
        }
      }
    }

    // Check active positions for AI-driven profit-taking with STRICT DRAWDOWN PROTECTION
    const minAiSellConfidence = config.minAiSellConfidence || 50; // INCREASED: Faster exits (was 40)
    const holdIfHighConfidence = config.holdIfHighConfidence || 70;
    const stopLossPercent = -30; // Auto-sell if position drops >30% to limit drawdowns
    
    if (botState.activePositions.size > 0) {
      addLog(`📊 Checking ${botState.activePositions.size} active positions - Mode: 100% AI & Hivemind Strategy`, "info");

      // BATCH ANALYZE ALL POSITIONS WITH HIVEMIND (smarter, same API usage)
      const positionsForAnalysis = [];
      const positionsArray = Array.from(botState.activePositions.entries());
      
      // Collect all positions with current prices
      const dbPositions = await storage.getAIBotPositions(ownerWalletAddress);
      
      // Fetch ALL position prices in a single batch API call (avoids rate limiting!)
      const mints = positionsArray.map(([mint]) => mint);
      const { getBatchTokenPrices } = await import("./jupiter");
      const priceMap = await getBatchTokenPrices(mints);
      
      for (const [mint, position] of positionsArray) {
        const currentPriceSOL = priceMap.get(mint);
        if (currentPriceSOL) {
          const profitPercent = ((currentPriceSOL - position.entryPriceSOL) / position.entryPriceSOL) * 100;
          const dbPos = dbPositions.find(p => p.tokenMint === mint);
          positionsForAnalysis.push({
            mint,
            symbol: dbPos?.tokenSymbol || mint.slice(0, 8),
            currentPriceSOL,
            profitPercent,
            position
          });
        }
      }

      // Get batch AI analysis for ALL positions at once (efficient!)
      addLog(`🧠 Running hivemind portfolio analysis on ${positionsForAnalysis.length} positions...`, "info");
      const batchAnalysis = await batchAnalyzePositionsWithHivemind(
        positionsForAnalysis.map(p => ({
          mint: p.mint,
          currentPriceSOL: p.currentPriceSOL,
          profitPercent: p.profitPercent,
          symbol: p.symbol
        }))
      );

      // Process each position with batch analysis results
      for (const { mint, symbol, currentPriceSOL, profitPercent, position } of positionsForAnalysis) {
        try {
          
          // Check if this is a swing trade (high confidence position) - fetch from database
          const dbPosition = await storage.getAIBotPositions(ownerWalletAddress);
          const positionData = dbPosition.find(p => p.tokenMint === mint);
          const isSwingTrade = positionData?.isSwingTrade === 1;
          const swingStopLoss = -50; // Wider stop-loss for swing trades
          const effectiveStopLoss = isSwingTrade ? swingStopLoss : stopLossPercent;
          
          if (isSwingTrade) {
            addLog(`🎯 SWING TRADE ${mint.slice(0, 8)}... | Entry: ${position.entryPriceSOL.toFixed(9)} SOL | Current: ${currentPriceSOL.toFixed(9)} SOL | Profit: ${profitPercent > 0 ? '+' : ''}${profitPercent.toFixed(2)}% | Stop: ${swingStopLoss}%`, "info");
          } else {
            addLog(`💹 Position ${mint.slice(0, 8)}... | Entry: ${position.entryPriceSOL.toFixed(9)} SOL | Current: ${currentPriceSOL.toFixed(9)} SOL | Profit: ${profitPercent > 0 ? '+' : ''}${profitPercent.toFixed(2)}%`, "info");
          }

          // STOP-LOSS: Auto-sell if loss exceeds threshold (swing trades get wider stop-loss)
          if (profitPercent <= effectiveStopLoss) {
            addLog(`🛑 STOP-LOSS TRIGGERED: ${profitPercent.toFixed(2)}% loss exceeds ${effectiveStopLoss}% limit - AUTO-SELLING to preserve capital`, "warning");
            
            // Execute immediate sell without AI analysis (emergency exit)
            const connection = getConnection();
            const treasuryKeypair = loadKeypairFromPrivateKey(treasuryKeyBase58);
            const tokenAccount = await connection.getTokenAccountsByOwner(
              treasuryKeypair.publicKey,
              { mint: new PublicKey(mint) }
            );

            if (tokenAccount.value.length > 0) {
              const sellResult = await sellTokenWithJupiter(treasuryKeyBase58, mint, 1000);
              
              if (sellResult.success && sellResult.signature) {
                const solReceived = position.amountSOL * (1 + profitPercent / 100);
                
                await storage.createTransaction({
                  projectId: null as any,
                  type: "ai_sell",
                  amount: solReceived.toString(),
                  tokenAmount: position.amountSOL.toString(),
                  txSignature: sellResult.signature,
                  status: "completed",
                  expectedPriceSOL: currentPriceSOL.toString(),
                  actualPriceSOL: currentPriceSOL.toString(),
                });

                await storage.deleteAIBotPositionByMint(ownerWalletAddress, mint);
                botState.activePositions.delete(mint);
                availableBalance += solReceived;
                
                addLog(`🛑 STOP-LOSS EXECUTED: Sold at ${profitPercent.toFixed(2)}% loss to prevent further drawdown`, "warning");
                
                realtimeService.broadcast({
                  type: "transaction_event",
                  data: {
                    projectId: ownerWalletAddress,
                    transactionType: "ai_sell_stoploss",
                    signature: sellResult.signature,
                    profitPercent,
                    reason: `Stop-loss: ${profitPercent.toFixed(2)}% loss`,
                  },
                  timestamp: Date.now(),
                });
              }
            }
            continue; // Skip AI analysis for stop-loss positions
          }

          // AI & Hivemind Strategy makes ALL sell decisions (if not stop-loss)
          let shouldSell = false;
          let sellReason = "";

          // Use BATCH analysis result (already analyzed with hivemind)
          const aiDecision = batchAnalysis.get(mint) || {
            confidence: 50,
            recommendation: "HOLD" as const,
            reasoning: "No analysis available",
            errored: true
          };
          
          // If AI analysis failed, HOLD (conservative)
          if (aiDecision.errored) {
            addLog(`⚠️ AI analysis failed - HOLDING conservatively - ${aiDecision.reasoning}`, "warning");
            shouldSell = false;
          } else {
            addLog(`🧠 Hivemind Decision: ${aiDecision.recommendation} (confidence: ${aiDecision.confidence}%) - ${aiDecision.reasoning}`, "info");

            // SWING TRADE STRATEGY: Let profits run, only exit on strong signals
            if (isSwingTrade) {
              addLog(`🎯 SWING TRADE STRATEGY: High confidence position - letting profits run`, "info");
              
              // Respect explicit HOLD recommendation
              if (aiDecision.recommendation === "HOLD") {
                addLog(`📈 HOLDING SWING TRADE - AI confirms continued momentum`, "success");
                shouldSell = false;
              }
              // Only sell swing trades when AI STRONGLY recommends it (60%+ confidence)
              else if (aiDecision.recommendation === "SELL" && aiDecision.confidence >= 60) {
                shouldSell = true;
                sellReason = `SWING TRADE EXIT: AI strongly recommends SELL with ${aiDecision.confidence}% confidence`;
              }
              // Take profits on huge wins (100%+)
              else if (profitPercent >= 100) {
                shouldSell = true;
                sellReason = `SWING TRADE PROFIT TARGET: ${profitPercent.toFixed(2)}% profit (100%+ target hit)`;
              }
              else {
                addLog(`📊 HOLDING SWING TRADE - AI confidence ${aiDecision.confidence}% not strong enough to exit (need 60%+)`, "info");
                shouldSell = false;
              }
            }
            // REGULAR TRADE STRATEGY: Standard exit rules
            else {
              // Respect explicit HOLD recommendation
              if (aiDecision.recommendation === "HOLD") {
                addLog(`🎯 HOLDING - AI recommends HOLD (confidence: ${aiDecision.confidence}%)`, "success");
                shouldSell = false;
              }
              // Sell if AI confidence drops below minimum threshold (momentum weakening)
              else if (aiDecision.confidence < minAiSellConfidence) {
                shouldSell = true;
                sellReason = `AI confidence dropped to ${aiDecision.confidence}% (below ${minAiSellConfidence}% threshold)`;
              }
              // Sell if AI explicitly recommends selling
              else if (aiDecision.recommendation === "SELL") {
                shouldSell = true;
                sellReason = `AI recommends SELL: ${aiDecision.reasoning}`;
              }
              // Hold if AI has confidence to hold
              else {
                addLog(`🎯 HOLDING - AI confidence: ${aiDecision.confidence}%`, "success");
                shouldSell = false;
              }
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
                projectId: null as any, // null for standalone AI bot
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
 * BATCH analyze ALL positions using full hivemind (6-model consensus)
 * More efficient than analyzing one-by-one - same API usage, better decisions
 */
async function batchAnalyzePositionsWithHivemind(
  positions: Array<{ mint: string; currentPriceSOL: number; profitPercent: number; symbol: string }>,
  forceOpenAI: boolean = false
): Promise<Map<string, {
  confidence: number;
  recommendation: "HOLD" | "SELL" | "ADD";
  reasoning: string;
  errored: boolean;
}>> {
  const results = new Map();
  
  if (positions.length === 0) {
    return results;
  }

  console.log(`[Hivemind Portfolio Analysis] Analyzing ${positions.length} positions with 6-model consensus...`);

  // Batch fetch all market data first
  const positionsWithData = await Promise.all(positions.map(async (pos) => {
    try {
      const response = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${pos.mint}`);
      if (!response.ok) throw new Error(`DexScreener error for ${pos.symbol}`);
      
      const data = await response.json();
      const pair = data.pairs?.[0];
      
      if (!pair) {
        results.set(pos.mint, {
          confidence: 0,
          recommendation: "SELL",
          reasoning: "No market data - likely illiquid",
          errored: true
        });
        return null;
      }

      return {
        ...pos,
        volumeUSD24h: parseFloat(pair.volume?.h24 || "0"),
        liquidityUSD: parseFloat(pair.liquidity?.usd || "0"),
        priceChange24h: parseFloat(pair.priceChange?.h24 || "0"),
        priceChange1h: parseFloat(pair.priceChange?.h1 || "0"),
        txns24h: (pair.txns?.h24?.buys || 0) + (pair.txns?.h24?.sells || 0),
        buyPressure: pair.txns?.h24?.buys && pair.txns?.h24?.sells 
          ? (pair.txns.h24.buys / (pair.txns.h24.buys + pair.txns.h24.sells)) * 100
          : 50,
      };
    } catch (error) {
      console.error(`[Batch Analysis] Failed to fetch data for ${pos.symbol}:`, error);
      results.set(pos.mint, {
        confidence: 0,
        recommendation: "HOLD",
        reasoning: "Data fetch failed - holding conservatively",
        errored: true
      });
      return null;
    }
  }));

  const validPositions = positionsWithData.filter(p => p !== null);
  
  if (validPositions.length === 0) {
    return results;
  }

  // Build consolidated prompt for ALL positions
  const portfolioPrompt = `You are analyzing a PORTFOLIO of ${validPositions.length} cryptocurrency positions. Provide recommendations for EACH position.

POSITIONS:
${validPositions.map((p, i) => `
${i + 1}. ${p.symbol} (Profit: ${p.profitPercent > 0 ? '+' : ''}${p.profitPercent.toFixed(2)}%)
   - Price: ${p.currentPriceSOL.toFixed(9)} SOL
   - Volume 24h: $${p.volumeUSD24h.toLocaleString()}
   - Liquidity: $${p.liquidityUSD.toLocaleString()}
   - Price Change 1h: ${p.priceChange1h.toFixed(2)}%
   - Price Change 24h: ${p.priceChange24h.toFixed(2)}%
   - Transactions: ${p.txns24h}
   - Buy Pressure: ${p.buyPressure.toFixed(1)}%
`).join('')}

For EACH position, provide:
- CONFIDENCE (0-100): Strength of upward momentum
- RECOMMENDATION: SELL (exit now), HOLD (keep position), or ADD (buy more if available)
- REASONING: 1-2 sentences

Respond with JSON array:
[
  {
    "symbol": "TOKEN1",
    "confidence": 75,
    "recommendation": "HOLD",
    "reasoning": "Strong momentum continuing..."
  },
  ...
]`;

  try {
    // Use AI model for portfolio analysis (with OpenAI if forced)
    let client: OpenAI;
    let model: string;
    let providerName: string;

    if (forceOpenAI && (process.env.OPENAI_API_KEY || process.env.OPENAI_API_KEY_2)) {
      // Force OpenAI usage for maximum accuracy
      client = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY || process.env.OPENAI_API_KEY_2,
      });
      model = "gpt-4o-mini";
      providerName = "OpenAI";
      console.log(`[Batch Analysis] Using OpenAI (forced) for maximum accuracy in portfolio rebalancing`);
    } else if (process.env.DEEPSEEK_API_KEY) {
      // Use DeepSeek for free, high-quality analysis
      client = new OpenAI({
        baseURL: "https://api.deepseek.com",
        apiKey: process.env.DEEPSEEK_API_KEY,
      });
      model = "deepseek-chat";
      providerName = "DeepSeek";
      console.log(`[Batch Analysis] Using DeepSeek (free tier) for portfolio analysis`);
    } else {
      throw new Error("No AI providers available (need OPENAI_API_KEY, OPENAI_API_KEY_2, or DEEPSEEK_API_KEY)");
    }

    const response = await client.chat.completions.create({
      model,
      messages: [
        {
          role: "system",
          content: "You are an expert portfolio manager analyzing cryptocurrency holdings. Provide actionable recommendations for each position. Always respond with valid JSON array."
        },
        {
          role: "user",
          content: portfolioPrompt
        }
      ],
      response_format: { type: "json_object" },
      temperature: 0.6,
      max_tokens: 2000,
    });

    const content = response.choices[0].message.content;
    if (!content) throw new Error("No response from AI");

    const parsed = JSON.parse(content);
    const recommendations = Array.isArray(parsed) ? parsed : (parsed.positions || parsed.recommendations || []);

    // Map results back to positions
    for (const rec of recommendations) {
      const position = validPositions.find(p => p.symbol === rec.symbol);
      if (position) {
        results.set(position.mint, {
          confidence: rec.confidence || 50,
          recommendation: rec.recommendation || "HOLD",
          reasoning: rec.reasoning || "No specific reasoning provided",
          errored: false
        });
      }
    }

    // Fill in any missing positions with conservative HOLD
    for (const pos of validPositions) {
      if (!results.has(pos.mint)) {
        results.set(pos.mint, {
          confidence: 50,
          recommendation: "HOLD",
          reasoning: "No analysis available - holding conservatively",
          errored: false
        });
      }
    }

  } catch (error) {
    console.error("[Batch Analysis] Hivemind analysis failed:", error);
    // Fallback: conservative HOLD for all
    for (const pos of validPositions) {
      if (!results.has(pos.mint)) {
        results.set(pos.mint, {
          confidence: 50,
          recommendation: "HOLD",
          reasoning: "Analysis error - holding conservatively",
          errored: true
        });
      }
    }
  }

  return results;
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
1. CONFIDENCE (0-100): Your confidence in the token's continued upward potential
   - 70-100: Strong upward momentum, recommend HOLD for more gains
   - 40-69: Mixed signals, use careful judgment
   - 0-39: Weakening momentum, recommend SELL

2. RECOMMENDATION: HOLD or SELL
   - HOLD: If you believe the token has strong upward potential
   - SELL: If momentum is weakening, reversal signs appear, or profit is at risk

3. REASONING: Brief explanation (2-3 sentences)

Consider:
- Is price momentum strengthening or weakening?
- Is liquidity sufficient for safe exit if needed?
- Are there signs of reversal (falling volume, declining buy pressure)?
- Is the current profit sustainable or at risk of reversal?
- What does technical analysis suggest about the trend?

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
  tokenSymbol: string;
  entryPriceSOL: number;
  amountSOL: number;
  currentPriceSOL: number;
  profitPercent: number;
  aiConfidenceAtBuy: number;
  isSwingTrade?: number;
}>> {
  try {
    // Read positions from database (persisted across restarts)
    const dbPositions = await storage.getAIBotPositions(ownerWalletAddress);
    
    if (dbPositions.length === 0) {
      return [];
    }

    // Collect all token mints for batch price fetching
    const mints = dbPositions.map(p => p.tokenMint);
    
    // Fetch ALL prices in a single batch API call (avoids rate limiting!)
    const { getBatchTokenPrices } = await import("./jupiter");
    const priceMap = await getBatchTokenPrices(mints);

    // Build positions array with prices from batch response
    const positions = dbPositions.map((position) => {
      const currentPriceSOL = priceMap.get(position.tokenMint) || 0;
      const entryPrice = parseFloat(position.entryPriceSOL);
      const profitPercent = currentPriceSOL 
        ? ((currentPriceSOL - entryPrice) / entryPrice) * 100
        : 0;

      return {
        mint: position.tokenMint,
        tokenSymbol: position.tokenSymbol || 'UNKNOWN',
        entryPriceSOL: entryPrice,
        amountSOL: parseFloat(position.amountSOL),
        currentPriceSOL: currentPriceSOL || 0,
        profitPercent,
        aiConfidenceAtBuy: position.aiConfidenceAtBuy || 0,
        isSwingTrade: position.isSwingTrade,
      };
    });

    return positions;
  } catch (error) {
    console.error(`Error fetching active positions for ${ownerWalletAddress}:`, error);
    return [];
  }
}

/**
 * Monitor open positions using DeepSeek (free 5M tokens, excellent reasoning)
 * Runs every 1.5 minutes to check position status and make sell recommendations - OPTIMIZED FOR SPEED
 */
async function monitorPositionsWithDeepSeek() {
  if (!process.env.DEEPSEEK_API_KEY) {
    console.log("[Position Monitor] DeepSeek API key not configured - skipping monitoring");
    return;
  }

  schedulerStatus.positionMonitor.status = 'running';
  schedulerStatus.positionMonitor.lastRun = Date.now();
  schedulerStatus.positionMonitor.nextRun = Date.now() + (1.5 * 60 * 1000); // 1.5 minutes
  
  try {
    console.log("[Position Monitor] Checking open positions with DeepSeek...");
    logActivity('position_monitor', 'info', '🔍 Position Monitor scanning active positions (1.5min interval - FAST)');
    
    // Get all active AI bot configs
    const configs = await storage.getAllAIBotConfigs();
    const activeConfigs = configs.filter(c => c.enabled);
    
    if (activeConfigs.length === 0) {
      console.log("[Position Monitor] No active AI bot configs");
      return;
    }

    // Get AI bot whitelist
    const { AI_BOT_WHITELISTED_WALLETS } = await import("@shared/config");
    
    for (const config of activeConfigs) {
      try {
        // Skip non-whitelisted wallets
        if (!AI_BOT_WHITELISTED_WALLETS.includes(config.ownerWalletAddress)) {
          continue;
        }
        
        const positions = await storage.getAIBotPositions(config.ownerWalletAddress);
        
        if (positions.length === 0) {
          continue;
        }

        console.log(`[Position Monitor] 🔍 Monitoring ${positions.length} positions with DeepSeek AI for ${config.ownerWalletAddress.slice(0, 8)}...`);

        // Fetch ALL position prices in a single batch API call (avoids rate limiting!)
        const mints = positions.map(p => p.tokenMint);
        const { getBatchTokenPrices } = await import("./jupiter");
        const priceMap = await getBatchTokenPrices(mints);

        // Get treasury keypair for potential sells
        if (!config.treasuryKeyCiphertext || !config.treasuryKeyIv || !config.treasuryKeyAuthTag) {
          console.log(`[Position Monitor] No treasury key - skipping ${config.ownerWalletAddress.slice(0, 8)}...`);
          continue;
        }

        const { decrypt } = await import("./crypto");
        const treasuryKeyBase58 = decrypt(
          config.treasuryKeyCiphertext,
          config.treasuryKeyIv,
          config.treasuryKeyAuthTag
        );

        for (const position of positions) {
          try {
            // Get current price from batch results
            const currentPriceSOL = priceMap.get(position.tokenMint);
            if (!currentPriceSOL) {
              console.log(`[Position Monitor] Cannot fetch price for ${position.tokenSymbol}`);
              continue;
            }

            const entryPrice = parseFloat(position.entryPriceSOL);
            const profitPercent = ((currentPriceSOL - entryPrice) / entryPrice) * 100;

            // Update position with latest price
            await storage.updateAIBotPosition(position.id, {
              lastCheckPriceSOL: currentPriceSOL.toString(),
              lastCheckProfitPercent: profitPercent.toString(),
            });

            console.log(`[Position Monitor] ${position.tokenSymbol}: Entry $${entryPrice.toFixed(9)} → Current $${currentPriceSOL.toFixed(9)} (${profitPercent > 0 ? '+' : ''}${profitPercent.toFixed(2)}%)`);

            // 🎯 AGGRESSIVE PROFIT-TAKING: Auto-sell at 100%+ to lock in big winners
            if (profitPercent >= 100) {
              console.log(`[Position Monitor] 🎉 ${position.tokenSymbol} hit +100% profit target → SELLING to lock gains!`);
              await executeSellForPosition(config, position, treasuryKeyBase58, `Profit-taking at +${profitPercent.toFixed(2)}% (100%+ target)`);
              continue;
            }

            // 🛡️ TRAILING STOP-LOSS: Lock in profits as position grows
            const isSwingTrade = position.isSwingTrade === 1;
            let stopLossThreshold = isSwingTrade ? -50 : -30;
            
            // Upgrade stop-loss based on profit level
            if (profitPercent >= 200) {
              stopLossThreshold = 100; // At +200%, protect +100% gains
              console.log(`[Position Monitor] 🛡️ ${position.tokenSymbol} trailing stop upgraded to +100% (from ${profitPercent.toFixed(2)}%)`);
            } else if (profitPercent >= 100) {
              stopLossThreshold = 50; // At +100%, protect +50% gains
              console.log(`[Position Monitor] 🛡️ ${position.tokenSymbol} trailing stop upgraded to +50% (from ${profitPercent.toFixed(2)}%)`);
            } else if (profitPercent >= 50) {
              stopLossThreshold = 20; // At +50%, protect +20% gains
              console.log(`[Position Monitor] 🛡️ ${position.tokenSymbol} trailing stop upgraded to +20% (from ${profitPercent.toFixed(2)}%)`);
            }
            
            if (profitPercent <= stopLossThreshold) {
              console.warn(`[Position Monitor] ⚠️ ${position.tokenSymbol} hit ${stopLossThreshold}% trailing stop → SELLING to protect gains!`);
              await executeSellForPosition(config, position, treasuryKeyBase58, `Trailing stop-loss at ${profitPercent.toFixed(2)}%`);
              continue;
            }

            // Use DeepSeek AI to analyze if we should sell (with OpenAI fallback)
            await analyzePositionWithAI(config, position, currentPriceSOL, profitPercent, treasuryKeyBase58);

          } catch (error) {
            console.error(`[Position Monitor] Error monitoring ${position.tokenSymbol}:`, error);
          }
        }

      } catch (error) {
        console.error(`[Position Monitor] Error for wallet ${config.ownerWalletAddress}:`, error);
      }
    }

    schedulerStatus.positionMonitor.status = 'idle';
    schedulerStatus.positionMonitor.lastResult = `Monitored positions for ${activeConfigs.length} wallets`;
  } catch (error) {
    console.error("[Position Monitor] Error:", error);
    schedulerStatus.positionMonitor.status = 'error';
    schedulerStatus.positionMonitor.lastResult = `Error: ${error instanceof Error ? error.message : 'Unknown'}`;
  }
}

/**
 * Fetch comprehensive market data from DexScreener for position analysis
 */
async function fetchPositionMarketData(tokenMint: string): Promise<{
  volumeUSD24h: number;
  liquidityUSD: number;
  priceChange24h: number;
  priceChange1h: number;
  txns24h: number;
  buyPressure: number;
  buyTxns24h: number;
  sellTxns24h: number;
} | null> {
  try {
    const response = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${tokenMint}`);
    if (!response.ok) return null;

    const data = await response.json();
    const pairs = data.pairs || [];
    if (pairs.length === 0) return null;

    const pair = pairs[0]; // Main liquidity pool

    const buyTxns = pair.txns?.h24?.buys || 0;
    const sellTxns = pair.txns?.h24?.sells || 0;
    const totalTxns = buyTxns + sellTxns;

    return {
      volumeUSD24h: parseFloat(pair.volume?.h24 || "0"),
      liquidityUSD: parseFloat(pair.liquidity?.usd || "0"),
      priceChange24h: parseFloat(pair.priceChange?.h24 || "0"),
      priceChange1h: parseFloat(pair.priceChange?.h1 || "0"),
      txns24h: totalTxns,
      buyTxns24h: buyTxns,
      sellTxns24h: sellTxns,
      buyPressure: totalTxns > 0 ? (buyTxns / totalTxns) * 100 : 50,
    };
  } catch (error) {
    console.error(`[Position Monitor] Failed to fetch DexScreener data:`, error);
    return null;
  }
}

/**
 * Analyze position with AI to determine if we should sell
 * Uses DeepSeek first (free), falls back to OpenAI if DeepSeek fails
 */
async function analyzePositionWithAI(
  config: any,
  position: any,
  currentPriceSOL: number,
  profitPercent: number,
  treasuryKeyBase58: string
): Promise<void> {
  const isSwingTrade = position.isSwingTrade === 1;
  const aiConfidenceAtBuy = parseFloat(position.aiConfidenceAtBuy || "0");

  // Fetch comprehensive market data from DexScreener
  console.log(`[Position Monitor] 📊 Fetching market data for ${position.tokenSymbol} from DexScreener...`);
  const marketData = await fetchPositionMarketData(position.tokenMint);

  // Build comprehensive analysis prompt with market metrics
  let marketMetrics = "";
  if (marketData) {
    console.log(`[Position Monitor] ✅ Market data fetched for ${position.tokenSymbol}:`);
    console.log(`  - Volume: $${marketData.volumeUSD24h.toLocaleString()}, Liquidity: $${marketData.liquidityUSD.toLocaleString()}`);
    console.log(`  - Buy Pressure: ${marketData.buyPressure.toFixed(1)}% (${marketData.buyTxns24h} buys vs ${marketData.sellTxns24h} sells)`);
    console.log(`  - Price Change: 24h ${marketData.priceChange24h > 0 ? '+' : ''}${marketData.priceChange24h.toFixed(2)}%, 1h ${marketData.priceChange1h > 0 ? '+' : ''}${marketData.priceChange1h.toFixed(2)}%`);
    
    marketMetrics = `
MARKET METRICS (24h):
- Volume: $${marketData.volumeUSD24h.toLocaleString()}
- Liquidity: $${marketData.liquidityUSD.toLocaleString()}
- Price Change 24h: ${marketData.priceChange24h > 0 ? '+' : ''}${marketData.priceChange24h.toFixed(2)}%
- Price Change 1h: ${marketData.priceChange1h > 0 ? '+' : ''}${marketData.priceChange1h.toFixed(2)}%
- Total Transactions: ${marketData.txns24h}
- Buy Transactions: ${marketData.buyTxns24h}
- Sell Transactions: ${marketData.sellTxns24h}
- Buy Pressure: ${marketData.buyPressure.toFixed(1)}% (healthy above 45%)
- Volume/Liquidity Ratio: ${marketData.liquidityUSD > 0 ? (marketData.volumeUSD24h / marketData.liquidityUSD).toFixed(2) : 'N/A'}`;
  } else {
    console.log(`[Position Monitor] ⚠️ Failed to fetch market data for ${position.tokenSymbol} - AI will analyze with limited data`);
    marketMetrics = `
MARKET METRICS: Unavailable (low liquidity or delisted token)`;
  }

  const prompt = `Analyze this cryptocurrency position to decide: HOLD or SELL?

Position: ${position.tokenSymbol}
Entry Price: ${parseFloat(position.entryPriceSOL).toFixed(9)} SOL
Current Price: ${currentPriceSOL.toFixed(9)} SOL
Profit/Loss: ${profitPercent > 0 ? '+' : ''}${profitPercent.toFixed(2)}%
AI Confidence at Buy: ${aiConfidenceAtBuy.toFixed(0)}%
Position Type: ${isSwingTrade ? 'SWING TRADE (high confidence, wider stop-loss)' : 'Regular Position'}
Stop-Loss: ${isSwingTrade ? '-50%' : '-30%'}
${marketMetrics}

DECISION RULES:
- For ${isSwingTrade ? 'SWING TRADES' : 'REGULAR positions'}: SELL only if you have 60%+ confidence momentum is dead
- RED FLAGS: Buy pressure <40%, declining volume, negative price trends, low liquidity
- Consider: Is buying pressure declining? Is volume dropping? Are there red flags?
- If momentum is still strong or data unclear, HOLD

Respond ONLY with valid JSON:
{
  "action": "HOLD" | "SELL",
  "confidence": 0-100,
  "reasoning": "brief explanation"
}`;

  // Try DeepSeek Primary first (free tier)
  if (process.env.DEEPSEEK_API_KEY) {
    try {
      const deepSeekClient = new OpenAI({
        baseURL: "https://api.deepseek.com",
        apiKey: process.env.DEEPSEEK_API_KEY,
      });

      const response = await deepSeekClient.chat.completions.create({
        model: "deepseek-chat",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.4,
        max_tokens: 300,
      });

      const content = response.choices[0]?.message?.content || "{}";
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      const analysis = jsonMatch ? JSON.parse(jsonMatch[0]) : { action: "HOLD", confidence: 0, reasoning: "Parse error" };

      console.log(`[Position Monitor] 🧠 DeepSeek AI: ${position.tokenSymbol} → ${analysis.action} (${analysis.confidence}% confidence) - ${analysis.reasoning}`);

      // Execute sell if AI recommends it with high confidence
      if (analysis.action === "SELL" && analysis.confidence >= 60) {
        console.log(`[Position Monitor] ✅ DeepSeek AI recommends SELL with ${analysis.confidence}% confidence → executing...`);
        logActivity('position_monitor', 'ai_thought', `🧠 AI: ${position.tokenSymbol} → SELL (${analysis.confidence}%) - ${analysis.reasoning.substring(0, 100)}...`);
        logActivity('position_monitor', 'success', `🔥 Executing sell for ${position.tokenSymbol} based on AI analysis`);
        await executeSellForPosition(config, position, treasuryKeyBase58, `DeepSeek AI: ${analysis.reasoning} (${analysis.confidence}% confidence)`);
      } else if (analysis.action === "SELL" && analysis.confidence < 60) {
        console.log(`[Position Monitor] ⏸️ DeepSeek suggests SELL but confidence too low (${analysis.confidence}% < 60%) → HOLDING`);
        logActivity('position_monitor', 'warning', `⏸️ ${position.tokenSymbol}: AI suggests SELL but low confidence (${analysis.confidence}% < 60%)`);
      } else {
        logActivity('position_monitor', 'ai_thought', `🧠 AI: ${position.tokenSymbol} → HOLD (${analysis.confidence}%) - ${analysis.reasoning.substring(0, 100)}...`);
      }
      return; // Success - exit
    } catch (deepSeekError: any) {
      console.warn(`[Position Monitor] DeepSeek Primary failed for ${position.tokenSymbol}: ${deepSeekError.message}`);
      
      // Try DeepSeek Backup key
      if (process.env.DEEPSEEK_API_KEY_2) {
        try {
          console.log(`[Position Monitor] 🔄 Trying DeepSeek Backup for ${position.tokenSymbol}...`);
          const deepSeekBackupClient = new OpenAI({
            baseURL: "https://api.deepseek.com",
            apiKey: process.env.DEEPSEEK_API_KEY_2,
          });

          const response = await deepSeekBackupClient.chat.completions.create({
            model: "deepseek-chat",
            messages: [{ role: "user", content: prompt }],
            temperature: 0.4,
            max_tokens: 300,
          });

          const content = response.choices[0]?.message?.content || "{}";
          const jsonMatch = content.match(/\{[\s\S]*\}/);
          const analysis = jsonMatch ? JSON.parse(jsonMatch[0]) : { action: "HOLD", confidence: 0, reasoning: "Parse error" };

          console.log(`[Position Monitor] 🧠 DeepSeek #2: ${position.tokenSymbol} → ${analysis.action} (${analysis.confidence}% confidence) - ${analysis.reasoning}`);

          // Execute sell if AI recommends it with high confidence
          if (analysis.action === "SELL" && analysis.confidence >= 60) {
            console.log(`[Position Monitor] ✅ DeepSeek #2 recommends SELL with ${analysis.confidence}% confidence → executing...`);
            await executeSellForPosition(config, position, treasuryKeyBase58, `DeepSeek #2: ${analysis.reasoning} (${analysis.confidence}% confidence)`);
          } else if (analysis.action === "SELL" && analysis.confidence < 60) {
            console.log(`[Position Monitor] ⏸️ DeepSeek #2 suggests SELL but confidence too low (${analysis.confidence}% < 60%) → HOLDING`);
          }
          return; // Success - exit
        } catch (deepSeek2Error: any) {
          console.warn(`[Position Monitor] DeepSeek Backup also failed for ${position.tokenSymbol}: ${deepSeek2Error.message}`);
          console.log(`[Position Monitor] 🔄 Falling back to OpenAI for ${position.tokenSymbol}...`);
        }
      } else {
        console.log(`[Position Monitor] 🔄 No DeepSeek backup key, falling back to OpenAI for ${position.tokenSymbol}...`);
      }
    }
  }

  // Fallback to OpenAI
  if (process.env.OPENAI_API_KEY || process.env.OPENAI_API_KEY_2) {
    try {
      const openAIClient = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY || process.env.OPENAI_API_KEY_2,
      });

      const response = await openAIClient.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.4,
        max_tokens: 300,
      });

      const content = response.choices[0]?.message?.content || "{}";
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      const analysis = jsonMatch ? JSON.parse(jsonMatch[0]) : { action: "HOLD", confidence: 0, reasoning: "Parse error" };

      console.log(`[Position Monitor] 💰 OpenAI: ${position.tokenSymbol} → ${analysis.action} (${analysis.confidence}% confidence) - ${analysis.reasoning}`);

      // Execute sell if AI recommends it with high confidence
      if (analysis.action === "SELL" && analysis.confidence >= 60) {
        console.log(`[Position Monitor] ✅ OpenAI recommends SELL with ${analysis.confidence}% confidence → executing...`);
        await executeSellForPosition(config, position, treasuryKeyBase58, `OpenAI: ${analysis.reasoning} (${analysis.confidence}% confidence)`);
      } else if (analysis.action === "SELL" && analysis.confidence < 60) {
        console.log(`[Position Monitor] ⏸️ OpenAI suggests SELL but confidence too low (${analysis.confidence}% < 60%) → HOLDING`);
      }
    } catch (error) {
      console.error(`[Position Monitor] Both DeepSeek AND OpenAI failed for ${position.tokenSymbol}:`, error);
    }
  } else {
    console.error(`[Position Monitor] No AI providers available for ${position.tokenSymbol}`);
  }
}

/**
 * Execute sell for a position
 */
async function executeSellForPosition(
  config: any,
  position: any,
  treasuryKeyBase58: string,
  reason: string
): Promise<void> {
  try {
    const tokenAmount = parseFloat(position.tokenAmount);
    
    // CRITICAL: Skip positions with 0 tokenAmount (data quality issue from buy phase)
    if (tokenAmount === 0 || isNaN(tokenAmount)) {
      console.warn(`[Position Monitor] ⚠️ Cannot sell ${position.tokenSymbol}: tokenAmount is ${position.tokenAmount} (bug in buy logic - not storing actual tokens received)`);
      console.warn(`[Position Monitor] TODO: Fix buy logic to store actual tokenAmount from Jupiter swap response`);
      return;
    }

    console.log(`[Position Monitor] 🔥 Selling ${position.tokenSymbol} - Reason: ${reason}`);
    
    const treasuryKeypair = loadKeypairFromPrivateKey(treasuryKeyBase58);
    const amountSOL = parseFloat(position.amountSOL);
    const entryPrice = parseFloat(position.entryPriceSOL);

    console.log(`[Position Monitor] 💰 Tokens to sell: ${tokenAmount.toFixed(2)} ${position.tokenSymbol}`);
    console.log(`[Position Monitor] 📊 Entry: ${entryPrice.toFixed(9)} SOL, Investment: ${amountSOL.toFixed(4)} SOL`);

    // Execute sell with Jupiter → PumpSwap fallback
    const { sellTokenWithFallback, getTokenDecimals } = await import("./jupiter");
    
    // Get token decimals for proper amount calculation
    const decimals = await getTokenDecimals(position.tokenMint);
    const tokenAmountRaw = Math.floor(tokenAmount * Math.pow(10, decimals));
    
    console.log(`[Position Monitor] 🔄 Executing swap with fallback: ${tokenAmount.toFixed(2)} ${position.tokenSymbol} → SOL`);
    
    // Try Jupiter first, then PumpSwap if it fails
    const sellResult = await sellTokenWithFallback(
      treasuryKeyBase58,
      position.tokenMint,
      tokenAmountRaw,
      3000 // 30% slippage for illiquid meme coins
    );

    if (!sellResult.success) {
      console.error(`[Position Monitor] ❌ Failed to sell ${position.tokenSymbol} on both Jupiter and PumpSwap: ${sellResult.error}`);
      console.log(`[Position Monitor] 🗑️ Closing position for ${position.tokenSymbol} (unable to sell)`);
      
      // Delete the position since we can't sell it
      await storage.deleteAIBotPosition(position.id);
      
      // Log the loss
      logActivity('position_monitor', 'warning', `⚠️ ${position.tokenSymbol}: Unable to sell (${sellResult.error}) - position closed`);
      return;
    }

    const signature = sellResult.signature!;
    console.log(`[Position Monitor] ✅ Sold via ${sellResult.route?.toUpperCase()}: ${signature}`);

    console.log(`[Position Monitor] ✅ SOLD ${position.tokenSymbol}!`);
    console.log(`[Position Monitor] 📝 Transaction: https://solscan.io/tx/${signature}`);

    // Calculate profit/loss
    const currentPrice = parseFloat(position.lastCheckPriceSOL || position.entryPriceSOL);
    const profitPercent = parseFloat(position.lastCheckProfitPercent || "0");
    const profitSOL = (currentPrice - entryPrice) * tokenAmount;
    
    console.log(`[Position Monitor] 💰 P&L: ${profitPercent > 0 ? '+' : ''}${profitPercent.toFixed(2)}% (${profitSOL > 0 ? '+' : ''}${profitSOL.toFixed(4)} SOL)`);

    // 🔥 AUTOMATIC BUYBACK & BURN: Use 5% of profit to buyback and destroy MY BOT token
    if (profitSOL > 0 && config.buybackEnabled) {
      console.log(`[Position Monitor] 🔥 Profitable trade detected → triggering buyback & burn...`);
      try {
        const { executeBuybackAndBurn } = await import("./buyback-burn");
        const buybackResult = await executeBuybackAndBurn(
          config.ownerWalletAddress,
          profitSOL,
          treasuryKeypair
        );

        if (buybackResult.success) {
          console.log(`[Position Monitor] ✅ BUYBACK & BURN COMPLETE!`);
          console.log(`[Position Monitor] 💰 Spent: ${buybackResult.buybackSOL?.toFixed(6)} SOL (${config.buybackPercentage}% of profit)`);
          console.log(`[Position Monitor] 🔥 Burned: ${buybackResult.tokensBurned?.toLocaleString()} ${config.buybackTokenMint?.slice(0, 8)}... tokens`);
          console.log(`[Position Monitor] 📝 Buy TX: https://solscan.io/tx/${buybackResult.buyTxSignature}`);
          console.log(`[Position Monitor] 🔥 Burn TX: https://solscan.io/tx/${buybackResult.burnTxSignature}`);
          
          logActivity('position_monitor', 'success', `🔥 Buyback & Burn: ${buybackResult.tokensBurned?.toLocaleString()} tokens destroyed (${buybackResult.buybackSOL?.toFixed(6)} SOL)`);
        } else {
          console.warn(`[Position Monitor] ⚠️ Buyback & Burn failed: ${buybackResult.error}`);
          logActivity('position_monitor', 'warning', `⚠️ Buyback & Burn failed: ${buybackResult.error}`);
        }
      } catch (buybackError: any) {
        console.error(`[Position Monitor] ❌ Buyback & Burn error:`, buybackError);
        logActivity('position_monitor', 'error', `❌ Buyback & Burn error: ${buybackError.message}`);
      }
    } else if (profitSOL > 0 && !config.buybackEnabled) {
      console.log(`[Position Monitor] 💡 Buyback disabled - skipping (profit: ${profitSOL.toFixed(6)} SOL)`);
    }

    // Update budget tracking (free up capital for new trades)
    const newBudgetUsed = Math.max(0, parseFloat(config.budgetUsed || "0") - amountSOL);
    await storage.createOrUpdateAIBotConfig({
      ownerWalletAddress: config.ownerWalletAddress,
      budgetUsed: newBudgetUsed.toString(),
    });

    console.log(`[Position Monitor] 💼 Capital freed: ${amountSOL.toFixed(4)} SOL (available for new trades)`);

    // Delete position from database
    await storage.deleteAIBotPosition(position.id);
    console.log(`[Position Monitor] 🗑️ Position closed and removed from tracking`);
    
  } catch (error) {
    console.error(`[Position Monitor] Error executing sell for ${position.tokenSymbol}:`, error);
  }
}

/**
 * Start position monitoring scheduler (every 1.5 minutes using free DeepSeek) - OPTIMIZED FOR SPEED
 * Active management of all positions for optimal performance
 */
export function startPositionMonitoringScheduler() {
  if (!process.env.DEEPSEEK_API_KEY) {
    console.warn("[Position Monitor] DEEPSEEK_API_KEY not configured - position monitoring disabled");
    return;
  }

  console.log("[Position Monitor] Starting...");
  console.log("[Position Monitor] Using free DeepSeek API (5M tokens, superior reasoning) for position monitoring");

  // Run every 1.5 minutes for active position management
  // Using 3-minute intervals with 90-second offset to achieve 1.5-minute frequency
  let isOffset = false;
  positionMonitorJob = cron.schedule("*/3 * * * *", () => {
    if (isOffset) {
      // Run at 1.5-minute mark (90 seconds delay)
      setTimeout(() => {
        monitorPositionsWithDeepSeek().catch((error) => {
          console.error("[Position Monitor] Unexpected error:", error);
        });
      }, 90000);
    } else {
      // Run immediately at 3-minute mark
      monitorPositionsWithDeepSeek().catch((error) => {
        console.error("[Position Monitor] Unexpected error:", error);
      });
    }
    isOffset = !isOffset; // Alternate between immediate and delayed execution
  });

  console.log("[Position Monitor] Active (checks every 1.5 minutes for active management)");
}

/**
 * Automatically rebalance portfolio using OpenAI-powered analysis
 * Analyzes all positions and executes sells when AI recommends it
 */
async function rebalancePortfolioWithOpenAI() {
  try {
    console.log("[Portfolio Rebalancer] 🤖 Starting automatic OpenAI-powered rebalancing...");
    
    // Get all active AI bot configs
    const configs = await storage.getAllAIBotConfigs();
    const activeConfigs = configs.filter(c => c.enabled);
    
    if (activeConfigs.length === 0) {
      console.log("[Portfolio Rebalancer] No active AI bot configs");
      return;
    }

    // Get AI bot whitelist
    const { AI_BOT_WHITELISTED_WALLETS } = await import("@shared/config");
    
    for (const config of activeConfigs) {
      try {
        // Skip non-whitelisted wallets
        if (!AI_BOT_WHITELISTED_WALLETS.includes(config.ownerWalletAddress)) {
          continue;
        }
        
        const positions = await storage.getAIBotPositions(config.ownerWalletAddress);
        
        if (positions.length === 0) {
          console.log(`[Portfolio Rebalancer] No positions for ${config.ownerWalletAddress.slice(0, 8)}...`);
          continue;
        }

        console.log(`[Portfolio Rebalancer] 🧠 Analyzing ${positions.length} positions for ${config.ownerWalletAddress.slice(0, 8)}... with FULL OPENAI CONSENSUS`);

        // Get treasury keypair
        if (!config.treasuryKeyCiphertext || !config.treasuryKeyIv || !config.treasuryKeyAuthTag) {
          console.error(`[Portfolio Rebalancer] No treasury key configured for ${config.ownerWalletAddress.slice(0, 8)}...`);
          continue;
        }

        const { decrypt } = await import("./crypto");
        const treasuryKeyBase58 = decrypt(
          config.treasuryKeyCiphertext,
          config.treasuryKeyIv,
          config.treasuryKeyAuthTag
        );

        // Fetch batch prices for all positions
        const mints = positions.map(p => p.tokenMint);
        const { getBatchTokenPrices } = await import("./jupiter");
        const priceMap = await getBatchTokenPrices(mints);

        // Prepare positions for hivemind analysis
        const positionsForAnalysis = positions.map(p => {
          const currentPriceSOL = priceMap.get(p.tokenMint) || 0;
          const entryPrice = parseFloat(p.entryPriceSOL);
          const profitPercent = entryPrice > 0 
            ? ((currentPriceSOL - entryPrice) / entryPrice) * 100 
            : 0;
          
          return {
            mint: p.tokenMint,
            symbol: p.tokenSymbol || 'UNKNOWN',
            currentPriceSOL,
            profitPercent,
          };
        });

        // Run batch hivemind analysis with FORCED OpenAI inclusion for maximum accuracy
        const analysisResults = await batchAnalyzePositionsWithHivemind(positionsForAnalysis, true);

        console.log(`[Portfolio Rebalancer] ✅ AI analysis complete for ${positions.length} positions`);

        // Process recommendations and execute sells
        let sellsExecuted = 0;
        let sellsFailed = 0;

        for (const position of positions) {
          const analysis = analysisResults.get(position.tokenMint);

          if (!analysis || analysis.errored) {
            console.log(`[Portfolio Rebalancer] ⏭️  No analysis for ${position.tokenSymbol}`);
            continue;
          }

          // Check if AI recommends selling
          const shouldSell = analysis.recommendation === 'SELL' && analysis.confidence >= 50;
          
          if (shouldSell) {
            console.log(`[Portfolio Rebalancer] 🔴 SELLING ${position.tokenSymbol} - AI Confidence: ${analysis.confidence}%`);
            console.log(`[Portfolio Rebalancer] Reason: ${analysis.reasoning}`);

            try {
              // Execute sell with Jupiter → PumpSwap fallback
              const { sellTokenWithFallback, getTokenDecimals } = await import("./jupiter");
              const { getAccount } = await import("@solana/spl-token");
              const { getConnection } = await import("./solana-sdk");
              
              // Get treasury keypair for balance checking
              const treasuryKeypair = loadKeypairFromPrivateKey(treasuryKeyBase58);
              
              // Get token account balance
              const connection = getConnection();
              const tokenAccountAddress = await import("@solana/spl-token").then(({ getAssociatedTokenAddress }) => 
                getAssociatedTokenAddress(
                  new PublicKey(position.tokenMint),
                  treasuryKeypair.publicKey
                )
              );
              
              const tokenAccountInfo = await getAccount(connection, tokenAccountAddress);
              const tokenBalanceRaw = Number(tokenAccountInfo.amount);
              
              const sellResult = await sellTokenWithFallback(
                treasuryKeyBase58,
                position.tokenMint,
                tokenBalanceRaw,
                1000 // 10% slippage for fast execution
              );

              if (sellResult.success) {
                console.log(`[Portfolio Rebalancer] ✅ Successfully sold ${position.tokenSymbol} - TX: ${sellResult.signature}`);
                
                // Calculate profit
                const currentPrice = priceMap.get(position.tokenMint) || 0;
                const entryPrice = parseFloat(position.entryPriceSOL);
                const profitPercent = entryPrice > 0
                  ? ((currentPrice - entryPrice) / entryPrice) * 100 
                  : 0;

                // Delete position from database (close the position)
                await storage.deleteAIBotPosition(position.id);

                // Record sell transaction
                await storage.createTransaction({
                  projectId: null as any, // null for standalone AI bot
                  type: 'ai_sell',
                  amount: parseFloat(position.amountSOL).toFixed(6),
                  tokenAmount: '0',
                  txSignature: sellResult.signature || '',
                  status: 'completed',
                  expectedPriceSOL: currentPrice.toString(),
                  actualPriceSOL: currentPrice.toString(),
                });

                sellsExecuted++;
                
                // Send real-time update
                realtimeService.broadcast({
                  type: "transaction_event",
                  data: {
                    projectId: config.ownerWalletAddress,
                    transactionType: "ai_sell_rebalance",
                    signature: sellResult.signature,
                    tokenSymbol: position.tokenSymbol,
                    amount: parseFloat(position.amountSOL),
                    profitPercent,
                    reason: "AI Portfolio Rebalance",
                  },
                  timestamp: Date.now(),
                });

              } else {
                console.error(`[Portfolio Rebalancer] ❌ Failed to sell ${position.tokenSymbol}: ${sellResult.error}`);
                sellsFailed++;
              }
            } catch (error) {
              console.error(`[Portfolio Rebalancer] Error selling ${position.tokenSymbol}:`, error);
              sellsFailed++;
            }
          } else {
            const action = analysis.recommendation === 'HOLD' ? '🟢 HOLD' : '🔵 ADD';
            console.log(`[Portfolio Rebalancer] ${action} ${position.tokenSymbol} - AI Confidence: ${analysis.confidence}%`);
          }
        }

        if (sellsExecuted > 0 || sellsFailed > 0) {
          console.log(`[Portfolio Rebalancer] 📊 Rebalancing complete: ${sellsExecuted} sells executed, ${sellsFailed} failed`);
        } else {
          console.log(`[Portfolio Rebalancer] ✅ No rebalancing needed - all positions holding strong`);
        }

      } catch (error) {
        console.error(`[Portfolio Rebalancer] Error for wallet ${config.ownerWalletAddress}:`, error);
      }
    }

  } catch (error) {
    console.error("[Portfolio Rebalancer] Error:", error);
  }
}

/**
 * Sync portfolio on startup - removes database positions that no longer exist in wallet
 * This ensures accurate performance tracking after manual position closures
 */
async function syncPortfolioOnStartup(ownerWalletAddress: string, treasuryKeyBase58: string) {
  const shortAddress = `${ownerWalletAddress.slice(0, 8)}...`;
  try {
    console.log(`[Portfolio Sync] 🔄 Starting sync for ${shortAddress}`);
    
    // Get all token accounts from wallet
    const { getAllTokenAccounts } = await import("./solana");
    console.log(`[Portfolio Sync] Fetching wallet token accounts for ${shortAddress}...`);
    const tokenAccounts = await getAllTokenAccounts(ownerWalletAddress);
    console.log(`[Portfolio Sync] Found ${tokenAccounts.length} token accounts in wallet`);
    
    // Create a set of token mints that exist in the wallet
    const walletTokenMints = new Set<string>();
    for (const account of tokenAccounts) {
      const parsed = account.account.data.parsed;
      const balance = parsed.info.tokenAmount.uiAmount;
      
      // Only include tokens with non-zero balance
      if (balance > 0) {
        walletTokenMints.add(parsed.info.mint);
      }
    }
    console.log(`[Portfolio Sync] Found ${walletTokenMints.size} tokens with non-zero balance`);
    
    // Get all database positions
    const dbPositions = await storage.getAIBotPositions(ownerWalletAddress);
    console.log(`[Portfolio Sync] Found ${dbPositions.length} positions in database`);
    
    // Find positions in database that don't exist in wallet anymore
    const positionsToRemove = dbPositions.filter(
      position => !walletTokenMints.has(position.tokenMint)
    );
    
    if (positionsToRemove.length === 0) {
      console.log(`[Portfolio Sync] ✅ Portfolio in sync - ${dbPositions.length} positions match wallet`);
      return;
    }
    
    // Remove orphaned positions
    console.log(`[Portfolio Sync] 🗑️  Removing ${positionsToRemove.length} orphaned position(s)...`);
    
    for (const position of positionsToRemove) {
      await storage.deleteAIBotPosition(position.id);
      console.log(`[Portfolio Sync] ❌ Removed ${position.tokenSymbol} (${position.tokenMint.slice(0, 8)}...) - no longer in wallet`);
    }
    
    const remainingPositions = dbPositions.length - positionsToRemove.length;
    console.log(`[Portfolio Sync] ✅ Sync complete for ${shortAddress} - ${remainingPositions} active positions remain`);
    
  } catch (error) {
    console.error(`[Portfolio Sync] Error syncing portfolio for ${shortAddress}:`, error);
  }
}

/**
 * Start automatic portfolio rebalancing scheduler (every 30 minutes with OpenAI)
 * Uses full 7-model consensus including OpenAI for comprehensive portfolio analysis
 */
export function startPortfolioRebalancingScheduler() {
  if (!process.env.OPENAI_API_KEY && !process.env.OPENAI_API_KEY_2) {
    console.warn("[Portfolio Rebalancer] No OpenAI API keys configured - rebalancing disabled");
    return;
  }

  console.log("[Portfolio Rebalancer] 🤖 Starting automatic OpenAI-powered rebalancing...");
  console.log("[Portfolio Rebalancer] Schedule: Every 30 minutes with FULL HIVEMIND + OpenAI consensus");

  // Run every 30 minutes
  portfolioRebalancerJob = cron.schedule("*/30 * * * *", () => {
    rebalancePortfolioWithOpenAI().catch((error) => {
      console.error("[Portfolio Rebalancer] Unexpected error:", error);
    });
  });

  console.log("[Portfolio Rebalancer] ✅ Active (automatic rebalancing every 30 minutes)");
}
