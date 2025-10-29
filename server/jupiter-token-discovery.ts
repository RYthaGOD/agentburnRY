/**
 * 🚀 Jupiter Token Discovery
 * Uses Jupiter's Token API V2 for reliable token discovery
 * Better rate limits than DexScreener
 * 
 * API Docs: https://dev.jup.ag/docs/token-api/v2
 */

import type { TokenMarketData } from "./ai-bot-scheduler.js";

const JUPITER_TOKEN_API = "https://lite-api.jup.ag/tokens/v2";

interface JupiterToken {
  id: string; // Mint address
  name: string;
  symbol: string;
  icon?: string;
  decimals: number;
  circSupply?: number;
  totalSupply?: number;
  holderCount?: number;
  audit?: {
    mintAuthorityDisabled?: boolean;
    freezeAuthorityDisabled?: boolean;
    topHoldersPercentage?: number;
  };
  organicScore?: number;
  organicScoreLabel?: string;
  isVerified?: boolean;
  cexes?: string[];
  tags?: string[];
  fdv?: number; // Fully diluted valuation
  mcap?: number; // Market cap
  usdPrice?: number;
  liquidity?: number;
  stats5m?: {
    priceChange?: number;
  };
  stats1h?: {
    priceChange?: number;
  };
  stats24h?: {
    priceChange?: number;
    volume?: number;
    txnCount?: number;
  };
}

/**
 * Fetch trending tokens from Jupiter API
 * @param interval Time interval for trending data ('5m', '1h', '6h', '24h')
 * @param maxTokens Maximum number of tokens to return
 */
export async function fetchTrendingTokensFromJupiter(
  interval: '5m' | '1h' | '6h' | '24h' = '1h',
  maxTokens: number = 50
): Promise<TokenMarketData[]> {
  try {
    console.log(`[Jupiter API] 🚀 Fetching trending tokens (interval: ${interval})...`);
    
    // Fetch trending tokens
    const trendingUrl = `${JUPITER_TOKEN_API}/toptrending/${interval}`;
    const response = await fetch(trendingUrl, {
      headers: { 'Accept': 'application/json' },
    });

    if (!response.ok) {
      console.error(`[Jupiter API] API error: ${response.status}`);
      return [];
    }

    const tokens: JupiterToken[] = await response.json();
    console.log(`[Jupiter API] ✅ Fetched ${tokens.length} trending tokens`);

    // Convert to TokenMarketData format with detailed logging
    const tokenData: TokenMarketData[] = [];
    for (const token of tokens.slice(0, maxTokens)) {
      // Calculate SOL price from USD price
      const SOL_PRICE_USD = 145; // Approximate SOL price
      const priceSOL = token.usdPrice ? token.usdPrice / SOL_PRICE_USD : 0;
      
      // Extract volume from different possible locations
      const volumeUSD24h = token.stats24h?.buyVolume && token.stats24h?.sellVolume
        ? (token.stats24h.buyVolume + token.stats24h.sellVolume)
        : (token.stats24h?.volume || 0);

      tokenData.push({
        mint: token.id,
        name: token.name,
        symbol: token.symbol,
        priceUSD: token.usdPrice || 0,
        priceSOL: priceSOL,
        volumeUSD24h: volumeUSD24h,
        marketCapUSD: token.mcap || 0,
        liquidityUSD: token.liquidity,
        priceChange24h: token.stats24h?.priceChange,
        priceChange1h: token.stats1h?.priceChange,
        holderCount: token.holderCount,
        transactionCount24h: token.stats24h?.numBuys && token.stats24h?.numSells
          ? (token.stats24h.numBuys + token.stats24h.numSells)
          : undefined,
        buyPressure: token.stats24h?.numBuys && token.stats24h?.numSells
          ? Math.round((token.stats24h.numBuys / (token.stats24h.numBuys + token.stats24h.numSells)) * 100)
          : undefined,
        volumeToLiquidityRatio: token.liquidity && volumeUSD24h
          ? Number((volumeUSD24h / token.liquidity).toFixed(2))
          : undefined,
      });
    }
    
    // Debug: Show sample token volumes
    if (tokenData.length > 0) {
      console.log(`[Jupiter API] Sample volumes: ${tokenData.slice(0, 3).map(t => `${t.symbol}=$${t.volumeUSD24h.toLocaleString()}`).join(', ')}`);
    }

    return tokenData;
  } catch (error) {
    console.error("[Jupiter API] Error fetching trending tokens:", error);
    return [];
  }
}

/**
 * Fetch top traded tokens from Jupiter API
 * @param interval Time interval for trading data ('5m', '1h', '6h', '24h')
 * @param maxTokens Maximum number of tokens to return
 */
export async function fetchTopTradedTokensFromJupiter(
  interval: '5m' | '1h' | '6h' | '24h' = '24h',
  maxTokens: number = 50
): Promise<TokenMarketData[]> {
  try {
    console.log(`[Jupiter API] 📊 Fetching top traded tokens (interval: ${interval})...`);
    
    const tradedUrl = `${JUPITER_TOKEN_API}/toptraded/${interval}`;
    const response = await fetch(tradedUrl, {
      headers: { 'Accept': 'application/json' },
    });

    if (!response.ok) {
      console.error(`[Jupiter API] API error: ${response.status}`);
      return [];
    }

    const tokens: JupiterToken[] = await response.json();
    console.log(`[Jupiter API] ✅ Fetched ${tokens.length} top traded tokens`);

    // Convert to TokenMarketData format
    const SOL_PRICE_USD = 145;
    const tokenData: TokenMarketData[] = [];
    for (const token of tokens.slice(0, maxTokens)) {
      const priceSOL = token.usdPrice ? token.usdPrice / SOL_PRICE_USD : 0;
      
      const volumeUSD24h = token.stats24h?.buyVolume && token.stats24h?.sellVolume
        ? (token.stats24h.buyVolume + token.stats24h.sellVolume)
        : (token.stats24h?.volume || 0);

      tokenData.push({
        mint: token.id,
        name: token.name,
        symbol: token.symbol,
        priceUSD: token.usdPrice || 0,
        priceSOL: priceSOL,
        volumeUSD24h: volumeUSD24h,
        marketCapUSD: token.mcap || 0,
        liquidityUSD: token.liquidity,
        priceChange24h: token.stats24h?.priceChange,
        priceChange1h: token.stats1h?.priceChange,
        holderCount: token.holderCount,
        transactionCount24h: token.stats24h?.numBuys && token.stats24h?.numSells
          ? (token.stats24h.numBuys + token.stats24h.numSells)
          : undefined,
        buyPressure: token.stats24h?.numBuys && token.stats24h?.numSells
          ? Math.round((token.stats24h.numBuys / (token.stats24h.numBuys + token.stats24h.numSells)) * 100)
          : undefined,
        volumeToLiquidityRatio: token.liquidity && volumeUSD24h
          ? Number((volumeUSD24h / token.liquidity).toFixed(2))
          : undefined,
      });
    }

    return tokenData;
  } catch (error) {
    console.error("[Jupiter API] Error fetching top traded tokens:", error);
    return [];
  }
}

/**
 * Fetch tokens with high organic scores from Jupiter API
 * Organic score indicates genuine community engagement vs artificial activity
 * @param interval Time interval ('5m', '1h', '6h', '24h')
 * @param maxTokens Maximum number of tokens to return
 */
export async function fetchHighOrganicScoreTokensFromJupiter(
  interval: '5m' | '1h' | '6h' | '24h' = '1h',
  maxTokens: number = 50
): Promise<TokenMarketData[]> {
  try {
    console.log(`[Jupiter API] ⭐ Fetching high organic score tokens (interval: ${interval})...`);
    
    const organicUrl = `${JUPITER_TOKEN_API}/toporganicscore/${interval}`;
    const response = await fetch(organicUrl, {
      headers: { 'Accept': 'application/json' },
    });

    if (!response.ok) {
      console.error(`[Jupiter API] API error: ${response.status}`);
      return [];
    }

    const tokens: JupiterToken[] = await response.json();
    console.log(`[Jupiter API] ✅ Fetched ${tokens.length} high organic score tokens`);

    // Convert to TokenMarketData format
    const SOL_PRICE_USD = 145;
    const tokenData: TokenMarketData[] = [];
    for (const token of tokens.slice(0, maxTokens)) {
      const priceSOL = token.usdPrice ? token.usdPrice / SOL_PRICE_USD : 0;
      
      const volumeUSD24h = token.stats24h?.buyVolume && token.stats24h?.sellVolume
        ? (token.stats24h.buyVolume + token.stats24h.sellVolume)
        : (token.stats24h?.volume || 0);

      tokenData.push({
        mint: token.id,
        name: token.name,
        symbol: token.symbol,
        priceUSD: token.usdPrice || 0,
        priceSOL: priceSOL,
        volumeUSD24h: volumeUSD24h,
        marketCapUSD: token.mcap || 0,
        liquidityUSD: token.liquidity,
        priceChange24h: token.stats24h?.priceChange,
        priceChange1h: token.stats1h?.priceChange,
        holderCount: token.holderCount,
        transactionCount24h: token.stats24h?.numBuys && token.stats24h?.numSells
          ? (token.stats24h.numBuys + token.stats24h.numSells)
          : undefined,
        buyPressure: token.stats24h?.numBuys && token.stats24h?.numSells
          ? Math.round((token.stats24h.numBuys / (token.stats24h.numBuys + token.stats24h.numSells)) * 100)
          : undefined,
        volumeToLiquidityRatio: token.liquidity && volumeUSD24h
          ? Number((volumeUSD24h / token.liquidity).toFixed(2))
          : undefined,
      });
    }

    return tokenData;
  } catch (error) {
    console.error("[Jupiter API] Error fetching high organic score tokens:", error);
    return [];
  }
}

/**
 * Main token discovery function - fetches from multiple Jupiter API endpoints
 * Combines trending, top traded, and high organic score tokens for maximum opportunity discovery
 */
export async function fetchTokensFromJupiter(maxTokens: number = 100): Promise<TokenMarketData[]> {
  try {
    console.log("[Jupiter API] 🎯 Starting comprehensive token discovery...");
    
    // Fetch from multiple endpoints in parallel for speed
    const [trending, topTraded, highOrganic] = await Promise.all([
      fetchTrendingTokensFromJupiter('1h', 40),
      fetchTopTradedTokensFromJupiter('24h', 40),
      fetchHighOrganicScoreTokensFromJupiter('1h', 40),
    ]);

    // Combine and deduplicate
    const seenMints = new Set<string>();
    const allTokens: TokenMarketData[] = [];

    for (const token of [...trending, ...topTraded, ...highOrganic]) {
      if (seenMints.has(token.mint)) continue;
      seenMints.add(token.mint);
      allTokens.push(token);
      
      if (allTokens.length >= maxTokens) break;
    }

    console.log(`[Jupiter API] 🎯 Token Discovery Summary:`);
    console.log(`  - Trending (1h): ${trending.length} tokens`);
    console.log(`  - Top Traded (24h): ${topTraded.length} tokens`);
    console.log(`  - High Organic Score (1h): ${highOrganic.length} tokens`);
    console.log(`  - Total (deduplicated): ${allTokens.length} tokens`);

    return allTokens;
  } catch (error) {
    console.error("[Jupiter API] Error in comprehensive token discovery:", error);
    return [];
  }
}
