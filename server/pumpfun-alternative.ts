/**
 * Alternative PumpFun token discovery using reliable APIs
 * Replaces broken pumpfunapi.org endpoints with DexScreener + on-chain analysis
 */

import { Connection, PublicKey } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";

const SOLANA_RPC_ENDPOINT = process.env.SOLANA_RPC_ENDPOINT || "https://api.mainnet-beta.solana.com";
const connection = new Connection(SOLANA_RPC_ENDPOINT, "confirmed");

/**
 * Fetch actual holder count for a Solana SPL token using RPC
 * Returns accurate on-chain holder data instead of estimates
 */
export async function getActualHolderCount(tokenMint: string): Promise<number | undefined> {
  try {
    const mintPubkey = new PublicKey(tokenMint);
    
    // Get all token accounts for this mint
    const tokenAccounts = await connection.getProgramAccounts(
      TOKEN_PROGRAM_ID,
      {
        filters: [
          {
            dataSize: 165, // SPL token account size
          },
          {
            memcmp: {
              offset: 0, // Mint address is at offset 0
              bytes: mintPubkey.toBase58(),
            },
          },
        ],
      }
    );
    
    // Count non-zero balance accounts (actual holders)
    let holderCount = 0;
    for (const account of tokenAccounts) {
      // Token amount is at offset 64 (8 bytes, u64)
      const amount = account.account.data.readBigUInt64LE(64);
      if (amount > 0n) {
        holderCount++;
      }
    }
    
    return holderCount;
  } catch (error) {
    console.error(`[Holder Count] Failed to fetch for ${tokenMint}:`, error);
    return undefined;
  }
}

export interface TokenMarketData {
  mint: string;
  name: string;
  symbol: string;
  priceUSD: number;
  priceSOL: number;
  volumeUSD24h: number;
  marketCapUSD: number;
  liquidityUSD?: number;
  priceChange24h?: number;
  priceChange1h?: number;
  holderCount?: number;
  // Social & Community Metrics (PumpFun-enhanced)
  tokenAgeHours?: number; // Hours since token/pair creation
  migrationFreshness?: number; // Hours since graduating from bonding curve (lower = more momentum)
  transactionCount24h?: number; // Total buy+sell transactions
  buyPressure?: number; // Buy transaction percentage (0-100, higher = bullish)
  volumeToLiquidityRatio?: number; // Volume/Liquidity ratio (higher = active trading)
}

/**
 * Calculate social and community metrics for a token
 * Helps AI identify trending/active tokens with strong community engagement
 */
function calculateSocialMetrics(pair: any): {
  tokenAgeHours?: number;
  migrationFreshness?: number;
  transactionCount24h?: number;
  buyPressure?: number;
  volumeToLiquidityRatio?: number;
} {
  const now = Date.now();
  
  // Token age (hours since pair created)
  const tokenAgeHours = pair.pairCreatedAt 
    ? Math.round((now - pair.pairCreatedAt) / (1000 * 60 * 60))
    : undefined;
  
  // Migration freshness (for PumpSwap/Raydium pairs = bonding curve graduation)
  const isPumpswap = pair.dexId === 'pumpswap' || pair.labels?.includes('v3');
  const migrationFreshness = isPumpswap && tokenAgeHours !== undefined
    ? tokenAgeHours // Fresher = lower hours = more momentum
    : undefined;
  
  // Transaction count (buy + sell)
  const buyTxns = pair.txns?.h24?.buys || 0;
  const sellTxns = pair.txns?.h24?.sells || 0;
  const transactionCount24h = buyTxns + sellTxns;
  
  // Buy pressure (% of transactions that are buys)
  const buyPressure = transactionCount24h > 0
    ? Math.round((buyTxns / transactionCount24h) * 100)
    : undefined;
  
  // Volume to liquidity ratio (active trading indicator)
  const volume = pair.volume?.h24 || 0;
  const liquidity = pair.liquidity?.usd || 1; // Avoid divide by zero
  const volumeToLiquidityRatio = liquidity > 0 
    ? Number((volume / liquidity).toFixed(2))
    : undefined;
  
  return {
    tokenAgeHours,
    migrationFreshness,
    transactionCount24h: transactionCount24h > 0 ? transactionCount24h : undefined,
    buyPressure,
    volumeToLiquidityRatio,
  };
}

/**
 * Fetch newly created/migrated pump.fun tokens
 * Uses DexScreener to find recent tokens with PumpSwap pairs (migrated from pump.fun)
 */
export async function fetchNewlyMigratedPumpTokens(maxTokens: number = 20): Promise<TokenMarketData[]> {
  try {
    console.log("[PumpFun Alt] 🚀 Scanning for recently migrated pump.fun → PumpSwap tokens...");
    
    // Search for recently created Solana tokens with volume
    const response = await fetch('https://api.dexscreener.com/token-profiles/latest/v1', {
      headers: { 'Accept': 'application/json' },
    });

    if (!response.ok) {
      console.log(`[PumpFun Alt] Token profiles API returned ${response.status}, trying search instead...`);
      // Fallback to search
      return fetchLowCapPumpTokensViaDexScreener(maxTokens);
    }

    const profiles = await response.json();
    const tokens: TokenMarketData[] = [];
    
    for (const profile of profiles.slice(0, 50)) {
      try {
        // Only process Solana tokens
        if (profile.chainId !== 'solana') continue;
        
        // Fetch trading pairs for this token
        const pairResponse = await fetch(
          `https://api.dexscreener.com/latest/dex/tokens/${profile.tokenAddress}`,
          { headers: { 'Accept': 'application/json' } }
        );
        
        if (!pairResponse.ok) continue;
        
        const pairData = await pairResponse.json();
        const pairs = pairData.pairs || [];
        
        // Look for PumpSwap pairs (indicates migration from pump.fun bonding curve completion)
        // PumpSwap is the native AMM DEX for Pump.fun tokens
        const pumpswapPair = pairs.find((p: any) => 
          p.dexId === 'pumpswap' || 
          p.dexId === 'raydium' || // Some migrated tokens still use Raydium
          p.labels?.includes('v3') || 
          p.labels?.includes('v4')
        );
        
        if (!pumpswapPair) continue;
        
        // Check if token is relatively new (created within last 7 days)
        const pairAge = pumpswapPair.pairCreatedAt ? Date.now() - pumpswapPair.pairCreatedAt : Infinity;
        const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
        
        if (pairAge > MAX_AGE_MS) continue;
        
        // Must have some volume to be tradeable (lowered for 20k tokens)
        if ((pumpswapPair.volume?.h24 || 0) < 500) continue;
        
        // 🎯 WIDENED RANGE: $5k-$200k for more opportunities
        const marketCap = pumpswapPair.fdv || pumpswapPair.marketCap || 0;
        if (marketCap > 200000 || marketCap < 5000) continue;
        
        // Calculate social & community metrics
        const socialMetrics = calculateSocialMetrics(pumpswapPair);
        
        const tokenData: TokenMarketData = {
          mint: profile.tokenAddress,
          name: pumpswapPair.baseToken?.name || 'Unknown',
          symbol: pumpswapPair.baseToken?.symbol || 'UNKNOWN',
          priceUSD: parseFloat(pumpswapPair.priceUsd || '0'),
          priceSOL: parseFloat(pumpswapPair.priceNative || '0'),
          volumeUSD24h: pumpswapPair.volume?.h24 || 0,
          marketCapUSD: pumpswapPair.fdv || pumpswapPair.marketCap || 0,
          liquidityUSD: pumpswapPair.liquidity?.usd || 0,
          priceChange24h: pumpswapPair.priceChange?.h24 || 0,
          priceChange1h: pumpswapPair.priceChange?.h1 || 0,
          holderCount: undefined,
          // Social & Community Metrics (NEW)
          ...socialMetrics,
        };
        
        tokens.push(tokenData);
        
        if (tokens.length >= maxTokens) break;
      } catch (error) {
        continue; // Skip problematic tokens
      }
      
      // Rate limiting
      await new Promise(resolve => setTimeout(resolve, 300));
    }
    
    console.log(`[PumpFun Alt] ✅ Found ${tokens.length} newly migrated tokens`);
    return tokens;
  } catch (error) {
    console.error("[PumpFun Alt] Error fetching migrated tokens:", error);
    return [];
  }
}

/**
 * Fetch low market cap tokens via DexScreener search
 * Alternative to broken PumpFun new tokens API
 */
export async function fetchLowCapPumpTokensViaDexScreener(maxTokens: number = 15): Promise<TokenMarketData[]> {
  try {
    console.log("[PumpFun Alt] 🔥 Scanning for low-cap opportunities via DexScreener...");
    
    // 🎯 Expanded search queries for better PumpFun token discovery
    const queries = ['pump', 'solana', 'meme', 'pepe', 'doge', 'cat', 'moon', 'ai'];
    const tokens: TokenMarketData[] = [];
    const seenMints = new Set<string>();
    
    for (const query of queries) {
      try {
        const response = await fetch(
          `https://api.dexscreener.com/latest/dex/search?q=${query}`,
          { headers: { 'Accept': 'application/json' } }
        );
        
        if (!response.ok) continue;
        
        const data = await response.json();
        const pairs = data.pairs || [];
        
        for (const pair of pairs) {
          // Only Solana pairs
          if (pair.chainId !== 'solana') continue;
          if (!pair.baseToken?.address) continue;
          if (seenMints.has(pair.baseToken.address)) continue;
          
          // 🎯 WIDENED RANGE: $5k-$200k for more trading opportunities
          const marketCap = pair.fdv || pair.marketCap || 0;
          if (marketCap > 200000 || marketCap < 5000) continue;
          
          // 📊 Adjusted minimums for smaller market cap tokens
          // Must have volume (lowered for 20k cap tokens)
          if ((pair.volume?.h24 || 0) < 500) continue;
          
          // Must have liquidity (lowered for 20k cap tokens)
          if ((pair.liquidity?.usd || 0) < 1000) continue;
          
          seenMints.add(pair.baseToken.address);
          
          // Calculate social & community metrics
          const socialMetrics = calculateSocialMetrics(pair);
          
          tokens.push({
            mint: pair.baseToken.address,
            name: pair.baseToken.name || 'Unknown',
            symbol: pair.baseToken.symbol || 'UNKNOWN',
            priceUSD: parseFloat(pair.priceUsd || '0'),
            priceSOL: parseFloat(pair.priceNative || '0'),
            volumeUSD24h: pair.volume?.h24 || 0,
            marketCapUSD: marketCap,
            liquidityUSD: pair.liquidity?.usd || 0,
            priceChange24h: pair.priceChange?.h24 || 0,
            priceChange1h: pair.priceChange?.h1 || 0,
            holderCount: undefined,
            // Social & Community Metrics (NEW)
            ...socialMetrics,
          });
          
          if (tokens.length >= maxTokens) break;
        }
        
        if (tokens.length >= maxTokens) break;
        
        // Rate limiting
        await new Promise(resolve => setTimeout(resolve, 500));
      } catch (error) {
        continue;
      }
    }
    
    console.log(`[PumpFun Alt] ✅ Found ${tokens.length} low-cap tokens`);
    return tokens;
  } catch (error) {
    console.error("[PumpFun Alt] Error fetching low-cap tokens:", error);
    return [];
  }
}

/**
 * Fetch trending pump-style tokens via DexScreener
 * Looks for high volume, recent creation, meme-style tokens
 */
export async function fetchTrendingPumpStyleTokens(maxTokens: number = 15): Promise<TokenMarketData[]> {
  try {
    console.log("[PumpFun Alt] 🔥 Fetching trending pump-style tokens from DexScreener...");
    
    // Search for trending Solana tokens (using search endpoint instead of invalid pairs/solana/ endpoint)
    const response = await fetch('https://api.dexscreener.com/latest/dex/search?q=SOL', {
      headers: { 'Accept': 'application/json' },
    });
    
    if (!response.ok) {
      console.error(`[PumpFun Alt] DexScreener API error: ${response.status}`);
      return [];
    }
    
    const data = await response.json();
    // Filter for Solana chain pairs only
    const pairs = (data.pairs || []).filter((pair: any) => pair.chainId === 'solana');
    
    // Filter for pump-style characteristics:
    // - High volume relative to liquidity
    // - Relatively new (created in last 30 days)
    // - Small market cap (under $5M)
    const tokens: TokenMarketData[] = [];
    const now = Date.now();
    const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
    
    for (const pair of pairs) {
      if (!pair.baseToken?.address) continue;
      
      // Age check
      const pairAge = pair.pairCreatedAt ? now - pair.pairCreatedAt : 0;
      if (pairAge > MAX_AGE_MS) continue;
      
      // Market cap check
      const marketCap = pair.fdv || pair.marketCap || 0;
      if (marketCap > 5000000 || marketCap < 10000) continue;
      
      // Volume check (must have decent volume)
      const volume = pair.volume?.h24 || 0;
      if (volume < 5000) continue;
      
      // Liquidity check
      const liquidity = pair.liquidity?.usd || 0;
      if (liquidity < 3000) continue;
      
      // Volume to liquidity ratio (pump tokens often have high volume/liquidity)
      const volumeToLiquidity = volume / liquidity;
      if (volumeToLiquidity < 0.5) continue; // At least 50% daily volume of liquidity
      
      // Calculate social & community metrics
      const socialMetrics = calculateSocialMetrics(pair);
      
      tokens.push({
        mint: pair.baseToken.address,
        name: pair.baseToken.name || 'Unknown',
        symbol: pair.baseToken.symbol || 'UNKNOWN',
        priceUSD: parseFloat(pair.priceUsd || '0'),
        priceSOL: parseFloat(pair.priceNative || '0'),
        volumeUSD24h: volume,
        marketCapUSD: marketCap,
        liquidityUSD: liquidity,
        priceChange24h: pair.priceChange?.h24 || 0,
        priceChange1h: pair.priceChange?.h1 || 0,
        holderCount: undefined,
        // Social & Community Metrics (NEW)
        ...socialMetrics,
      });
      
      if (tokens.length >= maxTokens) break;
    }
    
    console.log(`[PumpFun Alt] ✅ Found ${tokens.length} trending pump-style tokens`);
    return tokens;
  } catch (error) {
    console.error("[PumpFun Alt] Error fetching trending tokens:", error);
    return [];
  }
}
