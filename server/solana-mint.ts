// Solana SPL Token Mint utilities
// Fetches token metadata including decimal places

import { Connection, PublicKey } from "@solana/web3.js";
import { getMint } from "@solana/spl-token";

const SOLANA_RPC_URL = process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com";

/**
 * Fetch token mint decimals from Solana blockchain
 * @param mintAddress - Token mint address
 * @returns Token decimals (typically 6, 8, or 9)
 */
export async function getTokenDecimals(mintAddress: string): Promise<number> {
  try {
    const connection = new Connection(SOLANA_RPC_URL, "confirmed");
    const mintPublicKey = new PublicKey(mintAddress);
    const mintInfo = await getMint(connection, mintPublicKey);
    
    console.log(`[Mint] Fetched decimals for ${mintAddress}: ${mintInfo.decimals}`);
    return mintInfo.decimals;
  } catch (error: any) {
    console.error(`[Mint] Error fetching decimals for ${mintAddress}:`, error.message);
    // Default to 9 decimals (Solana standard) if fetch fails
    return 9;
  }
}
