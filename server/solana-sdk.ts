// Solana SDK integration for transaction signing and execution
// This module handles all blockchain writes: swaps, transfers, and burns

import {
  Connection,
  Keypair,
  VersionedTransaction,
  PublicKey,
  Transaction,
  sendAndConfirmTransaction,
  SystemProgram,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import {
  getAssociatedTokenAddress,
  createTransferInstruction,
  createBurnInstruction,
  createAssociatedTokenAccountIdempotentInstruction,
  getMint,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import bs58 from "bs58";
import nacl from "tweetnacl";

// Solana RPC endpoint - using devnet for hackathon demo
const SOLANA_RPC_ENDPOINT = process.env.SOLANA_RPC_ENDPOINT || "https://api.devnet.solana.com";
const connection = new Connection(SOLANA_RPC_ENDPOINT, "confirmed");

/**
 * Load a keypair from a private key in various formats
 * Supports: base58 string, JSON array string, hex string, or number array
 */
export function loadKeypairFromPrivateKey(privateKey: string | number[]): Keypair {
  try {
    // If it's already an array
    if (Array.isArray(privateKey)) {
      return Keypair.fromSecretKey(Uint8Array.from(privateKey));
    }

    const keyStr = privateKey.trim();

    // Try JSON array format first: "[1,2,3,...]"
    if (keyStr.startsWith('[')) {
      const keyArray = JSON.parse(keyStr);
      if (Array.isArray(keyArray)) {
        return Keypair.fromSecretKey(Uint8Array.from(keyArray));
      }
    }

    // Try base58 format (most common from Phantom/Solflare export)
    try {
      const privateKeyBytes = bs58.decode(keyStr);
      if (privateKeyBytes.length === 64) {
        return Keypair.fromSecretKey(privateKeyBytes);
      }
    } catch (e) {
      // Not base58, try next format
    }

    // Try hex format
    if (keyStr.match(/^[0-9a-fA-F]{128}$/)) {
      const bytes = Buffer.from(keyStr, 'hex');
      return Keypair.fromSecretKey(bytes);
    }

    throw new Error('Unsupported format. Expected: base58 string, JSON array "[1,2,3...]", or 128-char hex string');
  } catch (error) {
    throw new Error(`Invalid private key format: ${error instanceof Error ? error.message : error}`);
  }
}

/**
 * Sign and send a versioned transaction (used by Jupiter Ultra and PumpFun)
 */
export async function signAndSendVersionedTransaction(
  transactionBase64: string,
  signerKeypair: Keypair,
  commitment: "processed" | "confirmed" | "finalized" = "confirmed"
): Promise<string> {
  try {
    // Deserialize the transaction
    const transactionBuffer = Buffer.from(transactionBase64, "base64");
    const transaction = VersionedTransaction.deserialize(transactionBuffer);

    // Sign the transaction
    transaction.sign([signerKeypair]);

    // Send and confirm the transaction
    const signature = await connection.sendTransaction(transaction, {
      skipPreflight: false,
      maxRetries: 3,
    });

    // Wait for confirmation
    const confirmation = await connection.confirmTransaction(signature, commitment);

    if (confirmation.value.err) {
      throw new Error(`Transaction failed: ${JSON.stringify(confirmation.value.err)}`);
    }

    console.log(`Transaction confirmed: ${signature}`);
    return signature;
  } catch (error) {
    console.error("Error signing and sending transaction:", error);
    throw error;
  }
}

/**
 * Sign and send a legacy transaction
 */
export async function signAndSendTransaction(
  transaction: Transaction,
  signerKeypair: Keypair,
  commitment: "processed" | "confirmed" | "finalized" = "confirmed"
): Promise<string> {
  try {
    const signature = await sendAndConfirmTransaction(
      connection,
      transaction,
      [signerKeypair],
      {
        commitment,
        skipPreflight: false,
      }
    );

    console.log(`Transaction confirmed: ${signature}`);
    return signature;
  } catch (error) {
    console.error("Error signing and sending transaction:", error);
    throw error;
  }
}

/**
 * Transfer SPL tokens to a destination address
 * Supports both regular addresses and off-curve addresses (like incinerator)
 */
export async function transferTokens(
  tokenMintAddress: string,
  fromWalletKeypair: Keypair,
  toAddress: string,
  amount: number,
  decimals: number = 9
): Promise<string> {
  try {
    const mintPublicKey = new PublicKey(tokenMintAddress);
    const fromPublicKey = fromWalletKeypair.publicKey;
    const toPublicKey = new PublicKey(toAddress);

    // Get source token account
    const fromTokenAccount = await getAssociatedTokenAddress(
      mintPublicKey,
      fromPublicKey
    );

    // For off-curve addresses (like incinerator), use allowOwnerOffCurve
    const toTokenAccount = await getAssociatedTokenAddress(
      mintPublicKey,
      toPublicKey,
      true // allowOwnerOffCurve - required for incinerator
    );

    // Create transfer instruction
    const transferInstruction = createTransferInstruction(
      fromTokenAccount,
      toTokenAccount,
      fromPublicKey,
      amount * Math.pow(10, decimals), // Convert to smallest unit
      [],
      TOKEN_PROGRAM_ID
    );

    // Create transaction
    const transaction = new Transaction().add(transferInstruction);

    // Get recent blockhash
    const { blockhash } = await connection.getLatestBlockhash();
    transaction.recentBlockhash = blockhash;
    transaction.feePayer = fromPublicKey;

    // Sign and send
    const signature = await signAndSendTransaction(transaction, fromWalletKeypair);

    console.log(`Token transfer completed: ${signature}`);
    return signature;
  } catch (error) {
    console.error("Error transferring tokens:", error);
    throw error;
  }
}

/**
 * Burn tokens using SPL Token burn instruction
 * This is more efficient than transferring to incinerator as it directly reduces supply
 */
export async function burnTokens(
  tokenMintAddress: string,
  walletKeypair: Keypair,
  amount: number,
  decimals: number = 9
): Promise<string> {
  try {
    const mintPublicKey = new PublicKey(tokenMintAddress);
    const fromPublicKey = walletKeypair.publicKey;

    // Get token account
    const tokenAccount = await getAssociatedTokenAddress(
      mintPublicKey,
      fromPublicKey
    );

    // Create burn instruction
    const burnInstruction = createBurnInstruction(
      tokenAccount,
      mintPublicKey,
      fromPublicKey,
      amount * Math.pow(10, decimals), // Convert to smallest unit
      [],
      TOKEN_PROGRAM_ID
    );

    // Create transaction
    const transaction = new Transaction().add(burnInstruction);

    // Get recent blockhash
    const { blockhash } = await connection.getLatestBlockhash();
    transaction.recentBlockhash = blockhash;
    transaction.feePayer = fromPublicKey;

    // Sign and send
    const signature = await signAndSendTransaction(transaction, walletKeypair);

    console.log(`Token burn completed: ${signature}`);
    return signature;
  } catch (error) {
    console.error("Error burning tokens:", error);
    throw error;
  }
}

/**
 * Alternative: Transfer tokens to the Solana incinerator address
 * Creates the associated token account if needed (incinerator is an off-curve address)
 * Note: The primary burn method (burnTokens) is more efficient
 */
export async function transferToIncinerator(
  tokenMintAddress: string,
  walletKeypair: Keypair,
  amount: number,
  decimals?: number
): Promise<string> {
  try {
    const SOLANA_INCINERATOR = "1nc1nerator11111111111111111111111111111111";
    const mintPublicKey = new PublicKey(tokenMintAddress);
    const fromPublicKey = walletKeypair.publicKey;
    const incineratorPublicKey = new PublicKey(SOLANA_INCINERATOR);
    
    console.log(`Transferring ${amount} tokens to incinerator: ${SOLANA_INCINERATOR}`);
    console.log(`Decimals parameter received: ${decimals} (type: ${typeof decimals})`);
    
    // Get token decimals from the mint if not provided
    let tokenDecimals: number;
    if (decimals !== undefined) {
      console.log(`Using provided decimals: ${decimals}`);
      tokenDecimals = decimals;
    } else {
      console.log(`Fetching decimals from mint...`);
      const mintInfo = await getMint(connection, mintPublicKey);
      tokenDecimals = mintInfo.decimals;
      console.log(`Token decimals detected from mint: ${tokenDecimals}`);
    }
    
    // Get token accounts
    const fromTokenAccount = await getAssociatedTokenAddress(
      mintPublicKey,
      fromPublicKey
    );

    const incineratorTokenAccount = await getAssociatedTokenAddress(
      mintPublicKey,
      incineratorPublicKey,
      true // allowOwnerOffCurve - required for incinerator
    );

    // Create transaction
    const transaction = new Transaction();
    
    // Create the incinerator's associated token account if it doesn't exist
    transaction.add(
      createAssociatedTokenAccountIdempotentInstruction(
        fromPublicKey, // payer
        incineratorTokenAccount, // associatedToken
        incineratorPublicKey, // owner
        mintPublicKey, // mint
        TOKEN_PROGRAM_ID
      )
    );

    // Create transfer instruction with correct decimals
    const transferAmount = amount * Math.pow(10, tokenDecimals);
    console.log(`Transfer amount in base units: ${transferAmount} (${amount} tokens * 10^${tokenDecimals})`);
    
    transaction.add(
      createTransferInstruction(
        fromTokenAccount,
        incineratorTokenAccount,
        fromPublicKey,
        transferAmount,
        [],
        TOKEN_PROGRAM_ID
      )
    );

    // Get recent blockhash
    const { blockhash } = await connection.getLatestBlockhash();
    transaction.recentBlockhash = blockhash;
    transaction.feePayer = fromPublicKey;

    // Sign and send
    const signature = await signAndSendTransaction(transaction, walletKeypair);

    console.log(`Token transfer to incinerator completed: ${signature}`);
    return signature;
  } catch (error) {
    console.error("Error transferring tokens to incinerator:", error);
    throw error;
  }
}

/**
 * Get SOL balance for a public key
 */
export async function getSolBalance(publicKeyString: string): Promise<number> {
  try {
    const publicKey = new PublicKey(publicKeyString);
    const balance = await connection.getBalance(publicKey);
    return balance / LAMPORTS_PER_SOL;
  } catch (error) {
    console.error("Error getting SOL balance:", error);
    throw error;
  }
}

/**
 * Get token balance for a wallet
 */
export async function getTokenBalance(
  tokenMintAddress: string,
  walletAddress: string
): Promise<number> {
  try {
    const mintPublicKey = new PublicKey(tokenMintAddress);
    const walletPublicKey = new PublicKey(walletAddress);

    const tokenAccount = await getAssociatedTokenAddress(
      mintPublicKey,
      walletPublicKey
    );

    const balance = await connection.getTokenAccountBalance(tokenAccount);
    return parseFloat(balance.value.amount) / Math.pow(10, balance.value.decimals);
  } catch (error) {
    console.error("Error getting token balance:", error);
    return 0; // Return 0 if account doesn't exist
  }
}

/**
 * Validate that a string is a valid Solana public key
 */
export function isValidPublicKey(address: string): boolean {
  try {
    new PublicKey(address);
    return true;
  } catch {
    return false;
  }
}

/**
 * Get connection instance (useful for advanced operations)
 */
export function getConnection(): Connection {
  return connection;
}

/**
 * Wait for transaction confirmation with timeout
 */
export async function waitForConfirmation(
  signature: string,
  commitment: "processed" | "confirmed" | "finalized" = "confirmed",
  timeoutMs: number = 30000
): Promise<void> {
  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    const status = await connection.getSignatureStatus(signature);
    
    if (status.value?.confirmationStatus === commitment || 
        status.value?.confirmationStatus === "finalized") {
      if (status.value.err) {
        throw new Error(`Transaction failed: ${JSON.stringify(status.value.err)}`);
      }
      return;
    }

    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  throw new Error(`Transaction confirmation timeout after ${timeoutMs}ms`);
}

/**
 * Verify a wallet signature to prove ownership
 * Used for authenticating manual buyback requests
 */
export async function verifyWalletSignature(
  walletAddress: string,
  message: string,
  signatureBase58: string
): Promise<boolean> {
  try {
    // Convert the wallet address to a PublicKey
    const publicKey = new PublicKey(walletAddress);
    
    // Decode the signature from base58
    const signatureBytes = bs58.decode(signatureBase58);
    
    // Convert message to bytes
    const messageBytes = new TextEncoder().encode(message);
    
    // Verify the signature using nacl
    const isValid = nacl.sign.detached.verify(
      messageBytes,
      signatureBytes,
      publicKey.toBytes()
    );
    
    return isValid;
  } catch (error) {
    console.error("Error verifying wallet signature:", error);
    return false;
  }
}
