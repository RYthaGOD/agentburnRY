// PumpFun Lightning API integration for claiming creator rewards and trading
// Creators earn 0.05% of trading volume in SOL

import { signAndSendVersionedTransaction, loadKeypairFromPrivateKey } from "./solana-sdk";
import { Connection, VersionedTransaction, Keypair } from "@solana/web3.js";
import { getAssociatedTokenAddress, getAccount } from "@solana/spl-token";

const PUMPFUN_API_URL = "https://pumpportal.fun/api/trade-local";
const SOLANA_RPC_URL = process.env.SOLANA_RPC_URL || "https://api.devnet.solana.com";

interface ClaimCreatorFeeRequest {
  publicKey: string; // Creator's Solana wallet address
  action: "collectCreatorFee";
  priorityFee?: number; // Optional priority fee in SOL (default: 0.000001)
  mint?: string; // Optional: specific token mint to claim rewards for
}

interface ClaimCreatorFeeResponse {
  success: boolean;
  transaction?: string; // Base64-encoded transaction to sign
  signature?: string; // Transaction signature after execution
  amount?: number; // Amount claimed in SOL
  error?: string;
}

/**
 * Generate a transaction to claim PumpFun creator rewards
 * @param creatorWallet - Creator's Solana wallet public key
 * @param priorityFee - Optional priority fee in SOL (default: 0.000001)
 * @param tokenMint - Optional: specific token mint to claim rewards for
 * @returns Base64-encoded transaction ready to sign
 */
export async function generateClaimRewardsTransaction(
  creatorWallet: string,
  priorityFee: number = 0.000001,
  tokenMint?: string
): Promise<string> {
  try {
    const requestBody: ClaimCreatorFeeRequest = {
      publicKey: creatorWallet,
      action: "collectCreatorFee",
      priorityFee,
    };

    // If specific token mint provided, claim only for that token
    if (tokenMint) {
      requestBody.mint = tokenMint;
    }

    const response = await fetch(PUMPFUN_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams(requestBody as any).toString(),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`PumpFun API error: ${response.statusText} - ${errorText}`);
    }

    // Response is the raw transaction bytes
    const transactionBytes = await response.arrayBuffer();
    const base64Transaction = Buffer.from(transactionBytes).toString("base64");

    return base64Transaction;
  } catch (error) {
    console.error("Error generating PumpFun claim transaction:", error);
    throw error;
  }
}

/**
 * Check if a wallet has unclaimed PumpFun creator rewards
 * Note: This is a helper that attempts to generate a claim transaction
 * If no rewards are available, the API will return an error
 */
export async function hasUnclaimedRewards(
  creatorWallet: string,
  tokenMint?: string
): Promise<boolean> {
  try {
    await generateClaimRewardsTransaction(creatorWallet, 0.000001, tokenMint);
    return true; // If transaction generated successfully, rewards are available
  } catch (error) {
    // If error contains "no rewards" or similar, return false
    const errorMessage = error instanceof Error ? error.message.toLowerCase() : "";
    if (
      errorMessage.includes("no rewards") ||
      errorMessage.includes("no fees") ||
      errorMessage.includes("nothing to claim")
    ) {
      return false;
    }
    // For other errors, log and return false
    console.warn(`Unable to check PumpFun rewards for ${creatorWallet}:`, error);
    return false;
  }
}

/**
 * Get estimated creator rewards for a token
 * Note: PumpFun doesn't provide a direct API for this, so this is a calculation
 * based on 0.05% of trading volume
 * @param tradingVolume - Total trading volume in SOL
 * @returns Estimated rewards in SOL
 */
export function estimateCreatorRewards(tradingVolume: number): number {
  const CREATOR_FEE_BPS = 5; // 0.05% = 5 basis points
  return (tradingVolume * CREATOR_FEE_BPS) / 10000;
}

/**
 * Execute claim rewards transaction
 * Signs and broadcasts the transaction to Solana network
 */
export async function executeClaimRewards(
  transactionBase64: string,
  creatorPrivateKey: string
): Promise<string> {
  try {
    // Load keypair from private key
    const keypair = loadKeypairFromPrivateKey(creatorPrivateKey);
    
    console.log(`Claiming PumpFun rewards for wallet: ${keypair.publicKey.toString()}`);
    
    // Sign and send the transaction
    const signature = await signAndSendVersionedTransaction(
      transactionBase64,
      keypair,
      "confirmed"
    );
    
    console.log(`PumpFun rewards claimed successfully: ${signature}`);
    return signature;
  } catch (error) {
    console.error("Error executing claim rewards:", error);
    throw error;
  }
}

/**
 * Get unclaimed rewards amount for a creator wallet
 * Note: This is estimated based on blockchain data - actual amount requires claiming
 */
export async function getUnclaimedRewardsAmount(
  creatorWallet: string,
  tokenMint: string
): Promise<number> {
  try {
    // For now, we'll attempt to generate a transaction and parse metadata
    // In reality, PumpFun API doesn't return the amount directly
    // This would need to be fetched from blockchain state or PumpFun API
    
    // Placeholder: Return 0 until we can query the actual unclaimed amount
    // In production, this would query PumpFun's contract state or API
    console.log(`[SIMULATION] Would query unclaimed rewards for ${creatorWallet}`);
    return 0;
  } catch (error) {
    console.warn("Error getting unclaimed rewards amount:", error);
    return 0;
  }
}

/**
 * Complete workflow: Generate claim transaction, sign it, and execute
 * Requires creator wallet private key
 */
export async function claimCreatorRewardsFull(
  creatorWallet: string,
  creatorPrivateKey: string | null,
  tokenMint?: string
): Promise<ClaimCreatorFeeResponse> {
  try {
    // Step 1: Generate claim transaction
    const transaction = await generateClaimRewardsTransaction(
      creatorWallet,
      0.000001,
      tokenMint
    );

    // Step 2: Sign and execute if private key provided
    if (creatorPrivateKey) {
      try {
        const signature = await executeClaimRewards(transaction, creatorPrivateKey);
        
        // Note: We still don't know the exact amount without parsing the transaction
        // In production, you'd query the balance before/after to calculate the claim
        return {
          success: true,
          transaction,
          signature,
          amount: 0, // Would need to calculate from balance diff
        };
      } catch (error) {
        console.error("Failed to execute claim:", error);
        return {
          success: false,
          error: error instanceof Error ? error.message : "Unknown error",
        };
      }
    } else {
      // No private key - simulation mode
      console.log("[SIMULATION] PumpFun claim transaction generated");
      console.log("No private key provided - transaction ready to sign manually");
      
      return {
        success: true,
        transaction,
        amount: 0,
        error: "No private key provided for automatic execution",
      };
    }
  } catch (error) {
    console.error("Error claiming PumpFun creator rewards:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

// ============================================================================
// PumpFun Trading Functions (AI Trading Bot)
// ============================================================================

interface TradeResult {
  success: boolean;
  signature?: string;
  error?: string;
  amountTraded?: number;
}

const solanaConnection = new Connection(SOLANA_RPC_URL, "confirmed");

/**
 * Buy tokens on PumpFun using PumpPortal API
 */
export async function buyTokenOnPumpFun(
  walletKeypair: Keypair,
  tokenMint: string,
  amountSOL: number,
  slippage: number = 10,
  priorityFee: number = 0.00001
): Promise<TradeResult> {
  try {
    const publicKey = walletKeypair.publicKey.toString();
    
    console.log(`[PumpFun] Buying ${amountSOL} SOL worth of ${tokenMint}`);

    // Build transaction via PumpPortal
    const response = await fetch(PUMPFUN_API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        publicKey,
        action: "buy",
        mint: tokenMint,
        denominatedInSol: "true",
        amount: amountSOL,
        slippage,
        priorityFee,
        pool: "pump", // Use PumpFun bonding curve
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`PumpPortal API error: ${response.status} - ${errorText}`);
    }

    // Deserialize and sign transaction
    const data = await response.arrayBuffer();
    const tx = VersionedTransaction.deserialize(new Uint8Array(data));
    tx.sign([walletKeypair]);

    // Send transaction
    const signature = await solanaConnection.sendTransaction(tx, {
      skipPreflight: true, // Faster execution for trading
      maxRetries: 3,
    });

    // Wait for confirmation
    await solanaConnection.confirmTransaction(signature, "confirmed");

    console.log(`[PumpFun] Buy successful: ${signature}`);
    return { success: true, signature, amountTraded: amountSOL };
  } catch (error) {
    console.error(`[PumpFun] Buy failed:`, error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Sell tokens on PumpFun using PumpPortal API
 */
export async function sellTokenOnPumpFun(
  walletKeypair: Keypair,
  tokenMint: string,
  options: {
    percentage?: number; // 0-100, e.g., 100 for selling all
    amount?: number; // Specific token amount
    slippage?: number;
    priorityFee?: number;
  }
): Promise<TradeResult> {
  try {
    const publicKey = walletKeypair.publicKey.toString();
    const slippage = options.slippage || 10;
    const priorityFee = options.priorityFee || 0.00001;

    let sellAmount: string | number;
    if (options.percentage !== undefined) {
      sellAmount = `${options.percentage}%`;
      console.log(`[PumpFun] Selling ${options.percentage}% of ${tokenMint}`);
    } else if (options.amount !== undefined) {
      sellAmount = options.amount;
      console.log(`[PumpFun] Selling ${options.amount} tokens of ${tokenMint}`);
    } else {
      throw new Error("Must specify either percentage or amount for sell");
    }

    // Build transaction via PumpPortal
    const response = await fetch(PUMPFUN_API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        publicKey,
        action: "sell",
        mint: tokenMint,
        denominatedInSol: "false",
        amount: sellAmount,
        slippage,
        priorityFee,
        pool: "pump",
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`PumpPortal API error: ${response.status} - ${errorText}`);
    }

    // Deserialize and sign transaction
    const data = await response.arrayBuffer();
    const tx = VersionedTransaction.deserialize(new Uint8Array(data));
    tx.sign([walletKeypair]);

    // Send transaction
    const signature = await solanaConnection.sendTransaction(tx, {
      skipPreflight: true,
      maxRetries: 3,
    });

    // Wait for confirmation
    await solanaConnection.confirmTransaction(signature, "confirmed");

    console.log(`[PumpFun] Sell successful: ${signature}`);
    return { success: true, signature };
  } catch (error) {
    console.error(`[PumpFun] Sell failed:`, error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Get token balance for a wallet
 */
export async function getTokenBalance(
  walletAddress: string,
  tokenMint: string
): Promise<number> {
  try {
    const { PublicKey } = await import("@solana/web3.js");
    
    const walletPubkey = new PublicKey(walletAddress);
    const mintPubkey = new PublicKey(tokenMint);

    const tokenAccount = await getAssociatedTokenAddress(mintPubkey, walletPubkey);
    const accountInfo = await getAccount(solanaConnection, tokenAccount);

    return Number(accountInfo.amount);
  } catch (error) {
    // Token account doesn't exist - balance is 0
    return 0;
  }
}
