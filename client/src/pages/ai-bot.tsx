import { useQuery, useMutation } from "@tanstack/react-query";
import { useWallet } from "@solana/wallet-adapter-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Brain, Loader2, Settings2, Zap, AlertCircle, Play, Power } from "lucide-react";
import { Link } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import type { Project } from "@shared/schema";

const aiBotConfigSchema = z.object({
  aiBotEnabled: z.boolean(),
  aiBotTotalBudget: z.string().min(1, "Total budget is required").refine(
    (val) => !isNaN(parseFloat(val)) && parseFloat(val) > 0,
    "Must be a positive number"
  ),
  aiBotBudgetPerTrade: z.string().min(1, "Budget is required").refine(
    (val) => !isNaN(parseFloat(val)) && parseFloat(val) > 0,
    "Must be a positive number"
  ),
  aiBotAnalysisInterval: z.number().min(5, "Minimum 5 minutes").max(1440, "Max 1440 minutes (24 hours)"),
  aiBotMinVolumeUSD: z.string().min(1, "Volume threshold is required").refine(
    (val) => !isNaN(parseFloat(val)) && parseFloat(val) >= 0,
    "Must be a positive number"
  ),
  aiBotMinPotentialPercent: z.string().min(1, "Potential threshold is required").refine(
    (val) => !isNaN(parseFloat(val)) && parseFloat(val) >= 150,
    "Must be at least 150% (1.5X minimum returns)"
  ),
  aiBotMaxDailyTrades: z.number().min(1, "Must be at least 1").max(100, "Max 100 trades per day"),
  aiBotRiskTolerance: z.enum(["low", "medium", "high"]),
});

type AIBotConfigFormData = z.infer<typeof aiBotConfigSchema>;

function AIBotConfigDialog({ project }: { project: Project }) {
  const [open, setOpen] = useState(false);
  const { toast } = useToast();
  const { publicKey } = useWallet();

  const form = useForm<AIBotConfigFormData>({
    resolver: zodResolver(aiBotConfigSchema),
    defaultValues: {
      aiBotEnabled: project.aiBotEnabled || false,
      aiBotTotalBudget: project.aiBotTotalBudget || "1.0",
      aiBotBudgetPerTrade: project.aiBotBudgetPerTrade || "0.1",
      aiBotAnalysisInterval: project.aiBotAnalysisInterval || 30,
      aiBotMinVolumeUSD: project.aiBotMinVolumeUSD || "5000",
      aiBotMinPotentialPercent: project.aiBotMinPotentialPercent || "150",
      aiBotMaxDailyTrades: project.aiBotMaxDailyTrades || 5,
      aiBotRiskTolerance: (project.aiBotRiskTolerance as "low" | "medium" | "high") || "medium",
    },
  });

  const updateMutation = useMutation({
    mutationFn: async (data: AIBotConfigFormData) => {
      return await apiRequest("PATCH", `/api/projects/${project.id}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects/owner", publicKey?.toString()] });
      toast({
        title: "Configuration saved",
        description: "AI bot settings have been updated successfully.",
      });
      setOpen(false);
    },
    onError: (error: Error) => {
      toast({
        title: "Configuration failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const onSubmit = (data: AIBotConfigFormData) => {
    updateMutation.mutate(data);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="w-full" data-testid={`button-configure-ai-${project.id}`}>
          <Settings2 className="h-4 w-4 mr-2" />
          {project.aiBotEnabled ? "Configure" : "Enable & Configure"}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>AI Trading Bot Configuration</DialogTitle>
          <DialogDescription>
            Configure AI-powered trading analysis and automation for {project.name}
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
            <FormField
              control={form.control}
              name="aiBotEnabled"
              render={({ field }) => (
                <FormItem className="flex items-center justify-between rounded-lg border p-4">
                  <div className="space-y-0.5">
                    <FormLabel className="text-base">Enable AI Bot</FormLabel>
                    <FormDescription>
                      Start AI-powered token analysis and automated trading
                    </FormDescription>
                  </div>
                  <FormControl>
                    <Switch
                      checked={field.value}
                      onCheckedChange={field.onChange}
                      data-testid="switch-ai-bot-enabled"
                    />
                  </FormControl>
                </FormItem>
              )}
            />

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="aiBotTotalBudget"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Total Budget (SOL)</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        type="text"
                        placeholder="1.0"
                        data-testid="input-ai-total-budget"
                      />
                    </FormControl>
                    <FormDescription>Total SOL allocated for AI trading</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="aiBotBudgetPerTrade"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Budget Per Trade (SOL)</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        type="text"
                        placeholder="0.1"
                        data-testid="input-ai-budget"
                      />
                    </FormControl>
                    <FormDescription>SOL amount per AI trade</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="aiBotAnalysisInterval"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Analysis Interval (minutes)</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        type="number"
                        min={5}
                        max={1440}
                        onChange={(e) => field.onChange(parseInt(e.target.value) || 0)}
                        data-testid="input-ai-interval"
                      />
                    </FormControl>
                    <FormDescription>How often to analyze tokens</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="aiBotMinVolumeUSD"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Min Volume (USD)</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        type="text"
                        placeholder="5000"
                        data-testid="input-ai-min-volume"
                      />
                    </FormControl>
                    <FormDescription>Minimum 24h trading volume</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="aiBotMinPotentialPercent"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Min Potential (% - Min 150%)</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        type="text"
                        placeholder="150"
                        data-testid="input-ai-min-potential"
                      />
                    </FormControl>
                    <FormDescription>Minimum 1.5X (150%) upside required</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="aiBotMaxDailyTrades"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Max Daily Trades</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        type="number"
                        min={1}
                        max={100}
                        onChange={(e) => field.onChange(parseInt(e.target.value) || 0)}
                        data-testid="input-ai-max-trades"
                      />
                    </FormControl>
                    <FormDescription>Maximum trades per day</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="aiBotRiskTolerance"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Risk Tolerance</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl>
                        <SelectTrigger data-testid="select-ai-risk">
                          <SelectValue placeholder="Select risk level" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="low">Low - Conservative</SelectItem>
                        <SelectItem value="medium">Medium - Balanced</SelectItem>
                        <SelectItem value="high">High - Aggressive</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormDescription>AI trading risk level</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <Alert>
              <Brain className="h-4 w-4" />
              <AlertTitle>Risk Management & Budget Protection</AlertTitle>
              <AlertDescription>
                • Enforces minimum 1.5X (150%) return requirement on all trades
                <br />
                • Tracks total budget usage to prevent overspending
                <br />
                • Only executes when AI confidence ≥ 60%
                <br />
                • Uses free Groq AI (Llama 3.3-70B) + DexScreener data
              </AlertDescription>
            </Alert>

            <div className="flex gap-2">
              <Button
                type="submit"
                disabled={updateMutation.isPending}
                className="flex-1"
                data-testid="button-save-ai-config"
              >
                {updateMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Save Configuration
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => setOpen(false)}
                data-testid="button-cancel-ai-config"
              >
                Cancel
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

export default function AIBot() {
  const { publicKey, connected } = useWallet();
  const { data: projects, isLoading } = useQuery<Project[]>({
    queryKey: ["/api/projects/owner", publicKey?.toString()],
    enabled: connected && !!publicKey,
  });

  if (!connected) {
    return (
      <div className="container mx-auto py-8 px-4">
        <div className="flex flex-col items-center justify-center min-h-[60vh] text-center space-y-4">
          <Brain className="h-16 w-16 text-muted-foreground" />
          <h2 className="text-2xl font-bold">Connect Your Wallet</h2>
          <p className="text-muted-foreground max-w-md">
            Please connect your Solana wallet to configure AI trading bots
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
    <div className="container mx-auto py-8 px-4 space-y-8">
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-3">
          <Brain className="h-8 w-8 text-primary" />
          <div>
            <h1 className="text-3xl font-bold" data-testid="heading-ai-bot">AI Trading Bot</h1>
            <p className="text-muted-foreground">
              AI-powered token analysis with Groq Llama 3.3-70B (Free)
            </p>
          </div>
        </div>

        <Alert>
          <Zap className="h-4 w-4" />
          <AlertTitle>100% Free AI Analysis</AlertTitle>
          <AlertDescription>
            The AI bot uses completely free services: Groq AI (Llama 3.3-70B) for analysis and DexScreener for market data.
            It analyzes trending Solana tokens and executes trades based on AI recommendations.
          </AlertDescription>
        </Alert>

        <Alert variant="default">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>How It Works</AlertTitle>
          <AlertDescription>
            1. DexScreener fetches trending tokens (top 50 by volume)
            <br />
            2. Filters by your minimum volume threshold
            <br />
            3. Groq AI analyzes each token (volume, liquidity, risk, potential)
            <br />
            4. Executes trades when confidence ≥ 60% and potential meets your threshold
            <br />
            5. Records transactions and respects daily trade limits
          </AlertDescription>
        </Alert>
      </div>

      {!projects || projects.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 text-center space-y-4">
            <Brain className="h-12 w-12 text-muted-foreground" />
            <div className="space-y-2">
              <h3 className="text-xl font-semibold">No Projects Yet</h3>
              <p className="text-muted-foreground max-w-md">
                Create your first project to start using AI-powered trading automation
              </p>
            </div>
            <Button asChild data-testid="button-create-first-project">
              <Link href="/dashboard/new">Create Project</Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {projects.map((project) => (
            <Card key={project.id} data-testid={`card-project-${project.id}`}>
              <CardHeader>
                <CardTitle className="flex items-center justify-between">
                  <span className="truncate">{project.name}</span>
                  <span className={`text-xs px-2 py-1 rounded-full ${
                    project.aiBotEnabled 
                      ? 'bg-green-500/20 text-green-500' 
                      : 'bg-muted text-muted-foreground'
                  }`}>
                    {project.aiBotEnabled ? 'Active' : 'Inactive'}
                  </span>
                </CardTitle>
                <CardDescription className="truncate" data-testid={`text-symbol-${project.id}`}>
                  {project.tokenMintAddress.substring(0, 8)}...
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {project.aiBotEnabled && (
                  <div className="space-y-3">
                    <div className="space-y-2 text-sm p-3 rounded-lg bg-muted/50">
                      <div className="flex justify-between items-center">
                        <span className="text-muted-foreground">Budget:</span>
                        <span className="font-medium">
                          {parseFloat(project.aiBotBudgetUsed || "0").toFixed(4)} / {parseFloat(project.aiBotTotalBudget || "0").toFixed(4)} SOL
                        </span>
                      </div>
                      <div className="h-2 bg-background rounded-full overflow-hidden">
                        <div 
                          className="h-full bg-primary transition-all"
                          style={{ 
                            width: `${Math.min(100, (parseFloat(project.aiBotBudgetUsed || "0") / parseFloat(project.aiBotTotalBudget || "1")) * 100)}%` 
                          }}
                        />
                      </div>
                      <div className="flex justify-between text-xs">
                        <span className="text-muted-foreground">
                          Remaining: {(parseFloat(project.aiBotTotalBudget || "0") - parseFloat(project.aiBotBudgetUsed || "0")).toFixed(4)} SOL
                        </span>
                        <span className="text-muted-foreground">
                          {((parseFloat(project.aiBotBudgetUsed || "0") / parseFloat(project.aiBotTotalBudget || "1")) * 100).toFixed(1)}% used
                        </span>
                      </div>
                    </div>
                    <div className="space-y-2 text-sm">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Per Trade:</span>
                        <span className="font-medium">{project.aiBotBudgetPerTrade} SOL</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Min Volume:</span>
                        <span className="font-medium">${parseFloat(project.aiBotMinVolumeUSD || "0").toLocaleString()}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Min Return:</span>
                        <span className="font-medium">{project.aiBotMinPotentialPercent}% (≥150%)</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Daily Limit:</span>
                        <span className="font-medium">{project.aiBotMaxDailyTrades} trades</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Risk:</span>
                        <span className="font-medium capitalize">{project.aiBotRiskTolerance}</span>
                      </div>
                    </div>
                  </div>
                )}
                
                <div className="flex gap-2">
                  {project.aiBotEnabled ? (
                    <Button
                      variant="destructive"
                      className="flex-1"
                      onClick={async () => {
                        try {
                          await apiRequest("PATCH", `/api/projects/${project.id}`, {
                            aiBotEnabled: false,
                          });
                          queryClient.invalidateQueries({ queryKey: ["/api/projects"] });
                          toast({
                            title: "AI Bot Stopped",
                            description: "AI trading bot has been disabled",
                          });
                        } catch (error) {
                          toast({
                            title: "Error",
                            description: "Failed to stop AI bot",
                            variant: "destructive",
                          });
                        }
                      }}
                      data-testid={`button-stop-ai-bot-${project.id}`}
                    >
                      <Power className="h-4 w-4 mr-2" />
                      Stop AI Bot
                    </Button>
                  ) : (
                    <Button
                      variant="default"
                      className="flex-1"
                      onClick={async () => {
                        try {
                          await apiRequest("PATCH", `/api/projects/${project.id}`, {
                            aiBotEnabled: true,
                          });
                          queryClient.invalidateQueries({ queryKey: ["/api/projects"] });
                          toast({
                            title: "AI Bot Started",
                            description: "AI trading bot is now active",
                          });
                        } catch (error) {
                          toast({
                            title: "Error",
                            description: "Failed to start AI bot",
                            variant: "destructive",
                          });
                        }
                      }}
                      data-testid={`button-start-ai-bot-${project.id}`}
                    >
                      <Play className="h-4 w-4 mr-2" />
                      Start AI Bot
                    </Button>
                  )}
                  <AIBotConfigDialog project={project} />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
