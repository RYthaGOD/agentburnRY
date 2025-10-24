// Solana blockchain interactions using RPC API
// This implementation uses REST API calls instead of @solana/web3.js to bypass package installation issues

import { TREASURY_WALLET_ADDRESS, SOLANA_INCINERATOR_ADDRESS } from "@shared/config";

const SOLANA_RPC_ENDPOINT = "https://api.mainnet-beta.solana.com";

interface SolanaTransaction {
  signature: string;
  slot: number;
  blockTime: number | null;
  meta: {
    err: null | object;
    fee: number;
    preBalances: number[];
    postBalances: number[];
  };
  transaction: {
    message: {
      accountKeys: string[];
      instructions: any[];
    };
  };
}

interface PaymentVerification {
  verified: boolean;
  amount?: number;
  signature?: string;
  fromAddress?: string;
  error?: string;
}

/**
 * Verify a SOL payment to the treasury wallet with strict security checks
 */
export async function verifyPayment(
  signature: string,
  expectedAmount: number,
  tolerance: number = 0.001 // Allow 0.001 SOL tolerance for transaction fees
): Promise<PaymentVerification> {
  try {
    // First, verify the signature is finalized (not just confirmed)
    const signatureStatus = await fetch(SOLANA_RPC_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "getSignatureStatuses",
        params: [[signature], { searchTransactionHistory: true }],
      }),
    });

    const statusData = await signatureStatus.json();
    const status = statusData.result?.value?.[0];

    if (!status) {
      return {
        verified: false,
        error: "Transaction signature not found on blockchain",
      };
    }

    if (status.confirmationStatus !== "finalized") {
      return {
        verified: false,
        error: "Transaction not finalized yet. Please wait a few moments and try again.",
      };
    }

    if (status.err) {
      return {
        verified: false,
        error: "Transaction failed on blockchain",
      };
    }

    // Now get the full transaction details
    const response = await fetch(SOLANA_RPC_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "getTransaction",
        params: [
          signature,
          {
            encoding: "json",
            commitment: "finalized",
            maxSupportedTransactionVersion: 0,
          },
        ],
      }),
    });

    const data = await response.json();

    if (data.error) {
      return {
        verified: false,
        error: `Transaction not found: ${data.error.message}`,
      };
    }

    const tx = data.result as SolanaTransaction;

    if (!tx) {
      return {
        verified: false,
        error: "Transaction not found on blockchain",
      };
    }

    // Check if transaction was successful
    if (tx.meta.err !== null) {
      return {
        verified: false,
        error: "Transaction failed on blockchain",
      };
    }

    // Find the treasury wallet in account keys
    const accountKeys = tx.transaction.message.accountKeys;
    const treasuryIndex = accountKeys.findIndex(
      (key) => key === TREASURY_WALLET_ADDRESS
    );

    if (treasuryIndex === -1) {
      return {
        verified: false,
        error: "Payment not sent to the correct treasury address",
      };
    }

    // Calculate the amount transferred (difference in balances)
    const preBalance = tx.meta.preBalances[treasuryIndex];
    const postBalance = tx.meta.postBalances[treasuryIndex];
    const amountLamports = postBalance - preBalance;
    const amountSOL = amountLamports / 1e9; // Convert lamports to SOL

    // Strict amount validation - must be within tolerance of expected amount
    const minAmount = expectedAmount - tolerance;
    const maxAmount = expectedAmount + tolerance;

    if (amountSOL < minAmount || amountSOL > maxAmount) {
      return {
        verified: false,
        error: `Invalid payment amount. Expected ${expectedAmount} SOL, received ${amountSOL} SOL`,
      };
    }

    // Get the sender address (first account that's not the treasury)
    const fromAddress = accountKeys.find((key) => key !== TREASURY_WALLET_ADDRESS);

    return {
      verified: true,
      amount: expectedAmount, // Use expected amount to prevent rounding issues
      signature,
      fromAddress,
    };
  } catch (error) {
    console.error("Error verifying payment:", error);
    return {
      verified: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Get wallet balance in SOL
 */
export async function getWalletBalance(walletAddress: string): Promise<number> {
  try {
    const response = await fetch(SOLANA_RPC_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "getBalance",
        params: [walletAddress],
      }),
    });

    const data = await response.json();

    if (data.error) {
      throw new Error(`Failed to get balance: ${data.error.message}`);
    }

    const balanceLamports = data.result.value;
    return balanceLamports / 1e9; // Convert to SOL
  } catch (error) {
    console.error("Error getting wallet balance:", error);
    throw error;
  }
}

/**
 * Get SPL token balance for a wallet
 */
export async function getTokenBalance(
  walletAddress: string,
  tokenMintAddress: string
): Promise<number> {
  try {
    const response = await fetch(SOLANA_RPC_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "getTokenAccountsByOwner",
        params: [
          walletAddress,
          {
            mint: tokenMintAddress,
          },
          {
            encoding: "jsonParsed",
          },
        ],
      }),
    });

    const data = await response.json();

    if (data.error) {
      throw new Error(`Failed to get token balance: ${data.error.message}`);
    }

    if (data.result.value.length === 0) {
      return 0; // No token account found
    }

    const tokenAccount = data.result.value[0];
    const balance = tokenAccount.account.data.parsed.info.tokenAmount.uiAmount;
    return balance;
  } catch (error) {
    console.error("Error getting token balance:", error);
    throw error;
  }
}

/**
 * Verify a transaction signature exists and is confirmed
 */
export async function verifyTransactionSignature(signature: string): Promise<boolean> {
  try {
    const response = await fetch(SOLANA_RPC_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "getSignatureStatuses",
        params: [[signature]],
      }),
    });

    const data = await response.json();

    if (data.error) {
      return false;
    }

    const status = data.result.value[0];
    return status !== null && status.confirmationStatus === "confirmed";
  } catch (error) {
    console.error("Error verifying transaction signature:", error);
    return false;
  }
}

/**
 * Get all SPL token accounts for a wallet
 */
export async function getAllTokenAccounts(walletAddress: string): Promise<any[]> {
  try {
    const response = await fetch(SOLANA_RPC_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "getTokenAccountsByOwner",
        params: [
          walletAddress,
          {
            programId: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", // SPL Token Program
          },
          {
            encoding: "jsonParsed",
          },
        ],
      }),
    });

    const data = await response.json();

    if (data.error) {
      throw new Error(`Failed to get token accounts: ${data.error.message}`);
    }

    return data.result.value || [];
  } catch (error) {
    console.error("Error getting token accounts:", error);
    throw error;
  }
}

/**
 * Check if a wallet address is valid using PublicKey validation
 * This is more robust than regex-based validation
 */
export function isValidSolanaAddress(address: string): boolean {
  try {
    // Use Solana's PublicKey to validate the address
    // This ensures the address is a valid base58-encoded 32-byte public key
    const { PublicKey } = require("@solana/web3.js");
    new PublicKey(address);
    return true;
  } catch {
    return false;
  }
}
