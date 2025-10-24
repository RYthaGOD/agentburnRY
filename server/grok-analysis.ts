// AI-powered trading analysis service for PumpFun tokens
// Supports both Groq (free, Llama 3) and xAI Grok (paid)

import OpenAI from "openai";

/**
 * Intelligent OpenAI usage context for cost optimization
 */
export interface OpenAIUsageContext {
  isPeakHours?: boolean; // Use OpenAI during market hours (9am-5pm UTC)
  isHighConfidence?: boolean; // Potential swing trade (85%+ confidence expected)
  needsTieBreaker?: boolean; // Free models showed disagreement
  forceInclude?: boolean; // Always include OpenAI regardless of context
  forceExclude?: boolean; // Never include OpenAI (e.g., quick monitoring)
}

/**
 * Determine if we should include OpenAI based on smart usage strategy
 */
function shouldIncludeOpenAI(context: OpenAIUsageContext = {}): boolean {
  // Force decisions override everything
  if (context.forceExclude) return false;
  if (context.forceInclude) return true;

  // Use OpenAI in any of these strategic scenarios:
  // 1. Peak trading hours (better liquidity/volume = better trades worth OpenAI analysis)
  // 2. High-confidence opportunities (potential swing trades)
  // 3. Tie-breaker needed (free models disagree)
  return !!(context.isPeakHours || context.isHighConfidence || context.needsTieBreaker);
}

/**
 * Check if current time is peak trading hours (9am-5pm UTC)
 */
function isPeakTradingHours(): boolean {
  const now = new Date();
  const hour = now.getUTCHours();
  return hour >= 9 && hour < 17; // 9am-5pm UTC
}

/**
 * Get all available AI clients for hive mind consensus
 * @param context Optional context to determine smart OpenAI usage
 */
function getAllAIClients(context: OpenAIUsageContext = {}): Array<{ client: OpenAI; model: string; provider: string }> {
  const clients = [];
  const includeOpenAI = shouldIncludeOpenAI(context);

  // Cerebras (fast, free, Llama 4)
  if (process.env.CEREBRAS_API_KEY) {
    clients.push({
      client: new OpenAI({
        baseURL: "https://api.cerebras.ai/v1",
        apiKey: process.env.CEREBRAS_API_KEY,
      }),
      model: "llama-3.3-70b",
      provider: "Cerebras",
    });
  }

  // Google Gemini 2.5 Flash (1M tokens/min free, highest volume)
  if (process.env.GOOGLE_AI_KEY) {
    clients.push({
      client: new OpenAI({
        baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/",
        apiKey: process.env.GOOGLE_AI_KEY,
      }),
      model: "gemini-2.0-flash-exp",
      provider: "Google Gemini",
    });
  }

  // DeepSeek V3 (5M free tokens, ultra-cheap after, OpenAI compatible)
  if (process.env.DEEPSEEK_API_KEY) {
    clients.push({
      client: new OpenAI({
        baseURL: "https://api.deepseek.com",
        apiKey: process.env.DEEPSEEK_API_KEY,
      }),
      model: "deepseek-chat",
      provider: "DeepSeek",
    });
  }

  // ChatAnywhere GPT-4o-mini (200 req/day free, high quality)
  if (process.env.CHATANYWHERE_API_KEY) {
    clients.push({
      client: new OpenAI({
        baseURL: "https://api.chatanywhere.tech/v1",
        apiKey: process.env.CHATANYWHERE_API_KEY,
      }),
      model: "gpt-4o-mini",
      provider: "ChatAnywhere",
    });
  }

  // Together AI (200+ models, free tier)
  if (process.env.TOGETHER_API_KEY) {
    clients.push({
      client: new OpenAI({
        baseURL: "https://api.together.xyz/v1",
        apiKey: process.env.TOGETHER_API_KEY,
      }),
      model: "meta-llama/Meta-Llama-3.1-70B-Instruct-Turbo",
      provider: "Together AI",
    });
  }

  // OpenRouter (300+ models, free tier, fallback for variety)
  if (process.env.OPENROUTER_API_KEY) {
    clients.push({
      client: new OpenAI({
        baseURL: "https://openrouter.ai/api/v1",
        apiKey: process.env.OPENROUTER_API_KEY,
      }),
      model: "meta-llama/llama-3.3-70b-instruct",
      provider: "OpenRouter",
    });
  }

  // Groq (completely free with generous limits)
  if (process.env.GROQ_API_KEY) {
    clients.push({
      client: new OpenAI({
        baseURL: "https://api.groq.com/openai/v1",
        apiKey: process.env.GROQ_API_KEY,
      }),
      model: "llama-3.3-70b-versatile",
      provider: "Groq",
    });
  }

  // OpenAI Primary (GPT-4o-mini, high quality, paid) - Smart usage only
  if (includeOpenAI && process.env.OPENAI_API_KEY) {
    clients.push({
      client: new OpenAI({
        apiKey: process.env.OPENAI_API_KEY,
      }),
      model: "gpt-4o-mini",
      provider: "OpenAI",
    });
  }
  
  // OpenAI Backup (GPT-4o-mini, automatic failover when primary fails) - Smart usage only
  if (includeOpenAI && process.env.OPENAI_API_KEY_2) {
    clients.push({
      client: new OpenAI({
        apiKey: process.env.OPENAI_API_KEY_2,
      }),
      model: "gpt-4o-mini",
      provider: "OpenAI #2",
    });
  }
  
  // Fallback to xAI Grok (paid)
  if (process.env.XAI_API_KEY) {
    clients.push({
      client: new OpenAI({
        baseURL: "https://api.x.ai/v1",
        apiKey: process.env.XAI_API_KEY,
      }),
      model: "grok-4-fast-reasoning",
      provider: "xAI Grok",
    });
  }

  return clients;
}

/**
 * Initialize AI client - Single provider fallback (legacy)
 */
function getAIClient(): { client: OpenAI; model: string; provider: string } {
  const clients = getAllAIClients();
  
  if (clients.length === 0) {
    throw new Error("No AI API key configured. Set CEREBRAS_API_KEY, GOOGLE_AI_KEY, DEEPSEEK_API_KEY, CHATANYWHERE_API_KEY, TOGETHER_API_KEY, OPENROUTER_API_KEY, GROQ_API_KEY, OPENAI_API_KEY, OPENAI_API_KEY_2, or XAI_API_KEY");
  }

  // Return first available
  return clients[0];
}

// Check if any AI provider is configured
export function isGrokConfigured(): boolean {
  return !!(
    process.env.CEREBRAS_API_KEY || 
    process.env.GOOGLE_AI_KEY ||
    process.env.DEEPSEEK_API_KEY ||
    process.env.CHATANYWHERE_API_KEY ||
    process.env.TOGETHER_API_KEY ||
    process.env.OPENROUTER_API_KEY ||
    process.env.GROQ_API_KEY ||
    process.env.OPENAI_API_KEY ||
    process.env.OPENAI_API_KEY_2 ||
    process.env.XAI_API_KEY
  );
}

/**
 * Hive mind consensus: Query multiple AI models and combine their decisions
 * @param context Optional context for smart OpenAI usage optimization
 */
export async function analyzeTokenWithHiveMind(
  tokenData: TokenMarketData,
  userRiskTolerance: "low" | "medium" | "high",
  budgetPerTrade: number,
  minAgreement: number = 0.5, // Require 50% agreement
  context: OpenAIUsageContext = {}
): Promise<{
  analysis: TradingAnalysis;
  votes: Array<{ provider: string; analysis: TradingAnalysis; success: boolean; error?: string }>;
  consensus: string;
}> {
  // Auto-detect peak hours if not specified
  if (context.isPeakHours === undefined) {
    context.isPeakHours = isPeakTradingHours();
  }

  const clients = getAllAIClients(context);
  
  if (clients.length === 0) {
    throw new Error("No AI providers configured for hive mind");
  }

  const providers = clients.map(c => c.provider).join(", ");
  const openAIIncluded = clients.some(c => c.provider.includes("OpenAI"));
  console.log(`[Hive Mind] Querying ${clients.length} AI models${openAIIncluded ? ' (including OpenAI)' : ' (free only)'}: ${providers}`);
  
  // Query all models in parallel
  const votes = await Promise.all(
    clients.map(async ({ client, model, provider }) => {
      try {
        const analysis = await analyzeSingleModel(
          client,
          model,
          provider,
          tokenData,
          userRiskTolerance,
          budgetPerTrade
        );
        return { provider, analysis, success: true };
      } catch (error) {
        console.error(`[Hive Mind] ${provider} failed:`, error instanceof Error ? error.message : String(error));
        return {
          provider,
          analysis: {
            action: "hold" as const,
            confidence: 0,
            reasoning: `${provider} analysis failed`,
            potentialUpsidePercent: 0,
            riskLevel: "high" as const,
            keyFactors: ["Provider error"],
          },
          success: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    })
  );

  // Filter successful votes
  const successfulVotes = votes.filter(v => v.success);
  
  if (successfulVotes.length === 0) {
    throw new Error("All AI providers failed to analyze token");
  }

  console.log(`[Hive Mind] ${successfulVotes.length}/${clients.length} models responded successfully`);

  // Calculate weighted consensus
  const buyVotes = successfulVotes.filter(v => v.analysis.action === "buy");
  const sellVotes = successfulVotes.filter(v => v.analysis.action === "sell");
  const holdVotes = successfulVotes.filter(v => v.analysis.action === "hold");

  // Weight by confidence
  const buyWeight = buyVotes.reduce((sum, v) => sum + v.analysis.confidence, 0);
  const sellWeight = sellVotes.reduce((sum, v) => sum + v.analysis.confidence, 0);
  const holdWeight = holdVotes.reduce((sum, v) => sum + v.analysis.confidence, 0);

  const totalWeight = buyWeight + sellWeight + holdWeight;
  
  // Determine consensus action
  let consensusAction: "buy" | "sell" | "hold" = "hold";
  let consensusConfidence = 0;
  let consensusDescription = "";

  if (buyWeight > sellWeight && buyWeight > holdWeight) {
    const agreementPercent = buyVotes.length / successfulVotes.length;
    if (agreementPercent >= minAgreement) {
      consensusAction = "buy";
      consensusConfidence = buyWeight / totalWeight;
      consensusDescription = `${buyVotes.length}/${successfulVotes.length} models recommend BUY (${(agreementPercent * 100).toFixed(0)}% agreement)`;
    } else {
      consensusDescription = `Insufficient BUY consensus (${(agreementPercent * 100).toFixed(0)}% < ${(minAgreement * 100).toFixed(0)}% required)`;
    }
  } else if (sellWeight > buyWeight && sellWeight > holdWeight) {
    const agreementPercent = sellVotes.length / successfulVotes.length;
    if (agreementPercent >= minAgreement) {
      consensusAction = "sell";
      consensusConfidence = sellWeight / totalWeight;
      consensusDescription = `${sellVotes.length}/${successfulVotes.length} models recommend SELL (${(agreementPercent * 100).toFixed(0)}% agreement)`;
    } else {
      consensusDescription = `Insufficient SELL consensus (${(agreementPercent * 100).toFixed(0)}% < ${(minAgreement * 100).toFixed(0)}% required)`;
    }
  } else {
    consensusDescription = `No clear consensus - defaulting to HOLD`;
  }

  // Aggregate metrics
  const avgConfidence = successfulVotes.reduce((sum, v) => sum + v.analysis.confidence, 0) / successfulVotes.length;
  const avgUpside = successfulVotes.reduce((sum, v) => sum + v.analysis.potentialUpsidePercent, 0) / successfulVotes.length;
  
  // Collect all key factors (safely handle missing keyFactors)
  const allFactors = new Set<string>();
  successfulVotes.forEach(v => {
    if (v.analysis.keyFactors && Array.isArray(v.analysis.keyFactors)) {
      v.analysis.keyFactors.forEach(f => allFactors.add(f));
    }
  });

  // Determine risk level (use most conservative)
  const riskLevels = successfulVotes.map(v => v.analysis.riskLevel);
  const consensusRisk: "low" | "medium" | "high" = riskLevels.includes("high") ? "high" : 
                                                     riskLevels.includes("medium") ? "medium" : "low";

  const consensusAnalysis: TradingAnalysis = {
    action: consensusAction,
    confidence: consensusConfidence,
    reasoning: `${consensusDescription}. Avg confidence: ${(avgConfidence * 100).toFixed(1)}%. Models: ${votes.map(v => v.provider).join(", ")}`,
    potentialUpsidePercent: avgUpside,
    riskLevel: consensusRisk,
    suggestedBuyAmountSOL: consensusAction === "buy" ? budgetPerTrade : undefined,
    keyFactors: Array.from(allFactors),
  };

  console.log(`[Hive Mind] Consensus: ${consensusAction.toUpperCase()} (confidence: ${(consensusConfidence * 100).toFixed(1)}%)`);
  console.log(`[Hive Mind] ${consensusDescription}`);

  return {
    analysis: consensusAnalysis,
    votes,
    consensus: consensusDescription,
  };
}

/**
 * Analyze token with single AI model
 */
async function analyzeSingleModel(
  client: OpenAI,
  model: string,
  provider: string,
  tokenData: TokenMarketData,
  userRiskTolerance: "low" | "medium" | "high",
  budgetPerTrade: number
): Promise<TradingAnalysis> {
  // Calculate additional metrics for deeper analysis
  // Add safeguards for zero/near-zero values to prevent Infinity/NaN
  const safeMarketCap = Math.max(tokenData.marketCapUSD, 0.01);
  const safeVolume = Math.max(tokenData.volumeUSD24h, 0);
  const safeLiquidity = Math.max(tokenData.liquidityUSD || 0, 0);
  
  const volumeToMarketCapRatio = safeVolume / safeMarketCap;
  const liquidityToMarketCapRatio = safeLiquidity / safeMarketCap;
  const priceVolatility = Math.abs(tokenData.priceChange24h || 0);
  const hasRecentMomentum = (tokenData.priceChange1h || 0) > 0 && (tokenData.priceChange24h || 0) > 0;
  
  const prompt = `You are a CONSERVATIVE cryptocurrency trading analyst specializing in HIGH-QUALITY token selection for Solana. Your goal is to identify tokens with strong fundamentals and sustainable growth potential through COMPREHENSIVE, IN-DEPTH ANALYSIS.

**COMPREHENSIVE TOKEN DATA:**

**Basic Information:**
- Name: ${tokenData.name} (${tokenData.symbol})
- Mint Address: ${tokenData.mint}
- Current Price: $${tokenData.priceUSD.toFixed(6)} (${tokenData.priceSOL.toFixed(9)} SOL)
${tokenData.description ? `- Description: ${tokenData.description}` : ''}

**Market Metrics:**
- Market Cap: $${tokenData.marketCapUSD.toLocaleString()}
- 24h Trading Volume: $${tokenData.volumeUSD24h.toLocaleString()}
- Volume/Market Cap Ratio: ${(volumeToMarketCapRatio * 100).toFixed(2)}% (${volumeToMarketCapRatio > 0.15 ? 'HIGH activity' : volumeToMarketCapRatio > 0.05 ? 'MODERATE activity' : 'LOW activity'})
- Liquidity: $${(tokenData.liquidityUSD || 0).toLocaleString()}
- Liquidity/Market Cap Ratio: ${(liquidityToMarketCapRatio * 100).toFixed(2)}% (${liquidityToMarketCapRatio > 0.1 ? 'STRONG' : liquidityToMarketCapRatio > 0.05 ? 'ADEQUATE' : 'WEAK'})

**Price Action Analysis:**
- 1h Price Change: ${tokenData.priceChange1h ? (tokenData.priceChange1h > 0 ? '+' : '') + tokenData.priceChange1h.toFixed(2) + '%' : 'N/A'}
- 24h Price Change: ${tokenData.priceChange24h ? (tokenData.priceChange24h > 0 ? '+' : '') + tokenData.priceChange24h.toFixed(2) + '%' : 'N/A'}
- Momentum Status: ${hasRecentMomentum ? 'POSITIVE (both 1h and 24h gains)' : 'NEUTRAL or NEGATIVE'}
- Price Volatility (24h): ${priceVolatility.toFixed(2)}% (${priceVolatility > 30 ? 'HIGH risk' : priceVolatility > 15 ? 'MODERATE risk' : 'LOW risk'})

**Holder & Distribution:**
${tokenData.holderCount ? `- Holder Count: ${tokenData.holderCount.toLocaleString()} (${tokenData.holderCount > 1000 ? 'GOOD distribution' : tokenData.holderCount > 500 ? 'MODERATE distribution' : 'CONCENTRATED holdings - RISK'})` : '- Holder Count: Not available'}

**REQUIRED IN-DEPTH ANALYSIS FRAMEWORK:**

Perform a COMPREHENSIVE evaluation across ALL of these critical dimensions:

1. **FUNDAMENTAL QUALITY ASSESSMENT (40% weight)**
   - Token utility and use case strength
   - Project legitimacy and transparency
   - Development activity and roadmap
   - Community engagement and organic growth
   - Token distribution and concentration risks
   - Liquidity depth and sustainability

2. **TECHNICAL PRICE ACTION ANALYSIS (25% weight)**
   - Short-term momentum (1h, 24h trends)
   - Volume patterns and acceleration
   - Support/resistance levels based on price history
   - Volatility analysis and risk assessment
   - Price-to-volume correlation strength

3. **MARKET CONDITIONS & TIMING (20% weight)**
   - Market cap position relative to similar tokens
   - Volume/liquidity adequacy for safe entry/exit
   - Current market cycle stage (early, mid, late)
   - Competitive positioning in sector
   - Potential catalysts or upcoming events

4. **RISK EVALUATION (15% weight)**
   - Rug pull indicators (liquidity locks, dev wallets)
   - Holder concentration (whale manipulation risk)
   - Smart contract security (if verifiable)
   - Historical pump-and-dump patterns
   - Exit liquidity availability

**CONSERVATIVE COMPOUNDING STRATEGY:**
We prioritize HIGH-PROBABILITY trades with SUSTAINABLE returns:
- Look for tokens with strong fundamentals, not just hype
- Require clear technical indicators supporting entry
- Demand adequate liquidity for safe position management  
- Strict quality filters: prefer proven concepts over speculation
- Target realistic 25-50% gains over moonshot gambling
- ONLY recommend BUY at 70%+ confidence for high-quality setups
- Be highly selective - it's okay to say HOLD if conditions aren't ideal

**DECISION CRITERIA:**
For BUY recommendation (requires 70%+ confidence):
- Strong fundamentals (utility, team, community)
- Positive technical momentum (rising volume, bullish price action)
- Adequate liquidity (>$8k minimum, preferably >$15k)
- Healthy holder distribution (>500 holders preferred)
- Volume/market cap ratio >5% (indicates active interest)
- Clear upside catalyst or growth narrative
- Low rug pull risk indicators

For HOLD/SELL recommendation:
- Any red flags in fundamentals or technical analysis
- Insufficient liquidity or extreme volatility
- Concentration risks or whale manipulation signs
- Overextended price (already pumped significantly)
- Weakening volume or momentum deterioration

**OUTPUT FORMAT:**
Provide your DETAILED analysis in JSON with these exact fields:
{
  "action": "buy" | "sell" | "hold",
  "confidence": 0.0-1.0 (ONLY use 0.70+ for BUY recommendations),
  "reasoning": "comprehensive multi-paragraph analysis covering all 4 dimensions above with specific data points and conclusions",
  "potentialUpsidePercent": number (realistic estimate based on technical analysis and comparable tokens),
  "riskLevel": "low" | "medium" | "high" (based on thorough risk evaluation),
  "suggestedBuyAmountSOL": number (optional, if action is buy),
  "stopLossPercent": number (optional, suggested stop loss level),
  "takeProfitPercent": number (optional, suggested take profit level),
  "keyFactors": ["specific factor 1", "specific factor 2", ...] (list 5-8 specific factors that influenced your decision)
}

Be thorough, analytical, and CONSERVATIVE. Quality analysis over quick decisions.`;

  const response = await client.chat.completions.create({
    model: model,
    messages: [
      {
        role: "system",
        content: "You are a CONSERVATIVE cryptocurrency trading analyst focused on HIGH-PROBABILITY trades through comprehensive analysis. You specialize in identifying quality tokens with strong fundamentals and sustainable growth potential on Solana. You perform detailed, multi-dimensional analysis covering fundamentals, technicals, market conditions, and risk factors. You're thorough, analytical, and selective - preferring to pass on mediocre opportunities to wait for high-quality setups. Always respond with valid JSON containing detailed reasoning.",
      },
      {
        role: "user",
        content: prompt,
      },
    ],
    response_format: { type: "json_object" },
    temperature: 0.3, // Lower temperature for more consistent, analytical responses
    max_tokens: 2000, // Increased for more detailed analysis
  });

  const analysisText = response.choices[0].message.content;
  if (!analysisText) {
    throw new Error(`No response from ${provider}`);
  }

  const analysis = JSON.parse(analysisText) as TradingAnalysis;

  // Validate and enforce constraints
  if (analysis.action === "buy") {
    // Adjust suggested amount
    if (!analysis.suggestedBuyAmountSOL || analysis.suggestedBuyAmountSOL > budgetPerTrade) {
      analysis.suggestedBuyAmountSOL = budgetPerTrade;
    }

    // Require minimum confidence (lowered for aggressive trading with 6-model consensus)
    if (analysis.confidence < 0.4) {
      analysis.action = "hold";
      analysis.reasoning += " [Confidence below 40% threshold]";
    }
  }

  return analysis;
}

export interface TokenMarketData {
  mint: string;
  name: string;
  symbol: string;
  priceUSD: number;
  priceSOL: number;
  volumeUSD24h: number;
  marketCapUSD: number;
  holderCount?: number;
  priceChange24h?: number;
  priceChange1h?: number;
  liquidityUSD?: number;
  createdAt?: Date;
  description?: string;
}

export interface TradingAnalysis {
  action: "buy" | "sell" | "hold";
  confidence: number; // 0-1
  reasoning: string;
  potentialUpsidePercent: number;
  riskLevel: "low" | "medium" | "high";
  suggestedBuyAmountSOL?: number;
  stopLossPercent?: number;
  takeProfitPercent?: number;
  keyFactors: string[];
}

/**
 * Analyze a token using Grok AI
 */
export async function analyzeTokenWithGrok(
  tokenData: TokenMarketData,
  userRiskTolerance: "low" | "medium" | "high",
  budgetPerTrade: number
): Promise<TradingAnalysis> {
  try {
    const { client, model, provider } = getAIClient();
    console.log(`[AI Analysis] Using ${provider} - Model: ${model}`);
    
    // Build comprehensive prompt for AI analysis
    const prompt = `You are a professional cryptocurrency trading analyst specializing in Solana PumpFun tokens. Analyze the following token and provide a trading recommendation.

**Token Data:**
- Name: ${tokenData.name} (${tokenData.symbol})
- Mint Address: ${tokenData.mint}
- Current Price: $${tokenData.priceUSD.toFixed(6)} (${tokenData.priceSOL.toFixed(9)} SOL)
- 24h Volume: $${tokenData.volumeUSD24h.toLocaleString()}
- Market Cap: $${tokenData.marketCapUSD.toLocaleString()}
${tokenData.holderCount ? `- Holder Count: ${tokenData.holderCount.toLocaleString()}` : ''}
${tokenData.priceChange24h ? `- 24h Price Change: ${tokenData.priceChange24h > 0 ? '+' : ''}${tokenData.priceChange24h.toFixed(2)}%` : ''}
${tokenData.priceChange1h ? `- 1h Price Change: ${tokenData.priceChange1h > 0 ? '+' : ''}${tokenData.priceChange1h.toFixed(2)}%` : ''}
${tokenData.liquidityUSD ? `- Liquidity: $${tokenData.liquidityUSD.toLocaleString()}` : ''}
${tokenData.description ? `- Description: ${tokenData.description}` : ''}

**Trading Parameters:**
- Risk Tolerance: ${userRiskTolerance}
- Max Budget Per Trade: ${budgetPerTrade} SOL
- Trading Platform: PumpFun (Solana)

**Analysis Requirements:**
1. Evaluate volume, market cap, and price momentum
2. Assess liquidity and holder distribution
3. Identify potential red flags (rug pull indicators, low liquidity, suspicious volume)
4. Estimate potential upside and downside
5. Consider market conditions and token age

Provide your analysis in JSON format with these exact fields:
{
  "action": "buy" | "sell" | "hold",
  "confidence": 0.0-1.0,
  "reasoning": "detailed explanation",
  "potentialUpsidePercent": number,
  "riskLevel": "low" | "medium" | "high",
  "suggestedBuyAmountSOL": number (optional, if action is buy),
  "stopLossPercent": number (optional),
  "takeProfitPercent": number (optional),
  "keyFactors": ["factor1", "factor2", ...]
}`;

    console.log(`[Grok AI] Analyzing token ${tokenData.symbol}...`);

    const response = await client.chat.completions.create({
      model: model,
      messages: [
        {
          role: "system",
          content:
            "You are a professional cryptocurrency trading analyst. Analyze tokens objectively and provide actionable trading recommendations with risk assessments. Always respond with valid JSON.",
        },
        {
          role: "user",
          content: prompt,
        },
      ],
      response_format: { type: "json_object" },
      temperature: 0.7,
      max_tokens: 1000,
    });

    const analysisText = response.choices[0].message.content;
    if (!analysisText) {
      throw new Error("No response from Grok API");
    }

    const analysis = JSON.parse(analysisText) as TradingAnalysis;

    // Validate and enforce constraints based on risk tolerance
    if (analysis.action === "buy") {
      // CRITICAL: Enforce minimum 1.5X (150%) return requirement
      if (analysis.potentialUpsidePercent < 150) {
        console.log(`[AI Analysis] Rejecting ${tokenData.symbol}: ${analysis.potentialUpsidePercent}% upside < 150% minimum`);
        return {
          action: "hold",
          confidence: 0,
          reasoning: `Rejected: Only ${analysis.potentialUpsidePercent.toFixed(1)}% potential upside. Minimum 150% (1.5X) required for risk management.`,
          potentialUpsidePercent: analysis.potentialUpsidePercent,
          riskLevel: "high",
          keyFactors: ["Below minimum 1.5X return threshold"],
        };
      }

      // Adjust suggested amount based on risk tolerance
      if (!analysis.suggestedBuyAmountSOL || analysis.suggestedBuyAmountSOL > budgetPerTrade) {
        analysis.suggestedBuyAmountSOL = budgetPerTrade;
      }

      // Conservative limits for low risk tolerance
      if (userRiskTolerance === "low") {
        analysis.suggestedBuyAmountSOL = Math.min(
          analysis.suggestedBuyAmountSOL,
          budgetPerTrade * 0.5
        );
        if (analysis.confidence < 0.7) {
          analysis.action = "hold";
          analysis.reasoning += " [Confidence too low for low-risk profile]";
        }
      }

      // Require minimum confidence
      if (analysis.confidence < 0.5) {
        analysis.action = "hold";
        analysis.reasoning += " [Confidence below 50% threshold]";
      }
    }

    console.log(`[Grok AI] Analysis complete: ${analysis.action} (confidence: ${(analysis.confidence * 100).toFixed(1)}%)`);

    return analysis;
  } catch (error) {
    console.error(`[Grok AI] Analysis failed:`, error);

    // Return conservative hold recommendation on error
    return {
      action: "hold",
      confidence: 0,
      reasoning: `Analysis failed: ${error instanceof Error ? error.message : "Unknown error"}`,
      potentialUpsidePercent: 0,
      riskLevel: "high",
      keyFactors: ["Analysis error - defaulting to hold"],
    };
  }
}

/**
 * Batch analyze multiple tokens and rank them by potential
 */
export async function analyzeTokenBatch(
  tokens: TokenMarketData[],
  userRiskTolerance: "low" | "medium" | "high",
  budgetPerTrade: number
): Promise<Array<{ token: TokenMarketData; analysis: TradingAnalysis }>> {
  console.log(`[Grok AI] Batch analyzing ${tokens.length} tokens...`);

  const results = await Promise.all(
    tokens.map(async (token) => ({
      token,
      analysis: await analyzeTokenWithGrok(token, userRiskTolerance, budgetPerTrade),
    }))
  );

  // Sort by confidence * potentialUpside (best opportunities first)
  results.sort((a, b) => {
    const scoreA = a.analysis.confidence * a.analysis.potentialUpsidePercent;
    const scoreB = b.analysis.confidence * b.analysis.potentialUpsidePercent;
    return scoreB - scoreA;
  });

  console.log(
    `[Grok AI] Batch analysis complete: ${results.filter((r) => r.analysis.action === "buy").length} buy signals`
  );

  return results;
}

/**
 * Validate analysis result
 */
export function validateAnalysis(analysis: TradingAnalysis): boolean {
  if (!["buy", "sell", "hold"].includes(analysis.action)) return false;
  if (analysis.confidence < 0 || analysis.confidence > 1) return false;
  if (!analysis.reasoning || analysis.reasoning.length < 10) return false;
  if (!["low", "medium", "high"].includes(analysis.riskLevel)) return false;
  return true;
}
