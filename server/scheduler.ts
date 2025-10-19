// Scheduler for automated buyback and burn execution
// Burns are routed through the Solana incinerator: 1nc1nerator11111111111111111111111111111111

import * as cron from "node-cron";
import { storage } from "./storage";
import { SOLANA_INCINERATOR_ADDRESS } from "@shared/config";
import { getSwapQuote, getTokenPrice } from "./jupiter";
import { getWalletBalance } from "./solana";

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

      // Check treasury wallet balance
      const balance = await getWalletBalance(project.treasuryWalletAddress);
      if (balance < buybackAmountSOL) {
        console.log(`Insufficient balance in treasury wallet for ${project.name}`);
        await storage.createTransaction({
          projectId: project.id,
          type: "buyback",
          amount: buybackAmountSOL.toString(),
          tokenAmount: "0",
          txSignature: "",
          status: "failed",
          errorMessage: `Insufficient balance. Required: ${buybackAmountSOL} SOL, Available: ${balance} SOL`,
        });
        return;
      }

      // Get swap quote from Jupiter
      const SOL_MINT = "So11111111111111111111111111111111111111112";
      const amountLamports = buybackAmountSOL * 1e9; // Convert SOL to lamports

      console.log(`Getting Jupiter quote for ${buybackAmountSOL} SOL to ${project.tokenMintAddress}`);
      
      const quote = await getSwapQuote(
        SOL_MINT,
        project.tokenMintAddress,
        amountLamports
      );

      const tokenAmount = quote.outputAmount / 1e9; // Assuming 9 decimals

      console.log(`Quote received: ${buybackAmountSOL} SOL → ${tokenAmount} tokens`);
      console.log(`Price impact: ${quote.priceImpactPct}%`);

      // TODO: Execute swap when Solana SDK is available
      // For now, just log the intended transaction
      console.log(`[SIMULATION] Would execute:`);
      console.log(`  1. Swap ${buybackAmountSOL} SOL for ${tokenAmount} tokens via Jupiter`);
      console.log(`  2. Transfer ${tokenAmount} tokens to incinerator: ${SOLANA_INCINERATOR_ADDRESS}`);

      // Record transaction
      await storage.createTransaction({
        projectId: project.id,
        type: "buyback",
        amount: buybackAmountSOL.toString(),
        tokenAmount: tokenAmount.toString(),
        txSignature: "pending_sdk_implementation",
        status: "pending",
        errorMessage: "Awaiting Solana SDK for transaction execution",
      });

      console.log(`Buyback simulation completed for project: ${project.name}`);
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
