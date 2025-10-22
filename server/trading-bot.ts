// Trading Bot service for volume bot and buy bot functionality
// Handles automated buying/selling cycles and limit order execution

import { getSwapOrder, executeSwapOrder, getTokenPrice } from "./jupiter";
import { getTreasuryKey } from "./key-manager";
import { storage } from "./storage";
import type { Project, InsertTransaction } from "@shared/schema";
import { LAMPORTS_PER_SOL } from "@solana/web3.js";
import { realtimeService } from "./realtime";

const SOL_MINT = "So11111111111111111111111111111111111111112";

interface TradingBotResult {
  success: boolean;
  transactionSignatures: string[];
  volume: number; // SOL volume generated
  error?: string;
}

interface LimitOrder {
  priceSOL: string;
  amountSOL: string;
}

/**
 * Execute volume bot trading cycle (buy then sell)
 * Generates trading volume by buying tokens with SOL and selling back
 */
export async function executeVolumeBot(project: Project): Promise<TradingBotResult> {
  const result: TradingBotResult = {
    success: false,
    transactionSignatures: [],
    volume: 0,
  };

  try {
    console.log(`[Volume Bot] Starting cycle for project: ${project.name}`);
    
    // Validation
    if (!project.volumeBotEnabled) {
      throw new Error("Volume bot is not enabled for this project");
    }

    if (!project.volumeBotBuyAmountSOL || parseFloat(project.volumeBotBuyAmountSOL) <= 0) {
      throw new Error("Invalid volume bot buy amount");
    }

    const buyAmountSOL = parseFloat(project.volumeBotBuyAmountSOL);
    const sellPercentage = project.volumeBotSellPercentage 
      ? parseFloat(project.volumeBotSellPercentage) 
      : 90; // Default 90%

    // Get current token price
    const currentPrice = await getTokenPrice(project.tokenMintAddress);
    console.log(`[Volume Bot] Current token price: ${currentPrice} SOL`);

    // Check price limits if configured
    if (project.volumeBotMinPriceSOL && parseFloat(project.volumeBotMinPriceSOL) > currentPrice) {
      console.log(`[Volume Bot] Price ${currentPrice} below minimum ${project.volumeBotMinPriceSOL}, skipping`);
      return { success: true, transactionSignatures: [], volume: 0 };
    }

    if (project.volumeBotMaxPriceSOL && parseFloat(project.volumeBotMaxPriceSOL) < currentPrice) {
      console.log(`[Volume Bot] Price ${currentPrice} above maximum ${project.volumeBotMaxPriceSOL}, skipping`);
      return { success: true, transactionSignatures: [], volume: 0 };
    }

    // Get treasury key
    const treasuryKey = await getTreasuryKey(project.id);
    if (!treasuryKey) {
      throw new Error("Treasury key not found");
    }

    // STEP 1: Buy tokens with SOL
    console.log(`[Volume Bot] Step 1: Buying ${buyAmountSOL} SOL worth of tokens`);
    const buyAmountLamports = Math.floor(buyAmountSOL * LAMPORTS_PER_SOL);
    
    const buyOrder = await getSwapOrder(
      SOL_MINT,
      project.tokenMintAddress,
      buyAmountLamports,
      project.treasuryWalletAddress,
      50 // 0.5% slippage
    );

    const buyResult = await executeSwapOrder(buyOrder, treasuryKey);
    result.transactionSignatures.push(buyResult.transactionId);
    result.volume += buyAmountSOL;

    // Record buy transaction (use correct token decimals)
    const tokenDecimals = project.tokenDecimals || 9;
    const decimalDivisor = Math.pow(10, tokenDecimals);
    
    await storage.createTransaction({
      projectId: project.id,
      type: "buyback",
      amount: buyAmountSOL.toString(),
      tokenAmount: (parseInt(buyResult.outputAmountResult) / decimalDivisor).toString(),
      txSignature: buyResult.transactionId,
      status: "completed",
    });

    console.log(`[Volume Bot] Buy completed: ${buyResult.transactionId}`);
    console.log(`[Volume Bot] Received: ${buyResult.outputAmountResult} tokens`);

    // Note: Price accuracy calculation omitted for volume bot (buy/sell cycle, not targeting specific price)

    // STEP 2: Sell portion of tokens back to SOL
    const tokensReceived = parseInt(buyResult.outputAmountResult);
    const tokensToSell = Math.floor(tokensReceived * (sellPercentage / 100));
    
    console.log(`[Volume Bot] Step 2: Selling ${sellPercentage}% of tokens (${tokensToSell} tokens)`);

    const sellOrder = await getSwapOrder(
      project.tokenMintAddress,
      SOL_MINT,
      tokensToSell,
      project.treasuryWalletAddress,
      50 // 0.5% slippage
    );

    const sellResult = await executeSwapOrder(sellOrder, treasuryKey);
    result.transactionSignatures.push(sellResult.transactionId);
    
    const solReceived = parseInt(sellResult.outputAmountResult) / LAMPORTS_PER_SOL;
    result.volume += solReceived;

    // Record sell transaction (use correct token decimals)
    await storage.createTransaction({
      projectId: project.id,
      type: "buyback", // Categorized as buyback for volume trading
      amount: solReceived.toString(),
      tokenAmount: (tokensToSell / decimalDivisor).toString(),
      txSignature: sellResult.transactionId,
      status: "completed",
    });

    console.log(`[Volume Bot] Sell completed: ${sellResult.transactionId}`);
    console.log(`[Volume Bot] Received: ${solReceived} SOL`);
    console.log(`[Volume Bot] Total volume generated: ${result.volume} SOL`);

    result.success = true;

    // Emit WebSocket event for volume bot completion
    realtimeService.emitBotEvent({
      projectId: project.id,
      botType: "volume",
      status: "success",
      message: `Generated ${result.volume.toFixed(4)} SOL volume`,
      volume: result.volume,
    });

    // Update project with last bot run info
    await storage.updateProject(project.id, {
      lastBotRunAt: new Date(),
      lastBotStatus: "success",
    });

    return result;

  } catch (error: any) {
    console.error("[Volume Bot] Error:", error);
    result.error = error.message;

    // Emit failure event
    realtimeService.emitBotEvent({
      projectId: project.id,
      botType: "volume",
      status: "failed",
      message: error.message,
    });

    // Update project with last bot run info
    await storage.updateProject(project.id, {
      lastBotRunAt: new Date(),
      lastBotStatus: "failed",
    }).catch(err => console.error("Failed to update project status:", err));

    return result;
  }
}

/**
 * Execute buy bot limit orders
 * Checks current price and executes buy orders when price reaches target levels
 */
export async function executeBuyBot(project: Project): Promise<TradingBotResult> {
  const result: TradingBotResult = {
    success: false,
    transactionSignatures: [],
    volume: 0,
  };

  try {
    console.log(`[Buy Bot] Checking limit orders for project: ${project.name}`);
    
    // Validation
    if (!project.buyBotEnabled) {
      throw new Error("Buy bot is not enabled for this project");
    }

    if (!project.buyBotLimitOrders) {
      console.log(`[Buy Bot] No limit orders configured`);
      return { success: true, transactionSignatures: [], volume: 0 };
    }

    // Parse limit orders
    let limitOrders: LimitOrder[];
    try {
      limitOrders = JSON.parse(project.buyBotLimitOrders);
    } catch (error) {
      throw new Error("Invalid limit orders JSON format");
    }

    if (!Array.isArray(limitOrders) || limitOrders.length === 0) {
      console.log(`[Buy Bot] No limit orders to execute`);
      return { success: true, transactionSignatures: [], volume: 0 };
    }

    // Get current token price
    const currentPrice = await getTokenPrice(project.tokenMintAddress);
    console.log(`[Buy Bot] Current token price: ${currentPrice} SOL`);

    // Get treasury key
    const treasuryKey = await getTreasuryKey(project.id);
    if (!treasuryKey) {
      throw new Error("Treasury key not found");
    }

    // Execute orders where current price <= target price
    for (const order of limitOrders) {
      const targetPrice = parseFloat(order.priceSOL);
      const buyAmountSOL = parseFloat(order.amountSOL);

      if (currentPrice <= targetPrice) {
        console.log(`[Buy Bot] Executing limit order: Buy ${buyAmountSOL} SOL at ${targetPrice} SOL (current: ${currentPrice})`);

        try {
          const buyAmountLamports = Math.floor(buyAmountSOL * LAMPORTS_PER_SOL);
          
          const buyOrder = await getSwapOrder(
            SOL_MINT,
            project.tokenMintAddress,
            buyAmountLamports,
            project.treasuryWalletAddress,
            project.buyBotMaxSlippage ? parseFloat(project.buyBotMaxSlippage) * 100 : 50
          );

          const buyResult = await executeSwapOrder(buyOrder, treasuryKey);
          result.transactionSignatures.push(buyResult.transactionId);
          result.volume += buyAmountSOL;

          // Calculate decimal divisor for this token
          const tokenDecimals = project.tokenDecimals || 9; // Default to 9 if not set
          const decimalDivisor = Math.pow(10, tokenDecimals);

          // Record buy transaction
          await storage.createTransaction({
            projectId: project.id,
            type: "buyback",
            amount: buyAmountSOL.toString(),
            tokenAmount: (parseInt(buyResult.outputAmountResult) / decimalDivisor).toString(),
            txSignature: buyResult.transactionId,
            status: "completed",
          });

          console.log(`[Buy Bot] Limit order executed: ${buyResult.transactionId}`);
          console.log(`[Buy Bot] Received: ${buyResult.outputAmountResult} tokens`);

          // Calculate actual execution price
          // Note: Jupiter returns token amount in base units (raw lamports-equivalent)
          // We need to normalize using the token's actual decimal places from mint metadata
          const tokensReceived = parseInt(buyResult.outputAmountResult) / decimalDivisor;
          const solSpent = buyAmountSOL;
          const actualPricePerToken = solSpent / tokensReceived; // SOL per token
          const expectedPricePerToken = targetPrice;

          // Calculate price deviation in basis points (1 bp = 0.01%)
          const deviationBps = Math.round(((actualPricePerToken - expectedPricePerToken) / expectedPricePerToken) * 10000);

          // Store accuracy data in transaction
          await storage.updateTransaction(buyResult.transactionId, {
            expectedPriceSOL: expectedPricePerToken.toString(),
            actualPriceSOL: actualPricePerToken.toString(),
            priceDeviationBps: deviationBps,
          });

          // Emit accuracy check event
          realtimeService.emitAccuracyCheck({
            projectId: project.id,
            transactionId: buyResult.transactionId,
            expectedPriceSOL: expectedPricePerToken,
            actualPriceSOL: actualPricePerToken,
            deviationBps,
            withinThreshold: Math.abs(deviationBps) <= 500, // 5% threshold
          });
        } catch (error: any) {
          console.error(`[Buy Bot] Error executing limit order:`, error);
          // Continue with other orders even if one fails
        }
      } else {
        console.log(`[Buy Bot] Skipping order at ${targetPrice} SOL (current: ${currentPrice} SOL)`);
      }
    }

    result.success = true;

    // Emit WebSocket event for buy bot completion
    if (result.transactionSignatures.length > 0) {
      realtimeService.emitBotEvent({
        projectId: project.id,
        botType: "buy",
        status: "success",
        message: `Executed ${result.transactionSignatures.length} limit orders`,
        executedOrders: result.transactionSignatures.length,
      });

      // Update project with last bot run info
      await storage.updateProject(project.id, {
        lastBotRunAt: new Date(),
        lastBotStatus: "success",
      });
    }

    return result;

  } catch (error: any) {
    console.error("[Buy Bot] Error:", error);
    result.error = error.message;

    // Emit failure event
    realtimeService.emitBotEvent({
      projectId: project.id,
      botType: "buy",
      status: "failed",
      message: error.message,
    });

    // Update project with last bot run info
    await storage.updateProject(project.id, {
      lastBotRunAt: new Date(),
      lastBotStatus: "failed",
    }).catch(err => console.error("Failed to update project status:", err));

    return result;
  }
}

/**
 * Check if it's time to run volume bot based on interval
 */
export function shouldRunVolumeBot(project: Project, lastRunTime: Date | null): boolean {
  if (!project.volumeBotEnabled || !project.volumeBotIntervalMinutes) {
    return false;
  }

  if (!lastRunTime) {
    return true; // First run
  }

  const now = new Date();
  const intervalMs = project.volumeBotIntervalMinutes * 60 * 1000;
  const timeSinceLastRun = now.getTime() - lastRunTime.getTime();

  return timeSinceLastRun >= intervalMs;
}
