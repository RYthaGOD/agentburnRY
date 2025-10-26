import { storage } from "./storage";
import { analyzeTokenWithHiveMind } from "./grok-analysis";

/**
 * Hivemind Strategy Generator
 * 
 * Uses FULL 7-MODEL AI CONSENSUS to generate tailored trading strategies based on market conditions.
 * AI learns from past performance and adapts strategy parameters intelligently.
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
 * Generate a new hivemind trading strategy using FULL 7-MODEL AI CONSENSUS
 * AI analyzes recent trading performance and learns optimal strategy parameters
 */
export async function generateHivemindStrategy(
  ownerWalletAddress: string,
  recentPerformance?: {
    winRate: number; // 0-100
    avgProfit: number; // Average profit %
    totalTrades: number;
    recentTrades?: Array<{
      tokenSymbol: string;
      profit: number;
      holdTime: number;
      entryConfidence: number;
    }>;
  }
): Promise<HivemindStrategy> {
  console.log(`[Hivemind Strategy] 🧠 FULL HIVEMIND: Generating intelligent strategy for ${ownerWalletAddress}...`);

  // If we have performance data, use AI to learn and optimize
  if (recentPerformance && recentPerformance.totalTrades >= 3) {
    console.log(`[Hivemind Strategy] Recent performance: ${recentPerformance.winRate.toFixed(1)}% win rate, ${recentPerformance.avgProfit.toFixed(1)}% avg profit over ${recentPerformance.totalTrades} trades`);
    
    try {
      // Use AI hivemind to analyze performance and suggest optimal strategy
      const aiStrategy = await generateAIStrategy(ownerWalletAddress, recentPerformance);
      return aiStrategy;
    } catch (error) {
      console.error(`[Hivemind Strategy] AI generation failed, falling back to rule-based:`, error);
      // Fallback to rule-based if AI fails
      return generateRuleBasedStrategy(recentPerformance);
    }
  } else {
    console.log(`[Hivemind Strategy] Insufficient trading history (${recentPerformance?.totalTrades || 0} trades), using conservative default`);
    return getDefaultStrategy();
  }
}

/**
 * Use FULL 7-MODEL AI HIVEMIND to intelligently generate strategy
 * AI learns from performance data and suggests optimal parameters
 */
async function generateAIStrategy(
  ownerWalletAddress: string,
  recentPerformance: {
    winRate: number;
    avgProfit: number;
    totalTrades: number;
    recentTrades?: Array<{
      tokenSymbol: string;
      profit: number;
      holdTime: number;
      entryConfidence: number;
    }>;
  }
): Promise<HivemindStrategy> {
  console.log(`[Hivemind Strategy] 🤖 Querying full 7-model AI hivemind for strategy optimization...`);

  // 📊 PATTERN ANALYSIS: Fetch trade journal insights to inform AI learning
  let patternInsights = "";
  try {
    const patterns = await storage.getTradePatterns(ownerWalletAddress);
    
    if (patterns.totalTrades > 0) {
      console.log(`[Hivemind Strategy] 📊 Pattern analysis: ${patterns.winRate.toFixed(1)}% win rate from ${patterns.totalTrades} trades`);
      
      // Format common failure reasons
      const failureReasons = patterns.commonFailureReasons.length > 0
        ? patterns.commonFailureReasons.slice(0, 3).map(f => `  - ${f.reason}: ${f.count} occurrences`).join('\n')
        : '  - No failure patterns detected yet';
      
      // Format successful characteristics
      const successChars = patterns.bestTokenCharacteristics.length > 0 ? patterns.bestTokenCharacteristics[0] : null;
      const successDetails = successChars && successChars.avgOrganicScore > 0
        ? `  - Avg Organic Score: ${successChars.avgOrganicScore.toFixed(0)}% (wins)
  - Avg Quality Score: ${successChars.avgQualityScore.toFixed(0)}% (wins)
  - Avg Liquidity: $${(successChars.avgLiquidityUSD / 1000).toFixed(0)}k
  - Avg Volume: $${(successChars.avgVolumeUSD / 1000).toFixed(0)}k`
        : '  - Insufficient data for pattern analysis';
      
      patternInsights = `

Trade Journal Pattern Analysis (${patterns.totalTrades} completed trades):
- Actual Win Rate: ${patterns.winRate.toFixed(1)}%
- Average Profit/Loss: ${patterns.avgProfit.toFixed(2)}%

Common Failure Reasons:
${failureReasons}

Characteristics of Winning Trades:
${successDetails}

CRITICAL INSIGHTS: Use this data to set quality filters that avoid past failures and focus on proven winning characteristics.`;
    }
  } catch (error) {
    console.error(`[Hivemind Strategy] ⚠️ Failed to fetch pattern analysis:`, error);
  }

  // Prepare performance analysis prompt for AI
  const performanceSummary = `
Recent Trading Performance Analysis:
- Total Trades: ${recentPerformance.totalTrades}
- Win Rate: ${recentPerformance.winRate.toFixed(1)}%
- Average Profit per Trade: ${recentPerformance.avgProfit.toFixed(2)}%
${recentPerformance.recentTrades ? `
Recent Trade Details:
${recentPerformance.recentTrades.slice(0, 10).map((t, i) => 
  `${i + 1}. ${t.tokenSymbol}: ${t.profit > 0 ? '+' : ''}${t.profit.toFixed(2)}% (held ${Math.round(t.holdTime / 60000)}min, entry confidence ${t.entryConfidence}%)`
).join('\n')}` : ''}
${patternInsights}

Current Strategy Parameters (Conservative Baseline):
- Min Confidence Threshold: 75%
- Max Daily Trades: 3
- Budget Per Trade: 0.02 SOL
- Min Volume: $25,000
- Min Liquidity: $20,000
- Min Organic Score: 70%
- Min Quality Score: 60%

Based on this performance data AND trade journal pattern analysis, what trading strategy adjustments would optimize for:
1. CAPITAL PRESERVATION (primary goal - minimize drawdowns)
2. Consistent compounding growth (avoid large losses)
3. Higher win rate through better quality filters
4. LEARN FROM FAILURES: Adjust filters to avoid repeating common failure patterns

Respond with a JSON object containing:
{
  "marketSentiment": "bullish" | "bearish" | "neutral" | "volatile",
  "confidence": 0-100,
  "minConfidenceThreshold": 65-90,
  "maxDailyTrades": 1-6,
  "budgetPerTrade": 0.015-0.04,
  "minVolumeUSD": 15000-80000,
  "minLiquidityUSD": 15000-40000,
  "minOrganicScore": 60-80,
  "minQualityScore": 50-70,
  "minTransactions24h": 30-100,
  "minPotentialPercent": 20-50,
  "profitTargetMultiplier": 0.3-1.5,
  "riskLevel": "conservative" | "moderate" | "aggressive",
  "reasoning": "detailed explanation of why these parameters optimize for capital preservation and compounding"
}

IMPORTANT: Be CONSERVATIVE. Prioritize capital preservation over aggressive growth.`;

  const prompt = performanceSummary;

  try {
    // Use hivemind consensus to generate strategy (using TokenMarketData format)
    const tokenData: any = {
      mint: ownerWalletAddress,
      name: "Strategy Analysis",
      symbol: "STRATEGY",
      priceUSD: 0,
      priceSOL: 1,
      volumeUSD24h: 0,
      marketCapUSD: 0,
      liquidityUSD: 0,
      priceChange24h: recentPerformance.avgProfit,
    };
    
    const result = await analyzeTokenWithHiveMind(
      tokenData,
      "low", // Risk tolerance
      0.02, // Budget per trade
      0.5 // Min agreement
    );

    console.log(`[Hivemind Strategy] 🧠 AI Consensus: ${result.consensus}`);
    console.log(`[Hivemind Strategy] 📊 AI Reasoning: ${result.analysis.reasoning.substring(0, 200)}...`);

    // Parse AI response to extract strategy parameters
    const aiSuggestion = parseAIStrategyResponse(result.analysis.reasoning);
    
    if (aiSuggestion) {
      console.log(`[Hivemind Strategy] ✅ Using AI-generated strategy: ${aiSuggestion.marketSentiment} market, ${aiSuggestion.riskLevel} risk`);
      return {
        ...aiSuggestion,
        generatedAt: new Date()
      };
    } else {
      // AI didn't return valid JSON, use confidence and reasoning
      console.log(`[Hivemind Strategy] ⚠️ AI response not in JSON format, deriving strategy from confidence`);
      return deriveStrategyFromAIConfidence(result.analysis.confidence, result.analysis.reasoning, recentPerformance);
    }
  } catch (error) {
    console.error(`[Hivemind Strategy] ❌ AI strategy generation failed:`, error);
    throw error;
  }
}

/**
 * Parse AI response to extract strategy parameters
 */
function parseAIStrategyResponse(reasoning: string): Partial<HivemindStrategy> | null {
  try {
    // Try to extract JSON from the reasoning
    const jsonMatch = reasoning.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;

    const parsed = JSON.parse(jsonMatch[0]);
    
    // Validate and return
    return {
      marketSentiment: parsed.marketSentiment || "neutral",
      preferredMarketCap: parsed.preferredMarketCap || "low",
      minConfidenceThreshold: Math.max(65, Math.min(90, parsed.minConfidenceThreshold || 75)),
      maxDailyTrades: Math.max(1, Math.min(6, parsed.maxDailyTrades || 3)),
      profitTargetMultiplier: Math.max(0.3, Math.min(1.5, parsed.profitTargetMultiplier || 0.8)),
      riskLevel: parsed.riskLevel || "conservative",
      budgetPerTrade: Math.max(0.015, Math.min(0.04, parsed.budgetPerTrade || 0.02)),
      minVolumeUSD: Math.max(15000, Math.min(80000, parsed.minVolumeUSD || 25000)),
      minLiquidityUSD: Math.max(15000, Math.min(40000, parsed.minLiquidityUSD || 20000)),
      minOrganicScore: Math.max(75, Math.min(95, parsed.minOrganicScore || 80)),
      minQualityScore: Math.max(65, Math.min(85, parsed.minQualityScore || 70)),
      minTransactions24h: Math.max(30, Math.min(100, parsed.minTransactions24h || 50)),
      minPotentialPercent: Math.max(20, Math.min(50, parsed.minPotentialPercent || 30)),
      reasoning: parsed.reasoning || reasoning.substring(0, 500),
    };
  } catch (error) {
    return null;
  }
}

/**
 * Derive strategy from AI confidence when JSON parsing fails
 */
function deriveStrategyFromAIConfidence(
  confidence: number,
  reasoning: string,
  recentPerformance: any
): HivemindStrategy {
  const { winRate, avgProfit } = recentPerformance;
  
  let marketSentiment: HivemindStrategy["marketSentiment"] = "neutral";
  if (confidence >= 75 && winRate > 60) marketSentiment = "bullish";
  else if (confidence < 50 || winRate < 40) marketSentiment = "bearish";
  else if (Math.abs(avgProfit) > 30) marketSentiment = "volatile";

  const strategy = generateStrategyFromSentiment(marketSentiment, confidence, []);
  strategy.reasoning = `AI Analysis (${confidence}% confidence): ${reasoning.substring(0, 300)}. ${strategy.reasoning}`;
  
  return strategy;
}

/**
 * Rule-based strategy generation (fallback when AI unavailable)
 */
function generateRuleBasedStrategy(recentPerformance: any): HivemindStrategy {
  const { winRate, avgProfit } = recentPerformance;
  
  let marketSentiment: HivemindStrategy["marketSentiment"] = "neutral";
  let confidence = 60;

  if (winRate > 60 && avgProfit > 20) {
    marketSentiment = "bullish";
    confidence = 75;
  } else if (winRate < 40 || avgProfit < 0) {
    marketSentiment = "bearish";
    confidence = 70;
  } else if (Math.abs(avgProfit) > 30) {
    marketSentiment = "volatile";
    confidence = 65;
  }

  const strategy = generateStrategyFromSentiment(marketSentiment, confidence, []);
  strategy.reasoning = `Rule-based (fallback): ${strategy.reasoning}`;
  
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
  
  // Hivemind-controlled parameters - STRICT WEALTH-GROWING APPROACH (CONSERVATIVE SETTINGS)
  let budgetPerTrade = 0.02; // REDUCED: Very small trades for capital preservation & drawdown minimization
  let minVolumeUSD = 25000; // CONSERVATIVE: Higher volume for better liquidity ($25k minimum)
  let minLiquidityUSD = 20000; // CONSERVATIVE: Much higher liquidity required for safe exits ($20k minimum)
  let minOrganicScore = 80; // STRICT: Higher organic volume requirement (80% minimum)
  let minQualityScore = 70; // STRICT: Higher quality requirement (70% minimum)
  let minTransactions24h = 50; // CONSERVATIVE: More active tokens only (50 minimum)
  let minPotentialPercent = 30; // Higher upside required to justify risk

  switch (sentiment) {
    case "bullish":
      // CONSERVATIVE even in bull markets - preserve capital and minimize drawdowns
      minConfidenceThreshold = 72; // INCREASED: Still very high threshold in bull markets
      maxDailyTrades = 4; // Limited trades
      profitTargetMultiplier = 1.0; // Moderate profit targets
      riskLevel = "moderate"; // Not aggressive
      preferredMarketCap = "low"; // Quality tokens
      
      budgetPerTrade = 0.025; // REDUCED: Small trades even in bull markets
      minVolumeUSD = 25000; // CONSERVATIVE: High volume even in bull market ($25k minimum)
      minLiquidityUSD = 20000; // CONSERVATIVE: High liquidity for safe exits ($20k minimum)
      minOrganicScore = 80; // STRICT: Maximum quality filter (80% minimum)
      minQualityScore = 70; // STRICT: Maximum quality filter (70% minimum)
      minTransactions24h = 50; // CONSERVATIVE: Active tokens required (50 minimum)
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
      minVolumeUSD = 25000; // CONSERVATIVE: Higher volume for safety ($25k minimum)
      minLiquidityUSD = 20000; // CONSERVATIVE: Higher liquidity for safe exits ($20k minimum)
      minOrganicScore = 70; // CONSERVATIVE: Strict in volatile conditions (70% minimum)
      minQualityScore = 60; // CONSERVATIVE: Strict quality (60% minimum)
      minTransactions24h = 50; // CONSERVATIVE: Higher activity required (50 minimum)
      minPotentialPercent = 35; // INCREASED: Need good upside to justify volatility risk
      break;

    case "neutral":
    default:
      // CONSERVATIVE by default - strict wealth-growing approach with minimal drawdowns
      minConfidenceThreshold = 75; // INCREASED: Higher default threshold
      maxDailyTrades = 3;
      profitTargetMultiplier = 0.8;
      riskLevel = "conservative";
      preferredMarketCap = "low";
      
      budgetPerTrade = 0.02; // REDUCED: Smaller default position size
      minVolumeUSD = 25000; // CONSERVATIVE: Higher volume requirement ($25k minimum)
      minLiquidityUSD = 20000; // CONSERVATIVE: Much higher liquidity requirement ($20k minimum)
      minOrganicScore = 70; // CONSERVATIVE: Stricter organic score (70% minimum)
      minQualityScore = 60; // CONSERVATIVE: Stricter quality score (60% minimum)
      minTransactions24h = 50; // CONSERVATIVE: More active tokens (50 minimum)
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
    minVolumeUSD: 25000, // CONSERVATIVE: Higher volume required ($25k minimum)
    minLiquidityUSD: 20000, // CONSERVATIVE: Much higher liquidity required ($20k minimum)
    minOrganicScore: 70, // CONSERVATIVE: Higher organic requirement (70% minimum)
    minQualityScore: 60, // CONSERVATIVE: Higher quality requirement (60% minimum)
    minTransactions24h: 50, // CONSERVATIVE: More active tokens only (50 minimum)
    minPotentialPercent: 30, // INCREASED: Better upside required
    reasoning: "Default conservative wealth-growing strategy - Capital preservation with minimal drawdowns through strict quality filters (70% organic, 60% quality, $25k volume, $20k liquidity)",
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
