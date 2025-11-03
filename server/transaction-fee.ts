// Transaction fee system
// - Project fee: 0.5% fee after 60th transaction
// - Platform fee: 1% fee on all AI bot trades (except exempt wallets)
// Fees are sent to the treasury address

import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import { storage } from "./storage";
import { TREASURY_WALLET_ADDRESS } from "@shared/config";

const FEE_PERCENTAGE = 0.005; // 0.5%
const FREE_TRANSACTION_LIMIT = 60;

// Platform fee for AI bot trades
const PLATFORM_FEE_PERCENTAGE = 0.01; // 1%
const FEE_EXEMPT_WALLETS = [
  "924yATAEdnrYmncJMX2je7dpiEfVRqCSPmQ2NK3QfoXA" // Exempt from all platform fees
];

/**
 * Checks if a wallet is exempt from platform fees
 */
export function isWalletExemptFromFees(walletAddress: string): boolean {
  return FEE_EXEMPT_WALLETS.includes(walletAddress);
}

/**
 * Checks if a project should pay transaction fees
 * Returns true if transaction count >= 60
 */
export async function shouldPayTransactionFee(projectId: string): Promise<boolean> {
  const transactions = await storage.getTransactionsByProject(projectId);
  return transactions.length >= FREE_TRANSACTION_LIMIT;
}

/**
 * Calculates the fee amount (0.5% of SOL amount)
 */
export function calculateFee(solAmount: number): number {
  return solAmount * FEE_PERCENTAGE;
}

/**
 * Deducts transaction fee and sends it to the payment address
 * Returns the remaining SOL amount to use for the actual transaction
 * 
 * @param projectId - Project ID
 * @param solAmount - Total SOL amount for the transaction
 * @param treasuryKeypair - Treasury wallet keypair to send from
 * @returns Remaining SOL amount after fee deduction
 */
export async function deductTransactionFee(
  projectId: string,
  solAmount: number,
  treasuryKeypair: Keypair
): Promise<{ remainingAmount: number; feeDeducted: number; txSignature?: string }> {
  // Check if fee applies
  const shouldPay = await shouldPayTransactionFee(projectId);
  
  if (!shouldPay) {
    return {
      remainingAmount: solAmount,
      feeDeducted: 0,
    };
  }

  // Calculate fee
  const feeAmount = calculateFee(solAmount);
  const remainingAmount = solAmount - feeAmount;

  console.log(`[Transaction Fee] Project has ${(await storage.getTransactionsByProject(projectId)).length} transactions`);
  console.log(`[Transaction Fee] Deducting ${feeAmount} SOL (0.5%) from ${solAmount} SOL`);
  console.log(`[Transaction Fee] Remaining amount: ${remainingAmount} SOL`);

  try {
    // Send fee to payment address
    const connection = new Connection(
      process.env.SOLANA_RPC_URL || "https://api.devnet.solana.com"
    );

    const transaction = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: treasuryKeypair.publicKey,
        toPubkey: new PublicKey(TREASURY_WALLET_ADDRESS),
        lamports: Math.floor(feeAmount * LAMPORTS_PER_SOL),
      })
    );

    const { blockhash } = await connection.getLatestBlockhash();
    transaction.recentBlockhash = blockhash;
    transaction.feePayer = treasuryKeypair.publicKey;
    transaction.sign(treasuryKeypair);

    const txSignature = await connection.sendRawTransaction(transaction.serialize());
    await connection.confirmTransaction(txSignature);

    console.log(`[Transaction Fee] Fee sent to ${TREASURY_WALLET_ADDRESS}: ${txSignature}`);

    return {
      remainingAmount,
      feeDeducted: feeAmount,
      txSignature,
    };
  } catch (error) {
    console.error("[Transaction Fee] Failed to send fee:", error);
    // On error, return full amount (don't block the transaction)
    return {
      remainingAmount: solAmount,
      feeDeducted: 0,
    };
  }
}

/**
 * Deducts 1% platform fee from AI bot trades
 * Exempts specific whitelisted wallets from fees
 * 
 * @param walletAddress - User's wallet address
 * @param solAmount - Total SOL amount for the transaction
 * @param treasuryKeypair - Treasury wallet keypair to send from
 * @returns Remaining SOL amount after fee deduction
 */
export async function deductPlatformFee(
  walletAddress: string,
  solAmount: number,
  treasuryKeypair: Keypair
): Promise<{ remainingAmount: number; feeDeducted: number; txSignature?: string; isExempt: boolean }> {
  // Check if wallet is exempt
  const isExempt = isWalletExemptFromFees(walletAddress);
  
  if (isExempt) {
    console.log(`[Platform Fee] ✅ Wallet ${walletAddress} is EXEMPT from platform fees`);
    return {
      remainingAmount: solAmount,
      feeDeducted: 0,
      isExempt: true,
    };
  }

  // Calculate 1% platform fee
  const feeAmount = solAmount * PLATFORM_FEE_PERCENTAGE;
  const remainingAmount = solAmount - feeAmount;

  console.log(`[Platform Fee] Deducting ${feeAmount.toFixed(6)} SOL (1%) from ${solAmount.toFixed(6)} SOL`);
  console.log(`[Platform Fee] Remaining amount: ${remainingAmount.toFixed(6)} SOL`);

  try {
    // Send fee to treasury address
    const connection = new Connection(
      process.env.SOLANA_RPC_URL || "https://api.devnet.solana.com"
    );

    const transaction = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: treasuryKeypair.publicKey,
        toPubkey: new PublicKey(TREASURY_WALLET_ADDRESS),
        lamports: Math.floor(feeAmount * LAMPORTS_PER_SOL),
      })
    );

    const { blockhash } = await connection.getLatestBlockhash();
    transaction.recentBlockhash = blockhash;
    transaction.feePayer = treasuryKeypair.publicKey;
    transaction.sign(treasuryKeypair);

    const txSignature = await connection.sendRawTransaction(transaction.serialize());
    await connection.confirmTransaction(txSignature);

    console.log(`[Platform Fee] ✅ Fee sent to ${TREASURY_WALLET_ADDRESS}: ${txSignature}`);

    return {
      remainingAmount,
      feeDeducted: feeAmount,
      txSignature,
      isExempt: false,
    };
  } catch (error) {
    console.error("[Platform Fee] ❌ Failed to send fee:", error);
    // On error, return full amount (don't block the transaction)
    console.log("[Platform Fee] ⚠️ Proceeding with full amount due to fee transfer error");
    return {
      remainingAmount: solAmount,
      feeDeducted: 0,
      isExempt: false,
    };
  }
}
