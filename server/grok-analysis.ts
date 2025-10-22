// AI-powered trading analysis service for PumpFun tokens
// Supports both Groq (free, Llama 3) and xAI Grok (paid)

import OpenAI from "openai";

/**
 * Initialize AI client - Groq (free) preferred, xAI as fallback
 */
function getAIClient(): { client: OpenAI; model: string; provider: string } {
  // Prefer Groq (completely free with generous limits)
  if (process.env.GROQ_API_KEY) {
    return {
      client: new OpenAI({
        baseURL: "https://api.groq.com/openai/v1",
        apiKey: process.env.GROQ_API_KEY,
      }),
      model: "llama-3.1-70b-versatile", // Free, fast, excellent for analysis
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

  throw new Error("No AI API key configured. Set GROQ_API_KEY (free) or XAI_API_KEY (paid)");
}

// Check if any AI provider is configured
export function isGrokConfigured(): boolean {
  return !!(process.env.GROQ_API_KEY || process.env.XAI_API_KEY);
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
