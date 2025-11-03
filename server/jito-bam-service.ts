import { Connection, Keypair, PublicKey, Transaction, VersionedTransaction, TransactionMessage, SystemProgram } from "@solana/web3.js";
import { searcherClient } from "@solsdk/jito-ts/dist/sdk/block-engine/searcher.js";
import { Bundle } from "@solsdk/jito-ts/dist/sdk/block-engine/types.js";
import { db } from "./db";
import { bamBundles, type InsertBamBundle } from "@shared/schema";
import { eq } from "drizzle-orm";

const RPC_ENDPOINT = process.env.SOLANA_RPC_URL || "https://api.devnet.solana.com";
const connection = new Connection(RPC_ENDPOINT, "confirmed");

// Jito Block Engine URLs (regional endpoints for lower latency)
const JITO_BLOCK_ENGINES = {
  mainnet: "https://mainnet.block-engine.jito.wtf",
  ny: "https://ny.mainnet.block-engine.jito.wtf",
  amsterdam: "https://amsterdam.mainnet.block-engine.jito.wtf",
  frankfurt: "https://frankfurt.mainnet.block-engine.jito.wtf",
  tokyo: "https://tokyo.mainnet.block-engine.jito.wtf",
};

// Jito Tip Accounts (mainnet) - tip MUST go to one of these addresses
const JITO_TIP_ACCOUNTS = [
  "96gYZGLnJYVFmbjzopPSU6QiEV5fGqZNyN9nmNhvrZU5",
  "HFqU5x63VTqvQss8hp11i4wVV8bD44PvwucfZ2bU7gRe",
  "Cw8CFyM9FkoMi7K7Crf6HNQqf4uEMzpKw6QNghXLvLkY",
  "ADaUMid9yfUytqMBgopwjb2DTLSokTSzL1zt6iGPaS49",
  "DfXygSm4jCyNCybVYYK6DwvWqjKee8pbDmJGcLWNDXjh",
  "ADuUkR4vqLUMWXxW9gh6D6L8pMSawimctcNZ5pGwDcEt",
  "DttWaMuVvTiduZRnguLF7jNxTgiMBZ1hyAumKUiL2KRL",
  "3AVi9Tg9Uo68tJfuvoKvqKNWKkC5wPdSSdeBnizKZ6jT",
];

/**
 * Jito BAM (Block Assembly Marketplace) Service
 * Enables atomic trade+burn bundles with MEV protection
 * 
 * Key Features:
 * - Atomic execution (all txs succeed or none execute)
 * - MEV protection (private transaction ordering in TEE)
 * - Guaranteed sequencing (txs execute in order)
 * - Fast finality (priority inclusion via tips)
 */
export class JitoBamService {
  private blockEngineUrl: string;
  private tipLamports: number; // Default tip amount

  constructor(
    region: keyof typeof JITO_BLOCK_ENGINES = "mainnet",
    tipLamports: number = 10_000 // 0.00001 SOL default tip
  ) {
    this.blockEngineUrl = JITO_BLOCK_ENGINES[region];
    this.tipLamports = tipLamports;
    console.log(`[BAM] Initialized with block engine: ${this.blockEngineUrl}`);
    console.log(`[BAM] Default tip: ${tipLamports / 1e9} SOL`);
  }

  /**
   * Get a random Jito tip account (for load balancing)
   */
  private getRandomTipAccount(): PublicKey {
    const randomIndex = Math.floor(Math.random() * JITO_TIP_ACCOUNTS.length);
    return new PublicKey(JITO_TIP_ACCOUNTS[randomIndex]);
  }

  /**
   * Create a tip transaction (MUST be last transaction in bundle)
   * @param payer - Wallet paying the tip
   * @param tipLamports - Tip amount in lamports (min 1000)
   * @param blockhash - Recent blockhash
   */
  private async createTipTransaction(
    payer: Keypair,
    tipLamports: number,
    blockhash: string
  ): Promise<Transaction> {
    const tipAccount = this.getRandomTipAccount();
    
    const tipIx = SystemProgram.transfer({
      fromPubkey: payer.publicKey,
      toPubkey: tipAccount,
      lamports: tipLamports,
    });

    const tipTx = new Transaction().add(tipIx);
    tipTx.recentBlockhash = blockhash;
    tipTx.feePayer = payer.publicKey;
    
    console.log(`[BAM] Created tip transaction: ${tipLamports / 1e9} SOL to ${tipAccount.toString()}`);
    return tipTx;
  }

  /**
   * Send atomic bundle to Jito Block Engine
   * @param transactions - Array of transactions (max 5, tip goes last)
   * @param signer - Keypair to sign all transactions
   * @param bundleType - Type of bundle (trade_burn, arbitrage, liquidation)
   * @param metadata - Additional metadata for tracking
   */
  async sendBundle(
    transactions: Transaction[],
    signer: Keypair,
    bundleType: "trade_burn" | "arbitrage" | "liquidation",
    metadata?: {
      ownerWallet?: string;
      relatedPositionId?: string;
      tradeAmountSOL?: number;
      burnAmountTokens?: number;
    }
  ): Promise<{
    success: boolean;
    bundleId?: string;
    signatures?: string[];
    error?: string;
    dbRecordId?: string;
  }> {
    try {
      const ownerWallet = metadata?.ownerWallet || signer.publicKey.toString();
      
      console.log(`[BAM] Preparing ${bundleType} bundle with ${transactions.length} transactions`);
      
      // Validate bundle size (max 5 transactions + 1 tip = 6 total)
      if (transactions.length > 5) {
        return {
          success: false,
          error: `Bundle too large: ${transactions.length} transactions (max 5 + tip)`
        };
      }

      // Get recent blockhash
      const { blockhash } = await connection.getLatestBlockhash();

      // Add blockhash to all transactions
      transactions.forEach(tx => {
        tx.recentBlockhash = blockhash;
        tx.feePayer = signer.publicKey;
      });

      // Create and add tip transaction (MUST be last)
      const tipTx = await this.createTipTransaction(signer, this.tipLamports, blockhash);
      const allTxs = [...transactions, tipTx];

      // Sign all transactions
      allTxs.forEach(tx => tx.sign(signer));

      // Serialize transactions for bundle
      const serializedTxs = allTxs.map(tx => tx.serialize());
      
      console.log(`[BAM] Bundle prepared: ${allTxs.length} transactions (${transactions.length} + 1 tip)`);

      // Create Jito searcher client
      const client = searcherClient(this.blockEngineUrl);

      // Send bundle (pass serialized transactions directly)
      const bundleId = await client.sendBundle(serializedTxs as any);
      
      console.log(`[BAM] ✅ Bundle sent to Jito: ${bundleId}`);

      // Extract signatures from signed transactions
      const signatures = allTxs.map((tx, idx) => {
        // Get signature from transaction
        const sig = tx.signatures[0];
        if (!sig || !sig.signature) {
          console.warn(`[BAM] Warning: Transaction ${idx} has no signature`);
          return `unsigned_${idx}`;
        }
        return Buffer.from(sig.signature).toString('base64');
      });

      // Record bundle in database
      const [bundleRecord] = await db.insert(bamBundles).values({
        ownerWalletAddress: ownerWallet,
        bundleId: bundleId.toString(),
        bundleType,
        transactionCount: allTxs.length,
        txSignatures: signatures,
        status: "pending",
        tipAmountLamports: this.tipLamports.toString(),
        tipAccountUsed: this.getRandomTipAccount().toString(),
        relatedPositionId: metadata?.relatedPositionId,
        tradeAmountSOL: metadata?.tradeAmountSOL?.toString(),
        burnAmountTokens: metadata?.burnAmountTokens?.toString(),
        submittedAt: new Date(),
      }).returning();

      console.log(`[BAM] Bundle recorded in database: ${bundleRecord.id}`);

      // Start background task to monitor bundle status
      this.monitorBundleStatus(bundleId.toString(), bundleRecord.id).catch(error => {
        console.error(`[BAM] Error monitoring bundle ${bundleId}:`, error);
      });

      return {
        success: true,
        bundleId: bundleId.toString(),
        signatures,
        dbRecordId: bundleRecord.id,
      };
    } catch (error) {
      console.error(`[BAM] Bundle error:`, error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown bundle error"
      };
    }
  }

  /**
   * Monitor bundle status and update database
   * Polls Jito for bundle confirmation and updates the database record
   */
  private async monitorBundleStatus(bundleId: string, dbRecordId: string) {
    const startTime = Date.now();
    const maxWaitTime = 30_000; // 30 seconds max wait
    const pollInterval = 2_000; // Poll every 2 seconds

    console.log(`[BAM] Monitoring bundle ${bundleId}...`);

    while (Date.now() - startTime < maxWaitTime) {
      try {
        // Check if any of the bundle's transactions have landed
        // Note: Jito SDK doesn't have a direct bundle status endpoint in all versions
        // We'll check if the first transaction signature is confirmed
        const record = await db.select()
          .from(bamBundles)
          .where(eq(bamBundles.id, dbRecordId))
          .limit(1);

        if (record.length === 0) {
          console.error(`[BAM] Bundle record not found: ${dbRecordId}`);
          return;
        }

        const bundle = record[0];
        
        // Try to confirm first transaction
        if (bundle.txSignatures && bundle.txSignatures.length > 0) {
          try {
            const firstSig = bundle.txSignatures[0];
            const confirmation = await connection.getSignatureStatus(firstSig);
            
            if (confirmation.value?.confirmationStatus === "confirmed" || 
                confirmation.value?.confirmationStatus === "finalized") {
              
              const landedAt = new Date();
              const executionTimeMs = landedAt.getTime() - bundle.submittedAt.getTime();
              
              // Get slot info
              const txInfo = await connection.getTransaction(firstSig);
              const slot = txInfo?.slot || null;
              const blockTime = txInfo?.blockTime ? new Date(txInfo.blockTime * 1000) : null;

              // Update database
              await db.update(bamBundles)
                .set({
                  status: "landed",
                  landedAt,
                  executionTimeMs,
                  slot,
                  blockTime,
                })
                .where(eq(bamBundles.id, dbRecordId));

              console.log(`[BAM] ✅ Bundle landed: ${bundleId} (${executionTimeMs}ms)`);
              return;
            } else if (confirmation.value?.err) {
              // Bundle failed
              await db.update(bamBundles)
                .set({
                  status: "failed",
                  errorMessage: JSON.stringify(confirmation.value.err),
                })
                .where(eq(bamBundles.id, dbRecordId));

              console.error(`[BAM] ❌ Bundle failed: ${bundleId}`);
              return;
            }
          } catch (sigError) {
            // Signature not found yet, continue polling
          }
        }

        // Wait before next poll
        await new Promise(resolve => setTimeout(resolve, pollInterval));
      } catch (error) {
        console.error(`[BAM] Error checking bundle status:`, error);
      }
    }

    // Timeout - mark as rejected
    await db.update(bamBundles)
      .set({
        status: "rejected",
        errorMessage: "Bundle confirmation timeout (30s)",
      })
      .where(eq(bamBundles.id, dbRecordId));

    console.warn(`[BAM] ⚠️ Bundle timeout: ${bundleId}`);
  }

  /**
   * Get bundle statistics for a wallet
   */
  async getBundleStats(walletAddress: string) {
    const bundles = await db.select()
      .from(bamBundles)
      .where(eq(bamBundles.ownerWalletAddress, walletAddress));

    const landed = bundles.filter(b => b.status === "landed");
    const avgExecutionTime = landed.length > 0
      ? landed.reduce((sum, b) => sum + (b.executionTimeMs || 0), 0) / landed.length
      : 0;

    const totalTipPaid = bundles.reduce(
      (sum, b) => sum + (parseInt(b.tipAmountLamports) / 1e9),
      0
    );

    return {
      totalBundles: bundles.length,
      landedBundles: landed.length,
      failedBundles: bundles.filter(b => b.status === "failed").length,
      pendingBundles: bundles.filter(b => b.status === "pending").length,
      avgExecutionTimeMs: Math.round(avgExecutionTime),
      totalTipPaidSOL: totalTipPaid,
      successRate: bundles.length > 0 ? (landed.length / bundles.length) * 100 : 0,
      recentBundles: bundles.slice(-10).reverse(),
    };
  }

  /**
   * Increase tip for high-priority bundles
   * Use during high network congestion or for critical trades
   */
  setHighPriorityTip() {
    this.tipLamports = 100_000; // 0.0001 SOL (10x normal)
    console.log(`[BAM] High-priority mode: Tip set to ${this.tipLamports / 1e9} SOL`);
  }

  /**
   * Reset to normal tip
   */
  setNormalTip() {
    this.tipLamports = 10_000; // 0.00001 SOL
    console.log(`[BAM] Normal priority mode: Tip set to ${this.tipLamports / 1e9} SOL`);
  }
}

// Export singleton instance
export const bamService = new JitoBamService("mainnet", 10_000);
