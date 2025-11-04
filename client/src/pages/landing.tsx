import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { WalletButton } from "@/components/wallet-button";
import { ThemeToggle } from "@/components/theme-toggle";
import { Sparkles, Brain, Shield, Zap, Database, DollarSign, Flame, Lock, GitFork, CheckCircle2 } from "lucide-react";
import { Link } from "wouter";

export default function Landing() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-background via-background to-muted/20">
      {/* Header */}
      <header className="sticky top-0 z-50 w-full border-b border-border backdrop-blur-xl bg-background/80">
        <div className="container mx-auto flex h-16 items-center justify-between px-6 lg:px-8">
          <Link href="/" className="flex items-center gap-2 hover-elevate">
            <Flame className="h-8 w-8 text-primary" />
            <span className="text-2xl font-bold">GigaBrain</span>
          </Link>
          <nav className="hidden md:flex items-center gap-6">
            <a href="#features" className="text-sm font-medium hover-elevate px-3 py-2 rounded-md cursor-pointer">
              Features
            </a>
            <a href="#how-it-works" className="text-sm font-medium hover-elevate px-3 py-2 rounded-md cursor-pointer">
              How It Works
            </a>
            <a href="#tech-stack" className="text-sm font-medium hover-elevate px-3 py-2 rounded-md cursor-pointer">
              Tech Stack
            </a>
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
          <div className="text-center space-y-8">
            {/* Hackathon Badge */}
            <Badge variant="outline" className="mb-4 bg-primary/20 border-primary/40 text-primary font-semibold px-6 py-2">
              <Sparkles className="h-4 w-4 mr-2" />
              Solana x402 Hackathon Submission
            </Badge>
            
            <h1 className="text-5xl md:text-6xl lg:text-7xl font-bold tracking-tight max-w-5xl mx-auto leading-tight">
              <span className="bg-gradient-to-r from-orange-500 via-red-500 to-pink-500 bg-clip-text text-transparent">
                Agent Burn System
              </span>
              <br />
              <span className="text-foreground">Powered by x402 Agent Economy</span>
            </h1>
            
            <p className="text-xl md:text-2xl text-muted-foreground max-w-3xl mx-auto leading-relaxed">
              Demonstrating the <span className="text-primary font-semibold">x402 agent economy</span>: AI agents autonomously pay for <span className="text-primary font-semibold">Switchboard oracle feeds</span>, analyze token metrics with <span className="text-primary font-semibold">DeepSeek V3</span>, and execute MEV-protected burns via <span className="text-primary font-semibold">Jito BAM bundles</span>. Built on Solana devnet for live hackathon demonstration.
            </p>

            {/* Key Metrics */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 max-w-4xl mx-auto py-8">
              <div className="text-center p-6 rounded-lg bg-gradient-to-br from-primary/10 to-primary/5 border border-primary/20">
                <DollarSign className="h-8 w-8 text-primary mx-auto mb-2" />
                <p className="text-3xl font-bold text-primary">$0.01</p>
                <p className="text-sm text-muted-foreground">Total x402 Cost (2 Payments)</p>
              </div>
              <div className="text-center p-6 rounded-lg bg-gradient-to-br from-green-500/10 to-green-500/5 border border-green-500/20">
                <Database className="h-8 w-8 text-green-500 mx-auto mb-2" />
                <p className="text-3xl font-bold text-green-500">Switchboard</p>
                <p className="text-sm text-muted-foreground">Verifiable On-Chain Oracles</p>
              </div>
              <div className="text-center p-6 rounded-lg bg-gradient-to-br from-purple-500/10 to-purple-500/5 border border-purple-500/20">
                <Lock className="h-8 w-8 text-purple-500 mx-auto mb-2" />
                <p className="text-3xl font-bold text-purple-500">Secured</p>
                <p className="text-sm text-muted-foreground">Replay Attack Prevention</p>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row items-center justify-center gap-4 pt-4">
              <Link href="/agent-burn">
                <Button size="lg" className="text-lg px-8 h-12 gap-2" data-testid="button-start-burn">
                  <Flame className="h-5 w-5" />
                  Try Agent Burn Demo
                </Button>
              </Link>
              <a href="#how-it-works">
                <Button size="lg" variant="outline" className="text-lg px-8 h-12" data-testid="button-learn-more">
                  Learn How It Works
                </Button>
              </a>
            </div>
            
            <div className="flex items-center justify-center gap-8 pt-4 text-sm text-muted-foreground">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-green-500" />
                <span>Devnet Ready</span>
              </div>
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-green-500" />
                <span>No Private Keys</span>
              </div>
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-green-500" />
                <span>Open Source</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section id="features" className="py-20 bg-muted/40">
        <div className="container mx-auto px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-4xl md:text-5xl font-bold mb-4">
              Complete x402 Agent Economy
            </h2>
            <p className="text-xl text-muted-foreground max-w-3xl mx-auto">
              Demonstrating autonomous AI agents paying for premium services with x402 micropayments
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
            {/* Feature 1: Switchboard Oracle */}
            <Card className="hover-elevate">
              <CardHeader>
                <Database className="h-12 w-12 text-primary mb-4" />
                <CardTitle className="text-2xl">Switchboard Oracle</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <p className="text-muted-foreground">
                  AI agents access premium on-chain data feeds via x402 micropayments
                </p>
                <ul className="space-y-2 text-sm">
                  <li className="flex items-start gap-2">
                    <CheckCircle2 className="h-4 w-4 text-green-500 mt-0.5" />
                    <span>SOL/USD price from multiple sources</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <CheckCircle2 className="h-4 w-4 text-green-500 mt-0.5" />
                    <span>Token liquidity & 24h volume metrics</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <CheckCircle2 className="h-4 w-4 text-green-500 mt-0.5" />
                    <span>Cryptographically verified on-chain data</span>
                  </li>
                </ul>
              </CardContent>
            </Card>

            {/* Feature 2: x402 Micropayments */}
            <Card className="hover-elevate">
              <CardHeader>
                <DollarSign className="h-12 w-12 text-green-500 mb-4" />
                <CardTitle className="text-2xl">x402 Micropayments</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <p className="text-muted-foreground">
                  HTTP 402 payment protocol enables AI-to-AI service payments
                </p>
                <ul className="space-y-2 text-sm">
                  <li className="flex items-start gap-2">
                    <CheckCircle2 className="h-4 w-4 text-green-500 mt-0.5" />
                    <span>$0.005 USDC per premium oracle feed</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <CheckCircle2 className="h-4 w-4 text-green-500 mt-0.5" />
                    <span>$0.005 USDC for burn execution service</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <CheckCircle2 className="h-4 w-4 text-green-500 mt-0.5" />
                    <span>All payments tracked in database</span>
                  </li>
                </ul>
              </CardContent>
            </Card>

            {/* Feature 3: DeepSeek AI */}
            <Card className="hover-elevate">
              <CardHeader>
                <Brain className="h-12 w-12 text-purple-500 mb-4" />
                <CardTitle className="text-2xl">DeepSeek V3 AI</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <p className="text-muted-foreground">
                  Advanced AI analyzes burn requests with oracle data and configurable criteria
                </p>
                <ul className="space-y-2 text-sm">
                  <li className="flex items-start gap-2">
                    <CheckCircle2 className="h-4 w-4 text-green-500 mt-0.5" />
                    <span>Confidence threshold analysis (0-100%)</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <CheckCircle2 className="h-4 w-4 text-green-500 mt-0.5" />
                    <span>Liquidity & volume risk assessment</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <CheckCircle2 className="h-4 w-4 text-green-500 mt-0.5" />
                    <span>Autonomous approve/reject decisions</span>
                  </li>
                </ul>
              </CardContent>
            </Card>

            {/* Feature 4: Jito BAM */}
            <Card className="hover-elevate">
              <CardHeader>
                <Shield className="h-12 w-12 text-blue-500 mb-4" />
                <CardTitle className="text-2xl">Jito BAM Bundles</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <p className="text-muted-foreground">
                  Atomic swap + burn execution with full MEV protection
                </p>
                <ul className="space-y-2 text-sm">
                  <li className="flex items-start gap-2">
                    <CheckCircle2 className="h-4 w-4 text-green-500 mt-0.5" />
                    <span>Both transactions succeed or fail together</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <CheckCircle2 className="h-4 w-4 text-green-500 mt-0.5" />
                    <span>Protected from front-running attacks</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <CheckCircle2 className="h-4 w-4 text-green-500 mt-0.5" />
                    <span>Guaranteed atomic execution</span>
                  </li>
                </ul>
              </CardContent>
            </Card>

            {/* Feature 5: On-Chain Programs */}
            <Card className="hover-elevate">
              <CardHeader>
                <GitFork className="h-12 w-12 text-orange-500 mb-4" />
                <CardTitle className="text-2xl">Anchor/Rust Programs</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <p className="text-muted-foreground">
                  Trustless on-chain burn execution with verified program logic
                </p>
                <ul className="space-y-2 text-sm">
                  <li className="flex items-start gap-2">
                    <CheckCircle2 className="h-4 w-4 text-green-500 mt-0.5" />
                    <span>Immutable burn logic on Solana</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <CheckCircle2 className="h-4 w-4 text-green-500 mt-0.5" />
                    <span>Multi-signature authorization support</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <CheckCircle2 className="h-4 w-4 text-green-500 mt-0.5" />
                    <span>Auditable transaction history</span>
                  </li>
                </ul>
              </CardContent>
            </Card>

            {/* Feature 6: Security Infrastructure */}
            <Card className="hover-elevate">
              <CardHeader>
                <Lock className="h-12 w-12 text-red-500 mb-4" />
                <CardTitle className="text-2xl">Security Infrastructure</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <p className="text-muted-foreground">
                  Production-grade security following x402 template best practices
                </p>
                <ul className="space-y-2 text-sm">
                  <li className="flex items-start gap-2">
                    <CheckCircle2 className="h-4 w-4 text-green-500 mt-0.5" />
                    <span>Replay attack prevention (SHA-256 sig hashing)</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <CheckCircle2 className="h-4 w-4 text-green-500 mt-0.5" />
                    <span>x402 payment caps & validation</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <CheckCircle2 className="h-4 w-4 text-green-500 mt-0.5" />
                    <span>Rate limiting & DDoS protection</span>
                  </li>
                </ul>
              </CardContent>
            </Card>

            {/* Feature 7: No-Code Dashboard */}
            <Card className="hover-elevate">
              <CardHeader>
                <Zap className="h-12 w-12 text-yellow-500 mb-4" />
                <CardTitle className="text-2xl">No-Code Dashboard</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <p className="text-muted-foreground">
                  Configure burn criteria without writing a single line of code
                </p>
                <ul className="space-y-2 text-sm">
                  <li className="flex items-start gap-2">
                    <CheckCircle2 className="h-4 w-4 text-green-500 mt-0.5" />
                    <span>Set AI confidence thresholds</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <CheckCircle2 className="h-4 w-4 text-green-500 mt-0.5" />
                    <span>Configure max burn percentages</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <CheckCircle2 className="h-4 w-4 text-green-500 mt-0.5" />
                    <span>Real-time analytics & monitoring</span>
                  </li>
                </ul>
              </CardContent>
            </Card>
          </div>
        </div>
      </section>

      {/* How It Works Section */}
      <section id="how-it-works" className="py-20">
        <div className="container mx-auto px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-4xl md:text-5xl font-bold mb-4">
              How It Works
            </h2>
            <p className="text-xl text-muted-foreground max-w-3xl mx-auto">
              Complete x402 agent economy workflow in 5 autonomous steps
            </p>
          </div>

          <div className="max-w-4xl mx-auto space-y-8">
            {/* Step 0 */}
            <div className="flex gap-6 items-start">
              <div className="flex-shrink-0 w-12 h-12 rounded-full bg-primary/20 flex items-center justify-center border-2 border-primary">
                <span className="text-xl font-bold text-primary">0</span>
              </div>
              <div className="flex-1">
                <h3 className="text-2xl font-bold mb-2">Fetch Oracle Data (x402 Payment #1)</h3>
                <p className="text-muted-foreground mb-3">
                  AI agent pays <span className="text-primary font-semibold">$0.005 USDC</span> to access Switchboard oracle feeds (SOL/USD price, token liquidity, 24h volume). Data is cryptographically verified on-chain.
                </p>
                <Badge variant="outline" className="bg-primary/10 border-primary/40">
                  <Database className="h-3 w-3 mr-1" />
                  Switchboard Oracle
                </Badge>
              </div>
            </div>

            {/* Step 1 */}
            <div className="flex gap-6 items-start">
              <div className="flex-shrink-0 w-12 h-12 rounded-full bg-purple-500/20 flex items-center justify-center border-2 border-purple-500">
                <span className="text-xl font-bold text-purple-500">1</span>
              </div>
              <div className="flex-1">
                <h3 className="text-2xl font-bold mb-2">AI Analysis with Oracle Data</h3>
                <p className="text-muted-foreground mb-3">
                  DeepSeek V3 analyzes burn request using verifiable oracle metrics. Evaluates liquidity risk, volume trends, and user-configured criteria (confidence threshold, max burn %, sentiment requirements).
                </p>
                <Badge variant="outline" className="bg-purple-500/10 border-purple-500/40">
                  <Brain className="h-3 w-3 mr-1" />
                  DeepSeek V3
                </Badge>
              </div>
            </div>

            {/* Step 2 */}
            <div className="flex gap-6 items-start">
              <div className="flex-shrink-0 w-12 h-12 rounded-full bg-green-500/20 flex items-center justify-center border-2 border-green-500">
                <span className="text-xl font-bold text-green-500">2</span>
              </div>
              <div className="flex-1">
                <h3 className="text-2xl font-bold mb-2">x402 Burn Service Payment (Payment #2)</h3>
                <p className="text-muted-foreground mb-3">
                  If AI approves, GigaBrain AI pays BurnBot <span className="text-green-500 font-semibold">$0.005 USDC</span> for burn execution service. This demonstrates the x402 agent economy: AI-to-AI service payments.
                </p>
                <Badge variant="outline" className="bg-green-500/10 border-green-500/40">
                  <DollarSign className="h-3 w-3 mr-1" />
                  x402 Protocol
                </Badge>
              </div>
            </div>

            {/* Step 3 */}
            <div className="flex gap-6 items-start">
              <div className="flex-shrink-0 w-12 h-12 rounded-full bg-blue-500/20 flex items-center justify-center border-2 border-blue-500">
                <span className="text-xl font-bold text-blue-500">3</span>
              </div>
              <div className="flex-1">
                <h3 className="text-2xl font-bold mb-2">Jupiter Swap Execution</h3>
                <p className="text-muted-foreground mb-3">
                  BurnBot swaps SOL for target token using Jupiter's aggregated liquidity. Optimizes routing across all Solana DEXs for best execution price.
                </p>
                <Badge variant="outline" className="bg-blue-500/10 border-blue-500/40">
                  Jupiter Aggregator
                </Badge>
              </div>
            </div>

            {/* Step 4 */}
            <div className="flex gap-6 items-start">
              <div className="flex-shrink-0 w-12 h-12 rounded-full bg-orange-500/20 flex items-center justify-center border-2 border-orange-500">
                <span className="text-xl font-bold text-orange-500">4</span>
              </div>
              <div className="flex-1">
                <h3 className="text-2xl font-bold mb-2">Atomic Burn via Jito BAM</h3>
                <p className="text-muted-foreground mb-3">
                  Swap + burn bundled atomically in Jito BAM. Both transactions succeed together or fail together. Complete MEV protection prevents front-running attacks.
                </p>
                <Badge variant="outline" className="bg-orange-500/10 border-orange-500/40">
                  <Shield className="h-3 w-3 mr-1" />
                  Jito BAM
                </Badge>
              </div>
            </div>
          </div>

          <div className="text-center mt-12">
            <p className="text-lg text-muted-foreground mb-4">
              Total x402 Cost: <span className="text-primary font-bold">$0.01 USDC</span> (2 micropayments)
            </p>
            <Link href="/agent-burn">
              <Button size="lg" className="gap-2" data-testid="button-try-demo">
                <Flame className="h-5 w-5" />
                Try Demo on Devnet
              </Button>
            </Link>
          </div>
        </div>
      </section>

      {/* Tech Stack Section */}
      <section id="tech-stack" className="py-20 bg-muted/40">
        <div className="container mx-auto px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-4xl md:text-5xl font-bold mb-4">
              Tech Stack
            </h2>
            <p className="text-xl text-muted-foreground max-w-3xl mx-auto">
              Built on cutting-edge Solana infrastructure for the x402 hackathon
            </p>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6 max-w-5xl mx-auto">
            {[
              { name: "Switchboard", desc: "Decentralized Oracle" },
              { name: "x402 Protocol", desc: "HTTP Micropayments" },
              { name: "DeepSeek V3", desc: "AI Decision Engine" },
              { name: "Jito BAM", desc: "MEV Protection" },
              { name: "Jupiter", desc: "DEX Aggregator" },
              { name: "Anchor", desc: "Solana Framework" },
              { name: "Rust", desc: "On-Chain Programs" },
              { name: "React + TypeScript", desc: "Frontend Dashboard" },
            ].map((tech) => (
              <Card key={tech.name} className="text-center hover-elevate">
                <CardContent className="pt-6">
                  <h4 className="font-bold text-lg mb-1">{tech.name}</h4>
                  <p className="text-sm text-muted-foreground">{tech.desc}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-20">
        <div className="container mx-auto px-6 lg:px-8">
          <div className="max-w-4xl mx-auto text-center space-y-8 p-12 rounded-2xl bg-gradient-to-br from-primary/10 via-primary/5 to-background border border-primary/20">
            <h2 className="text-4xl md:text-5xl font-bold">
              Ready to See the x402 Agent Economy?
            </h2>
            <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
              Connect your Solana wallet (on devnet) and try an autonomous agentic burn with real Switchboard oracle data and x402 micropayments.
            </p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
              <Link href="/agent-burn">
                <Button size="lg" className="text-lg px-8 h-12 gap-2" data-testid="button-cta-burn">
                  <Flame className="h-5 w-5" />
                  Start Agent Burn
                </Button>
              </Link>
              <Link href="/dashboard">
                <Button size="lg" variant="outline" className="text-lg px-8 h-12" data-testid="button-cta-dashboard">
                  View Dashboard
                </Button>
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border py-12 bg-muted/40">
        <div className="container mx-auto px-6 lg:px-8">
          <div className="flex flex-col md:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <Flame className="h-6 w-6 text-primary" />
              <span className="font-bold text-lg">GigaBrain</span>
            </div>
            <p className="text-sm text-muted-foreground">
              Solana x402 Hackathon Submission • Built with Switchboard, x402, DeepSeek, and Jito
            </p>
            <div className="flex items-center gap-4">
              <Badge variant="outline">Devnet</Badge>
              <Badge variant="outline">Open Source</Badge>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
