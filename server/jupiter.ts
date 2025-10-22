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
    
    // Step 1: Deserialize the unsigned transaction
    const transactionBuffer = Buffer.from(swapOrder.transaction, "base64");
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
      `${JUPITER_ULTRA_API_URL}/balances?publicKey=${publicKey}`
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
 * Get token price in SOL (not USD)
 * Uses Jupiter's new Price API v3 and calculates SOL-denominated price
 * by dividing token USD price by SOL USD price
 * Includes retry logic with exponential backoff for resilience
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
