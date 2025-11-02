import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Coins, Zap, TrendingUp, DollarSign, Flame, Activity, PlayCircle, Loader2, Brain, CreditCard, ArrowLeftRight, Shield, ExternalLink } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useState, useEffect } from "react";

export default function AgenticBurnPage() {
  // Mock wallet for demo - in production this would come from user's connected wallet
  const demoWallet = "HYsXrquHabqWWdh35aGTQ4xWGV4eA4kUJ7PZZj9RCTVV";
  const { toast } = useToast();
  const [testResult, setTestResult] = useState<any>(null);
  
  // User inputs for burn configuration
  const [tokenMint, setTokenMint] = useState("So11111111111111111111111111111111111111112");
  const [burnAmount, setBurnAmount] = useState("0.01");
  
  // AI Decision Criteria (user-configurable)
  const [confidenceThreshold, setConfidenceThreshold] = useState(70);
  const [maxBurnPercentage, setMaxBurnPercentage] = useState(5);
  const [requirePositiveSentiment, setRequirePositiveSentiment] = useState(true);

  // Fetch cumulative agentic burn stats
  const { data: agenticStats, isLoading: statsLoading, refetch: refetchStats } = useQuery<any>({
    queryKey: [`/api/agentic-burn/stats/${demoWallet}`],
    enabled: !!demoWallet,
  });

  // Fetch x402 payment stats
  const { data: x402Stats, isLoading: x402Loading, refetch: refetchX402 } = useQuery<any>({
    queryKey: [`/api/x402/stats/${demoWallet}`],
    enabled: !!demoWallet,
  });

  // Fetch BAM bundle stats
  const { data: bamStats, isLoading: bamLoading, refetch: refetchBam } = useQuery<any>({
    queryKey: [`/api/bam/stats/${demoWallet}`],
    enabled: !!demoWallet,
  });

  // Test agentic burn mutation
  const testBurnMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch("/api/agentic-burn/demo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tokenMint: tokenMint,
          burnAmountSOL: parseFloat(burnAmount),
          criteria: {
            confidenceThreshold,
            maxBurnPercentage,
            requirePositiveSentiment,
          },
        }),
      });
      return response.json();
    },
    onSuccess: (response: any) => {
      setTestResult(response);
      if (response.success) {
        toast({
          title: "✅ Agentic Burn Success!",
          description: `x402 payment processed and BAM bundle created. Payment ID: ${response.data?.paymentId?.substring(0, 8)}...`,
        });
        // Refresh all stats
        refetchStats();
        refetchX402();
        refetchBam();
      } else {
        toast({
          title: "⚠️ Agentic Burn Failed",
          description: response.error || "Unknown error occurred",
          variant: "destructive",
        });
      }
    },
    onError: (error: any) => {
      toast({
        title: "❌ Error",
        description: error.message || "Failed to execute agentic burn",
        variant: "destructive",
      });
    },
  });

  return (
    <div className="container mx-auto p-6 space-y-8" data-testid="page-agentic-burn">
      {/* Header */}
      <div className="space-y-4">
        <div className="space-y-2">
          <h1 className="text-4xl font-bold tracking-tight" data-testid="text-page-title">
            Agentic Buy & Burn
          </h1>
          <p className="text-muted-foreground" data-testid="text-page-description">
            AI-powered token burns with x402 micropayments and Jito BAM atomic execution
          </p>
        </div>

        {/* Workflow Breakdown */}
        <Card data-testid="card-workflow">
          <CardHeader>
            <CardTitle className="text-lg">How It Works - Complete Workflow</CardTitle>
            <CardDescription>
              4-step process combining AI, micropayments, and atomic execution
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 md:grid-cols-4">
              <div className="space-y-2 p-3 rounded-lg bg-muted/50">
                <div className="flex items-center gap-2">
                  <Brain className="w-5 h-5 text-primary" />
                  <p className="text-sm font-semibold">DeepSeek AI</p>
                </div>
                <p className="text-xs text-muted-foreground">
                  AI agent analyzes and approves the burn request
                </p>
              </div>

              <div className="space-y-2 p-3 rounded-lg bg-muted/50">
                <div className="flex items-center gap-2">
                  <CreditCard className="w-5 h-5 text-primary" />
                  <p className="text-sm font-semibold">x402 Payment</p>
                </div>
                <p className="text-xs text-muted-foreground">
                  GigaBrain pays BurnBot via HTTP 402 micropayment
                </p>
              </div>

              <div className="space-y-2 p-3 rounded-lg bg-muted/50">
                <div className="flex items-center gap-2">
                  <ArrowLeftRight className="w-5 h-5 text-primary" />
                  <p className="text-sm font-semibold">Jupiter Swap</p>
                </div>
                <p className="text-xs text-muted-foreground">
                  Buy tokens using Jupiter aggregator
                </p>
              </div>

              <div className="space-y-2 p-3 rounded-lg bg-muted/50">
                <div className="flex items-center gap-2">
                  <Shield className="w-5 h-5 text-primary" />
                  <p className="text-sm font-semibold">Jito BAM</p>
                </div>
                <p className="text-xs text-muted-foreground">
                  Atomic burn bundle with MEV protection
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Demo Test Button for Hackathon */}
        <Card className="bg-gradient-to-r from-primary/10 to-purple-500/10 border-primary/20" data-testid="card-demo">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <PlayCircle className="h-5 w-5 text-primary" />
              Hackathon Demo - Test Agentic Burn
            </CardTitle>
            <CardDescription>
              Configure your burn parameters and test the complete x402 + BAM flow
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* AI Decision Criteria Configuration */}
            <div className="space-y-3 p-4 rounded-lg bg-muted/50 border border-primary/20">
              <div className="flex items-center gap-2">
                <Brain className="w-4 h-4 text-primary" />
                <h3 className="font-semibold text-sm">AI Decision Criteria</h3>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="confidence-threshold">Minimum AI Confidence (%)</Label>
                  <Input
                    id="confidence-threshold"
                    type="number"
                    min="0"
                    max="100"
                    value={confidenceThreshold}
                    onChange={(e) => setConfidenceThreshold(parseInt(e.target.value) || 70)}
                    data-testid="input-confidence-threshold"
                  />
                  <p className="text-xs text-muted-foreground">
                    Minimum AI confidence required to approve burn (0-100)
                  </p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="max-burn-percent">Max Burn % of Supply</Label>
                  <Input
                    id="max-burn-percent"
                    type="number"
                    step="0.1"
                    min="0"
                    max="100"
                    value={maxBurnPercentage}
                    onChange={(e) => setMaxBurnPercentage(parseFloat(e.target.value) || 5)}
                    data-testid="input-max-burn-percentage"
                  />
                  <p className="text-xs text-muted-foreground">
                    Maximum % of token supply that can be burned
                  </p>
                </div>
              </div>
            </div>

            <Separator />

            {/* Token Configuration Inputs */}
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="token-mint" data-testid="label-token-mint">Token Mint Address</Label>
                <Input
                  id="token-mint"
                  value={tokenMint}
                  onChange={(e) => setTokenMint(e.target.value)}
                  placeholder="Enter Solana token mint address"
                  className="font-mono text-sm"
                  data-testid="input-token-mint"
                />
                <p className="text-xs text-muted-foreground">
                  Default: Wrapped SOL (wSOL)
                </p>
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="burn-amount" data-testid="label-burn-amount">Burn Amount (SOL)</Label>
                <Input
                  id="burn-amount"
                  type="number"
                  step="0.001"
                  min="0"
                  value={burnAmount}
                  onChange={(e) => setBurnAmount(e.target.value)}
                  placeholder="0.01"
                  data-testid="input-burn-amount"
                />
                <p className="text-xs text-muted-foreground">
                  Amount of SOL to use for buying tokens
                </p>
              </div>
            </div>

            <Separator />
            
            <Button
              onClick={() => testBurnMutation.mutate()}
              disabled={testBurnMutation.isPending || !tokenMint || !burnAmount}
              size="lg"
              className="w-full"
              data-testid="button-test-burn"
            >
              {testBurnMutation.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Processing x402 Payment + BAM Bundle...
                </>
              ) : (
                <>
                  <PlayCircle className="mr-2 h-4 w-4" />
                  Run Demo Transaction
                </>
              )}
            </Button>

            {testResult && (
              <div className="p-4 rounded-lg bg-muted space-y-3" data-testid="div-test-result">
                <div className="flex items-center justify-between">
                  <p className="font-medium text-lg">
                    {testResult.success ? "✅ Demo Successful!" : "⚠️ Demo Failed"}
                  </p>
                  {testResult.success && (
                    <Badge variant="outline" className="text-xs">
                      Devnet Demo
                    </Badge>
                  )}
                </div>
                {testResult.success && (
                  <p className="text-xs text-muted-foreground">
                    📝 Note: Click the <ExternalLink className="w-3 h-3 inline" /> icons to verify transactions on Solscan (devnet)
                  </p>
                )}
                
                {testResult.success && testResult.data ? (
                  <div className="space-y-3">
                    {/* AI Decision Section */}
                    {testResult.data.aiConfidence !== undefined && (
                      <div className="space-y-1 border-l-2 border-blue-500 pl-3">
                        <div className="flex items-center gap-2">
                          <Brain className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                          <p className="text-sm font-semibold text-blue-600 dark:text-blue-400">DeepSeek AI Decision</p>
                        </div>
                        <p className="text-xs">Confidence: {testResult.data.aiConfidence}%</p>
                        {testResult.data.aiReasoning && (
                          <p className="text-xs italic">{testResult.data.aiReasoning}</p>
                        )}
                        {testResult.data.step1DurationMs && (
                          <p className="text-xs text-muted-foreground">⏱️ {testResult.data.step1DurationMs}ms</p>
                        )}
                      </div>
                    )}

                    {/* x402 Payment Section */}
                    <div className="space-y-1 border-l-2 border-primary pl-3">
                      <div className="flex items-center gap-2">
                        <CreditCard className="w-4 h-4 text-primary" />
                        <p className="text-sm font-semibold text-primary">x402 Micropayment</p>
                      </div>
                      {testResult.data.paymentId && (
                        <p className="text-xs">Payment ID: {testResult.data.paymentId.substring(0, 32)}...</p>
                      )}
                      {testResult.data.paymentSignature && (
                        <div className="flex items-center gap-1">
                          <p className="text-xs">Signature: {testResult.data.paymentSignature.substring(0, 16)}...</p>
                          <a
                            href={`https://solscan.io/tx/${testResult.data.paymentSignature}?cluster=devnet`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-primary hover:text-primary/80"
                            data-testid="link-payment-tx"
                          >
                            <ExternalLink className="w-3 h-3" />
                          </a>
                        </div>
                      )}
                      {testResult.data.serviceFeeUSD !== undefined && (
                        <p className="text-xs font-medium">Fee: ${testResult.data.serviceFeeUSD} USDC</p>
                      )}
                      {testResult.data.step2DurationMs && (
                        <p className="text-xs text-muted-foreground">⏱️ {testResult.data.step2DurationMs}ms</p>
                      )}
                    </div>

                    {/* Jupiter Swap Section */}
                    {testResult.data.step3DurationMs && (
                      <div className="space-y-1 border-l-2 border-green-500 pl-3">
                        <div className="flex items-center gap-2">
                          <ArrowLeftRight className="w-4 h-4 text-green-600 dark:text-green-400" />
                          <p className="text-sm font-semibold text-green-600 dark:text-green-400">Jupiter Swap (Buy)</p>
                        </div>
                        {testResult.data.buyTxSignature && (
                          <div className="flex items-center gap-1">
                            <p className="text-xs">Buy Tx: {testResult.data.buyTxSignature.substring(0, 16)}...</p>
                            <a
                              href={`https://solscan.io/tx/${testResult.data.buyTxSignature}?cluster=devnet`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-green-600 dark:text-green-400 hover:opacity-80"
                              data-testid="link-buy-tx"
                            >
                              <ExternalLink className="w-3 h-3" />
                            </a>
                          </div>
                        )}
                        <p className="text-xs text-muted-foreground">⏱️ {testResult.data.step3DurationMs}ms</p>
                      </div>
                    )}

                    {/* BAM Bundle Section */}
                    <div className="space-y-1 border-l-2 border-purple-500 pl-3">
                      <div className="flex items-center gap-2">
                        <Shield className="w-4 h-4 text-purple-600 dark:text-purple-400" />
                        <p className="text-sm font-semibold text-purple-600 dark:text-purple-400">Jito BAM Bundle</p>
                      </div>
                      {testResult.data.bundleId && (
                        <p className="text-xs">Bundle ID: {testResult.data.bundleId.substring(0, 32)}...</p>
                      )}
                      {testResult.data.burnTxSignature && (
                        <div className="flex items-center gap-1">
                          <p className="text-xs">Burn Tx: {testResult.data.burnTxSignature.substring(0, 16)}...</p>
                          <a
                            href={`https://solscan.io/tx/${testResult.data.burnTxSignature}?cluster=devnet`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-purple-600 dark:text-purple-400 hover:opacity-80"
                            data-testid="link-burn-tx"
                          >
                            <ExternalLink className="w-3 h-3" />
                          </a>
                        </div>
                      )}
                      {testResult.data.tokensBurned && (
                        <p className="text-xs font-medium">🔥 Burned: {testResult.data.tokensBurned.toLocaleString()} tokens</p>
                      )}
                      {testResult.data.step4DurationMs && (
                        <p className="text-xs text-muted-foreground">⏱️ {testResult.data.step4DurationMs}ms</p>
                      )}
                    </div>

                    {/* Total Duration */}
                    {testResult.data.totalDurationMs && (
                      <div className="pt-2 border-t">
                        <p className="text-sm font-semibold">Total Duration: {testResult.data.totalDurationMs}ms</p>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="text-sm text-destructive">
                    {testResult.error && (
                      <p>Error: {testResult.error}</p>
                    )}
                    {testResult.data?.aiReasoning && (
                      <p className="mt-2 text-xs">AI Reasoning: {testResult.data.aiReasoning}</p>
                    )}
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Cumulative Agentic Burn Stats */}
      <Card data-testid="card-cumulative-stats">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Activity className="h-5 w-5" />
            Cumulative Agentic Burn Statistics
          </CardTitle>
          <CardDescription>
            Total tokens burned and x402 payments made through AI-powered burns
          </CardDescription>
        </CardHeader>
        <CardContent>
          {statsLoading ? (
            <div className="text-center text-muted-foreground">Loading stats...</div>
          ) : agenticStats ? (
            <div className="grid gap-4 md:grid-cols-4">
              <div className="space-y-2 p-4 rounded-lg bg-muted/50">
                <p className="text-sm text-muted-foreground">Total Burns</p>
                <p className="text-3xl font-bold">{agenticStats.totalBurns || 0}</p>
                <p className="text-xs text-green-600">
                  {agenticStats.completedBurns || 0} completed
                </p>
              </div>
              <div className="space-y-2 p-4 rounded-lg bg-muted/50">
                <p className="text-sm text-muted-foreground">Tokens Burned</p>
                <p className="text-3xl font-bold">{(agenticStats.totalTokensBurned || 0).toLocaleString()}</p>
                <p className="text-xs text-muted-foreground">
                  Total destroyed
                </p>
              </div>
              <div className="space-y-2 p-4 rounded-lg bg-muted/50">
                <p className="text-sm text-muted-foreground">SOL Spent</p>
                <p className="text-3xl font-bold">{(agenticStats.totalSOLSpent || 0).toFixed(4)}</p>
                <p className="text-xs text-muted-foreground">
                  Total buy amount
                </p>
              </div>
              <div className="space-y-2 p-4 rounded-lg bg-muted/50">
                <p className="text-sm text-muted-foreground">x402 Payments</p>
                <p className="text-3xl font-bold">${(agenticStats.totalPaidUSDC || 0).toFixed(3)}</p>
                <p className="text-xs text-muted-foreground">
                  {agenticStats.totalX402Payments || 0} micropayments
                </p>
              </div>
              <div className="space-y-2 p-4 rounded-lg bg-muted/50">
                <p className="text-sm text-muted-foreground">Avg AI Confidence</p>
                <p className="text-3xl font-bold">{agenticStats.avgAIConfidence || 0}%</p>
                <p className="text-xs text-muted-foreground">
                  Burn approval confidence
                </p>
              </div>
              <div className="space-y-2 p-4 rounded-lg bg-muted/50">
                <p className="text-sm text-muted-foreground">Avg Duration</p>
                <p className="text-3xl font-bold">{(agenticStats.avgDurationMs || 0).toLocaleString()}ms</p>
                <p className="text-xs text-muted-foreground">
                  End-to-end execution
                </p>
              </div>
              <div className="space-y-2 p-4 rounded-lg bg-muted/50">
                <p className="text-sm text-muted-foreground">Success Rate</p>
                <p className="text-3xl font-bold">{(agenticStats.successRate || 0).toFixed(1)}%</p>
                <p className="text-xs text-muted-foreground">
                  Burn completion rate
                </p>
              </div>
              <div className="space-y-2 p-4 rounded-lg bg-muted/50">
                <p className="text-sm text-muted-foreground">Failed Burns</p>
                <p className="text-3xl font-bold text-destructive">{agenticStats.failedBurns || 0}</p>
                <p className="text-xs text-muted-foreground">
                  Rejected by AI or errors
                </p>
              </div>
            </div>
          ) : (
            <div className="text-center text-muted-foreground">No burn history yet. Run your first demo!</div>
          )}
        </CardContent>
      </Card>

      {/* Feature Highlights */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card data-testid="card-feature-x402">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">x402 Micropayments</CardTitle>
            <Coins className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="text-total-payments">
              {x402Loading ? "..." : x402Stats?.totalPayments || 0}
            </div>
            <p className="text-xs text-muted-foreground">
              Agent-to-agent payments via HTTP 402
            </p>
          </CardContent>
        </Card>

        <Card data-testid="card-feature-bam">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">BAM Bundles</CardTitle>
            <Zap className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="text-total-bundles">
              {bamLoading ? "..." : bamStats?.totalBundles || 0}
            </div>
            <p className="text-xs text-muted-foreground">
              Atomic trade+burn transactions
            </p>
          </CardContent>
        </Card>

        <Card data-testid="card-feature-success">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Success Rate</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="text-success-rate">
              {bamLoading ? "..." : `${(bamStats?.successRate || 0).toFixed(1)}%`}
            </div>
            <p className="text-xs text-muted-foreground">
              MEV-protected execution rate
            </p>
          </CardContent>
        </Card>
      </div>

      {/* x402 Micropayment Stats */}
      <Card data-testid="card-x402-stats">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <DollarSign className="h-5 w-5" />
            x402 Micropayment Activity
          </CardTitle>
          <CardDescription>
            HTTP 402 payments enabling the AI agent economy
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {x402Loading ? (
            <div className="text-center text-muted-foreground">Loading payment stats...</div>
          ) : (
            <>
              {/* Overview Stats */}
              <div className="grid gap-4 md:grid-cols-4">
                <div className="space-y-2">
                  <p className="text-sm text-muted-foreground">Total Payments</p>
                  <p className="text-2xl font-bold" data-testid="text-x402-total">
                    {x402Stats?.totalPayments || 0}
                  </p>
                </div>
                <div className="space-y-2">
                  <p className="text-sm text-muted-foreground">Confirmed</p>
                  <p className="text-2xl font-bold text-green-600" data-testid="text-x402-confirmed">
                    {x402Stats?.confirmedPayments || 0}
                  </p>
                </div>
                <div className="space-y-2">
                  <p className="text-sm text-muted-foreground">Total Paid</p>
                  <p className="text-2xl font-bold" data-testid="text-x402-total-paid">
                    ${(x402Stats?.totalPaidUSDC || 0).toFixed(3)}
                  </p>
                </div>
                <div className="space-y-2">
                  <p className="text-sm text-muted-foreground">Network</p>
                  <Badge variant="outline" data-testid="badge-network">
                    {x402Stats?.recentPayments?.[0]?.network === "solana-mainnet" ? "Mainnet" : "Devnet"}
                  </Badge>
                </div>
              </div>

              <Separator />

              {/* Payment Breakdown by Type */}
              <div className="space-y-4">
                <h3 className="text-sm font-medium">Payment Breakdown</h3>
                <div className="grid gap-4 md:grid-cols-3">
                  {Object.entries(x402Stats?.paymentsByType || {}).map(([type, stats]: [string, any]) => (
                    <div key={type} className="space-y-2 p-4 rounded-lg bg-muted/50" data-testid={`card-payment-type-${type}`}>
                      <div className="flex items-center justify-between">
                        <p className="text-sm font-medium capitalize">{type.replace(/_/g, " ")}</p>
                        <Badge variant="secondary" data-testid={`badge-count-${type}`}>
                          {stats.count}
                        </Badge>
                      </div>
                      <p className="text-lg font-bold" data-testid={`text-total-${type}`}>
                        ${stats.total.toFixed(4)} USDC
                      </p>
                    </div>
                  ))}
                </div>
              </div>

              <Separator />

              {/* Recent Payments */}
              <div className="space-y-4">
                <h3 className="text-sm font-medium">Recent Payments</h3>
                {x402Stats?.recentPayments && x402Stats.recentPayments.length > 0 ? (
                  <div className="space-y-2">
                    {x402Stats.recentPayments.slice(0, 5).map((payment: any, idx: number) => (
                      <div
                        key={payment.id}
                        className="flex items-center justify-between p-3 rounded-lg border"
                        data-testid={`row-payment-${idx}`}
                      >
                        <div className="flex-1">
                          <p className="text-sm font-medium" data-testid={`text-payment-type-${idx}`}>
                            {payment.description || payment.paymentType}
                          </p>
                          <p className="text-xs text-muted-foreground" data-testid={`text-payment-time-${idx}`}>
                            {new Date(payment.createdAt).toLocaleString()}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-bold" data-testid={`text-payment-amount-${idx}`}>
                            ${parseFloat(payment.amountUSDC).toFixed(4)}
                          </p>
                          <Badge
                            variant={payment.status === "confirmed" ? "default" : "outline"}
                            data-testid={`badge-status-${idx}`}
                          >
                            {payment.status}
                          </Badge>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-center text-sm text-muted-foreground" data-testid="text-no-payments">
                    No recent payments
                  </p>
                )}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* BAM Bundle Stats */}
      <Card data-testid="card-bam-stats">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Flame className="h-5 w-5" />
            Jito BAM Atomic Bundles
          </CardTitle>
          <CardDescription>
            MEV-protected atomic trade+burn execution with guaranteed ordering
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {bamLoading ? (
            <div className="text-center text-muted-foreground">Loading bundle stats...</div>
          ) : (
            <>
              {/* Overview Stats */}
              <div className="grid gap-4 md:grid-cols-5">
                <div className="space-y-2">
                  <p className="text-sm text-muted-foreground">Total Bundles</p>
                  <p className="text-2xl font-bold" data-testid="text-bam-total">
                    {bamStats?.totalBundles || 0}
                  </p>
                </div>
                <div className="space-y-2">
                  <p className="text-sm text-muted-foreground">Landed</p>
                  <p className="text-2xl font-bold text-green-600" data-testid="text-bam-landed">
                    {bamStats?.landedBundles || 0}
                  </p>
                </div>
                <div className="space-y-2">
                  <p className="text-sm text-muted-foreground">Failed</p>
                  <p className="text-2xl font-bold text-red-600" data-testid="text-bam-failed">
                    {bamStats?.failedBundles || 0}
                  </p>
                </div>
                <div className="space-y-2">
                  <p className="text-sm text-muted-foreground">Avg. Execution</p>
                  <p className="text-2xl font-bold" data-testid="text-bam-exec-time">
                    {bamStats?.avgExecutionTimeMs || 0}ms
                  </p>
                </div>
                <div className="space-y-2">
                  <p className="text-sm text-muted-foreground">Total Tips</p>
                  <p className="text-2xl font-bold" data-testid="text-bam-tips">
                    {(bamStats?.totalTipPaidSOL || 0).toFixed(5)} SOL
                  </p>
                </div>
              </div>

              <Separator />

              {/* Recent Bundles */}
              <div className="space-y-4">
                <h3 className="text-sm font-medium">Recent Bundles</h3>
                {bamStats?.recentBundles && bamStats.recentBundles.length > 0 ? (
                  <div className="space-y-2">
                    {bamStats.recentBundles.slice(0, 5).map((bundle: any, idx: number) => (
                      <div
                        key={bundle.id}
                        className="flex items-center justify-between p-3 rounded-lg border"
                        data-testid={`row-bundle-${idx}`}
                      >
                        <div className="flex-1 space-y-1">
                          <div className="flex items-center gap-2">
                            <Badge variant="outline" data-testid={`badge-bundle-type-${idx}`}>
                              {bundle.bundleType}
                            </Badge>
                            <p className="text-xs font-mono text-muted-foreground" data-testid={`text-bundle-id-${idx}`}>
                              {bundle.bundleId?.substring(0, 16)}...
                            </p>
                          </div>
                          <p className="text-xs text-muted-foreground" data-testid={`text-bundle-time-${idx}`}>
                            {new Date(bundle.submittedAt).toLocaleString()}
                            {bundle.executionTimeMs && ` • ${bundle.executionTimeMs}ms`}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="text-right">
                            <p className="text-xs text-muted-foreground" data-testid={`text-bundle-tx-count-${idx}`}>
                              {bundle.transactionCount} tx
                            </p>
                            {bundle.tradeAmountSOL && (
                              <p className="text-xs font-bold" data-testid={`text-bundle-amount-${idx}`}>
                                {parseFloat(bundle.tradeAmountSOL).toFixed(4)} SOL
                              </p>
                            )}
                          </div>
                          <Badge
                            variant={
                              bundle.status === "landed"
                                ? "default"
                                : bundle.status === "failed"
                                ? "destructive"
                                : "outline"
                            }
                            data-testid={`badge-bundle-status-${idx}`}
                          >
                            {bundle.status}
                          </Badge>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-center text-sm text-muted-foreground" data-testid="text-no-bundles">
                    No recent bundles
                  </p>
                )}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* How It Works */}
      <Card data-testid="card-how-it-works">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Activity className="h-5 w-5" />
            How Agentic Burn Works
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-3">
            <div className="space-y-2" data-testid="step-payment">
              <div className="flex items-center gap-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-primary-foreground">
                  1
                </div>
                <h3 className="font-medium">x402 Payment</h3>
              </div>
              <p className="text-sm text-muted-foreground">
                GigaBrain AI pays BurnBot via HTTP 402 micropayment ($0.005 USDC per burn service)
              </p>
            </div>

            <div className="space-y-2" data-testid="step-swap">
              <div className="flex items-center gap-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-primary-foreground">
                  2
                </div>
                <h3 className="font-medium">Jupiter Swap</h3>
              </div>
              <p className="text-sm text-muted-foreground">
                Buy target tokens using Jupiter with optimized routing and slippage protection
              </p>
            </div>

            <div className="space-y-2" data-testid="step-burn">
              <div className="flex items-center gap-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-primary-foreground">
                  3
                </div>
                <h3 className="font-medium">BAM Atomic Burn</h3>
              </div>
              <p className="text-sm text-muted-foreground">
                Burn tokens via Jito BAM bundle with MEV protection and guaranteed atomic execution
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
