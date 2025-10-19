// Jupiter Ultra API integration for token swaps
// Ultra API provides RPC-less swaps with automatic optimization

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
 * Note: This requires signing the transaction which needs Solana Web3.js SDK
 * @param requestId - Request ID from getSwapOrder
 * @param signedTransaction - Base64-encoded signed transaction
 */
export async function executeSwapOrder(
  requestId: string,
  signedTransaction: string
): Promise<JupiterExecuteResponse> {
  try {
    const response = await fetch(`${JUPITER_ULTRA_API_URL}/execute`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        requestId,
        transaction: signedTransaction,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Jupiter Ultra execute error: ${response.statusText} - ${error}`);
    }

    const result: JupiterExecuteResponse = await response.json();
    return result;
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
 * Get token price in SOL
 */
export async function getTokenPrice(tokenMintAddress: string): Promise<number> {
  try {
    // Using Jupiter's price API
    const response = await fetch(`https://price.jup.ag/v4/price?ids=${tokenMintAddress}`);
    
    if (!response.ok) {
      throw new Error(`Jupiter price API error: ${response.statusText}`);
    }

    const data = await response.json();
    
    if (!data.data || !data.data[tokenMintAddress]) {
      throw new Error("Token price not found");
    }

    return data.data[tokenMintAddress].price;
  } catch (error) {
    console.error("Error getting token price:", error);
    throw error;
  }
}

// Legacy compatibility - maintains old function signature
export async function getSwapQuote(
  inputMint: string,
  outputMint: string,
  amountLamports: number,
  slippageBps: number = 50
): Promise<any> {
  // Note: This requires a taker wallet address
  // For now, use a placeholder - this should be replaced with actual wallet
  const placeholderWallet = "11111111111111111111111111111111";
  
  const order = await getSwapOrder(
    inputMint,
    outputMint,
    amountLamports,
    placeholderWallet,
    slippageBps
  );
  
  return {
    inputAmount: order.inputAmount,
    outputAmount: order.outputAmount,
    priceImpactPct: order.slippageBps / 100, // Approximate price impact from slippage
    route: order,
  };
}
