// Jupiter Ultra API integration for token swaps
// Ultra API provides RPC-less swaps with automatic optimization

import { signAndSendVersionedTransaction, loadKeypairFromPrivateKey } from "./solana-sdk";

const JUPITER_ULTRA_API_URL = "https://lite-api.jup.ag/ultra/v1";

interface JupiterUltraOrderResponse {
  transaction: string; // Base64-encoded transaction
  requestId: string;
  inAmount: string;
  outAmount: string;
  slippageBps: number;
  swapType: string;
  feeBps: number;
}

interface JupiterExecuteResponse {
  status: string;
  transactionId: string;
  slot: number;
  inputAmountResult: string;
  outputAmountResult: string;
  swapEvents?: any[];
}

interface SwapOrder {
  transaction: string; // Base64 transaction to sign
  requestId: string;
  inputAmount: number;
  outputAmount: number;
  slippageBps: number;
  swapType: string;
  feeBps: number;
}

/**
 * Get a swap order from Jupiter Ultra API for SOL to token swap
 * @param inputMint - Input token mint address (SOL: So11111111111111111111111111111111111111112)
 * @param outputMint - Output token mint address
 * @param amountLamports - Amount in smallest units (lamports for SOL)
 * @param takerWallet - Wallet public key (base58 string)
 * @param slippageBps - Slippage in basis points (default: 50 = 0.5%)
 */
export async function getSwapOrder(
  inputMint: string,
  outputMint: string,
  amountLamports: number,
  takerWallet: string,
  slippageBps: number = 50
): Promise<SwapOrder> {
  try {
    const params = new URLSearchParams({
      inputMint,
      outputMint,
      amount: amountLamports.toString(),
      taker: takerWallet,
      slippageBps: slippageBps.toString(),
    });

    const response = await fetch(`${JUPITER_ULTRA_API_URL}/order?${params}`);
    
    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Jupiter Ultra API error: ${response.statusText} - ${error}`);
    }

    const orderData: JupiterUltraOrderResponse = await response.json();

    return {
      transaction: orderData.transaction,
      requestId: orderData.requestId,
      inputAmount: parseInt(orderData.inAmount),
      outputAmount: parseInt(orderData.outAmount),
      slippageBps: orderData.slippageBps,
      swapType: orderData.swapType,
      feeBps: orderData.feeBps,
    };
  } catch (error) {
    console.error("Error getting Jupiter Ultra order:", error);
    throw error;
  }
}

/**
 * Execute a swap via Jupiter Ultra API
 * Signs the transaction and submits it through Jupiter's execution endpoint
 * @param swapOrder - Swap order from getSwapOrder
 * @param walletPrivateKey - Base58-encoded private key
 */
export async function executeSwapOrder(
  swapOrder: SwapOrder,
  walletPrivateKey: string
): Promise<JupiterExecuteResponse> {
  try {
    // Load keypair from private key
    const keypair = loadKeypairFromPrivateKey(walletPrivateKey);
    
    console.log(`Executing Jupiter swap for wallet: ${keypair.publicKey.toString()}`);
    console.log(`Request ID: ${swapOrder.requestId}`);
    
    // Step 1: Validate and deserialize the unsigned transaction
    if (!swapOrder.transaction || swapOrder.transaction.trim() === '') {
      throw new Error('Invalid transaction: empty or undefined transaction data from Jupiter');
    }
    
    const transactionBuffer = Buffer.from(swapOrder.transaction, "base64");
    
    if (transactionBuffer.length === 0) {
      throw new Error('Invalid transaction: buffer is empty after base64 decode');
    }
    
    console.log(`Transaction buffer size: ${transactionBuffer.length} bytes`);
    
    const { VersionedTransaction } = await import("@solana/web3.js");
    const transaction = VersionedTransaction.deserialize(transactionBuffer);
    
    // Step 2: Sign the transaction
    transaction.sign([keypair]);
    
    // Step 3: Serialize the signed transaction
    const signedTransaction = Buffer.from(transaction.serialize()).toString("base64");
    
    // Step 4: Submit to Jupiter Ultra execute endpoint
    const response = await fetch(`${JUPITER_ULTRA_API_URL}/execute`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        signedTransaction: signedTransaction,
        requestId: swapOrder.requestId,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Jupiter Ultra execute error: ${response.statusText} - ${error}`);
    }

    const result = await response.json();
    
    console.log(`Jupiter swap executed successfully!`);
    console.log(`  Signature: ${result.signature || result.transactionId}`);
    console.log(`  Status: ${result.status}`);
    
    // Return standardized response
    return {
      transactionId: result.signature || result.transactionId,
      status: result.status || "success",
      slot: result.slot || 0,
      inputAmountResult: result.inputAmountResult || "0",
      outputAmountResult: result.outputAmountResult || "0",
      swapEvents: result.swapEvents,
    };
  } catch (error) {
    console.error("Error executing Jupiter Ultra swap:", error);
    throw error;
  }
}

/**
 * Get wallet balances via Jupiter Ultra API
 */
export async function getWalletBalances(publicKey: string): Promise<any> {
  try {
    const response = await fetch(
      `${JUPITER_ULTRA_API_URL}/balances?wallet=${publicKey}`
    );
    
    if (!response.ok) {
      throw new Error(`Jupiter balances API error: ${response.statusText}`);
    }

    return await response.json();
  } catch (error) {
    console.error("Error getting wallet balances:", error);
    throw error;
  }
}

/**
 * Get token security information via Jupiter Shield API
 */
export async function getTokenShieldInfo(mint: string): Promise<any> {
  try {
    const response = await fetch(
      `${JUPITER_ULTRA_API_URL}/shield?mint=${mint}`
    );
    
    if (!response.ok) {
      throw new Error(`Jupiter Shield API error: ${response.statusText}`);
    }

    return await response.json();
  } catch (error) {
    console.error("Error getting token shield info:", error);
    throw error;
  }
}

/**
 * Get prices for multiple tokens in a single API call (batch operation)
 * Returns a Map of mint address -> price in SOL
 * Dramatically reduces API calls and avoids rate limiting
 */
export async function getBatchTokenPrices(tokenMintAddresses: string[]): Promise<Map<string, number>> {
  const SOL_MINT = "So11111111111111111111111111111111111111112";
  const priceMap = new Map<string, number>();
  
  if (tokenMintAddresses.length === 0) {
    return priceMap;
  }

  try {
    // Jupiter Price API v3 supports up to 100 tokens per request
    // Build comma-separated list of all token mints + SOL
    const allMints = [...tokenMintAddresses, SOL_MINT].join(',');
    
    const response = await fetch(
      `https://lite-api.jup.ag/price/v3?ids=${allMints}`,
      {
        signal: AbortSignal.timeout(15000), // 15 second timeout for batch
      }
    );
    
    if (!response.ok) {
      throw new Error(`Jupiter price API error: ${response.statusText}`);
    }

    const data = await response.json();
    const solData = data[SOL_MINT];

    if (!solData || typeof solData.usdPrice !== 'number') {
      throw new Error("SOL price not found in batch response");
    }

    const solPriceUSD = solData.usdPrice;

    // Process each token price
    for (const mint of tokenMintAddresses) {
      const tokenData = data[mint];
      
      if (tokenData && typeof tokenData.usdPrice === 'number') {
        // Calculate SOL-denominated price
        const tokenPriceInSOL = tokenData.usdPrice / solPriceUSD;
        priceMap.set(mint, tokenPriceInSOL);
      }
      // If token not found, we simply don't add it to the map (graceful handling)
    }

    return priceMap;
  } catch (error) {
    console.error(`Error fetching batch token prices:`, error);
    // Return empty map on error rather than throwing
    // This allows the calling code to continue with what it has
    return priceMap;
  }
}

/**
 * Get token price in SOL (not USD)
 * Uses Jupiter's new Price API v3 and calculates SOL-denominated price
 * by dividing token USD price by SOL USD price
 * Includes retry logic with exponential backoff for resilience
 * 
 * NOTE: For multiple tokens, use getBatchTokenPrices() instead to avoid rate limiting
 */
export async function getTokenPrice(tokenMintAddress: string): Promise<number> {
  const SOL_MINT = "So11111111111111111111111111111111111111112";
  const MAX_RETRIES = 3;
  const INITIAL_DELAY = 1000; // 1 second
  
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      // Using Jupiter's new Price API v3 (lite-api.jup.ag)
      // Fetch both token and SOL prices in USD
      const response = await fetch(
        `https://lite-api.jup.ag/price/v3?ids=${tokenMintAddress},${SOL_MINT}`,
        {
          signal: AbortSignal.timeout(10000), // 10 second timeout
        }
      );
      
      if (!response.ok) {
        throw new Error(`Jupiter price API error: ${response.statusText}`);
      }

      const data = await response.json();
      
      // V3 API returns data directly, not nested in data.data
      const tokenData = data[tokenMintAddress];
      const solData = data[SOL_MINT];

      if (!tokenData || typeof tokenData.usdPrice !== 'number') {
        throw new Error("Token price not found");
      }

      if (!solData || typeof solData.usdPrice !== 'number') {
        throw new Error("SOL price not found");
      }

      // Calculate SOL-denominated price: tokenPriceUSD / solPriceUSD
      const tokenPriceInSOL = tokenData.usdPrice / solData.usdPrice;
      
      return tokenPriceInSOL;
    } catch (error) {
      const isLastAttempt = attempt === MAX_RETRIES - 1;
      
      if (isLastAttempt) {
        console.error(`Error getting token price after ${MAX_RETRIES} attempts:`, error);
        throw error;
      }
      
      // Exponential backoff: 1s, 2s, 4s
      const delay = INITIAL_DELAY * Math.pow(2, attempt);
      console.warn(`Price fetch attempt ${attempt + 1} failed, retrying in ${delay}ms...`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  
  throw new Error("Failed to fetch token price after all retries");
}

/**
 * Get swap quote with proper wallet address
 * @param inputMint - Input token mint address
 * @param outputMint - Output token mint address  
 * @param amountLamports - Amount in lamports
 * @param takerWallet - Taker wallet address (required for accurate quotes)
 * @param slippageBps - Slippage in basis points (default: 50)
 */
export async function getSwapQuote(
  inputMint: string,
  outputMint: string,
  amountLamports: number,
  takerWallet: string,
  slippageBps: number = 50
): Promise<{
  inputAmount: number;
  outputAmount: number;
  priceImpactPct: number;
  route: SwapOrder;
}> {
  const order = await getSwapOrder(
    inputMint,
    outputMint,
    amountLamports,
    takerWallet,
    slippageBps
  );
  
  return {
    inputAmount: order.inputAmount,
    outputAmount: order.outputAmount,
    priceImpactPct: order.slippageBps / 100, // Approximate price impact from slippage
    route: order,
  };
}

/**
 * Buy token using SOL via Jupiter Ultra API (for AI Trading Bot)
 * @param walletPrivateKey - Base58-encoded private key
 * @param tokenMint - Token to buy
 * @param amountSOL - Amount in SOL (not lamports)
 * @param slippageBps - Slippage in basis points (default: 1000 = 10%)
 * @returns Transaction result with signature
 */
export async function buyTokenWithJupiter(
  walletPrivateKey: string,
  tokenMint: string,
  amountSOL: number,
  slippageBps: number = 1000
): Promise<{
  success: boolean;
  signature?: string;
  error?: string;
  outputAmount?: number;
}> {
  try {
    const SOL_MINT = "So11111111111111111111111111111111111111112";
    const keypair = loadKeypairFromPrivateKey(walletPrivateKey);
    const walletAddress = keypair.publicKey.toString();
    
    // Convert SOL to lamports
    const amountLamports = Math.floor(amountSOL * 1_000_000_000);
    
    console.log(`[Jupiter] Buying ${amountSOL} SOL worth of ${tokenMint}`);
    console.log(`[Jupiter] Wallet: ${walletAddress}`);
    console.log(`[Jupiter] Amount: ${amountLamports} lamports`);
    console.log(`[Jupiter] Slippage: ${slippageBps / 100}%`);
    
    // Get swap order
    const swapOrder = await getSwapOrder(
      SOL_MINT,
      tokenMint,
      amountLamports,
      walletAddress,
      slippageBps
    );
    
    console.log(`[Jupiter] Expected output: ${swapOrder.outputAmount} tokens`);
    
    // Execute swap
    const result = await executeSwapOrder(swapOrder, walletPrivateKey);
    
    console.log(`[Jupiter] Buy successful: ${result.transactionId}`);
    
    return {
      success: true,
      signature: result.transactionId,
      outputAmount: parseInt(result.outputAmountResult || "0"),
    };
  } catch (error) {
    console.error(`[Jupiter] Buy failed:`, error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Get token decimals for a given mint address
 * @param mintAddress - Token mint address
 * @returns Number of decimals for the token
 */
export async function getTokenDecimals(mintAddress: string): Promise<number> {
  try {
    const { Connection, PublicKey } = await import("@solana/web3.js");
    const { getMint } = await import("@solana/spl-token");
    
    const connection = new Connection(
      process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com"
    );
    
    const mintPubkey = new PublicKey(mintAddress);
    const mintInfo = await getMint(connection, mintPubkey);
    
    return mintInfo.decimals;
  } catch (error) {
    console.warn(`Could not fetch decimals for ${mintAddress}, defaulting to 6`);
    // Most PumpFun tokens use 6 decimals, fallback to this if API fails
    return 6;
  }
}
