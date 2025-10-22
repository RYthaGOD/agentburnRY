// Transaction fee system - 0.5% fee after 60th transaction
// Fee is sent to the payment address

import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import { storage } from "./storage";
import { TREASURY_WALLET_ADDRESS } from "@shared/config";

const FEE_PERCENTAGE = 0.005; // 0.5%
const FREE_TRANSACTION_LIMIT = 60;

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
      process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com"
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
