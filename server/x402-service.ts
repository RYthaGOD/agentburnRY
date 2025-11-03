import { Connection, Keypair, PublicKey, Transaction, SystemProgram } from "@solana/web3.js";
import { getAssociatedTokenAddress, createTransferInstruction, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { db } from "./db";
import { x402Micropayments, type InsertX402Micropayment } from "@shared/schema";
import { eq } from "drizzle-orm";

// Network configuration - switches between mainnet and devnet based on NODE_ENV
export const NETWORK = (process.env.NODE_ENV === "production" ? "solana-mainnet" : "solana-devnet") as "solana-mainnet" | "solana-devnet";

// RPC Endpoints
const RPC_ENDPOINT_DEVNET = "https://api.devnet.solana.com";
const RPC_ENDPOINT = process.env.SOLANA_RPC_URL || RPC_ENDPOINT_DEVNET;
const connection = new Connection(RPC_ENDPOINT, "confirmed");

// USDC Mint Addresses
const USDC_MINT_DEVNET = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";
const USDC_MINT_MAINNET = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
export const USDC_MINT = NETWORK === "solana-mainnet" ? USDC_MINT_MAINNET : USDC_MINT_DEVNET;

/**
 * x402 Payment Service for AI Agent Economy
 * Enables micropayments for:
 * - Data API access (DexScreener, Jupiter, PumpFun)
 * - AI model API calls (OpenAI, Groq, etc.)
 * - Burn execution services (pay BurnBot to execute burns)
 */
export class X402PaymentService {
  private treasuryAddress: string;
  
  constructor(treasuryAddress: string) {
    this.treasuryAddress = treasuryAddress;
  }

  /**
   * Helper: Convert USD to micro-USDC (6 decimals)
   * @param usd - Amount in USD (e.g., 2.5)
   * @returns Micro-USDC as string (e.g., "2500000")
   */
  static usdToMicroUsdc(usd: number): string {
    return Math.floor(usd * 1_000_000).toString();
  }

  /**
   * Helper: Convert micro-USDC to USD
   * @param microUsdc - Amount in micro-USDC (e.g., "2500000")
   * @returns USD amount (e.g., 2.5)
   */
  static microUsdcToUsd(microUsdc: string): number {
    return parseInt(microUsdc) / 1_000_000;
  }

  /**
   * Create x402 payment requirements for an API endpoint
   * Returns the configuration that clients need to make payment
   */
  async createPaymentRequirements(config: {
    priceUSD: number;
    resourceUrl: string;
    description: string;
  }) {
    const microUsdcAmount = X402PaymentService.usdToMicroUsdc(config.priceUSD);
    
    return {
      x402Version: 1,
      scheme: "exact" as const,
      network: NETWORK,
      maxAmountRequired: microUsdcAmount,
      asset: USDC_MINT,
      payTo: this.treasuryAddress,
      resource: config.resourceUrl,
      description: config.description,
      maxTimeoutSeconds: 60,
    };
  }

  /**
   * Execute x402 micropayment from agent wallet to treasury
   * This simulates the agent paying for API access or burn services
   * 
   * @param payerKeypair - Agent's wallet keypair
   * @param paymentType - Type of payment (data_api, burn_execution, ai_analysis)
   * @param resourceUrl - The API endpoint being paid for
   * @param amountUSD - Payment amount in USD
   * @param description - Payment description
   * @param relatedTradeId - Optional: Link to related trade/position
   */
  async executePayment(
    payerKeypair: Keypair,
    paymentType: "data_api" | "burn_execution" | "ai_analysis",
    resourceUrl: string,
    amountUSD: number,
    description: string,
    relatedTradeId?: string
  ): Promise<{
    success: boolean;
    signature?: string;
    paymentId?: string;
    error?: string;
  }> {
    try {
      const microUsdcAmount = X402PaymentService.usdToMicroUsdc(amountUSD);
      const payerPubkey = payerKeypair.publicKey;
      const treasuryPubkey = new PublicKey(this.treasuryAddress);
      const usdcMintPubkey = new PublicKey(USDC_MINT);

      console.log(`[x402] Creating micropayment: ${amountUSD} USDC for ${paymentType}`);
      console.log(`[x402] Resource: ${resourceUrl}`);

      // Get USDC token accounts
      const payerTokenAccount = await getAssociatedTokenAddress(
        usdcMintPubkey,
        payerPubkey
      );

      const treasuryTokenAccount = await getAssociatedTokenAddress(
        usdcMintPubkey,
        treasuryPubkey
      );

      // Check payer balance
      try {
        const balance = await connection.getTokenAccountBalance(payerTokenAccount);
        const balanceUSDC = parseInt(balance.value.amount) / 1_000_000;
        
        if (parseInt(balance.value.amount) < parseInt(microUsdcAmount)) {
          console.warn(`[x402] Insufficient USDC balance: ${balanceUSDC} USDC (need ${amountUSD} USDC)`);
          return {
            success: false,
            error: `Insufficient USDC balance: ${balanceUSDC} USDC (need ${amountUSD} USDC)`
          };
        }
      } catch (error) {
        console.warn(`[x402] No USDC token account found for payer - skipping payment (devnet)`);
        // On devnet, we'll record the payment attempt but not fail
        if (NETWORK === "solana-devnet") {
          const mockSignature = "x402_devnet_mock_" + Date.now();
          
          // Record payment in database
          const [payment] = await db.insert(x402Micropayments).values({
            ownerWalletAddress: payerPubkey.toString(),
            paymentType,
            resourceUrl,
            amountUSDC: amountUSD.toString(),
            amountMicroUSDC: microUsdcAmount,
            txSignature: mockSignature,
            network: NETWORK,
            status: "confirmed",
            x402Version: 1,
            paymentScheme: "exact",
            relatedTradeId,
            description,
            confirmedAt: new Date(),
          }).returning();

          console.log(`[x402] ✅ Mock payment recorded (devnet): ${mockSignature}`);
          return {
            success: true,
            signature: mockSignature,
            paymentId: payment.id,
          };
        }
        
        return {
          success: false,
          error: "No USDC token account found"
        };
      }

      // Create USDC transfer instruction
      const transferInstruction = createTransferInstruction(
        payerTokenAccount,
        treasuryTokenAccount,
        payerPubkey,
        parseInt(microUsdcAmount),
        [],
        TOKEN_PROGRAM_ID
      );

      // Create transaction
      const transaction = new Transaction().add(transferInstruction);
      
      // Get recent blockhash
      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
      transaction.recentBlockhash = blockhash;
      transaction.feePayer = payerPubkey;

      // Sign transaction
      transaction.sign(payerKeypair);

      // Send transaction
      const signature = await connection.sendRawTransaction(transaction.serialize(), {
        skipPreflight: false,
        maxRetries: 3,
      });

      console.log(`[x402] Payment transaction sent: ${signature}`);

      // Record payment in database (pending)
      const [payment] = await db.insert(x402Micropayments).values({
        ownerWalletAddress: payerPubkey.toString(),
        paymentType,
        resourceUrl,
        amountUSDC: amountUSD.toString(),
        amountMicroUSDC: microUsdcAmount,
        txSignature: signature,
        network: NETWORK,
        status: "pending",
        x402Version: 1,
        paymentScheme: "exact",
        relatedTradeId,
        description,
      }).returning();

      // Confirm transaction (with timeout)
      try {
        const confirmation = await connection.confirmTransaction({
          signature,
          blockhash,
          lastValidBlockHeight
        }, "confirmed");

        if (confirmation.value.err) {
          console.error(`[x402] Payment failed: ${JSON.stringify(confirmation.value.err)}`);
          
          // Update payment status
          await db.update(x402Micropayments)
            .set({ status: "failed" })
            .where(eq(x402Micropayments.id, payment.id));
          
          return {
            success: false,
            error: `Transaction failed: ${JSON.stringify(confirmation.value.err)}`
          };
        }

        // Update payment status to confirmed
        await db.update(x402Micropayments)
          .set({ 
            status: "confirmed",
            confirmedAt: new Date()
          })
          .where(eq(x402Micropayments.id, payment.id));

        console.log(`[x402] ✅ Payment confirmed: ${signature} (${amountUSD} USDC)`);

        return {
          success: true,
          signature,
          paymentId: payment.id,
        };
      } catch (confirmError) {
        console.error(`[x402] Payment confirmation timeout:`, confirmError);
        return {
          success: false,
          signature,
          paymentId: payment.id,
          error: "Payment confirmation timeout"
        };
      }
    } catch (error) {
      console.error(`[x402] Payment error:`, error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error"
      };
    }
  }

  /**
   * Pay for data API access (e.g., DexScreener premium data, Jupiter Pro API)
   * This demonstrates the agent economy where AI agents pay for premium data
   */
  async payForDataAPI(
    agentKeypair: Keypair,
    apiEndpoint: string,
    priceUSD: number = 0.001, // Default: $0.001 per API call
    relatedTradeId?: string
  ) {
    return await this.executePayment(
      agentKeypair,
      "data_api",
      apiEndpoint,
      priceUSD,
      `Premium data API access: ${apiEndpoint}`,
      relatedTradeId
    );
  }

  /**
   * Pay for AI analysis service (e.g., premium AI models, advanced analytics)
   * This demonstrates agents paying agents for services
   */
  async payForAIAnalysis(
    agentKeypair: Keypair,
    analysisType: string,
    priceUSD: number = 0.01, // Default: $0.01 per analysis
    relatedTradeId?: string
  ) {
    return await this.executePayment(
      agentKeypair,
      "ai_analysis",
      `ai-analysis://${analysisType}`,
      priceUSD,
      `AI analysis service: ${analysisType}`,
      relatedTradeId
    );
  }

  /**
   * Pay BurnBot for executing a burn (agent-to-agent payment)
   * This is the key hackathon feature: GigaBrain pays BurnBot to burn tokens
   */
  async payForBurnExecution(
    gigaBrainKeypair: Keypair,
    burnAmountSOL: number,
    tokenMint: string,
    relatedPositionId?: string
  ) {
    // Calculate burn service fee (0.1% of burn amount or $0.005 minimum)
    const burnFeeUSD = Math.max(0.005, burnAmountSOL * 0.001);
    
    return await this.executePayment(
      gigaBrainKeypair,
      "burn_execution",
      `burn-service://${tokenMint}`,
      burnFeeUSD,
      `Burn execution service: ${burnAmountSOL} SOL worth of ${tokenMint}`,
      relatedPositionId
    );
  }

  /**
   * Get payment statistics for an agent wallet
   */
  async getPaymentStats(walletAddress: string) {
    const payments = await db.select()
      .from(x402Micropayments)
      .where(eq(x402Micropayments.ownerWalletAddress, walletAddress));

    const totalPaid = payments
      .filter(p => p.status === "confirmed")
      .reduce((sum, p) => sum + parseFloat(p.amountUSDC || "0"), 0);

    const byType = payments.reduce((acc, p) => {
      const type = p.paymentType;
      if (!acc[type]) {
        acc[type] = { count: 0, total: 0 };
      }
      acc[type].count++;
      if (p.status === "confirmed") {
        acc[type].total += parseFloat(p.amountUSDC || "0");
      }
      return acc;
    }, {} as Record<string, { count: number; total: number }>);

    return {
      totalPayments: payments.length,
      confirmedPayments: payments.filter(p => p.status === "confirmed").length,
      totalPaidUSDC: totalPaid,
      paymentsByType: byType,
      recentPayments: payments.slice(-10).reverse(),
    };
  }
}

// Export singleton instance
export const x402Service = new X402PaymentService(
  process.env.TREASURY_WALLET_PUBLIC_KEY || "jawKuQ3xtcYoAuqE9jyG2H35sv2pWJSzsyjoNpsxG38"
);
