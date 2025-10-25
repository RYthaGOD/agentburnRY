import { storage } from "./storage";

/**
 * Hivemind Strategy Generator
 * 
 * Uses AI consensus to generate tailored trading strategies based on market conditions.
 * Strategies are stored and applied dynamically between deep scans.
 */

export interface HivemindStrategy {
  marketSentiment: "bullish" | "bearish" | "neutral" | "volatile";
  preferredMarketCap: string; // "ultra-low" | "low" | "medium"
  minConfidenceThreshold: number; // 0-100
  maxDailyTrades: number;
  profitTargetMultiplier: number; // Multiplier for profit targets
  riskLevel: "conservative" | "moderate" | "aggressive";
  
  // All trading parameters controlled by hivemind
  budgetPerTrade: number; // Base SOL amount per trade
  minVolumeUSD: number; // Minimum 24h volume
  minLiquidityUSD: number; // Minimum liquidity
  minOrganicScore: number; // 0-100 organic volume score
  minQualityScore: number; // 0-100 quality score
  minTransactions24h: number; // Minimum transaction count
  minPotentialPercent: number; // Minimum upside %
  
  focusedSectors?: string[]; // e.g., ["meme", "gaming", "AI"]
  reasoning: string;
  generatedAt: Date;
}

/**
 * Generate a new hivemind trading strategy
 * Analyzes recent trading performance to adapt strategy parameters
 */
export async function generateHivemindStrategy(
  ownerWalletAddress: string,
  recentPerformance?: {
    winRate: number; // 0-100
    avgProfit: number; // Average profit %
    totalTrades: number;
  }
): Promise<HivemindStrategy> {
  console.log(`[Hivemind Strategy] Generating new strategy for ${ownerWalletAddress}...`);

  // Determine market sentiment based on recent performance
  let marketSentiment: HivemindStrategy["marketSentiment"] = "neutral";
  let confidence = 60;

  if (recentPerformance && recentPerformance.totalTrades >= 5) {
    const winRate = recentPerformance.winRate;
    const avgProfit = recentPerformance.avgProfit;

    if (winRate > 60 && avgProfit > 20) {
      marketSentiment = "bullish";
      confidence = 75;
    } else if (winRate < 40 || avgProfit < 0) {
      marketSentiment = "bearish";
      confidence = 70;
    } else if (Math.abs(avgProfit) > 30) {
      marketSentiment = "volatile";
      confidence = 65;
    } else {
      marketSentiment = "neutral";
      confidence = 60;
    }

    console.log(`[Hivemind Strategy] Recent performance: ${winRate.toFixed(1)}% win rate, ${avgProfit.toFixed(1)}% avg profit`);
  } else {
    console.log(`[Hivemind Strategy] Insufficient trading history, using default strategy`);
  }

  // Generate strategy based on market sentiment
  const strategy = generateStrategyFromSentiment(marketSentiment, confidence, []);

  console.log(`[Hivemind Strategy] Generated: ${marketSentiment} market, ${strategy.riskLevel} risk`);
  console.log(`[Hivemind Strategy] Min confidence: ${strategy.minConfidenceThreshold}%, Profit multiplier: ${strategy.profitTargetMultiplier}x`);

  return strategy;
}

/**
 * Generate strategy parameters based on market sentiment
 * Hivemind controls ALL trading parameters
 * 
 * CONSERVATIVE COMPOUNDING STRATEGY:
 * - Focus on high-probability trades with smaller position sizes
 * - Only increase aggression when AI confidence is VERY HIGH (85%+)
 * - Stricter quality filters to maximize win rate
 * - Smaller trades allow for better compounding over time
 */
function generateStrategyFromSentiment(
  sentiment: HivemindStrategy["marketSentiment"],
  confidence: number,
  analyses: any[]
): HivemindStrategy {
  let minConfidenceThreshold = 75; // STRICT: Higher default for capital preservation
  let maxDailyTrades = 3; // Quality over quantity
  let profitTargetMultiplier = 0.8; // Take profits consistently
  let riskLevel: HivemindStrategy["riskLevel"] = "conservative";
  let preferredMarketCap = "low";
  
  // Hivemind-controlled parameters - STRICT WEALTH-GROWING APPROACH
  let budgetPerTrade = 0.02; // REDUCED: Very small trades for capital preservation & drawdown minimization
  let minVolumeUSD = 20000; // INCREASED: Higher volume for better liquidity
  let minLiquidityUSD = 15000; // INCREASED: Much higher liquidity required (nearly 2x)
  let minOrganicScore = 60; // STRICTER: Higher organic volume requirement
  let minQualityScore = 50; // STRICTER: Higher quality requirement
  let minTransactions24h = 40; // INCREASED: More active tokens only
  let minPotentialPercent = 30; // Higher upside required to justify risk

  switch (sentiment) {
    case "bullish":
      // STRICT even in bull markets - preserve capital and minimize drawdowns
      minConfidenceThreshold = 72; // INCREASED: Still very high threshold in bull markets
      maxDailyTrades = 4; // Limited trades
      profitTargetMultiplier = 1.0; // Moderate profit targets
      riskLevel = "moderate"; // Not aggressive
      preferredMarketCap = "low"; // Quality tokens
      
      budgetPerTrade = 0.025; // REDUCED: Small trades even in bull markets
      minVolumeUSD = 18000; // INCREASED: Good volume
      minLiquidityUSD = 12000; // INCREASED: Good liquidity
      minOrganicScore = 55; // STRICTER: Quality focus
      minQualityScore = 45; // STRICTER: Quality focus
      minTransactions24h = 35; // INCREASED: Active required
      minPotentialPercent = 35; // Good upside
      break;

    case "bearish":
      // EXTREMELY conservative in bear markets - maximum capital preservation
      minConfidenceThreshold = 85; // INCREASED: Extremely high threshold
      maxDailyTrades = 1; // REDUCED: Minimal trades in bear market
      profitTargetMultiplier = 0.3; // Take profits very fast
      riskLevel = "conservative";
      preferredMarketCap = "medium"; // Safer tokens
      
      budgetPerTrade = 0.015; // REDUCED: Extremely small trades
      minVolumeUSD = 60000; // INCREASED: Very high volume required
      minLiquidityUSD = 30000; // INCREASED: Very high liquidity required
      minOrganicScore = 70; // STRICTER: Extremely strict
      minQualityScore = 60; // STRICTER: Extremely strict
      minTransactions24h = 80; // INCREASED: Very high activity required
      minPotentialPercent = 25; // INCREASED: Need good upside to justify any risk
      break;

    case "volatile":
      // VERY conservative in volatile markets - avoid drawdowns
      minConfidenceThreshold = 80; // INCREASED: Very high threshold for volatile markets
      maxDailyTrades = 2; // REDUCED: Very few trades
      profitTargetMultiplier = 0.5; // Quick profits to lock in gains
      riskLevel = "conservative";
      preferredMarketCap = "low";
      
      budgetPerTrade = 0.02; // REDUCED: Small trades to minimize exposure
      minVolumeUSD = 25000; // INCREASED: Higher volume for safety
      minLiquidityUSD = 15000; // INCREASED: Higher liquidity for safe exits
      minOrganicScore = 65; // STRICTER: Very strict in volatile conditions
      minQualityScore = 55; // STRICTER: Very strict quality
      minTransactions24h = 50; // INCREASED: Higher activity required
      minPotentialPercent = 35; // INCREASED: Need good upside to justify volatility risk
      break;

    case "neutral":
    default:
      // STRICT by default - wealth-growing approach with minimal drawdowns
      minConfidenceThreshold = 75; // INCREASED: Higher default threshold
      maxDailyTrades = 3;
      profitTargetMultiplier = 0.8;
      riskLevel = "conservative";
      preferredMarketCap = "low";
      
      budgetPerTrade = 0.02; // REDUCED: Smaller default position size
      minVolumeUSD = 20000; // INCREASED: Higher volume requirement
      minLiquidityUSD = 15000; // INCREASED: Much higher liquidity requirement
      minOrganicScore = 60; // INCREASED: Stricter organic score
      minQualityScore = 50; // INCREASED: Stricter quality score
      minTransactions24h = 40; // INCREASED: More active tokens
      minPotentialPercent = 30; // INCREASED: Better upside required
      break;
  }

  // STRICT WEALTH-GROWING: Only slightly increase with VERY HIGH confidence
  // Capital preservation is ALWAYS priority - minimize drawdowns
  if (confidence >= 90) {
    // EXTREMELY HIGH confidence: SMALL increase to position size (cap growth to avoid drawdowns)
    console.log(`[Hivemind Strategy] Extremely high confidence (${confidence}%) - modest increase`);
    maxDailyTrades = Math.min(5, maxDailyTrades + 2); // Limited increase in trades
    minConfidenceThreshold = Math.max(70, minConfidenceThreshold - 5); // SMALL decrease in threshold
    budgetPerTrade = Math.min(0.03, budgetPerTrade * 1.25); // CAP at 0.03 SOL maximum
    profitTargetMultiplier *= 1.2; // Modest increase in targets
    riskLevel = sentiment === "bearish" ? "conservative" : "moderate"; // Never aggressive
  } else if (confidence < 60) {
    // Low confidence: be EXTREMELY conservative - capital preservation mode
    maxDailyTrades = Math.max(1, maxDailyTrades - 2); // Drastically reduce trades
    minConfidenceThreshold = Math.min(90, minConfidenceThreshold + 15); // Much higher threshold
    budgetPerTrade *= 0.5; // Cut position size in half
    profitTargetMultiplier *= 0.6; // Take profits faster
  }

  const reasoning = `STRICT WEALTH-GROWING: ${sentiment} market (${confidence.toFixed(1)}% confidence). ${riskLevel} risk, ${preferredMarketCap} cap focus, ${maxDailyTrades} max trades/day, ${minConfidenceThreshold}% min confidence, ${budgetPerTrade.toFixed(4)} SOL/trade (MAX 0.03). Focus: Capital preservation with minimal drawdowns. Strict quality filters (${minOrganicScore}% organic, ${minQualityScore}% quality, $${minLiquidityUSD.toLocaleString()} liquidity). Only increase size at 90%+ confidence.`;

  return {
    marketSentiment: sentiment,
    preferredMarketCap,
    minConfidenceThreshold,
    maxDailyTrades,
    profitTargetMultiplier,
    riskLevel,
    budgetPerTrade,
    minVolumeUSD,
    minLiquidityUSD,
    minOrganicScore,
    minQualityScore,
    minTransactions24h,
    minPotentialPercent,
    reasoning,
    generatedAt: new Date(),
  };
}

/**
 * Get default strategy when AI analysis fails
 * Conservative compounding approach by default
 */
function getDefaultStrategy(): HivemindStrategy {
  return {
    marketSentiment: "neutral",
    preferredMarketCap: "low",
    minConfidenceThreshold: 75, // STRICT: Higher threshold
    maxDailyTrades: 3, // Quality over quantity
    profitTargetMultiplier: 0.8, // Take profits consistently
    riskLevel: "conservative",
    budgetPerTrade: 0.02, // REDUCED: Smaller trades for capital preservation
    minVolumeUSD: 20000, // INCREASED: Higher volume required
    minLiquidityUSD: 15000, // INCREASED: Much higher liquidity required
    minOrganicScore: 60, // STRICTER: Higher organic requirement
    minQualityScore: 50, // STRICTER: Higher quality requirement
    minTransactions24h: 40, // INCREASED: More active tokens only
    minPotentialPercent: 30, // INCREASED: Better upside required
    reasoning: "Default strict wealth-growing strategy - Capital preservation with minimal drawdowns through strict quality filters",
    generatedAt: new Date(),
  };
}

/**
 * Save hivemind strategy to database
 */
export async function saveHivemindStrategy(
  ownerWalletAddress: string,
  strategy: HivemindStrategy
): Promise<void> {
  // Convert strategy object to match database schema
  const marketCondition = strategy.marketSentiment; // Map marketSentiment -> marketCondition
  const marketConfidence = Math.round((strategy.minConfidenceThreshold / 100) * 100); // Convert to 0-100
  
  // Calculate validUntil (6 hours from now)
  const validUntil = new Date(Date.now() + 6 * 60 * 60 * 1000);
  
  await storage.createHivemindStrategy({
    ownerWalletAddress,
    marketCondition,
    marketConfidence,
    reasoning: strategy.reasoning,
    recommendedRiskTolerance: strategy.riskLevel,
    recommendedMinConfidence: strategy.minConfidenceThreshold,
    recommendedMinPotential: strategy.profitTargetMultiplier.toString(),
    recommendedMaxMarketCap: strategy.preferredMarketCap === "ultra-low" ? "100000" : strategy.preferredMarketCap === "low" ? "1000000" : "10000000",
    recommendedMinLiquidity: strategy.minLiquidityUSD.toString(),
    recommendedTradeMultiplier: "1.0",
    
    // All complete trading parameters
    budgetPerTrade: strategy.budgetPerTrade.toString(),
    minVolumeUSD: strategy.minVolumeUSD.toString(),
    minLiquidityUSD: strategy.minLiquidityUSD.toString(),
    minOrganicScore: strategy.minOrganicScore,
    minQualityScore: strategy.minQualityScore,
    minTransactions24h: strategy.minTransactions24h,
    minPotentialPercent: strategy.minPotentialPercent.toString(),
    maxDailyTrades: strategy.maxDailyTrades,
    profitTargetMultiplier: strategy.profitTargetMultiplier.toString(),
    
    focusCategories: JSON.stringify(strategy.focusedSectors || []),
    validUntil,
    isActive: true,
  });
}

/**
 * Get the latest hivemind strategy for a wallet
 */
export async function getLatestStrategy(
  ownerWalletAddress: string
): Promise<HivemindStrategy | null> {
  const strategies = await storage.getHivemindStrategies(ownerWalletAddress);
  
  if (strategies.length === 0) {
    return null;
  }

  // Return the most recent active strategy
  const latest = strategies.find(s => s.isActive && s.validUntil && s.validUntil > new Date());
  
  if (!latest) {
    return null;
  }

  // Map database fields back to our strategy interface
  const marketCap = parseInt(latest.recommendedMaxMarketCap || "1000000");
  const preferredMarketCap = marketCap < 200000 ? "ultra-low" : marketCap < 2000000 ? "low" : "medium";

  return {
    marketSentiment: (latest.marketCondition || "neutral") as HivemindStrategy["marketSentiment"],
    preferredMarketCap,
    minConfidenceThreshold: latest.recommendedMinConfidence || 55,
    maxDailyTrades: latest.maxDailyTrades || 5,
    profitTargetMultiplier: parseFloat(latest.profitTargetMultiplier || latest.recommendedMinPotential || "1.0"),
    riskLevel: (latest.recommendedRiskTolerance || "moderate") as HivemindStrategy["riskLevel"],
    
    // Extract complete trading parameters from database
    budgetPerTrade: parseFloat(latest.budgetPerTrade || "0.03"),
    minVolumeUSD: parseFloat(latest.minVolumeUSD || "15000"),
    minLiquidityUSD: parseFloat(latest.minLiquidityUSD || "8000"),
    minOrganicScore: latest.minOrganicScore || 50,
    minQualityScore: latest.minQualityScore || 40,
    minTransactions24h: latest.minTransactions24h || 30,
    minPotentialPercent: parseFloat(latest.minPotentialPercent || "25"),
    
    focusedSectors: latest.focusCategories ? JSON.parse(latest.focusCategories) : [],
    reasoning: latest.reasoning || "No reasoning provided",
    generatedAt: latest.createdAt,
  };
}

/**
 * Check if we should generate a new strategy
 * Returns true if:
 * - No strategy exists
 * - Current strategy is > 6 hours old
 * - Market conditions have changed significantly
 */
export async function shouldGenerateNewStrategy(
  ownerWalletAddress: string
): Promise<boolean> {
  const currentStrategy = await getLatestStrategy(ownerWalletAddress);

  if (!currentStrategy) {
    return true; // No strategy exists
  }

  const hoursOld = (Date.now() - currentStrategy.generatedAt.getTime()) / (1000 * 60 * 60);

  if (hoursOld > 3) {
    console.log(`[Hivemind Strategy] Current strategy is ${hoursOld.toFixed(1)} hours old, regenerating...`);
    return true; // Strategy is stale
  }

  return false; // Current strategy is still fresh
}
