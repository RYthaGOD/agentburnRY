import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { WalletButton } from "@/components/wallet-button";
import { ThemeToggle } from "@/components/theme-toggle";
import { ArrowRight, Zap, Shield, Clock, BarChart3, Check } from "lucide-react";
import { Link } from "wouter";
import { PRICING } from "@shared/config";
import heroImage from "@assets/generated_images/Molten_lava_hero_background_ab43c4d3.png";
import logoImage from "@assets/generated_images/BurnBot_fire_logo_design_999d6b70.png";

export default function Landing() {
  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-50 w-full border-b border-border backdrop-blur-xl bg-background/80">
        <div className="container mx-auto flex h-16 items-center justify-between px-6 lg:px-8">
          <div className="flex items-center gap-2">
            <img src={logoImage} alt="BurnBot" className="h-8 w-8" />
            <span className="text-xl font-bold">BurnBot</span>
          </div>
          <nav className="hidden md:flex items-center gap-8">
            <a href="#features" className="text-sm font-medium hover-elevate px-3 py-2 rounded-md" data-testid="link-features">
              Features
            </a>
            <a href="#how-it-works" className="text-sm font-medium hover-elevate px-3 py-2 rounded-md" data-testid="link-how-it-works">
              How It Works
            </a>
            <a href="#pricing" className="text-sm font-medium hover-elevate px-3 py-2 rounded-md" data-testid="link-pricing">
              Pricing
            </a>
            <a href="/whitepaper" className="text-sm font-medium hover-elevate px-3 py-2 rounded-md" data-testid="link-whitepaper">
              White Paper
            </a>
          </nav>
          <div className="flex items-center gap-4">
            <ThemeToggle />
            <WalletButton />
          </div>
        </div>
      </header>

      <section className="relative flex items-center justify-center overflow-hidden" style={{ minHeight: "80vh" }}>
        <div
          className="absolute inset-0 bg-cover bg-center"
          style={{ backgroundImage: `url(${heroImage})` }}
        />
        <div className="absolute inset-0 bg-gradient-to-b from-background/60 via-background/80 to-background" />
        
        <div className="relative z-10 container mx-auto px-6 lg:px-8 py-20 md:py-32 text-center">
          <Badge className="mb-6 bg-primary/10 text-primary border-primary/20 hover:bg-primary/15" data-testid="badge-new">
            No coding required • Secure • Transparent
          </Badge>
          
          <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold tracking-tight mb-6 max-w-4xl mx-auto">
            <span className="text-foreground">Automated</span>{" "}
            <span className="bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
              Token Buyback & Burn
            </span>{" "}
            <span className="text-foreground">for Solana</span>
          </h1>
          
          <p className="text-lg md:text-xl text-muted-foreground max-w-2xl mx-auto mb-12">
            Plug-and-play system that automates your token buybacks and burns. 
            Set it up once and let the smart contract do the work.
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <Link href="/dashboard">
              <Button size="lg" className="fire-gradient ember-glow-hover group" data-testid="button-get-started">
                Get Started
                <ArrowRight className="ml-2 h-4 w-4 transition-transform group-hover:translate-x-1" />
              </Button>
            </Link>
            <Button size="lg" variant="outline" className="backdrop-blur-sm bg-background/30" data-testid="button-view-pricing">
              <a href="#pricing">View Pricing</a>
            </Button>
          </div>
        </div>
      </section>

      <section id="features" className="py-12 md:py-20 border-t border-border">
        <div className="container mx-auto px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-bold mb-4">Powerful Features</h2>
            <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
              Everything you need to manage your token buyback and burn strategy
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {[
              {
                icon: Zap,
                title: "Automated Execution",
                description: "Set your schedule and let the system handle buybacks and burns automatically. No manual intervention required.",
              },
              {
                icon: Shield,
                title: "Secure & Transparent",
                description: "All transactions are on-chain and verifiable. Your tokens stay in your custody until execution.",
              },
              {
                icon: Clock,
                title: "Flexible Scheduling",
                description: "Choose from hourly, daily, weekly schedules or create custom intervals that match your tokenomics.",
              },
              {
                icon: BarChart3,
                title: "Jupiter Integration",
                description: "Optimal swap pricing through Jupiter aggregator ensures you get the best rates for buybacks.",
              },
              {
                icon: Check,
                title: "Real-time Monitoring",
                description: "Track all transactions, burns, and treasury balance in real-time through your dashboard.",
              },
              {
                icon: Zap,
                title: "Pay as You Go",
                description: "Simple Solana-based payment system. Pay in SOL directly to get started.",
              },
            ].map((feature, index) => (
              <Card key={index} className="hover-elevate transition-all duration-200 border-card-border" data-testid={`card-feature-${index}`}>
                <CardHeader>
                  <div className="h-12 w-12 rounded-md bg-primary/10 flex items-center justify-center mb-4">
                    <feature.icon className="h-6 w-6 text-primary" />
                  </div>
                  <CardTitle className="text-xl">{feature.title}</CardTitle>
                </CardHeader>
                <CardContent>
                  <CardDescription className="text-base">{feature.description}</CardDescription>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      <section id="how-it-works" className="py-12 md:py-20 bg-card border-y border-border">
        <div className="container mx-auto px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-bold mb-4">How It Works</h2>
            <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
              Get started in 4 simple steps
            </p>
          </div>

          <div className="max-w-4xl mx-auto space-y-12">
            {[
              {
                step: "01",
                title: "Connect Your Wallet",
                description: "Connect your Solana wallet using Phantom, Solflare, or any supported wallet.",
              },
              {
                step: "02",
                title: "Configure Your Project",
                description: "Enter your token mint address and treasury wallet. Burns automatically route through the Solana incinerator. Set your buyback amount and schedule.",
              },
              {
                step: "03",
                title: "Make Payment",
                description: "Pay the service fee in SOL to activate your automated buyback system.",
              },
              {
                step: "04",
                title: "Monitor & Relax",
                description: "Watch your dashboard as the system automatically executes buybacks and burns according to your schedule.",
              },
            ].map((step, index) => (
              <div
                key={index}
                className={`flex flex-col ${index % 2 === 0 ? "md:flex-row" : "md:flex-row-reverse"} gap-8 items-center`}
                data-testid={`step-${index}`}
              >
                <div className="flex-shrink-0">
                  <div className="h-20 w-20 rounded-full bg-gradient-to-br from-primary to-accent flex items-center justify-center">
                    <span className="text-2xl font-bold text-white">{step.step}</span>
                  </div>
                </div>
                <div className="flex-1">
                  <h3 className="text-2xl font-bold mb-2">{step.title}</h3>
                  <p className="text-muted-foreground">{step.description}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="pricing" className="py-12 md:py-20">
        <div className="container mx-auto px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-bold mb-4">Simple Pricing</h2>
            <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
              Pay in SOL. No hidden fees.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 max-w-6xl mx-auto">
            {Object.entries(PRICING).map(([key, tier], index) => (
              <Card
                key={key}
                className={`relative hover-elevate transition-all duration-200 ${
                  key === "PRO" ? "border-primary shadow-lg scale-105" : "border-card-border"
                }`}
                data-testid={`card-pricing-${tier.name.toLowerCase()}`}
              >
                {key === "PRO" && (
                  <Badge className="absolute -top-3 left-1/2 -translate-x-1/2 bg-primary" data-testid="badge-recommended">
                    Recommended
                  </Badge>
                )}
                <CardHeader>
                  <CardTitle className="text-2xl">{tier.name}</CardTitle>
                  <div className="mt-4">
                    <span className="text-4xl font-bold">{tier.priceSOL}</span>
                    <span className="text-muted-foreground ml-2">SOL/month</span>
                  </div>
                </CardHeader>
                <CardContent>
                  <ul className="space-y-3">
                    {tier.features.map((feature, idx) => (
                      <li key={idx} className="flex items-start gap-2">
                        <Check className="h-5 w-5 text-primary flex-shrink-0 mt-0.5" />
                        <span className="text-sm">{feature}</span>
                      </li>
                    ))}
                  </ul>
                </CardContent>
                <CardFooter>
                  <Link href="/dashboard" className="w-full">
                    <Button
                      className={`w-full ${key === "PRO" ? "bg-accent" : ""}`}
                      variant={key === "PRO" ? "default" : "outline"}
                      data-testid={`button-select-${tier.name.toLowerCase()}`}
                    >
                      Get Started
                    </Button>
                  </Link>
                </CardFooter>
              </Card>
            ))}
          </div>
        </div>
      </section>

      <footer className="border-t border-border py-12">
        <div className="container mx-auto px-6 lg:px-8">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
            <div>
              <div className="flex items-center gap-2 mb-4">
                <img src={logoImage} alt="BurnBot" className="h-8 w-8" />
                <span className="text-xl font-bold">BurnBot</span>
              </div>
              <p className="text-sm text-muted-foreground">
                Automated token buyback and burn for Solana projects.
              </p>
            </div>
            <div>
              <h4 className="font-semibold mb-4">Product</h4>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li><a href="#features" className="hover:text-foreground">Features</a></li>
                <li><a href="#pricing" className="hover:text-foreground">Pricing</a></li>
                <li><a href="#how-it-works" className="hover:text-foreground">How It Works</a></li>
              </ul>
            </div>
            <div>
              <h4 className="font-semibold mb-4">Resources</h4>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li><a href="/whitepaper" className="hover:text-foreground">White Paper</a></li>
                <li><a href="#" className="hover:text-foreground">Documentation</a></li>
                <li><a href="#" className="hover:text-foreground">API</a></li>
                <li><a href="#" className="hover:text-foreground">Support</a></li>
              </ul>
            </div>
            <div>
              <h4 className="font-semibold mb-4">Legal</h4>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li><a href="#" className="hover:text-foreground">Privacy</a></li>
                <li><a href="#" className="hover:text-foreground">Terms</a></li>
              </ul>
            </div>
          </div>
          <div className="mt-12 pt-8 border-t border-border text-center text-sm text-muted-foreground">
            © 2025 BurnBot. All rights reserved.
          </div>
        </div>
      </footer>
    </div>
  );
}
