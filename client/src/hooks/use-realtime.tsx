// Real-time WebSocket hook for token monitoring and bot activity
// Provides live price updates, bot events, and transaction confirmations

import { useEffect, useState, useCallback, useRef, createContext, useContext } from "react";
import { useQueryClient } from "@tanstack/react-query";

interface PriceUpdate {
  projectId: string;
  tokenMintAddress: string;
  priceSOL: number;
  timestamp: number;
}

interface BotEvent {
  projectId: string;
  botType: "volume" | "buy";
  status: "success" | "failed" | "skipped";
  message?: string;
  volume?: number;
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

interface AccuracyCheck {
  projectId: string;
  transactionId: string;
  expectedPriceSOL: number;
  actualPriceSOL: number;
  deviationBps: number;
  withinThreshold: boolean;
}

interface ActivityLog {
  timestamp: number;
  type: 'info' | 'success' | 'warning' | 'error' | 'ai_thought';
  category: 'quick_scan' | 'position_monitor' | 'deep_scan' | 'rebalancer';
  message: string;
}

interface WebSocketMessage {
  type: "price_update" | "bot_event" | "transaction_event" | "accuracy_check" | "ai_activity_log";
  data: any;
  timestamp: number;
}

interface RealtimeContextValue {
  isConnected: boolean;
  latestPrices: Map<string, PriceUpdate>;
  subscribeToPriceUpdates: (callback: (update: PriceUpdate) => void) => () => void;
  subscribeToBotEvents: (callback: (event: BotEvent) => void) => () => void;
  subscribeToTransactions: (callback: (event: TransactionEvent) => void) => () => void;
  subscribeToAccuracyChecks: (callback: (event: AccuracyCheck) => void) => () => void;
  subscribeToActivityLogs: (callback: (log: ActivityLog) => void) => () => void;
}

const RealtimeContext = createContext<RealtimeContextValue | null>(null);

export function RealtimeProvider({ children }: { children: React.ReactNode }) {
  const [isConnected, setIsConnected] = useState(false);
  const [latestPrices, setLatestPrices] = useState<Map<string, PriceUpdate>>(new Map());
  const wsRef = useRef<WebSocket | null>(null);
  const queryClient = useQueryClient();
  const reconnectAttemptsRef = useRef(0);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isIntentionalCloseRef = useRef(false);

  // Subscriber callbacks
  const priceUpdateCallbacksRef = useRef<Set<(update: PriceUpdate) => void>>(new Set());
  const botEventCallbacksRef = useRef<Set<(event: BotEvent) => void>>(new Set());
  const transactionCallbacksRef = useRef<Set<(event: TransactionEvent) => void>>(new Set());
  const accuracyCheckCallbacksRef = useRef<Set<(event: AccuracyCheck) => void>>(new Set());
  const activityLogCallbacksRef = useRef<Set<(log: ActivityLog) => void>>(new Set());

  // WebSocket connection setup function
  const connectWebSocket = useCallback(() => {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const host = window.location.host;
    const wsUrl = `${protocol}//${host}/ws`;

    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      console.log("[WebSocket] Connected to real-time server");
      setIsConnected(true);
      reconnectAttemptsRef.current = 0; // Reset reconnect attempts on successful connection
    };

    ws.onmessage = (event) => {
      try {
        const message: WebSocketMessage = JSON.parse(event.data);
        
        switch (message.type) {
          case "price_update": {
            const priceUpdate = message.data as PriceUpdate;
            
            // Update local price cache
            setLatestPrices((prev) => {
              const next = new Map(prev);
              next.set(priceUpdate.tokenMintAddress, priceUpdate);
              return next;
            });

            // Invalidate project metrics query
            if (priceUpdate.projectId) {
              queryClient.invalidateQueries({ 
                queryKey: ["/api/projects", priceUpdate.projectId, "metrics"] 
              });
            }

            // Notify subscribers
            priceUpdateCallbacksRef.current.forEach((callback) => {
              callback(priceUpdate);
            });
            break;
          }

          case "bot_event": {
            const botEvent = message.data as BotEvent;
            
            // Invalidate project data to refresh bot status
            queryClient.invalidateQueries({ 
              queryKey: ["/api/projects", botEvent.projectId] 
            });
            queryClient.invalidateQueries({ 
              queryKey: ["/api/projects", botEvent.projectId, "metrics"] 
            });

            // Notify subscribers
            botEventCallbacksRef.current.forEach((callback) => {
              callback(botEvent);
            });
            break;
          }

          case "transaction_event": {
            const txEvent = message.data as TransactionEvent;
            
            // Invalidate transactions list and project metrics
            queryClient.invalidateQueries({ 
              queryKey: ["/api/transactions/project", txEvent.projectId] 
            });
            queryClient.invalidateQueries({ 
              queryKey: ["/api/projects", txEvent.projectId, "transactions", "recent"] 
            });
            queryClient.invalidateQueries({ 
              queryKey: ["/api/projects", txEvent.projectId, "metrics"] 
            });

            // Notify subscribers
            transactionCallbacksRef.current.forEach((callback) => {
              callback(txEvent);
            });
            break;
          }

          case "accuracy_check": {
            const accuracyCheck = message.data as AccuracyCheck;
            
            // Invalidate transaction queries to refresh accuracy data
            queryClient.invalidateQueries({ 
              queryKey: ["/api/projects", accuracyCheck.projectId, "transactions", "recent"] 
            });
            
            // Notify subscribers
            accuracyCheckCallbacksRef.current.forEach((callback) => {
              callback(accuracyCheck);
            });
            break;
          }

          case "ai_activity_log": {
            const activityLog = message.data as ActivityLog;
            
            // Notify subscribers
            activityLogCallbacksRef.current.forEach((callback) => {
              callback(activityLog);
            });
            break;
          }
        }
      } catch (error) {
        console.error("[WebSocket] Error parsing message:", error);
      }
    };

    ws.onerror = (error) => {
      console.error("[WebSocket] Error:", error);
      setIsConnected(false);
    };

    ws.onclose = () => {
      console.log("[WebSocket] Disconnected from real-time server");
      setIsConnected(false);
      
      // Don't reconnect if this was an intentional close (component unmount)
      if (isIntentionalCloseRef.current) {
        return;
      }
      
      // Exponential backoff reconnection (max 5 attempts: 1s, 2s, 4s, 8s, 16s)
      const maxAttempts = 5;
      if (reconnectAttemptsRef.current < maxAttempts) {
        const delay = Math.min(1000 * Math.pow(2, reconnectAttemptsRef.current), 16000);
        console.log(`[WebSocket] Reconnecting in ${delay}ms (attempt ${reconnectAttemptsRef.current + 1}/${maxAttempts})`);
        
        reconnectTimeoutRef.current = setTimeout(() => {
          reconnectAttemptsRef.current++;
          connectWebSocket(); // Reconnect without page reload
        }, delay);
      } else {
        console.error("[WebSocket] Max reconnection attempts reached. Please refresh the page.");
      }
    };
  }, [queryClient]);

  // Connect on mount
  useEffect(() => {
    isIntentionalCloseRef.current = false;
    connectWebSocket();

    return () => {
      isIntentionalCloseRef.current = true;
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [connectWebSocket]);

  const subscribeToPriceUpdates = useCallback((callback: (update: PriceUpdate) => void) => {
    priceUpdateCallbacksRef.current.add(callback);
    return () => {
      priceUpdateCallbacksRef.current.delete(callback);
    };
  }, []);

  const subscribeToBotEvents = useCallback((callback: (event: BotEvent) => void) => {
    botEventCallbacksRef.current.add(callback);
    return () => {
      botEventCallbacksRef.current.delete(callback);
    };
  }, []);

  const subscribeToTransactions = useCallback((callback: (event: TransactionEvent) => void) => {
    transactionCallbacksRef.current.add(callback);
    return () => {
      transactionCallbacksRef.current.delete(callback);
    };
  }, []);

  const subscribeToAccuracyChecks = useCallback((callback: (event: AccuracyCheck) => void) => {
    accuracyCheckCallbacksRef.current.add(callback);
    return () => {
      accuracyCheckCallbacksRef.current.delete(callback);
    };
  }, []);

  const subscribeToActivityLogs = useCallback((callback: (log: ActivityLog) => void) => {
    activityLogCallbacksRef.current.add(callback);
    return () => {
      activityLogCallbacksRef.current.delete(callback);
    };
  }, []);

  const value: RealtimeContextValue = {
    isConnected,
    latestPrices,
    subscribeToPriceUpdates,
    subscribeToBotEvents,
    subscribeToTransactions,
    subscribeToAccuracyChecks,
    subscribeToActivityLogs,
  };

  return (
    <RealtimeContext.Provider value={value}>
      {children}
    </RealtimeContext.Provider>
  );
}

export function useRealtime() {
  const context = useContext(RealtimeContext);
  if (!context) {
    throw new Error("useRealtime must be used within RealtimeProvider");
  }
  return context;
}

// Convenience hooks for specific subscriptions
export function usePriceUpdates(callback: (update: PriceUpdate) => void) {
  const { subscribeToPriceUpdates } = useRealtime();
  
  useEffect(() => {
    const unsubscribe = subscribeToPriceUpdates(callback);
    return unsubscribe;
  }, [subscribeToPriceUpdates, callback]);
}

export function useBotEvents(callback: (event: BotEvent) => void) {
  const { subscribeToBotEvents } = useRealtime();
  
  useEffect(() => {
    const unsubscribe = subscribeToBotEvents(callback);
    return unsubscribe;
  }, [subscribeToBotEvents, callback]);
}

export function useTransactionEvents(callback: (event: TransactionEvent) => void) {
  const { subscribeToTransactions } = useRealtime();
  
  useEffect(() => {
    const unsubscribe = subscribeToTransactions(callback);
    return unsubscribe;
  }, [subscribeToTransactions, callback]);
}

export function useAccuracyChecks(callback: (event: AccuracyCheck) => void) {
  const { subscribeToAccuracyChecks } = useRealtime();
  
  useEffect(() => {
    const unsubscribe = subscribeToAccuracyChecks(callback);
    return unsubscribe;
  }, [subscribeToAccuracyChecks, callback]);
}
