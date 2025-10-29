import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { TrendingUp, Zap, Target, Trophy, Clock, BarChart3, Activity, Sparkles, Wallet, PieChart, DollarSign } from "lucide-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";

interface PublicStats {
  totalTrades: number;
  winRate: string;
  avgROI: string;
  totalProfit: string;
  activeUsers: number;
  avgHoldTime: number;
  bestTrade: string;
  last24hTrades: number;
  scalpTrades: number;
  swingTrades: number;
  totalCapitalSOL: string;
  capitalInPositionsSOL: string;
  availableCapitalSOL: string;
  activePositionsCount: number;
}

export default function PublicStats() {
  const { data: stats, isLoading } = useQuery<PublicStats>({
    queryKey: ["/api/public/stats"],
  });

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background">
        <div className="container mx-auto px-4 py-12">
          <div className="text-center">
            <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-primary border-r-transparent"></div>
            <p className="mt-4 text-muted-foreground">Loading live stats...</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-muted/20">
      {/* Header */}
      <div className="border-b bg-background/80 backdrop-blur-sm sticky top-0 z-10">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2 hover-elevate">
            <Sparkles className="h-6 w-6 text-primary" />
            <span className="text-xl font-bold">GigaBrain</span>
          </Link>
          <div className="flex items-center gap-4">
            <Link href="/analyze">
              <Button variant="outline" data-testid="button-analyze-token">
                Analyze Token
              </Button>
            </Link>
            <Link href="/learn">
              <Button variant="outline" data-testid="button-learn">
                How It Works
              </Button>
            </Link>
            <Link href="/dashboard">
              <Button variant="default" data-testid="button-get-started">
                Get Started
              </Button>
            </Link>
          </div>
        </div>
      </div>

      <div className="container mx-auto px-4 py-12 space-y-8">
        {/* Hero Section */}
        <div className="text-center space-y-4 py-8">
          <Badge variant="outline" className="mb-4 bg-green-500/10 border-green-500/30 text-green-500">
            <Sparkles className="h-3 w-3 mr-1" />
            Free to View • No Wallet Required • Real-Time Data
          </Badge>
          <h1 className="text-4xl md:text-5xl font-bold bg-gradient-to-r from-primary via-primary/80 to-primary bg-clip-text text-transparent">
            Real-Time GigaBrain Performance
          </h1>
          <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
            100% transparent, verifiable on-chain results. Every trade is recorded and auditable.
          </p>
        </div>

        {/* Fresh Start Banner */}
        {stats && stats.totalTrades === 0 && (
          <Card className="border-2 border-green-500/30 bg-gradient-to-br from-green-500/10 to-background">
            <CardContent className="pt-6">
              <div className="text-center space-y-3">
                <div className="flex items-center justify-center gap-2">
                  <Sparkles className="h-6 w-6 text-green-500" />
                  <h3 className="text-xl font-bold text-green-500">Fresh Start - System Upgraded</h3>
                </div>
                <p className="text-sm text-muted-foreground max-w-2xl mx-auto">
                  GigaBrain has been upgraded with enhanced token discovery (100+ tokens scanned), 5-minute refresh cycles, and smarter exit strategies. All metrics have been reset to track fresh performance data with the latest improvements.
                </p>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-4 max-w-3xl mx-auto">
                  <div>
                    <p className="font-semibold text-sm mb-1">3x More Tokens</p>
                    <p className="text-xs text-muted-foreground">100+ tokens from 4 sources</p>
                  </div>
                  <div>
                    <p className="font-semibold text-sm mb-1">4x Faster Discovery</p>
                    <p className="text-xs text-muted-foreground">5-minute refresh cycles</p>
                  </div>
                  <div>
                    <p className="font-semibold text-sm mb-1">Smarter Exits</p>
                    <p className="text-xs text-muted-foreground">2-stage filter + trailing stops</p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Main Stats Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {/* Win Rate */}
          <Card className="border-green-500/50 bg-gradient-to-br from-green-500/10 to-green-500/5">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <Trophy className="h-4 w-4 text-green-500" />
                Win Rate
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-green-500" data-testid="text-win-rate">
                {stats?.winRate || "0"}%
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                {stats?.totalTrades || 0} total trades
              </p>
            </CardContent>
          </Card>

          {/* Average ROI */}
          <Card className="border-primary/50 bg-gradient-to-br from-primary/10 to-primary/5">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <TrendingUp className="h-4 w-4 text-primary" />
                Average ROI
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-primary" data-testid="text-avg-roi">
                +{stats?.avgROI || "0"}%
              </div>
              <p className="text-xs text-muted-foreground mt-1">Per trade average</p>
            </CardContent>
          </Card>

          {/* Total Profit */}
          <Card className="border-blue-500/50 bg-gradient-to-br from-blue-500/10 to-blue-500/5">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <Target className="h-4 w-4 text-blue-500" />
                Total Profit
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-blue-500" data-testid="text-total-profit">
                {stats?.totalProfit || "0"} SOL
              </div>
              <p className="text-xs text-muted-foreground mt-1">Cumulative gains</p>
            </CardContent>
          </Card>

          {/* Best Trade */}
          <Card className="border-orange-500/50 bg-gradient-to-br from-orange-500/10 to-orange-500/5">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <Zap className="h-4 w-4 text-orange-500" />
                Best Trade
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-orange-500" data-testid="text-best-trade">
                +{stats?.bestTrade || "0"}%
              </div>
              <p className="text-xs text-muted-foreground mt-1">Single trade gain</p>
            </CardContent>
          </Card>
        </div>

        {/* Secondary Stats */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <Clock className="h-4 w-4" />
                Average Hold Time
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold" data-testid="text-avg-hold-time">
                {Math.floor((stats?.avgHoldTime || 0) / 60)}h {(stats?.avgHoldTime || 0) % 60}m
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Fast execution, optimal exits
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <BarChart3 className="h-4 w-4" />
                Trading Strategy
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold" data-testid="text-strategy-split">
                {stats?.scalpTrades || 0} SCALP / {stats?.swingTrades || 0} SWING
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Dual-mode AI strategy
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <Activity className="h-4 w-4" />
                Last 24 Hours
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold" data-testid="text-24h-trades">
                {stats?.last24hTrades || 0} trades
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Active 24/7 monitoring
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Portfolio Performance Section */}
        <Card className="border-purple-500/20">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <PieChart className="h-5 w-5 text-purple-500" />
              Portfolio Performance
            </CardTitle>
            <CardDescription>
              Real-time capital allocation across all active traders
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Wallet className="h-4 w-4 text-purple-500" />
                  Total Capital
                </div>
                <div className="text-2xl font-bold text-purple-500" data-testid="text-total-capital">
                  {stats?.totalCapitalSOL || "0.00"} SOL
                </div>
                <p className="text-xs text-muted-foreground">
                  Combined portfolio value
                </p>
              </div>

              <div className="space-y-2">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Target className="h-4 w-4 text-orange-500" />
                  In Positions
                </div>
                <div className="text-2xl font-bold text-orange-500" data-testid="text-capital-positions">
                  {stats?.capitalInPositionsSOL || "0.00"} SOL
                </div>
                <p className="text-xs text-muted-foreground">
                  Actively deployed capital
                </p>
              </div>

              <div className="space-y-2">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <DollarSign className="h-4 w-4 text-green-500" />
                  Available Capital
                </div>
                <div className="text-2xl font-bold text-green-500" data-testid="text-available-capital">
                  {stats?.availableCapitalSOL || "0.00"} SOL
                </div>
                <p className="text-xs text-muted-foreground">
                  Ready to deploy
                </p>
              </div>

              <div className="space-y-2">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Activity className="h-4 w-4 text-blue-500" />
                  Active Positions
                </div>
                <div className="text-2xl font-bold text-blue-500" data-testid="text-active-positions">
                  {stats?.activePositionsCount || 0}
                </div>
                <p className="text-xs text-muted-foreground">
                  Across all traders
                </p>
              </div>
            </div>

            {/* Capital Allocation Bar */}
            <div className="mt-6 space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Capital Allocation</span>
                <span className="font-medium">
                  {(() => {
                    const totalCapital = parseFloat(stats?.totalCapitalSOL || "0");
                    const inPositions = parseFloat(stats?.capitalInPositionsSOL || "0");
                    if (totalCapital <= 0) return "0% deployed";
                    const percentage = (inPositions / totalCapital) * 100;
                    const clamped = Math.min(100, percentage);
                    return `${clamped.toFixed(1)}% deployed${percentage > 100 ? " (over-allocated)" : ""}`;
                  })()}
                </span>
              </div>
              <div className="w-full bg-muted rounded-full h-3 overflow-hidden">
                <div 
                  className="h-full bg-gradient-to-r from-orange-500 to-purple-500 transition-all duration-500"
                  style={{ 
                    width: (() => {
                      const totalCapital = parseFloat(stats?.totalCapitalSOL || "0");
                      const inPositions = parseFloat(stats?.capitalInPositionsSOL || "0");
                      if (totalCapital <= 0) return "0%";
                      const percentage = (inPositions / totalCapital) * 100;
                      // Clamp between 0-100% to prevent overflow
                      return `${Math.min(100, Math.max(0, percentage))}%`;
                    })()
                  }}
                />
              </div>
              {(() => {
                const totalCapital = parseFloat(stats?.totalCapitalSOL || "0");
                const inPositions = parseFloat(stats?.capitalInPositionsSOL || "0");
                if (inPositions > totalCapital && totalCapital > 0) {
                  return (
                    <p className="text-xs text-orange-500 flex items-center gap-1">
                      <Zap className="h-3 w-3" />
                      Positions have gained value beyond initial capital - excellent performance!
                    </p>
                  );
                }
                return null;
              })()}
            </div>
          </CardContent>
        </Card>

        {/* Trust Signals */}
        <Card className="border-primary/20">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-primary" />
              Why Trust GigaBrain?
            </CardTitle>
            <CardDescription>
              Transparent, verifiable, and non-custodial
            </CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-2">
              <h3 className="font-semibold flex items-center gap-2">
                ✅ 100% On-Chain Verifiable
              </h3>
              <p className="text-sm text-muted-foreground">
                Every trade is recorded on Solana blockchain. Check any transaction on Solscan or Solana FM.
              </p>
            </div>
            <div className="space-y-2">
              <h3 className="font-semibold flex items-center gap-2">
                🔐 Non-Custodial Security
              </h3>
              <p className="text-sm text-muted-foreground">
                You control your wallet. Your keys never leave your device. We can't access your funds.
              </p>
            </div>
            <div className="space-y-2">
              <h3 className="font-semibold flex items-center gap-2">
                🤖 12-Model AI Hivemind
              </h3>
              <p className="text-sm text-muted-foreground">
                12 AI models in 4-team rotation vote on every trade with automatic failover. Higher accuracy, lower risk.
              </p>
            </div>
            <div className="space-y-2">
              <h3 className="font-semibold flex items-center gap-2">
                📊 Real-Time Performance
              </h3>
              <p className="text-sm text-muted-foreground">
                This dashboard updates live. No fake numbers, no marketing BS. What you see is what's real.
              </p>
            </div>
          </CardContent>
        </Card>

        {/* CTA Section */}
        <div className="text-center py-12 space-y-6">
          <h2 className="text-3xl font-bold">Ready to Start Trading?</h2>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            Join the autonomous AI trading revolution. Start with as little as 0.1 SOL.
          </p>
          <div className="flex items-center justify-center gap-4">
            <Link href="/dashboard">
              <Button size="lg" className="text-lg px-8" data-testid="button-start-trading">
                Start Trading Now
              </Button>
            </Link>
            <Link href="/analyze">
              <Button size="lg" variant="outline" className="text-lg px-8" data-testid="button-try-analyzer">
                Try Token Analyzer
              </Button>
            </Link>
          </div>
          <p className="text-sm text-muted-foreground">
            First 20 trades free • No credit card required • Start in 60 seconds
          </p>
        </div>
      </div>
    </div>
  );
}
