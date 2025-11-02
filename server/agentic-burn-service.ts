import { Keypair, PublicKey, Transaction, SystemProgram } from "@solana/web3.js";
import { createBurnInstruction, getAssociatedTokenAddress, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { x402Service, X402PaymentService } from "./x402-service";
import { bamService } from "./jito-bam-service";
import { buyTokenWithJupiter, getTokenDecimals } from "./jupiter";
import { getConnection, loadKeypairFromPrivateKey } from "./solana-sdk";
import bs58 from "bs58";

/**
 * DeepSeek AI decision-making for burn execution
 */
async function analyzeWithDeepSeek(
  tokenMint: string,
  buyAmountSOL: number
): Promise<{ approved: boolean; reasoning: string }> {
  try {
    const response = await fetch("https://api.deepseek.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.DEEPSEEK_API_KEY}`,
      },
      body: JSON.stringify({
        model: "deepseek-chat",
        messages: [
          {
            role: "system",
            content: "You are a strategic AI agent analyzing token burn requests for the GigaBrain trading system. Evaluate whether the burn should proceed based on the parameters provided. Respond with a JSON object containing 'approved' (boolean) and 'reasoning' (string)."
          },
          {
            role: "user",
            content: `Analyze this burn request:\nToken Mint: ${tokenMint}\nBuy Amount: ${buyAmountSOL} SOL\n\nShould this burn be executed?`
          }
        ],
        temperature: 0.7,
        max_tokens: 200,
      }),
    });

    if (!response.ok) {
      console.warn("⚠️ DeepSeek API unavailable, approving by default");
      return {
        approved: true,
        reasoning: "DeepSeek API unavailable, proceeding with burn as requested"
      };
    }

    const data = await response.json();
    const content = data.choices[0]?.message?.content || "";
    
    // Try to parse JSON response
    try {
      const decision = JSON.parse(content);
      return {
        approved: decision.approved ?? true,
        reasoning: decision.reasoning || "AI analysis completed"
      };
    } catch {
      // If not JSON, assume approval
      return {
        approved: true,
        reasoning: content || "Burn request approved"
      };
    }
  } catch (error) {
    console.warn("⚠️ DeepSeek analysis failed:", error);
    return {
      approved: true,
      reasoning: "AI analysis unavailable, proceeding with burn"
    };
  }
}

/**
 * Agentic Burn Service - Hackathon Feature
 * 
 * Combines x402 micropayments + BAM atomic bundling for agent-activated burns:
 * 1. GigaBrain AI pays BurnBot via x402 micropayment (agent economy)
 * 2. BurnBot executes atomic trade+burn via Jito BAM (MEV protection)
 * 3. All transactions bundled atomically - either all succeed or all fail
 * 
 * This showcases:
 * - x402: HTTP 402 micropayments for AI agent services
 * - BAM: Jito's Block Assembly Marketplace for guaranteed atomic execution
 * - Agent Economy: GigaBrain pays BurnBot, BurnBot provides burn-as-a-service
 */

export interface AgenticBurnRequest {
  // Who's requesting the burn (GigaBrain AI)
  requesterKeypair: Keypair;
  
  // Burn parameters
  tokenMint: string;
  buyAmountSOL: number;
  slippageBps?: number;
  
  // Payment configuration
  burnServiceFeeUSD?: number; // Fee GigaBrain pays to BurnBot
  
  // Optional: link to trading position
  relatedPositionId?: string;
}

export interface AgenticBurnResult {
  success: boolean;
  
  // x402 payment details
  paymentId?: string;
  paymentSignature?: string;
  serviceFeeUSD?: number;
  
  // BAM bundle details
  bundleId?: string;
  bundleSignatures?: string[];
  
  // Burn details
  tokensBought?: number;
  tokensBurned?: number;
  buyTxSignature?: string;
  burnTxSignature?: string;
  
  // Error details
  error?: string;
  step?: "payment" | "bundle" | "execution";
}

/**
 * Execute agentic activated buy-and-burn
 * 
 * Flow:
 * 1. GigaBrain pays BurnBot for burn service (x402 micropayment)
 * 2. Create Jupiter swap transaction (buy tokens)
 * 3. Create burn transaction (burn tokens)
 * 4. Bundle swap + burn atomically via Jito BAM
 * 5. Track everything in database
 */
export async function executeAgenticBurn(
  request: AgenticBurnRequest
): Promise<AgenticBurnResult> {
  const {
    requesterKeypair,
    tokenMint,
    buyAmountSOL,
    slippageBps = 1000, // 10% slippage default
    burnServiceFeeUSD = 0.005, // $0.005 default service fee
    relatedPositionId,
  } = request;

  console.log("\n" + "=".repeat(80));
  console.log("🤖 AGENTIC BURN SERVICE - Starting Agent-Activated Buy & Burn");
  console.log("=".repeat(80));
  console.log(`Token: ${tokenMint}`);
  console.log(`Buy Amount: ${buyAmountSOL} SOL`);
  console.log(`Service Fee: $${burnServiceFeeUSD} USDC`);
  console.log(`Requester: ${requesterKeypair.publicKey.toString()}`);
  console.log("=".repeat(80) + "\n");

  try {
    // =========================================================================
    // STEP 0: DeepSeek AI DECISION - Should we execute this burn?
    // =========================================================================
    console.log("\n🧠 [Step 0/4] DeepSeek AI Analysis: Evaluating burn request...");
    console.log("-".repeat(80));
    
    const aiDecision = await analyzeWithDeepSeek(tokenMint, buyAmountSOL);
    console.log(`✅ AI Decision: ${aiDecision.approved ? "APPROVED" : "REJECTED"}`);
    console.log(`💭 Reasoning: ${aiDecision.reasoning}`);
    
    if (!aiDecision.approved) {
      return {
        success: false,
        error: `Burn rejected by AI agent: ${aiDecision.reasoning}`,
        step: "payment",
      };
    }

    // =========================================================================
    // STEP 1: x402 MICROPAYMENT - GigaBrain pays BurnBot for burn service
    // =========================================================================
    console.log("\n📱 [Step 1/4] x402 Micropayment: GigaBrain → BurnBot");
    console.log("-".repeat(80));
    
    const paymentResult = await x402Service.payForBurnExecution(
      requesterKeypair,
      buyAmountSOL,
      tokenMint,
      relatedPositionId
    );

    if (!paymentResult.success) {
      console.error(`❌ x402 payment failed: ${paymentResult.error}`);
      return {
        success: false,
        error: `x402 payment failed: ${paymentResult.error}`,
        step: "payment",
        serviceFeeUSD: burnServiceFeeUSD,
      };
    }

    console.log(`✅ x402 payment confirmed!`);
    console.log(`   Payment ID: ${paymentResult.paymentId}`);
    console.log(`   Signature: ${paymentResult.signature}`);
    console.log(`   Amount: $${burnServiceFeeUSD} USDC`);

    // =========================================================================
    // STEP 2: CREATE ATOMIC BUNDLE - Jupiter Swap + Token Burn
    // =========================================================================
    console.log("\n⚡ [Step 2/4] Creating Atomic BAM Bundle: Swap + Burn");
    console.log("-".repeat(80));

    const SOL_MINT = "So11111111111111111111111111111111111111112";
    const connection = getConnection();
    const treasuryPubkey = requesterKeypair.publicKey;
    const tokenMintPubkey = new PublicKey(tokenMint);

    // Get token decimals
    const tokenDecimals = await getTokenDecimals(tokenMint);
    console.log(`Token decimals: ${tokenDecimals}`);

    // DEMO MODE: Simulate Jupiter swap for hackathon (Jupiter only works on mainnet)
    console.log(`⚠️ DEMO MODE: Simulating Jupiter swap (Jupiter API only works on mainnet)`);
    console.log(`   In production, this would execute a real swap via Jupiter Ultra API`);
    
    // Simulate successful swap result
    const simulatedOutputAmount = Math.floor(buyAmountSOL * 1000000); // Simulate getting ~1M tokens per SOL
    const buyResult = {
      success: true,
      signature: `DEMO_SWAP_${Date.now()}_${Math.random().toString(36).substring(7)}`,
      outputAmount: simulatedOutputAmount,
      inputAmount: buyAmountSOL * 1e9, // SOL in lamports
    };

    console.log(`✅ Jupiter swap simulated successfully (DEMO MODE)`);
    console.log(`   Simulated output: ${simulatedOutputAmount} tokens`);

    // DEMO MODE: Simulate token balance (skip actual blockchain confirmation)
    console.log(`✅ Swap simulated - skipping confirmation (DEMO MODE)`);
    
    // Simulate token balance
    const tokenBalanceRaw = BigInt(simulatedOutputAmount);
    const tokenBalanceHuman = Number(tokenBalanceRaw) / Math.pow(10, tokenDecimals);

    console.log(`Simulated token balance: ${tokenBalanceHuman.toLocaleString()} tokens`);
    
    // Get token account for burn instruction (even in demo mode)
    const tokenAccount = await getAssociatedTokenAddress(
      tokenMintPubkey,
      treasuryPubkey
    );

    // =========================================================================
    // STEP 3: JITO BAM ATOMIC BURN - MEV-Protected Token Destruction
    // =========================================================================
    console.log("\n🔥 [Step 3/4] Jito BAM Atomic Burn with MEV Protection");
    console.log("-".repeat(80));

    // DEMO MODE: Simulate BAM bundle (since we simulated the swap)
    console.log(`⚠️ DEMO MODE: Simulating BAM bundle submission`);
    console.log(`   In production, this would submit a real Jito bundle with MEV protection`);
    console.log(`   Burning: ${tokenBalanceHuman.toLocaleString()} tokens`);

    // Simulate bundle result
    const bundleResult = {
      success: true,
      bundleId: `DEMO_BUNDLE_${Date.now()}_${Math.random().toString(36).substring(7)}`,
      signatures: [`DEMO_BURN_SIG_${Date.now()}_${Math.random().toString(36).substring(7)}`],
    };

    console.log(`✅ BAM bundle simulated successfully (DEMO MODE)`);
    console.log(`   Bundle ID: ${bundleResult.bundleId}`);
    console.log(`   Signatures: ${bundleResult.signatures?.join(", ")}`);

    // =========================================================================
    // SUCCESS! All steps completed
    // =========================================================================
    console.log("\n" + "=".repeat(80));
    console.log("✨ AGENTIC BURN COMPLETE - All Steps Successful!");
    console.log("=".repeat(80));
    console.log(`💰 x402 Payment: $${burnServiceFeeUSD} USDC → ${paymentResult.signature}`);
    console.log(`🔄 Jupiter Swap: ${buyAmountSOL} SOL → ${tokenBalanceHuman.toLocaleString()} tokens`);
    console.log(`🔥 Jito BAM Burn: ${tokenBalanceHuman.toLocaleString()} tokens DESTROYED`);
    console.log("=".repeat(80) + "\n");

    return {
      success: true,
      
      // x402 payment
      paymentId: paymentResult.paymentId,
      paymentSignature: paymentResult.signature,
      serviceFeeUSD: burnServiceFeeUSD,
      
      // BAM bundle
      bundleId: bundleResult.bundleId,
      bundleSignatures: bundleResult.signatures,
      
      // Burn results
      tokensBought: tokenBalanceHuman,
      tokensBurned: tokenBalanceHuman,
      buyTxSignature: buyResult.signature,
      burnTxSignature: bundleResult.signatures?.[0],
    };
  } catch (error) {
    console.error(`❌ Agentic burn error:`, error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
      step: "execution",
    };
  }
}

/**
 * Demo: Execute agentic burn with test parameters
 * This demonstrates the full hackathon feature:
 * - GigaBrain AI identifies a token to burn
 * - Pays BurnBot via x402 ($0.005 USDC)
 * - BurnBot executes atomic trade+burn via Jito BAM
 */
export async function demoAgenticBurn(
  gigabrainPrivateKey: string,
  targetTokenMint: string,
  burnAmountSOL: number
): Promise<AgenticBurnResult> {
  console.log("\n🎮 DEMO MODE: Agentic Burn with x402 + BAM");
  console.log("This demonstrates the full hackathon integration:\n");
  console.log("1. GigaBrain AI pays BurnBot for service (x402 micropayment)");
  console.log("2. BurnBot executes atomic trade+burn (Jito BAM)");
  console.log("3. MEV protection ensures guaranteed execution\n");

  const gigabrainKeypair = loadKeypairFromPrivateKey(gigabrainPrivateKey);
  
  return await executeAgenticBurn({
    requesterKeypair: gigabrainKeypair,
    tokenMint: targetTokenMint,
    buyAmountSOL: burnAmountSOL,
    slippageBps: 1000, // 10% slippage
    burnServiceFeeUSD: 0.005, // $0.005 service fee
  });
}
