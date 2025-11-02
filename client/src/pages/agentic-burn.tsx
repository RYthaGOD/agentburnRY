import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Coins, Zap, TrendingUp, DollarSign, Flame, Activity, PlayCircle, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useState } from "react";

export default function AgenticBurnPage() {
  // Mock wallet for demo - in production this would come from user's connected wallet
  const demoWallet = "jawKuQ3xtcYoAuqE9jyG2H35sv2pWJSzsyjoNpsxG38";
  const { toast } = useToast();
  const [testResult, setTestResult] = useState<any>(null);

  // Fetch x402 payment stats
  const { data: x402Stats, isLoading: x402Loading, refetch: refetchX402 } = useQuery<any>({
    queryKey: ["/api/x402/stats", demoWallet],
    enabled: !!demoWallet,
  });

  // Fetch BAM bundle stats
  const { data: bamStats, isLoading: bamLoading, refetch: refetchBam } = useQuery<any>({
    queryKey: ["/api/bam/stats", demoWallet],
    enabled: !!demoWallet,
  });

  // Test agentic burn mutation
  const testBurnMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch("/api/demo/agentic-burn", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tokenMint: "So11111111111111111111111111111111111111112", // Wrapped SOL for demo
          buyAmountSOL: 0.01,
        }),
      });
      return response.json();
    },
    onSuccess: (data: any) => {
      setTestResult(data);
      if (data.success) {
        toast({
          title: "✅ Agentic Burn Success!",
          description: `x402 payment processed and BAM bundle created. Payment ID: ${data.paymentId?.substring(0, 8)}...`,
        });
        // Refresh stats
        refetchX402();
        refetchBam();
      } else {
        toast({
          title: "⚠️ Agentic Burn Failed",
          description: data.error || "Unknown error occurred",
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

        {/* Demo Test Button for Hackathon */}
        <Card className="bg-gradient-to-r from-primary/10 to-purple-500/10 border-primary/20" data-testid="card-demo">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <PlayCircle className="h-5 w-5 text-primary" />
              Hackathon Demo - Test Agentic Burn
            </CardTitle>
            <CardDescription>
              Click to demonstrate the complete x402 + BAM flow (simulated transaction)
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Button
              onClick={() => testBurnMutation.mutate()}
              disabled={testBurnMutation.isPending}
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
              <div className="p-4 rounded-lg bg-muted space-y-2" data-testid="div-test-result">
                <p className="font-medium">
                  {testResult.success ? "✅ Demo Successful!" : "⚠️ Demo Result"}
                </p>
                <div className="text-sm space-y-1">
                  {testResult.paymentId && (
                    <p>Payment ID: {testResult.paymentId.substring(0, 16)}...</p>
                  )}
                  {testResult.bundleId && (
                    <p>Bundle ID: {testResult.bundleId.substring(0, 16)}...</p>
                  )}
                  {testResult.serviceFeeUSD && (
                    <p>Service Fee: ${testResult.serviceFeeUSD} USDC</p>
                  )}
                  {testResult.error && (
                    <p className="text-destructive">Error: {testResult.error}</p>
                  )}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

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
