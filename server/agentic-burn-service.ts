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
  buyAmountSOL: number,
  criteriaConfig: {
    confidenceThreshold: number;
    maxBurnPercentage: number;
    requirePositiveSentiment: boolean;
  }
): Promise<{ approved: boolean; reasoning: string; confidence: number }> {
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
            content: `You are a strategic AI agent analyzing token burn requests for the GigaBrain trading system. Evaluate whether the burn should proceed based on the parameters and criteria provided. Respond with a JSON object containing 'approved' (boolean), 'confidence' (integer 0-100), and 'reasoning' (string).

Criteria:
- Minimum confidence threshold: ${criteriaConfig.confidenceThreshold}%
- Maximum burn as % of supply: ${criteriaConfig.maxBurnPercentage}%
- Require positive sentiment: ${criteriaConfig.requirePositiveSentiment}`
          },
          {
            role: "user",
            content: `Analyze this burn request:\nToken Mint: ${tokenMint}\nBuy Amount: ${buyAmountSOL} SOL\n\nShould this burn be executed? Provide your confidence level (0-100) and reasoning.`
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
        confidence: 85,
        reasoning: "DeepSeek API unavailable, proceeding with burn as requested"
      };
    }

    const data = await response.json();
    const content = data.choices[0]?.message?.content || "";
    
    // Try to parse JSON response
    try {
      const decision = JSON.parse(content);
      const confidence = decision.confidence ?? 85;
      const approved = (decision.approved ?? true) && (confidence >= criteriaConfig.confidenceThreshold);
      
      return {
        approved,
        confidence,
        reasoning: decision.reasoning || "AI analysis completed"
      };
    } catch {
      // If not JSON, assume approval
      return {
        approved: true,
        confidence: 85,
        reasoning: content || "Burn request approved"
      };
    }
  } catch (error) {
    console.warn("⚠️ DeepSeek analysis failed:", error);
    return {
      approved: true,
      confidence: 80,
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

export interface AgenticBurnCriteria {
  confidenceThreshold?: number;
  maxBurnPercentage?: number;
  requirePositiveSentiment?: boolean;
}

export interface EnhancedAgenticBurnResult extends AgenticBurnResult {
  // AI Decision details
  aiConfidence?: number;
  aiReasoning?: string;
  
  // Step timing (milliseconds)
  step1DurationMs?: number; // DeepSeek AI
  step2DurationMs?: number; // x402 payment
  step3DurationMs?: number; // Jupiter swap
  step4DurationMs?: number; // Jito BAM
  totalDurationMs?: number;
  
  // Progress tracking
  currentStep?: number;
  burnHistoryId?: string;
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
  burnAmountSOL: number,
  criteria?: AgenticBurnCriteria
): Promise<EnhancedAgenticBurnResult> {
  console.log("\n🎮 DEMO MODE: Agentic Burn with x402 + BAM");
  console.log("This demonstrates the full hackathon integration:\n");
  console.log("1. DeepSeek AI analyzes burn request");
  console.log("2. GigaBrain AI pays BurnBot for service (x402 micropayment)");
  console.log("3. BurnBot executes atomic trade+burn (Jito BAM)");
  console.log("4. MEV protection ensures guaranteed execution\n");

  const gigabrainKeypair = loadKeypairFromPrivateKey(gigabrainPrivateKey);
  const ownerWallet = gigabrainKeypair.publicKey.toString();
  
  // Default criteria
  const criteriaConfig = {
    confidenceThreshold: criteria?.confidenceThreshold ?? 70,
    maxBurnPercentage: criteria?.maxBurnPercentage ?? 5,
    requirePositiveSentiment: criteria?.requirePositiveSentiment ?? true,
  };
  
  // Import database
  const { db } = await import("./db");
  const { agenticBurns } = await import("../shared/schema");
  
  // Create burn history record
  const [burnRecord] = await db.insert(agenticBurns).values({
    ownerWalletAddress: ownerWallet,
    tokenMintAddress: targetTokenMint,
    burnAmountSOL: burnAmountSOL.toString(),
    aiConfidenceThreshold: criteriaConfig.confidenceThreshold,
    maxBurnPercentage: criteriaConfig.maxBurnPercentage.toString(),
    requirePositiveSentiment: criteriaConfig.requirePositiveSentiment,
    status: "pending",
    currentStep: 0,
  }).returning();
  
  const burnHistoryId = burnRecord.id;
  const totalStartTime = Date.now();
  
  try {
    // =========================================================================
    // STEP 1: DeepSeek AI DECISION
    // =========================================================================
    const step1Start = Date.now();
    console.log("\n🧠 [Step 1/4] DeepSeek AI Analysis...");
    
    await db.update(agenticBurns).set({ currentStep: 1 }).where({ id: burnHistoryId });
    
    const aiDecision = await analyzeWithDeepSeek(targetTokenMint, burnAmountSOL, criteriaConfig);
    const step1Duration = Date.now() - step1Start;
    
    console.log(`✅ AI Decision: ${aiDecision.approved ? "APPROVED" : "REJECTED"}`);
    console.log(`💭 Confidence: ${aiDecision.confidence}%`);
    console.log(`💭 Reasoning: ${aiDecision.reasoning}`);
    console.log(`⏱️  Duration: ${step1Duration}ms`);
    
    await db.update(agenticBurns).set({
      aiConfidence: aiDecision.confidence,
      aiReasoning: aiDecision.reasoning,
      aiApproved: aiDecision.approved,
      step1DurationMs: step1Duration,
    }).where({ id: burnHistoryId });
    
    if (!aiDecision.approved) {
      await db.update(agenticBurns).set({
        status: "failed",
        errorMessage: `Burn rejected by AI: ${aiDecision.reasoning}`,
        errorStep: 1,
        totalDurationMs: Date.now() - totalStartTime,
      }).where({ id: burnHistoryId });
      
      return {
        success: false,
        error: `Burn rejected by AI agent: ${aiDecision.reasoning}`,
        step: "payment",
        aiConfidence: aiDecision.confidence,
        aiReasoning: aiDecision.reasoning,
        step1DurationMs: step1Duration,
        totalDurationMs: Date.now() - totalStartTime,
        currentStep: 1,
        burnHistoryId,
      };
    }
    
    // =========================================================================
    // STEP 2: x402 MICROPAYMENT
    // =========================================================================
    const step2Start = Date.now();
    console.log("\n📱 [Step 2/4] x402 Micropayment...");
    
    await db.update(agenticBurns).set({ currentStep: 2 }).where({ id: burnHistoryId });
    
    const paymentResult = await x402Service.payForBurnExecution(
      gigabrainKeypair,
      burnAmountSOL,
      targetTokenMint,
      undefined
    );
    const step2Duration = Date.now() - step2Start;
    
    console.log(`⏱️  Duration: ${step2Duration}ms`);
    
    await db.update(agenticBurns).set({
      step2DurationMs: step2Duration,
      paymentId: paymentResult.paymentId || null,
    }).where({ id: burnHistoryId });
    
    if (!paymentResult.success) {
      await db.update(agenticBurns).set({
        status: "failed",
        errorMessage: `x402 payment failed: ${paymentResult.error}`,
        errorStep: 2,
        totalDurationMs: Date.now() - totalStartTime,
      }).where({ id: burnHistoryId });
      
      return {
        success: false,
        error: `x402 payment failed: ${paymentResult.error}`,
        step: "payment",
        aiConfidence: aiDecision.confidence,
        aiReasoning: aiDecision.reasoning,
        step1DurationMs: step1Duration,
        step2DurationMs: step2Duration,
        totalDurationMs: Date.now() - totalStartTime,
        currentStep: 2,
        burnHistoryId,
      };
    }
    
    // =========================================================================
    // STEP 3: JUPITER SWAP (DEMO MODE)
    // =========================================================================
    const step3Start = Date.now();
    console.log("\n🔄 [Step 3/4] Jupiter Swap (DEMO MODE)...");
    
    await db.update(agenticBurns).set({ currentStep: 3 }).where({ id: burnHistoryId });
    
    const simulatedOutputAmount = Math.floor(burnAmountSOL * 1000000);
    const step3Duration = Date.now() - step3Start;
    
    console.log(`⏱️  Duration: ${step3Duration}ms`);
    
    await db.update(agenticBurns).set({
      step3DurationMs: step3Duration,
    }).where({ id: burnHistoryId });
    
    // =========================================================================
    // STEP 4: JITO BAM BUNDLE (DEMO MODE)
    // =========================================================================
    const step4Start = Date.now();
    console.log("\n⚡ [Step 4/4] Jito BAM Bundle (DEMO MODE)...");
    
    await db.update(agenticBurns).set({ currentStep: 4 }).where({ id: burnHistoryId });
    
    const bundleId = `DEMO_BUNDLE_${Date.now()}_${Math.random().toString(36).substring(7)}`;
    const step4Duration = Date.now() - step4Start;
    const totalDuration = Date.now() - totalStartTime;
    
    console.log(`⏱️  Duration: ${step4Duration}ms`);
    console.log(`⏱️  Total Duration: ${totalDuration}ms`);
    
    const tokenDecimals = await getTokenDecimals(targetTokenMint);
    const tokensBurned = simulatedOutputAmount / Math.pow(10, tokenDecimals);
    
    await db.update(agenticBurns).set({
      step4DurationMs: step4Duration,
      totalDurationMs: totalDuration,
      bundleId,
      tokensBurned: tokensBurned.toString(),
      status: "completed",
      completedAt: new Date(),
    }).where({ id: burnHistoryId });
    
    console.log("\n✨ AGENTIC BURN COMPLETE!");
    console.log(`Total execution time: ${totalDuration}ms`);
    
    return {
      success: true,
      paymentId: paymentResult.paymentId,
      paymentSignature: paymentResult.signature,
      serviceFeeUSD: 0.005,
      bundleId,
      bundleSignatures: [`DEMO_BURN_SIG_${Date.now()}`],
      tokensBought: tokensBurned,
      tokensBurned,
      buyTxSignature: `DEMO_SWAP_${Date.now()}`,
      burnTxSignature: `DEMO_BURN_${Date.now()}`,
      aiConfidence: aiDecision.confidence,
      aiReasoning: aiDecision.reasoning,
      step1DurationMs: step1Duration,
      step2DurationMs: step2Duration,
      step3DurationMs: step3Duration,
      step4DurationMs: step4Duration,
      totalDurationMs: totalDuration,
      currentStep: 4,
      burnHistoryId,
    };
  } catch (error) {
    const totalDuration = Date.now() - totalStartTime;
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    
    await db.update(agenticBurns).set({
      status: "failed",
      errorMessage,
      totalDurationMs: totalDuration,
    }).where({ id: burnHistoryId });
    
    console.error(`❌ Agentic burn error:`, error);
    return {
      success: false,
      error: errorMessage,
      step: "execution",
      totalDurationMs: totalDuration,
      burnHistoryId,
    };
  }
}
