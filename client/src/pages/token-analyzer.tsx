import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Sparkles, Search, TrendingUp, AlertTriangle, CheckCircle, XCircle, Activity, Link as LinkIcon } from "lucide-react";
import { Link } from "wouter";

interface TokenAnalysis {
  tokenMint: string;
  symbol: string;
  name: string;
  price: number;
  volume24h: number;
  liquidity: number;
  organicScore: number;
  qualityScore: number;
  aiConfidence: number;
  recommendation: "BUY" | "HOLD" | "AVOID";
  risks: string[];
  opportunities: string[];
  analysis: string;
}

export default function TokenAnalyzer() {
  const [tokenAddress, setTokenAddress] = useState("");
  const [searchToken, setSearchToken] = useState("");

  const { data: analysis, isLoading, error } = useQuery<TokenAnalysis>({
    queryKey: ["/api/public/analyze-token", searchToken],
    enabled: searchToken.length > 0,
  });

  const handleAnalyze = () => {
    if (tokenAddress.trim()) {
      setSearchToken(tokenAddress.trim());
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleAnalyze();
    }
  };

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
            <Link href="/stats">
              <Button variant="outline" data-testid="button-view-stats">
                Live Stats
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

      <div className="container mx-auto px-4 py-12 space-y-8 max-w-4xl">
        {/* Hero Section */}
        <div className="text-center space-y-4 py-8">
          <Badge variant="outline" className="mb-4 bg-green-500/10 border-green-500/30 text-green-500">
            <Sparkles className="h-3 w-3 mr-1" />
            100% Free Forever • No Wallet Required • Unlimited Use
          </Badge>
          <h1 className="text-4xl md:text-5xl font-bold bg-gradient-to-r from-primary via-primary/80 to-primary bg-clip-text text-transparent">
            AI-Powered Token Analyzer
          </h1>
          <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
            Get instant AI analysis on any Solana token. No wallet connection required.
          </p>
        </div>

        {/* Search Input */}
        <Card className="border-primary/20">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Search className="h-5 w-5 text-primary" />
              Analyze Any Token
            </CardTitle>
            <CardDescription>
              Paste a Solana token mint address to get AI-powered analysis
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex gap-2">
              <Input
                placeholder="Enter token mint address (e.g., So11111111111111111111111111111111111111112)"
                value={tokenAddress}
                onChange={(e) => setTokenAddress(e.target.value)}
                onKeyPress={handleKeyPress}
                className="flex-1"
                data-testid="input-token-address"
              />
              <Button 
                onClick={handleAnalyze} 
                disabled={!tokenAddress.trim() || isLoading}
                data-testid="button-analyze"
              >
                {isLoading ? "Analyzing..." : "Analyze"}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              💡 Try analyzing tokens from DexScreener, PumpFun, or any Solana DEX
            </p>
          </CardContent>
        </Card>

        {/* Loading State */}
        {isLoading && (
          <Card>
            <CardContent className="py-12">
              <div className="text-center space-y-4">
                <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-primary border-r-transparent"></div>
                <p className="text-muted-foreground">Analyzing token with 12-model AI hivemind...</p>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Error State */}
        {error && (
          <Card className="border-red-500/50 bg-red-500/5">
            <CardContent className="py-8">
              <div className="text-center space-y-2">
                <XCircle className="h-12 w-12 text-red-500 mx-auto" />
                <h3 className="text-lg font-semibold text-red-500">Analysis Failed</h3>
                <p className="text-sm text-muted-foreground">
                  {(error as any)?.message || "Could not analyze this token. Please check the address and try again."}
                </p>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Analysis Results */}
        {analysis && !isLoading && (
          <div className="space-y-6">
            {/* Token Overview */}
            <Card className="border-primary/20">
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div>
                    <CardTitle className="text-2xl">{analysis.symbol || "Unknown"}</CardTitle>
                    <CardDescription>{analysis.name || "No name available"}</CardDescription>
                  </div>
                  <Badge 
                    variant={
                      analysis.recommendation === "BUY" ? "default" : 
                      analysis.recommendation === "HOLD" ? "outline" : 
                      "destructive"
                    }
                    className="text-lg px-4 py-2"
                  >
                    {analysis.recommendation}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div>
                    <p className="text-xs text-muted-foreground">Price (SOL)</p>
                    <p className="text-lg font-semibold">{analysis.price.toFixed(9)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">24h Volume</p>
                    <p className="text-lg font-semibold">${(analysis.volume24h / 1000).toFixed(1)}K</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Liquidity</p>
                    <p className="text-lg font-semibold">${(analysis.liquidity / 1000).toFixed(1)}K</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">AI Confidence</p>
                    <p className={`text-lg font-semibold ${
                      analysis.aiConfidence >= 75 ? "text-green-500" :
                      analysis.aiConfidence >= 50 ? "text-yellow-500" :
                      "text-red-500"
                    }`}>
                      {analysis.aiConfidence}%
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Quality Scores */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm font-medium text-muted-foreground">
                    Organic Score
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center gap-4">
                    <div className="text-3xl font-bold">{analysis.organicScore}/100</div>
                    <div className="flex-1">
                      <div className="h-2 bg-muted rounded-full overflow-hidden">
                        <div 
                          className={`h-full ${
                            analysis.organicScore >= 70 ? "bg-green-500" :
                            analysis.organicScore >= 40 ? "bg-yellow-500" :
                            "bg-red-500"
                          }`}
                          style={{ width: `${analysis.organicScore}%` }}
                        />
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">
                        Wash trading detection
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-sm font-medium text-muted-foreground">
                    Quality Score
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center gap-4">
                    <div className="text-3xl font-bold">{analysis.qualityScore}/100</div>
                    <div className="flex-1">
                      <div className="h-2 bg-muted rounded-full overflow-hidden">
                        <div 
                          className={`h-full ${
                            analysis.qualityScore >= 70 ? "bg-green-500" :
                            analysis.qualityScore >= 40 ? "bg-yellow-500" :
                            "bg-red-500"
                          }`}
                          style={{ width: `${analysis.qualityScore}%` }}
                        />
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">
                        Overall token quality
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* AI Analysis */}
            <Card className="border-primary/20">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Sparkles className="h-5 w-5 text-primary" />
                  AI Analysis
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-muted-foreground whitespace-pre-line">{analysis.analysis}</p>
              </CardContent>
            </Card>

            {/* Opportunities & Risks */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {analysis.opportunities.length > 0 && (
                <Card className="border-green-500/30 bg-green-500/5">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-green-500">
                      <TrendingUp className="h-5 w-5" />
                      Opportunities
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ul className="space-y-2">
                      {analysis.opportunities.map((opp, i) => (
                        <li key={i} className="flex items-start gap-2 text-sm">
                          <CheckCircle className="h-4 w-4 text-green-500 mt-0.5 flex-shrink-0" />
                          <span>{opp}</span>
                        </li>
                      ))}
                    </ul>
                  </CardContent>
                </Card>
              )}

              {analysis.risks.length > 0 && (
                <Card className="border-red-500/30 bg-red-500/5">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-red-500">
                      <AlertTriangle className="h-5 w-5" />
                      Risks
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ul className="space-y-2">
                      {analysis.risks.map((risk, i) => (
                        <li key={i} className="flex items-start gap-2 text-sm">
                          <XCircle className="h-4 w-4 text-red-500 mt-0.5 flex-shrink-0" />
                          <span>{risk}</span>
                        </li>
                      ))}
                    </ul>
                  </CardContent>
                </Card>
              )}
            </div>

            {/* View on Explorer */}
            <Card>
              <CardContent className="py-4">
                <a 
                  href={`https://solscan.io/token/${analysis.tokenMint}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-center gap-2 text-primary hover:underline"
                >
                  <LinkIcon className="h-4 w-4" />
                  View on Solscan
                </a>
              </CardContent>
            </Card>

            {/* CTA */}
            <div className="text-center py-8 space-y-4">
              <h3 className="text-2xl font-bold">Want GigaBrain to Trade This For You?</h3>
              <p className="text-muted-foreground">
                Let our AI hivemind execute trades automatically with 24/7 monitoring
              </p>
              <Link href="/dashboard">
                <Button size="lg" className="text-lg px-8" data-testid="button-start-auto-trading">
                  Start Auto-Trading
                </Button>
              </Link>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
