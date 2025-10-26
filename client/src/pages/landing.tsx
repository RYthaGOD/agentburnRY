import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { WalletButton } from "@/components/wallet-button";
import { ThemeToggle } from "@/components/theme-toggle";
import { Sparkles, TrendingUp, Search, Brain, Shield, Zap, BarChart3, CheckCircle2 } from "lucide-react";
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
          <Link href="/">
            <a className="flex items-center gap-2 hover-elevate">
              <Sparkles className="h-8 w-8 text-primary" />
              <span className="text-2xl font-bold">GigaBrain</span>
            </a>
          </Link>
          <nav className="hidden md:flex items-center gap-6">
            <Link href="/stats">
              <a className="text-sm font-medium hover-elevate px-3 py-2 rounded-md" data-testid="link-stats">
                Live Stats
              </a>
            </Link>
            <Link href="/analyze">
              <a className="text-sm font-medium hover-elevate px-3 py-2 rounded-md" data-testid="link-analyze">
                Token Analyzer
              </a>
            </Link>
            <Link href="/learn">
              <a className="text-sm font-medium hover-elevate px-3 py-2 rounded-md" data-testid="link-learn">
                How It Works
              </a>
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
                  Try Token Analyzer
                </Button>
              </Link>
            </div>
            
            <p className="text-sm text-muted-foreground">
              First 10 trades free • No credit card • Non-custodial
            </p>
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
                <Link href="/learn">
                  <a className="text-sm text-primary hover:underline">Learn More →</a>
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
                <Link href="/analyze">
                  <a className="text-sm text-primary hover:underline">Try Now →</a>
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
                <Link href="/dashboard">
                  <a className="text-sm text-primary hover:underline">Get Started →</a>
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
                Get Started Free
              </Button>
            </Link>
            <Link href="/stats">
              <Button size="lg" variant="outline" className="text-lg px-8 h-12">
                View Live Performance
              </Button>
            </Link>
          </div>
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
