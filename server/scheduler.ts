// Scheduler for automated buyback and burn execution
// Burns are routed through the Solana incinerator: 1nc1nerator11111111111111111111111111111111

import * as cron from "node-cron";
import { storage } from "./storage";
import { SOLANA_INCINERATOR_ADDRESS } from "@shared/config";
import { getSwapOrder } from "./jupiter";
import { getWalletBalance } from "./solana";
import { 
  hasUnclaimedRewards, 
  generateClaimRewardsTransaction,
  claimCreatorRewardsFull 
} from "./pumpfun";

interface SchedulerConfig {
  enabled: boolean;
}

class BuybackScheduler {
  private config: SchedulerConfig;
  private tasks: cron.ScheduledTask[] = [];

  constructor() {
    this.config = {
      enabled: process.env.NODE_ENV === "production",
    };
  }

  async initialize() {
    if (!this.config.enabled) {
      console.log("Scheduler disabled in development mode");
      return;
    }

    // Check for scheduled buybacks every hour
    const task = cron.schedule("0 * * * *", async () => {
      await this.executeScheduledBuybacks();
    });
    
    this.tasks.push(task);
    console.log("Buyback scheduler initialized - checking every hour");
  }

  private async executeScheduledBuybacks() {
    try {
      const activeProjects = await storage.getAllProjects();
      const now = new Date();

      console.log(`Checking ${activeProjects.length} active projects for scheduled buybacks`);

      for (const project of activeProjects) {
        if (!project.isActive) continue;

        // Check if payment is still valid
        const payments = await storage.getPaymentsByProject(project.id);
        const validPayment = payments.find(p => 
          p.verified && new Date(p.expiresAt) > now
        );

        if (!validPayment) {
          console.log(`Project ${project.name} has no valid payment - skipping`);
          continue;
        }

        // Determine if it's time to execute based on schedule
        const shouldExecute = this.shouldExecuteNow(project.schedule, project.customCronExpression, now);

        if (shouldExecute) {
          console.log(`Executing buyback for project: ${project.name}`);
          await this.executeBuyback(project.id);
        }
      }
    } catch (error) {
      console.error("Error in scheduled buyback execution:", error);
    }
  }

  private async executeBuyback(projectId: string) {
    try {
      const project = await storage.getProject(projectId);
      if (!project) {
        throw new Error("Project not found");
      }

      const buybackAmountSOL = parseFloat(project.buybackAmountSol || "0");
      if (buybackAmountSOL <= 0) {
        console.log(`Project ${project.name} has no buyback amount configured`);
        return;
      }

      // STEP 1: Claim PumpFun creator rewards if applicable
      let claimedRewardsSOL = 0;
      let pumpfunClaimPending = false;
      
      if (project.isPumpfunToken && project.pumpfunCreatorWallet) {
        console.log(`Checking PumpFun rewards for ${project.name}...`);
        
        try {
          const hasRewards = await hasUnclaimedRewards(
            project.pumpfunCreatorWallet,
            project.tokenMintAddress
          );

          if (hasRewards) {
            console.log(`PumpFun rewards available! Generating claim transaction for ${project.name}...`);
            
            const claimResult = await claimCreatorRewardsFull(
              project.pumpfunCreatorWallet,
              project.tokenMintAddress
            );

            if (claimResult.success) {
              // In simulation mode, we generated the transaction but can't execute it
              // Mark the claim as pending and note that rewards are available
              pumpfunClaimPending = true;
              
              console.log(`[SIMULATION] PumpFun claim transaction ready to sign`);
              console.log(`Rewards available but amount unknown until execution`);
              
              // Record the pending claim transaction
              await storage.createTransaction({
                projectId: project.id,
                type: "buyback",
                amount: "0", // Unknown until executed
                tokenAmount: "0",
                txSignature: "pumpfun_claim_pending",
                status: "pending",
                errorMessage: "PumpFun rewards claim transaction generated, awaiting SDK for execution",
              });
            } else {
              console.log(`PumpFun claim failed: ${claimResult.error}`);
            }
          } else {
            console.log(`No PumpFun rewards available for ${project.name}`);
          }
        } catch (error) {
          console.warn(`Error claiming PumpFun rewards:`, error);
          // Continue with buyback even if claiming fails
        }
      }

      // STEP 2: Check treasury wallet balance
      const balance = await getWalletBalance(project.treasuryWalletAddress);
      const totalAvailableSOL = balance + claimedRewardsSOL;
      
      console.log(`Treasury balance: ${balance} SOL`);
      if (pumpfunClaimPending) {
        console.log(`PumpFun rewards: Available but pending claim execution`);
      } else if (claimedRewardsSOL > 0) {
        console.log(`Claimed rewards: ${claimedRewardsSOL} SOL`);
      }
      console.log(`Total available: ${totalAvailableSOL} SOL`);
      console.log(`Required for buyback: ${buybackAmountSOL} SOL`);

      // Note: In simulation mode, we proceed even if balance is insufficient
      // to demonstrate the full workflow. In production, actual execution
      // would only happen if balance is sufficient.
      if (totalAvailableSOL < buybackAmountSOL) {
        const errorMsg = pumpfunClaimPending
          ? `Treasury has ${balance} SOL. PumpFun rewards pending - claim first to potentially cover the ${buybackAmountSOL} SOL required.`
          : `Insufficient balance. Required: ${buybackAmountSOL} SOL, Available: ${totalAvailableSOL} SOL`;
        
        console.log(`[SIMULATION] ${errorMsg}`);
        
        // Record failed transaction
        await storage.createTransaction({
          projectId: project.id,
          type: "buyback",
          amount: buybackAmountSOL.toString(),
          tokenAmount: "0",
          txSignature: "",
          status: "failed",
          errorMessage: errorMsg,
        });
        return;
      }

      // STEP 3: Get swap order from Jupiter Ultra API
      const SOL_MINT = "So11111111111111111111111111111111111111112";
      const amountLamports = buybackAmountSOL * 1e9; // Convert SOL to lamports

      console.log(`Getting Jupiter Ultra order for ${buybackAmountSOL} SOL to ${project.tokenMintAddress}`);
      
      const swapOrder = await getSwapOrder(
        SOL_MINT,
        project.tokenMintAddress,
        amountLamports,
        project.treasuryWalletAddress
      );

      const tokenAmount = swapOrder.outputAmount / 1e9; // Assuming 9 decimals

      console.log(`Order received: ${buybackAmountSOL} SOL → ${tokenAmount} tokens`);
      console.log(`Swap type: ${swapOrder.swapType}`);
      console.log(`Slippage: ${swapOrder.slippageBps / 100}%`);
      console.log(`Fee: ${swapOrder.feeBps / 100}%`);

      // STEP 4: Execute swap and burn (SIMULATION MODE)
      console.log(`\n[SIMULATION] Would execute:`);
      console.log(`  1. Sign transaction for swap order (Request ID: ${swapOrder.requestId})`);
      console.log(`  2. Execute via Jupiter Ultra API: ${buybackAmountSOL} SOL → ${tokenAmount} tokens`);
      console.log(`  3. Transfer ${tokenAmount} tokens to incinerator: ${SOLANA_INCINERATOR_ADDRESS}`);
      console.log(`  4. Permanent burn complete\n`);

      // Record transaction
      await storage.createTransaction({
        projectId: project.id,
        type: "buyback",
        amount: buybackAmountSOL.toString(),
        tokenAmount: tokenAmount.toString(),
        txSignature: `ultra_${swapOrder.requestId}`,
        status: "pending",
        errorMessage: `Awaiting Solana SDK for transaction signing. Order ready: ${swapOrder.requestId}`,
      });

      console.log(`Buyback simulation completed for project: ${project.name}`);
      if (pumpfunClaimPending) {
        console.log(`Note: PumpFun rewards claim pending - execute claim first to maximize buyback value`);
      } else if (claimedRewardsSOL > 0) {
        console.log(`Total value: ${buybackAmountSOL} SOL buyback + ${claimedRewardsSOL} SOL claimed rewards`);
      }
    } catch (error) {
      console.error(`Error executing buyback for project ${projectId}:`, error);
      
      // Record failed transaction
      await storage.createTransaction({
        projectId,
        type: "buyback",
        amount: "0",
        tokenAmount: "0",
        txSignature: "",
        status: "failed",
        errorMessage: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  private shouldExecuteNow(schedule: string, customCron: string | null, now: Date): boolean {
    const hour = now.getHours();
    const minute = now.getMinutes();

    switch (schedule) {
      case "hourly":
        return minute === 0; // Execute at the top of every hour
      case "daily":
        return hour === 0 && minute === 0; // Execute at midnight
      case "weekly":
        return now.getDay() === 0 && hour === 0 && minute === 0; // Execute Sunday midnight
      case "custom":
        if (customCron) {
          // For custom cron, we check if the schedule matches
          // This is a simplified check - real implementation would use cron parsing
          return true; // Placeholder
        }
        return false;
      default:
        return false;
    }
  }

  stop() {
    console.log("Stopping scheduler...");
    this.tasks.forEach(task => task.stop());
    this.tasks = [];
    console.log("Scheduler stopped");
  }
}

export const scheduler = new BuybackScheduler();
