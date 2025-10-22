// Real-time WebSocket server for token monitoring and bot activity
// Provides live price updates, bot events, and transaction confirmations

import { WebSocketServer, WebSocket } from "ws";
import type { Server } from "http";
import { getTokenPrice } from "./jupiter";

interface WebSocketMessage {
  type: "price_update" | "bot_event" | "transaction_event" | "accuracy_check";
  data: any;
  timestamp: number;
}

interface BotEvent {
  projectId: string;
  botType: "volume" | "buy";
  status: "success" | "failed" | "skipped";
  message?: string;
  volume?: number; // SOL volume generated
  executedOrders?: number;
}

interface TransactionEvent {
  projectId: string;
  transactionId: string;
  type: string;
  amount: string;
  txSignature: string;
  expectedPriceSOL?: string;
  actualPriceSOL?: string;
  priceDeviationBps?: number;
}

interface PriceUpdate {
  tokenMintAddress: string;
  priceSOL: number;
  timestamp: number;
}

class RealtimeService {
  private wss: WebSocketServer | null = null;
  private clients: Set<WebSocket> = new Set();
  private priceCache: Map<string, PriceUpdate> = new Map();
  private pricePollingInterval: NodeJS.Timeout | null = null;

  initialize(server: Server) {
    this.wss = new WebSocketServer({ 
      server,
      path: "/ws"
    });

    this.wss.on("connection", (ws: WebSocket) => {
      console.log("[WebSocket] Client connected");
      this.clients.add(ws);

      // Send current price cache to new client
      this.priceCache.forEach((priceUpdate) => {
        this.sendToClient(ws, {
          type: "price_update",
          data: priceUpdate,
          timestamp: Date.now(),
        });
      });

      ws.on("close", () => {
        console.log("[WebSocket] Client disconnected");
        this.clients.delete(ws);
      });

      ws.on("error", (error) => {
        console.error("[WebSocket] Client error:", error);
        this.clients.delete(ws);
      });
    });

    // Start price polling every 30 seconds
    this.startPricePolling();

    console.log("[WebSocket] Real-time service initialized on /ws");
  }

  private startPricePolling() {
    // Poll prices every 30 seconds
    this.pricePollingInterval = setInterval(async () => {
      // Get all active project tokens from storage
      const { storage } = await import("./storage");
      try {
        const projects = await storage.getAllProjects();
        const activeProjects = projects.filter(p => p.isActive);

        for (const project of activeProjects) {
          try {
            const priceSOL = await getTokenPrice(project.tokenMintAddress);
            const priceUpdate: PriceUpdate = {
              tokenMintAddress: project.tokenMintAddress,
              priceSOL,
              timestamp: Date.now(),
            };

            // Update cache
            this.priceCache.set(project.tokenMintAddress, priceUpdate);

            // Broadcast to all clients
            this.broadcast({
              type: "price_update",
              data: {
                ...priceUpdate,
                projectId: project.id,
              },
              timestamp: Date.now(),
            });

            // Update project's latest price in database
            await storage.updateProject(project.id, {
              latestPriceSOL: priceSOL.toString(),
              priceTimestamp: new Date(),
            });
          } catch (error) {
            console.error(`[WebSocket] Error fetching price for ${project.tokenMintAddress}:`, error);
          }
        }
      } catch (error) {
        console.error("[WebSocket] Error in price polling:", error);
      }
    }, 30000); // 30 seconds
  }

  private sendToClient(client: WebSocket, message: WebSocketMessage) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(message));
    }
  }

  broadcast(message: WebSocketMessage) {
    const payload = JSON.stringify(message);
    this.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(payload);
      }
    });
  }

  // Event emitters for different event types
  emitBotEvent(event: BotEvent) {
    this.broadcast({
      type: "bot_event",
      data: event,
      timestamp: Date.now(),
    });
  }

  emitTransactionEvent(event: TransactionEvent) {
    this.broadcast({
      type: "transaction_event",
      data: event,
      timestamp: Date.now(),
    });
  }

  emitAccuracyCheck(data: {
    projectId: string;
    transactionId: string;
    expectedPriceSOL: number;
    actualPriceSOL: number;
    deviationBps: number;
    withinThreshold: boolean;
  }) {
    this.broadcast({
      type: "accuracy_check",
      data,
      timestamp: Date.now(),
    });
  }

  async getLatestPrice(tokenMintAddress: string): Promise<number | null> {
    const cached = this.priceCache.get(tokenMintAddress);
    if (cached && Date.now() - cached.timestamp < 60000) {
      return cached.priceSOL;
    }

    try {
      const priceSOL = await getTokenPrice(tokenMintAddress);
      this.priceCache.set(tokenMintAddress, {
        tokenMintAddress,
        priceSOL,
        timestamp: Date.now(),
      });
      return priceSOL;
    } catch (error) {
      console.error(`[WebSocket] Error fetching latest price:`, error);
      return null;
    }
  }

  shutdown() {
    if (this.pricePollingInterval) {
      clearInterval(this.pricePollingInterval);
    }

    this.clients.forEach((client) => {
      client.close();
    });

    if (this.wss) {
      this.wss.close();
    }

    console.log("[WebSocket] Real-time service shut down");
  }
}

export const realtimeService = new RealtimeService();
