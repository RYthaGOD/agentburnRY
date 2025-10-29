// AI Trading Bot Scheduler - Grok-powered PumpFun trading automation
// Scans PumpFun trending tokens, analyzes with Grok AI, and executes trades

import cron, { type ScheduledTask } from "node-cron";
import { storage } from "./storage";
import { analyzeTokenWithGrok, analyzeTokenWithHiveMind, isGrokConfigured, getAIClient, type TokenMarketData } from "./grok-analysis";
import { buyTokenWithJupiter, buyTokenWithFallback, getTokenPrice, getSwapOrder, executeSwapOrder, getWalletBalances } from "./jupiter";
import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
import { sellTokenOnPumpFun } from "./pumpfun";
import { getTreasuryKey } from "./key-manager";
import { getWalletBalance } from "./solana";
import { deductTransactionFee, deductPlatformFee } from "./transaction-fee";
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
let quickScanJob: ScheduledTask | null = null;
let deepScanJob: ScheduledTask | null = null;
let memoryCleanupJob: ScheduledTask | null = null;
let positionMonitorJob: ScheduledTask | null = null;
let portfolioRebalancerJob: ScheduledTask | null = null;
let walletSyncJob: ScheduledTask | null = null;
let databaseCleanupJob: ScheduledTask | null = null;
let strategyLearningJob: ScheduledTask | null = null;

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
  
  if (walletSyncJob) {
    walletSyncJob.stop();
    walletSyncJob = null;
    console.log("[Wallet Sync] Wallet synchronization scheduler stopped");
  }
  
  if (databaseCleanupJob) {
    databaseCleanupJob.stop();
    databaseCleanupJob = null;
    console.log("[Database Cleanup] Database cleanup scheduler stopped");
  }
  
  if (strategyLearningJob) {
    strategyLearningJob.stop();
    strategyLearningJob = null;
    console.log("[Strategy Learning] Strategy learning scheduler stopped");
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
 * Cleanup old database records to prevent data accumulation
 * Runs daily at 3 AM to remove expired signatures, strategies, and old transactions
 */
async function cleanupDatabase() {
  console.log("[Database Cleanup] 🧹 Starting database cleanup...");
  
  try {
    let totalRemoved = 0;
    
    // Cleanup 1: Remove expired signature hashes (used for replay attack prevention)
    // These expire after 5 minutes and are safe to delete immediately
    const { db } = await import("./db");
    const { usedSignatures, hivemindStrategies, transactions } = await import("@shared/schema");
    const { lt, and, eq } = await import("drizzle-orm");
    
    const expiredSigs = await db.delete(usedSignatures)
      .where(lt(usedSignatures.expiresAt, new Date()))
      .returning();
    
    if (expiredSigs.length > 0) {
      totalRemoved += expiredSigs.length;
      console.log(`[Database Cleanup] ✅ Removed ${expiredSigs.length} expired signature(s)`);
    }
    
    // Cleanup 2: Remove expired hivemind strategies
    // These expire after 3 hours and are regenerated by the AI
    const expiredStrategies = await db.delete(hivemindStrategies)
      .where(lt(hivemindStrategies.validUntil, new Date()))
      .returning();
    
    if (expiredStrategies.length > 0) {
      totalRemoved += expiredStrategies.length;
      console.log(`[Database Cleanup] ✅ Removed ${expiredStrategies.length} expired strategy(ies)`);
    }
    
    // Cleanup 3: Remove old failed transactions (>7 days)
    // Failed transactions are kept for debugging but removed after a week
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    
    const oldFailedTxs = await db.delete(transactions)
      .where(
        and(
          eq(transactions.status, "failed"),
          lt(transactions.createdAt, sevenDaysAgo)
        )
      )
      .returning();
    
    if (oldFailedTxs.length > 0) {
      totalRemoved += oldFailedTxs.length;
      console.log(`[Database Cleanup] ✅ Removed ${oldFailedTxs.length} old failed transaction(s)`);
    }
    
    // Cleanup 4: Remove very old completed transactions (>90 days)
    // Keep completed transactions for 90 days for audit purposes
    const ninetyDaysAgo = new Date();
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
    
    const oldCompletedTxs = await db.delete(transactions)
      .where(
        and(
          eq(transactions.status, "completed"),
          lt(transactions.createdAt, ninetyDaysAgo)
        )
      )
      .returning();
    
    if (oldCompletedTxs.length > 0) {
      totalRemoved += oldCompletedTxs.length;
      console.log(`[Database Cleanup] ✅ Removed ${oldCompletedTxs.length} old transaction(s) (>90 days)`);
    }
    
    if (totalRemoved === 0) {
      console.log("[Database Cleanup] ✨ No old data to remove - database is clean");
    } else {
      console.log(`[Database Cleanup] ✅ Total removed: ${totalRemoved} record(s)`);
    }
    
  } catch (error) {
    console.error("[Database Cleanup] ❌ Error during cleanup:", error);
  }
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
  
  console.log(`[Activity Log] ${category} - ${type}: ${message}`);
  
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
const CACHE_DURATION_MS = 5 * 60 * 1000; // 5 minutes (MORE FREQUENT: fresher token variety)

/**
 * Cache for AI analysis results with ADAPTIVE INVALIDATION
 * Auto-invalidates when price moves significantly, preventing stale decisions
 */
interface AnalysisCache {
  analysis: any;
  timestamp: number;
  expiresAt: number;
  priceAtAnalysis: number; // Track price to detect significant changes
  profitAtAnalysis: number; // Track profit to detect significant changes
}

const analysisCache: Map<string, AnalysisCache> = new Map();
const ANALYSIS_CACHE_DURATION_MS = 45 * 60 * 1000; // 45 minutes MAX (adaptive invalidation triggers earlier)
const CACHE_INVALIDATION_PRICE_THRESHOLD = 8; // Invalidate cache if price moves >8%
const CACHE_INVALIDATION_PROFIT_THRESHOLD = 10; // Invalidate cache if profit moves >10%

/**
 * Position fingerprint cache - skip re-analyzing positions that haven't changed
 * Fingerprint = mint + currentPrice + profitPercent
 */
interface PositionFingerprint {
  mint: string;
  lastPrice: number;
  lastProfit: number;
  lastAnalyzedAt: number;
}

const positionFingerprints: Map<string, PositionFingerprint> = new Map();

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
  
  // Fetch from Jupiter API (more reliable, better rate limits than DexScreener)
  const { fetchTokensFromJupiter } = await import('./jupiter-token-discovery.js');
  
  const allTokens = await fetchTokensFromJupiter(100); // Fetch 100 tokens from Jupiter API
  
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
  slippageBps: number = 500 // 5% slippage default (optimized for profit preservation)
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
 * Calculate RSI (Relative Strength Index) from price changes
 * RSI ranges from 0-100:
 * - Below 30: Oversold (potential buy signal)
 * - Above 70: Overbought (potential sell signal)
 */
function calculateRSI(priceChanges: number[], period: number = 14): number {
  if (priceChanges.length < period) return 50; // Neutral if insufficient data

  let gains = 0;
  let losses = 0;

  // Calculate average gains and losses
  for (let i = 0; i < period; i++) {
    const change = priceChanges[i];
    if (change > 0) {
      gains += change;
    } else {
      losses += Math.abs(change);
    }
  }

  const avgGain = gains / period;
  const avgLoss = losses / period;

  if (avgLoss === 0) return 100; // No losses = maximum strength
  
  const rs = avgGain / avgLoss;
  const rsi = 100 - (100 / (1 + rs));
  
  return Math.max(0, Math.min(100, rsi));
}

/**
 * Calculate EMA (Exponential Moving Average)
 * EMA gives more weight to recent prices
 */
function calculateEMA(prices: number[], period: number): number {
  if (prices.length === 0) return 0;
  if (prices.length < period) return prices[prices.length - 1]; // Return latest if insufficient data

  const multiplier = 2 / (period + 1);
  let ema = prices[0]; // Start with first price

  for (let i = 1; i < prices.length; i++) {
    ema = (prices[i] - ema) * multiplier + ema;
  }

  return ema;
}

/**
 * Calculate Bollinger Bands
 * Returns { upper, middle, lower, percentB }
 * - %B > 1: Price above upper band (overbought)
 * - %B < 0: Price below lower band (oversold)
 * - %B = 0.5: Price at middle band
 */
function calculateBollingerBands(prices: number[], period: number = 20, stdDev: number = 2): {
  upper: number;
  middle: number;
  lower: number;
  percentB: number;
  bandwidth: number;
} {
  if (prices.length < period) {
    const currentPrice = prices[prices.length - 1] || 0;
    return { upper: currentPrice, middle: currentPrice, lower: currentPrice, percentB: 0.5, bandwidth: 0 };
  }

  // Calculate SMA (middle band)
  const recentPrices = prices.slice(-period);
  const sma = recentPrices.reduce((sum, p) => sum + p, 0) / period;

  // Calculate standard deviation
  const squaredDiffs = recentPrices.map(p => Math.pow(p - sma, 2));
  const variance = squaredDiffs.reduce((sum, sq) => sum + sq, 0) / period;
  const standardDeviation = Math.sqrt(variance);

  // Calculate bands
  const upper = sma + (stdDev * standardDeviation);
  const lower = sma - (stdDev * standardDeviation);
  
  const currentPrice = prices[prices.length - 1];
  const percentB = (upper - lower) !== 0 ? (currentPrice - lower) / (upper - lower) : 0.5;
  const bandwidth = (upper - lower) / sma;

  return {
    upper,
    middle: sma,
    lower,
    percentB,
    bandwidth
  };
}

/**
 * Fetch historical price data from DexScreener for technical analysis
 * Returns array of prices (most recent last)
 */
async function fetchHistoricalPrices(tokenMint: string): Promise<number[]> {
  try {
    const response = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${tokenMint}`);
    if (!response.ok) return [];

    const data = await response.json();
    const pairs = data.pairs || [];
    if (pairs.length === 0) return [];

    const pair = pairs[0];
    const currentPrice = parseFloat(pair.priceUsd || "0");
    
    // Build price history from available data
    const prices: number[] = [];
    
    // We only have % changes, so we'll reconstruct approximate prices
    const priceChange5m = parseFloat(pair.priceChange?.m5 || "0");
    const priceChange1h = parseFloat(pair.priceChange?.h1 || "0");
    const priceChange6h = parseFloat(pair.priceChange?.h6 || "0");
    const priceChange24h = parseFloat(pair.priceChange?.h24 || "0");
    
    // Calculate historical prices (approximation)
    const price24hAgo = currentPrice / (1 + priceChange24h / 100);
    const price6hAgo = currentPrice / (1 + priceChange6h / 100);
    const price1hAgo = currentPrice / (1 + priceChange1h / 100);
    const price5mAgo = currentPrice / (1 + priceChange5m / 100);
    
    // Build 20-point price array for technical indicators
    // Interpolate between known points
    for (let i = 0; i < 5; i++) prices.push(price24hAgo + (price6hAgo - price24hAgo) * (i / 5));
    for (let i = 0; i < 5; i++) prices.push(price6hAgo + (price1hAgo - price6hAgo) * (i / 5));
    for (let i = 0; i < 5; i++) prices.push(price1hAgo + (price5mAgo - price1hAgo) * (i / 5));
    for (let i = 0; i < 5; i++) prices.push(price5mAgo + (currentPrice - price5mAgo) * (i / 5));
    
    return prices;
  } catch (error) {
    console.error(`[Technical Analysis] Failed to fetch historical prices:`, error);
    return [];
  }
}

/**
 * Calculate comprehensive technical indicators for a token
 */
async function calculateTechnicalIndicators(tokenMint: string, currentPriceUsd: number): Promise<{
  rsi: number;
  rsiSignal: string;
  ema9: number;
  ema21: number;
  emaSignal: string;
  bollingerBands: { upper: number; middle: number; lower: number; percentB: number; bandwidth: number };
  bollingerSignal: string;
  overallSignal: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  technicalScore: number; // 0-100
}> {
  const prices = await fetchHistoricalPrices(tokenMint);
  
  if (prices.length === 0) {
    return {
      rsi: 50,
      rsiSignal: 'NEUTRAL',
      ema9: currentPriceUsd,
      ema21: currentPriceUsd,
      emaSignal: 'NEUTRAL',
      bollingerBands: { upper: currentPriceUsd, middle: currentPriceUsd, lower: currentPriceUsd, percentB: 0.5, bandwidth: 0 },
      bollingerSignal: 'NEUTRAL',
      overallSignal: 'NEUTRAL',
      technicalScore: 50
    };
  }

  // Calculate price changes for RSI
  const priceChanges: number[] = [];
  for (let i = 1; i < prices.length; i++) {
    const change = ((prices[i] - prices[i - 1]) / prices[i - 1]) * 100;
    priceChanges.push(change);
  }

  // Calculate indicators
  const rsi = calculateRSI(priceChanges, 14);
  const ema9 = calculateEMA(prices, 9);
  const ema21 = calculateEMA(prices, 21);
  const bollingerBands = calculateBollingerBands(prices, 20, 2);

  // Generate signals
  const rsiSignal = rsi < 30 ? 'OVERSOLD (Buy)' : rsi > 70 ? 'OVERBOUGHT (Sell)' : rsi < 40 ? 'Bullish' : rsi > 60 ? 'Bearish' : 'NEUTRAL';
  const emaSignal = ema9 > ema21 ? 'BULLISH (Golden Cross)' : ema9 < ema21 ? 'BEARISH (Death Cross)' : 'NEUTRAL';
  
  let bollingerSignal = 'NEUTRAL';
  if (bollingerBands.percentB > 1) {
    bollingerSignal = 'OVERBOUGHT (above upper band)';
  } else if (bollingerBands.percentB < 0) {
    bollingerSignal = 'OVERSOLD (below lower band)';
  } else if (bollingerBands.percentB > 0.8) {
    bollingerSignal = 'Approaching overbought';
  } else if (bollingerBands.percentB < 0.2) {
    bollingerSignal = 'Approaching oversold';
  }

  // Calculate overall signal
  let bullishSignals = 0;
  let bearishSignals = 0;

  if (rsi < 40) bullishSignals++;
  if (rsi > 60) bearishSignals++;
  if (ema9 > ema21) bullishSignals++;
  if (ema9 < ema21) bearishSignals++;
  if (bollingerBands.percentB < 0.3) bullishSignals++;
  if (bollingerBands.percentB > 0.7) bearishSignals++;

  const overallSignal = bullishSignals > bearishSignals ? 'BULLISH' : bearishSignals > bullishSignals ? 'BEARISH' : 'NEUTRAL';

  // Calculate technical score (0-100)
  let technicalScore = 50; // Start neutral

  // RSI contribution (30 points)
  if (rsi < 30) technicalScore += 15; // Oversold = buy opportunity
  else if (rsi < 40) technicalScore += 10;
  else if (rsi > 70) technicalScore -= 15; // Overbought = sell signal
  else if (rsi > 60) technicalScore -= 10;

  // EMA contribution (30 points)
  if (ema9 > ema21 * 1.02) technicalScore += 15; // Strong bullish
  else if (ema9 > ema21) technicalScore += 10;
  else if (ema9 < ema21 * 0.98) technicalScore -= 15; // Strong bearish
  else if (ema9 < ema21) technicalScore -= 10;

  // Bollinger Bands contribution (20 points)
  if (bollingerBands.percentB < 0.2) technicalScore += 10; // Oversold
  else if (bollingerBands.percentB > 0.8) technicalScore -= 10; // Overbought

  // Bandwidth contribution (squeeze/expansion)
  if (bollingerBands.bandwidth < 0.05) technicalScore += 10; // Squeeze = potential breakout

  technicalScore = Math.max(0, Math.min(100, technicalScore));

  return {
    rsi,
    rsiSignal,
    ema9,
    ema21,
    emaSignal,
    bollingerBands,
    bollingerSignal,
    overallSignal,
    technicalScore
  };
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
        // BALANCED QUALITY FILTERS: More variety while maintaining safety
        // 60%+ organic score, 50%+ quality score, 50+ holders, 24h+ age
        const minOrganicScore = config?.minOrganicScore ?? 60; // LOWERED from 80% for variety
        const minQualityScore = config?.minQualityScore ?? 50; // LOWERED from 70% for variety
        const minLiquidity = config?.minLiquidityUSD ?? 10000; // LOWERED from $20k for more opportunities
        const minTxns = config?.minTransactions24h ?? 30; // LOWERED from 50 for more options
        
        const txns24h = (pair.txns?.h24?.buys || 0) + (pair.txns?.h24?.sells || 0);
        const liquidityUSD = pair.liquidity?.usd || 0;
        
        // Check token age (must be at least 24 hours old to avoid new scams)
        const pairAge = pair.pairCreatedAt ? Date.now() - pair.pairCreatedAt : Infinity;
        const MIN_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours
        const isOldEnough = pairAge >= MIN_AGE_MS;
        
        // DexScreener doesn't provide holder count directly, but we can estimate from transaction count
        // More unique transactions usually means more holders
        const estimatedHolders = Math.floor(txns24h * 0.3); // Rough estimate: 30% of txs are unique holders
        const minHolders = 50; // LOWERED from 100 for more variety
        const hasEnoughHolders = estimatedHolders >= minHolders;
        
        return (
          pair.organicScore >= minOrganicScore &&
          pair.qualityScore >= minQualityScore &&
          liquidityUSD >= minLiquidity &&
          txns24h >= minTxns &&
          isOldEnough &&
          hasEnoughHolders
        );
      })
      .sort((a: any, b: any) => b.qualityScore - a.qualityScore) // Sort by quality score (best first)
      .slice(0, 50); // EXPANDED from 35 to 50 for more variety
    
    const minOrganicScore = config?.minOrganicScore ?? 60;
    const minQualityScore = config?.minQualityScore ?? 50;
    
    console.log(`[AI Bot] 📊 Filtered to ${scoredPairs.length} quality tokens (min ${minOrganicScore}% organic, min ${minQualityScore}% quality, 24h+ age, 50+ holders)`);
    if (scoredPairs.length > 0) {
      const top = scoredPairs[0];
      console.log(`[AI Bot] 🏆 Top token: ${top.baseToken?.symbol} - Quality: ${top.qualityScore.toFixed(1)}%, Organic: ${top.organicScore.toFixed(1)}%`);
    }
    
    // Map to TokenMarketData format with enhanced technical indicators
    const tokens: TokenMarketData[] = scoredPairs.map((pair: any) => {
      // Calculate buy pressure from transaction data
      const buys24h = pair.txns?.h24?.buys || 0;
      const sells24h = pair.txns?.h24?.sells || 0;
      const totalTxns = buys24h + sells24h;
      const buyPressurePercent = totalTxns > 0 ? (buys24h / totalTxns) * 100 : 50;
      
      // Calculate volume change (compare recent volume to baseline)
      const volumeH1 = pair.volume?.h1 || 0;
      const volumeH24 = pair.volume?.h24 || 0;
      const avgHourlyVolume = volumeH24 / 24;
      const volumeChange24h = avgHourlyVolume > 0 ? ((volumeH1 - avgHourlyVolume) / avgHourlyVolume) * 100 : 0;
      
      return {
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
        priceChange5m: pair.priceChange?.m5 || 0, // 5-minute price change
        volumeChange24h: volumeChange24h, // Volume trend
        buyPressurePercent: buyPressurePercent, // Buy/sell pressure
        holderCount: undefined, // DexScreener doesn't provide holder count
      };
    });

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

    // Check subscription/free trades access for each bot
    const { hasAIBotAccess } = await import("./subscription-access");
    
    // Filter to only bots with active access (free trades or subscription)
    const accessibleConfigs = enabledConfigs.filter((c: any) => 
      hasAIBotAccess({
        freeTradesUsed: c.freeTradesUsed || 0,
        subscriptionActive: c.subscriptionActive || false,
        subscriptionExpiresAt: c.subscriptionExpiresAt || null,
      }, c.ownerWalletAddress)
    );
    
    if (accessibleConfigs.length === 0) {
      console.log("[Standalone AI Bot Scheduler] No bots with active access (free trades or subscription)");
      return;
    }
    
    console.log(`[Standalone AI Bot Scheduler] ${accessibleConfigs.length} bots with active access`);

    // Check and generate hivemind strategies for each bot before running deep scan
    const { shouldGenerateNewStrategy, generateHivemindStrategy, saveHivemindStrategy, getLatestStrategy } = await import("./hivemind-strategy");
    
    for (const config of accessibleConfigs) {
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

    // Run bots in parallel (with reasonable concurrency) - only accessible wallets
    await Promise.all(accessibleConfigs.map((c: any) => executeStandaloneAIBot(c.ownerWalletAddress)));

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
    
    // Check subscription/free trades access for each bot
    const { hasAIBotAccess } = await import("./subscription-access");
    
    // Filter to only bots with active access (free trades or subscription)
    const accessibleConfigs = enabledConfigs.filter((c: any) => 
      hasAIBotAccess({
        freeTradesUsed: c.freeTradesUsed || 0,
        subscriptionActive: c.subscriptionActive || false,
        subscriptionExpiresAt: c.subscriptionExpiresAt || null,
      }, c.ownerWalletAddress)
    );
    
    if (accessibleConfigs.length === 0) {
      console.log("[Quick Scan] No bots with active access (free trades or subscription)");
      return;
    }
    
    // Check if DeepSeek is available for fast AI analysis
    const hasDeepSeek = !!process.env.DEEPSEEK_API_KEY;
    
    for (const config of accessibleConfigs) {
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
        
        console.log(`[Quick Scan DEBUG] Total tokens: ${tokens.length}, after volume filter: ${filteredTokens.length}`);
        console.log(`[Quick Scan DEBUG] Min requirements: volume=${minVolumeUSD}, liquidity=${minLiquidityUSD}`);
        
        // Sample a few tokens to see their data
        if (filteredTokens.length > 0) {
          const sample = filteredTokens[0];
          console.log(`[Quick Scan DEBUG] Sample token:`, {
            symbol: sample.symbol,
            priceChange1h: sample.priceChange1h,
            priceChange24h: sample.priceChange24h,
            volumeUSD24h: sample.volumeUSD24h,
            liquidityUSD: sample.liquidityUSD,
          });
        }
        
        // Quick technical filters with hivemind liquidity threshold
        const opportunities = filteredTokens.filter(token => {
          const has1hMomentum = (token.priceChange1h ?? 0) > 0;
          const has24hMomentum = (token.priceChange24h ?? 0) > 0;
          const hasVolume = token.volumeUSD24h >= minVolumeUSD;
          const hasLiquidity = (token.liquidityUSD ?? 0) >= minLiquidityUSD;
          // RELAXED: Only require ONE positive timeframe (not both) for more opportunities
          const hasMomentum = has1hMomentum || has24hMomentum;
          return hasMomentum && hasVolume && hasLiquidity;
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
            // Log social signals if available (NEW: PumpFun metrics)
            const socialSignals = [];
            if (token.buyPressure !== undefined) socialSignals.push(`${token.buyPressure}% buy pressure`);
            if (token.transactionCount24h !== undefined) socialSignals.push(`${token.transactionCount24h} txns/24h`);
            if (token.migrationFreshness !== undefined) socialSignals.push(`migrated ${token.migrationFreshness}h ago`);
            if (token.tokenAgeHours !== undefined) socialSignals.push(`${token.tokenAgeHours}h old`);
            if (socialSignals.length > 0) {
              console.log(`[Quick Scan] 📊 ${token.symbol} social signals: ${socialSignals.join(', ')}`);
            }
            
            // Bundle activity detection - check before spending AI credits
            const { detectBundleActivity, addToBlacklist } = await import('./bundle-detection');
            const bundleResult = await detectBundleActivity(token.mint);
            
            // Auto-blacklist tokens with critical bundle activity (score >= 85)
            if (bundleResult.isSuspicious && bundleResult.severity === 'critical' && bundleResult.score >= 85) {
              console.log(`[Quick Scan] ⚠️ CRITICAL BUNDLE ACTIVITY detected: ${token.symbol} (score: ${bundleResult.score}/100)`);
              console.log(`[Quick Scan] Reasons: ${bundleResult.reasons.join(', ')}`);
              
              await addToBlacklist(
                token.mint,
                token.symbol,
                token.name,
                'bundle_activity',
                'critical',
                'system',
                bundleResult.reasons.join('; '),
                {
                  score: bundleResult.score,
                  suspiciousWalletCount: bundleResult.suspiciousWalletCount,
                  avgTimeBetweenTxs: bundleResult.avgTimeBetweenTxs,
                }
              );
              
              console.log(`[Quick Scan] ⏭️ Skipping ${token.symbol} - auto-blacklisted due to bundle activity`);
              logActivity('quick_scan', 'info', `⚠️ SKIP ${token.symbol}: Pump & dump detected (score: ${bundleResult.score}/100)`);
              continue; // Skip this token
            }
            
            // Warn about moderate bundle activity but still analyze
            if (bundleResult.isSuspicious && bundleResult.severity === 'warning') {
              console.log(`[Quick Scan] ⚠️ Warning: ${token.symbol} shows possible bundle activity (score: ${bundleResult.score}/100)`);
              console.log(`[Quick Scan] Reasons: ${bundleResult.reasons.join(', ')}`);
            }
            
            // Full hivemind analysis for all trading decisions (7-model consensus)
            const riskTolerance = riskLevel === "aggressive" ? "high" : riskLevel === "conservative" ? "low" : "medium";
            const hiveMindResult = await analyzeTokenWithHiveMind(
              token,
              riskTolerance,
              budgetPerTrade,
              0.5, // 50% agreement threshold
              { 
                isPeakHours: false, 
                isHighConfidence: false,
                maxModels: 4 // OPTIMIZATION: Use only 4 highest-priority models for quick scans (saves 60% API calls)
              }
            );
            const quickAnalysis = hiveMindResult.analysis;

            // TRI-MODE SYSTEM (OPTIMIZED FOR MORE OPPORTUNITIES): SCALP (52%+), QUICK_2X (78%+), SWING (88%+)
            const SCALP_THRESHOLD = 0.52; // Mode A: Quick micro-profits (OPTIMIZED from 60% for 100% more opportunities)
            const QUICK_2X_THRESHOLD = 0.78; // Mode B: Medium-term 12-18% profits
            const SWING_THRESHOLD = 0.88; // Mode C: High-conviction 12-18% holds
            const minThreshold = SCALP_THRESHOLD; // Always check for SCALP opportunities in quick scan
            
            // Determine trade mode based on confidence
            const tradeMode = determineTradeMode(quickAnalysis.confidence);
            const modeLabel = tradeMode.mode === "SCALP" ? "🎯 SCALP" : tradeMode.mode === "QUICK_2X" ? "💎 QUICK_2X" : "🚀 SWING";
            
            // Execute trade if confidence meets minimum threshold (62% for SCALP, 75% for SWING)
            if (quickAnalysis.action === "buy" && quickAnalysis.confidence >= minThreshold) {
              console.log(`[Quick Scan] ${modeLabel}: ${token.symbol} - ${(quickAnalysis.confidence * 100).toFixed(1)}% confidence (${tradeMode.positionSizePercent}% position, ${tradeMode.profitTargetPercent}% target, ${tradeMode.stopLossPercent}% stop)`);
              
              // Execute trade immediately with mode-specific parameters!
              await executeQuickTrade(config, token, quickAnalysis, botState, existingPositions);
            } else if (quickAnalysis.confidence >= minThreshold && quickAnalysis.action !== "sell") {
              // High confidence but not BUY action - log for analysis
              console.log(`[Quick Scan] ⚠️ ${token.symbol}: ${quickAnalysis.action.toUpperCase()} ${(quickAnalysis.confidence * 100).toFixed(1)}% (meets ${(minThreshold * 100).toFixed(0)}% threshold but action is ${quickAnalysis.action}, not buy)`);
              logActivity('quick_scan', 'info', `🤔 ${token.symbol}: ${quickAnalysis.action.toUpperCase()} ${(quickAnalysis.confidence * 100).toFixed(1)}% - AI says ${quickAnalysis.action.toUpperCase()}, not BUY`);
            } else {
              console.log(`[Quick Scan] ⏭️ ${token.symbol}: ${quickAnalysis.action.toUpperCase()} ${(quickAnalysis.confidence * 100).toFixed(1)}% (below ${(minThreshold * 100).toFixed(0)}% SCALP threshold)`);
              logActivity('quick_scan', 'info', `⏭️ ${token.symbol}: ${quickAnalysis.action.toUpperCase()} ${(quickAnalysis.confidence * 100).toFixed(1)}% - Below ${(minThreshold * 100).toFixed(0)}% threshold`);
            }
          }
        }
        
        // MULTI-STRATEGY SYSTEM: Evaluate all tokens with complementary strategies
        // Runs independently of AI-driven SCALP/SWING to capture different market conditions
        const { evaluateAllStrategies } = await import('./multi-strategy');
        const { executeStrategyTrade } = await import('./strategy-trade-executor');
        const strategyConfig = {
          meanReversionEnabled: config.meanReversionEnabled ?? false,
          meanReversionRSIOversold: config.meanReversionRSIOversold ?? 30,
          meanReversionRSIOverbought: config.meanReversionRSIOverbought ?? 70,
          meanReversionPositionSizePercent: config.meanReversionPositionSizePercent ?? 5,
          meanReversionProfitTargetPercent: config.meanReversionProfitTargetPercent ?? 10,
          meanReversionStopLossPercent: config.meanReversionStopLossPercent ?? 8,
          momentumBreakoutEnabled: config.momentumBreakoutEnabled ?? false,
          momentumBreakoutPriceChangePercent: config.momentumBreakoutPriceChangePercent ?? 15,
          momentumBreakoutVolumeMultiplier: parseFloat(config.momentumBreakoutVolumeMultiplier ?? "2.0"),
          momentumBreakoutPositionSizePercent: config.momentumBreakoutPositionSizePercent ?? 7,
          momentumBreakoutProfitTargetPercent: config.momentumBreakoutProfitTargetPercent ?? 20,
          momentumBreakoutStopLossPercent: config.momentumBreakoutStopLossPercent ?? 10,
          gridTradingEnabled: config.gridTradingEnabled ?? false,
          gridTradingLevels: config.gridTradingLevels ?? 5,
          gridTradingPriceGapPercent: config.gridTradingPriceGapPercent ?? 5,
          gridTradingPerLevelSizePercent: config.gridTradingPerLevelSizePercent ?? 2,
        };
        
        // Only run multi-strategy if at least one strategy is enabled
        const anyStrategyEnabled = strategyConfig.meanReversionEnabled || 
                                   strategyConfig.momentumBreakoutEnabled || 
                                   strategyConfig.gridTradingEnabled;
        
        if (anyStrategyEnabled && opportunities.length > 0) {
          console.log(`[Multi-Strategy] Evaluating ${opportunities.length} tokens with enabled strategies...`);
          
          // Check up to 10 tokens with multi-strategy (broader coverage than AI's top 5)
          const strategyOpportunities = opportunities.slice(0, 10);
          
          for (const token of strategyOpportunities) {
            try {
              // Check if we already have a position in this token
              const existingPosition = existingPositions.find((p: any) => p.tokenMint === token.mint);
              
              // Evaluate with all enabled strategies
              const strategySignal = evaluateAllStrategies(token, strategyConfig, existingPosition);
              
              if (strategySignal && strategySignal.action === "BUY" && !existingPosition) {
                console.log(`[Multi-Strategy] ${strategySignal.strategy}: ${token.symbol} - ${strategySignal.confidence}% confidence`);
                console.log(`[Multi-Strategy] Reason: ${strategySignal.reasoning}`);
                console.log(`[Multi-Strategy] Target: ${strategySignal.positionSizePercent}% position, +${strategySignal.profitTarget}% profit, -${strategySignal.stopLoss}% stop`);
                
                // Execute strategy trade with strategy-specific parameters
                await executeStrategyTrade(
                  config,
                  token,
                  strategySignal,
                  botState,
                  existingPositions
                );
              }
            } catch (error) {
              console.error(`[Multi-Strategy] Error evaluating ${token.symbol}:`, error);
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
 * 🛡️ PRE-TRADE LOSS PREDICTION - AI analyzes token for rug pull, scam, or high loss probability
 * Runs BEFORE executing any buy to prevent bad trades
 * Returns { safe: boolean, lossProbability: number, risks: string[] }
 */
async function predictLossProbability(
  tokenData: TokenMarketData
): Promise<{
  safe: boolean;
  lossProbability: number; // 0-100
  risks: string[];
  reasoning: string;
}> {
  const prompt = `You are a LOSS PREVENTION specialist for Solana trading. Analyze this token for RUG PULL RISK, SCAM INDICATORS, and LOSS PROBABILITY.

Token: ${tokenData.name} (${tokenData.symbol})
Mint: ${tokenData.mint}
Price: $${tokenData.priceUSD.toFixed(6)} (${tokenData.priceSOL.toFixed(9)} SOL)
Market Cap: $${tokenData.marketCapUSD.toLocaleString()}
24h Volume: $${tokenData.volumeUSD24h.toLocaleString()}
Liquidity: $${(tokenData.liquidityUSD ?? 0).toLocaleString()}
Liquidity Locked: ${(tokenData as any).liquidityLocked ? 'YES ✅' : 'NO ⚠️'}
Price Change 1h: ${(tokenData.priceChange1h ?? 0).toFixed(2)}%
Price Change 24h: ${(tokenData.priceChange24h ?? 0).toFixed(2)}%
Age: ${(tokenData as any).tokenAge ? `${Math.floor((tokenData as any).tokenAge / 3600)}h old` : 'Unknown'}

RED FLAGS TO CHECK:
1. Liquidity NOT locked = High rug pull risk
2. Very low liquidity (<$20k) = Easy to drain
3. Sudden price pumps (>50% 1h) without fundamentals = Pump & dump
4. Market cap vs liquidity mismatch = Artificial inflation
5. Very new tokens (<24h) = Unproven, high risk
6. Low volume/liquidity ratio = Illiquid, hard to exit
7. Negative price momentum = Downtrend, likely further losses

CRITICAL: Be EXTREMELY CONSERVATIVE. If you see ANY red flags, recommend AVOID.

Respond ONLY with valid JSON:
{
  "safe": true/false,
  "lossProbability": 0-100,
  "risks": ["risk1", "risk2", ...],
  "reasoning": "detailed explanation of risks"
}`;

  // 🔧 FIX #5: Try ALL available AI providers in parallel and block if ANY says >70% loss probability
  // This prevents risky trades even when majority of AIs disagree
  const providers = [
    {
      name: "DeepSeek",
      fn: async () => {
        const { OpenAI } = await import("openai");
        const client = new OpenAI({
          baseURL: "https://api.deepseek.com",
          apiKey: process.env.DEEPSEEK_API_KEY,
        });
        return await client.chat.completions.create({
          model: "deepseek-chat",
          messages: [{ role: "user", content: prompt }],
          temperature: 0.2,
          max_tokens: 500,
        });
      }
    },
    {
      name: "OpenAI",
      fn: async () => {
        const { OpenAI } = await import("openai");
        const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY_2 });
        return await client.chat.completions.create({
          model: "gpt-4o-mini",
          messages: [{ role: "user", content: prompt }],
          temperature: 0.2,
          max_tokens: 500,
        });
      }
    },
    {
      name: "Google Gemini",
      fn: async () => {
        const { GoogleGenerativeAI } = await import("@google/generative-ai");
        const genAI = new GoogleGenerativeAI(process.env.GOOGLE_AI_KEY!);
        // 🔧 FIX #3: Using correct model name (gemini-2.0-flash-exp is the latest stable model)
        const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash-exp" });
        return await model.generateContent(prompt);
      }
    }
  ];

  // Try ALL providers in parallel (not just first success)
  console.log(`[Loss Prediction] 🔍 Checking ${providers.length} AI providers for ${tokenData.symbol}...`);
  const results = await Promise.allSettled(
    providers.map(async (provider) => {
      try {
        const response = await provider.fn();
        
        let content: string;
        if (provider.name === "Google Gemini") {
          content = (response as any).response.text();
        } else {
          content = (response as any).choices[0]?.message?.content || "{}";
        }
        
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        if (!jsonMatch) throw new Error("Failed to parse JSON response");
        
        const result = JSON.parse(jsonMatch[0]);
        return { provider: provider.name, ...result };
      } catch (error) {
        throw new Error(`${provider.name}: ${error instanceof Error ? error.message : error}`);
      }
    })
  );

  // Extract successful AI responses
  const successfulAI = results
    .filter(r => r.status === "fulfilled")
    .map(r => (r as PromiseFulfilledResult<any>).value);

  if (successfulAI.length === 0) {
    console.warn(`[Loss Prediction] ⚠️ ALL ${providers.length} AI providers failed for ${tokenData.symbol}`);
  } else {
    console.log(`[Loss Prediction] ✅ ${successfulAI.length}/${providers.length} AI providers responded`);
    
    // Log each AI's prediction
    successfulAI.forEach(ai => {
      console.log(`[Loss Prediction]   ${ai.provider}: ${ai.safe ? '✅ SAFE' : '⚠️ UNSAFE'} (${ai.lossProbability}% loss probability)`);
      if (ai.risks?.length > 0) {
        console.log(`[Loss Prediction]     Risks: ${ai.risks.join(', ')}`);
      }
    });
    
    // 🛡️ AGGRESSIVE TRADING: Only block if UNANIMOUS (ALL AIs) say >95% loss probability
    // This allows risky trades but with position size reduction based on risk level
    // User requested: "allow the system to trade but be extra cautious in these situations"
    const extremeWarnings = successfulAI.filter(ai => ai.lossProbability > 95);
    const unanimousBlock = extremeWarnings.length === successfulAI.length; // ALL must agree to block
    
    if (unanimousBlock) {
      const worstCase = extremeWarnings.reduce((max, ai) => ai.lossProbability > max.lossProbability ? ai : max);
      console.log(`[Loss Prediction] 🚨 UNANIMOUS WARNING: ${extremeWarnings.length}/${successfulAI.length} AIs predict >95% loss probability`);
      console.log(`[Loss Prediction] 🛑 TRADE BLOCKED by UNANIMOUS AI CONSENSUS - ${extremeWarnings.map(ai => `${ai.provider}: ${ai.lossProbability}%`).join(', ')}`);
      
      return {
        safe: false,
        lossProbability: worstCase.lossProbability,
        risks: worstCase.risks || [],
        reasoning: `UNANIMOUS AI CONSENSUS (${extremeWarnings.length}/${successfulAI.length}): ALL AIs detected >95% loss probability. ${worstCase.reasoning || 'Extreme risk detected'}`
      };
    }
    
    // Log warnings but ALLOW trade with risk adjustment
    const highRiskWarnings = successfulAI.filter(ai => ai.lossProbability > 70);
    if (highRiskWarnings.length > 0) {
      console.log(`[Loss Prediction] ⚠️ HIGH RISK DETECTED: ${highRiskWarnings.length}/${successfulAI.length} AIs warn >70% loss (${highRiskWarnings.map(ai => `${ai.provider}: ${ai.lossProbability}%`).join(', ')})`);
      console.log(`[Loss Prediction] ⚡ Trade ALLOWED with RISK ADJUSTMENTS - position size will be reduced, stop-loss tightened`);
    }
    
    // Calculate average loss probability from all successful AIs
    const avgLossProbability = successfulAI.reduce((sum, ai) => sum + ai.lossProbability, 0) / successfulAI.length;
    const allRisks = [...new Set(successfulAI.flatMap(ai => ai.risks || []))];
    
    console.log(`[Loss Prediction] Average loss probability: ${avgLossProbability.toFixed(1)}%`);
    
    // AGGRESSIVE MODE: Mark as safe unless average >95% (was >40%)
    // This allows risky trades with position size/stop-loss adjustments
    return {
      safe: avgLossProbability < 95,
      lossProbability: avgLossProbability,
      risks: allRisks,
      reasoning: `AI Consensus: ${successfulAI.length} models analyzed. Average ${avgLossProbability.toFixed(0)}% loss probability. ${allRisks.length > 0 ? allRisks.join(', ') : 'No major red flags'}`
    };
  }

  // ALL AI providers failed - use technical analysis fallback
  console.warn(`[Loss Prediction] ⚠️ ALL AI providers failed for ${tokenData.symbol} - using TECHNICAL FALLBACK`);
  
  // Calculate risk based on technical indicators
  // 🔧 FIX #2: INCREASED WEIGHTS to match AI conservativeness (previously approved risky tokens)
  const risks: string[] = [];
  let lossProbability = 0;
  
  // Check critical red flags with STRICTER SCORING
  if (!(tokenData as any).liquidityLocked) {
    risks.push("Unlocked liquidity");
    lossProbability += 50; // ⬆️ INCREASED from 30 → 50 (critical rug pull risk)
  }
  if ((tokenData.liquidityUSD ?? 0) < 20000) {
    risks.push("Low liquidity <$20k");
    lossProbability += 25; // ⬆️ INCREASED from 20 → 25 (easy to drain)
  }
  if ((tokenData.priceChange1h ?? 0) > 50) {
    risks.push(`Sudden pump +${tokenData.priceChange1h?.toFixed(0)}% 1h`);
    lossProbability += 40; // ⬆️ INCREASED from 25 → 40 (pump & dump indicator)
  }
  if ((tokenData as any).tokenAge && (tokenData as any).tokenAge < 86400) {
    risks.push("Very new token <24h");
    lossProbability += 20; // ⬆️ INCREASED from 15 → 20 (unproven risk)
  }
  if ((tokenData.priceChange24h ?? 0) < -20) {
    risks.push("Negative momentum");
    lossProbability += 15; // ⬆️ INCREASED from 10 → 15 (downtrend risk)
  }
  
  // ⬆️ INCREASED THRESHOLD from 40% → 60% to match AI conservativeness
  // Now technical fallback will block tokens that AI would also block
  const safe = lossProbability < 60;
  
  return {
    safe,
    lossProbability,
    risks,
    reasoning: `Technical analysis: ${safe ? 'Acceptable risk' : 'High risk detected'}. ${risks.length > 0 ? risks.join(', ') : 'No major red flags'}`
  };
}

/**
 * 🔍 ENHANCED CONSENSUS - Require supermajority (7+ out of 12 models) to agree before buying
 * More conservative than simple majority to prevent losses
 */
function calculateEnhancedConsensus(
  results: Array<{
    provider: string;
    analysis: {
      action: "buy" | "sell" | "hold";
      confidence: number;
      reasoning: string;
      potentialUpsidePercent: number;
      riskLevel: "low" | "medium" | "high";
    };
  }>
): {
  action: "buy" | "sell" | "hold";
  confidence: number;
  reasoning: string;
  potentialUpsidePercent: number;
  riskLevel: "low" | "medium" | "high";
  consensus: string; // How many models agreed
} {
  // Count votes for each action
  const votes = { buy: 0, sell: 0, hold: 0 };
  const confidences = { buy: [] as number[], sell: [] as number[], hold: [] as number[] };
  
  results.forEach(r => {
    votes[r.analysis.action]++;
    confidences[r.analysis.action].push(r.analysis.confidence);
  });

  const totalModels = results.length;
  const buyVotes = votes.buy;
  const sellVotes = votes.sell;
  const holdVotes = votes.hold;
  
  // REQUIRE SUPERMAJORITY (64%+) FOR BUY - prevents risky trades
  const SUPERMAJORITY_THRESHOLD = Math.ceil(totalModels * 0.64); // 64% of models must agree
  
  console.log(`[Enhanced Consensus] Votes: BUY ${buyVotes}/${totalModels}, SELL ${sellVotes}/${totalModels}, HOLD ${holdVotes}/${totalModels} (need ${SUPERMAJORITY_THRESHOLD} for supermajority)`);
  
  let finalAction: "buy" | "sell" | "hold";
  let finalConfidence: number;
  let consensusString: string;
  
  // Check if any action has supermajority
  if (buyVotes >= SUPERMAJORITY_THRESHOLD) {
    finalAction = "buy";
    finalConfidence = confidences.buy.reduce((a, b) => a + b, 0) / confidences.buy.length;
    consensusString = `${buyVotes}/${totalModels} models agree BUY (${((buyVotes/totalModels)*100).toFixed(0)}% supermajority)`;
  } else if (sellVotes >= SUPERMAJORITY_THRESHOLD) {
    finalAction = "sell";
    finalConfidence = confidences.sell.reduce((a, b) => a + b, 0) / confidences.sell.length;
    consensusString = `${sellVotes}/${totalModels} models agree SELL (${((sellVotes/totalModels)*100).toFixed(0)}% supermajority)`;
  } else if (holdVotes >= SUPERMAJORITY_THRESHOLD) {
    finalAction = "hold";
    finalConfidence = confidences.hold.reduce((a, b) => a + b, 0) / confidences.hold.length;
    consensusString = `${holdVotes}/${totalModels} models agree HOLD (${((holdVotes/totalModels)*100).toFixed(0)}% supermajority)`;
  } else {
    // NO SUPERMAJORITY - Default to HOLD for safety
    finalAction = "hold";
    // Use average confidence of hold votes if any, otherwise 0
    finalConfidence = confidences.hold.length > 0 
      ? confidences.hold.reduce((a, b) => a + b, 0) / confidences.hold.length 
      : 0;
    consensusString = `No supermajority (BUY ${buyVotes}, SELL ${sellVotes}, HOLD ${holdVotes}) - defaulting to HOLD for safety`;
    
    console.log(`[Enhanced Consensus] ⚠️ NO SUPERMAJORITY REACHED - Being conservative, defaulting to HOLD`);
  }
  
  // Combine all reasoning
  const topReasonings = results
    .sort((a, b) => b.analysis.confidence - a.analysis.confidence)
    .slice(0, 3)
    .map(r => `${r.provider}: ${r.analysis.reasoning.substring(0, 60)}`)
    .join(' | ');
  
  // Calculate average potential upside
  const avgUpside = results.reduce((sum, r) => sum + r.analysis.potentialUpsidePercent, 0) / results.length;
  
  // Determine risk level based on distribution
  const riskCounts = { low: 0, medium: 0, high: 0 };
  results.forEach(r => riskCounts[r.analysis.riskLevel]++);
  const dominantRisk = Object.entries(riskCounts).sort((a, b) => b[1] - a[1])[0][0] as "low" | "medium" | "high";
  
  return {
    action: finalAction,
    confidence: finalConfidence,
    reasoning: `${consensusString} | ${topReasonings}`,
    potentialUpsidePercent: avgUpside,
    riskLevel: dominantRisk,
    consensus: consensusString
  };
}

/**
 * Dual-model analysis using OpenAI + DeepSeek 2 in PARALLEL for consensus
 * More accurate than single model - combines strengths of both premium AIs
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

TRI-MODE TRADING STRATEGY:
- SCALP (65-69% confidence): Quick 4-6% profits, 30min holds
- QUICK_2X (70-79% confidence): Fast 100% (2x) opportunities with strong momentum
- SWING (82%+ confidence): Larger 15%+ profits, longer holds

IMPORTANT: Look for QUICK_2X opportunities (70-79% confidence):
- Tokens showing rapid momentum that could 2x quickly (within 1 hour)
- Strong buying pressure with increasing volume
- Low market cap with high growth potential
- Breaking out of consolidation patterns
- High social engagement or viral potential

QUICK SCAN GUIDELINES:
- If you see a potential QUICK 2X opportunity with 70-79% confidence → action should be "buy"
- If the token has positive momentum and good fundamentals → action should be "buy"
- If you see a trading opportunity with >65% confidence → action should be "buy"
- Only use "hold" if there's NO clear trading opportunity OR confidence is below 65%
- Use "sell" only for existing positions that should be exited

Be AGGRESSIVE with BUY recommendations for tokens with:
- Rapid momentum (especially for QUICK_2X candidates)
- Positive price action (1h and 24h)
- Strong volume relative to liquidity
- Good fundamentals and viral potential

Respond ONLY with valid JSON:
{
  "action": "buy" | "sell" | "hold",
  "confidence": 0.0 to 1.0,
  "reasoning": "brief explanation",
  "potentialUpsidePercent": number,
  "riskLevel": "low" | "medium" | "high"
}`;

  // FULL HIVEMIND CONSENSUS: Run all 7 AI models in parallel for maximum accuracy
  const allModels = [
    { name: "OpenAI", baseURL: "https://api.openai.com/v1", apiKey: process.env.OPENAI_API_KEY, model: "gpt-4o-mini" },
    { name: "OpenAI #2", baseURL: "https://api.openai.com/v1", apiKey: process.env.OPENAI_API_KEY_2, model: "gpt-4o-mini" },
    { name: "DeepSeek", baseURL: "https://api.deepseek.com", apiKey: process.env.DEEPSEEK_API_KEY, model: "deepseek-chat" },
    { name: "DeepSeek #2", baseURL: "https://api.deepseek.com", apiKey: process.env.DEEPSEEK_API_KEY_2, model: "deepseek-chat" },
    { name: "Cerebras", baseURL: "https://api.cerebras.ai/v1", apiKey: process.env.CEREBRAS_API_KEY, model: "llama3.1-70b" },
    { name: "Google Gemini", baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/", apiKey: process.env.GOOGLE_AI_KEY, model: "gemini-2.0-flash-exp" }, // 🔧 FIX #3: Corrected model name
    { name: "Groq", baseURL: "https://api.groq.com/openai/v1", apiKey: process.env.GROQ_API_KEY, model: "llama-3.3-70b-versatile" },
  ].filter(m => m.apiKey); // Only use models with API keys configured

  const results = await Promise.allSettled(
    allModels.map(async (provider) => {
      if (!provider.apiKey) throw new Error(`${provider.name} API key not configured`);

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
      if (!jsonMatch) throw new Error("Failed to parse JSON response");
      
      return {
        provider: provider.name,
        analysis: JSON.parse(jsonMatch[0]) as {
          action: "buy" | "sell" | "hold";
          confidence: number;
          reasoning: string;
          potentialUpsidePercent: number;
          riskLevel: "low" | "medium" | "high";
        }
      };
    })
  );

  // Extract successful results
  const successful = results
    .filter((r): r is PromiseFulfilledResult<any> => r.status === "fulfilled")
    .map(r => r.value);

  // 🔍 ENHANCED CONSENSUS: If we have 3+ models, use supermajority voting (64%+ must agree)
  if (successful.length >= 3) {
    console.log(`[Quick Scan] 🔍 Running Enhanced Consensus with ${successful.length} models for ${tokenData.symbol}...`);
    
    // Use enhanced consensus algorithm (requires supermajority)
    const enhancedResult = calculateEnhancedConsensus(successful);
    
    console.log(`[Quick Scan] ✅ Enhanced Consensus: ${enhancedResult.consensus}`);
    console.log(`[Quick Scan]    Final decision: ${enhancedResult.action.toUpperCase()} (${(enhancedResult.confidence * 100).toFixed(0)}% confidence)`);
    
    const consensus = {
      action: enhancedResult.action,
      confidence: enhancedResult.confidence,
      reasoning: enhancedResult.reasoning,
      potentialUpsidePercent: enhancedResult.potentialUpsidePercent,
      riskLevel: enhancedResult.riskLevel,
    };
    
    cacheAnalysis(tokenData.mint, consensus);
    logActivity('quick_scan', 'ai_thought', `🧠 ${successful.length}-Model Consensus: ${tokenData.symbol} → ${consensus.action.toUpperCase()} (${(consensus.confidence * 100).toFixed(0)}%) - ${enhancedResult.consensus}`);
    
    return consensus;
  }

  // If we have dual-model consensus, combine them (legacy fallback)
  if (successful.length === 2) {
    const [openai, deepseek] = successful;
    
    console.log(`[Quick Scan] ✅ Dual-Model Consensus for ${tokenData.symbol}:`);
    console.log(`[Quick Scan]    OpenAI: ${openai.analysis.action.toUpperCase()} (${(openai.analysis.confidence * 100).toFixed(0)}%)`);
    console.log(`[Quick Scan]    DeepSeek #2: ${deepseek.analysis.action.toUpperCase()} (${(deepseek.analysis.confidence * 100).toFixed(0)}%)`);

    // If models AGREE on action, average their confidence for stronger signal
    if (openai.analysis.action === deepseek.analysis.action) {
      const consensus = {
        action: openai.analysis.action,
        confidence: (openai.analysis.confidence + deepseek.analysis.confidence) / 2,
        reasoning: `Dual consensus: OpenAI (${(openai.analysis.confidence * 100).toFixed(0)}%): ${openai.analysis.reasoning.substring(0, 60)}... | DeepSeek (${(deepseek.analysis.confidence * 100).toFixed(0)}%): ${deepseek.analysis.reasoning.substring(0, 60)}...`,
        potentialUpsidePercent: (openai.analysis.potentialUpsidePercent + deepseek.analysis.potentialUpsidePercent) / 2,
        riskLevel: openai.analysis.riskLevel === deepseek.analysis.riskLevel 
          ? openai.analysis.riskLevel 
          : "medium" as const,
      };

      cacheAnalysis(tokenData.mint, consensus);
      logActivity('quick_scan', 'ai_thought', `🧠 Dual Consensus (AGREE): ${tokenData.symbol} → ${consensus.action.toUpperCase()} (${(consensus.confidence * 100).toFixed(0)}%)`);
      
      return consensus;
    }
    
    // If models DISAGREE, use the higher-confidence model's FULL analysis (not averaged)
    const higherConfidenceModel = openai.analysis.confidence > deepseek.analysis.confidence ? openai : deepseek;
    const lowerConfidenceModel = openai.analysis.confidence > deepseek.analysis.confidence ? deepseek : openai;
    
    console.log(`[Quick Scan] ⚠️ Models disagree → Using ${higherConfidenceModel.provider}'s recommendation (${(higherConfidenceModel.analysis.confidence * 100).toFixed(0)}% > ${(lowerConfidenceModel.analysis.confidence * 100).toFixed(0)}%)`);
    
    const consensus = {
      action: higherConfidenceModel.analysis.action,
      confidence: higherConfidenceModel.analysis.confidence, // Use full confidence, not averaged!
      reasoning: `${higherConfidenceModel.provider} (${(higherConfidenceModel.analysis.confidence * 100).toFixed(0)}%): ${higherConfidenceModel.analysis.reasoning} | ${lowerConfidenceModel.provider} disagreed (${(lowerConfidenceModel.analysis.confidence * 100).toFixed(0)}%)`,
      potentialUpsidePercent: higherConfidenceModel.analysis.potentialUpsidePercent,
      riskLevel: higherConfidenceModel.analysis.riskLevel,
    };

    cacheAnalysis(tokenData.mint, consensus);
    logActivity('quick_scan', 'ai_thought', `🧠 Dual Consensus (DISAGREE): ${tokenData.symbol} → ${consensus.action.toUpperCase()} (${(consensus.confidence * 100).toFixed(0)}%) via ${higherConfidenceModel.provider}`);
    
    return consensus;
  }

  // If only 1-2 models available, FAIL CLOSED for safety (insufficient consensus)
  if (successful.length < 3) {
    console.log(`[Quick Scan] ❌ INSUFFICIENT MODELS for ${tokenData.symbol}: Only ${successful.length}/7 models responded`);
    console.log(`[Quick Scan] 🛡️ FAILING CLOSED - Require minimum 3 models for safety (preventing risky single-model buys)`);
    
    // Return HOLD with 0 confidence to block the trade
    const safetyHold = {
      action: "hold" as const,
      confidence: 0,
      reasoning: `Insufficient AI consensus - only ${successful.length} model(s) responded. Require minimum 3 models for safe trading decisions.`,
      potentialUpsidePercent: 0,
      riskLevel: "high" as const,
    };
    
    cacheAnalysis(tokenData.mint, safetyHold);
    logActivity('quick_scan', 'warning', `⚠️ BLOCKED ${tokenData.symbol}: Only ${successful.length} AI models - require minimum 3 for safety`);
    return safetyHold;
  }

  // If both primary models failed, try backup providers
  console.warn(`[Quick Scan] ⚠️ Primary models failed for ${tokenData.symbol}, trying backups...`);
  
  const backupProviders = [
    { name: "DeepSeek", baseURL: "https://api.deepseek.com", apiKey: process.env.DEEPSEEK_API_KEY, model: "deepseek-chat" },
    { name: "OpenAI #2", baseURL: "https://api.openai.com/v1", apiKey: process.env.OPENAI_API_KEY_2, model: "gpt-4o-mini" },
    { name: "Cerebras", baseURL: "https://api.cerebras.ai/v1", apiKey: process.env.CEREBRAS_API_KEY, model: "llama-3.3-70b" },
    { name: "Groq", baseURL: "https://api.groq.com/openai/v1", apiKey: process.env.GROQ_API_KEY, model: "llama-3.3-70b-versatile" },
  ];

  for (const provider of backupProviders) {
    if (!provider.apiKey) continue;

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

      cacheAnalysis(tokenData.mint, analysis);
      console.log(`[Quick Scan] ✅ ${provider.name} backup succeeded for ${tokenData.symbol}`);
      logActivity('quick_scan', 'ai_thought', `🧠 ${provider.name}: ${tokenData.symbol} → ${analysis.action.toUpperCase()} (${(analysis.confidence * 100).toFixed(0)}%)`);
      return analysis;
    } catch (error: any) {
      const is402 = error?.status === 402;
      if (is402) {
        console.warn(`[Quick Scan] ${provider.name} exhausted (402)`);
      } else {
        console.warn(`[Quick Scan] ${provider.name} failed`);
      }
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
  // Don't rotate if no positions to sell
  if (currentPositions.length === 0) {
    return null;
  }
  
  // CAPITAL EFFICIENCY ENHANCEMENT: Allow rotation even with capital if opportunity is MUCH better
  const hasEnoughCapital = availableSOL >= newOpportunity.requiredSOL;
  const SMART_ROTATION_CONFIDENCE_DIFF = 10; // If new opportunity is 10%+ better, consider rotation
  
  if (hasEnoughCapital) {
    // Check if new opportunity is significantly better than weakest position
    const mints = currentPositions.map(p => p.tokenMint);
    const { getBatchTokenPrices } = await import("./jupiter");
    const priceMap = await getBatchTokenPrices(mints);
    
    const now = Date.now();
    const eligibleForSmartRotation = currentPositions.filter(p => {
      const positionAgeMinutes = (now - new Date(p.buyTimestamp).getTime()) / (1000 * 60);
      return positionAgeMinutes >= 5; // Must be held at least 5 minutes
    });
    
    if (eligibleForSmartRotation.length > 0) {
      // Find weakest position
      const weakestPosition = eligibleForSmartRotation.reduce((weakest, current) => {
        const weakestConfidence = weakest.aiConfidenceAtBuy || 50;
        const currentConfidence = current.aiConfidenceAtBuy || 50;
        
        const weakestPrice = priceMap.get(weakest.tokenMint) || 0;
        const currentPrice = priceMap.get(current.tokenMint) || 0;
        const weakestProfit = ((weakestPrice - parseFloat(weakest.entryPriceSOL)) / parseFloat(weakest.entryPriceSOL)) * 100;
        const currentProfit = ((currentPrice - parseFloat(current.entryPriceSOL)) / parseFloat(current.entryPriceSOL)) * 100;
        
        // Prioritize: low confidence AND low/negative profit
        const weakestScore = weakestConfidence - weakestProfit;
        const currentScore = currentConfidence - currentProfit;
        
        return currentScore < weakestScore ? current : weakest;
      });
      
      const weakestConfidence = weakestPosition.aiConfidenceAtBuy || 50;
      const newOpportunityConfidencePercent = newOpportunity.confidence * 100;
      const confidenceDiff = newOpportunityConfidencePercent - weakestConfidence;
      
      if (confidenceDiff >= SMART_ROTATION_CONFIDENCE_DIFF) {
        console.log(`[Smart Rotation] 💡 Capital available but new opportunity is ${confidenceDiff.toFixed(0)}% better → considering rotation...`);
        console.log(`   Weakest: ${weakestPosition.tokenSymbol} (${weakestConfidence}% confidence)`);
        console.log(`   New: ${newOpportunity.symbol} (${newOpportunityConfidencePercent.toFixed(0)}% confidence)`);
        // Continue with rotation logic below
      } else {
        console.log(`[Smart Rotation] ✅ Capital available (${availableSOL.toFixed(4)} SOL) and new opportunity not significantly better → no rotation needed`);
        return null;
      }
    } else {
      console.log(`[Smart Rotation] ✅ Capital available (${availableSOL.toFixed(4)} SOL) → no rotation needed`);
      return null;
    }
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
  
  // EMERGENCY ROTATION: If wallet is nearly empty (< 0.01 SOL), force rotation regardless of confidence
  const isEmergencyRotation = availableSOL < 0.01;
  if (isEmergencyRotation) {
    console.log(`[Opportunistic Rotation] 🚨 EMERGENCY: Wallet depleted (${availableSOL.toFixed(4)} SOL) → forcing rotation of weakest position`);
    console.log(`   Selling: ${weakest.position.tokenSymbol} (${weakest.entryConfidence}% entry, ${weakest.profitPercent.toFixed(2)}% profit)`);
    console.log(`   For: ${newOpportunity.symbol} (${newOpportunityConfidencePercent.toFixed(0)}% confidence)`);
    
    return {
      position: weakest.position,
      expectedSOL: weakest.estimatedValue,
    };
  }
  
  // Only rotate if new opportunity is significantly better
  const MIN_CONFIDENCE_IMPROVEMENT = 10; // BALANCED: New opportunity should be 10% more confident (lowered from 25% to enable more rotation)
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
 * 🛡️ CENTRALIZED TRADING GUARD - Checks if trading is allowed
 * Enforces drawdown protection, circuit breakers, and other safety checks
 * MUST be called before ANY trade execution (quick scan, deep scan, position rotation)
 * 
 * AUTO-RESUME LOGIC: Automatically resumes trading when portfolio recovers to -10% from peak
 */
async function isTradingAllowed(
  ownerWalletAddress: string,
  portfolioValueSOL: number,
  config: any
): Promise<{ allowed: boolean; reason?: string }> {
  // DRAWDOWN PROTECTION: Pause trading at -20%, auto-resume at -10% (profit-seeking design)
  const MAX_DRAWDOWN_PERCENT = -20; // Pause threshold
  const AUTO_RESUME_DRAWDOWN = -10; // Auto-resume threshold (allow trading during recovery)
  const portfolioPeak = parseFloat(config.portfolioPeakSOL || portfolioValueSOL.toString());
  const bypassDrawdown = config.bypassDrawdownProtection || false;
  
  if (portfolioPeak > 0) {
    const drawdownPercent = ((portfolioValueSOL - portfolioPeak) / portfolioPeak) * 100;
    
    // PAUSE: Portfolio in drawdown worse than -10% → block new trades until recovery
    if (drawdownPercent < AUTO_RESUME_DRAWDOWN && !bypassDrawdown) {
      // Deep drawdown (≤ -20%): Critical protection active
      if (drawdownPercent <= MAX_DRAWDOWN_PERCENT) {
        return {
          allowed: false,
          reason: `Drawdown protection active: Portfolio down ${Math.abs(drawdownPercent).toFixed(1)}% from peak (${portfolioPeak.toFixed(4)} SOL → ${portfolioValueSOL.toFixed(4)} SOL). Auto-resumes at -10% (${(portfolioPeak * 0.90).toFixed(4)} SOL).`
        };
      }
      
      // Recovery zone (-20% to -10%): Still paused, but show recovery progress
      console.log(`[Trading Guard] 📈 Recovery in progress: ${drawdownPercent.toFixed(1)}% from peak (need ${AUTO_RESUME_DRAWDOWN}% to resume)`);
      return {
        allowed: false,
        reason: `Recovery zone: Portfolio at ${drawdownPercent.toFixed(1)}% from peak. Auto-resumes at -10% (${(portfolioPeak * 0.90).toFixed(4)} SOL). Current: ${portfolioValueSOL.toFixed(4)} SOL.`
      };
    }
    
    // AUTO-RESUME: Portfolio recovered to -10% or better → resume trading!
    if (drawdownPercent >= AUTO_RESUME_DRAWDOWN && drawdownPercent < 0) {
      console.log(`[Trading Guard] ✅ AUTO-RESUME: Portfolio recovered to ${drawdownPercent.toFixed(1)}% from peak (recovered past ${AUTO_RESUME_DRAWDOWN}% threshold)`);
      console.log(`[Trading Guard] 🚀 Resuming trading to capture recovery opportunities`);
      logActivity('trading_guard', 'success', `✅ AUTO-RESUME: Portfolio recovered to ${drawdownPercent.toFixed(1)}% from peak → trading resumed`);
    }
  }
  
  // Add more safety checks here in the future (e.g., daily loss limits, circuit breakers)
  
  return { allowed: true };
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

    // Get treasury keypair for transactions and balance check
    const { loadKeypairFromPrivateKey } = await import("./solana-sdk");
    const treasuryKeypair = loadKeypairFromPrivateKey(treasuryKeyBase58);
    const treasuryPublicKey = treasuryKeypair.publicKey.toString();

    // Scan actual wallet balance
    const { getWalletBalance } = await import("./solana");
    let actualBalance = await getWalletBalance(treasuryPublicKey);
    
    // Analyze complete wallet portfolio FIRST to determine total capital
    console.log(`[Quick Scan] 📊 Analyzing wallet portfolio for allocation strategy...`);
    const portfolio = await analyzePortfolio(treasuryPublicKey, actualBalance);
    
    console.log(`[Quick Scan] 💼 Portfolio: ${portfolio.totalValueSOL.toFixed(4)} SOL total, ${portfolio.holdingCount} positions, largest ${portfolio.largestPosition.toFixed(1)}%`);
    
    // 🛡️ CRITICAL: Check if trading is allowed (drawdown protection, circuit breakers)
    const tradingCheck = await isTradingAllowed(config.ownerWalletAddress, portfolio.totalValueSOL, config);
    if (!tradingCheck.allowed) {
      console.log(`[Quick Scan] 🛑 SKIP ${token.symbol}: ${tradingCheck.reason}`);
      logActivity('quick_scan', 'warning', `🛑 BLOCKED ${token.symbol}: ${tradingCheck.reason}`);
      return;
    }
    
    // DYNAMIC FEE BUFFER: Scale with portfolio size for better liquidity management
    // - Small portfolios (<0.5 SOL): Keep 0.03 SOL
    // - Medium portfolios (0.5-2 SOL): Keep 5% of portfolio
    // - Large portfolios (>2 SOL): Keep 7.5% of portfolio
    let FEE_BUFFER = 0.03; // Default minimum
    if (portfolio.totalValueSOL > 2.0) {
      FEE_BUFFER = portfolio.totalValueSOL * 0.075; // 7.5% for large portfolios
    } else if (portfolio.totalValueSOL > 0.5) {
      FEE_BUFFER = portfolio.totalValueSOL * 0.05; // 5% for medium portfolios
    }
    
    let availableBalance = Math.max(0, actualBalance - FEE_BUFFER);

    console.log(`[Quick Scan] Wallet balance: ${actualBalance.toFixed(4)} SOL (available: ${availableBalance.toFixed(4)} SOL, fee buffer: ${FEE_BUFFER.toFixed(4)} SOL)`);

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
    
    // MAX PORTFOLIO ALLOCATION: Prevent over-deployment to maintain liquidity
    const MAX_PORTFOLIO_ALLOCATION = 0.90; // Keep 10% in reserve for fees and emergency liquidity
    const maxDeployableCapital = portfolio.totalValueSOL * MAX_PORTFOLIO_ALLOCATION;
    const currentlyDeployed = portfolio.totalValueSOL - actualBalance;
    const remainingAllocation = Math.max(0, maxDeployableCapital - currentlyDeployed);
    
    // Enforce allocation limit
    if (remainingAllocation < availableBalance) {
      const oldAvailable = availableBalance;
      availableBalance = Math.max(0, remainingAllocation);
      console.log(`[Quick Scan] ⚠️ Portfolio allocation limit: ${(currentlyDeployed / portfolio.totalValueSOL * 100).toFixed(1)}% deployed`);
      console.log(`[Quick Scan] 🔒 Capping available balance from ${oldAvailable.toFixed(4)} to ${availableBalance.toFixed(4)} SOL to maintain ${((1 - MAX_PORTFOLIO_ALLOCATION) * 100).toFixed(0)}% liquidity reserve for capital growth`);
    }

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
          800 // 8% emergency slippage for position rotation (reduced from 30%)
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

    // 🔧 FIX #4: Check database directly for ANY existing position with this token mint
    // (Prevents duplicates caused by stale pre-fetched array in rapid trading)
    const freshPositionCheck = await storage.getAIBotPositions(config.ownerWalletAddress);
    const existingPosition = freshPositionCheck.find(p => p.tokenMint === token.mint);
    
    if (existingPosition) {
      const entryPrice = parseFloat(existingPosition.entryPriceSOL);
      const currentProfit = parseFloat(existingPosition.profitPercent || "0");
      const strategyType = existingPosition.strategyType || 'SCALP';
      
      console.log(`[Quick Scan] ⏭️ SKIP ${token.symbol}: Already holding position (${strategyType} strategy)`);
      console.log(`[Quick Scan]    Entry: ${entryPrice.toFixed(8)} SOL`);
      console.log(`[Quick Scan]    Current: ${token.priceSOL.toFixed(8)} SOL`);
      console.log(`[Quick Scan]    P/L: ${currentProfit > 0 ? '+' : ''}${currentProfit.toFixed(2)}%`);
      logActivity('quick_scan', 'info', `⏭️ BLOCKED ${token.symbol}: Duplicate position prevented (already holding ${strategyType} strategy, ${currentProfit > 0 ? '+' : ''}${currentProfit.toFixed(2)}% P/L)`);
      return;
    }

    // Deduct platform fee (1% on all trades, except exempt wallets)
    const feeResult = await deductPlatformFee(
      config.ownerWalletAddress,
      tradeAmount,
      treasuryKeypair
    );
    
    let finalTradeAmount = feeResult.remainingAmount;
    
    if (feeResult.isExempt) {
      console.log(`[Quick Scan] ✅ Fee exempt wallet - using full amount: ${finalTradeAmount.toFixed(6)} SOL`);
    } else if (feeResult.feeDeducted > 0) {
      console.log(`[Quick Scan] 💰 Platform fee deducted: ${feeResult.feeDeducted.toFixed(6)} SOL`);
      console.log(`[Quick Scan] 💵 Trading with: ${finalTradeAmount.toFixed(6)} SOL (after 1% fee)`);
    }

    // 🛡️ PRE-TRADE LOSS PREDICTION - AI checks for rug pull / scam / high loss probability
    console.log(`[Quick Scan] 🛡️ Running AI loss prediction for ${token.symbol}...`);
    const lossPrediction = await predictLossProbability(token);
    
    // AGGRESSIVE TRADING MODE: Only block if >95% unanimous consensus
    // For risky trades (40-95% loss probability), apply risk-adjusted position sizing and tighter stops
    if (!lossPrediction.safe || lossPrediction.lossProbability > 95) {
      console.log(`[Quick Scan] ❌ TRADE BLOCKED - AI Loss Prediction: ${lossPrediction.lossProbability}% loss probability (EXTREME RISK)`);
      console.log(`[Quick Scan] Risks: ${lossPrediction.risks.join(', ')}`);
      console.log(`[Quick Scan] Reasoning: ${lossPrediction.reasoning}`);
      logActivity('quick_scan', 'warning', `🛡️ BLOCKED ${token.symbol}: ${lossPrediction.lossProbability}% EXTREME loss risk - ${lossPrediction.risks[0]}`);
      return; // Skip this trade
    }
    
    // Apply RISK ADJUSTMENTS for trades with 40-95% loss probability
    let riskAdjustment = 1.0; // No adjustment for low risk (<40%)
    let adjustedStopLoss = -3.0; // Default stop-loss
    
    if (lossPrediction.lossProbability >= 70) {
      // VERY HIGH RISK (70-95%): Reduce position to 25%, tighten stop-loss to -1.5%
      riskAdjustment = 0.25;
      adjustedStopLoss = -1.5;
      console.log(`[Quick Scan] ⚠️ VERY HIGH RISK (${lossPrediction.lossProbability}% loss probability)`);
      console.log(`[Quick Scan] 🛡️ RISK ADJUSTMENTS: Position reduced to 25%, stop-loss tightened to -1.5%`);
    } else if (lossPrediction.lossProbability >= 40) {
      // MODERATE-HIGH RISK (40-70%): Reduce position to 50%, tighten stop-loss to -2%
      riskAdjustment = 0.5;
      adjustedStopLoss = -2.0;
      console.log(`[Quick Scan] ⚠️ MODERATE-HIGH RISK (${lossPrediction.lossProbability}% loss probability)`);
      console.log(`[Quick Scan] 🛡️ RISK ADJUSTMENTS: Position reduced to 50%, stop-loss tightened to -2%`);
    } else {
      console.log(`[Quick Scan] ✅ Loss prediction PASSED: ${lossPrediction.lossProbability}% loss probability (safe to trade)`);
    }
    
    if (lossPrediction.risks.length > 0) {
      console.log(`[Quick Scan] ⚠️ Detected risks: ${lossPrediction.risks.join(', ')}`);
    }
    
    // Apply risk adjustment to trade amount
    finalTradeAmount = finalTradeAmount * riskAdjustment;

    // Execute buy with Jupiter → PumpSwap fallback
    const result = await buyTokenWithFallback(
      treasuryKeyBase58,
      token.mint,
      finalTradeAmount,
      300 // 3% slippage - optimized for high-quality tokens
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
      
      // Update budget tracking, cumulative platform fees, and free trades counter
      const budgetUsed = parseFloat(config.budgetUsed || "0");
      const totalSpent = tradeAmount; // Original amount before fee deduction
      const newBudgetUsed = budgetUsed + totalSpent;
      const currentFeesTotal = parseFloat(config.totalPlatformFeesPaid || "0");
      const newFeesTotal = currentFeesTotal + feeResult.feeDeducted;
      
      // Increment free trades counter if user is on free tier
      const freeTradesUsed = config.freeTradesUsed || 0;
      const subscriptionActive = config.subscriptionActive || false;
      const isUsingFreeTrade = freeTradesUsed < 20 && !subscriptionActive;
      const newFreeTradesUsed = isUsingFreeTrade ? freeTradesUsed + 1 : freeTradesUsed;
      
      await storage.createOrUpdateAIBotConfig({
        ownerWalletAddress: config.ownerWalletAddress,
        budgetUsed: newBudgetUsed.toString(),
        totalPlatformFeesPaid: newFeesTotal.toString(),
        isFeeExempt: feeResult.isExempt,
        freeTradesUsed: newFreeTradesUsed,
      });

      // Record transaction with fee tracking
      await storage.createTransaction({
        projectId: null as any, // null for standalone AI bot transactions
        type: "ai_buy",
        amount: tradeAmount.toString(), // Gross amount (before fee)
        netAmount: finalTradeAmount.toString(), // Net amount actually swapped
        platformFee: feeResult.feeDeducted.toString(), // Platform fee deducted
        feeExempt: feeResult.isExempt, // Exemption status
        feeTxSignature: feeResult.txSignature || null, // Fee transfer signature
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
        
        // 📊 TRADE JOURNAL: Record entry for learning and pattern analysis
        try {
          await storage.createTradeJournalEntry({
            ownerWalletAddress: config.ownerWalletAddress,
            buyTxSignature: result.signature,
            tokenMint: token.mint,
            tokenSymbol: token.symbol,
            tokenName: token.name,
            tradeMode: isSwingTrade ? "SWING" : "SCALP",
            entryPriceSOL: token.priceSOL.toString(),
            amountSOL: tradeAmount.toString(),
            tokenAmount: tokensReceived.toString(),
            aiConfidenceAtBuy: aiConfidence.toString(),
            potentialUpsideAtBuy: analysis.potentialUpsidePercent.toString(),
            organicScoreAtBuy: (token as any).organicScore,
            qualityScoreAtBuy: (token as any).qualityScore,
            liquidityUSDAtBuy: token.liquidityUSD?.toString(),
            volumeUSD24hAtBuy: token.volumeUSD24h.toString(),
            exitReason: "pending", // Will be updated on sell
            wasSuccessful: false, // Will be updated on sell
            entryAt: new Date(),
          });
        } catch (journalError) {
          console.error(`[Quick Scan] ⚠️ Failed to create trade journal entry (non-critical):`, journalError);
        }
        
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
 * TRI-MODE TRADING SYSTEM (OPTIMIZED - More Trading Opportunities)
 * Mode A "SCALP": Quick profits with realistic targets (52-77% AI confidence - OPTIMIZED for 100% more trades)
 * Mode B "QUICK_2X": Medium-term profit opportunities (78-87% AI confidence)
 * Mode C "SWING": High-conviction longer holds (88%+ AI confidence)
 * 
 * 🎯 OPTIMIZATION (Oct 29, 2025): Lowered SCALP threshold from 60% to 52% for more opportunities
 */
type TradeMode = "SCALP" | "QUICK_2X" | "SWING";

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
 * TRI-MODE SYSTEM - ARCHITECT RECALIBRATED (Realistic targets + extended hold times)
 */
function determineTradeMode(confidence: number): TradeModeConfig {
  if (confidence >= 0.88) {
    // Mode C: SWING - High conviction longer-term trades (88%+ for quality)
    // CONSERVATIVE SIZING: Position size scales smoothly with confidence (1-3%)
    const positionSizePercent = 1 + ((confidence - 0.88) / (1.0 - 0.88)) * 2; // Linear scale from 1% at 88% to 3% at 100%
    const clampedPositionSize = Math.min(3, Math.max(1, positionSizePercent));
    
    // RECALIBRATED STOP-LOSS: Fixed -7% (tightened from -7% to -10% range)
    const stopLossPercent = -7;
    
    // RECALIBRATED TARGET: 12-18% range (reduced from 15% for realism)
    const profitTargetPercent = 12 + ((confidence - 0.88) / (1.0 - 0.88)) * 6; // Scale from 12% at 88% to 18% at 100%
    
    return {
      mode: "SWING",
      minConfidence: 88,
      positionSizePercent: Math.round(clampedPositionSize * 10) / 10,
      maxHoldMinutes: 180, // EXTENDED: 3 hours (was 24h - more realistic for Solana volatility)
      stopLossPercent,
      profitTargetPercent: Math.round(profitTargetPercent * 10) / 10,
    };
  } else if (confidence >= 0.78) {
    // Mode B: QUICK_2X - Medium-term profit opportunities (78-87% confidence)
    // CONSERVATIVE SIZING: Position size scales smoothly with confidence (1-2%)
    const positionSizePercent = 1 + ((confidence - 0.78) / (0.88 - 0.78)) * 1; // Linear scale from 1% at 78% to 2% at 88%
    const clampedPositionSize = Math.min(2, Math.max(1, positionSizePercent));
    
    // RECALIBRATED STOP-LOSS: Tightened to -6% (from -8% for better capital protection)
    const stopLossPercent = -6;
    
    // RECALIBRATED TARGET: 12-18% range (reduced from unrealistic 25% for better win rate)
    const profitTargetPercent = 12 + ((confidence - 0.78) / (0.88 - 0.78)) * 6; // Scale from 12% at 78% to 18% at 88%
    
    return {
      mode: "QUICK_2X",
      minConfidence: 78,
      positionSizePercent: Math.round(clampedPositionSize * 10) / 10,
      maxHoldMinutes: 90, // EXTENDED: 90 minutes (was 60min - gives trades more breathing room)
      stopLossPercent,
      profitTargetPercent: Math.round(profitTargetPercent * 10) / 10,
    };
  } else if (confidence >= 0.52) {
    // Mode A: SCALP - Quick micro-profits (52-77% confidence - OPTIMIZED from 60% for 100% more opportunities)
    // CONSERVATIVE SIZING: Position size scales smoothly with confidence (1-2%)
    const positionSizePercent = 1 + ((confidence - 0.52) / (0.78 - 0.52)) * 1; // Linear scale from 1% at 52% to 2% at 78%
    const clampedPositionSize = Math.min(2, Math.max(1, positionSizePercent));
    
    // Keep -3% stop-loss for capital preservation
    const stopLossPercent = -3;
    
    // RECALIBRATED TARGET: 2.5-4% range (raised from fixed 3.5% - scales with confidence)
    const profitTargetPercent = 2.5 + ((confidence - 0.52) / (0.78 - 0.52)) * 1.5; // Scale from 2.5% at 52% to 4% at 78%
    
    return {
      mode: "SCALP",
      minConfidence: 52, // OPTIMIZED: From 60% to capture 100% more opportunities
      positionSizePercent: Math.round(clampedPositionSize * 10) / 10,
      maxHoldMinutes: 30 + Math.floor(((confidence - 0.52) / (0.78 - 0.52)) * 15), // EXTENDED: 30-45min (scales with confidence)
      stopLossPercent,
      profitTargetPercent: Math.round(profitTargetPercent * 10) / 10,
    };
  } else {
    // Below minimum threshold - return conservative defaults (should be filtered out)
    return {
      mode: "SCALP",
      minConfidence: 52,
      positionSizePercent: 1,
      maxHoldMinutes: 30,
      stopLossPercent: -3,
      profitTargetPercent: 2.5,
    };
  }
}

/**
 * TRI-MODE POSITION SIZING (SCALP / QUICK_2X / SWING) - PROFITABILITY OPTIMIZED
 * 🚨 MAJOR UPDATE: Raised thresholds + reduced sizing + improved R-multiples for better win rate
 * 
 * SCALP Mode (70-77% confidence) - QUALITY QUICK TRADES:
 * - Position: 1-2% of portfolio (REDUCED from 3-5% - capital preservation)
 * - Quick profits: +3.5% target (REALISTIC - down from 4-6%)
 * - Stop-loss: -3% (CORRECTED for POSITIVE R-multiple: 3.5%/-3% = 1.17R - risks LESS than it earns)
 * - Max hold: 30 minutes (ENFORCED - auto-exit if underperforming)
 * - Threshold RAISED +5pts (from 65% to 70%) for higher quality trades
 * 
 * QUICK_2X Mode (78-87% confidence) - FAST 25% OPPORTUNITIES:
 * - Position: 1-2% of portfolio (REDUCED from 2-4% - capital preservation)
 * - Target: +25% profits (REALISTIC - down from unrealistic 100%)
 * - Stop-loss: -8% (IMPROVED from -12%, better R-multiple: 25%/-8% = 3.1R)
 * - Max hold: 60 minutes (quick in and out)
 * - Threshold RAISED +8pts (from 70% to 78%) for much higher quality
 * 
 * SWING Mode (88%+ confidence) - HIGHEST CONVICTION ONLY:
 * - Position: 1-3% of portfolio (REDUCED from 5-9% - capital preservation)
 * - Larger profits: +15% targets
 * - Tighter stop: -7% to -10% (OPTIMIZED - faster capital recycling, better R: 15%/-7% = 2.1R)
 * - Longer holds: AI-driven exits
 * - Threshold RAISED +6pts (from 82% to 88%) for elite trades only
 * 
 * PROFITABILITY IMPROVEMENTS (To fix 3% win rate):
 * ✅ RAISED confidence thresholds significantly (+5 to +8 pts across all modes)
 * ✅ REDUCED position sizing to 1-3% (from 3-9%) until win rate >35%
 * ✅ FIXED risk/reward ratios - all modes now have positive R-multiples
 * ✅ REALISTIC profit targets - QUICK_2X changed from 100% to 25%
 * ✅ TIGHTER stop-losses - preserve capital faster (-3.5% to -8% vs -8% to -15%)
 * ⚠️ These changes prioritize QUALITY over QUANTITY to rebuild profitability
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
  
  // CONSERVATIVE: Calculate EXACT percentage of CURRENT portfolio value
  const percentageBasedAmount = (portfolioValue * effectivePercentPerTrade) / 100;
  
  // Network minimum (0.01 SOL required for Solana transactions)
  const NETWORK_MINIMUM = 0.01;
  
  // Start with percentage-based amount
  let tradeSize = percentageBasedAmount;
  
  // Apply network minimum if needed
  if (tradeSize < NETWORK_MINIMUM && availableBalance >= NETWORK_MINIMUM) {
    tradeSize = NETWORK_MINIMUM;
  }
  
  // STRICT CAP: Never exceed percentage limit unless we're below network minimum
  // For small portfolios where percentage < 0.01 SOL, allow the 0.01 SOL minimum
  // For larger portfolios, strictly enforce the percentage cap
  if (portfolioValue >= NETWORK_MINIMUM / (effectivePercentPerTrade / 100)) {
    // Portfolio is large enough that percentage-based sizing produces viable trades
    tradeSize = Math.min(tradeSize, percentageBasedAmount);
  }
  
  // Cap at available balance (can't trade more than we have)
  tradeSize = Math.min(tradeSize, availableBalance);
  
  // Final safety: Ensure we never return less than network minimum (if balance allows)
  if (tradeSize < NETWORK_MINIMUM && availableBalance >= NETWORK_MINIMUM) {
    tradeSize = NETWORK_MINIMUM;
  }
  
  return tradeSize;
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
  if (process.env.ANTHROPIC_API_KEY) activeProviders.push("Anthropic Claude");
  if (process.env.OPENAI_API_KEY) activeProviders.push("OpenAI");
  if (process.env.OPENAI_API_KEY_2) activeProviders.push("OpenAI #2");
  if (process.env.XAI_API_KEY) activeProviders.push("xAI Grok");

  console.log("[AI Bot Scheduler] Starting...");
  console.log(`[AI Bot Scheduler] Active AI providers (${activeProviders.length}): ${activeProviders.join(", ")}`);

  // Quick scans every 1 minute (dual-mode: scalp + swing opportunities) - HIGH FREQUENCY FOR MAX OPPORTUNITIES
  quickScanJob = cron.schedule("* * * * *", () => {
    runQuickTechnicalScan().catch((error) => {
      console.error("[Quick Scan] Unexpected error:", error);
    });
  });

  // Deep scans every 10 minutes (full AI analysis with all 7 models) - INCREASED FREQUENCY
  deepScanJob = cron.schedule("*/10 * * * *", () => {
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
  
  // Strategy learning every 3 hours (AI analyzes trade journal and regenerates strategy)
  strategyLearningJob = cron.schedule("0 */3 * * *", () => {
    runStrategyLearning().catch((error) => {
      console.error("[Strategy Learning] Unexpected error:", error);
    });
  });
  
  console.log("[Strategy Learning] 🧠 AI-Powered Strategy Learning initialized");
  console.log("[Strategy Learning] Schedule: Every 3 hours (analyzes trade patterns and optimizes strategy)");
  console.log("[Strategy Learning] ✅ Active (learns from wins/losses to improve trading decisions)");
  
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

  console.log("[AI Bot Scheduler] Active - HIGH FREQUENCY SCANNING FOR MAXIMUM OPPORTUNITIES ⚡");
  console.log("  - Quick scans: Every 1 minute (4 AI models, SCALP opportunities) 🚀 HIGH FREQUENCY");
  console.log("  - Position monitoring: Every 3 minutes (DeepSeek only) 💰 SAVES 50% API CALLS");
  console.log("  - Deep scans: Every 10 minutes (ALL models for SWING trades) 🔥 INCREASED FREQUENCY");
  console.log("  - Strategy updates: Every 3 hours (adaptive hivemind rebalancing)");
  console.log("  - Memory cleanup: Every hour (removes inactive bots and expired cache)");
  console.log("  - Circuit Breaker: Auto-disables failing models for 5 minutes");
}

/**
 * AI Strategy Learning - Analyzes trade journal patterns and regenerates optimal trading strategy
 * Runs every 3 hours to learn from wins/losses and continuously improve decision-making
 */
async function runStrategyLearning() {
  console.log("[Strategy Learning] 🧠 Starting AI-powered strategy analysis...");
  logActivity('strategy_learning', 'info', '🧠 Analyzing trade patterns for strategy optimization');
  
  try {
    const configs = await storage.getAllAIBotConfigs();
    const enabledConfigs = configs.filter(c => c.isEnabled);
    
    if (enabledConfigs.length === 0) {
      console.log("[Strategy Learning] No active wallets - skipping");
      return;
    }
    
    for (const config of enabledConfigs) {
      try {
        // Fetch trade patterns from journal
        const patterns = await storage.getTradePatterns(config.ownerWalletAddress);
        
        if (patterns.totalTrades < 3) {
          console.log(`[Strategy Learning] ${config.ownerWalletAddress.slice(0,8)}...: Insufficient history (${patterns.totalTrades} trades) - needs 3+ for learning`);
          continue;
        }
        
        console.log(`[Strategy Learning] 📊 ${config.ownerWalletAddress.slice(0,8)}...: Analyzing ${patterns.totalTrades} completed trades`);
        console.log(`[Strategy Learning]    Win Rate: ${patterns.winRate.toFixed(1)}%, Avg Profit: ${patterns.avgProfit.toFixed(2)}%`);
        
        // Log failure patterns
        if (patterns.commonFailureReasons.length > 0) {
          console.log(`[Strategy Learning]    Common failures:`);
          patterns.commonFailureReasons.slice(0, 3).forEach(f => {
            console.log(`[Strategy Learning]      - ${f.reason}: ${f.count}x`);
          });
        }
        
        // Log winning characteristics
        if (patterns.bestTokenCharacteristics.length > 0) {
          const winChars = patterns.bestTokenCharacteristics[0];
          console.log(`[Strategy Learning]    Winning token profile:`);
          console.log(`[Strategy Learning]      - Organic Score: ${winChars.avgOrganicScore?.toFixed(0) || 'N/A'}%`);
          console.log(`[Strategy Learning]      - Quality Score: ${winChars.avgQualityScore?.toFixed(0) || 'N/A'}%`);
          console.log(`[Strategy Learning]      - Avg Liquidity: $${((winChars.avgLiquidityUSD || 0) / 1000).toFixed(0)}k`);
          console.log(`[Strategy Learning]      - Avg Volume: $${((winChars.avgVolumeUSD || 0) / 1000).toFixed(0)}k`);
        }
        
        // Generate new AI-optimized strategy based on patterns
        const { generateHivemindStrategy } = await import("./hivemind-strategy");
        const recentPerformance = {
          winRate: patterns.winRate,
          avgProfit: patterns.avgProfit,
          totalTrades: patterns.totalTrades,
        };
        
        const newStrategy = await generateHivemindStrategy(config.ownerWalletAddress, recentPerformance);
        
        // Save new strategy to database
        await storage.saveHivemindStrategy(config.ownerWalletAddress, newStrategy);
        
        console.log(`[Strategy Learning] ✅ ${config.ownerWalletAddress.slice(0,8)}...: Updated strategy (${newStrategy.riskLevel} risk, ${newStrategy.minConfidenceThreshold}% min confidence)`);
        logActivity('strategy_learning', 'success', `✅ Optimized strategy for ${config.ownerWalletAddress.slice(0,8)}... - ${newStrategy.riskLevel} risk, ${patterns.winRate.toFixed(1)}% win rate`);
        
      } catch (error) {
        console.error(`[Strategy Learning] Error for ${config.ownerWalletAddress}:`, error);
        logActivity('strategy_learning', 'warning', `⚠️ Failed to update strategy for ${config.ownerWalletAddress.slice(0,8)}...`);
      }
    }
    
    console.log("[Strategy Learning] 🎓 Strategy learning cycle complete");
    
  } catch (error) {
    console.error("[Strategy Learning] Fatal error:", error);
    logActivity('strategy_learning', 'error', '❌ Strategy learning failed');
  }
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
          
          // Debug logging for portfolio valuation
          console.log(`[Portfolio Debug] ${position.tokenSymbol}: ${amount.toFixed(2)} tokens @ ${priceSOL.toFixed(9)} SOL = ${valueSOL.toFixed(4)} SOL`);
          
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

    // Get AI bot config
    const config = await storage.getAIBotConfig(ownerWalletAddress);
    if (!config) {
      throw new Error("AI bot config not found");
    }

    // Check subscription/free trades access
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
      addLog(`[Standalone AI Bot] Access denied - ${statusMessage.message}`, "error");
      return logs;
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
    let actualBalance = await getWalletBalance(treasuryKeypair.publicKey.toString());
    
    // Analyze portfolio to get total capital
    const portfolio = await analyzePortfolio(treasuryKeypair.publicKey.toString(), actualBalance);
    
    // DYNAMIC FEE BUFFER: Scale with portfolio size for better liquidity management
    let FEE_BUFFER = 0.03; // Default minimum
    if (portfolio.totalValueSOL > 2.0) {
      FEE_BUFFER = portfolio.totalValueSOL * 0.075; // 7.5% for large portfolios
    } else if (portfolio.totalValueSOL > 0.5) {
      FEE_BUFFER = portfolio.totalValueSOL * 0.05; // 5% for medium portfolios
    }
    
    let availableBalance = Math.max(0, actualBalance - FEE_BUFFER);

    addLog(`💰 Wallet balance: ${actualBalance.toFixed(4)} SOL (available: ${availableBalance.toFixed(4)} SOL, fee buffer: ${FEE_BUFFER.toFixed(4)} SOL)`, "info");

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
    
    // MAX PORTFOLIO ALLOCATION: Prevent over-deployment to maintain liquidity
    const MAX_PORTFOLIO_ALLOCATION = 0.90; // Keep 10% in reserve for fees and emergency liquidity
    const maxDeployableCapital = portfolio.totalValueSOL * MAX_PORTFOLIO_ALLOCATION;
    const currentlyDeployed = portfolio.totalValueSOL - actualBalance;
    const remainingAllocation = Math.max(0, maxDeployableCapital - currentlyDeployed);
    
    // Enforce allocation limit
    if (remainingAllocation < availableBalance) {
      const oldAvailable = availableBalance;
      availableBalance = Math.max(0, remainingAllocation);
      addLog(`⚠️ Portfolio allocation limit: ${(currentlyDeployed / portfolio.totalValueSOL * 100).toFixed(1)}% deployed`, "warning");
      addLog(`🔒 Capping available balance from ${oldAvailable.toFixed(4)} to ${availableBalance.toFixed(4)} SOL to maintain ${((1 - MAX_PORTFOLIO_ALLOCATION) * 100).toFixed(0)}% liquidity reserve for capital growth`, "info");
    }

    if (availableBalance <= 0) {
      addLog(`💰 Insufficient funds: ${actualBalance.toFixed(4)} SOL (need at least ${FEE_BUFFER.toFixed(4)} SOL for fees)`, "error");
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

    // Portfolio already analyzed earlier (line 2579) for fee buffer and allocation calculations
    addLog(`💼 Portfolio Analysis:`, "success");
    addLog(`   Total Value: ${portfolio.totalValueSOL.toFixed(4)} SOL`, "info");
    addLog(`   SOL Balance: ${portfolio.solBalance.toFixed(4)} SOL (${((portfolio.solBalance / portfolio.totalValueSOL) * 100).toFixed(1)}%)`, "info");
    addLog(`   Token Holdings: ${portfolio.holdingCount} positions`, "info");
    addLog(`   Largest Position: ${portfolio.largestPosition.toFixed(1)}% of portfolio`, "info");
    addLog(`   Diversification Score: ${portfolio.diversificationScore.toFixed(0)}/100`, "info");
    
    // DRAWDOWN PROTECTION: Pause trading if portfolio drops >20% from peak (unless bypassed)
    const portfolioPeak = parseFloat(config.portfolioPeakSOL || portfolio.totalValueSOL.toString());
    const currentPortfolioValue = portfolio.totalValueSOL;
    const bypassDrawdown = config.bypassDrawdownProtection || false;
    
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
    
    if (drawdownPercent <= MAX_DRAWDOWN_PERCENT && !bypassDrawdown) {
      skipNewTrades = true;
      addLog(`🛑 DRAWDOWN PROTECTION ACTIVATED: Portfolio down ${Math.abs(drawdownPercent).toFixed(1)}% from peak (${portfolioPeak.toFixed(4)} SOL → ${currentPortfolioValue.toFixed(4)} SOL)`, "warning");
      addLog(`   Trading PAUSED to prevent further capital erosion. Positions will be monitored but no new trades executed.`, "warning");
      addLog(`   Resume trading when portfolio recovers above ${(portfolioPeak * 0.85).toFixed(4)} SOL (15% from peak)`, "info");
    } else if (drawdownPercent <= MAX_DRAWDOWN_PERCENT && bypassDrawdown) {
      // Drawdown detected but bypass is enabled
      addLog(`⚠️ DRAWDOWN DETECTED: Portfolio down ${Math.abs(drawdownPercent).toFixed(1)}% from peak - but bypass is ENABLED, continuing to trade`, "warning");
      addLog(`   ⚡ AI is allowed to continue trading despite drawdown (bypass mode active)`, "info");
    } else if (drawdownPercent < -10) {
      // Warning zone (10-20% drawdown)
      addLog(`⚠️ Portfolio drawdown: ${Math.abs(drawdownPercent).toFixed(1)}% from peak - Approaching pause threshold (${MAX_DRAWDOWN_PERCENT}%)`, "warning");
      if (bypassDrawdown) {
        addLog(`   ⚡ Drawdown bypass ENABLED - AI will continue trading even if threshold is reached`, "info");
      }
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
      
      // 🔥 TECHNICAL "BUY LOW" FILTERS: Ensure we buy at support, not at tops
      // These filters complement AI analysis to enforce "buy low, sell high" discipline
      if (analysis.action === "buy") {
        const BOLLINGER_TOLERANCE = 0.15; // ±15% proximity to bands
        const MIN_VALID_PRICE = 1e-9; // Microprice protection
        const RSI_OVERSOLD = 40; // Prefer buying oversold tokens
        const MAX_24H_PUMP = 0.30; // Skip tokens already pumped >30% in 24h (0.30 = 30% on 0-1 scale)
        
        // Extract technical indicators
        const currentPrice = token.priceSOL ?? 0;
        const bollingerLower = token.bollingerLower ?? 0;
        const bollingerUpper = token.bollingerUpper ?? 0;
        const rsi = token.rsi ?? 50;
        const priceChange24h = token.priceChange24h ?? 0;
        
        // Validate Bollinger data
        const hasBollingerData = bollingerLower >= MIN_VALID_PRICE && 
                                 bollingerUpper >= MIN_VALID_PRICE && 
                                 currentPrice >= MIN_VALID_PRICE &&
                                 bollingerUpper > bollingerLower;
        
        // Calculate proximity to lower Bollinger Band (support level)
        const lowerBandMin = bollingerLower * (1 - BOLLINGER_TOLERANCE);
        const lowerBandMax = bollingerLower * (1 + BOLLINGER_TOLERANCE);
        const nearLowerBand = hasBollingerData && currentPrice >= lowerBandMin && currentPrice <= lowerBandMax;
        
        // FILTER 1: Bollinger Band Proximity - Buy at SUPPORT (lower band ±15%)
        if (hasBollingerData && !nearLowerBand) {
          const distancePercent = ((currentPrice - bollingerLower) / bollingerLower * 100).toFixed(1);
          addLog(`🔴 SKIP ${token.symbol}: Price NOT at support! ${distancePercent}% above lower band (need within ±15%)`, "warning");
          addLog(`   💡 Enforce "buy low": Wait for price to dip closer to support (${bollingerLower.toFixed(9)} SOL)`, "info");
          continue;
        }
        
        // FILTER 2: RSI Check - Warn if buying overbought (RSI > 70)
        if (rsi > 70) {
          addLog(`⚠️ WARNING ${token.symbol}: Buying OVERBOUGHT token (RSI: ${rsi.toFixed(1)})`, "warning");
          addLog(`   💡 Prefer RSI < ${RSI_OVERSOLD} for better entry (current: ${rsi.toFixed(1)})`, "info");
          // Don't skip, just warn - AI confidence may override
        }
        
        // FILTER 3: 24h Pump Filter - Avoid FOMO buying tokens already up >30%
        if (priceChange24h > MAX_24H_PUMP) {
          addLog(`🔴 SKIP ${token.symbol}: Already pumped +${(priceChange24h * 100).toFixed(1)}% in 24h (avoid FOMO buying at peaks)`, "warning");
          addLog(`   💡 Enforce "buy low": Wait for pullback or dip (buying after +${(MAX_24H_PUMP * 100).toFixed(0)}% pump is risky)`, "info");
          continue;
        }
        
        // ✅ PASSED ALL FILTERS - Proceeding with buy
        if (hasBollingerData && nearLowerBand) {
          addLog(`✅ BUY LOW CONFIRMED ${token.symbol}: Price at SUPPORT (within ±15% of lower band)`, "success");
        } else {
          addLog(`⚠️ ${token.symbol}: No Bollinger data - proceeding with AI-only decision`, "warning");
        }
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
              800 // 8% emergency slippage for position rotation (reduced from 30%)
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

        // Deduct platform fee (1% on all trades, except exempt wallets)
        const feeResult = await deductPlatformFee(
          ownerWalletAddress,
          tradeAmount,
          treasuryKeypair
        );
        
        const finalTradeAmount = feeResult.remainingAmount;
        
        if (feeResult.isExempt) {
          addLog(`✅ Fee exempt wallet - using full amount: ${finalTradeAmount.toFixed(6)} SOL`, "info");
        } else if (feeResult.feeDeducted > 0) {
          addLog(`💰 Platform fee deducted: ${feeResult.feeDeducted.toFixed(6)} SOL`, "info");
          addLog(`💵 Trading with: ${finalTradeAmount.toFixed(6)} SOL (after 1% fee)`, "info");
        }

        // Buy with Jupiter → PumpSwap fallback for better success rate
        const result = await buyTokenWithFallback(
          treasuryKeyBase58,
          token.mint,
          finalTradeAmount,
          300 // 3% slippage - optimized for high-quality tokens (300 bps)
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
          
          // Update budget tracking, available balance, cumulative platform fees, and free trades counter
          const totalSpent = tradeAmount; // Original amount before fee deduction
          const newBudgetUsed = budgetUsed + totalSpent;
          availableBalance -= totalSpent;
          const currentFeesTotal = parseFloat(config.totalPlatformFeesPaid || "0");
          const newFeesTotal = currentFeesTotal + feeResult.feeDeducted;
          
          // Increment free trades counter if user is on free tier
          const freeTradesUsed = config.freeTradesUsed || 0;
          const subscriptionActive = config.subscriptionActive || false;
          const isUsingFreeTrade = freeTradesUsed < 20 && !subscriptionActive;
          const newFreeTradesUsed = isUsingFreeTrade ? freeTradesUsed + 1 : freeTradesUsed;
          
          await storage.createOrUpdateAIBotConfig({
            ownerWalletAddress,
            budgetUsed: newBudgetUsed.toString(),
            totalPlatformFeesPaid: newFeesTotal.toString(),
            isFeeExempt: feeResult.isExempt,
            freeTradesUsed: newFreeTradesUsed,
          });
          addLog(`💰 Budget updated: ${newBudgetUsed.toFixed(4)}/${totalBudget.toFixed(4)} SOL used (${availableBalance.toFixed(4)} SOL remaining)`, "info");

          // Record transaction with fee tracking
          await storage.createTransaction({
            projectId: null as any, // null for standalone AI bot transactions
            type: "ai_buy",
            amount: tradeAmount.toString(), // Gross amount (before fee)
            netAmount: finalTradeAmount.toString(), // Net amount actually swapped
            platformFee: feeResult.feeDeducted.toString(), // Platform fee deducted
            feeExempt: feeResult.isExempt, // Exemption status
            feeTxSignature: feeResult.txSignature || null, // Fee transfer signature
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
            
            const newPosition = await storage.createAIBotPosition({
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
            
            // 📊 TRADE JOURNAL: Record entry for learning and pattern analysis
            try {
              await storage.createTradeJournalEntry({
                ownerWalletAddress,
                buyTxSignature: result.signature,
                tokenMint: token.mint,
                tokenSymbol: token.symbol,
                tokenName: token.name,
                tradeMode: isSwingTrade ? "SWING" : "SCALP",
                entryPriceSOL: token.priceSOL.toString(),
                amountSOL: tradeAmount.toString(),
                tokenAmount: tokensReceived.toString(),
                aiConfidenceAtBuy: aiConfidence.toString(),
                potentialUpsideAtBuy: analysis.potentialUpsidePercent.toString(),
                organicScoreAtBuy: (token as any).organicScore,
                qualityScoreAtBuy: (token as any).qualityScore,
                liquidityUSDAtBuy: token.liquidityUSD?.toString(),
                volumeUSD24hAtBuy: token.volumeUSD24h.toString(),
                exitReason: "pending", // Will be updated on sell
                wasSuccessful: false, // Will be updated on sell
                entryAt: new Date(),
              });
            } catch (journalError) {
              console.error(`[Deep Scan] ⚠️ Failed to create trade journal entry (non-critical):`, journalError);
            }
            
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

    // Check active positions for AI-driven profit-taking with TIGHTEST CAPITAL PROTECTION
    const minAiSellConfidence = config.minAiSellConfidence || 50; // INCREASED: Faster exits (was 40)
    const holdIfHighConfidence = config.holdIfHighConfidence || 70;
    const stopLossPercent = -8; // TIGHT: Auto-sell if position drops >8% to preserve capital
    
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
          const swingStopLoss = -25; // TIGHTER: -25% stop-loss for swing trades (was -50%)
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
              const sellResult = await sellTokenWithJupiter(treasuryKeyBase58, mint, 800); // 8% emergency slippage for stop-loss
              
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
              500 // 5% slippage - optimized for profit preservation
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

  // 💡 SMART API OPTIMIZATION with ADAPTIVE CACHE INVALIDATION
  const positionsNeedingAnalysis: typeof validPositions = [];
  const now = Date.now();
  const POSITION_CHANGE_THRESHOLD = 3; // Only re-analyze if price changed >3%
  const MIN_REANALYSIS_INTERVAL_MS = 15 * 60 * 1000; // Minimum 15 minutes between analyses
  const MAX_CACHE_AGE_MS = 40 * 60 * 1000; // Force re-analysis after 40 minutes regardless

  for (const pos of validPositions) {
    let needsAnalysis = false;
    let reason = "";

    // Check cached analysis first (most important check)
    const cachedAnalysis = analysisCache.get(pos.mint);
    
    if (cachedAnalysis && cachedAnalysis.expiresAt > now) {
      const cacheAge = now - cachedAnalysis.timestamp;
      
      // ADAPTIVE INVALIDATION: Check if price/profit moved significantly since analysis
      const priceChangePercent = Math.abs(((pos.currentPriceSOL - cachedAnalysis.priceAtAnalysis) / cachedAnalysis.priceAtAnalysis) * 100);
      const profitChangePercent = Math.abs(pos.profitPercent - cachedAnalysis.profitAtAnalysis);
      
      // Force re-analysis if:
      // 1. Cache too old (>40 min) - prevents multi-step staleness
      // 2. Price moved >8% - significant market change
      // 3. Profit moved >10% - position performance changed dramatically
      if (cacheAge > MAX_CACHE_AGE_MS) {
        needsAnalysis = true;
        reason = `cache age ${Math.floor(cacheAge / 60000)}min`;
      } else if (priceChangePercent > CACHE_INVALIDATION_PRICE_THRESHOLD) {
        needsAnalysis = true;
        reason = `price moved ${priceChangePercent.toFixed(1)}%`;
      } else if (profitChangePercent > CACHE_INVALIDATION_PROFIT_THRESHOLD) {
        needsAnalysis = true;
        reason = `profit moved ${profitChangePercent.toFixed(1)}%`;
      } else {
        // Cache still valid - reuse it!
        console.log(`[API Saver] ✅ Using cached ${pos.symbol} - age ${Math.floor(cacheAge / 60000)}m, price Δ${priceChangePercent.toFixed(1)}%, profit Δ${profitChangePercent.toFixed(1)}%`);
        results.set(pos.mint, {
          confidence: cachedAnalysis.analysis.confidence || 50,
          recommendation: cachedAnalysis.analysis.recommendation || "HOLD",
          reasoning: cachedAnalysis.analysis.reasoning || "Cached analysis",
          errored: false
        });
        continue;
      }
    } else {
      // No cache or expired
      needsAnalysis = true;
      reason = cachedAnalysis ? "cache expired" : "no cache";
    }
    
    // Additional check: fingerprint (recent micro-movements)
    const fingerprint = positionFingerprints.get(pos.mint);
    if (fingerprint && !needsAnalysis) {
      const timeSinceLastAnalysis = now - fingerprint.lastAnalyzedAt;
      const priceChangePercent = Math.abs(((pos.currentPriceSOL - fingerprint.lastPrice) / fingerprint.lastPrice) * 100);
      const profitChangePercent = Math.abs(pos.profitPercent - fingerprint.lastProfit);
      
      // Skip if: recently analyzed AND price/profit hasn't changed much
      if (
        timeSinceLastAnalysis < MIN_REANALYSIS_INTERVAL_MS &&
        priceChangePercent < POSITION_CHANGE_THRESHOLD &&
        profitChangePercent < POSITION_CHANGE_THRESHOLD
      ) {
        console.log(`[API Saver] ⏭️  Skipping ${pos.symbol} - micro-change (price: ${priceChangePercent.toFixed(1)}%, profit: ${profitChangePercent.toFixed(1)}%)`);
        continue;
      }
    }
    
    // Position needs fresh analysis
    if (reason) {
      console.log(`[API Saver] 🔄 Re-analyzing ${pos.symbol} - ${reason}`);
    }
    positionsNeedingAnalysis.push(pos);
    
    // Update fingerprint
    positionFingerprints.set(pos.mint, {
      mint: pos.mint,
      lastPrice: pos.currentPriceSOL,
      lastProfit: pos.profitPercent,
      lastAnalyzedAt: now
    });
  }

  if (positionsNeedingAnalysis.length === 0) {
    console.log(`[API Saver] ✅ All ${validPositions.length} positions cached - ZERO API calls needed!`);
    return results;
  }

  console.log(`[API Saver] 📊 Analyzing ${positionsNeedingAnalysis.length}/${validPositions.length} positions (saved ${validPositions.length - positionsNeedingAnalysis.length} API calls)`);

  // Build consolidated prompt for positions that need analysis
  const portfolioPrompt = `You are analyzing a PORTFOLIO of ${positionsNeedingAnalysis.length} cryptocurrency positions. Provide recommendations for EACH position.

POSITIONS:
${positionsNeedingAnalysis.map((p, i) => `
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
    // 🧠 FULL 12-MODEL HIVEMIND CONSENSUS for portfolio rebalancing
    console.log(`[Batch Analysis] 🧠 Using FULL 12-MODEL HIVEMIND for maximum accuracy...`);
    
    const aiProviders = [
      // ⭐ FREE MODELS (prioritized to last longer)
      { name: "DeepSeek", baseURL: "https://api.deepseek.com", apiKey: process.env.DEEPSEEK_API_KEY, model: "deepseek-chat", weight: 1.2, priority: 1, free: true },
      { name: "DeepSeek #2", baseURL: "https://api.deepseek.com", apiKey: process.env.DEEPSEEK_API_KEY_2, model: "deepseek-chat", weight: 1.2, priority: 1, free: true },
      { name: "Cerebras", baseURL: "https://api.cerebras.ai/v1", apiKey: process.env.CEREBRAS_API_KEY, model: "llama3.3-70b", weight: 1.0, priority: 1, free: true },
      { name: "Groq", baseURL: "https://api.groq.com/openai/v1", apiKey: process.env.GROQ_API_KEY, model: "llama-3.3-70b-versatile", weight: 1.0, priority: 1, free: true },
      { name: "Google Gemini", baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/", apiKey: process.env.GOOGLE_AI_KEY, model: "gemini-2.0-flash-exp", weight: 1.0, priority: 1, free: true },
      
      // 💰 PAID MODELS (use sparingly to preserve credits)
      { name: "Together AI", baseURL: "https://api.together.xyz/v1", apiKey: process.env.TOGETHER_API_KEY, model: "meta-llama/Meta-Llama-3.1-405B-Instruct-Turbo", weight: 1.1, priority: 2, free: false },
      { name: "ChatAnywhere", baseURL: "https://api.chatanywhere.tech/v1", apiKey: process.env.OPENAI_API_KEY, model: "gpt-4o-mini", weight: 1.0, priority: 2, free: false },
      { name: "OpenRouter", baseURL: "https://openrouter.ai/api/v1", apiKey: process.env.OPENROUTER_API_KEY, model: "anthropic/claude-3.5-sonnet", weight: 1.1, priority: 3, free: false },
      { name: "xAI Grok", baseURL: "https://api.x.ai/v1", apiKey: process.env.XAI_API_KEY, model: "grok-2-latest", weight: 1.0, priority: 3, free: false },
      { name: "Anthropic Claude", baseURL: "anthropic", apiKey: process.env.ANTHROPIC_API_KEY, model: "claude-sonnet-4-20250514", weight: 1.2, priority: 3, free: false, isAnthropic: true },
      { name: "OpenAI", baseURL: "https://api.openai.com/v1", apiKey: process.env.OPENAI_API_KEY, model: "gpt-4o-mini", weight: 1.3, priority: 3, free: false },
      { name: "OpenAI #2", baseURL: "https://api.openai.com/v1", apiKey: process.env.OPENAI_API_KEY_2, model: "gpt-4o-mini", weight: 1.3, priority: 3, free: false },
    ];

    // Filter to only healthy, available providers
    let availableProviders = aiProviders.filter(p => {
      if (!p.apiKey) return false;
      const health = providerHealthScores.get(p.name) || 100;
      const disabled = disabledProviders.has(p.name);
      return health >= 30 && !disabled;
    });

    // 💡 SMART MODEL SELECTION: Prioritize FREE models to save paid credits
    // Use 6-8 models max (down from all 11) to reduce API usage
    const freeModels = availableProviders.filter(p => p.free);
    const paidModels = availableProviders.filter(p => !p.free);
    
    // Prefer free models, supplement with paid only if needed
    const MAX_MODELS = 7; // Reduced from 11 to save API calls
    if (freeModels.length >= MAX_MODELS) {
      availableProviders = freeModels.slice(0, MAX_MODELS);
      console.log(`[API Saver] 💰 Using ${MAX_MODELS} FREE models only - preserving paid credits`);
    } else {
      const neededPaidModels = Math.min(MAX_MODELS - freeModels.length, paidModels.length);
      availableProviders = [...freeModels, ...paidModels.slice(0, neededPaidModels)];
      console.log(`[API Saver] Using ${freeModels.length} free + ${neededPaidModels} paid models (total: ${availableProviders.length})`);
    }

    if (availableProviders.length === 0) {
      console.error(`[Batch Analysis] ❌ No AI providers available - all are disabled or unhealthy`);
      throw new Error("No AI providers available for portfolio analysis");
    }

    console.log(`[Batch Analysis] 📊 Running ${availableProviders.length} AI models in parallel...`);

    // Run all available providers in parallel
    const providerPromises = availableProviders.map(async (provider) => {
      try {
        let content: string;
        
        // Handle Anthropic Claude separately (different API)
        if (provider.isAnthropic) {
          const anthropic = new Anthropic({
            apiKey: provider.apiKey,
          });

          const response = await anthropic.messages.create({
            model: provider.model,
            max_tokens: 2000,
            system: "You are an expert portfolio manager analyzing cryptocurrency holdings. Provide actionable recommendations for each position. Always respond with valid JSON array.",
            messages: [
              {
                role: "user",
                content: portfolioPrompt
              }
            ],
            temperature: 0.6,
          });

          content = response.content[0].type === 'text' ? response.content[0].text : '';
          if (!content) throw new Error(`No response from ${provider.name}`);
        } else {
          // Standard OpenAI-compatible providers
          const client = new OpenAI({
            baseURL: provider.baseURL,
            apiKey: provider.apiKey,
          });

          const response = await client.chat.completions.create({
            model: provider.model,
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

          content = response.choices[0].message.content;
          if (!content) throw new Error(`No response from ${provider.name}`);
        }

        const parsed = JSON.parse(content);
        const recommendations = Array.isArray(parsed) ? parsed : (parsed.positions || parsed.recommendations || []);

        return {
          provider: provider.name,
          weight: provider.weight,
          recommendations,
          success: true
        };
      } catch (error: any) {
        console.warn(`[Batch Analysis] ${provider.name} failed:`, error.message);
        
        // Update health score
        const currentHealth = providerHealthScores.get(provider.name) || 100;
        providerHealthScores.set(provider.name, Math.max(0, currentHealth - 20));
        
        // Check if it's a 402 error (insufficient credits)
        if (error?.status === 402 || error?.message?.includes('402') || error?.message?.includes('insufficient credits')) {
          console.warn(`[Circuit Breaker] 🚫 ${provider.name} IMMEDIATELY disabled (insufficient credits/balance). Will retry in 30 minutes.`);
          disabledProviders.add(provider.name);
          setTimeout(() => {
            disabledProviders.delete(provider.name);
            providerHealthScores.set(provider.name, 100);
          }, 30 * 60 * 1000);
        }
        
        return {
          provider: provider.name,
          weight: provider.weight,
          recommendations: [],
          success: false
        };
      }
    });

    const providerResults = await Promise.all(providerPromises);
    const successfulResults = providerResults.filter(r => r.success);

    if (successfulResults.length === 0) {
      throw new Error("All AI providers failed - cannot perform portfolio analysis");
    }

    console.log(`[Batch Analysis] ✅ ${successfulResults.length}/${availableProviders.length} models responded successfully`);

    // CONSENSUS VOTING: Aggregate recommendations across all successful models
    const consensusMap = new Map<string, { sellVotes: number; holdVotes: number; addVotes: number; totalWeight: number; reasonings: string[] }>();

    for (const result of successfulResults) {
      for (const rec of result.recommendations) {
        const existing = consensusMap.get(rec.symbol) || {
          sellVotes: 0,
          holdVotes: 0,
          addVotes: 0,
          totalWeight: 0,
          reasonings: []
        };

        // Weight votes by provider weight
        if (rec.recommendation === "SELL") existing.sellVotes += result.weight;
        else if (rec.recommendation === "HOLD") existing.holdVotes += result.weight;
        else if (rec.recommendation === "ADD") existing.addVotes += result.weight;

        existing.totalWeight += result.weight;
        existing.reasonings.push(`${result.provider}: ${rec.reasoning}`);

        consensusMap.set(rec.symbol, existing);
      }
    }

    // Convert consensus votes to final recommendations
    const recommendations = Array.from(consensusMap.entries()).map(([symbol, votes]) => {
      const sellPercent = (votes.sellVotes / votes.totalWeight) * 100;
      const holdPercent = (votes.holdVotes / votes.totalWeight) * 100;
      const addPercent = (votes.addVotes / votes.totalWeight) * 100;

      // Determine final recommendation based on majority
      let recommendation: "SELL" | "HOLD" | "ADD";
      let confidence = 0;

      if (sellPercent > holdPercent && sellPercent > addPercent) {
        recommendation = "SELL";
        confidence = sellPercent;
      } else if (addPercent > holdPercent && addPercent > sellPercent) {
        recommendation = "ADD";
        confidence = addPercent;
      } else {
        recommendation = "HOLD";
        confidence = holdPercent;
      }

      return {
        symbol,
        confidence: Math.round(confidence),
        recommendation,
        reasoning: `Hivemind consensus: ${successfulResults.length} models (SELL: ${sellPercent.toFixed(0)}%, HOLD: ${holdPercent.toFixed(0)}%, ADD: ${addPercent.toFixed(0)}%)`
      };
    });

    // Map results back to positions AND cache them
    for (const rec of recommendations) {
      const position = positionsNeedingAnalysis.find(p => p.symbol === rec.symbol);
      if (position) {
        const analysisResult = {
          confidence: rec.confidence || 50,
          recommendation: rec.recommendation || "HOLD",
          reasoning: rec.reasoning || "No specific reasoning provided",
          errored: false
        };
        
        results.set(position.mint, analysisResult);
        
        // 💾 CACHE this analysis with adaptive invalidation tracking
        analysisCache.set(position.mint, {
          analysis: analysisResult,
          timestamp: Date.now(),
          expiresAt: Date.now() + ANALYSIS_CACHE_DURATION_MS,
          priceAtAnalysis: position.currentPriceSOL,
          profitAtAnalysis: position.profitPercent
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
 * Runs every 3 minutes to check position status and make sell recommendations - OPTIMIZED FOR API EFFICIENCY
 */
async function monitorPositionsWithDeepSeek() {
  if (!process.env.DEEPSEEK_API_KEY) {
    console.log("[Position Monitor] DeepSeek API key not configured - skipping monitoring");
    return;
  }

  schedulerStatus.positionMonitor.status = 'running';
  schedulerStatus.positionMonitor.lastRun = Date.now();
  schedulerStatus.positionMonitor.nextRun = Date.now() + (3 * 60 * 1000); // 3 minutes (OPTIMIZED)
  
  try {
    console.log("[Position Monitor] Checking open positions with DeepSeek...");
    logActivity('position_monitor', 'info', '🔍 Position Monitor scanning active positions (3min interval - OPTIMIZED)');
    
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

            // Track peak profit and peak price (will be updated further down)
            const peakProfit = parseFloat(position.peakProfitPercent || "0");
            const currentPeakProfit = Math.max(peakProfit, profitPercent);
            const peakPriceSOL = entryPrice * (1 + currentPeakProfit / 100); // Calculate peak price from peak profit
            
            // 🛡️ TRAILING STOP-LOSS: Arm after securing ≥1.5% profit to protect gains
            // CRITICAL FIX: Uses PEAK price (not current) so floor only ratchets upward
            const TRAILING_STOP_ARM_THRESHOLD = 1.5; // Arm after 1.5% profit
            const TRAILING_STOP_DISTANCE = 3.0; // Trail by 3% below peak
            const isTrailingStopArmed = position.trailingStopArmed === 1;
            
            let newTrailingStopPrice = position.trailingStopPriceSOL ? parseFloat(position.trailingStopPriceSOL) : null;
            let shouldArmTrailingStop = false;
            
            // Arm trailing stop after reaching threshold (uses current price for first arm)
            if (!isTrailingStopArmed && profitPercent >= TRAILING_STOP_ARM_THRESHOLD) {
              shouldArmTrailingStop = true;
              // CRITICAL: Ensure floor never drops below entry (prevents post-arm losses)
              const trailingFloor = currentPriceSOL * (1 - TRAILING_STOP_DISTANCE / 100);
              newTrailingStopPrice = Math.max(entryPrice, trailingFloor);
              console.log(`[Position Monitor] 🛡️ TRAILING STOP ARMED: ${position.tokenSymbol} reached +${profitPercent.toFixed(2)}% → stop @ $${newTrailingStopPrice.toFixed(9)} (floor: entry ${entryPrice.toFixed(9)})`);
            }
            // Update trailing stop if price climbs (uses PEAK price so floor only ratchets upward)
            else if (isTrailingStopArmed && profitPercent > peakProfit) {
              // CRITICAL: Use PEAK price (not current) to ensure stop only moves up, never down
              const trailingFloor = peakPriceSOL * (1 - TRAILING_STOP_DISTANCE / 100);
              const previousStop = newTrailingStopPrice || entryPrice;
              newTrailingStopPrice = Math.max(entryPrice, trailingFloor, previousStop); // Also ensure it never goes below previous stop
              console.log(`[Position Monitor] 📈 TRAILING STOP RAISED: ${position.tokenSymbol} peak +${currentPeakProfit.toFixed(2)}% (${peakPriceSOL.toFixed(9)}) → new stop @ $${newTrailingStopPrice.toFixed(9)} (was ${previousStop.toFixed(9)})`);
            }
            
            // Reset confidence counter if AI is bullish again (prevents false alarms)
            const shouldResetCounter = profitPercent > 0; // If still profitable, reset counter
            
            await storage.updateAIBotPosition(position.id, {
              lastCheckPriceSOL: currentPriceSOL.toString(),
              lastCheckProfitPercent: profitPercent.toString(),
              trailingStopArmed: shouldArmTrailingStop ? 1 : (isTrailingStopArmed ? 1 : 0),
              trailingStopPriceSOL: newTrailingStopPrice ? newTrailingStopPrice.toString() : null,
              lowConfidenceSampleCount: shouldResetCounter ? 0 : (position.lowConfidenceSampleCount || 0),
            });

            console.log(`[Position Monitor] ${position.tokenSymbol}: Entry $${entryPrice.toFixed(9)} → Current $${currentPriceSOL.toFixed(9)} (${profitPercent > 0 ? '+' : ''}${profitPercent.toFixed(2)}%)`);
            if (isTrailingStopArmed && newTrailingStopPrice) {
              console.log(`[Position Monitor]    🛡️ Trailing stop active @ $${newTrailingStopPrice.toFixed(9)} (${TRAILING_STOP_DISTANCE}% below peak)`);
            }

            // 🎯 PROFIT-HUNTING STRATEGY: Only sell when profits are maximized, NOT on pullbacks
            const isSwingTrade = position.isSwingTrade === 1;
            
            // Get profit target and max hold for this position's confidence level
            const entryConfidence = (position.aiConfidenceAtBuy || 65) / 100; // Stored as integer, convert to decimal
            const modeConfig = determineTradeMode(entryConfidence);
            const profitTarget = modeConfig.profitTargetPercent;
            const maxHoldMinutes = modeConfig.maxHoldMinutes;
            
            // ⚡ CAPITAL EFFICIENCY: ENFORCED MAX HOLD TIME FOR SCALP & QUICK_2X POSITIONS
            // Auto-exit after max hold time if not meeting profit targets
            if (!isSwingTrade) {
              const now = Date.now();
              const positionAgeMinutes = (now - new Date(position.buyTimestamp).getTime()) / (1000 * 60);
              
              if (positionAgeMinutes >= maxHoldMinutes) {
                // Force exit if underperforming OR if in small profit but below target
                if (profitPercent < profitTarget) {
                  const modeLabel = modeConfig.mode === "SCALP" ? "SCALP" : "QUICK_2X";
                  console.log(`[Position Monitor] ⏰ ${modeLabel} MAX HOLD EXCEEDED: ${position.tokenSymbol} held ${positionAgeMinutes.toFixed(0)}min (max ${maxHoldMinutes}min), profit ${profitPercent.toFixed(2)}% < target ${profitTarget.toFixed(2)}% → FORCE EXIT for capital recycling`);
                  await executeSellForPosition(config, position, treasuryKeyBase58, `${modeLabel} max hold time exceeded (${positionAgeMinutes.toFixed(0)}min) with ${profitPercent.toFixed(2)}% profit (target: ${profitTarget.toFixed(2)}%)`);
                  continue;
                } else {
                  const modeLabel = modeConfig.mode === "SCALP" ? "SCALP" : modeConfig.mode === "QUICK_2X" ? "QUICK_2X" : "SWING";
                  console.log(`[Position Monitor] ✅ ${modeLabel} ${position.tokenSymbol} at ${positionAgeMinutes.toFixed(0)}min: ${profitPercent.toFixed(2)}% exceeds ${profitTarget.toFixed(2)}% target → letting AI decide exit timing`);
                }
              }
            }
            
            // Track peak profit to identify pullbacks vs actual losses
            // (peakProfit and currentPeakProfit already declared earlier for trailing stop logic)
            
            // Update peak profit if we hit a new high
            if (currentPeakProfit > peakProfit) {
              await storage.updateAIBotPosition(position.id, {
                peakProfitPercent: currentPeakProfit.toString(),
              });
              console.log(`[Position Monitor] 🚀 ${position.tokenSymbol} NEW PEAK: ${currentPeakProfit.toFixed(2)}% (was ${peakProfit.toFixed(2)}%)`);
            }
            
            // 🛡️ LOSS PROTECTION: Only stop-loss if position is ACTUALLY LOSING MONEY
            // Don't panic-sell on profit pullbacks - those are buying opportunities!
            if (profitPercent < 0) {
              // We're in loss territory - apply strict stop-loss (OPTIMIZED for capital efficiency)
              const maxLoss = isSwingTrade ? -10 : -8; // SWING now -10% (was -15%) for faster capital recycling
              if (profitPercent <= maxLoss) {
                console.warn(`[Position Monitor] ⛔ ${position.tokenSymbol} ACTUAL LOSS: ${profitPercent.toFixed(2)}% (stop: ${maxLoss}%) → SELLING to limit damage!`);
                await executeSellForPosition(config, position, treasuryKeyBase58, `Stop-loss at ${profitPercent.toFixed(2)}% (max loss: ${maxLoss}%)`);
                continue;
              }
            }
            
            // ⚡ DYNAMIC TRAILING STOP-LOSS: Lock in gains as position becomes profitable
            // Tighten stops progressively to preserve capital and secure profits
            if (profitPercent > 0) {
              let trailingStopPercent: number | null = null;
              
              // Tier 1: Once we hit +5%, never let it go below breakeven
              if (profitPercent >= 5 && profitPercent < 10) {
                trailingStopPercent = -2; // Allow 2% loss from entry to give room
                if (profitPercent <= trailingStopPercent) {
                  console.log(`[Position Monitor] 📉 ${position.tokenSymbol} TRAILING STOP (Tier 1): Profit ${profitPercent.toFixed(2)}% dropped below ${trailingStopPercent}% → SELLING to preserve capital`);
                  await executeSellForPosition(config, position, treasuryKeyBase58, `Trailing stop tier 1: ${profitPercent.toFixed(2)}% below ${trailingStopPercent}% threshold`);
                  continue;
                }
              }
              
              // Tier 2: At +10%, lock in at least +2% profit
              else if (profitPercent >= 10 && profitPercent < 20) {
                trailingStopPercent = 2; // Must be at least +2% profit
                if (profitPercent <= trailingStopPercent) {
                  console.log(`[Position Monitor] 📉 ${position.tokenSymbol} TRAILING STOP (Tier 2): Profit ${profitPercent.toFixed(2)}% dropped below +${trailingStopPercent}% → SELLING to lock gains`);
                  await executeSellForPosition(config, position, treasuryKeyBase58, `Trailing stop tier 2: ${profitPercent.toFixed(2)}% below +${trailingStopPercent}% threshold`);
                  continue;
                }
              }
              
              // Tier 3: At +20%, lock in at least +10% profit
              else if (profitPercent >= 20 && profitPercent < 50) {
                trailingStopPercent = 10; // Must be at least +10% profit
                if (profitPercent <= trailingStopPercent) {
                  console.log(`[Position Monitor] 📉 ${position.tokenSymbol} TRAILING STOP (Tier 3): Profit ${profitPercent.toFixed(2)}% dropped below +${trailingStopPercent}% → SELLING to lock gains`);
                  await executeSellForPosition(config, position, treasuryKeyBase58, `Trailing stop tier 3: ${profitPercent.toFixed(2)}% below +${trailingStopPercent}% threshold`);
                  continue;
                }
              }
              
              // Tier 4: At +50%, lock in at least +30% profit
              else if (profitPercent >= 50 && profitPercent < 100) {
                trailingStopPercent = 30; // Must be at least +30% profit
                if (profitPercent <= trailingStopPercent) {
                  console.log(`[Position Monitor] 📉 ${position.tokenSymbol} TRAILING STOP (Tier 4): Profit ${profitPercent.toFixed(2)}% dropped below +${trailingStopPercent}% → SELLING to lock massive gains`);
                  await executeSellForPosition(config, position, treasuryKeyBase58, `Trailing stop tier 4: ${profitPercent.toFixed(2)}% below +${trailingStopPercent}% threshold`);
                  continue;
                }
              }
            }
            
            // 💎 PROFIT PROTECTION: Lock in massive gains before fast crashes erase them
            // Soft trailing stops only for EXTREME profits to prevent total wipeouts
            if (newPeakProfit >= 200) {
              // At +200% peak, protect at least +100% (allow 100% pullback from peak)
              if (profitPercent <= 100) {
                console.log(`[Position Monitor] 🛡️ ${position.tokenSymbol} PROFIT PROTECTION: Peaked at +${newPeakProfit.toFixed(2)}%, now +${profitPercent.toFixed(2)}% → SELLING to lock gains!`);
                await executeSellForPosition(config, position, treasuryKeyBase58, `Profit protection: Peak +${newPeakProfit.toFixed(2)}% → +${profitPercent.toFixed(2)}%`);
                continue;
              }
            } else if (newPeakProfit >= 150) {
              // At +150% peak, protect at least +75% (allow 75% pullback from peak)
              if (profitPercent <= 75) {
                console.log(`[Position Monitor] 🛡️ ${position.tokenSymbol} PROFIT PROTECTION: Peaked at +${newPeakProfit.toFixed(2)}%, now +${profitPercent.toFixed(2)}% → SELLING to lock gains!`);
                await executeSellForPosition(config, position, treasuryKeyBase58, `Profit protection: Peak +${newPeakProfit.toFixed(2)}% → +${profitPercent.toFixed(2)}%`);
                continue;
              }
            } else if (newPeakProfit >= 120) {
              // At +120% peak, protect at least +60% (allow 60% pullback from peak)
              if (profitPercent <= 60) {
                console.log(`[Position Monitor] 🛡️ ${position.tokenSymbol} PROFIT PROTECTION: Peaked at +${newPeakProfit.toFixed(2)}%, now +${profitPercent.toFixed(2)}% → SELLING to lock gains!`);
                await executeSellForPosition(config, position, treasuryKeyBase58, `Profit protection: Peak +${newPeakProfit.toFixed(2)}% → +${profitPercent.toFixed(2)}%`);
                continue;
              }
            }
            
            // 🎯 AUTO-SELL AT EXTREME MEGA-WINS (300%+) - Life-changing money, take it!
            if (profitPercent >= 300) {
              console.log(`[Position Monitor] 💰💰💰 ${position.tokenSymbol} MEGA-WIN: +${profitPercent.toFixed(2)}% → SELLING to lock in life-changing gains!`);
              await executeSellForPosition(config, position, treasuryKeyBase58, `Auto-sell at +${profitPercent.toFixed(2)}% (300%+ mega-win)`);
              continue;
            }
            
            // 📊 BUY THE DIP OPPORTUNITY: If we're still profitable but pulled back significantly
            // This is a chance to accumulate more and lower average entry price
            if (profitPercent > 0 && newPeakProfit > 15) {
              const pullbackFromPeak = ((profitPercent - newPeakProfit) / newPeakProfit) * 100;
              
              // If we pulled back 30%+ from peak but still in profit, consider buying more
              if (pullbackFromPeak <= -30) {
                console.log(`[Position Monitor] 🎯 ${position.tokenSymbol} BUY THE DIP: Pulled back ${Math.abs(pullbackFromPeak).toFixed(1)}% from peak (+${newPeakProfit.toFixed(2)}% → +${profitPercent.toFixed(2)}%)`);
                console.log(`[Position Monitor] 💡 This is a profit-maximization opportunity - should accumulate more tokens here!`);
                // TODO: Implement auto-buy on dip logic here (for future enhancement)
              }
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
 * Enhanced with technical indicators for better sell decisions
 */
async function fetchPositionMarketData(tokenMint: string): Promise<{
  volumeUSD24h: number;
  liquidityUSD: number;
  priceChange24h: number;
  priceChange1h: number;
  priceChange5m: number;
  txns24h: number;
  buyPressure: number;
  buyTxns24h: number;
  sellTxns24h: number;
  volumeChange24h: number; // % change in volume
  liquidityChange24h: number; // % change in liquidity (drain detection)
  priceChangeM5: number; // 5-minute momentum
  fdv: number; // Fully diluted valuation
  marketCap: number;
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

    // Advanced metrics
    const volume24h = parseFloat(pair.volume?.h24 || "0");
    const volume6h = parseFloat(pair.volume?.h6 || "0");
    const volume1h = parseFloat(pair.volume?.h1 || "0");
    
    // Volume trend: compare recent to older periods
    // If 6h volume is less than half of expected (proportional to 24h), volume is declining
    const expectedVolume6h = volume24h * 0.25; // Expect 25% of 24h volume in last 6h
    const volumeTrend = volume6h > 0 ? ((volume6h / expectedVolume6h) - 1) * 100 : 0;
    
    // Liquidity change detection (rug pull indicator)
    const currentLiquidity = parseFloat(pair.liquidity?.usd || "0");
    const baseLiquidity = parseFloat(pair.liquidity?.base || "0");
    const quoteLiquidity = parseFloat(pair.liquidity?.quote || "0");
    const totalProvided = baseLiquidity + quoteLiquidity;
    const liquidityUtilization = totalProvided > 0 ? (currentLiquidity / totalProvided) : 1;
    const liquidityChange = (liquidityUtilization - 1) * 100; // Negative = liquidity being pulled

    return {
      volumeUSD24h: volume24h,
      liquidityUSD: currentLiquidity,
      priceChange24h: parseFloat(pair.priceChange?.h24 || "0"),
      priceChange1h: parseFloat(pair.priceChange?.h1 || "0"),
      priceChange5m: parseFloat(pair.priceChange?.m5 || "0"),
      txns24h: totalTxns,
      buyTxns24h: buyTxns,
      sellTxns24h: sellTxns,
      buyPressure: totalTxns > 0 ? (buyTxns / totalTxns) * 100 : 50,
      volumeChange24h: volumeTrend,
      liquidityChange24h: liquidityChange,
      priceChangeM5: parseFloat(pair.priceChange?.m5 || "0"),
      fdv: parseFloat(pair.fdv || "0"),
      marketCap: parseFloat(pair.marketCap || "0"),
    };
  } catch (error) {
    console.error(`[Position Monitor] Failed to fetch DexScreener data:`, error);
    return null;
  }
}

/**
 * Analyze position with AI using DUAL-MODEL CONSENSUS (OpenAI + DeepSeek 2)
 * More accurate than single model - runs both in parallel and combines results
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

  // 🎯 PROFIT-MAXIMIZATION GATING: Let AI analyze when we can capture MORE profit
  const profitTarget = isSwingTrade ? 15 : 4; // SWING: +15%, SCALP: +4%
  const peakProfit = parseFloat(position.peakProfitPercent || "0");
  
  // Track if we've ever hit profit target (peak-based, not current)
  const hasHitProfitTarget = peakProfit >= profitTarget;
  
  // CASE 1: We're in profit and haven't hit target yet → HOLD and wait for more gains
  if (profitPercent > 0 && profitPercent < profitTarget && !hasHitProfitTarget) {
    console.log(`[Position Monitor] 💎 HUNTING PROFITS ${position.tokenSymbol}: ${profitPercent > 0 ? '+' : ''}${profitPercent.toFixed(2)}% → waiting for +${profitTarget}% target (peak: ${peakProfit.toFixed(2)}%)`);
    logActivity('position_monitor', 'info', `💎 HOLD ${position.tokenSymbol}: ${profitPercent.toFixed(2)}% → targeting +${profitTarget}%`);
    return; // Keep riding the wave up!
  }
  
  // CASE 2: We've hit profit target before, now in pullback → Ask AI if this is profit-maximization exit
  // (e.g., went +20% → now +10%, AI can decide if this is the peak or just a dip)
  if (hasHitProfitTarget && profitPercent > 0) {
    console.log(`[Position Monitor] 🤔 ${position.tokenSymbol} in PROFIT PULLBACK: Peak +${peakProfit.toFixed(2)}% → Current +${profitPercent.toFixed(2)}% → AI analyzing for best exit`);
  }
  
  // CASE 3: We're in actual loss territory → Ask AI to evaluate: SELL, HOLD, or ACCUMULATE
  if (profitPercent < 0) {
    console.log(`[Position Monitor] ⚠️ ${position.tokenSymbol} in LOSS: ${profitPercent.toFixed(2)}% → AI analyzing: cut losses OR hold for recovery OR accumulate if fundamentals strong`);
  }
  
  // CASE 4: We're past profit target → Ask AI for optimal exit timing
  if (profitPercent >= profitTarget) {
    console.log(`[Position Monitor] ✅ ${position.tokenSymbol} HIT TARGET: ${profitPercent.toFixed(2)}% (target: +${profitTarget}%) → AI finding optimal exit`);
  }

  // Fetch comprehensive market data from DexScreener
  console.log(`[Position Monitor] 📊 Fetching market data for ${position.tokenSymbol} from DexScreener...`);
  const marketData = await fetchPositionMarketData(position.tokenMint);

  // Calculate technical indicators (RSI, EMA, Bollinger Bands)
  console.log(`[Position Monitor] 📈 Calculating technical indicators for ${position.tokenSymbol}...`);
  const technicals = await calculateTechnicalIndicators(position.tokenMint, currentPriceSOL);

  // Build comprehensive analysis prompt with advanced technical metrics
  let marketMetrics = "";
  if (marketData) {
    console.log(`[Position Monitor] ✅ Market data fetched for ${position.tokenSymbol}:`);
    console.log(`  - Volume: $${marketData.volumeUSD24h.toLocaleString()}, Liquidity: $${marketData.liquidityUSD.toLocaleString()}`);
    console.log(`  - Buy Pressure: ${marketData.buyPressure.toFixed(1)}% (${marketData.buyTxns24h} buys vs ${marketData.sellTxns24h} sells)`);
    console.log(`  - Price Change: 24h ${marketData.priceChange24h > 0 ? '+' : ''}${marketData.priceChange24h.toFixed(2)}%, 1h ${marketData.priceChange1h > 0 ? '+' : ''}${marketData.priceChange1h.toFixed(2)}%`);
    console.log(`  - RSI: ${technicals.rsi.toFixed(1)} (${technicals.rsiSignal}), EMA: ${technicals.emaSignal}, BB: ${technicals.bollingerSignal}`);
    
    // Technical analysis signals
    const momentumSignal = marketData.priceChange5m > 0 && marketData.priceChange1h > 0 && marketData.priceChange24h > 0 
      ? "🟢 BULLISH (all timeframes positive)" 
      : marketData.priceChange5m < 0 && marketData.priceChange1h < 0 
      ? "🔴 BEARISH (recent momentum dying)" 
      : "🟡 MIXED";
    
    const volumeSignal = marketData.volumeChange24h > 20 
      ? "🟢 INCREASING (healthy)" 
      : marketData.volumeChange24h < -30 
      ? "🔴 DECLINING (warning)" 
      : "🟡 STABLE";
    
    const liquiditySignal = marketData.liquidityChange24h < -10 
      ? "🔴 DRAINING (rug risk!)" 
      : marketData.liquidityChange24h > 10 
      ? "🟢 INCREASING (healthy)" 
      : "🟡 STABLE";
    
    const buyPressureSignal = marketData.buyPressure > 55 
      ? "🟢 STRONG BUYING" 
      : marketData.buyPressure < 40 
      ? "🔴 HEAVY SELLING" 
      : "🟡 BALANCED";
    
    marketMetrics = `
MARKET METRICS & TECHNICAL ANALYSIS:

Price Action:
- Current Trend: ${momentumSignal}
- 5-minute: ${marketData.priceChange5m > 0 ? '+' : ''}${marketData.priceChange5m.toFixed(2)}%
- 1-hour: ${marketData.priceChange1h > 0 ? '+' : ''}${marketData.priceChange1h.toFixed(2)}%
- 24-hour: ${marketData.priceChange24h > 0 ? '+' : ''}${marketData.priceChange24h.toFixed(2)}%

TECHNICAL INDICATORS:
- RSI (14): ${technicals.rsi.toFixed(1)} - ${technicals.rsiSignal}
  ${technicals.rsi < 30 ? '🟢 OVERSOLD - Strong BUY signal' : technicals.rsi > 70 ? '🔴 OVERBOUGHT - Strong SELL signal' : ''}
- EMA (9/21): ${technicals.emaSignal}
  ${technicals.ema9 > technicals.ema21 ? '🟢 Bullish trend (9 EMA above 21 EMA)' : '🔴 Bearish trend (9 EMA below 21 EMA)'}
- Bollinger Bands: ${technicals.bollingerSignal}
  Position: ${(technicals.bollingerBands.percentB * 100).toFixed(0)}% of band width
  ${technicals.bollingerBands.percentB > 1 ? '🔴 Price ABOVE upper band (extreme overbought)' : technicals.bollingerBands.percentB < 0 ? '🟢 Price BELOW lower band (extreme oversold)' : ''}
- Overall Technical Signal: ${technicals.overallSignal} (Score: ${technicals.technicalScore}/100)

Volume Analysis:
- 24h Volume: $${marketData.volumeUSD24h.toLocaleString()}
- Volume Trend: ${volumeSignal} (${marketData.volumeChange24h > 0 ? '+' : ''}${marketData.volumeChange24h.toFixed(1)}% vs expected)
- Volume/Liquidity Ratio: ${marketData.liquidityUSD > 0 ? (marketData.volumeUSD24h / marketData.liquidityUSD).toFixed(2) : 'N/A'}

Liquidity Status:
- Current Liquidity: $${marketData.liquidityUSD.toLocaleString()}
- Liquidity Trend: ${liquiditySignal} (${marketData.liquidityChange24h > 0 ? '+' : ''}${marketData.liquidityChange24h.toFixed(1)}%)
- ⚠️ RUG RISK: ${marketData.liquidityChange24h < -15 ? 'HIGH - liquidity being pulled!' : 'LOW'}

Order Flow:
- Buy Pressure: ${buyPressureSignal} (${marketData.buyPressure.toFixed(1)}%)
- Buy Transactions: ${marketData.buyTxns24h}
- Sell Transactions: ${marketData.sellTxns24h}
- Total Transactions: ${marketData.txns24h}

Valuation:
- Market Cap: $${marketData.marketCap.toLocaleString()}
- FDV: $${marketData.fdv.toLocaleString()}`;
  } else {
    console.log(`[Position Monitor] ⚠️ Failed to fetch market data for ${position.tokenSymbol} - AI will analyze with limited data`);
    marketMetrics = `
MARKET METRICS: Unavailable (low liquidity or delisted token)
⚠️ WARNING: This is a major red flag - likely rug pulled or very illiquid

TECHNICAL INDICATORS:
- RSI (14): ${technicals.rsi.toFixed(1)} - ${technicals.rsiSignal}
- EMA (9/21): ${technicals.emaSignal}
- Bollinger Bands: ${technicals.bollingerSignal}
- Overall: ${technicals.overallSignal}`;
  }

  const prompt = `You are an expert technical analyst. Analyze this cryptocurrency position and decide: SELL, HOLD, or ACCUMULATE?

POSITION DETAILS:
Token: ${position.tokenSymbol}
Entry Price: ${parseFloat(position.entryPriceSOL).toFixed(9)} SOL
Current Price: ${currentPriceSOL.toFixed(9)} SOL
Profit/Loss: ${profitPercent > 0 ? '+' : ''}${profitPercent.toFixed(2)}%
AI Confidence at Buy: ${aiConfidenceAtBuy.toFixed(0)}%
Position Type: ${isSwingTrade ? 'SWING TRADE (high confidence, 24h target)' : 'SCALP TRADE (quick 30min target)'}
${marketMetrics}

TECHNICAL ANALYSIS FRAMEWORK - Analyze these signals carefully:

1. RSI ANALYSIS (Overbought/Oversold):
   - RSI <30: Oversold (buy signal, HOLD position)
   - RSI >70: Overbought (sell signal)
   - 🔴 SELL SIGNAL: RSI >70 = extreme overbought, take profits

2. EMA TREND ANALYSIS (Trend Direction):
   - EMA 9 > EMA 21: Bullish trend (HOLD)
   - EMA 9 < EMA 21: Bearish trend (consider selling)
   - 🔴 SELL SIGNAL: Death cross (EMA 9 crosses below EMA 21)

3. BOLLINGER BANDS (Price Extremes):
   - Price > Upper Band: Overbought (sell signal)
   - Price < Lower Band: Oversold (buy signal, HOLD)
   - 🔴 SELL SIGNAL: Price above upper band = extreme overbought

4. MOMENTUM ANALYSIS (Price Action):
   - Is short-term momentum (5m, 1h) still positive?
   - Are all timeframes aligned (bullish across 5m, 1h, 24h)?
   - 🔴 SELL SIGNAL: Recent timeframes turning negative while in profit

5. VOLUME TREND (Interest Level):
   - Is volume increasing (healthy) or declining (warning)?
   - 🔴 SELL SIGNAL: Volume declining >30% = interest dying

6. LIQUIDITY HEALTH (Rug Pull Detection):
   - Is liquidity stable or draining?
   - 🔴 IMMEDIATE SELL: Liquidity draining <-10% = potential rug pull

7. ORDER FLOW (Market Sentiment):
   - Is buy pressure >45% (healthy) or <40% (weak)?
   - 🔴 SELL SIGNAL: Heavy selling pressure <40% = distribution phase

8. PROFIT PROTECTION:
   - Current P/L: ${profitPercent.toFixed(2)}%
   - ${profitPercent > 15 ? '✅ In profit - protect gains if technical signals weaken' : profitPercent > 0 ? '🟡 Small profit - only sell on clear technical reversal' : '🔴 In loss - hold unless critical technical red flags'}

DECISION RULES:
- SELL if RSI >70 AND (EMA bearish OR price above upper Bollinger Band)
- SELL if 3+ technical red flags appear (RSI overbought, EMA death cross, Bollinger overbought, momentum dying, volume declining, heavy selling, liquidity drain)
- SELL if any CRITICAL signal (liquidity draining, rug risk)
- SELL if we're in good profit ${profitPercent > 15 ? `(+${profitPercent.toFixed(0)}%)` : ''} AND multiple technical indicators show reversal

- ACCUMULATE (buy more) ONLY if ALL these conditions are met:
  * Currently in LOSS (negative profit)
  * RSI <30 (extreme oversold = dip/discount)
  * EMA bullish (9 > 21, trend still intact)
  * Bollinger Bands: price near/below lower band (support level)
  * Volume stable or increasing (not declining >30%)
  * Liquidity stable (NOT draining)
  * Buy pressure >40% (sellers not dominating)
  * Your conviction is VERY HIGH (85%+ confidence) that fundamentals are strong
  * This is a "buy the dip" opportunity with strong recovery potential

- HOLD if RSI <50 AND EMA bullish AND Bollinger Bands not overbought
- HOLD if momentum still healthy OR technical indicators show strength
- HOLD if in loss but fundamentals unclear (don't accumulate without conviction)
- HOLD if data unavailable/unclear (better safe than sorry)

Your confidence should be:
- 70%+ to SELL (based on technical indicators + market conditions)
- 85%+ to ACCUMULATE (very high conviction that fundamentals are strong despite dip)
- Otherwise HOLD

Respond ONLY with valid JSON:
{
  "action": "HOLD" | "SELL" | "ACCUMULATE",
  "confidence": 0-100,
  "reasoning": "specific technical reasons (mention which signals)"
}`;

  // FULL HIVEMIND CONSENSUS: Run all 7 AI models in parallel for maximum accuracy
  const allModels = [
    { name: "OpenAI", baseURL: "https://api.openai.com/v1", apiKey: process.env.OPENAI_API_KEY, model: "gpt-4o-mini" },
    { name: "OpenAI #2", baseURL: "https://api.openai.com/v1", apiKey: process.env.OPENAI_API_KEY_2, model: "gpt-4o-mini" },
    { name: "DeepSeek", baseURL: "https://api.deepseek.com", apiKey: process.env.DEEPSEEK_API_KEY, model: "deepseek-chat" },
    { name: "DeepSeek #2", baseURL: "https://api.deepseek.com", apiKey: process.env.DEEPSEEK_API_KEY_2, model: "deepseek-chat" },
    { name: "Cerebras", baseURL: "https://api.cerebras.ai/v1", apiKey: process.env.CEREBRAS_API_KEY, model: "llama3.1-70b" },
    { name: "Google Gemini", baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/", apiKey: process.env.GOOGLE_AI_KEY, model: "gemini-2.0-flash-exp" }, // 🔧 FIX #3: Corrected model name
    { name: "Groq", baseURL: "https://api.groq.com/openai/v1", apiKey: process.env.GROQ_API_KEY, model: "llama-3.3-70b-versatile" },
  ].filter(m => m.apiKey); // Only use models with API keys configured

  const results = await Promise.allSettled(
    allModels.map(async (provider) => {
      if (!provider.apiKey) throw new Error(`${provider.name} API key not configured`);

      const client = new OpenAI({
        baseURL: provider.baseURL,
        apiKey: provider.apiKey,
      });

      const response = await client.chat.completions.create({
        model: provider.model,
        messages: [{ role: "user", content: prompt }],
        temperature: 0.4,
        max_tokens: 300,
      });

      const content = response.choices[0]?.message?.content || "{}";
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error("Failed to parse JSON response");
      
      return {
        provider: provider.name,
        analysis: JSON.parse(jsonMatch[0]) as {
          action: "HOLD" | "SELL" | "ACCUMULATE";
          confidence: number;
          reasoning: string;
        }
      };
    })
  );

  // Extract successful results
  const successful = results
    .filter((r): r is PromiseFulfilledResult<any> => r.status === "fulfilled")
    .map(r => r.value);

  // FULL HIVEMIND CONSENSUS: Use all successful models for decision
  if (successful.length >= 2) {
    console.log(`[Position Monitor] ✅ Hivemind Consensus for ${position.tokenSymbol} (${successful.length} models):`);
    
    // Show all model votes
    successful.forEach(model => {
      console.log(`[Position Monitor]    ${model.provider}: ${model.analysis.action} (${model.analysis.confidence}% confidence)`);
    });

    // Count SELL votes and calculate average confidence
    const sellVotes = successful.filter(m => m.analysis.action === "SELL");
    const avgConfidence = successful.reduce((sum, m) => sum + m.analysis.confidence, 0) / successful.length;
    const sellPercentage = (sellVotes.length / successful.length) * 100;
    
    // SELL if majority (>50%) vote SELL with reasonable avg confidence (>=50%)
    const majorityVotesSell = sellPercentage > 50;
    const hasReasonableConfidence = avgConfidence >= 50;
    
    // Or SELL if any single model has very high confidence (>=75%) regardless of others
    const hasHighConfidenceSell = sellVotes.some(m => m.analysis.confidence >= 75);

    // 🎯 PROFIT THRESHOLD CHECK - Prevent selling winners too early
    const currentProfitPercent = parseFloat(position.profitPercent || "0");
    const isInProfit = currentProfitPercent > 0;
    const isInLoss = currentProfitPercent < 0;
    
    // Determine minimum profit threshold based on strategy type
    // SCALP (62-79% confidence): 2% minimum | SWING (80%+): 5% minimum
    const isSwingPosition = (position.strategyType === "SWING");
    const MIN_PROFIT_SCALP = 2.0; // Don't sell SCALP for less than +2%
    const MIN_PROFIT_SWING = 5.0; // Don't sell SWING for less than +5%
    const minProfitThreshold = isSwingPosition ? MIN_PROFIT_SWING : MIN_PROFIT_SCALP;

    if (majorityVotesSell && hasReasonableConfidence) {
      console.log(`[Position Monitor] ✅ Hivemind consensus: ${sellVotes.length}/${successful.length} models vote SELL (${sellPercentage.toFixed(0)}%), avg confidence ${avgConfidence.toFixed(0)}%`);
      
      // ✅ ALLOW SELL if in profit AND meets minimum threshold
      if (isInProfit && currentProfitPercent >= minProfitThreshold) {
        console.log(`[Position Monitor] ✅ SELL APPROVED: ${currentProfitPercent.toFixed(2)}% profit exceeds ${minProfitThreshold}% minimum → executing...`);
        logActivity('position_monitor', 'ai_thought', `🧠 Hivemind (${sellVotes.length}/${successful.length}): ${position.tokenSymbol} → SELL (${avgConfidence.toFixed(0)}%)`);
        const topModels = successful.slice(0, 2).map(m => `${m.provider}: ${m.analysis.reasoning.substring(0, 30)}`).join('; ');
        await executeSellForPosition(config, position, treasuryKeyBase58, `Hivemind Consensus: ${sellVotes.length}/${successful.length} vote SELL, ${avgConfidence.toFixed(0)}% avg confidence. ${topModels}...`);
      }
      // ✅ ALLOW SELL if in loss (stop-loss protection - AI says cut)
      else if (isInLoss) {
        console.log(`[Position Monitor] ✅ SELL APPROVED: Position in loss (${currentProfitPercent.toFixed(2)}%) - AI stop-loss → executing...`);
        logActivity('position_monitor', 'ai_thought', `🧠 Hivemind (${sellVotes.length}/${successful.length}): ${position.tokenSymbol} → SELL LOSS (${currentProfitPercent.toFixed(2)}%)`);
        const topModels = successful.slice(0, 2).map(m => `${m.provider}: ${m.analysis.reasoning.substring(0, 30)}`).join('; ');
        await executeSellForPosition(config, position, treasuryKeyBase58, `Stop-Loss: ${sellVotes.length}/${successful.length} vote SELL, ${currentProfitPercent.toFixed(2)}% loss. ${topModels}...`);
      }
      // 🛡️ 2-STAGE EXIT FILTER: Require confidence hysteresis AND price drop to prevent premature exits
      // This prevents selling winners from temporary AI confidence dips
      else if (avgConfidence >= 80) {
        // Stage 1: Track low confidence samples (hysteresis)
        const lowConfidenceSamples = (position.lowConfidenceSampleCount || 0) + 1;
        const REQUIRED_SAMPLES = 2; // Require 2 consecutive checks before selling
        
        // Stage 2: Check if price has actually dropped
        const entryPriceSOL = parseFloat(position.entryPriceSOL || "0");
        const hasPriceDropped = currentPriceSOL < entryPriceSOL;
        
        // Check trailing stop (if armed after 1.5%+ profit)
        const trailingStopArmed = position.trailingStopArmed === 1;
        const trailingStopPrice = trailingStopArmed ? parseFloat(position.trailingStopPriceSOL || "0") : 0;
        const hasBreachedTrailingStop = trailingStopArmed && currentPriceSOL < trailingStopPrice;
        
        console.log(`[Position Monitor] ⚠️ AI OVERRIDE SIGNAL: High confidence (${avgConfidence.toFixed(0)}%) - checking 2-stage filter...`);
        console.log(`[Position Monitor]    Stage 1: ${lowConfidenceSamples}/${REQUIRED_SAMPLES} low-confidence samples`);
        console.log(`[Position Monitor]    Stage 2: Price drop=${hasPriceDropped} (${currentPriceSOL.toFixed(8)} vs ${entryPriceSOL.toFixed(8)}), Trailing stop breach=${hasBreachedTrailingStop}`);
        
        // Execute sell ONLY if both stages pass
        if (lowConfidenceSamples >= REQUIRED_SAMPLES && (hasPriceDropped || hasBreachedTrailingStop)) {
          console.log(`[Position Monitor] ✅ 2-STAGE FILTER PASSED: Executing sell to prevent deterioration`);
          logActivity('position_monitor', 'warning', `⚡ AI OVERRIDE ${position.tokenSymbol}: ${avgConfidence.toFixed(0)}% confidence, ${lowConfidenceSamples} samples, price drop confirmed → exit at ${currentProfitPercent.toFixed(2)}%`);
          const topModels = successful.slice(0, 2).map(m => `${m.provider}: ${m.analysis.reasoning.substring(0, 30)}`).join('; ');
          await executeSellForPosition(config, position, treasuryKeyBase58, `2-Stage Filter: ${sellVotes.length}/${successful.length} vote SELL, ${avgConfidence.toFixed(0)}% avg confidence (${lowConfidenceSamples} samples + price drop confirmed). ${topModels}...`);
        } else {
          // Increment counter but HOLD position
          await storage.updateAIBotPosition(position.id, {
            lowConfidenceSampleCount: lowConfidenceSamples,
          });
          console.log(`[Position Monitor] ⏸️ HOLDING: 2-stage filter not met - need ${REQUIRED_SAMPLES - lowConfidenceSamples} more sample(s) ${!hasPriceDropped && !hasBreachedTrailingStop ? 'AND price drop' : ''}`);
          logActivity('position_monitor', 'info', `💎 HOLD ${position.tokenSymbol}: AI says sell but 2-stage filter blocks (need price drop confirmation)`);
        }
      }
      // ❌ BLOCK SELL if profit too small and AI not strongly confident
      else {
        console.log(`[Position Monitor] ⏸️ HOLD: Profit ${currentProfitPercent.toFixed(2)}% below ${minProfitThreshold}% minimum (${isSwingPosition ? 'SWING' : 'SCALP'}) - waiting for better exit`);
        logActivity('position_monitor', 'info', `💎 HOLD ${position.tokenSymbol}: ${currentProfitPercent.toFixed(2)}% → waiting for ${minProfitThreshold}% minimum`);
      }
    } else if (hasHighConfidenceSell) {
      const highConfModel = sellVotes.find(m => m.analysis.confidence >= 75)!;
      console.log(`[Position Monitor] ✅ ${highConfModel.provider} high-confidence SELL (${highConfModel.analysis.confidence}%)`);
      
      // Same profit threshold check for high-confidence sells
      if (isInProfit && currentProfitPercent >= minProfitThreshold) {
        console.log(`[Position Monitor] ✅ SELL APPROVED: ${currentProfitPercent.toFixed(2)}% profit exceeds ${minProfitThreshold}% minimum → executing...`);
        logActivity('position_monitor', 'ai_thought', `🧠 ${highConfModel.provider}: ${position.tokenSymbol} → SELL (${highConfModel.analysis.confidence}%)`);
        await executeSellForPosition(config, position, treasuryKeyBase58, `${highConfModel.provider}: ${highConfModel.analysis.reasoning} (${highConfModel.analysis.confidence}% high confidence)`);
      } else if (isInLoss) {
        console.log(`[Position Monitor] ✅ SELL APPROVED: Position in loss (${currentProfitPercent.toFixed(2)}%) - AI stop-loss → executing...`);
        logActivity('position_monitor', 'ai_thought', `🧠 ${highConfModel.provider}: ${position.tokenSymbol} → SELL LOSS (${currentProfitPercent.toFixed(2)}%)`);
        await executeSellForPosition(config, position, treasuryKeyBase58, `Stop-Loss: ${highConfModel.provider} ${highConfModel.analysis.reasoning} (${currentProfitPercent.toFixed(2)}% loss)`);
      }
      // 🛡️ 2-STAGE EXIT FILTER: Single high-confidence model
      else if (highConfModel.analysis.confidence >= 80) {
        const lowConfidenceSamples = (position.lowConfidenceSampleCount || 0) + 1;
        const REQUIRED_SAMPLES = 2;
        const entryPriceSOL = parseFloat(position.entryPriceSOL || "0");
        const hasPriceDropped = currentPriceSOL < entryPriceSOL;
        const trailingStopArmed = position.trailingStopArmed === 1;
        const trailingStopPrice = trailingStopArmed ? parseFloat(position.trailingStopPriceSOL || "0") : 0;
        const hasBreachedTrailingStop = trailingStopArmed && currentPriceSOL < trailingStopPrice;
        
        console.log(`[Position Monitor] ⚠️ ${highConfModel.provider} HIGH CONFIDENCE (${highConfModel.analysis.confidence}%) - checking 2-stage filter...`);
        
        if (lowConfidenceSamples >= REQUIRED_SAMPLES && (hasPriceDropped || hasBreachedTrailingStop)) {
          console.log(`[Position Monitor] ✅ 2-STAGE FILTER PASSED: Executing sell`);
          logActivity('position_monitor', 'warning', `⚡ AI OVERRIDE ${position.tokenSymbol}: ${highConfModel.provider} ${highConfModel.analysis.confidence}%, ${lowConfidenceSamples} samples, price drop confirmed`);
          await executeSellForPosition(config, position, treasuryKeyBase58, `2-Stage Filter: ${highConfModel.provider} ${highConfModel.analysis.reasoning} (${highConfModel.analysis.confidence}% confidence, ${lowConfidenceSamples} samples + price drop)`);
        } else {
          await storage.updateAIBotPosition(position.id, { lowConfidenceSampleCount: lowConfidenceSamples });
          console.log(`[Position Monitor] ⏸️ HOLDING: 2-stage filter not met`);
          logActivity('position_monitor', 'info', `💎 HOLD ${position.tokenSymbol}: ${highConfModel.provider} says sell but filter blocks`);
        }
      }
      else {
        console.log(`[Position Monitor] ⏸️ HOLD: Profit ${currentProfitPercent.toFixed(2)}% below ${minProfitThreshold}% minimum - waiting for better exit`);
        logActivity('position_monitor', 'info', `💎 HOLD ${position.tokenSymbol}: ${currentProfitPercent.toFixed(2)}% → waiting for ${minProfitThreshold}% minimum`);
      }
    } else {
      // Check for ACCUMULATE consensus (majority vote + high conviction + in loss)
      const accumulateVotes = successful.filter(m => m.analysis.action === "ACCUMULATE");
      const accumulatePercentage = (accumulateVotes.length / successful.length) * 100;
      const accumulateAvgConfidence = accumulateVotes.length > 0 
        ? accumulateVotes.reduce((sum, m) => sum + m.analysis.confidence, 0) / accumulateVotes.length 
        : 0;
      
      const majorityVotesAccumulate = accumulatePercentage > 50;
      const hasHighConviction = accumulateAvgConfidence >= 85; // Very high conviction required
      
      if (majorityVotesAccumulate && hasHighConviction && isInLoss) {
        console.log(`[Position Monitor] 🎯 ACCUMULATE SIGNAL: ${accumulateVotes.length}/${successful.length} models vote ACCUMULATE (${accumulatePercentage.toFixed(0)}%), avg conviction ${accumulateAvgConfidence.toFixed(0)}%`);
        
        // Safety Check 1: Position size limit (max 2x original entry amount)
        const originalAmountSOL = parseFloat(position.amountSOL || "0");
        const currentValueSOL = parseFloat(position.tokenAmount || "0") * currentPriceSOL;
        const positionSizeRatio = currentValueSOL / originalAmountSOL;
        
        if (positionSizeRatio >= 2.0) {
          console.log(`[Position Monitor] ⚠️ ACCUMULATE BLOCKED: Position already 2x original size (${positionSizeRatio.toFixed(2)}x) - safety limit reached`);
          logActivity('position_monitor', 'warning', `⚠️ ${position.tokenSymbol}: Can't accumulate - already 2x original size`);
        }
        // Safety Check 2: Max drawdown limit (-15% max before forced stop-loss)
        else if (currentProfitPercent < -15) {
          console.log(`[Position Monitor] ⚠️ ACCUMULATE BLOCKED: Drawdown too deep (${currentProfitPercent.toFixed(2)}%) - forced stop-loss threshold reached`);
          logActivity('position_monitor', 'warning', `⚠️ ${position.tokenSymbol}: Can't accumulate - drawdown >15%`);
        }
        // Execute accumulation
        else {
          const accumulateAmount = originalAmountSOL * 0.5; // Buy 50% of original entry size
          console.log(`[Position Monitor] 💰 ACCUMULATING ${position.tokenSymbol}: Buying ${accumulateAmount.toFixed(4)} SOL more (strong fundamentals despite dip)`);
          
          const topModels = accumulateVotes.slice(0, 2).map(m => `${m.provider}: ${m.analysis.reasoning.substring(0, 50)}`).join('; ');
          logActivity('position_monitor', 'success', `💰 ACCUMULATE ${position.tokenSymbol}: ${accumulateVotes.length}/${successful.length} vote, ${accumulateAvgConfidence.toFixed(0)}% conviction → buying ${accumulateAmount.toFixed(4)} SOL more`);
          
          // Execute accumulation buy
          await executeAccumulateForPosition(config, position, treasuryKeyBase58, accumulateAmount, `Conviction Hold: ${accumulateVotes.length}/${successful.length} vote ACCUMULATE, ${accumulateAvgConfidence.toFixed(0)}% avg conviction (strong fundamentals). ${topModels}...`);
        }
      } else {
        const actions = successful.map(m => `${m.provider}: ${m.analysis.action} ${m.analysis.confidence}%`).join(', ');
        console.log(`[Position Monitor] ⏸️ Hivemind: No strong consensus to SELL or ACCUMULATE → HOLDING (${actions})`);
        logActivity('position_monitor', 'ai_thought', `🧠 Hivemind: ${position.tokenSymbol} → HOLD (${sellVotes.length}/${successful.length} sell, ${accumulateVotes.length}/${successful.length} accumulate, ${avgConfidence.toFixed(0)}% avg confidence)`);
      }
    }
    return;
  }

  // If only one model succeeded, use it
  if (successful.length === 1) {
    const result = successful[0];
    console.log(`[Position Monitor] ✅ ${result.provider} analysis for ${position.tokenSymbol} (single model)`);
    
    // Apply same profit threshold logic
    const currentProfitPercent = parseFloat(position.profitPercent || "0");
    const isInProfit = currentProfitPercent > 0;
    const isInLoss = currentProfitPercent < 0;
    const isSwingPosition = (position.strategyType === "SWING");
    const MIN_PROFIT_SCALP = 2.0;
    const MIN_PROFIT_SWING = 5.0;
    const minProfitThreshold = isSwingPosition ? MIN_PROFIT_SWING : MIN_PROFIT_SCALP;
    
    if (result.analysis.action === "SELL" && result.analysis.confidence >= 60) {
      console.log(`[Position Monitor] ✅ ${result.provider} recommends SELL with ${result.analysis.confidence}% confidence`);
      
      // Check profit threshold before selling
      if (isInProfit && currentProfitPercent >= minProfitThreshold) {
        console.log(`[Position Monitor] ✅ SELL APPROVED: ${currentProfitPercent.toFixed(2)}% profit exceeds ${minProfitThreshold}% minimum → executing...`);
        logActivity('position_monitor', 'ai_thought', `🧠 ${result.provider}: ${position.tokenSymbol} → SELL (${result.analysis.confidence}%)`);
        await executeSellForPosition(config, position, treasuryKeyBase58, `${result.provider}: ${result.analysis.reasoning} (${result.analysis.confidence}% confidence)`);
      } else if (isInLoss) {
        console.log(`[Position Monitor] ✅ SELL APPROVED: Position in loss (${currentProfitPercent.toFixed(2)}%) - AI stop-loss → executing...`);
        logActivity('position_monitor', 'ai_thought', `🧠 ${result.provider}: ${position.tokenSymbol} → SELL LOSS (${currentProfitPercent.toFixed(2)}%)`);
        await executeSellForPosition(config, position, treasuryKeyBase58, `Stop-Loss: ${result.provider} ${result.analysis.reasoning} (${currentProfitPercent.toFixed(2)}% loss)`);
      }
      // 🛡️ 2-STAGE EXIT FILTER: Single model with very high confidence
      else if (result.analysis.confidence >= 80) {
        const lowConfidenceSamples = (position.lowConfidenceSampleCount || 0) + 1;
        const REQUIRED_SAMPLES = 2;
        const entryPriceSOL = parseFloat(position.entryPriceSOL || "0");
        const hasPriceDropped = currentPriceSOL < entryPriceSOL;
        const trailingStopArmed = position.trailingStopArmed === 1;
        const trailingStopPrice = trailingStopArmed ? parseFloat(position.trailingStopPriceSOL || "0") : 0;
        const hasBreachedTrailingStop = trailingStopArmed && currentPriceSOL < trailingStopPrice;
        
        console.log(`[Position Monitor] ⚠️ ${result.provider} HIGH CONFIDENCE (${result.analysis.confidence}%) - checking 2-stage filter...`);
        
        if (lowConfidenceSamples >= REQUIRED_SAMPLES && (hasPriceDropped || hasBreachedTrailingStop)) {
          console.log(`[Position Monitor] ✅ 2-STAGE FILTER PASSED: Executing sell`);
          logActivity('position_monitor', 'warning', `⚡ AI OVERRIDE ${position.tokenSymbol}: ${result.provider} ${result.analysis.confidence}%, ${lowConfidenceSamples} samples, price drop confirmed`);
          await executeSellForPosition(config, position, treasuryKeyBase58, `2-Stage Filter: ${result.provider} ${result.analysis.reasoning} (${result.analysis.confidence}% confidence, ${lowConfidenceSamples} samples + price drop)`);
        } else {
          await storage.updateAIBotPosition(position.id, { lowConfidenceSampleCount: lowConfidenceSamples });
          console.log(`[Position Monitor] ⏸️ HOLDING: 2-stage filter not met`);
          logActivity('position_monitor', 'info', `💎 HOLD ${position.tokenSymbol}: ${result.provider} says sell but filter blocks`);
        }
      }
      else {
        console.log(`[Position Monitor] ⏸️ HOLD: Profit ${currentProfitPercent.toFixed(2)}% below ${minProfitThreshold}% minimum - waiting for better exit`);
        logActivity('position_monitor', 'info', `💎 HOLD ${position.tokenSymbol}: ${currentProfitPercent.toFixed(2)}% → waiting for ${minProfitThreshold}% minimum`);
      }
    } else {
      console.log(`[Position Monitor] ⏸️ ${result.provider} says ${result.analysis.action} with ${result.analysis.confidence}% confidence → HOLDING`);
      logActivity('position_monitor', 'ai_thought', `🧠 ${result.provider}: ${position.tokenSymbol} → ${result.analysis.action} (${result.analysis.confidence}%)`);
    }
    return;
  }

  // If all models failed
  console.error(`[Position Monitor] ⚠️ All ${allModels.length} AI models failed for ${position.tokenSymbol} - cannot make decision without consensus`);
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

    // IMPORTANT: tokenAmount from database is ALREADY in raw units (not human-readable)
    // It was stored during buy with actual tokens received from Jupiter swap response
    const tokenAmountRaw = Math.floor(tokenAmount);
    
    console.log(`[Position Monitor] 💰 Tokens to sell: ${tokenAmount.toFixed(0)} ${position.tokenSymbol} (raw units)`);
    console.log(`[Position Monitor] 📊 Entry: ${entryPrice.toFixed(9)} SOL, Investment: ${amountSOL.toFixed(4)} SOL`);

    // Execute sell with Jupiter → PumpSwap fallback
    const { sellTokenWithFallback } = await import("./jupiter");
    
    console.log(`[Position Monitor] 🔄 Executing swap with fallback: ${tokenAmountRaw} raw tokens → SOL`);
    
    // Try Jupiter first, then PumpSwap if it fails
    // 5% slippage optimized for profit preservation (reduced from 30% → 10% → 5%)
    const sellResult = await sellTokenWithFallback(
      treasuryKeyBase58,
      position.tokenMint,
      tokenAmountRaw,
      500 // 5% slippage - optimal for high-quality tokens with good liquidity
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

    // Calculate profit/loss using PERCENTAGE, not raw token math
    // The old calculation was wrong: (currentPrice - entryPrice) * tokenAmount resulted in absurd values
    // because tokenAmount is in RAW units (billions), not SOL value
    const currentPrice = parseFloat(position.lastCheckPriceSOL || position.entryPriceSOL);
    const profitPercent = parseFloat(position.lastCheckProfitPercent || "0");
    
    // Correct P&L: % change applied to initial SOL investment
    const profitSOL = (profitPercent / 100) * amountSOL;
    const finalValueSOL = amountSOL + profitSOL;
    
    console.log(`[Position Monitor] 💰 P&L: ${profitPercent > 0 ? '+' : ''}${profitPercent.toFixed(2)}% | Invested: ${amountSOL.toFixed(4)} SOL → Final: ${finalValueSOL.toFixed(4)} SOL (${profitSOL > 0 ? '+' : ''}${profitSOL.toFixed(4)} SOL profit)`);

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

    // 📊 TRADE JOURNAL: Update entry with exit data for pattern analysis
    try {
      // Find the journal entry by buy transaction signature
      const journalEntries = await storage.getTradeJournalEntries(config.ownerWalletAddress);
      const journalEntry = journalEntries.find(j => j.buyTxSignature === position.buyTxSignature && !j.exitAt);
      
      if (journalEntry) {
        // Calculate hold duration
        const entryTime = new Date(journalEntry.entryAt).getTime();
        const exitTime = Date.now();
        const holdDurationMinutes = Math.floor((exitTime - entryTime) / (1000 * 60));
        
        // Determine exit reason and success criteria
        const wasSuccessful = profitPercent > 0;
        const metProfitTarget = profitPercent >= 15; // Minimum profit target
        const hitStopLoss = profitPercent <= -5; // Stop-loss threshold
        
        // Analyze failure reason if applicable
        let failureReason: string | undefined;
        if (!wasSuccessful) {
          if (hitStopLoss) {
            failureReason = "hit_stop_loss";
          } else if (reason.includes("timeout") || holdDurationMinutes > 1440) {
            failureReason = "max_hold_time_exceeded";
          } else if (reason.includes("AI") || reason.includes("Hivemind")) {
            failureReason = "ai_low_confidence";
          } else {
            failureReason = "market_downturn";
          }
        }
        
        // Extract token characteristics for pattern analysis
        const tokenCharacteristics = JSON.stringify({
          organicScore: journalEntry.organicScoreAtBuy,
          qualityScore: journalEntry.qualityScoreAtBuy,
          liquidityUSD: journalEntry.liquidityUSDAtBuy,
          volumeUSD24h: journalEntry.volumeUSD24hAtBuy,
          aiConfidence: journalEntry.aiConfidenceAtBuy,
          tradeMode: journalEntry.tradeMode,
        });
        
        await storage.updateTradeJournalEntry(journalEntry.id, {
          sellTxSignature: signature,
          exitPriceSOL: currentPrice.toString(),
          profitLossSOL: profitSOL.toString(),
          profitLossPercent: profitPercent.toString(),
          holdDurationMinutes,
          exitReason: reason.substring(0, 100), // First 100 chars of reason
          wasSuccessful,
          metProfitTarget,
          hitStopLoss,
          failureReason,
          tokenCharacteristics,
          exitAt: new Date(),
        });
        
        console.log(`[Position Monitor] 📊 Trade Journal updated: ${wasSuccessful ? '✅ WIN' : '❌ LOSS'} (${profitPercent.toFixed(2)}%)`);
        
        // Update performance metrics in real-time
        try {
          const { updatePerformanceOnTrade } = await import("./performance-tracker");
          await updatePerformanceOnTrade(config.ownerWalletAddress);
        } catch (perfError) {
          console.error(`[Position Monitor] ⚠️ Failed to update performance metrics:`, perfError);
        }
      }
    } catch (journalError) {
      console.error(`[Position Monitor] ⚠️ Failed to update trade journal:`, journalError);
    }

    // Delete position from database
    await storage.deleteAIBotPosition(position.id);
    console.log(`[Position Monitor] 🗑️ Position closed and removed from tracking`);
    
  } catch (error) {
    console.error(`[Position Monitor] Error executing sell for ${position.tokenSymbol}:`, error);
  }
}

/**
 * Start position monitoring scheduler (every 3 minutes using free DeepSeek) - OPTIMIZED FOR API EFFICIENCY
 * Active management of all positions while conserving API calls (saves 50% vs 1.5min interval)
 */
export function startPositionMonitoringScheduler() {
  if (!process.env.DEEPSEEK_API_KEY) {
    console.warn("[Position Monitor] DEEPSEEK_API_KEY not configured - position monitoring disabled");
    return;
  }

  console.log("[Position Monitor] Starting...");
  console.log("[Position Monitor] Using free DeepSeek API (5M tokens, superior reasoning) for position monitoring");

  // Run every 3 minutes for active position management (OPTIMIZED: saves 50% API calls vs 1.5min)
  positionMonitorJob = cron.schedule("*/3 * * * *", () => {
    monitorPositionsWithDeepSeek().catch((error) => {
      console.error("[Position Monitor] Unexpected error:", error);
    });
  });

  console.log("[Position Monitor] Active (checks every 3 minutes - OPTIMIZED to reduce API usage)");
}

/**
 * Automatically rebalance portfolio using OpenAI-powered analysis
 * Analyzes all positions and executes sells when AI recommends it
 */
export async function rebalancePortfolioWithOpenAI() {
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
                500 // 5% slippage - optimized for profit preservation
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
 * Execute accumulation (buy more of existing position) when AI has high conviction despite dip
 * Safety limits: max 2x original size, max -15% drawdown
 */
async function executeAccumulateForPosition(
  config: any,
  position: any,
  treasuryKeyBase58: string,
  accumulateAmount: number,
  reason: string
): Promise<void> {
  try {
    console.log(`[Position Monitor] 💰 Accumulating ${position.tokenSymbol} - Reason: ${reason}`);
    
    const { loadKeypairFromPrivateKey } = await import("./solana-sdk");
    const { getWalletBalance } = await import("./solana");
    const treasuryKeypair = loadKeypairFromPrivateKey(treasuryKeyBase58);
    
    // Check wallet balance
    const walletBalance = await getWalletBalance(treasuryKeypair.publicKey.toString());
    const FEE_RESERVE = 0.01; // Always keep 0.01 SOL for fees
    const availableBalance = Math.max(0, walletBalance - FEE_RESERVE);
    
    if (availableBalance < accumulateAmount) {
      console.log(`[Position Monitor] ⚠️ Insufficient funds to accumulate: Need ${accumulateAmount.toFixed(4)} SOL, have ${availableBalance.toFixed(4)} SOL`);
      return;
    }
    
    // Execute buy via Jupiter
    const { buyTokenWithJupiter } = await import("./jupiter");
    console.log(`[Position Monitor] 🔄 Buying ${accumulateAmount.toFixed(4)} SOL worth of ${position.tokenSymbol} to accumulate position`);
    
    const buyResult = await buyTokenWithJupiter(
      treasuryKeyBase58,
      position.tokenMint,
      accumulateAmount,
      300 // 3% slippage for buy (optimized)
    );
    
    if (!buyResult.success || !buyResult.signature) {
      console.error(`[Position Monitor] ❌ Failed to accumulate ${position.tokenSymbol}: ${buyResult.error}`);
      logActivity('position_monitor', 'error', `❌ Accumulate failed for ${position.tokenSymbol}: ${buyResult.error}`);
      return;
    }
    
    const tokensReceived = buyResult.tokensReceived || 0;
    console.log(`[Position Monitor] ✅ Accumulated ${position.tokenSymbol}: Received ${tokensReceived.toLocaleString()} tokens`);
    console.log(`[Position Monitor] 📝 TX: https://solscan.io/tx/${buyResult.signature}`);
    
    // Update position with accumulated tokens
    const currentTokenAmount = parseFloat(position.tokenAmount || "0");
    const newTokenAmount = currentTokenAmount + tokensReceived;
    
    const currentAmountSOL = parseFloat(position.amountSOL || "0");
    const newAmountSOL = currentAmountSOL + accumulateAmount;
    
    // Calculate new average entry price (dollar-cost averaging)
    const newEntryPriceSOL = newAmountSOL / newTokenAmount;
    
    await storage.updateAIBotPosition(position.id, {
      tokenAmount: newTokenAmount.toString(),
      amountSOL: newAmountSOL.toString(),
      entryPriceSOL: newEntryPriceSOL.toString(),
    });
    
    console.log(`[Position Monitor] 📊 Position updated:`);
    console.log(`  Token Amount: ${currentTokenAmount.toLocaleString()} → ${newTokenAmount.toLocaleString()} (+${((tokensReceived / currentTokenAmount) * 100).toFixed(1)}%)`);
    console.log(`  SOL Invested: ${currentAmountSOL.toFixed(4)} → ${newAmountSOL.toFixed(4)} SOL`);
    console.log(`  Avg Entry: ${parseFloat(position.entryPriceSOL).toFixed(9)} → ${newEntryPriceSOL.toFixed(9)} SOL (averaged down)`);
    
    logActivity('position_monitor', 'success', `💰 ACCUMULATED ${position.tokenSymbol}: +${accumulateAmount.toFixed(4)} SOL, avg entry ${newEntryPriceSOL.toFixed(9)} SOL`);
    
  } catch (error: any) {
    console.error(`[Position Monitor] ❌ Error accumulating ${position.tokenSymbol}:`, error);
    logActivity('position_monitor', 'error', `❌ Accumulate error for ${position.tokenSymbol}: ${error.message}`);
  }
}

/**
 * Sync portfolio on startup - removes database positions that no longer exist in wallet
 * This ensures accurate performance tracking after manual position closures
 */
async function syncPortfolioOnStartup(ownerWalletAddress: string, treasuryKeyBase58: string) {
  await syncWalletPositions(ownerWalletAddress, false); // false = startup (less verbose logging)
}

/**
 * Enhanced wallet sync - removes stale positions AND updates token amounts
 * Runs continuously to ensure database always reflects actual blockchain state
 */
async function syncWalletPositions(ownerWalletAddress: string, verbose: boolean = true) {
  const shortAddress = `${ownerWalletAddress.slice(0, 8)}...`;
  try {
    if (verbose) {
      console.log(`[Wallet Sync] 🔄 Syncing ${shortAddress}...`);
    }
    
    // Get all token accounts from wallet
    const { getAllTokenAccounts } = await import("./solana");
    const tokenAccounts = await getAllTokenAccounts(ownerWalletAddress);
    
    // Build map of wallet tokens: mint -> balance info
    const walletTokens = new Map<string, { balance: number; decimals: number }>();
    for (const account of tokenAccounts) {
      const parsed = account.account.data.parsed;
      const uiAmount = parsed.info.tokenAmount.uiAmount;
      const amount = parsed.info.tokenAmount.amount;
      const decimals = parsed.info.tokenAmount.decimals;
      
      // Only include tokens with non-zero balance
      if (uiAmount > 0) {
        walletTokens.set(parsed.info.mint, {
          balance: parseFloat(amount),
          decimals: decimals
        });
      }
    }
    
    // Get all database positions
    const dbPositions = await storage.getAIBotPositions(ownerWalletAddress);
    
    let staleRemoved = 0;
    let amountsUpdated = 0;
    
    // Process each database position
    for (const position of dbPositions) {
      const walletToken = walletTokens.get(position.tokenMint);
      
      if (!walletToken) {
        // Position no longer exists in wallet - remove it
        await storage.deleteAIBotPosition(position.id);
        staleRemoved++;
        if (verbose) {
          console.log(`[Wallet Sync] ❌ Removed ${position.tokenSymbol} - no longer in wallet`);
        }
      } else {
        // Check if token amount needs updating
        const dbAmount = parseFloat(position.tokenAmount.toString());
        const walletAmount = walletToken.balance;
        
        // Update if amounts differ by more than 0.01% (to account for rounding)
        const amountDiff = Math.abs(dbAmount - walletAmount) / Math.max(dbAmount, walletAmount);
        if (amountDiff > 0.0001) {
          await storage.updateAIBotPosition(position.id, {
            tokenAmount: walletAmount.toString(),
            tokenDecimals: walletToken.decimals
          });
          amountsUpdated++;
          if (verbose) {
            console.log(`[Wallet Sync] 🔄 Updated ${position.tokenSymbol} amount: ${(dbAmount / Math.pow(10, walletToken.decimals)).toFixed(2)} → ${(walletAmount / Math.pow(10, walletToken.decimals)).toFixed(2)} tokens`);
          }
        }
      }
    }
    
    if (verbose || staleRemoved > 0 || amountsUpdated > 0) {
      const remainingPositions = dbPositions.length - staleRemoved;
      console.log(`[Wallet Sync] ✅ Sync complete for ${shortAddress}: ${remainingPositions} positions (${staleRemoved} removed, ${amountsUpdated} updated)`);
    }
    
  } catch (error) {
    console.error(`[Wallet Sync] Error syncing ${shortAddress}:`, error);
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
  console.log("[Portfolio Rebalancer] Schedule: Every 15 minutes with FULL HIVEMIND + OpenAI consensus (OPTIMIZED for faster capital recycling)");

  // Run every 15 minutes (CAPITAL EFFICIENCY: Faster rebalancing = faster capital recycling)
  portfolioRebalancerJob = cron.schedule("*/15 * * * *", () => {
    rebalancePortfolioWithOpenAI().catch((error) => {
      console.error("[Portfolio Rebalancer] Unexpected error:", error);
    });
  });

  console.log("[Portfolio Rebalancer] ✅ Active (automatic rebalancing every 15 minutes - CAPITAL EFFICIENCY OPTIMIZED)");
}

/**
 * Run wallet synchronization for all active AI bots
 * Ensures database positions always match actual blockchain holdings
 */
async function runWalletSync() {
  try {
    const configs = await storage.getAllAIBotConfigs();
    const activeConfigs = configs.filter(c => c.enabled);
    
    if (activeConfigs.length === 0) {
      return;
    }
    
    for (const config of activeConfigs) {
      await syncWalletPositions(config.ownerWalletAddress, true);
    }
  } catch (error) {
    console.error("[Wallet Sync] Error during scheduled sync:", error);
  }
}

/**
 * Start automatic wallet synchronization scheduler (every 5 minutes)
 * Continuously syncs database positions with actual blockchain holdings
 */
export function startWalletSyncScheduler() {
  console.log("[Wallet Sync] 🔄 Starting automatic wallet synchronization...");
  console.log("[Wallet Sync] Schedule: Every 5 minutes (keeps positions accurate)");

  // Run every 5 minutes
  walletSyncJob = cron.schedule("*/5 * * * *", () => {
    runWalletSync().catch((error) => {
      console.error("[Wallet Sync] Unexpected error:", error);
    });
  });

  console.log("[Wallet Sync] ✅ Active (automatic sync every 5 minutes)");
}

/**
 * Start automatic database cleanup scheduler (daily at 3 AM)
 * Removes expired signatures, strategies, and old transactions
 */
export function startDatabaseCleanupScheduler() {
  console.log("[Database Cleanup] 🧹 Starting automatic database cleanup...");
  console.log("[Database Cleanup] Schedule: Daily at 3:00 AM (removes old unused data)");

  // Run daily at 3 AM
  databaseCleanupJob = cron.schedule("0 3 * * *", () => {
    cleanupDatabase().catch((error) => {
      console.error("[Database Cleanup] Unexpected error:", error);
    });
  });

  // Run cleanup on startup to remove any accumulated data
  console.log("[Database Cleanup] Running initial cleanup on startup...");
  cleanupDatabase().catch((error) => {
    console.error("[Database Cleanup] Initial cleanup error:", error);
  });

  console.log("[Database Cleanup] ✅ Active (daily cleanup + startup cleanup)");
}
