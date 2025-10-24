// AI-powered trading analysis service for PumpFun tokens
// Supports both Groq (free, Llama 3) and xAI Grok (paid)

import OpenAI from "openai";

/**
 * Get all available AI clients for hive mind consensus
 */
function getAllAIClients(): Array<{ client: OpenAI; model: string; provider: string }> {
  const clients = [];

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
    throw new Error("No AI API key configured. Set CEREBRAS_API_KEY, GOOGLE_AI_KEY, DEEPSEEK_API_KEY, CHATANYWHERE_API_KEY, TOGETHER_API_KEY, OPENROUTER_API_KEY, GROQ_API_KEY, or XAI_API_KEY");
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
    process.env.XAI_API_KEY
  );
}

/**
 * Hive mind consensus: Query multiple AI models and combine their decisions
 */
export async function analyzeTokenWithHiveMind(
  tokenData: TokenMarketData,
  userRiskTolerance: "low" | "medium" | "high",
  budgetPerTrade: number,
  minAgreement: number = 0.6 // Require 60% agreement
): Promise<{
  analysis: TradingAnalysis;
  votes: Array<{ provider: string; analysis: TradingAnalysis; success: boolean; error?: string }>;
  consensus: string;
}> {
  const clients = getAllAIClients();
  
  if (clients.length === 0) {
    throw new Error("No AI providers configured for hive mind");
  }

  const providers = clients.map(c => c.provider).join(", ");
  console.log(`[Hive Mind] Querying ${clients.length} AI models for consensus: ${providers}`);
  
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
  
  // Collect all key factors
  const allFactors = new Set<string>();
  successfulVotes.forEach(v => v.analysis.keyFactors.forEach(f => allFactors.add(f)));

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

  const response = await client.chat.completions.create({
    model: model,
    messages: [
      {
        role: "system",
        content: "You are a professional cryptocurrency trading analyst. Analyze tokens objectively and provide actionable trading recommendations with risk assessments. Always respond with valid JSON.",
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
    throw new Error(`No response from ${provider}`);
  }

  const analysis = JSON.parse(analysisText) as TradingAnalysis;

  // Validate and enforce constraints
  if (analysis.action === "buy") {
    // Enforce minimum 1.5X return requirement
    if (analysis.potentialUpsidePercent < 150) {
      return {
        action: "hold",
        confidence: 0,
        reasoning: `${provider}: Rejected - Only ${analysis.potentialUpsidePercent.toFixed(1)}% upside (< 150% minimum)`,
        potentialUpsidePercent: analysis.potentialUpsidePercent,
        riskLevel: "high",
        keyFactors: ["Below minimum 1.5X return threshold"],
      };
    }

    // Adjust suggested amount
    if (!analysis.suggestedBuyAmountSOL || analysis.suggestedBuyAmountSOL > budgetPerTrade) {
      analysis.suggestedBuyAmountSOL = budgetPerTrade;
    }

    // Conservative limits for low risk tolerance
    if (userRiskTolerance === "low") {
      analysis.suggestedBuyAmountSOL = Math.min(analysis.suggestedBuyAmountSOL, budgetPerTrade * 0.5);
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
