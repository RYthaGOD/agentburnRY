import { useQuery } from "@tanstack/react-query";
import { useWallet } from "@solana/wallet-adapter-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Brain, Loader2, Zap, AlertCircle, Play, Power, Scan, TrendingUp } from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import type { Project } from "@shared/schema";
import bs58 from "bs58";

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
  riskTolerance: z.enum(["low", "medium", "high"]),
});

type AIBotConfigFormData = z.infer<typeof aiBotConfigSchema>;

export default function AIBot() {
  const { publicKey, connected, signMessage } = useWallet();
  const { toast } = useToast();
  const [isScanning, setIsScanning] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  
  const { data: projects, isLoading } = useQuery<Project[]>({
    queryKey: ["/api/projects/owner", publicKey?.toString()],
    enabled: connected && !!publicKey,
  });

  // Use first project as AI bot configuration storage
  const aiProject = projects?.[0];
  const isEnabled = aiProject?.aiBotEnabled || false;
  const budgetUsed = parseFloat(aiProject?.aiBotBudgetUsed || "0");
  const totalBudget = parseFloat(aiProject?.aiBotTotalBudget || "0");
  const remainingBudget = totalBudget - budgetUsed;

  const form = useForm<AIBotConfigFormData>({
    resolver: zodResolver(aiBotConfigSchema),
    defaultValues: {
      totalBudget: aiProject?.aiBotTotalBudget || "1.0",
      budgetPerTrade: aiProject?.aiBotBudgetPerTrade || "0.1",
      minVolumeUSD: aiProject?.aiBotMinVolumeUSD || "5000",
      minPotentialPercent: aiProject?.aiBotMinPotentialPercent || "150",
      maxDailyTrades: aiProject?.aiBotMaxDailyTrades?.toString() || "5",
      riskTolerance: (aiProject?.aiBotRiskTolerance as "low" | "medium" | "high") || "medium",
    },
  });

  const handleScanAndTrade = async () => {
    if (!publicKey || !signMessage || !aiProject) {
      toast({
        title: "Error",
        description: "Please connect wallet and configure settings first",
        variant: "destructive",
      });
      return;
    }

    setIsScanning(true);
    try {
      const message = `Execute AI bot for project ${aiProject.id} at ${Date.now()}`;
      const messageBytes = new TextEncoder().encode(message);
      const signature = await signMessage(messageBytes);
      const signatureBase58 = bs58.encode(signature);

      toast({
        title: "🔍 Scanning Market...",
        description: "AI is analyzing trending Solana tokens via DexScreener",
      });

      await apiRequest("POST", `/api/execute-ai-bot/${aiProject.id}`, {
        ownerWalletAddress: publicKey.toString(),
        signature: signatureBase58,
        message,
      });

      queryClient.invalidateQueries({ queryKey: ["/api/projects"] });
      queryClient.invalidateQueries({ queryKey: ["/api/transactions"] });

      toast({
        title: "✅ Market Scan Complete",
        description: "Check Transactions page for any trades executed",
      });
    } catch (error: any) {
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
    if (!aiProject) return;
    
    try {
      await apiRequest("PATCH", `/api/projects/${aiProject.id}`, {
        aiBotEnabled: !isEnabled,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/projects"] });
      toast({
        title: isEnabled ? "Auto Trading Stopped" : "Auto Trading Started",
        description: isEnabled 
          ? "Scheduled scans disabled. You can still scan manually." 
          : "AI will scan market on schedule",
      });
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to toggle AI bot",
        variant: "destructive",
      });
    }
  };

  const onSubmit = async (data: AIBotConfigFormData) => {
    if (!aiProject) return;
    
    setIsSaving(true);
    try {
      await apiRequest("PATCH", `/api/projects/${aiProject.id}`, {
        aiBotTotalBudget: data.totalBudget,
        aiBotBudgetPerTrade: data.budgetPerTrade,
        aiBotMinVolumeUSD: data.minVolumeUSD,
        aiBotMinPotentialPercent: data.minPotentialPercent,
        aiBotMaxDailyTrades: parseInt(data.maxDailyTrades),
        aiBotRiskTolerance: data.riskTolerance,
      });
      
      queryClient.invalidateQueries({ queryKey: ["/api/projects"] });
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

  if (!aiProject) {
    return (
      <div className="container mx-auto py-8 px-4">
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>No Project Found</AlertTitle>
          <AlertDescription>
            You need at least one project to use the AI trading bot. The bot will use your project's wallet for trading.
          </AlertDescription>
        </Alert>
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
          <AlertTitle>How It Works</AlertTitle>
          <AlertDescription>
            <strong>Scans trending Solana tokens from DexScreener</strong> → Groq AI analyzes volume, liquidity, momentum
            → <strong>Jupiter Ultra API executes swaps</strong> when confidence ≥ 60% and potential ≥ 150% (1.5X minimum)
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
              data-testid="button-toggle-auto-trading"
            >
              {isEnabled ? (
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
            disabled={isScanning || !publicKey}
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
