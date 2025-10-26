import { useQuery } from "@tanstack/react-query";
import { useWallet } from "@solana/wallet-adapter-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Brain, Loader2, Zap, AlertCircle, Play, Power, TrendingUp, Activity, CheckCircle, XCircle, Key, Eye, EyeOff, Shield, ChevronDown, Sparkles, Flame, Info, RefreshCw, AlertTriangle } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useState, useEffect } from "react";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Switch } from "@/components/ui/switch";
import type { AIBotConfig } from "@shared/schema";
import bs58 from "bs58";
import { useRealtime } from "@/hooks/use-realtime";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

// Simplified schema - autonomous system, no budget limits
const aiBotConfigSchema = z.object({
  // No totalBudget field - system is autonomous and self-managing
});

type AIBotConfigFormData = z.infer<typeof aiBotConfigSchema>;

export default function AIBot() {
  const { publicKey, connected, signMessage } = useWallet();
  const { toast } = useToast();
  const [isScanning, setIsScanning] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isToggling, setIsToggling] = useState(false);
  const [treasuryKey, setTreasuryKey] = useState("");
  const [showTreasuryKey, setShowTreasuryKey] = useState(false);
  const [isSavingKey, setIsSavingKey] = useState(false);
  const [isDeletingKey, setIsDeletingKey] = useState(false);
  const [scanLog, setScanLog] = useState<Array<{
    timestamp: number;
    message: string;
    type: "info" | "success" | "warning" | "error";
  }>>([]);

  // Real-time activity logs from WebSocket
  const [activityLogs, setActivityLogs] = useState<Array<{
    timestamp: number;
    type: 'info' | 'success' | 'warning' | 'error' | 'ai_thought';
    category: 'quick_scan' | 'position_monitor' | 'deep_scan' | 'rebalancer';
    message: string;
  }>>([]);

  // Listen for real-time activity logs via WebSocket
  const { subscribeToActivityLogs } = useRealtime();

  useEffect(() => {
    const unsubscribe = subscribeToActivityLogs((log) => {
      setActivityLogs(prev => [log, ...prev].slice(0, 100)); // Keep last 100 logs
    });
    return unsubscribe;
  }, [subscribeToActivityLogs]);
  
  // Private key converter state
  const [arrayKeyInput, setArrayKeyInput] = useState("");
  const [convertedBase58, setConvertedBase58] = useState("");
  const [conversionError, setConversionError] = useState("");
  
  // Fetch AI bot config for this wallet
  const { data: aiConfig, isLoading } = useQuery<AIBotConfig>({
    queryKey: ["/api/ai-bot/config", publicKey?.toString()],
    enabled: connected && !!publicKey,
  });

  // Fetch hivemind strategy status
  const { data: hivemindStrategy, isLoading: isLoadingStrategy } = useQuery<{
    marketSentiment: string;
    riskLevel: string;
    minConfidenceThreshold: number;
    budgetPerTrade: number;
    minVolumeUSD: number;
    minLiquidityUSD: number;
    maxDailyTrades: number;
    minPotentialPercent: number;
    profitTargetMultiplier: number;
    reasoning: string;
    generatedAt: string;
  }>({
    queryKey: ["/api/ai-bot/hivemind-strategy", publicKey?.toString()],
    enabled: connected && !!publicKey,
    refetchInterval: 30000, // Refetch every 30 seconds
  });

  // Fetch active positions for this wallet
  const { data: activePositions = [], isLoading: isLoadingPositions } = useQuery<Array<{
    mint: string;
    tokenSymbol: string;
    entryPriceSOL: number;
    amountSOL: number;
    currentPriceSOL: number;
    profitPercent: number;
    aiConfidenceAtBuy: number;
    isSwingTrade?: number;
  }>>({
    queryKey: ["/api/ai-bot/positions", publicKey?.toString()],
    enabled: connected && !!publicKey,
    refetchInterval: 30000, // Refetch every 30 seconds
  });

  // Fetch wallet holdings analysis (real blockchain data)
  const { data: holdings, isLoading: isLoadingHoldings } = useQuery<{
    solBalance: number;
    totalValueSOL: number;
    solPercentage: number;
    holdings: Array<{
      mint: string;
      balance: number;
      priceSOL: number;
      valueSOL: number;
      decimals: number;
    }>;
    holdingCount: number;
    largestTokenPercentage: number;
    diversificationScore: number;
  }>({
    queryKey: ["/api/ai-bot/holdings", publicKey?.toString()],
    enabled: connected && !!publicKey,
    refetchInterval: 60000, // Refetch every 60 seconds
  });

  // Fetch scheduler status for real-time activity display
  const { data: schedulerStatus } = useQuery<{
    quickScan: { lastRun: number | null; nextRun: number | null; status: string; lastResult?: string };
    deepScan: { lastRun: number | null; nextRun: number | null; status: string; lastResult?: string };
    positionMonitor: { lastRun: number | null; nextRun: number | null; status: string; lastResult?: string };
    portfolioRebalancer: { lastRun: number | null; nextRun: number | null; status: string; lastResult?: string };
    activityLogs: Array<{
      timestamp: number;
      type: 'info' | 'success' | 'warning' | 'error' | 'ai_thought';
      category: 'quick_scan' | 'position_monitor' | 'deep_scan' | 'rebalancer';
      message: string;
    }>;
  }>({
    queryKey: ["/api/ai-bot/scheduler-status"],
    refetchInterval: 5000, // Refetch every 5 seconds for live updates
  });

  // Fetch MY BOT token data (featured token)
  const { data: myBotToken } = useQuery<{
    pairs: Array<{
      baseToken: { name: string; symbol: string; address: string };
      priceUsd: string;
      priceNative: string;
      volume: { h24: number };
      priceChange: { h24: number };
      txns: { h24: { buys: number; sells: number } };
      fdv: number;
      marketCap: number;
      url: string;
    }>;
  }>({
    queryKey: ["my-bot-token"],
    queryFn: async () => {
      const response = await fetch("https://api.dexscreener.com/latest/dex/tokens/FQptMsS3tnyPbK68rTZm3n3R4NHBX5r9edshyyvxpump");
      if (!response.ok) throw new Error("Failed to fetch MY BOT token data");
      return response.json();
    },
    refetchInterval: 30000, // Refetch every 30 seconds
    enabled: connected && !!publicKey,
  });

  // Load initial activity logs from scheduler status
  useEffect(() => {
    if (schedulerStatus?.activityLogs && schedulerStatus.activityLogs.length > 0) {
      setActivityLogs(prev => {
        // Merge with WebSocket logs, avoiding duplicates
        const merged = [...schedulerStatus.activityLogs, ...prev];
        const unique = merged.filter((log, index, self) =>
          index === self.findIndex(l => l.timestamp === log.timestamp && l.message === log.message)
        );
        return unique.slice(0, 100);
      });
    }
  }, [schedulerStatus]);

  const isEnabled = aiConfig?.enabled || false;
  const budgetUsed = parseFloat(aiConfig?.budgetUsed || "0");
  const totalBudget = parseFloat(aiConfig?.totalBudget || "0");
  const remainingBudget = totalBudget - budgetUsed;
  
  // Autonomous capital calculations using REAL wallet data
  const portfolioValue = holdings?.totalValueSOL || 0; // Real total value from blockchain
  const walletSOL = holdings?.solBalance || 0; // Real SOL balance
  const capitalInPositions = budgetUsed; // Active AI bot trades
  const feeReserve = 0.01;
  const availableCapital = Math.max(0, walletSOL - feeReserve - capitalInPositions);
  
  // Dynamic position sizing calculations (10% base, up to 15% with high confidence)
  const basePositionSize = portfolioValue * 0.10;
  const maxPositionSize = portfolioValue * 0.15; // Max with 90%+ AI confidence
  const maxConcentration = portfolioValue * 0.25; // 25% diversification limit

  const form = useForm<AIBotConfigFormData>({
    resolver: zodResolver(aiBotConfigSchema),
    defaultValues: {},
  });

  const addScanLog = (message: string, type: "info" | "success" | "warning" | "error" = "info") => {
    setScanLog(prev => [...prev, { timestamp: Date.now(), message, type }]);
  };

  const handleScanAndTrade = async () => {
    if (!publicKey || !signMessage) {
      toast({
        title: "Error",
        description: "Please connect wallet first",
        variant: "destructive",
      });
      return;
    }

    if (!aiConfig) {
      toast({
        title: "Error",
        description: "Please save your configuration first",
        variant: "destructive",
      });
      return;
    }

    setIsScanning(true);
    setScanLog([]);
    
    try {
      addScanLog("🔍 Connecting to DexScreener API...", "info");
      
      const message = `Execute AI bot for wallet ${publicKey.toString()} at ${Date.now()}`;
      const messageBytes = new TextEncoder().encode(message);
      const signature = await signMessage(messageBytes);
      const signatureBase58 = bs58.encode(signature);

      addScanLog("✅ Wallet signature verified", "success");
      addScanLog("📡 Fetching trending tokens...", "info");

      toast({
        title: "🔍 Scanning Market...",
        description: "Hivemind AI is analyzing trending tokens",
      });

      const response: any = await apiRequest("POST", `/api/ai-bot/execute`, {
        ownerWalletAddress: publicKey.toString(),
        signature: signatureBase58,
        message,
      });

      if (response.logs && Array.isArray(response.logs)) {
        response.logs.forEach((log: any) => {
          addScanLog(log.message, log.type);
        });
      }

      addScanLog("✅ Market scan completed", "success");

      queryClient.invalidateQueries({ queryKey: ["/api/ai-bot/config", publicKey.toString()] });
      queryClient.invalidateQueries({ queryKey: ["/api/ai-bot/positions", publicKey.toString()] });
      queryClient.invalidateQueries({ queryKey: ["/api/transactions"] });

      toast({
        title: "✅ Scan Complete",
        description: "Check scan log for details",
      });
    } catch (error: any) {
      addScanLog(`❌ Error: ${error.message}`, "error");
      toast({
        title: "Scan Failed",
        description: error.message || "Failed to execute AI bot",
        variant: "destructive",
      });
    } finally {
      setIsScanning(false);
    }
  };

  const handleToggleBot = async () => {
    if (!publicKey || !signMessage) return;
    
    setIsToggling(true);
    try {
      const message = `Toggle AI bot for wallet ${publicKey.toString()} at ${Date.now()}`;
      const messageBytes = new TextEncoder().encode(message);
      const signature = await signMessage(messageBytes);
      const signatureBase58 = bs58.encode(signature);

      await apiRequest("POST", `/api/ai-bot/config`, {
        ownerWalletAddress: publicKey.toString(),
        signature: signatureBase58,
        message,
        enabled: !isEnabled,
      });
      
      queryClient.invalidateQueries({ 
        queryKey: ["/api/ai-bot/config", publicKey.toString()] 
      });
      
      toast({
        title: isEnabled ? "✅ Auto Trading Stopped" : "🚀 Auto Trading Started",
        description: isEnabled 
          ? "Scheduled scans disabled. You can still scan manually." 
          : "Hivemind AI will scan and trade automatically",
      });
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to toggle AI bot",
        variant: "destructive",
      });
    } finally {
      setIsToggling(false);
    }
  };

  const onSubmit = async (data: AIBotConfigFormData) => {
    if (!publicKey || !signMessage) return;
    
    setIsSaving(true);
    try {
      const message = `Update AI bot config for wallet ${publicKey.toString()} at ${Date.now()}`;
      const messageBytes = new TextEncoder().encode(message);
      const signature = await signMessage(messageBytes);
      const signatureBase58 = bs58.encode(signature);

      await apiRequest("POST", `/api/ai-bot/config`, {
        ownerWalletAddress: publicKey.toString(),
        signature: signatureBase58,
        message,
        // No totalBudget - system is autonomous
        enabled: aiConfig?.enabled || false,
      });
      
      queryClient.invalidateQueries({ queryKey: ["/api/ai-bot/config", publicKey.toString()] });
      toast({
        title: "✅ Settings Saved",
        description: "AI bot configuration updated successfully",
      });
    } catch (error: any) {
      toast({
        title: "Save Failed",
        description: error.message || "Failed to save settings",
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleSaveTreasuryKey = async () => {
    if (!publicKey || !signMessage) return;
    
    if (!treasuryKey.trim()) {
      toast({
        title: "Error",
        description: "Treasury private key is required",
        variant: "destructive",
      });
      return;
    }

    setIsSavingKey(true);
    try {
      const message = `Save treasury key for AI bot wallet ${publicKey.toString()} at ${Date.now()}`;
      const messageBytes = new TextEncoder().encode(message);
      const signature = await signMessage(messageBytes);
      const signatureBase58 = bs58.encode(signature);

      await apiRequest("POST", `/api/ai-bot/config/treasury-key`, {
        ownerWalletAddress: publicKey.toString(),
        signature: signatureBase58,
        message,
        treasuryPrivateKey: treasuryKey.trim(),
      });

      queryClient.invalidateQueries({ queryKey: ["/api/ai-bot/config", publicKey.toString()] });
      toast({
        title: "✅ Private Key Saved",
        description: "Treasury key encrypted and stored securely",
      });
      setTreasuryKey("");
      setShowTreasuryKey(false);
    } catch (error: any) {
      toast({
        title: "Save Failed",
        description: error.message || "Failed to save treasury key",
        variant: "destructive",
      });
    } finally {
      setIsSavingKey(false);
    }
  };

  const handleDeleteTreasuryKey = async () => {
    if (!publicKey || !signMessage) return;

    setIsDeletingKey(true);
    try {
      const message = `Delete treasury key for AI bot wallet ${publicKey.toString()} at ${Date.now()}`;
      const messageBytes = new TextEncoder().encode(message);
      const signature = await signMessage(messageBytes);
      const signatureBase58 = bs58.encode(signature);

      await apiRequest("DELETE", `/api/ai-bot/config/treasury-key`, {
        ownerWalletAddress: publicKey.toString(),
        signature: signatureBase58,
        message,
      });

      queryClient.invalidateQueries({ queryKey: ["/api/ai-bot/config", publicKey.toString()] });
      toast({
        title: "✅ Private Key Deleted",
        description: "Treasury key removed from secure storage",
      });
    } catch (error: any) {
      toast({
        title: "Delete Failed",
        description: error.message || "Failed to delete treasury key",
        variant: "destructive",
      });
    } finally {
      setIsDeletingKey(false);
    }
  };

  const updateConfig = async (updates: Partial<AIBotConfig>) => {
    if (!publicKey || !signMessage) return;
    
    try {
      const message = `Update AI bot buyback config for wallet ${publicKey.toString()} at ${Date.now()}`;
      const messageBytes = new TextEncoder().encode(message);
      const signature = await signMessage(messageBytes);
      const signatureBase58 = bs58.encode(signature);

      await apiRequest("POST", `/api/ai-bot/config`, {
        ownerWalletAddress: publicKey.toString(),
        signature: signatureBase58,
        message,
        ...updates,
      });
      
      queryClient.invalidateQueries({ 
        queryKey: ["/api/ai-bot/config", publicKey.toString()] 
      });
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to update buyback configuration",
        variant: "destructive",
      });
      throw error;
    }
  };

  const handleConvertArrayKey = () => {
    setConversionError("");
    setConvertedBase58("");

    try {
      let parsedArray: number[];
      
      try {
        parsedArray = JSON.parse(arrayKeyInput.trim());
      } catch {
        throw new Error("Invalid format. Paste a valid number array like [123, 45, 67, ...]");
      }

      if (!Array.isArray(parsedArray)) {
        throw new Error("Input must be an array of numbers");
      }

      if (parsedArray.length !== 64) {
        throw new Error(`Invalid key length: ${parsedArray.length} bytes (expected 64 bytes)`);
      }

      if (!parsedArray.every(n => typeof n === 'number' && n >= 0 && n <= 255)) {
        throw new Error("Array must contain only numbers between 0 and 255");
      }

      const uint8Array = new Uint8Array(parsedArray);
      const base58Key = bs58.encode(uint8Array);
      
      setConvertedBase58(base58Key);
      toast({
        title: "✅ Conversion Successful",
        description: "Your private key has been converted to base58 format",
      });
    } catch (error: any) {
      setConversionError(error.message || "Conversion failed");
      toast({
        title: "Conversion Failed",
        description: error.message || "Invalid array format",
        variant: "destructive",
      });
    }
  };

  if (!connected) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-6">
        <Brain className="h-20 w-20 text-primary" />
        <div className="text-center">
          <h2 className="text-4xl font-black text-primary mb-2">GigaBrain</h2>
          <p className="text-sm font-bold text-primary/80 tracking-wide mb-4">BLACK AND GOLD NEVER FOLD</p>
          <p className="text-muted-foreground">Connect your Solana wallet to access autonomous AI trading</p>
        </div>
      </div>
    );
  }

  const hasTreasuryKey = aiConfig?.treasuryKeyCiphertext && aiConfig?.treasuryKeyIv && aiConfig?.treasuryKeyAuthTag;

  return (
    <div className="container mx-auto p-4 space-y-6" data-testid="page-ai-bot">
      <div className="relative overflow-hidden rounded-lg border border-primary/30 bg-gradient-to-r from-background via-primary/10 to-background p-6 mb-6">
        <div className="absolute inset-0 bg-gradient-to-r from-transparent via-primary/5 to-transparent animate-pulse"></div>
        <div className="relative z-10">
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
            <div>
              <div className="flex items-center gap-3 mb-2">
                <Brain className="h-10 w-10 text-primary" />
                <div>
                  <h1 className="text-4xl font-black tracking-tight text-primary">
                    GigaBrain
                  </h1>
                  <p className="text-sm font-bold text-primary/80 tracking-wide">
                    BLACK AND GOLD NEVER FOLD
                  </p>
                </div>
              </div>
              <p className="text-muted-foreground text-sm mt-2">
                10-Model AI Hivemind • Autonomous Trading • Self-Managing Capital
              </p>
            </div>
            <div className="flex items-center gap-4">
              <Badge variant={isEnabled ? "default" : "secondary"} className="px-4 py-2 text-base">
                {isEnabled ? (
                  <><CheckCircle className="h-4 w-4 mr-2" /> ACTIVE</>
                ) : (
                  <><XCircle className="h-4 w-4 mr-2" /> OFFLINE</>
                )}
              </Badge>
            </div>
          </div>
        </div>
      </div>

      {/* Real-Time Scheduler Status */}
      {schedulerStatus && (
        <Card className="border-primary/30 bg-gradient-to-r from-background to-primary/5">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Activity className="h-5 w-5 text-primary" />
              Live Scheduler Activity
            </CardTitle>
            <CardDescription>
              Real-time bot automation status - updates every 5 seconds
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Quick Scan Status */}
              <div className="p-4 rounded-lg border bg-muted/30">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <Zap className="h-4 w-4 text-primary" />
                    <span className="text-sm font-medium">Quick Scan (10min)</span>
                  </div>
                  <Badge variant={schedulerStatus.quickScan.status === 'running' ? 'default' : schedulerStatus.quickScan.status === 'error' ? 'destructive' : 'outline'} data-testid="badge-quick-scan-status">
                    {schedulerStatus.quickScan.status}
                  </Badge>
                </div>
                {schedulerStatus.quickScan.lastRun && (
                  <div className="space-y-1 text-xs text-muted-foreground">
                    <div>Last run: {new Date(schedulerStatus.quickScan.lastRun).toLocaleTimeString()}</div>
                    {schedulerStatus.quickScan.lastResult && <div>{schedulerStatus.quickScan.lastResult}</div>}
                  </div>
                )}
              </div>

              {/* Position Monitor Status */}
              <div className="p-4 rounded-lg border bg-muted/30">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <Activity className="h-4 w-4 text-primary" />
                    <span className="text-sm font-medium">Position Monitor (2.5min)</span>
                  </div>
                  <Badge variant={schedulerStatus.positionMonitor.status === 'running' ? 'default' : schedulerStatus.positionMonitor.status === 'error' ? 'destructive' : 'outline'} data-testid="badge-monitor-status">
                    {schedulerStatus.positionMonitor.status}
                  </Badge>
                </div>
                {schedulerStatus.positionMonitor.lastRun && (
                  <div className="space-y-1 text-xs text-muted-foreground">
                    <div>Last run: {new Date(schedulerStatus.positionMonitor.lastRun).toLocaleTimeString()}</div>
                    {schedulerStatus.positionMonitor.lastResult && <div>{schedulerStatus.positionMonitor.lastResult}</div>}
                  </div>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* MY BOT Featured Token */}
      {myBotToken && myBotToken.pairs && myBotToken.pairs[0] && (
        <Card className="border-primary/50 bg-gradient-to-r from-background via-primary/5 to-background">
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-primary/10">
                  <Brain className="h-6 w-6 text-primary" />
                </div>
                <div>
                  <div className="text-2xl font-bold">{myBotToken.pairs[0].baseToken.name}</div>
                  <div className="text-sm text-muted-foreground">
                    ${myBotToken.pairs[0].baseToken.symbol}
                  </div>
                </div>
              </div>
              <Badge variant="outline" className="text-lg px-4 py-2">
                Connected Token
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="p-4 rounded-lg bg-background/50 border hover-elevate">
                <div className="text-xs font-medium text-muted-foreground mb-1">Price (USD)</div>
                <div className="text-2xl font-bold">
                  ${parseFloat(myBotToken.pairs[0].priceUsd).toFixed(8)}
                </div>
                <div className={`text-xs mt-1 ${myBotToken.pairs[0].priceChange.h24 >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                  {myBotToken.pairs[0].priceChange.h24 >= 0 ? '+' : ''}
                  {myBotToken.pairs[0].priceChange.h24.toFixed(2)}% (24h)
                </div>
              </div>

              <div className="p-4 rounded-lg bg-background/50 border hover-elevate">
                <div className="text-xs font-medium text-muted-foreground mb-1">Market Cap</div>
                <div className="text-2xl font-bold">
                  ${myBotToken.pairs[0].marketCap.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                </div>
                <div className="text-xs text-muted-foreground mt-1">
                  FDV: ${myBotToken.pairs[0].fdv.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                </div>
              </div>

              <div className="p-4 rounded-lg bg-background/50 border hover-elevate">
                <div className="text-xs font-medium text-muted-foreground mb-1">24h Volume</div>
                <div className="text-2xl font-bold">
                  ${myBotToken.pairs[0].volume.h24.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                </div>
                <div className="text-xs text-muted-foreground mt-1">
                  {myBotToken.pairs[0].txns.h24.buys + myBotToken.pairs[0].txns.h24.sells} txns
                </div>
              </div>

              <div className="p-4 rounded-lg bg-background/50 border hover-elevate">
                <div className="text-xs font-medium text-muted-foreground mb-1">24h Trading</div>
                <div className="flex items-center gap-2 mt-1">
                  <div className="flex-1">
                    <div className="text-xs text-green-500 mb-1">
                      Buys: {myBotToken.pairs[0].txns.h24.buys}
                    </div>
                    <div className="text-xs text-red-500">
                      Sells: {myBotToken.pairs[0].txns.h24.sells}
                    </div>
                  </div>
                  <div className="text-sm">
                    {myBotToken.pairs[0].txns.h24.buys > myBotToken.pairs[0].txns.h24.sells ? '🟢' : '🔴'}
                  </div>
                </div>
              </div>
            </div>

            <div className="flex gap-3 mt-4">
              <Button
                variant="default"
                className="flex-1"
                onClick={() => window.open(myBotToken.pairs[0].url, '_blank')}
                data-testid="button-view-dexscreener"
              >
                <TrendingUp className="h-4 w-4 mr-2" />
                View on DexScreener
              </Button>
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => window.open(`https://pump.fun/${myBotToken.pairs[0].baseToken.address}`, '_blank')}
                data-testid="button-trade-pumpfun"
              >
                <Zap className="h-4 w-4 mr-2" />
                Trade on Pump.fun
              </Button>
            </div>

            <div className="mt-3 p-3 rounded-lg bg-muted/30 border">
              <div className="text-xs text-muted-foreground mb-1">Token Address</div>
              <div className="font-mono text-xs break-all">{myBotToken.pairs[0].baseToken.address}</div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Buyback & Burn Configuration */}
      {aiConfig && (
        <Card className="border-primary/30 bg-gradient-to-r from-background to-primary/5">
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-primary/10">
                  <Flame className="h-6 w-6 text-primary" />
                </div>
                <div>
                  <div className="text-2xl font-bold">Automatic Buyback & Burn</div>
                  <div className="text-sm text-muted-foreground">
                    Permanently destroy tokens with profitable trade proceeds
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">Enable</span>
                <Switch
                  checked={aiConfig.buybackEnabled || false}
                  onCheckedChange={async (checked) => {
                    try {
                      await updateConfig({ buybackEnabled: checked });
                      if (checked) {
                        toast({
                          title: "Buyback & Burn Enabled",
                          description: `${aiConfig.buybackPercentage || 5}% of profits will automatically buyback and burn tokens`,
                        });
                      } else {
                        toast({
                          title: "Buyback & Burn Disabled",
                          description: "Automatic buyback and burn has been turned off",
                        });
                      }
                    } catch (error) {
                      toast({
                        title: "Error",
                        description: "Failed to update buyback setting",
                        variant: "destructive",
                      });
                    }
                  }}
                  data-testid="switch-buyback-enabled"
                />
              </div>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-6">
              {/* Configuration Section */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-3">
                  <div>
                    <label className="text-sm font-medium mb-2 block">Token Mint Address</label>
                    <Input
                      value={aiConfig.buybackTokenMint || 'FQptMsS3tnyPbK68rTZm3n3R4NHBX5r9edshyyvxpump'}
                      onChange={(e) => updateConfig({ buybackTokenMint: e.target.value })}
                      placeholder="Token mint address to buyback"
                      className="font-mono text-xs"
                      disabled={!aiConfig.buybackEnabled}
                      data-testid="input-buyback-token-mint"
                    />
                    <p className="text-xs text-muted-foreground mt-1">
                      MY BOT token will be bought back and permanently burned
                    </p>
                  </div>
                </div>

                <div className="space-y-3">
                  <div>
                    <label className="text-sm font-medium mb-2 block">
                      Buyback Percentage: {aiConfig.buybackPercentage || 5}%
                    </label>
                    <div className="flex items-center gap-3">
                      <input
                        type="range"
                        min="1"
                        max="20"
                        step="0.5"
                        value={String(aiConfig.buybackPercentage || 5)}
                        onChange={(e) => updateConfig({ buybackPercentage: parseFloat(e.target.value) })}
                        className="flex-1"
                        disabled={!aiConfig.buybackEnabled}
                        data-testid="slider-buyback-percentage"
                      />
                      <Input
                        type="number"
                        min={1}
                        max={20}
                        step={0.5}
                        value={String(aiConfig.buybackPercentage || 5)}
                        onChange={(e) => updateConfig({ buybackPercentage: parseFloat(e.target.value) })}
                        className="w-20"
                        disabled={!aiConfig.buybackEnabled}
                        data-testid="input-buyback-percentage"
                      />
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      Percentage of profits used for buyback (1-20%)
                    </p>
                  </div>
                </div>
              </div>

              {/* Stats Section */}
              <div className="border-t pt-6">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div className="p-4 rounded-lg bg-background/50 border">
                    <div className="text-xs font-medium text-muted-foreground mb-1">Status</div>
                    <div className="text-lg font-bold">
                      {aiConfig.buybackEnabled ? (
                        <span className="text-green-500">Active</span>
                      ) : (
                        <span className="text-muted-foreground">Inactive</span>
                      )}
                    </div>
                  </div>

                  <div className="p-4 rounded-lg bg-background/50 border">
                    <div className="text-xs font-medium text-muted-foreground mb-1">Total Buyback SOL</div>
                    <div className="text-lg font-bold">
                      {parseFloat(aiConfig.totalBuybackSOL || '0').toFixed(4)} SOL
                    </div>
                  </div>

                  <div className="p-4 rounded-lg bg-background/50 border">
                    <div className="text-xs font-medium text-muted-foreground mb-1">Tokens Burned</div>
                    <div className="text-lg font-bold text-primary">
                      {parseFloat(aiConfig.totalTokensBurned || '0').toLocaleString(undefined, { maximumFractionDigits: 0 })}
                    </div>
                  </div>

                  <div className="p-4 rounded-lg bg-background/50 border">
                    <div className="text-xs font-medium text-muted-foreground mb-1">Buyback %</div>
                    <div className="text-lg font-bold">
                      {aiConfig.buybackPercentage || 5}%
                    </div>
                  </div>
                </div>
              </div>

              {/* Platform Fee Info */}
              <div className="border-t pt-6">
                <h3 className="font-semibold mb-3 flex items-center gap-2">
                  <Info className="h-4 w-4" />
                  Platform Fee Tracking
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="p-4 rounded-lg bg-background/50 border">
                    <div className="text-xs font-medium text-muted-foreground mb-1">Fee Status</div>
                    <div className="text-lg font-bold">
                      {aiConfig.isFeeExempt ? (
                        <span className="text-green-500 flex items-center gap-1">
                          <CheckCircle className="h-4 w-4" />
                          Exempt
                        </span>
                      ) : (
                        <span className="text-muted-foreground">1% per trade</span>
                      )}
                    </div>
                  </div>

                  <div className="p-4 rounded-lg bg-background/50 border" data-testid="card-total-fees-paid">
                    <div className="text-xs font-medium text-muted-foreground mb-1">Total Fees Paid</div>
                    <div className="text-lg font-bold">
                      {parseFloat(aiConfig.totalPlatformFeesPaid || '0').toFixed(4)} SOL
                    </div>
                  </div>

                  <div className="p-4 rounded-lg bg-background/50 border">
                    <div className="text-xs font-medium text-muted-foreground mb-1">Wallet</div>
                    <div className="text-xs font-mono truncate" title={publicKey?.toString()}>
                      {publicKey?.toString().slice(0, 8)}...{publicKey?.toString().slice(-8)}
                    </div>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground mt-3">
                  {aiConfig.isFeeExempt ? (
                    <>✅ Your wallet is exempt from all platform fees. Trade without fees!</>
                  ) : (
                    <>💰 A 1% platform fee is deducted from each trade to support development and maintenance.</>
                  )}
                </p>
              </div>

              {/* How It Works */}
              <div className="p-4 rounded-lg bg-primary/10 border border-primary/20">
                <div className="flex items-start gap-3">
                  <Info className="h-5 w-5 text-primary mt-0.5" />
                  <div className="space-y-2 text-sm">
                    <p className="font-medium">How Automatic Buyback & Burn Works:</p>
                    <ul className="space-y-1 text-muted-foreground">
                      <li>• When a trade closes profitably, {aiConfig.buybackPercentage || 5}% of the profit is automatically used</li>
                      <li>• The bot buys your specified token using Jupiter or PumpSwap</li>
                      <li>• Purchased tokens are immediately and permanently burned using SPL Token burn</li>
                      <li>• This reduces circulating supply and supports token value over time</li>
                      <li>• All buyback and burn transactions are logged and visible on-chain</li>
                    </ul>
                  </div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Advanced Risk Settings */}
      {aiConfig && (
        <Card className="border-primary/30 bg-gradient-to-r from-background to-primary/5">
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-primary/10">
                  <Shield className="h-6 w-6 text-primary" />
                </div>
                <div>
                  <div className="text-2xl font-bold">Advanced Risk Settings</div>
                  <div className="text-sm text-muted-foreground">
                    Fine-tune risk management and protection systems
                  </div>
                </div>
              </div>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-6">
              {/* Drawdown Protection Bypass */}
              <div className="p-4 rounded-lg border bg-background/50">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="font-semibold">Bypass Drawdown Protection</h3>
                      <Switch
                        checked={aiConfig.bypassDrawdownProtection || false}
                        onCheckedChange={async (checked) => {
                          try {
                            await updateConfig({ bypassDrawdownProtection: checked });
                            if (checked) {
                              toast({
                                title: "Drawdown Protection Bypassed",
                                description: "⚠️ AI will continue trading even during drawdowns (HIGH RISK)",
                                variant: "destructive",
                              });
                            } else {
                              toast({
                                title: "Drawdown Protection Enabled",
                                description: "Trading will pause at -20% drawdown for capital protection",
                              });
                            }
                          } catch (error) {
                            toast({
                              title: "Error",
                              description: "Failed to update drawdown bypass setting",
                              variant: "destructive",
                            });
                          }
                        }}
                        data-testid="switch-bypass-drawdown"
                      />
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {aiConfig.bypassDrawdownProtection ? (
                        <span className="text-yellow-500 font-medium">
                          ⚠️ AI will continue trading even if portfolio drops {">"} 20% from peak (high-risk mode)
                        </span>
                      ) : (
                        <span>
                          Trading automatically pauses at -20% drawdown and resumes at -15% recovery
                        </span>
                      )}
                    </p>
                  </div>
                </div>

                {/* Warning Box */}
                {aiConfig.bypassDrawdownProtection && (
                  <div className="mt-3 p-3 rounded-lg bg-yellow-500/10 border border-yellow-500/20">
                    <div className="flex items-start gap-2">
                      <AlertTriangle className="h-5 w-5 text-yellow-500 mt-0.5 flex-shrink-0" />
                      <div className="space-y-1 text-xs">
                        <p className="font-medium text-yellow-500">High-Risk Mode Active</p>
                        <p className="text-muted-foreground">
                          The AI will continue making trades even during significant portfolio drawdowns. This may lead to larger losses but could also enable recovery through continued trading. Monitor your portfolio closely.
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                {/* Info Box for Normal Mode */}
                {!aiConfig.bypassDrawdownProtection && (
                  <div className="mt-3 p-3 rounded-lg bg-blue-500/10 border border-blue-500/20">
                    <div className="flex items-start gap-2">
                      <Info className="h-5 w-5 text-blue-500 mt-0.5 flex-shrink-0" />
                      <div className="space-y-1 text-xs">
                        <p className="font-medium text-blue-500">Protection Active</p>
                        <p className="text-muted-foreground">
                          Trading will automatically pause if your portfolio value drops more than 20% from its all-time peak. This helps prevent catastrophic losses during market downturns.
                        </p>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Real-Time AI Activity Feed */}
      {activityLogs.length > 0 && (
        <Card className="border-primary/30 bg-gradient-to-r from-background to-primary/5">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Brain className="h-5 w-5 text-primary" />
              Live AI Thoughts & Activity
            </CardTitle>
            <CardDescription>
              Real-time stream of AI analysis, trade decisions, and bot activity
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-[400px] w-full rounded-lg border bg-muted/30 p-4">
              <div className="space-y-2">
                {activityLogs.map((log, index) => {
                  const categoryColor = {
                    quick_scan: 'text-blue-500',
                    position_monitor: 'text-green-500',
                    deep_scan: 'text-purple-500',
                    rebalancer: 'text-cyan-500'
                  }[log.category];

                  const typeVariant = {
                    info: 'outline',
                    success: 'default',
                    warning: 'secondary',
                    error: 'destructive',
                    ai_thought: 'outline'
                  }[log.type] as any;

                  return (
                    <div
                      key={`${log.timestamp}-${index}`}
                      className="p-3 rounded-lg border bg-background/50 hover-elevate transition-all"
                      data-testid={`log-${log.category}-${index}`}
                    >
                      <div className="flex items-start justify-between gap-2 mb-1">
                        <Badge variant={typeVariant} className={`text-xs ${log.type === 'ai_thought' ? categoryColor : ''}`}>
                          {log.category.replace('_', ' ')}
                        </Badge>
                        <span className="text-xs text-muted-foreground">
                          {new Date(log.timestamp).toLocaleTimeString()}
                        </span>
                      </div>
                      <p className={`text-sm ${log.type === 'ai_thought' ? 'font-medium' : ''}`}>
                        {log.message}
                      </p>
                    </div>
                  );
                })}
                {activityLogs.length === 0 && (
                  <div className="text-center text-muted-foreground py-8">
                    <Activity className="h-8 w-8 mx-auto mb-2 opacity-50" />
                    <p className="text-sm">Waiting for AI activity...</p>
                  </div>
                )}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>
      )}

      {/* Portfolio Overview - Autonomous Capital Management */}
      <Card className="border-blue-500/50 bg-gradient-to-r from-background to-blue-500/5">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5 text-blue-500" />
            Autonomous Portfolio Management
          </CardTitle>
          <CardDescription>
            100% self-managing with exponential compounding - no budget limits
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Main Portfolio Metrics */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="p-4 rounded-lg bg-muted/30">
              <div className="text-sm font-medium text-muted-foreground">Total Portfolio Value</div>
              <div className="text-2xl font-bold mt-1">{portfolioValue.toFixed(4)} SOL</div>
              <div className="text-xs text-muted-foreground mt-1">Wallet + Positions</div>
            </div>
            
            <div className="p-4 rounded-lg bg-green-500/10 border border-green-500/20">
              <div className="text-sm font-medium text-green-500">Available Capital</div>
              <div className="text-2xl font-bold mt-1">{availableCapital.toFixed(4)} SOL</div>
              <div className="text-xs text-muted-foreground mt-1">Ready to trade</div>
            </div>
            
            <div className="p-4 rounded-lg bg-blue-500/10 border border-blue-500/20">
              <div className="text-sm font-medium text-blue-500">In Positions</div>
              <div className="text-2xl font-bold mt-1">{capitalInPositions.toFixed(4)} SOL</div>
              <div className="text-xs text-muted-foreground mt-1">{activePositions.length} active</div>
            </div>
            
            <div className="p-4 rounded-lg bg-orange-500/10 border border-orange-500/20">
              <div className="text-sm font-medium text-orange-500">Fee Reserve</div>
              <div className="text-2xl font-bold mt-1">{feeReserve.toFixed(2)} SOL</div>
              <div className="text-xs text-muted-foreground mt-1">Always protected</div>
            </div>
          </div>

          {/* Dynamic Position Sizing */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">Dynamic Position Sizing</h3>
              <Badge variant="outline">Scales with Growth</Badge>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="p-3 rounded-md bg-muted/50 border">
                <div className="text-xs font-medium text-muted-foreground">Base Position (10%)</div>
                <div className="text-lg font-bold">{basePositionSize.toFixed(4)} SOL</div>
                <div className="text-xs text-muted-foreground mt-1">Standard confidence</div>
              </div>
              
              <div className="p-3 rounded-md bg-blue-500/10 border border-blue-500/30">
                <div className="text-xs font-medium text-blue-500">Max Position (15%)</div>
                <div className="text-lg font-bold">{maxPositionSize.toFixed(4)} SOL</div>
                <div className="text-xs text-muted-foreground mt-1">90%+ AI confidence</div>
              </div>
              
              <div className="p-3 rounded-md bg-orange-500/10 border border-orange-500/30">
                <div className="text-xs font-medium text-orange-500">Max Concentration (25%)</div>
                <div className="text-lg font-bold">{maxConcentration.toFixed(4)} SOL</div>
                <div className="text-xs text-muted-foreground mt-1">Per position limit</div>
              </div>
            </div>
          </div>

          {/* Compounding Growth Examples */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">Exponential Growth System</h3>
              <Badge variant="outline" className="text-green-500">Compounding Enabled</Badge>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
              <div className="p-3 rounded-md bg-gradient-to-br from-green-500/10 to-blue-500/10 border border-green-500/20 hover-elevate">
                <div className="flex items-center justify-between mb-2">
                  <div className="font-medium text-green-500">1 SOL Start</div>
                  <Badge variant="outline" className="text-xs">10x Growth</Badge>
                </div>
                <div className="space-y-1 text-muted-foreground">
                  <div>• Base trade: 0.10 SOL</div>
                  <div>• High confidence: 0.15 SOL</div>
                  <div>• Max per token: 0.25 SOL</div>
                </div>
              </div>
              
              <div className="p-3 rounded-md bg-gradient-to-br from-blue-500/10 to-purple-500/10 border border-blue-500/20 hover-elevate">
                <div className="flex items-center justify-between mb-2">
                  <div className="font-medium text-blue-500">10 SOL Growth</div>
                  <Badge variant="outline" className="text-xs">10x Trades</Badge>
                </div>
                <div className="space-y-1 text-muted-foreground">
                  <div>• Base trade: 1.00 SOL</div>
                  <div>• High confidence: 1.50 SOL</div>
                  <div>• Max per token: 2.50 SOL</div>
                </div>
              </div>
              
              <div className="p-3 rounded-md bg-gradient-to-br from-purple-500/10 to-orange-500/10 border border-purple-500/20 hover-elevate">
                <div className="flex items-center justify-between mb-2">
                  <div className="font-medium text-purple-500">100 SOL Target</div>
                  <Badge variant="outline" className="text-xs bg-orange-500/10">100x Trades!</Badge>
                </div>
                <div className="space-y-1 text-muted-foreground">
                  <div>• Base trade: 10.00 SOL</div>
                  <div>• High confidence: 15.00 SOL</div>
                  <div>• Max per token: 25.00 SOL</div>
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Real Wallet Holdings Breakdown */}
      {holdings && holdings.holdingCount > 0 && (
        <Card className="border-green-500/30">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Activity className="h-5 w-5 text-green-500" />
              Wallet Holdings Analysis
            </CardTitle>
            <CardDescription>
              Real-time token positions from Solana blockchain
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Portfolio Composition */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="p-3 rounded-lg bg-muted/30">
                <div className="text-xs font-medium text-muted-foreground">SOL Holdings</div>
                <div className="text-lg font-bold">{walletSOL.toFixed(4)} SOL</div>
                <div className="text-xs text-muted-foreground mt-1">{holdings.solPercentage.toFixed(1)}% of portfolio</div>
              </div>
              
              <div className="p-3 rounded-lg bg-green-500/10 border border-green-500/20">
                <div className="text-xs font-medium text-green-500">Token Holdings</div>
                <div className="text-lg font-bold">{holdings.holdingCount} Tokens</div>
                <div className="text-xs text-muted-foreground mt-1">{(100 - holdings.solPercentage).toFixed(1)}% of portfolio</div>
              </div>
              
              <div className="p-3 rounded-lg bg-blue-500/10 border border-blue-500/20">
                <div className="text-xs font-medium text-blue-500">Diversification</div>
                <div className="text-lg font-bold">{holdings.diversificationScore.toFixed(0)}/100</div>
                <div className="text-xs text-muted-foreground mt-1">
                  {holdings.diversificationScore > 70 ? 'Well diversified' : holdings.diversificationScore > 40 ? 'Moderate' : 'Concentrated'}
                </div>
              </div>
              
              <div className="p-3 rounded-lg bg-orange-500/10 border border-orange-500/20">
                <div className="text-xs font-medium text-orange-500">Largest Position</div>
                <div className="text-lg font-bold">{holdings.largestTokenPercentage.toFixed(1)}%</div>
                <div className="text-xs text-muted-foreground mt-1">Of total value</div>
              </div>
            </div>

            {/* Top Holdings Table */}
            <div className="space-y-2">
              <h3 className="text-sm font-semibold">Top Token Holdings</h3>
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {holdings.holdings.slice(0, 10).map((holding, index) => (
                  <div 
                    key={holding.mint}
                    className="p-3 rounded-lg bg-muted/30 border hover-elevate"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className="text-xs">#{index + 1}</Badge>
                          <span className="text-sm font-mono text-muted-foreground">
                            {holding.mint.substring(0, 8)}...{holding.mint.substring(holding.mint.length - 6)}
                          </span>
                        </div>
                        <div className="text-xs text-muted-foreground mt-1">
                          Balance: {holding.balance.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-sm font-bold">
                          {holding.valueSOL > 0 ? `${holding.valueSOL.toFixed(6)} SOL` : 'No price'}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {holding.valueSOL > 0 && portfolioValue > 0 
                            ? `${((holding.valueSOL / portfolioValue) * 100).toFixed(2)}%`
                            : '-'}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              {holdings.holdingCount > 10 && (
                <div className="text-xs text-center text-muted-foreground pt-2">
                  ... and {holdings.holdingCount - 10} more tokens
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Bot Control & Status */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Bot Status</CardTitle>
            <Power className={`h-4 w-4 ${isEnabled ? 'text-green-500' : 'text-gray-400'}`} />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{isEnabled ? 'Running' : 'Stopped'}</div>
            <p className="text-xs text-muted-foreground mt-1">
              {isEnabled ? 'DeepSeek scans: 10min quick, 30min deep' : 'Manual scans only'}
            </p>
            <Button
              onClick={handleToggleBot}
              disabled={isToggling || !hasTreasuryKey}
              variant={isEnabled ? "destructive" : "default"}
              className="w-full mt-3"
              data-testid="button-toggle-bot"
            >
              {isToggling ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : isEnabled ? (
                <Power className="h-4 w-4 mr-2" />
              ) : (
                <Play className="h-4 w-4 mr-2" />
              )}
              {isEnabled ? 'Stop Auto Trading' : 'Start Auto Trading'}
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Active Positions</CardTitle>
            <Activity className="h-4 w-4 text-blue-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{activePositions.length}</div>
            <p className="text-xs text-muted-foreground mt-1">
              DeepSeek monitoring every 2.5min
            </p>
            <div className="mt-3 text-sm">
              {activePositions.length > 0 ? (
                <div className="space-y-1">
                  <div className="text-xs text-green-500">
                    {activePositions.filter(p => p.profitPercent > 0).length} profitable
                  </div>
                  <div className="text-xs text-red-500">
                    {activePositions.filter(p => p.profitPercent < 0).length} losing
                  </div>
                </div>
              ) : (
                <div className="text-xs text-muted-foreground">No open positions</div>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Risk Controls</CardTitle>
            <Shield className="h-4 w-4 text-green-500" />
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Stop-Loss</span>
                <Badge variant="outline">-30%</Badge>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Swing Trade SL</span>
                <Badge variant="outline">-50%</Badge>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Max Concentration</span>
                <Badge variant="outline">25%</Badge>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">AI Confidence</span>
                <Badge variant="outline">≥75%</Badge>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Auto Rebalancing</span>
                <Badge variant="outline" className="text-cyan-500">Every 30min</Badge>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Automatic Portfolio Rebalancing */}
      <Card className="border-cyan-500/30 bg-gradient-to-r from-background to-cyan-500/5">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-cyan-500" />
            Automatic Portfolio Rebalancing
          </CardTitle>
          <CardDescription>
            AI-powered rebalancing runs every 30 minutes for optimal portfolio performance
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="p-4 rounded-lg bg-cyan-500/10 border border-cyan-500/20">
              <div className="text-sm font-medium text-cyan-500">Schedule</div>
              <div className="text-2xl font-bold mt-1">Every 30min</div>
              <div className="text-xs text-muted-foreground mt-1">Fully automated</div>
            </div>
            
            <div className="p-4 rounded-lg bg-purple-500/10 border border-purple-500/20">
              <div className="text-sm font-medium text-purple-500">Analysis</div>
              <div className="text-2xl font-bold mt-1">7-Model AI</div>
              <div className="text-xs text-muted-foreground mt-1">Including OpenAI</div>
            </div>
            
            <div className="p-4 rounded-lg bg-green-500/10 border border-green-500/20">
              <div className="text-sm font-medium text-green-500">Execution</div>
              <div className="text-2xl font-bold mt-1">Auto-Sell</div>
              <div className="text-xs text-muted-foreground mt-1">When AI recommends</div>
            </div>
          </div>

          <Alert className="bg-cyan-500/5 border-cyan-500/20">
            <Sparkles className="h-4 w-4 text-cyan-500" />
            <AlertTitle>Continuous Optimization</AlertTitle>
            <AlertDescription className="text-xs">
              The rebalancer analyzes ALL positions together using full hivemind consensus (including OpenAI for maximum accuracy). 
              Positions are automatically sold when AI determines better opportunities exist or momentum weakens. No manual intervention required.
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>

      {/* AI Hivemind Strategy */}
      {hivemindStrategy && (
        <Card className="border-purple-500/30 bg-gradient-to-r from-background to-purple-500/5">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <Brain className="h-5 w-5 text-purple-500" />
                  Full 7-Model AI Hivemind Strategy
                </CardTitle>
                <CardDescription>
                  AI learns from your trading performance and continuously improves the strategy (auto-updates every 3 hours)
                </CardDescription>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={async () => {
                  if (!publicKey) return;
                  try {
                    toast({
                      title: "Regenerating Strategy...",
                      description: "Full AI hivemind is analyzing your performance and optimizing parameters",
                    });
                    
                    const response = await fetch(`/api/ai-bot/regenerate-strategy/${publicKey.toString()}`, {
                      method: 'POST',
                    });
                    
                    if (!response.ok) throw new Error("Failed to regenerate strategy");
                    
                    const data = await response.json();
                    
                    toast({
                      title: "✅ Strategy Regenerated",
                      description: `New ${data.strategy.marketSentiment} strategy with ${data.strategy.riskLevel} risk level`,
                    });
                    
                    // Refresh strategy data
                    queryClient.invalidateQueries({ queryKey: ["/api/ai-bot/hivemind-strategy", publicKey.toString()] });
                  } catch (error: any) {
                    toast({
                      title: "Error",
                      description: error.message || "Failed to regenerate strategy",
                      variant: "destructive",
                    });
                  }
                }}
                className="gap-2"
                data-testid="button-regenerate-strategy"
              >
                <RefreshCw className="h-4 w-4" />
                Regenerate Now
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Primary Strategy Metrics */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="p-3 rounded-lg bg-muted/30">
                <div className="text-xs font-medium text-muted-foreground">Market Sentiment</div>
                <div className="text-lg font-bold capitalize">{hivemindStrategy.marketSentiment}</div>
              </div>
              <div className="p-3 rounded-lg bg-muted/30">
                <div className="text-xs font-medium text-muted-foreground">Risk Level</div>
                <div className="text-lg font-bold capitalize">{hivemindStrategy.riskLevel}</div>
              </div>
              <div className="p-3 rounded-lg bg-purple-500/10 border border-purple-500/30">
                <div className="text-xs font-medium text-purple-500">AI Confidence Filter</div>
                <div className="text-lg font-bold">≥{hivemindStrategy.minConfidenceThreshold}%</div>
              </div>
              <div className="p-3 rounded-lg bg-blue-500/10 border border-blue-500/30">
                <div className="text-xs font-medium text-blue-500">Unlimited Trading</div>
                <div className="text-lg font-bold">AI-Driven</div>
              </div>
            </div>
            
            {/* Quality Filters */}
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              <div className="p-3 rounded-lg bg-green-500/10 border border-green-500/20">
                <div className="text-xs font-medium text-green-500">Min Volume</div>
                <div className="text-lg font-bold">${(hivemindStrategy.minVolumeUSD / 1000).toFixed(0)}k</div>
                <div className="text-xs text-muted-foreground mt-1">Quality filter</div>
              </div>
              <div className="p-3 rounded-lg bg-green-500/10 border border-green-500/20">
                <div className="text-xs font-medium text-green-500">Min Liquidity</div>
                <div className="text-lg font-bold">${(hivemindStrategy.minLiquidityUSD / 1000).toFixed(0)}k</div>
                <div className="text-xs text-muted-foreground mt-1">Safety threshold</div>
              </div>
              <div className="p-3 rounded-lg bg-orange-500/10 border border-orange-500/20">
                <div className="text-xs font-medium text-orange-500">Organic Volume</div>
                <div className="text-lg font-bold">≥60%</div>
                <div className="text-xs text-muted-foreground mt-1">Wash trading filter</div>
              </div>
            </div>

            <Alert className="bg-purple-500/5 border-purple-500/20">
              <Sparkles className="h-4 w-4 text-purple-500" />
              <AlertTitle>AI-Driven Strategy</AlertTitle>
              <AlertDescription className="text-xs">
                {hivemindStrategy.reasoning}
                <div className="mt-2 text-muted-foreground">
                  Last updated: {new Date(hivemindStrategy.generatedAt).toLocaleString()}
                </div>
              </AlertDescription>
            </Alert>
          </CardContent>
        </Card>
      )}

      {/* Opportunistic Position Rotation */}
      <Card className="border-orange-500/30 bg-gradient-to-r from-background to-orange-500/5">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Activity className="h-5 w-5 text-orange-500" />
            Opportunistic Position Rotation
            <Badge variant="outline" className="bg-orange-500/20 text-orange-500 border-orange-500/50">
              NEW
            </Badge>
          </CardTitle>
          <CardDescription>
            Maximizes capital efficiency by automatically rotating to better opportunities
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Alert className="bg-orange-500/5 border-orange-500/20">
            <Zap className="h-4 w-4 text-orange-500" />
            <AlertTitle>Smart Capital Allocation</AlertTitle>
            <AlertDescription className="text-xs">
              When wallet capital is insufficient for a new high-confidence opportunity, the AI automatically sells weaker positions to free up capital. 
              This ensures you're always positioned in the highest-confidence trades.
            </AlertDescription>
          </Alert>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="p-4 rounded-lg bg-muted/30 space-y-3">
              <h3 className="text-sm font-semibold text-orange-500">Rotation Criteria</h3>
              <div className="space-y-2 text-xs">
                <div className="flex items-start gap-2">
                  <CheckCircle className="h-3 w-3 text-orange-500 mt-0.5 flex-shrink-0" />
                  <div>
                    <div className="font-medium">15% Higher AI Confidence</div>
                    <div className="text-muted-foreground">New opportunity must significantly outperform weakest position</div>
                  </div>
                </div>
                <div className="flex items-start gap-2">
                  <CheckCircle className="h-3 w-3 text-orange-500 mt-0.5 flex-shrink-0" />
                  <div>
                    <div className="font-medium">Loss-Cutting Override</div>
                    <div className="text-muted-foreground">Allows selling -5% positions for 70%+ confidence opportunities</div>
                  </div>
                </div>
                <div className="flex items-start gap-2">
                  <CheckCircle className="h-3 w-3 text-orange-500 mt-0.5 flex-shrink-0" />
                  <div>
                    <div className="font-medium">5-Minute Minimum Hold</div>
                    <div className="text-muted-foreground">Positions must age before rotation eligible</div>
                  </div>
                </div>
              </div>
            </div>

            <div className="p-4 rounded-lg bg-green-500/10 border border-green-500/20 space-y-3">
              <h3 className="text-sm font-semibold text-green-500">Winner Protection</h3>
              <div className="space-y-2 text-xs">
                <div className="flex items-start gap-2">
                  <Shield className="h-3 w-3 text-green-500 mt-0.5 flex-shrink-0" />
                  <div>
                    <div className="font-medium">Never Sells Big Winners</div>
                    <div className="text-muted-foreground">Positions with &gt;10% profit are protected</div>
                  </div>
                </div>
                <div className="flex items-start gap-2">
                  <Shield className="h-3 w-3 text-green-500 mt-0.5 flex-shrink-0" />
                  <div>
                    <div className="font-medium">Prioritizes Weak Positions</div>
                    <div className="text-muted-foreground">Targets big losses (&lt;-15%), small profits (0-5%), low confidence entries</div>
                  </div>
                </div>
                <div className="flex items-start gap-2">
                  <Shield className="h-3 w-3 text-green-500 mt-0.5 flex-shrink-0" />
                  <div>
                    <div className="font-medium">Capital Verification</div>
                    <div className="text-muted-foreground">Ensures selling position provides enough capital for new trade</div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="p-3 rounded-lg bg-blue-500/10 border border-blue-500/20 text-xs">
            <strong className="text-blue-500">Benefit:</strong> Maximizes capital efficiency by automatically cutting underperformers and capturing better opportunities. 
            Keeps portfolio always positioned in highest-confidence trades for exponential growth.
          </div>
        </CardContent>
      </Card>

      {/* DeepSeek Cost Optimization */}
      <Alert className="bg-gradient-to-r from-green-500/5 to-blue-500/5 border-green-500/30">
        <Sparkles className="h-4 w-4 text-green-500" />
        <AlertTitle className="text-base font-semibold flex items-center gap-2">
          DeepSeek V3 Cost Optimization
          <Badge variant="outline" className="bg-green-500/20 text-green-500 border-green-500/50">
            FREE 5M Tokens
          </Badge>
        </AlertTitle>
        <AlertDescription className="text-sm mt-2">
          <div className="space-y-2">
            <div className="p-3 rounded-lg bg-green-500/10 border border-green-500/30">
              <div className="font-semibold text-green-500 mb-1">Cost Savings: 60%+ Reduction in AI Expenses</div>
              <div className="text-xs text-muted-foreground">
                System intelligently uses <strong>DeepSeek V3 (FREE tier, 5M tokens/month)</strong> for 90%+ of analysis, 
                reserving paid OpenAI API for high-value swing trade opportunities only.
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2 mt-3 text-xs">
              <div className="p-2 rounded bg-green-500/10 border border-green-500/20">
                <div className="font-semibold text-green-500 flex items-center gap-1">
                  Position Monitoring
                  <Badge variant="outline" className="text-xs">100% FREE</Badge>
                </div>
                <div className="text-muted-foreground mt-1">DeepSeek-only every 2.5min - zero cost, superior quality</div>
              </div>
              <div className="p-2 rounded bg-blue-500/10 border border-blue-500/20">
                <div className="font-semibold text-blue-500 flex items-center gap-1">
                  Quick Scans
                  <Badge variant="outline" className="text-xs">100% FREE</Badge>
                </div>
                <div className="text-muted-foreground mt-1">DeepSeek-only every 10min for 75%+ trades - no API fees</div>
              </div>
              <div className="p-2 rounded bg-purple-500/10 border border-purple-500/20">
                <div className="font-semibold text-purple-500">High-Confidence Trades</div>
                <div className="text-muted-foreground mt-1">Full 7-model consensus only when justified by profit potential</div>
              </div>
            </div>
            <div className="mt-3 p-2 rounded bg-blue-500/10 border border-blue-500/20 text-xs">
              <strong className="text-blue-500">Smart Cost Management:</strong> OpenAI usage limited to 85%+ confidence swing trades where premium analysis justifies the expense. 
              All routine monitoring and most trading decisions use free DeepSeek API for maximum efficiency.
            </div>
          </div>
        </AlertDescription>
      </Alert>

      {/* How It Works - Autonomous System */}
      <Card className="border-green-500/30 bg-gradient-to-r from-background to-green-500/5">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Zap className="h-5 w-5 text-green-500" />
            How Autonomous Trading Works
          </CardTitle>
          <CardDescription>
            100% AI-driven with DeepSeek-first strategy and multi-layer protection
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Capital Management */}
            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-green-500">Capital Management</h3>
              <div className="space-y-2 text-sm">
                <div className="flex items-start gap-2">
                  <CheckCircle className="h-4 w-4 text-green-500 mt-0.5 flex-shrink-0" />
                  <div>
                    <div className="font-medium">No Budget Limits</div>
                    <div className="text-xs text-muted-foreground">Uses all available capital (minus 0.01 SOL fee reserve)</div>
                  </div>
                </div>
                <div className="flex items-start gap-2">
                  <CheckCircle className="h-4 w-4 text-green-500 mt-0.5 flex-shrink-0" />
                  <div>
                    <div className="font-medium">Dynamic Sizing</div>
                    <div className="text-xs text-muted-foreground">Positions scale 10-15% of portfolio based on AI confidence</div>
                  </div>
                </div>
                <div className="flex items-start gap-2">
                  <CheckCircle className="h-4 w-4 text-green-500 mt-0.5 flex-shrink-0" />
                  <div>
                    <div className="font-medium">Exponential Compounding</div>
                    <div className="text-xs text-muted-foreground">Trade sizes grow proportionally with portfolio value</div>
                  </div>
                </div>
              </div>
            </div>

            {/* AI Decision Making */}
            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-purple-500">AI Decision Making</h3>
              <div className="space-y-2 text-sm">
                <div className="flex items-start gap-2">
                  <Brain className="h-4 w-4 text-purple-500 mt-0.5 flex-shrink-0" />
                  <div>
                    <div className="font-medium flex items-center gap-2">
                      7-Model Hivemind
                      <Badge variant="outline" className="text-xs bg-green-500/20 text-green-500">90% FREE</Badge>
                    </div>
                    <div className="text-xs text-muted-foreground">DeepSeek V3 FREE (primary), Cerebras, Gemini, ChatAnywhere, Groq, OpenAI x2 (paid, high-value only)</div>
                  </div>
                </div>
                <div className="flex items-start gap-2">
                  <Activity className="h-4 w-4 text-purple-500 mt-0.5 flex-shrink-0" />
                  <div>
                    <div className="font-medium">DeepSeek Monitoring</div>
                    <div className="text-xs text-muted-foreground">Position checks: 2.5min | Quick scans: 10min | Deep scans: 30min</div>
                  </div>
                </div>
                <div className="flex items-start gap-2">
                  <TrendingUp className="h-4 w-4 text-purple-500 mt-0.5 flex-shrink-0" />
                  <div>
                    <div className="font-medium">Smart Entry & Exit</div>
                    <div className="text-xs text-muted-foreground">AI analyzes momentum, liquidity, and trends for optimal timing</div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Risk Protection */}
          <div className="pt-4 border-t">
            <h3 className="text-sm font-semibold text-orange-500 mb-3">Multi-Layer Risk Protection</h3>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-2 text-xs">
              <div className="p-2 rounded bg-muted/50 border">
                <div className="font-medium">Stop-Loss</div>
                <div className="text-muted-foreground">-30% auto-sell</div>
              </div>
              <div className="p-2 rounded bg-muted/50 border">
                <div className="font-medium">AI Exit</div>
                <div className="text-muted-foreground">≥50% confidence</div>
              </div>
              <div className="p-2 rounded bg-muted/50 border">
                <div className="font-medium">Concentration</div>
                <div className="text-muted-foreground">25% max/token</div>
              </div>
              <div className="p-2 rounded bg-muted/50 border">
                <div className="font-medium">Quality Filter</div>
                <div className="text-muted-foreground">60% organic vol</div>
              </div>
              <div className="p-2 rounded bg-cyan-500/10 border border-cyan-500/30">
                <div className="font-medium text-cyan-500">Auto Rebalance</div>
                <div className="text-muted-foreground">Every 30min</div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Treasury Key Management */}
      <Card className={hasTreasuryKey ? "border-green-500/50" : "border-yellow-500/50"}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Key className="h-5 w-5" />
            Treasury Wallet Private Key
          </CardTitle>
          <CardDescription>
            Required for automated trading. Encrypted and stored securely.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {hasTreasuryKey ? (
            <Alert>
              <Shield className="h-4 w-4" />
              <AlertTitle>Private Key Configured</AlertTitle>
              <AlertDescription>
                Your treasury key is encrypted and stored securely. The bot can execute trades automatically.
              </AlertDescription>
            </Alert>
          ) : (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>No Private Key</AlertTitle>
              <AlertDescription>
                Add your treasury wallet's private key to enable automated trading.
              </AlertDescription>
            </Alert>
          )}

          <Collapsible>
            <CollapsibleTrigger asChild>
              <Button variant="outline" className="w-full">
                <Key className="mr-2 h-4 w-4" />
                {hasTreasuryKey ? 'Replace' : 'Add'} Private Key
                <ChevronDown className="ml-auto h-4 w-4" />
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="space-y-4 mt-4">
              <div className="space-y-2">
                <div className="flex gap-2">
                  <Input
                    type={showTreasuryKey ? "text" : "password"}
                    placeholder="Base58 private key"
                    value={treasuryKey}
                    onChange={(e) => setTreasuryKey(e.target.value)}
                    data-testid="input-treasury-key"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    onClick={() => setShowTreasuryKey(!showTreasuryKey)}
                  >
                    {showTreasuryKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </Button>
                </div>
                <div className="flex gap-2">
                  <Button
                    onClick={handleSaveTreasuryKey}
                    disabled={isSavingKey || !treasuryKey.trim()}
                    className="flex-1"
                    data-testid="button-save-key"
                  >
                    {isSavingKey && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Save Key
                  </Button>
                  {hasTreasuryKey && (
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button variant="destructive" disabled={isDeletingKey}>
                          Delete Key
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Delete Treasury Key?</AlertDialogTitle>
                          <AlertDialogDescription>
                            This will remove your encrypted private key from secure storage. You won't be able to use automated trading until you add a new key.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction onClick={handleDeleteTreasuryKey}>
                            Delete Key
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  )}
                </div>
              </div>

              {/* Array to Base58 Converter */}
              <div className="border-t pt-4 space-y-2">
                <div className="text-sm font-medium">Convert Number Array to Base58</div>
                <div className="text-xs text-muted-foreground">
                  If you have a private key as a number array (e.g., from Phantom), paste it here
                </div>
                <textarea
                  className="w-full h-24 p-2 border rounded-md text-sm font-mono"
                  placeholder="[123, 45, 67, ...]"
                  value={arrayKeyInput}
                  onChange={(e) => setArrayKeyInput(e.target.value)}
                />
                <Button
                  type="button"
                  onClick={handleConvertArrayKey}
                  variant="outline"
                  className="w-full"
                >
                  Convert to Base58
                </Button>
                {convertedBase58 && (
                  <div className="p-3 bg-green-500/10 border border-green-500/20 rounded-md">
                    <div className="text-sm font-medium text-green-600 dark:text-green-400 mb-1">
                      Converted Key:
                    </div>
                    <div className="text-xs font-mono break-all bg-background p-2 rounded">
                      {convertedBase58}
                    </div>
                    <div className="text-xs text-muted-foreground mt-2">
                      Copy this and paste it in the field above
                    </div>
                  </div>
                )}
                {conversionError && (
                  <div className="text-sm text-destructive">{conversionError}</div>
                )}
              </div>
            </CollapsibleContent>
          </Collapsible>
        </CardContent>
      </Card>

      {/* Manual Scan */}
      <Card>
        <CardHeader>
          <CardTitle>Manual Market Scan</CardTitle>
          <CardDescription>
            Trigger an immediate market scan and trading analysis
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Button
            onClick={handleScanAndTrade}
            disabled={isScanning || !hasTreasuryKey}
            className="w-full"
            size="lg"
            data-testid="button-scan-trade"
          >
            {isScanning ? (
              <>
                <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                Scanning Market...
              </>
            ) : (
              <>
                <Zap className="mr-2 h-5 w-5" />
                Scan & Trade Now
              </>
            )}
          </Button>

          {!hasTreasuryKey && (
            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                Add a treasury private key above to enable scanning and trading
              </AlertDescription>
            </Alert>
          )}

          {scanLog.length > 0 && (
            <div className="border rounded-lg p-4">
              <div className="text-sm font-medium mb-2">Scan Activity Log</div>
              <ScrollArea className="h-[200px]">
                <div className="space-y-1">
                  {scanLog.map((log, idx) => (
                    <div
                      key={idx}
                      className={`text-xs font-mono ${
                        log.type === "error"
                          ? "text-red-500"
                          : log.type === "success"
                          ? "text-green-500"
                          : log.type === "warning"
                          ? "text-yellow-500"
                          : "text-muted-foreground"
                      }`}
                    >
                      {log.message}
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Active Positions */}
      {activePositions.length > 0 && (
        <Card className="border-blue-500/30">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Activity className="h-5 w-5 text-blue-500" />
              Active Positions ({activePositions.length})
            </CardTitle>
            <CardDescription>
              DeepSeek AI monitoring every 2.5 minutes + automatic rebalancing every 30 minutes
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {activePositions.map((position, idx) => (
                <div
                  key={idx}
                  className={`flex items-center justify-between p-3 border rounded-lg hover-elevate ${
                    (position.profitPercent || 0) >= 0 
                      ? 'bg-green-500/5 border-green-500/30' 
                      : 'bg-red-500/5 border-red-500/30'
                  }`}
                  data-testid={`position-${idx}`}
                >
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <div className="font-semibold text-base">{position.tokenSymbol}</div>
                      {position.isSwingTrade === 1 && (
                        <Badge variant="outline" className="text-xs bg-purple-500/20 text-purple-500 border-purple-500/50">
                          <TrendingUp className="h-3 w-3 mr-1" />
                          Swing
                        </Badge>
                      )}
                      <Badge 
                        variant="outline" 
                        className={`text-xs ${
                          (position.aiConfidenceAtBuy || 0) >= 85 
                            ? 'bg-green-500/20 text-green-500 border-green-500/50' 
                            : 'bg-blue-500/20 text-blue-500 border-blue-500/50'
                        }`}
                      >
                        {position.aiConfidenceAtBuy?.toFixed(0) || '0'}% AI
                      </Badge>
                    </div>
                    <div className="text-xs text-muted-foreground space-y-0.5">
                      <div>Entry: {position.entryPriceSOL?.toFixed(9) || '0.000000000'} SOL</div>
                      <div>Now: {position.currentPriceSOL?.toFixed(9) || '0.000000000'} SOL</div>
                      <div className="flex items-center gap-2">
                        <span>Stop-Loss: {position.isSwingTrade === 1 ? '-50%' : '-30%'}</span>
                        <span>•</span>
                        <span>Size: {position.amountSOL?.toFixed(4) || '0.0000'} SOL</span>
                      </div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className={`text-2xl font-bold ${(position.profitPercent || 0) >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                      {(position.profitPercent || 0) >= 0 ? '+' : ''}{position.profitPercent?.toFixed(1) || '0.0'}%
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">
                      {(position.profitPercent || 0) >= 0 ? 'Profit' : 'Loss'}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
