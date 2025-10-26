import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { WalletButton } from "@/components/wallet-button";
import { ThemeToggle } from "@/components/theme-toggle";
import { Sparkles, TrendingUp, Search, Brain, Shield, Zap, BarChart3, CheckCircle2, AlertCircle, Wallet, Flame, Lock, Users } from "lucide-react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";

interface PublicStats {
  totalTrades: number;
  winRate: string;
  avgROI: string;
  totalProfit: string;
}

export default function Landing() {
  const { data: stats } = useQuery<PublicStats>({
    queryKey: ["/api/public/stats"],
  });

  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-muted/20">
      {/* Header */}
      <header className="sticky top-0 z-50 w-full border-b border-border backdrop-blur-xl bg-background/80">
        <div className="container mx-auto flex h-16 items-center justify-between px-6 lg:px-8">
          <Link href="/" className="flex items-center gap-2 hover-elevate">
            <Sparkles className="h-8 w-8 text-primary" />
            <span className="text-2xl font-bold">GigaBrain</span>
          </Link>
          <nav className="hidden md:flex items-center gap-6">
            <Link href="/stats">
              <span className="text-sm font-medium hover-elevate px-3 py-2 rounded-md cursor-pointer" data-testid="link-stats">
                Live Stats
              </span>
            </Link>
            <Link href="/analyze">
              <span className="text-sm font-medium hover-elevate px-3 py-2 rounded-md cursor-pointer" data-testid="link-analyze">
                Token Analyzer
              </span>
            </Link>
            <Link href="/learn">
              <span className="text-sm font-medium hover-elevate px-3 py-2 rounded-md cursor-pointer" data-testid="link-learn">
                How It Works
              </span>
            </Link>
          </nav>
          <div className="flex items-center gap-4">
            <ThemeToggle />
            <WalletButton />
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <section className="py-20 md:py-32">
        <div className="container mx-auto px-6 lg:px-8">
          <div className="text-center space-y-6">
            <Badge variant="outline" className="mb-4 bg-primary/10 border-primary/20">
              <Sparkles className="h-3 w-3 mr-1" />
              10-Model AI Hivemind • 100% Autonomous • Non-Custodial
            </Badge>
            
            <h1 className="text-5xl md:text-6xl lg:text-7xl font-bold tracking-tight max-w-5xl mx-auto leading-tight">
              <span className="bg-gradient-to-r from-primary via-primary/80 to-primary bg-clip-text text-transparent">
                AI Trading Bot
              </span>
              <br />
              <span className="text-foreground">That Never Sleeps</span>
            </h1>
            
            <p className="text-xl md:text-2xl text-muted-foreground max-w-3xl mx-auto">
              GigaBrain uses a 10-model AI consensus system to trade Solana tokens 24/7. Start with 0.1 SOL.
            </p>

            {/* Live Stats Preview */}
            {stats && stats.totalTrades > 0 && (
              <div className="flex items-center justify-center gap-8 py-6">
                <div className="text-center">
                  <p className="text-3xl font-bold text-green-500">{stats.winRate}%</p>
                  <p className="text-sm text-muted-foreground">Win Rate</p>
                </div>
                <div className="text-center">
                  <p className="text-3xl font-bold text-primary">+{stats.avgROI}%</p>
                  <p className="text-sm text-muted-foreground">Avg ROI</p>
                </div>
                <div className="text-center">
                  <p className="text-3xl font-bold text-blue-500">{stats.totalTrades}</p>
                  <p className="text-sm text-muted-foreground">Total Trades</p>
                </div>
              </div>
            )}

            <div className="flex flex-col sm:flex-row items-center justify-center gap-4 pt-4">
              <Link href="/dashboard">
                <Button size="lg" className="text-lg px-8 h-12" data-testid="button-start-trading">
                  Start Trading Free
                </Button>
              </Link>
              <Link href="/analyze">
                <Button size="lg" variant="outline" className="text-lg px-8 h-12" data-testid="button-try-analyzer">
                  Try Free Analyzer
                </Button>
              </Link>
            </div>
            
            <div className="space-y-1">
              <p className="text-base font-semibold text-green-500">
                ✓ First 20 trades completely free
              </p>
              <p className="text-sm text-muted-foreground">
                Then 0.15 SOL for 2 weeks unlimited access • 1% fee per trade • No credit card required
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Subscription Pricing */}
      <section className="py-16 bg-gradient-to-br from-primary/10 to-background border-y">
        <div className="container mx-auto px-6 lg:px-8">
          <div className="text-center mb-12">
            <h2 className="text-4xl font-bold mb-4">Simple, Transparent Pricing</h2>
            <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
              Start free, upgrade when ready. Pay with SOL, no credit card required.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-8 max-w-5xl mx-auto">
            {/* Free Trial Card */}
            <Card className="border-2 border-green-500/30 bg-gradient-to-br from-green-500/10 to-background relative">
              <CardHeader className="pb-4">
                <Badge className="w-fit bg-green-500/20 border-green-500/40 text-green-500 mb-2">
                  Start Free
                </Badge>
                <CardTitle className="text-3xl">20 Free Trades</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <div className="text-4xl font-bold mb-2">
                    <span className="text-green-500">FREE</span>
                  </div>
                  <p className="text-sm text-muted-foreground">No payment required</p>
                </div>
                
                <div className="space-y-3 pt-4">
                  <div className="flex items-start gap-3">
                    <CheckCircle2 className="h-5 w-5 text-green-500 mt-0.5 flex-shrink-0" />
                    <div>
                      <p className="font-medium">20 AI-powered trades</p>
                      <p className="text-sm text-muted-foreground">Full access to all features</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <CheckCircle2 className="h-5 w-5 text-green-500 mt-0.5 flex-shrink-0" />
                    <div>
                      <p className="font-medium">11-model hivemind AI</p>
                      <p className="text-sm text-muted-foreground">Same AI system as paid users</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <CheckCircle2 className="h-5 w-5 text-green-500 mt-0.5 flex-shrink-0" />
                    <div>
                      <p className="font-medium">1% trading fee applies</p>
                      <p className="text-sm text-muted-foreground">Standard platform fee</p>
                    </div>
                  </div>
                </div>

                <Link href="/dashboard">
                  <Button size="lg" className="w-full mt-4" data-testid="button-start-free">
                    Start Free Trial
                  </Button>
                </Link>
              </CardContent>
            </Card>

            {/* Subscription Card */}
            <Card className="border-2 border-primary bg-gradient-to-br from-primary/20 to-background relative">
              <CardHeader className="pb-4">
                <Badge className="w-fit bg-primary/30 border-primary text-primary mb-2">
                  Unlimited Access
                </Badge>
                <CardTitle className="text-3xl">2-Week Subscription</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <div className="text-4xl font-bold mb-2 flex items-baseline gap-2">
                    <span className="text-primary">0.15 SOL</span>
                    <span className="text-lg font-normal text-muted-foreground">/ 2 weeks</span>
                  </div>
                  <p className="text-sm text-muted-foreground">Unlimited trades for 14 days</p>
                </div>
                
                <div className="space-y-3 pt-4">
                  <div className="flex items-start gap-3">
                    <CheckCircle2 className="h-5 w-5 text-primary mt-0.5 flex-shrink-0" />
                    <div>
                      <p className="font-medium">Unlimited AI trades</p>
                      <p className="text-sm text-muted-foreground">Trade 24/7 for 2 full weeks</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <CheckCircle2 className="h-5 w-5 text-primary mt-0.5 flex-shrink-0" />
                    <div>
                      <p className="font-medium">Full hivemind AI access</p>
                      <p className="text-sm text-muted-foreground">All 10 AI models working for you</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <CheckCircle2 className="h-5 w-5 text-primary mt-0.5 flex-shrink-0" />
                    <div>
                      <p className="font-medium">Auto portfolio rebalancing</p>
                      <p className="text-sm text-muted-foreground">AI optimizes positions every 30min</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <CheckCircle2 className="h-5 w-5 text-primary mt-0.5 flex-shrink-0" />
                    <div>
                      <p className="font-medium">1% trading fee applies</p>
                      <p className="text-sm text-muted-foreground">Same low platform fee</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <Flame className="h-5 w-5 text-orange-500 mt-0.5 flex-shrink-0" />
                    <div>
                      <p className="font-medium text-orange-500">33% used for buyback & burn</p>
                      <p className="text-sm text-muted-foreground">Deflationary tokenomics</p>
                    </div>
                  </div>
                </div>

                <div className="bg-muted/50 rounded-md p-3 mt-4">
                  <p className="text-xs text-muted-foreground text-center">
                    Payment via Solana blockchain • Instant activation
                  </p>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Additional Free Tools */}
          <div className="mt-12 pt-12 border-t">
            <h3 className="text-2xl font-bold text-center mb-8">Always Free Tools</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-3xl mx-auto">
              <Card className="bg-background/80 backdrop-blur">
                <CardContent className="pt-6">
                  <div className="flex items-center gap-3 mb-3">
                    <Search className="h-6 w-6 text-blue-500" />
                    <h3 className="font-semibold">Token Analyzer</h3>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Unlimited AI analysis on any token. No wallet, no signup required.
                  </p>
                </CardContent>
              </Card>
              <Card className="bg-background/80 backdrop-blur">
                <CardContent className="pt-6">
                  <div className="flex items-center gap-3 mb-3">
                    <TrendingUp className="h-6 w-6 text-green-500" />
                    <h3 className="font-semibold">Live Stats Dashboard</h3>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Real-time performance data. See how GigaBrain trades in real-time.
                  </p>
                </CardContent>
              </Card>
            </div>
          </div>
        </div>
      </section>

      {/* Tokenomics - Buyback & Burn */}
      <section className="py-16 bg-gradient-to-br from-orange-500/10 via-primary/10 to-background border-y border-orange-500/20">
        <div className="container mx-auto px-6 lg:px-8">
          <div className="max-w-5xl mx-auto">
            <div className="text-center mb-12">
              <Badge className="mb-4 bg-orange-500/20 border-orange-500/40 text-orange-500">
                <Flame className="h-3 w-3 mr-1" />
                Deflationary Tokenomics
              </Badge>
              <h2 className="text-4xl font-bold mb-4">Automatic Buyback & Burn</h2>
              <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
                Every subscription purchase directly supports the token ecosystem
              </p>
            </div>

            <Card className="border-2 border-orange-500/30 bg-gradient-to-br from-orange-500/5 to-background">
              <CardContent className="pt-8">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mb-8">
                  <div className="text-center">
                    <div className="h-16 w-16 rounded-full bg-orange-500/20 flex items-center justify-center mx-auto mb-4">
                      <TrendingUp className="h-8 w-8 text-orange-500" />
                    </div>
                    <h3 className="font-bold text-2xl mb-2">33%</h3>
                    <p className="text-sm text-muted-foreground">Of every subscription</p>
                  </div>
                  <div className="text-center">
                    <div className="h-16 w-16 rounded-full bg-primary/20 flex items-center justify-center mx-auto mb-4">
                      <Sparkles className="h-8 w-8 text-primary" />
                    </div>
                    <h3 className="font-bold text-2xl mb-2">Auto</h3>
                    <p className="text-sm text-muted-foreground">Buyback from market</p>
                  </div>
                  <div className="text-center">
                    <div className="h-16 w-16 rounded-full bg-orange-500/20 flex items-center justify-center mx-auto mb-4">
                      <Flame className="h-8 w-8 text-orange-500" />
                    </div>
                    <h3 className="font-bold text-2xl mb-2">Burn</h3>
                    <p className="text-sm text-muted-foreground">Permanently removed</p>
                  </div>
                </div>

                <div className="bg-muted/50 rounded-lg p-6 border border-orange-500/20">
                  <div className="flex items-start gap-4">
                    <Flame className="h-6 w-6 text-orange-500 flex-shrink-0 mt-1" />
                    <div>
                      <h4 className="font-bold mb-2">How It Works</h4>
                      <p className="text-sm text-muted-foreground mb-4">
                        When you purchase a 2-week subscription (0.15 SOL), one-third (0.05 SOL) is automatically used to buy back tokens from the market and burn them forever. This creates constant buying pressure and reduces supply, supporting long-term token value.
                      </p>
                      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 mt-4 p-3 bg-background/50 rounded-md">
                        <div className="flex items-center gap-2 flex-shrink-0">
                          <CheckCircle2 className="h-4 w-4 text-green-500" />
                          <span className="text-xs font-medium">Token:</span>
                        </div>
                        <code className="text-xs bg-muted px-2 py-1 rounded break-all">
                          FQptMsS3tnyPbK68rTZm3n3R4NHBX5r9edshyyvxpump
                        </code>
                      </div>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </section>

      {/* Security Advisory */}
      <section className="py-12 bg-gradient-to-br from-blue-500/10 to-background">
        <div className="container mx-auto px-6 lg:px-8">
          <Card className="max-w-4xl mx-auto border-2 border-blue-500/30 bg-gradient-to-br from-blue-500/5 to-background">
            <CardContent className="pt-6">
              <div className="flex items-start gap-4">
                <div className="flex-shrink-0">
                  <div className="h-12 w-12 rounded-full bg-blue-500/20 flex items-center justify-center">
                    <Shield className="h-6 w-6 text-blue-500" />
                  </div>
                </div>
                <div className="flex-1">
                  <h3 className="text-xl font-bold mb-2 flex items-center gap-2">
                    <Wallet className="h-5 w-5 text-blue-500" />
                    Security Best Practice: Use a Fresh Wallet
                  </h3>
                  <p className="text-muted-foreground mb-4">
                    We strongly recommend creating a new Solana wallet specifically for AI trading. This keeps your main wallet safe and helps you track trading performance separately.
                  </p>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="flex items-start gap-2">
                      <CheckCircle2 className="h-5 w-5 text-green-500 flex-shrink-0 mt-0.5" />
                      <div>
                        <p className="font-medium text-sm">Isolated Risk</p>
                        <p className="text-xs text-muted-foreground">Protect your main holdings</p>
                      </div>
                    </div>
                    <div className="flex items-start gap-2">
                      <CheckCircle2 className="h-5 w-5 text-green-500 flex-shrink-0 mt-0.5" />
                      <div>
                        <p className="font-medium text-sm">Clear Tracking</p>
                        <p className="text-xs text-muted-foreground">Easy performance monitoring</p>
                      </div>
                    </div>
                    <div className="flex items-start gap-2">
                      <CheckCircle2 className="h-5 w-5 text-green-500 flex-shrink-0 mt-0.5" />
                      <div>
                        <p className="font-medium text-sm">Non-Custodial</p>
                        <p className="text-xs text-muted-foreground">You always control your funds</p>
                      </div>
                    </div>
                  </div>
                  <div className="mt-4 p-3 bg-blue-500/10 border border-blue-500/20 rounded-md">
                    <p className="text-sm text-muted-foreground flex items-start gap-2">
                      <AlertCircle className="h-4 w-4 text-blue-500 flex-shrink-0 mt-0.5" />
                      <span>Transfer only the amount you want to trade (e.g., 0.5-2 SOL) to your new trading wallet. You can always add more later.</span>
                    </p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </section>

      {/* Complete Trade Isolation */}
      <section className="py-16 bg-gradient-to-br from-green-500/10 to-background">
        <div className="container mx-auto px-6 lg:px-8">
          <div className="max-w-5xl mx-auto">
            <div className="text-center mb-12">
              <Badge className="mb-4 bg-green-500/20 border-green-500/40 text-green-500">
                <Lock className="h-3 w-3 mr-1" />
                100% Isolated Trading
              </Badge>
              <h2 className="text-4xl font-bold mb-4">Your Capital, Your Trades Only</h2>
              <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
                Complete isolation between users - other traders never affect your positions or capital
              </p>
            </div>

            <Card className="border-2 border-green-500/30 bg-gradient-to-br from-green-500/5 to-background">
              <CardContent className="pt-8">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
                  <div className="flex items-start gap-3">
                    <div className="h-10 w-10 rounded-full bg-green-500/20 flex items-center justify-center flex-shrink-0">
                      <Wallet className="h-5 w-5 text-green-500" />
                    </div>
                    <div>
                      <h4 className="font-bold mb-1">Your SOL, Your Control</h4>
                      <p className="text-sm text-muted-foreground">
                        Your wallet balance and token positions are completely separate from all other users. No shared pools, no interference.
                      </p>
                    </div>
                  </div>
                  
                  <div className="flex items-start gap-3">
                    <div className="h-10 w-10 rounded-full bg-green-500/20 flex items-center justify-center flex-shrink-0">
                      <Brain className="h-5 w-5 text-green-500" />
                    </div>
                    <div>
                      <h4 className="font-bold mb-1">Independent AI Decisions</h4>
                      <p className="text-sm text-muted-foreground">
                        The 10-model hivemind analyzes and executes trades independently for your wallet address. Each decision is tailored to your positions.
                      </p>
                    </div>
                  </div>

                  <div className="flex items-start gap-3">
                    <div className="h-10 w-10 rounded-full bg-green-500/20 flex items-center justify-center flex-shrink-0">
                      <TrendingUp className="h-5 w-5 text-green-500" />
                    </div>
                    <div>
                      <h4 className="font-bold mb-1">Separate Performance Tracking</h4>
                      <p className="text-sm text-muted-foreground">
                        Your win rate, profit/loss, and trade history are tracked privately. Other users' wins or losses don't affect your stats.
                      </p>
                    </div>
                  </div>

                  <div className="flex items-start gap-3">
                    <div className="h-10 w-10 rounded-full bg-green-500/20 flex items-center justify-center flex-shrink-0">
                      <Lock className="h-5 w-5 text-green-500" />
                    </div>
                    <div>
                      <h4 className="font-bold mb-1">Zero Capital Mixing</h4>
                      <p className="text-sm text-muted-foreground">
                        Think of it like separate bank accounts - everyone uses the same AI system, but your funds never mix with other users.
                      </p>
                    </div>
                  </div>
                </div>

                <div className="bg-muted/50 rounded-lg p-6 border border-green-500/20">
                  <div className="flex items-start gap-4">
                    <Users className="h-6 w-6 text-green-500 flex-shrink-0 mt-1" />
                    <div>
                      <h4 className="font-bold mb-2">Real-World Example</h4>
                      <p className="text-sm text-muted-foreground">
                        If you have 1 SOL and another user has 10 SOL trading at the same time:
                      </p>
                      <ul className="text-sm text-muted-foreground mt-2 space-y-1 ml-4">
                        <li>• You trade with YOUR 1 SOL budget independently</li>
                        <li>• They trade with THEIR 10 SOL budget independently</li>
                        <li>• Both can buy the same token - positions are separate</li>
                        <li>• Your profits and losses are tracked separately</li>
                        <li>• Their account activity has zero impact on yours</li>
                      </ul>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </section>

      {/* Trust Signals */}
      <section className="py-12 bg-muted/30">
        <div className="container mx-auto px-6 lg:px-8">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8 text-center">
            <div>
              <CheckCircle2 className="h-8 w-8 text-green-500 mx-auto mb-2" />
              <p className="font-semibold">100% On-Chain</p>
              <p className="text-sm text-muted-foreground">Verifiable trades</p>
            </div>
            <div>
              <Shield className="h-8 w-8 text-blue-500 mx-auto mb-2" />
              <p className="font-semibold">Non-Custodial</p>
              <p className="text-sm text-muted-foreground">You control funds</p>
            </div>
            <div>
              <Brain className="h-8 w-8 text-purple-500 mx-auto mb-2" />
              <p className="font-semibold">10 AI Models</p>
              <p className="text-sm text-muted-foreground">Consensus voting</p>
            </div>
            <div>
              <Zap className="h-8 w-8 text-orange-500 mx-auto mb-2" />
              <p className="font-semibold">24/7 Trading</p>
              <p className="text-sm text-muted-foreground">Never miss opportunities</p>
            </div>
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="py-20">
        <div className="container mx-auto px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-4xl font-bold mb-4">Everything You Need</h2>
            <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
              Powerful tools for Solana token trading and management
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <Card className="border-primary/50 bg-gradient-to-br from-primary/10 to-primary/5">
              <CardHeader>
                <Sparkles className="h-12 w-12 text-primary mb-4" />
                <CardTitle>GigaBrain AI Trading</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <p className="text-muted-foreground">Autonomous 24/7 trading with 10-model hivemind consensus system</p>
                <ul className="space-y-1 text-sm">
                  <li>✓ Dual-mode strategy (SCALP & SWING)</li>
                  <li>✓ Auto position sizing</li>
                  <li>✓ Drawdown protection</li>
                </ul>
                <Link href="/learn" className="text-sm text-primary hover:underline">
                  Learn More →
                </Link>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <Search className="h-12 w-12 text-blue-500 mb-4" />
                <CardTitle>Token Analyzer</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <p className="text-muted-foreground">Free AI analysis on any Solana token without wallet connection</p>
                <ul className="space-y-1 text-sm">
                  <li>✓ Organic score detection</li>
                  <li>✓ Quality metrics</li>
                  <li>✓ Risk assessment</li>
                </ul>
                <Link href="/analyze" className="text-sm text-primary hover:underline">
                  Try Now →
                </Link>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <BarChart3 className="h-12 w-12 text-green-500 mb-4" />
                <CardTitle>Buyback & Burn</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <p className="text-muted-foreground">Automated token buyback and burn for deflationary tokenomics</p>
                <ul className="space-y-1 text-sm">
                  <li>✓ Flexible scheduling</li>
                  <li>✓ Jupiter integration</li>
                  <li>✓ Real-time monitoring</li>
                </ul>
                <Link href="/dashboard" className="text-sm text-primary hover:underline">
                  Get Started →
                </Link>
              </CardContent>
            </Card>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-20 bg-gradient-to-br from-primary/10 to-background">
        <div className="container mx-auto px-6 lg:px-8 text-center">
          <h2 className="text-4xl font-bold mb-4">Start Trading in 60 Seconds</h2>
          <p className="text-xl text-muted-foreground mb-8 max-w-2xl mx-auto">
            Connect your wallet, configure settings, and let GigaBrain trade for you
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <Link href="/dashboard">
              <Button size="lg" className="text-lg px-8 h-12">
                Start Free (20 Trades)
              </Button>
            </Link>
            <Link href="/stats">
              <Button size="lg" variant="outline" className="text-lg px-8 h-12">
                View Live Stats
              </Button>
            </Link>
          </div>
          <p className="text-sm text-muted-foreground mt-4">
            After 20 free trades, continue for 0.15 SOL per 2 weeks • 1% fee per trade
          </p>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t py-12">
        <div className="container mx-auto px-6 lg:px-8">
          <div className="flex flex-col md:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <Sparkles className="h-6 w-6 text-primary" />
              <span className="text-lg font-bold">GigaBrain</span>
            </div>
            <p className="text-sm text-muted-foreground">
              © 2025 GigaBrain. All trades verifiable on Solana blockchain.
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
