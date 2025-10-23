import { useQuery } from "@tanstack/react-query";
import { useWallet } from "@solana/wallet-adapter-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Brain, Loader2, Zap, AlertCircle, Play, Power, Scan, TrendingUp, Activity, CheckCircle, XCircle, Clock, Key, Eye, EyeOff, Shield, Lock, ChevronDown } from "lucide-react";
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

const aiBotConfigSchema = z.object({
  totalBudget: z.string().min(1).refine(
    (val) => !isNaN(parseFloat(val)) && parseFloat(val) > 0,
    "Must be a positive number"
  ),
  budgetPerTrade: z.string().min(1).refine(
    (val) => !isNaN(parseFloat(val)) && parseFloat(val) > 0,
    "Must be a positive number"
  ),
  minVolumeUSD: z.string().min(1).refine(
    (val) => !isNaN(parseFloat(val)) && parseFloat(val) >= 0,
    "Must be a positive number"
  ),
  minPotentialPercent: z.string().min(1).refine(
    (val) => !isNaN(parseFloat(val)) && parseFloat(val) >= 150,
    "Must be at least 150% (1.5X minimum returns)"
  ),
  maxDailyTrades: z.string().min(1).refine(
    (val) => !isNaN(parseInt(val)) && parseInt(val) >= 1,
    "Must be at least 1"
  ),
  profitTargetPercent: z.string().min(1).refine(
    (val) => !isNaN(parseFloat(val)) && parseFloat(val) >= 10,
    "Must be at least 10%"
  ),
  minOrganicScore: z.string().min(1).refine(
    (val) => !isNaN(parseInt(val)) && parseInt(val) >= 0 && parseInt(val) <= 100,
    "Must be between 0-100"
  ),
  minQualityScore: z.string().min(1).refine(
    (val) => !isNaN(parseInt(val)) && parseInt(val) >= 0 && parseInt(val) <= 100,
    "Must be between 0-100"
  ),
  minLiquidityUSD: z.string().min(1).refine(
    (val) => !isNaN(parseFloat(val)) && parseFloat(val) >= 1000,
    "Must be at least $1,000"
  ),
  minTransactions24h: z.string().min(1).refine(
    (val) => !isNaN(parseInt(val)) && parseInt(val) >= 10,
    "Must be at least 10"
  ),
  enableAiSellDecisions: z.boolean(),
  minAiSellConfidence: z.string().min(1).refine(
    (val) => !isNaN(parseInt(val)) && parseInt(val) >= 0 && parseInt(val) <= 100,
    "Must be between 0-100"
  ),
  holdIfHighConfidence: z.string().min(1).refine(
    (val) => !isNaN(parseInt(val)) && parseInt(val) >= 0 && parseInt(val) <= 100,
    "Must be between 0-100"
  ),
  riskTolerance: z.enum(["low", "medium", "high"]),
}).refine(
  (data) => parseInt(data.holdIfHighConfidence) > parseInt(data.minAiSellConfidence),
  {
    message: "Hold threshold must be greater than sell threshold to avoid conflicts",
    path: ["holdIfHighConfidence"],
  }
);

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
  
  // Fetch AI bot config for this wallet (completely independent of projects)
  const { data: aiConfig, isLoading } = useQuery<AIBotConfig>({
    queryKey: ["/api/ai-bot/config", publicKey?.toString()],
    enabled: connected && !!publicKey,
  });

  // Fetch active positions for this wallet
  const { data: activePositions = [], isLoading: isLoadingPositions } = useQuery<Array<{
    mint: string;
    entryPriceSOL: number;
    amountSOL: number;
    currentPriceSOL: number;
    profitPercent: number;
  }>>({
    queryKey: ["/api/ai-bot/positions", publicKey?.toString()],
    enabled: connected && !!publicKey,
    refetchInterval: 30000, // Refetch every 30 seconds for real-time updates
  });

  const isEnabled = aiConfig?.enabled || false;
  const budgetUsed = parseFloat(aiConfig?.budgetUsed || "0");
  const totalBudget = parseFloat(aiConfig?.totalBudget || "0");
  const remainingBudget = totalBudget - budgetUsed;

  const form = useForm<AIBotConfigFormData>({
    resolver: zodResolver(aiBotConfigSchema),
    defaultValues: {
      totalBudget: aiConfig?.totalBudget || "1.0",
      budgetPerTrade: aiConfig?.budgetPerTrade || "0.1",
      minVolumeUSD: aiConfig?.minVolumeUSD || "5000",
      minPotentialPercent: aiConfig?.minPotentialPercent || "150",
      maxDailyTrades: aiConfig?.maxDailyTrades?.toString() || "5",
      profitTargetPercent: aiConfig?.profitTargetPercent || "50",
      minOrganicScore: aiConfig?.minOrganicScore?.toString() || "40",
      minQualityScore: aiConfig?.minQualityScore?.toString() || "30",
      minLiquidityUSD: aiConfig?.minLiquidityUSD || "5000",
      minTransactions24h: aiConfig?.minTransactions24h?.toString() || "20",
      enableAiSellDecisions: aiConfig?.enableAiSellDecisions !== false, // Default true
      minAiSellConfidence: aiConfig?.minAiSellConfidence?.toString() || "40",
      holdIfHighConfidence: aiConfig?.holdIfHighConfidence?.toString() || "70",
      riskTolerance: (aiConfig?.riskTolerance as "low" | "medium" | "high") || "medium",
    },
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
    setScanLog([]); // Clear previous logs
    
    try {
      addScanLog("🔍 Connecting to DexScreener API...", "info");
      
      const message = `Execute AI bot for wallet ${publicKey.toString()} at ${Date.now()}`;
      const messageBytes = new TextEncoder().encode(message);
      const signature = await signMessage(messageBytes);
      const signatureBase58 = bs58.encode(signature);

      addScanLog("✅ Wallet signature verified", "success");
      addScanLog("📡 Fetching trending tokens from DexScreener...", "info");

      toast({
        title: "🔍 Scanning Market...",
        description: "AI is analyzing trending Solana tokens via DexScreener",
      });

      // Manual AI bot trigger (standalone - no project ID)
      const response: any = await apiRequest("POST", `/api/ai-bot/execute`, {
        ownerWalletAddress: publicKey.toString(),
        signature: signatureBase58,
        message,
      });

      // Add backend scan logs to the frontend display
      if (response.logs && Array.isArray(response.logs)) {
        response.logs.forEach((log: any) => {
          addScanLog(log.message, log.type);
        });
      }

      addScanLog("✅ Market scan completed", "success");
      addScanLog(`ℹ️ Check Transactions page for trade details`, "info");

      queryClient.invalidateQueries({ queryKey: ["/api/ai-bot/config", publicKey.toString()] });
      queryClient.invalidateQueries({ queryKey: ["/api/ai-bot/positions", publicKey.toString()] });
      queryClient.invalidateQueries({ queryKey: ["/api/transactions"] });

      toast({
        title: "✅ Market Scan Complete",
        description: "See scan activity log for details",
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
          : "AI will scan market automatically based on your schedule",
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
        totalBudget: data.totalBudget,
        budgetPerTrade: data.budgetPerTrade,
        minVolumeUSD: data.minVolumeUSD,
        minPotentialPercent: data.minPotentialPercent,
        maxDailyTrades: parseInt(data.maxDailyTrades),
        profitTargetPercent: data.profitTargetPercent,
        minOrganicScore: parseInt(data.minOrganicScore),
        minQualityScore: parseInt(data.minQualityScore),
        minLiquidityUSD: data.minLiquidityUSD,
        minTransactions24h: parseInt(data.minTransactions24h),
        enableAiSellDecisions: data.enableAiSellDecisions,
        minAiSellConfidence: parseInt(data.minAiSellConfidence),
        holdIfHighConfidence: parseInt(data.holdIfHighConfidence),
        riskTolerance: data.riskTolerance,
        enabled: aiConfig?.enabled || false, // Preserve enabled state
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
        description: "Treasury key encrypted and stored securely for automated trading",
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
      // Parse the array input
      let parsedArray: number[];
      
      // Try to parse as JSON array
      try {
        parsedArray = JSON.parse(arrayKeyInput.trim());
      } catch {
        // If not valid JSON, throw error
        throw new Error("Invalid format. Please paste a valid number array like [123, 45, 67, ...]");
      }

      // Validate it's an array
      if (!Array.isArray(parsedArray)) {
        throw new Error("Input must be an array of numbers");
      }

      // Validate array length (Solana private keys are 64 bytes)
      if (parsedArray.length !== 64) {
        throw new Error(`Invalid key length: ${parsedArray.length} bytes (expected 64 bytes)`);
      }

      // Validate all elements are numbers
      if (!parsedArray.every(n => typeof n === 'number' && n >= 0 && n <= 255)) {
        throw new Error("Array must contain only numbers between 0 and 255");
      }

      // Convert to Uint8Array and then to base58
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
        description: error.message || "Failed to convert private key",
        variant: "destructive",
      });
    }
  };

  const handleCopyBase58 = () => {
    navigator.clipboard.writeText(convertedBase58);
    toast({
      title: "Copied!",
      description: "Base58 private key copied to clipboard",
    });
  };

  if (!connected) {
    return (
      <div className="container mx-auto py-8 px-4">
        <div className="flex flex-col items-center justify-center min-h-[60vh] text-center space-y-4">
          <Brain className="h-16 w-16 text-muted-foreground" />
          <h2 className="text-2xl font-bold">Connect Your Wallet</h2>
          <p className="text-muted-foreground max-w-md">
            Connect your Solana wallet to start AI-powered trading
          </p>
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="container mx-auto py-8 px-4">
        <div className="flex items-center justify-center min-h-[60vh]">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto py-8 px-4 space-y-6 max-w-4xl">
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-3">
          <Brain className="h-8 w-8 text-primary" />
          <div>
            <h1 className="text-3xl font-bold" data-testid="heading-ai-bot">AI Market Scanner</h1>
            <p className="text-muted-foreground">
              Powered by Groq Llama 3.3-70B + Jupiter Ultra API (100% Free)
            </p>
          </div>
        </div>

        <Alert>
          <Zap className="h-4 w-4" />
          <AlertTitle>Standalone AI Trading - No Projects Required</AlertTitle>
          <AlertDescription>
            This AI bot works <strong>independently</strong> without requiring any buyback/burn projects.
            <br />
            <strong>How it works:</strong> Scans trending Solana tokens from DexScreener → Groq AI analyzes volume, liquidity, momentum
            → Jupiter Ultra API executes swaps when confidence ≥ 60% and potential ≥ 150% (1.5X minimum)
          </AlertDescription>
        </Alert>
      </div>

      {/* Budget Overview */}
      {totalBudget > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              <span>Budget Status</span>
              <span className={`text-sm font-normal ${isEnabled ? 'text-green-500' : 'text-muted-foreground'}`}>
                {isEnabled ? '🟢 Auto Trading Active' : '⚫ Auto Trading Paused'}
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Used: {budgetUsed.toFixed(4)} SOL</span>
                <span className="text-muted-foreground">Total: {totalBudget.toFixed(4)} SOL</span>
              </div>
              <div className="h-2 bg-muted rounded-full overflow-hidden">
                <div 
                  className="h-full bg-primary transition-all"
                  style={{ width: `${Math.min(100, (budgetUsed / totalBudget) * 100)}%` }}
                />
              </div>
              <div className="flex justify-between text-xs">
                <span className="font-medium">Remaining: {remainingBudget.toFixed(4)} SOL</span>
                <span className="text-muted-foreground">{((budgetUsed / totalBudget) * 100).toFixed(1)}% used</span>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Private Key Management */}
      <Card>
        <CardHeader className="flex flex-row items-center gap-3 space-y-0 pb-4">
          <div className="flex items-center justify-center w-10 h-10 rounded-full bg-primary/10">
            <Shield className="h-5 w-5 text-primary" />
          </div>
          <div className="flex-1">
            <CardTitle>Automated Trading Key</CardTitle>
            <CardDescription>
              Required for automated AI bot execution
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          <Alert data-testid="alert-key-security">
            <Lock className="h-4 w-4" />
            <AlertDescription className="text-sm">
              <strong>Security:</strong> Your private key is encrypted using AES-256-GCM encryption before storage.
              Only you can access it with your wallet signature.
            </AlertDescription>
          </Alert>

          {aiConfig && (
            <div className="flex items-center gap-2 p-3 rounded-lg bg-muted/50">
              {aiConfig.treasuryKeyCiphertext ? (
                <CheckCircle className="h-4 w-4 text-green-500" />
              ) : (
                <AlertCircle className="h-4 w-4 text-amber-500" />
              )}
              <span className="text-sm" data-testid="text-treasury-key-status">
                Treasury Key: {aiConfig.treasuryKeyCiphertext ? "Configured ✅" : "Not configured ⚠️"}
              </span>
            </div>
          )}

          <div className="space-y-2">
            <label htmlFor="ai-treasury-key" className="text-sm font-medium">
              Treasury Wallet Private Key (Base58)
            </label>
            <div className="relative">
              <Input
                id="ai-treasury-key"
                type={showTreasuryKey ? "text" : "password"}
                value={treasuryKey}
                onChange={(e) => setTreasuryKey(e.target.value)}
                placeholder="Enter treasury wallet private key"
                className="font-mono pr-10"
                data-testid="input-ai-treasury-key"
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="absolute right-1 top-1/2 -translate-y-1/2"
                onClick={() => setShowTreasuryKey(!showTreasuryKey)}
                data-testid="button-toggle-ai-treasury-visibility"
              >
                {showTreasuryKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Required for automated AI trading execution. This wallet must hold SOL for trades.
            </p>
          </div>

          <div className="flex gap-3">
            <Button
              onClick={handleSaveTreasuryKey}
              disabled={isSavingKey || !treasuryKey.trim()}
              className="flex-1"
              data-testid="button-save-ai-treasury-key"
            >
              {isSavingKey ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Saving...
                </>
              ) : (
                <>
                  <Key className="h-4 w-4 mr-2" />
                  Save Private Key
                </>
              )}
            </Button>

            {aiConfig?.treasuryKeyCiphertext && (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="destructive" disabled={isDeletingKey} data-testid="button-delete-ai-treasury-key">
                    {isDeletingKey ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Deleting...
                      </>
                    ) : (
                      "Delete Key"
                    )}
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Delete Treasury Key?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This will remove the encrypted private key from secure storage.
                      Automated AI trading will stop until you add a new key.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={handleDeleteTreasuryKey}>
                      Delete
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Private Key Converter */}
      <Card>
        <CardHeader className="flex flex-row items-center gap-3 space-y-0 pb-4">
          <div className="flex items-center justify-center w-10 h-10 rounded-full bg-amber-500/10">
            <Key className="h-5 w-5 text-amber-500" />
          </div>
          <div className="flex-1">
            <CardTitle>Private Key Converter</CardTitle>
            <CardDescription>
              Convert your private key from array format to base58 format
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertDescription className="text-sm">
              Have your key in <code className="text-xs bg-muted px-1 py-0.5 rounded">[123, 45, 67, ...]</code> format? 
              Paste it below to convert to base58 format for the AI bot.
            </AlertDescription>
          </Alert>

          <div className="space-y-2">
            <label htmlFor="array-key-input" className="text-sm font-medium">
              Array Format Key
            </label>
            <textarea
              id="array-key-input"
              value={arrayKeyInput}
              onChange={(e) => setArrayKeyInput(e.target.value)}
              placeholder="[123, 45, 67, ...]"
              className="w-full min-h-[100px] p-3 text-sm font-mono rounded-md border bg-background resize-y"
              data-testid="textarea-array-key-input"
            />
            <p className="text-xs text-muted-foreground">
              Paste your private key in array format (64 numbers from 0-255)
            </p>
          </div>

          {conversionError && (
            <Alert variant="destructive">
              <XCircle className="h-4 w-4" />
              <AlertDescription>{conversionError}</AlertDescription>
            </Alert>
          )}

          {convertedBase58 && (
            <div className="space-y-2">
              <label className="text-sm font-medium text-green-500">
                ✅ Base58 Format (Ready to use)
              </label>
              <div className="relative">
                <div className="p-3 text-sm font-mono rounded-md border bg-muted break-all">
                  {convertedBase58}
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="absolute right-2 top-2"
                  onClick={handleCopyBase58}
                  data-testid="button-copy-base58"
                >
                  Copy
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Copy this and paste it in the "Treasury Wallet Private Key" field above
              </p>
            </div>
          )}

          <Button
            onClick={handleConvertArrayKey}
            disabled={!arrayKeyInput.trim()}
            className="w-full"
            data-testid="button-convert-key"
          >
            <Zap className="h-4 w-4 mr-2" />
            Convert to Base58
          </Button>
        </CardContent>
      </Card>

      {/* Controls */}
      <Card>
        <CardHeader>
          <CardTitle>Trading Controls</CardTitle>
          <CardDescription>Start auto trading or scan the market manually</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2">
            <Button
              onClick={handleToggleBot}
              variant={isEnabled ? "destructive" : "default"}
              className="flex-1"
              disabled={isToggling || !aiConfig}
              data-testid="button-toggle-auto-trading"
            >
              {isToggling ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  {isEnabled ? "Stopping..." : "Starting..."}
                </>
              ) : isEnabled ? (
                <>
                  <Power className="h-4 w-4 mr-2" />
                  Stop Auto Trading
                </>
              ) : (
                <>
                  <Play className="h-4 w-4 mr-2" />
                  Start Auto Trading
                </>
              )}
            </Button>
          </div>
          <Button
            variant="outline"
            className="w-full"
            onClick={handleScanAndTrade}
            disabled={isScanning || !publicKey || !aiConfig}
            data-testid="button-scan-now"
          >
            {isScanning ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Scanning Market...
              </>
            ) : (
              <>
                <Scan className="h-4 w-4 mr-2" />
                Scan & Trade Now
              </>
            )}
          </Button>
          <p className="text-xs text-muted-foreground text-center">
            Manual scans work independently of auto-trading status
          </p>
        </CardContent>
      </Card>

      {/* Active Positions */}
      {activePositions.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <TrendingUp className="h-5 w-5" />
              Active Positions ({activePositions.length})
            </CardTitle>
            <CardDescription>
              Positions being monitored for profit-taking (target: {aiConfig?.profitTargetPercent || "50"}%)
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {activePositions.map((position) => (
                <div
                  key={position.mint}
                  className="p-4 rounded-lg border bg-card hover-elevate"
                  data-testid={`position-${position.mint}`}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-2">
                        <Badge variant="outline" className="font-mono text-xs">
                          {position.mint.slice(0, 8)}...{position.mint.slice(-4)}
                        </Badge>
                        <Badge
                          variant={position.profitPercent >= 0 ? "default" : "destructive"}
                          className="ml-auto"
                        >
                          {position.profitPercent >= 0 ? "+" : ""}
                          {position.profitPercent.toFixed(2)}%
                        </Badge>
                      </div>
                      <div className="grid grid-cols-2 gap-4 text-sm">
                        <div>
                          <p className="text-muted-foreground">Entry Price</p>
                          <p className="font-medium">
                            {position.entryPriceSOL.toFixed(8)} SOL
                          </p>
                        </div>
                        <div>
                          <p className="text-muted-foreground">Current Price</p>
                          <p className="font-medium">
                            {position.currentPriceSOL > 0
                              ? `${position.currentPriceSOL.toFixed(8)} SOL`
                              : "Loading..."}
                          </p>
                        </div>
                        <div>
                          <p className="text-muted-foreground">Investment</p>
                          <p className="font-medium">{position.amountSOL.toFixed(4)} SOL</p>
                        </div>
                        <div>
                          <p className="text-muted-foreground">Est. Value</p>
                          <p className="font-medium">
                            {position.currentPriceSOL > 0
                              ? `${(position.amountSOL * (1 + position.profitPercent / 100)).toFixed(4)} SOL`
                              : "Loading..."}
                          </p>
                        </div>
                      </div>
                      <div className="mt-3">
                        <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
                          <span>Progress to Target ({aiConfig?.profitTargetPercent || "50"}%)</span>
                          <span>
                            {Math.min(
                              100,
                              (position.profitPercent / parseFloat(aiConfig?.profitTargetPercent || "50")) * 100
                            ).toFixed(0)}%
                          </span>
                        </div>
                        <Progress
                          value={Math.min(
                            100,
                            (position.profitPercent / parseFloat(aiConfig?.profitTargetPercent || "50")) * 100
                          )}
                          className="h-2"
                        />
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-4 p-3 bg-muted/50 rounded-lg">
              <p className="text-xs text-muted-foreground">
                💡 Positions will automatically sell when profit target is reached. Budget is recycled for new trades.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Scan Activity Log */}
      {(scanLog.length > 0 || isScanning) && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Activity className="h-5 w-5" />
              Scan Activity Log
            </CardTitle>
            <CardDescription>
              Real-time view of what the AI bot is scanning and analyzing
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-[300px] w-full rounded-md border p-4">
              <div className="space-y-2">
                {scanLog.length === 0 && isScanning ? (
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span>Initializing scan...</span>
                  </div>
                ) : (
                  scanLog.map((log, index) => (
                    <div key={index} className="flex items-start gap-2 text-sm">
                      {log.type === "success" ? (
                        <CheckCircle className="h-4 w-4 text-green-500 mt-0.5 flex-shrink-0" />
                      ) : log.type === "error" ? (
                        <XCircle className="h-4 w-4 text-red-500 mt-0.5 flex-shrink-0" />
                      ) : log.type === "warning" ? (
                        <AlertCircle className="h-4 w-4 text-yellow-500 mt-0.5 flex-shrink-0" />
                      ) : (
                        <Clock className="h-4 w-4 text-blue-500 mt-0.5 flex-shrink-0" />
                      )}
                      <div className="flex-1">
                        <span className={
                          log.type === "success" ? "text-green-600 dark:text-green-400" :
                          log.type === "error" ? "text-red-600 dark:text-red-400" :
                          log.type === "warning" ? "text-yellow-600 dark:text-yellow-400" :
                          "text-muted-foreground"
                        }>
                          {log.message}
                        </span>
                        <span className="text-xs text-muted-foreground ml-2">
                          {new Date(log.timestamp).toLocaleTimeString()}
                        </span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </ScrollArea>
            {scanLog.length > 0 && !isScanning && (
              <div className="mt-4 text-xs text-muted-foreground">
                💡 Tip: The backend analyzes 35+ tokens. Check server logs or Transactions page for full details.
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Configuration */}
      <Card>
        <CardHeader>
          <CardTitle>AI Bot Configuration</CardTitle>
          <CardDescription>Configure budget, risk tolerance, and trading criteria</CardDescription>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="totalBudget"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Total Budget (SOL)</FormLabel>
                      <FormControl>
                        <Input {...field} type="number" step="0.01" placeholder="1.0" data-testid="input-total-budget" />
                      </FormControl>
                      <FormDescription>Maximum SOL to spend on AI trades</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="budgetPerTrade"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Budget Per Trade (SOL)</FormLabel>
                      <FormControl>
                        <Input {...field} type="number" step="0.01" placeholder="0.1" data-testid="input-budget-per-trade" />
                      </FormControl>
                      <FormDescription>SOL amount for each trade</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="minVolumeUSD"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Min Volume (USD)</FormLabel>
                      <FormControl>
                        <Input {...field} type="number" step="1000" placeholder="5000" data-testid="input-min-volume" />
                      </FormControl>
                      <FormDescription>Only scan tokens with this 24h volume</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="minPotentialPercent"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Min Potential Return (%)</FormLabel>
                      <FormControl>
                        <Input {...field} type="number" step="10" placeholder="150" data-testid="input-min-potential" />
                      </FormControl>
                      <FormDescription>Minimum 150% (1.5X) enforced</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="maxDailyTrades"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Max Daily Trades</FormLabel>
                      <FormControl>
                        <Input {...field} type="number" placeholder="5" data-testid="input-max-daily-trades" />
                      </FormControl>
                      <FormDescription>Limit trades per day</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="profitTargetPercent"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Profit Target (%)</FormLabel>
                      <FormControl>
                        <Input {...field} type="number" step="10" placeholder="50" data-testid="input-profit-target" />
                      </FormControl>
                      <FormDescription>Auto-sell when profit reaches this %</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="riskTolerance"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Risk Tolerance</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl>
                          <SelectTrigger data-testid="select-risk-tolerance">
                            <SelectValue placeholder="Select risk level" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="low">Low</SelectItem>
                          <SelectItem value="medium">Medium</SelectItem>
                          <SelectItem value="high">High</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormDescription>Affects AI's trading decisions</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              {/* Advanced Filters - Collapsible Section */}
              <Collapsible className="border rounded-md">
                <CollapsibleTrigger className="flex items-center justify-between w-full p-4 hover-elevate active-elevate-2" data-testid="button-toggle-advanced-filters">
                  <div className="flex items-center gap-2">
                    <Shield className="h-4 w-4 text-primary" />
                    <span className="font-medium">Advanced Organic Volume Filters</span>
                  </div>
                  <ChevronDown className="h-4 w-4 transition-transform" />
                </CollapsibleTrigger>
                <CollapsibleContent className="px-4 pb-4">
                  <div className="pt-4 space-y-4 border-t">
                    <p className="text-sm text-muted-foreground mb-4">
                      Configure advanced filters to detect organic volume and filter out wash trading. Lower scores = stricter filtering.
                    </p>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <FormField
                        control={form.control}
                        name="minOrganicScore"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Min Organic Score (0-100)</FormLabel>
                            <FormControl>
                              <Input {...field} type="number" placeholder="40" data-testid="input-min-organic-score" />
                            </FormControl>
                            <FormDescription>Filters wash trading based on volume patterns</FormDescription>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={form.control}
                        name="minQualityScore"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Min Quality Score (0-100)</FormLabel>
                            <FormControl>
                              <Input {...field} type="number" placeholder="30" data-testid="input-min-quality-score" />
                            </FormControl>
                            <FormDescription>Overall token quality (volume + liquidity + momentum)</FormDescription>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={form.control}
                        name="minLiquidityUSD"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Min Liquidity (USD)</FormLabel>
                            <FormControl>
                              <Input {...field} type="number" step="1000" placeholder="5000" data-testid="input-min-liquidity" />
                            </FormControl>
                            <FormDescription>Minimum pool liquidity (prevents low-liquidity traps)</FormDescription>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={form.control}
                        name="minTransactions24h"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Min Transactions (24h)</FormLabel>
                            <FormControl>
                              <Input {...field} type="number" placeholder="20" data-testid="input-min-transactions" />
                            </FormControl>
                            <FormDescription>Minimum trading activity (buy + sell count)</FormDescription>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>
                  </div>
                </CollapsibleContent>
              </Collapsible>

              {/* AI Sell Decisions - Collapsible Section */}
              <Collapsible className="border rounded-md">
                <CollapsibleTrigger className="flex items-center justify-between w-full p-4 hover-elevate active-elevate-2" data-testid="button-toggle-ai-sell-decisions">
                  <div className="flex items-center gap-2">
                    <Brain className="h-4 w-4 text-primary" />
                    <span className="font-medium">AI-Powered Sell Decisions</span>
                  </div>
                  <ChevronDown className="h-4 w-4 transition-transform" />
                </CollapsibleTrigger>
                <CollapsibleContent className="px-4 pb-4">
                  <div className="pt-4 space-y-4 border-t">
                    <p className="text-sm text-muted-foreground mb-4">
                      Let AI decide when to sell positions based on market analysis. AI re-analyzes held positions and can hold winners longer when confidence is high.
                    </p>
                    
                    <FormField
                      control={form.control}
                      name="enableAiSellDecisions"
                      render={({ field }) => (
                        <FormItem className="flex flex-row items-center justify-between p-3 border rounded-md">
                          <div className="space-y-0.5">
                            <FormLabel>Enable AI Sell Decisions</FormLabel>
                            <FormDescription>
                              Let AI analyze positions and decide optimal sell timing
                            </FormDescription>
                          </div>
                          <FormControl>
                            <Switch
                              checked={field.value}
                              onCheckedChange={field.onChange}
                              data-testid="switch-enable-ai-sell"
                            />
                          </FormControl>
                        </FormItem>
                      )}
                    />

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <FormField
                        control={form.control}
                        name="minAiSellConfidence"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Min AI Sell Confidence (0-100)</FormLabel>
                            <FormControl>
                              <Input {...field} type="number" placeholder="40" data-testid="input-min-ai-sell-confidence" />
                            </FormControl>
                            <FormDescription>Sell if AI confidence drops below this %</FormDescription>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={form.control}
                        name="holdIfHighConfidence"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Hold If High Confidence (0-100)</FormLabel>
                            <FormControl>
                              <Input {...field} type="number" placeholder="70" data-testid="input-hold-if-high-confidence" />
                            </FormControl>
                            <FormDescription>Hold beyond profit target if AI confidence ≥ this %</FormDescription>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>

                    <Alert>
                      <Brain className="h-4 w-4" />
                      <AlertTitle>How AI Sell Decisions Work</AlertTitle>
                      <AlertDescription>
                        <strong>AI re-analyzes</strong> every held position to assess current market conditions. It will:
                        <br />
                        • <strong>SELL</strong> if confidence drops below {form.watch("minAiSellConfidence") || "40"}% (weakening momentum)
                        <br />
                        • <strong>HOLD</strong> if confidence ≥ {form.watch("holdIfHighConfidence") || "70"}% even when profit target is reached
                        <br />
                        • <strong>SELL</strong> at profit target if confidence is between these thresholds
                        <br /><br />
                        This allows the bot to ride winners longer while cutting losers early.
                      </AlertDescription>
                    </Alert>
                  </div>
                </CollapsibleContent>
              </Collapsible>

              <Button type="submit" className="w-full" disabled={isSaving} data-testid="button-save-config">
                {isSaving ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Saving...
                  </>
                ) : (
                  "Save Configuration"
                )}
              </Button>
            </form>
          </Form>
        </CardContent>
      </Card>

      {/* Info */}
      <Alert>
        <TrendingUp className="h-4 w-4" />
        <AlertTitle>Trading Strategy & Safety</AlertTitle>
        <AlertDescription>
          The bot uses <strong>Jupiter Ultra API</strong> for all swaps (better routing & pricing).
          Trades are only executed when AI confidence ≥ 60% AND potential return ≥ {form.watch("minPotentialPercent") || "150"}%.
          <br /><br />
          <strong>Safety Features:</strong>
          <br />
          • Always keeps <strong>0.01 SOL reserve</strong> for transaction fees
          <br />
          • Won't trade if budget - used &lt; (trade amount + 0.01 SOL)
          <br />
          • All transactions appear on the Transactions page
        </AlertDescription>
      </Alert>
    </div>
  );
}
