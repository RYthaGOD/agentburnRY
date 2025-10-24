import { useQuery } from "@tanstack/react-query";
import { useWallet } from "@solana/wallet-adapter-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Brain, Loader2, Zap, AlertCircle, Play, Power, TrendingUp, Activity, CheckCircle, XCircle, Key, Eye, EyeOff, Shield, ChevronDown, Sparkles } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Switch } from "@/components/ui/switch";
import type { AIBotConfig } from "@shared/schema";
import bs58 from "bs58";
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
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
        <Brain className="h-16 w-16 text-muted-foreground" />
        <h2 className="text-2xl font-bold">Connect Your Wallet</h2>
        <p className="text-muted-foreground">Connect your Solana wallet to access autonomous AI trading</p>
      </div>
    );
  }

  const hasTreasuryKey = aiConfig?.treasuryKeyCiphertext && aiConfig?.treasuryKeyIv && aiConfig?.treasuryKeyAuthTag;

  return (
    <div className="container mx-auto p-4 space-y-6" data-testid="page-ai-bot">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <Brain className="h-8 w-8" />
            Autonomous AI Trading Bot
          </h1>
          <p className="text-muted-foreground mt-1">
            Fully autonomous hivemind-powered trading system
          </p>
        </div>
        <div className="flex items-center gap-4">
          <Badge variant={isEnabled ? "default" : "secondary"} className="px-4 py-2">
            {isEnabled ? (
              <><CheckCircle className="h-4 w-4 mr-2" /> Active</>
            ) : (
              <><XCircle className="h-4 w-4 mr-2" /> Disabled</>
            )}
          </Badge>
        </div>
      </div>

      {/* Portfolio Overview - Autonomous Capital Management */}
      <Card className="border-blue-500/50 bg-gradient-to-r from-background to-blue-500/5">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5 text-blue-500" />
            Portfolio Overview - Autonomous Management
          </CardTitle>
          <CardDescription>
            Self-managing capital allocation with dynamic position sizing
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
            <h3 className="text-sm font-semibold">Exponential Growth Preview</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
              <div className="p-3 rounded-md bg-gradient-to-br from-green-500/10 to-blue-500/10 border border-green-500/20">
                <div className="font-medium text-green-500 mb-2">1 SOL Portfolio</div>
                <div className="space-y-1 text-muted-foreground">
                  <div>• Base trade: 0.10 SOL</div>
                  <div>• High confidence: 0.15 SOL</div>
                  <div>• Max per token: 0.25 SOL</div>
                </div>
              </div>
              
              <div className="p-3 rounded-md bg-gradient-to-br from-blue-500/10 to-purple-500/10 border border-blue-500/20">
                <div className="font-medium text-blue-500 mb-2">10 SOL Portfolio</div>
                <div className="space-y-1 text-muted-foreground">
                  <div>• Base trade: 1.00 SOL</div>
                  <div>• High confidence: 1.50 SOL</div>
                  <div>• Max per token: 2.50 SOL</div>
                </div>
              </div>
              
              <div className="p-3 rounded-md bg-gradient-to-br from-purple-500/10 to-orange-500/10 border border-purple-500/20">
                <div className="font-medium text-purple-500 mb-2">100 SOL Portfolio 🚀</div>
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
              {isEnabled ? 'Scans every 10min (quick) & 30min (deep)' : 'Manual scans only'}
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
              Monitored every 2.5 minutes
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
            </div>
          </CardContent>
        </Card>
      </div>

      {/* AI Hivemind Strategy */}
      {hivemindStrategy && (
        <Card className="border-purple-500/30 bg-gradient-to-r from-background to-purple-500/5">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Brain className="h-5 w-5 text-purple-500" />
              AI Hivemind Strategy
            </CardTitle>
            <CardDescription>
              6-model AI consensus adapts to market conditions (updates every 6 hours)
            </CardDescription>
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

      {/* How It Works - Autonomous System */}
      <Card className="border-green-500/30 bg-gradient-to-r from-background to-green-500/5">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Zap className="h-5 w-5 text-green-500" />
            How Autonomous Trading Works
          </CardTitle>
          <CardDescription>
            100% AI-driven decision making with multi-layer risk protection
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
                    <div className="font-medium">6-Model Consensus</div>
                    <div className="text-xs text-muted-foreground">Cerebras, Gemini, DeepSeek, ChatAnywhere, Groq, OpenAI</div>
                  </div>
                </div>
                <div className="flex items-start gap-2">
                  <Activity className="h-4 w-4 text-purple-500 mt-0.5 flex-shrink-0" />
                  <div>
                    <div className="font-medium">Continuous Monitoring</div>
                    <div className="text-xs text-muted-foreground">Quick scans every 2.5min, deep analysis every 30min</div>
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
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
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
        <Card>
          <CardHeader>
            <CardTitle>Active Positions ({activePositions.length})</CardTitle>
            <CardDescription>
              Real-time monitoring every 2.5 minutes
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {activePositions.map((position, idx) => (
                <div
                  key={idx}
                  className="flex items-center justify-between p-3 border rounded-lg hover-elevate"
                  data-testid={`position-${idx}`}
                >
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <div className="font-medium">{position.tokenSymbol}</div>
                      {position.isSwingTrade === 1 && (
                        <Badge variant="outline" className="text-xs bg-purple-500/10 text-purple-500 border-purple-500/30">
                          <TrendingUp className="h-3 w-3 mr-1" />
                          Swing Trade
                        </Badge>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Entry: {position.entryPriceSOL?.toFixed(9) || '0.000000000'} SOL | 
                      Current: {position.currentPriceSOL?.toFixed(9) || '0.000000000'} SOL
                    </div>
                    <div className="text-xs text-muted-foreground">
                      AI Confidence: {position.aiConfidenceAtBuy?.toFixed(0) || '0'}% | 
                      Stop-Loss: {position.isSwingTrade === 1 ? '-50%' : '-30%'}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className={`text-lg font-bold ${(position.profitPercent || 0) >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                      {(position.profitPercent || 0) >= 0 ? '+' : ''}{position.profitPercent?.toFixed(2) || '0.00'}%
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {position.amountSOL?.toFixed(6) || '0.000000'} SOL
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
