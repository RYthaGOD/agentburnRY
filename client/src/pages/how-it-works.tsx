import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Sparkles, Brain, Zap, Shield, TrendingUp, Activity, CheckCircle2 } from "lucide-react";
import { Link } from "wouter";

export default function HowItWorks() {
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
            <Link href="/stats">
              <Button variant="outline">Live Stats</Button>
            </Link>
            <Link href="/analyze">
              <Button variant="outline">Token Analyzer</Button>
            </Link>
            <Link href="/dashboard">
              <Button variant="default" data-testid="button-start">Start Trading</Button>
            </Link>
          </div>
        </div>
      </div>

      <div className="container mx-auto px-4 py-12 space-y-12">
        {/* Hero */}
        <div className="text-center space-y-4 py-8">
          <Badge variant="outline" className="mb-4">
            <Brain className="h-3 w-3 mr-1" />
            Understanding GigaBrain AI
          </Badge>
          <h1 className="text-4xl md:text-5xl font-bold bg-gradient-to-r from-primary via-primary/80 to-primary bg-clip-text text-transparent">
            How GigaBrain Works
          </h1>
          <p className="text-xl text-muted-foreground max-w-3xl mx-auto">
            A 10-model AI hivemind that trades Solana tokens 24/7, automatically managing your capital with human-level decision making.
          </p>
        </div>

        {/* Core Concept */}
        <Card className="border-primary/20">
          <CardHeader>
            <CardTitle className="text-2xl flex items-center gap-2">
              <Sparkles className="h-6 w-6 text-primary" />
              The 10-Model Hivemind System
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-muted-foreground">
              Unlike other bots that rely on a single AI model or simple rule-based logic, GigaBrain uses a consensus system with 10 different AI models voting on every trade decision.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-6">
              <div className="p-4 rounded-lg bg-muted/50 space-y-2">
                <h3 className="font-semibold">Multiple AI Models</h3>
                <p className="text-sm text-muted-foreground">
                  DeepSeek, Cerebras, Google Gemini, OpenAI, Groq, and 5 more models analyze each token independently
                </p>
              </div>
              <div className="p-4 rounded-lg bg-muted/50 space-y-2">
                <h3 className="font-semibold">Majority Vote System</h3>
                <p className="text-sm text-muted-foreground">
                  Only trades when majority of models agree. Higher consensus = higher confidence trades
                </p>
              </div>
              <div className="p-4 rounded-lg bg-muted/50 space-y-2">
                <h3 className="font-semibold">Automatic Failover</h3>
                <p className="text-sm text-muted-foreground">
                  If a model fails or is rate-limited, system automatically uses backup models
                </p>
              </div>
              <div className="p-4 rounded-lg bg-muted/50 space-y-2">
                <h3 className="font-semibold">Health-Based Selection</h3>
                <p className="text-sm text-muted-foreground">
                  Models are scored 0-100 based on recent performance. Low-scoring models are deprioritized
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Trading Strategy */}
        <div className="space-y-6">
          <h2 className="text-3xl font-bold text-center">Dual-Mode Trading Strategy</h2>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Card className="border-blue-500/30 bg-blue-500/5">
              <CardHeader>
                <Badge className="w-fit mb-2 bg-blue-500">SCALP MODE</Badge>
                <CardTitle>62-79% AI Confidence</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-start gap-2">
                  <CheckCircle2 className="h-5 w-5 text-blue-500 mt-0.5 flex-shrink-0" />
                  <div>
                    <p className="font-semibold">Quick Profits</p>
                    <p className="text-sm text-muted-foreground">3-6% of portfolio, 30-minute max hold, +4-8% targets</p>
                  </div>
                </div>
                <div className="flex items-start gap-2">
                  <CheckCircle2 className="h-5 w-5 text-blue-500 mt-0.5 flex-shrink-0" />
                  <div>
                    <p className="font-semibold">Tight Stop-Loss</p>
                    <p className="text-sm text-muted-foreground">-8% to -12% protection, exit fast if wrong</p>
                  </div>
                </div>
                <div className="flex items-start gap-2">
                  <CheckCircle2 className="h-5 w-5 text-blue-500 mt-0.5 flex-shrink-0" />
                  <div>
                    <p className="font-semibold">High Frequency</p>
                    <p className="text-sm text-muted-foreground">Scans every 2 minutes for opportunities</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="border-green-500/30 bg-green-500/5">
              <CardHeader>
                <Badge className="w-fit mb-2 bg-green-500">SWING MODE</Badge>
                <CardTitle>80%+ AI Confidence</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-start gap-2">
                  <CheckCircle2 className="h-5 w-5 text-green-500 mt-0.5 flex-shrink-0" />
                  <div>
                    <p className="font-semibold">Big Winners</p>
                    <p className="text-sm text-muted-foreground">5-9% of portfolio, 24-hour max hold, +15-50% targets</p>
                  </div>
                </div>
                <div className="flex items-start gap-2">
                  <CheckCircle2 className="h-5 w-5 text-green-500 mt-0.5 flex-shrink-0" />
                  <div>
                    <p className="font-semibold">Wider Stop-Loss</p>
                    <p className="text-sm text-muted-foreground">-15% to -25%, room for volatility</p>
                  </div>
                </div>
                <div className="flex items-start gap-2">
                  <CheckCircle2 className="h-5 w-5 text-green-500 mt-0.5 flex-shrink-0" />
                  <div>
                    <p className="font-semibold">Deep Analysis</p>
                    <p className="text-sm text-muted-foreground">Full 10-model scan every 15 minutes</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>

        {/* Safety Features */}
        <Card className="border-orange-500/20">
          <CardHeader>
            <CardTitle className="text-2xl flex items-center gap-2">
              <Shield className="h-6 w-6 text-orange-500" />
              Built-In Safety Systems
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-2">
                <h3 className="font-semibold flex items-center gap-2">
                  <Activity className="h-5 w-5 text-orange-500" />
                  Portfolio Drawdown Protection
                </h3>
                <p className="text-sm text-muted-foreground">
                  Automatically pauses trading if portfolio drops 20% from peak. Resumes at -15% recovery.
                </p>
              </div>
              <div className="space-y-2">
                <h3 className="font-semibold flex items-center gap-2">
                  <Zap className="h-5 w-5 text-orange-500" />
                  Bundle Activity Detection
                </h3>
                <p className="text-sm text-muted-foreground">
                  Analyzes 6 pump-and-dump signals. Auto-blacklists tokens with 85+ suspicion score.
                </p>
              </div>
              <div className="space-y-2">
                <h3 className="font-semibold flex items-center gap-2">
                  <TrendingUp className="h-5 w-5 text-orange-500" />
                  Position Size Limits
                </h3>
                <p className="text-sm text-muted-foreground">
                  Max 25% of portfolio in any single token. Automatic diversification across positions.
                </p>
              </div>
              <div className="space-y-2">
                <h3 className="font-semibold flex items-center gap-2">
                  <Shield className="h-5 w-5 text-orange-500" />
                  Quality Filters
                </h3>
                <p className="text-sm text-muted-foreground">
                  80%+ organic score, 70%+ quality, $25K+ volume, $20K+ liquidity, 24h+ age, 100+ holders minimum.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* How to Get Started */}
        <Card className="border-primary/20 bg-gradient-to-br from-primary/5 to-primary/10">
          <CardHeader>
            <CardTitle className="text-2xl">Get Started in 3 Steps</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-start gap-4">
              <div className="flex-shrink-0 w-10 h-10 rounded-full bg-primary flex items-center justify-center text-lg font-bold">
                1
              </div>
              <div>
                <h3 className="font-semibold">Connect Your Wallet</h3>
                <p className="text-sm text-muted-foreground">
                  Use Phantom, Solflare, or any Solana wallet. You stay in control of your funds.
                </p>
              </div>
            </div>
            <div className="flex items-start gap-4">
              <div className="flex-shrink-0 w-10 h-10 rounded-full bg-primary flex items-center justify-center text-lg font-bold">
                2
              </div>
              <div>
                <h3 className="font-semibold">Configure Your Settings</h3>
                <p className="text-sm text-muted-foreground">
                  Set your treasury wallet, risk tolerance, and let AI manage position sizes automatically.
                </p>
              </div>
            </div>
            <div className="flex items-start gap-4">
              <div className="flex-shrink-0 w-10 h-10 rounded-full bg-primary flex items-center justify-center text-lg font-bold">
                3
              </div>
              <div>
                <h3 className="font-semibold">Enable & Let It Trade</h3>
                <p className="text-sm text-muted-foreground">
                  Turn on GigaBrain and watch it trade 24/7. Check performance anytime on your dashboard.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* CTA */}
        <div className="text-center py-12 space-y-6">
          <h2 className="text-3xl font-bold">Ready to Start?</h2>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            Join traders using AI-powered automation. Start with 0.1 SOL.
          </p>
          <div className="flex items-center justify-center gap-4">
            <Link href="/dashboard">
              <Button size="lg" className="text-lg px-8" data-testid="button-get-started-cta">
                Get Started Now
              </Button>
            </Link>
            <Link href="/stats">
              <Button size="lg" variant="outline" className="text-lg px-8" data-testid="button-view-performance">
                View Live Performance
              </Button>
            </Link>
          </div>
          <p className="text-sm text-muted-foreground">
            First 10 trades free • No credit card required
          </p>
        </div>
      </div>
    </div>
  );
}
