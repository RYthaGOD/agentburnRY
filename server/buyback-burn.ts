import { Connection, Keypair, PublicKey, Transaction } from "@solana/web3.js";
import { createBurnInstruction, getAssociatedTokenAddress } from "@solana/spl-token";
import { buyTokenOnPumpFun } from "./pumpfun.js";
import { buyTokenWithJupiter, getTokenDecimals } from "./jupiter.js";
import { db } from "./db";
import { aiBotConfigs } from "@shared/schema";
import { eq } from "drizzle-orm";
import bs58 from "bs58";

const RPC_ENDPOINT = process.env.SOLANA_RPC_ENDPOINT || "https://api.mainnet-beta.solana.com";

export async function executeBuybackAndBurn(
  ownerWallet: string,
  profitSOL: number,
  treasuryKeypair: Keypair
): Promise<{
  success: boolean;
  buybackSOL?: number;
  tokensBought?: number;
  tokensBurned?: number;
  buyTxSignature?: string;
  burnTxSignature?: string;
  error?: string;
}> {
  try {
    console.log(`[Buyback & Burn] Checking configuration for wallet ${ownerWallet}`);

    // Fetch buyback configuration
    const configs = await db
      .select()
      .from(aiBotConfigs)
      .where(eq(aiBotConfigs.ownerWalletAddress, ownerWallet))
      .limit(1);

    if (configs.length === 0 || !configs[0].buybackEnabled) {
      console.log("[Buyback & Burn] Buyback not enabled for this wallet");
      return { success: false, error: "Buyback not enabled" };
    }

    const config = configs[0];

    if (!config.buybackTokenMint) {
      console.log("[Buyback & Burn] No buyback token mint configured");
      return { success: false, error: "No buyback token mint configured" };
    }

    // Calculate buyback amount (percentage of profit)
    const buybackPercentage = parseFloat(config.buybackPercentage || "5");
    const buybackSOL = profitSOL * (buybackPercentage / 100);

    if (buybackSOL < 0.001) {
      console.log(`[Buyback & Burn] Buyback amount too small: ${buybackSOL} SOL`);
      return { success: false, error: "Buyback amount too small (< 0.001 SOL)" };
    }

    console.log(`[Buyback & Burn] Executing buyback: ${buybackSOL} SOL (${buybackPercentage}% of ${profitSOL} SOL profit)`);
    console.log(`[Buyback & Burn] Target token: ${config.buybackTokenMint}`);

    // Step 1: Buy the token using Jupiter/PumpSwap
    // CRITICAL: Track balance before buy using RAW amounts to avoid floating-point precision issues
    const connection = new Connection(RPC_ENDPOINT, "confirmed");
    const tokenMintPubkey = new PublicKey(config.buybackTokenMint);
    const treasuryPubkey = treasuryKeypair.publicKey;
    
    let balanceBeforeBuyRaw = BigInt(0); // Use bigint to avoid precision loss
    let tokenDecimals = 6; // Default for most tokens
    
    try {
      const tokenAccount = await getAssociatedTokenAddress(
        tokenMintPubkey,
        treasuryPubkey
      );
      
      try {
        const accountInfo = await connection.getTokenAccountBalance(tokenAccount);
        balanceBeforeBuyRaw = BigInt(accountInfo.value.amount);
        tokenDecimals = accountInfo.value.decimals;
        const balanceBeforeBuyHuman = Number(balanceBeforeBuyRaw) / Math.pow(10, tokenDecimals);
        console.log(`[Buyback & Burn] Pre-buy balance: ${balanceBeforeBuyHuman.toLocaleString()} tokens (raw: ${balanceBeforeBuyRaw})`);
      } catch (error) {
        // Token account doesn't exist yet - balance is 0
        console.log("[Buyback & Burn] No existing token account - starting from 0");
        // Get decimals from mint info
        try {
          tokenDecimals = await getTokenDecimals(config.buybackTokenMint);
        } catch {
          tokenDecimals = 6; // Fallback to 6 decimals
        }
      }
    } catch (error: any) {
      console.log("[Buyback & Burn] Could not check pre-buy balance:", error.message);
      // Get decimals for later calculations
      try {
        tokenDecimals = await getTokenDecimals(config.buybackTokenMint);
      } catch {
        tokenDecimals = 6;
      }
    }

    // Convert Keypair to private key string
    const privateKeyString = bs58.encode(treasuryKeypair.secretKey);
    let buyResult;
    let tokensBought = 0;
    
    try {
      console.log("[Buyback & Burn] Attempting Jupiter swap for buyback...");
      buyResult = await buyTokenWithJupiter(
        privateKeyString,
        config.buybackTokenMint,
        buybackSOL,
        1000 // 10% slippage for buyback
      );

      if (buyResult.success && buyResult.signature) {
        console.log(`[Buyback & Burn] ✅ Jupiter buyback successful: ${buyResult.signature}`);
        tokensBought = buyResult.outputAmount || 0;
      } else {
        throw new Error(buyResult.error || "Jupiter swap failed");
      }
    } catch (jupiterError: any) {
      console.log(`[Buyback & Burn] Jupiter failed: ${jupiterError.message}`);
      console.log("[Buyback & Burn] Falling back to PumpSwap...");

      try {
        buyResult = await buyTokenOnPumpFun(
          treasuryKeypair,
          config.buybackTokenMint,
          buybackSOL,
          10, // 10% slippage
          0.00001 // priority fee
        );

        if (buyResult.success && buyResult.signature) {
          console.log(`[Buyback & Burn] ✅ PumpSwap buyback successful: ${buyResult.signature}`);
          // For PumpSwap, we'll calculate the delta after fetching the new balance
        } else {
          throw new Error(buyResult.error || "PumpSwap failed");
        }
      } catch (pumpError: any) {
        console.error("[Buyback & Burn] Both Jupiter and PumpSwap failed:", pumpError);
        return {
          success: false,
          error: `Buyback failed: Jupiter (${jupiterError.message}), PumpSwap (${pumpError.message})`,
        };
      }
    }

    if (!buyResult.success || !buyResult.signature) {
      return {
        success: false,
        error: buyResult.error || "Buy transaction failed",
      };
    }

    const buyTxSignature = buyResult.signature;

    // CRITICAL: Wait for transaction confirmation before reading balance
    console.log("[Buyback & Burn] Waiting for buy transaction confirmation...");
    try {
      await connection.confirmTransaction(buyTxSignature, "confirmed");
      console.log("[Buyback & Burn] Buy transaction confirmed");
    } catch (error: any) {
      console.error("[Buyback & Burn] Failed to confirm buy transaction:", error.message);
      return {
        success: false,
        buybackSOL,
        buyTxSignature,
        error: `Buy transaction failed to confirm: ${error.message}`,
      };
    }

    // If we don't have tokensBought from Jupiter (e.g., used PumpSwap), calculate delta from balance change
    if (tokensBought === 0) {
      console.log("[Buyback & Burn] Calculating tokens bought from balance delta (using bigint for precision)...");
      
      try {
        const tokenAccount = await getAssociatedTokenAddress(
          tokenMintPubkey,
          treasuryPubkey
        );
        
        // Fetch post-buy balance with retry to handle settlement delay
        let balanceAfterBuyRaw = BigInt(0);
        let retries = 0;
        const maxRetries = 5;
        
        while (retries < maxRetries) {
          try {
            const accountInfo = await connection.getTokenAccountBalance(tokenAccount);
            balanceAfterBuyRaw = BigInt(accountInfo.value.amount);
            
            // Ensure balance has changed
            if (balanceAfterBuyRaw > balanceBeforeBuyRaw) {
              break; // Balance updated successfully
            }
            
            console.log(`[Buyback & Burn] Balance not yet updated, retrying... (${retries + 1}/${maxRetries})`);
            await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1 second
            retries++;
          } catch (error: any) {
            if (retries === maxRetries - 1) {
              throw error;
            }
            await new Promise(resolve => setTimeout(resolve, 1000));
            retries++;
          }
        }
        
        // CRITICAL FIX: Calculate delta using bigint to avoid precision loss
        const tokensBoughtRaw = balanceAfterBuyRaw - balanceBeforeBuyRaw;
        tokensBought = Number(tokensBoughtRaw) / Math.pow(10, tokenDecimals);
        
        const balanceAfterBuyHuman = Number(balanceAfterBuyRaw) / Math.pow(10, tokenDecimals);
        
        console.log(`[Buyback & Burn] Post-buy balance: ${balanceAfterBuyHuman.toLocaleString()} tokens (raw: ${balanceAfterBuyRaw})`);
        console.log(`[Buyback & Burn] Delta: ${tokensBought.toLocaleString()} tokens (raw: ${tokensBoughtRaw})`);
        
        if (tokensBoughtRaw <= 0) {
          console.error("[Buyback & Burn] No tokens were acquired in the swap!");
          return {
            success: false,
            buybackSOL,
            buyTxSignature,
            error: "No tokens acquired from swap (balance delta is zero or negative)",
          };
        }
      } catch (error: any) {
        console.error("[Buyback & Burn] Failed to fetch post-buy token balance:", error.message);
        return {
          success: false,
          buybackSOL,
          buyTxSignature,
          error: `Failed to fetch token balance after buy: ${error.message}`,
        };
      }
    }

    console.log(`[Buyback & Burn] Bought ${tokensBought.toLocaleString()} tokens`);

    // Step 2: Burn the tokens permanently using exact raw amount
    console.log("[Buyback & Burn] Burning tokens...");

    try {
      // Get the associated token account
      const tokenAccount = await getAssociatedTokenAddress(
        tokenMintPubkey,
        treasuryPubkey
      );

      // CRITICAL: Use exact raw amount to burn precisely what was purchased (no rounding errors)
      // Re-fetch current balance to get the exact raw delta
      const currentAccountInfo = await connection.getTokenAccountBalance(tokenAccount);
      const currentBalanceRaw = BigInt(currentAccountInfo.value.amount);
      const burnAmountRaw = currentBalanceRaw - balanceBeforeBuyRaw; // Exact delta

      if (burnAmountRaw <= 0) {
        console.error("[Buyback & Burn] Cannot burn: delta is zero or negative");
        return {
          success: false,
          buybackSOL,
          buyTxSignature,
          error: "No tokens to burn (balance delta is zero or negative)",
        };
      }

      console.log(`[Buyback & Burn] Burning exact amount: ${burnAmountRaw} (raw units)`);

      // Create burn instruction - this PERMANENTLY DESTROYS the tokens
      const burnInstruction = createBurnInstruction(
        tokenAccount,
        tokenMintPubkey,
        treasuryPubkey,
        burnAmountRaw // Use bigint directly
      );

      // Create and send burn transaction
      const burnTransaction = new Transaction().add(burnInstruction);
      burnTransaction.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
      burnTransaction.feePayer = treasuryPubkey;

      burnTransaction.sign(treasuryKeypair);

      const burnTxSignature = await connection.sendRawTransaction(burnTransaction.serialize(), {
        skipPreflight: false,
        maxRetries: 3,
      });

      await connection.confirmTransaction(burnTxSignature, "confirmed");

      console.log(`[Buyback & Burn] ✅ TOKENS PERMANENTLY BURNED: ${tokensBought.toLocaleString()} tokens destroyed`);
      console.log(`[Buyback & Burn] Burn signature: ${burnTxSignature}`);

      // Update total buyback statistics
      await db
        .update(aiBotConfigs)
        .set({
          totalBuybackSOL: (parseFloat(config.totalBuybackSOL || "0") + buybackSOL).toString(),
          totalTokensBurned: (parseFloat(config.totalTokensBurned || "0") + tokensBought).toString(),
        })
        .where(eq(aiBotConfigs.ownerWalletAddress, ownerWallet));

      return {
        success: true,
        buybackSOL,
        tokensBought,
        tokensBurned: tokensBought,
        buyTxSignature,
        burnTxSignature,
      };
    } catch (burnError: any) {
      console.error("[Buyback & Burn] Burn failed:", burnError);
      return {
        success: false,
        buybackSOL,
        tokensBought,
        buyTxSignature,
        error: `Tokens bought but burn failed: ${burnError.message}`,
      };
    }
  } catch (error: any) {
    console.error("[Buyback & Burn] Error:", error);
    return {
      success: false,
      error: error.message || "Unknown error",
    };
  }
}
