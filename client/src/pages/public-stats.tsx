import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { TrendingUp, Zap, Target, Trophy, Clock, BarChart3, Activity, Sparkles } from "lucide-react";
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
          <Link href="/">
            <a className="flex items-center gap-2 hover-elevate">
              <Sparkles className="h-6 w-6 text-primary" />
              <span className="text-xl font-bold">GigaBrain</span>
            </a>
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
          <Badge variant="outline" className="mb-4">
            <Activity className="h-3 w-3 mr-1" />
            Live Performance Dashboard
          </Badge>
          <h1 className="text-4xl md:text-5xl font-bold bg-gradient-to-r from-primary via-primary/80 to-primary bg-clip-text text-transparent">
            Real-Time GigaBrain Performance
          </h1>
          <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
            100% transparent, verifiable on-chain results. Every trade is recorded and auditable.
          </p>
        </div>

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
                🤖 10-Model AI Hivemind
              </h3>
              <p className="text-sm text-muted-foreground">
                Multiple AI models vote on every trade with automatic failover. Higher accuracy, lower risk.
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
            First 10 trades free • No credit card required • Start in 60 seconds
          </p>
        </div>
      </div>
    </div>
  );
}
