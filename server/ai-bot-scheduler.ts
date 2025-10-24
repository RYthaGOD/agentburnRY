// AI Trading Bot Scheduler - Grok-powered PumpFun trading automation
// Scans PumpFun trending tokens, analyzes with Grok AI, and executes trades

import cron from "node-cron";
import { storage } from "./storage";
import { analyzeTokenWithGrok, analyzeTokenWithHiveMind, isGrokConfigured, type TokenMarketData } from "./grok-analysis";
import { buyTokenWithJupiter, getTokenPrice, getSwapOrder, executeSwapOrder, getWalletBalances } from "./jupiter";
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
  const [dexTokens, pumpfunTrendingTokens, pumpfunMigratedTokens, pumpfunLowCapTokens] = await Promise.all([
    fetchTrendingPumpFunTokens(config), // DexScreener trending
    fetchPumpFunTrendingTokens(15), // PumpFun top trending tokens
    fetchMigratedTokens(10), // Newly migrated tokens (PumpFun → Raydium)
    fetchLowMarketCapPumpFunTokens(10), // Very low market cap new tokens
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
  
  tokenDataCache.set(cacheKey, {
    tokens: allTokens,
    timestamp: now,
    expiresAt: now + CACHE_DURATION_MS,
  });

  return allTokens;
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

    // Fetch all existing positions once (optimization: avoid repeated database queries)
    const allExistingPositions = await storage.getAIBotPositions(project.ownerWalletAddress);
    console.log(`[AI Bot] 📊 Currently holding ${allExistingPositions.length} active positions`);

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
            console.log(`[AI Bot] ⏭️ SKIP ${token.symbol} - Max re-buys reached (${currentRebuyCount}/2)`);
            console.log(`[AI Bot]    Position opened at: ${entryPrice.toFixed(8)} SOL`);
            console.log(`[AI Bot]    Current price: ${currentPrice.toFixed(8)} SOL (${priceChangePercent > 0 ? '+' : ''}${priceChangePercent.toFixed(2)}%)`);
            continue;
          }
          
          // Only buy more if ALL conditions are met:
          // 1. Price has dropped at least 10% (drawback/dip)
          // 2. New AI confidence is higher than previous
          // 3. Haven't exceeded max 2 re-buys
          const hasDrawback = priceChangePercent <= -10; // Price down 10%+
          const hasHigherConfidence = newConfidence > previousConfidence;
          
          if (!hasDrawback || !hasHigherConfidence) {
            console.log(`[AI Bot] ⏭️ SKIP ${token.symbol} - Already holding position:`);
            console.log(`[AI Bot]    Previous entry: ${entryPrice.toFixed(8)} SOL (confidence: ${previousConfidence}%)`);
            console.log(`[AI Bot]    Current price: ${currentPrice.toFixed(8)} SOL (${priceChangePercent > 0 ? '+' : ''}${priceChangePercent.toFixed(2)}%)`);
            console.log(`[AI Bot]    New confidence: ${newConfidence.toFixed(1)}%`);
            console.log(`[AI Bot]    Re-buys: ${currentRebuyCount}/2`);
            console.log(`[AI Bot]    Drawback requirement: ${hasDrawback ? '✅' : '❌'} (need -10% dip, have ${priceChangePercent.toFixed(2)}%)`);
            console.log(`[AI Bot]    Higher confidence: ${hasHigherConfidence ? '✅' : '❌'} (need >${previousConfidence}%, have ${newConfidence.toFixed(1)}%)`);
            continue;
          }
          
          console.log(`[AI Bot] ✅ Adding to position ${token.symbol} (re-buy ${currentRebuyCount + 1}/2):`);
          console.log(`[AI Bot]    Price dropped ${Math.abs(priceChangePercent).toFixed(2)}% from entry (${entryPrice.toFixed(8)} → ${currentPrice.toFixed(8)} SOL)`);
          console.log(`[AI Bot]    Confidence increased from ${previousConfidence}% → ${newConfidence.toFixed(1)}%`);
        }

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

          // Save or update position in database
          if (existingPosition) {
            // Re-buy: Update existing position with new totals and increment rebuyCount
            const oldAmount = parseFloat(existingPosition.amountSOL);
            const oldEntryPrice = parseFloat(existingPosition.entryPriceSOL);
            const newTotalAmount = oldAmount + amountSOL;
            // Weighted average entry price
            const newAvgEntryPrice = (oldEntryPrice * oldAmount + token.priceSOL * amountSOL) / newTotalAmount;
            
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
          } else {
            // New position: Create it
            const aiConfidence = Math.round(analysis.confidence * 100);
            const isSwingTrade = aiConfidence >= 85 ? 1 : 0; // High confidence = swing trade
            
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
              aiConfidenceAtBuy: aiConfidence,
              aiPotentialAtBuy: analysis.potentialUpsidePercent.toString(),
              isSwingTrade,
            });
            
            if (isSwingTrade) {
              console.log(`[AI Bot] 🎯 SWING TRADE: High AI confidence (${aiConfidence}%) - using swing strategy for ${token.symbol}`);
            }
          }

          console.log(`[AI Bot] Trade executed successfully`);
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
 * Quick scan mode: Technical filters + fast Cerebras AI for 75%+ quality trades
 * Runs every 10 minutes with cached data for speed
 */
async function runQuickTechnicalScan() {
  try {
    console.log("[Quick Scan] Starting enhanced scan (technical + fast AI)...");
    
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
    
    // Check if Cerebras is available for fast AI analysis
    const hasCerebras = !!process.env.CEREBRAS_API_KEY;
    
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
            activePositions: new Map(),
          };
          aiBotStates.set(config.ownerWalletAddress, botState);
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

        // If Cerebras available, analyze top 2 opportunities with fast AI
        if (hasCerebras && opportunities.length > 0) {
          const topOpportunities = opportunities.slice(0, 2); // Only check top 2 to stay fast
          console.log(`[Quick Scan] 🧠 Analyzing top ${topOpportunities.length} with Cerebras (free, fast)...`);

          for (const token of topOpportunities) {
            // Quick Cerebras-only analysis for high confidence trades
            const riskTolerance = riskLevel === "aggressive" ? "high" : riskLevel === "conservative" ? "low" : "medium";
            const quickAnalysis = await analyzeTokenWithCerebrasOnly(
              token,
              riskTolerance,
              budgetPerTrade
            );

            // Use hivemind confidence threshold for quick trades
            if (quickAnalysis.action === "buy" && quickAnalysis.confidence >= minConfidenceThreshold) {
              console.log(`[Quick Scan] 🚀 HIGH QUALITY: ${token.symbol} - ${(quickAnalysis.confidence * 100).toFixed(1)}% confidence (>= ${(minConfidenceThreshold * 100).toFixed(0)}% hivemind threshold)`);
              
              // Execute trade immediately - don't wait for deep scan!
              await executeQuickTrade(config, token, quickAnalysis, botState, existingPositions);
            } else {
              console.log(`[Quick Scan] ⏭️ ${token.symbol}: ${quickAnalysis.action.toUpperCase()} ${(quickAnalysis.confidence * 100).toFixed(1)}% (below ${(minConfidenceThreshold * 100).toFixed(0)}% hivemind threshold, will re-analyze in deep scan)`);
            }
          }
        }
      } catch (error) {
        console.error(`[Quick Scan] Error for ${config.ownerWalletAddress}:`, error);
      }
    }
    
    console.log("[Quick Scan] Complete");
  } catch (error) {
    console.error("[Quick Scan] Error:", error);
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
 * Fast single-model analysis using Cerebras (free)
 * Used for quick 75%+ confidence trades
 * Results cached for 30 minutes to reduce API calls
 */
async function analyzeTokenWithCerebrasOnly(
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
  
  try {
    const cerebrasClient = new OpenAI({
      baseURL: "https://api.cerebras.ai/v1",
      apiKey: process.env.CEREBRAS_API_KEY,
    });

    const prompt = `Analyze this Solana token for trading (quick scan - single model decision):

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

Respond ONLY with valid JSON:
{
  "action": "buy" | "sell" | "hold",
  "confidence": 0.0 to 1.0,
  "reasoning": "brief explanation",
  "potentialUpsidePercent": number,
  "riskLevel": "low" | "medium" | "high"
}`;

    const response = await cerebrasClient.chat.completions.create({
      model: "llama-3.3-70b",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.3,
      max_tokens: 500,
    });

    const content = response.choices[0]?.message?.content || "{}";
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    const analysis = jsonMatch ? JSON.parse(jsonMatch[0]) : {
      action: "hold",
      confidence: 0,
      reasoning: "Failed to parse Cerebras response",
      potentialUpsidePercent: 0,
      riskLevel: "high",
    };

    // Cache the analysis result
    cacheAnalysis(tokenData.mint, analysis);

    return analysis;
  } catch (error) {
    console.error("[Cerebras] Quick analysis failed:", error);
    const errorAnalysis = {
      action: "hold" as const,
      confidence: 0,
      reasoning: "Cerebras analysis error",
      potentialUpsidePercent: 0,
      riskLevel: "high" as const,
    };
    
    // Don't cache error results
    return errorAnalysis;
  }
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
    const FEE_BUFFER = 0.01; // Always keep 0.01 SOL for fees
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

    if (tradeAmount <= 0) {
      console.log(`[Quick Scan] Insufficient funds for trade after all attempts (available: ${availableBalance.toFixed(4)} SOL)`);
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

    // Execute buy
    const result = await buyTokenWithJupiter(
      treasuryKeyBase58,
      token.mint,
      tradeAmount,
      1000 // 10% slippage
    );

    if (result.success && result.signature) {
      // Update budget tracking
      const budgetUsed = parseFloat(config.budgetUsed || "0");
      const newBudgetUsed = budgetUsed + tradeAmount;
      await storage.createOrUpdateAIBotConfig({
        ownerWalletAddress: config.ownerWalletAddress,
        budgetUsed: newBudgetUsed.toString(),
      });

      // Record transaction
      await storage.createTransaction({
        projectId: null as any, // null for standalone AI bot transactions
        type: "ai_buy",
        amount: tradeAmount.toString(),
        tokenAmount: "0",
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
        
        await storage.createAIBotPosition({
          ownerWalletAddress: config.ownerWalletAddress,
          tokenMint: token.mint,
          tokenSymbol: token.symbol,
          tokenName: token.name,
          entryPriceSOL: token.priceSOL.toString(),
          amountSOL: tradeAmount.toString(),
          tokenAmount: "0", // TBD from tx
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
 * AUTONOMOUS COMPOUNDING POSITION SIZING
 * Uses percentage of portfolio + AI confidence for exponential growth
 * 
 * Base: 0.02 SOL minimum (conservative floor for small portfolios)
 * Percentage-based: Grows as portfolio grows (enables TRUE compounding)
 * AI Confidence: Increases size for high confidence (up to 1.5x for 90%+ confidence)
 * Dynamic cap: 15% of total portfolio (scales with growth, not fixed)
 */
function calculateDynamicTradeAmount(
  baseAmount: number,
  confidence: number,
  availableBalance: number,
  portfolioValue: number = 0,
  portfolioPercentPerTrade: number = 10
): number {
  // Calculate percentage-based trade size (enables compounding as portfolio grows)
  const portfolioBasedAmount = (portfolioValue * portfolioPercentPerTrade) / 100;
  
  // Use the LARGER of: base amount OR portfolio-based amount (allows growth)
  let tradeSize = Math.max(baseAmount, portfolioBasedAmount);
  
  // AI Confidence multiplier (only increases for exceptional opportunities)
  // Conservative: Only increases for 85%+ confidence (swing trade territory)
  let confidenceMultiplier = 1.0;
  if (confidence >= 0.90) {
    confidenceMultiplier = 1.5; // Exceptional: 50% more
  } else if (confidence >= 0.85) {
    confidenceMultiplier = 1.25; // Very high: 25% more
  }
  // Below 85%: use base amount (no multiplier)
  
  tradeSize = tradeSize * confidenceMultiplier;
  
  // DYNAMIC CAP: Max 15% of portfolio per position (scales with growth!)
  // Small portfolio: ~0.02-0.05 SOL max
  // Medium portfolio (1 SOL): ~0.15 SOL max  
  // Large portfolio (10 SOL): ~1.5 SOL max (exponential compounding!)
  const dynamicMaxPosition = Math.max(0.03, portfolioValue * 0.15);
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
 * Run both project-based and standalone AI trading bots (deep scan with AI)
 */
async function runAITradingBots() {
  console.log("[Deep Scan] Starting full AI analysis...");
  await Promise.all([
    runProjectBasedAIBots(),
    runStandaloneAIBots(),
  ]);
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
  if (process.env.CHATANYWHERE_API_KEY) activeProviders.push("ChatAnywhere");
  if (process.env.TOGETHER_API_KEY) activeProviders.push("Together AI");
  if (process.env.OPENROUTER_API_KEY) activeProviders.push("OpenRouter");
  if (process.env.GROQ_API_KEY) activeProviders.push("Groq");
  if (process.env.OPENAI_API_KEY) activeProviders.push("OpenAI");
  if (process.env.OPENAI_API_KEY_2) activeProviders.push("OpenAI #2");
  if (process.env.XAI_API_KEY) activeProviders.push("xAI Grok");

  console.log("[AI Bot Scheduler] Starting...");
  console.log(`[AI Bot Scheduler] Active AI providers (${activeProviders.length}): ${activeProviders.join(", ")}`);

  // Quick scans every 10 minutes (technical filters only, uses cache)
  cron.schedule("*/10 * * * *", () => {
    runQuickTechnicalScan().catch((error) => {
      console.error("[Quick Scan] Unexpected error:", error);
    });
  });

  // Deep scans every 30 minutes (full AI analysis with all 6 models)
  cron.schedule("*/30 * * * *", () => {
    runAITradingBots().catch((error) => {
      console.error("[Deep Scan] Unexpected error:", error);
    });
  });

  console.log("[AI Bot Scheduler] Active");
  console.log("  - Quick scans: Every 10 minutes (technical + Cerebras AI for 75%+ trades)");
  console.log("  - Deep scans: Every 30 minutes (6-model consensus for all opportunities)");
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
    // Fetch all token balances from Jupiter Ultra API
    const balancesData = await getWalletBalances(walletAddress);
    
    // Parse holdings and calculate values
    const holdings: PortfolioHolding[] = [];
    let totalTokenValueSOL = 0;
    
    if (balancesData && balancesData.balances && Array.isArray(balancesData.balances)) {
      // Collect all token mints for batch price fetching (exclude SOL)
      const tokenMints = balancesData.balances
        .filter((b: any) => b.mint && b.amount && b.amount > 0 && b.mint !== "So11111111111111111111111111111111111111112")
        .map((b: any) => b.mint);
      
      // Fetch ALL prices in a single batch API call (avoids rate limiting!)
      const { getBatchTokenPrices } = await import("./jupiter");
      const priceMap = await getBatchTokenPrices(tokenMints);
      
      // Build holdings array with prices from batch response
      for (const balance of balancesData.balances) {
        if (!balance.mint || !balance.amount || balance.amount === 0) continue;
        
        // Skip SOL (native token)
        if (balance.mint === "So11111111111111111111111111111111111111112") continue;
        
        const priceSOL = priceMap.get(balance.mint);
        if (priceSOL && priceSOL > 0) {
          const valueSOL = balance.amount * priceSOL;
          totalTokenValueSOL += valueSOL;
          
          holdings.push({
            mint: balance.mint,
            symbol: balance.symbol || "UNKNOWN",
            amount: balance.amount,
            valueSOL,
            percentOfPortfolio: 0, // Will calculate after we know total
          });
        } else {
          // Skip tokens we can't price
          console.log(`[Portfolio] Could not price token ${balance.symbol || balance.mint}`);
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
    console.error("[Portfolio] Error analyzing portfolio:", error);
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
    const FEE_BUFFER = 0.01; // Always keep 0.01 SOL for fees
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

      // Use Hive Mind for multi-model consensus
      const hiveMindResult = await analyzeTokenWithHiveMind(token, riskTolerance, budgetPerTrade, 0.6);
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
        
        if (tradeAmount <= 0) {
          addLog(`⏭️ SKIP ${token.symbol}: Insufficient funds (available: ${availableBalance.toFixed(4)} SOL)`, "warning");
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

        // Buy using Jupiter Ultra API for better routing and pricing
        const result = await buyTokenWithJupiter(
          treasuryKeyBase58,
          token.mint,
          tradeAmount,
          1000 // 10% slippage (1000 bps)
        );

        if (result.success && result.signature) {
          // Update budget tracking and available balance
          const newBudgetUsed = budgetUsed + tradeAmount;
          availableBalance -= tradeAmount;
          await storage.createOrUpdateAIBotConfig({
            ownerWalletAddress,
            budgetUsed: newBudgetUsed.toString(),
          });
          addLog(`💰 Budget updated: ${newBudgetUsed.toFixed(4)}/${totalBudget.toFixed(4)} SOL used (${availableBalance.toFixed(4)} SOL remaining)`, "info");

          // Record transaction (no project ID for standalone)
          await storage.createTransaction({
            projectId: null as any, // null for standalone AI bot transactions
            type: "ai_buy",
            amount: tradeAmount.toString(),
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
            
            await storage.createAIBotPosition({
              ownerWalletAddress,
              tokenMint: token.mint,
              tokenSymbol: token.symbol,
              tokenName: token.name,
              entryPriceSOL: token.priceSOL.toString(),
              amountSOL: tradeAmount.toString(),
              tokenAmount: "0", // Would need to calculate from tx
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
  positions: Array<{ mint: string; currentPriceSOL: number; profitPercent: number; symbol: string }>
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
    // Use fast AI model for portfolio analysis
    const { client, model } = getAIClient();
    const response = await client.chat.completions.create({
      model: model,
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
 * Monitor open positions using Cerebras (free API)
 * Runs every 5 minutes to check position status and make sell recommendations
 */
async function monitorPositionsWithCerebras() {
  if (!process.env.CEREBRAS_API_KEY) {
    console.log("[Position Monitor] Cerebras API key not configured - skipping monitoring");
    return;
  }

  try {
    console.log("[Position Monitor] Checking open positions with Cerebras...");
    
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

        console.log(`[Position Monitor] Checking ${positions.length} positions for ${config.ownerWalletAddress.slice(0, 8)}...`);

        // Fetch ALL position prices in a single batch API call (avoids rate limiting!)
        const mints = positions.map(p => p.tokenMint);
        const { getBatchTokenPrices } = await import("./jupiter");
        const priceMap = await getBatchTokenPrices(mints);

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

          } catch (error) {
            console.error(`[Position Monitor] Error monitoring ${position.tokenSymbol}:`, error);
          }
        }

      } catch (error) {
        console.error(`[Position Monitor] Error for wallet ${config.ownerWalletAddress}:`, error);
      }
    }

  } catch (error) {
    console.error("[Position Monitor] Error:", error);
  }
}

/**
 * Start position monitoring scheduler (every 2.5 minutes using free Cerebras)
 * Active management of all positions for optimal performance
 */
export function startPositionMonitoringScheduler() {
  if (!process.env.CEREBRAS_API_KEY) {
    console.warn("[Position Monitor] CEREBRAS_API_KEY not configured - position monitoring disabled");
    return;
  }

  console.log("[Position Monitor] Starting...");
  console.log("[Position Monitor] Using free Cerebras API for position monitoring");

  // Run every 2.5 minutes for active position management
  // Using 2-minute intervals with offset to achieve 2.5-minute frequency
  let isOffset = false;
  cron.schedule("*/2 * * * *", () => {
    if (isOffset) {
      // Run at 2.5-minute mark (30 seconds delay)
      setTimeout(() => {
        monitorPositionsWithCerebras().catch((error) => {
          console.error("[Position Monitor] Unexpected error:", error);
        });
      }, 30000);
    } else {
      // Run immediately at 2-minute mark
      monitorPositionsWithCerebras().catch((error) => {
        console.error("[Position Monitor] Unexpected error:", error);
      });
    }
    isOffset = !isOffset; // Alternate between immediate and delayed execution
  });

  console.log("[Position Monitor] Active (checks every 2.5 minutes for active management)");
}
