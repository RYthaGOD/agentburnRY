import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Flame, Clock, Wallet as WalletIcon, Activity, TrendingUp, ArrowRight, Crown, RefreshCw, Settings, FileText, BarChart3, Brain, Zap, ExternalLink } from "lucide-react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import type { Project, Transaction } from "@shared/schema";
import { formatSchedule } from "@/lib/schedule-utils";
import { WHITELISTED_WALLETS } from "@shared/config";
import { useWallet } from '@solana/wallet-adapter-react';
import { queryClient } from "@/lib/queryClient";

export default function Dashboard() {
  const { publicKey } = useWallet();
  const walletAddress = publicKey?.toBase58();

  const { data: projects, isLoading: projectsLoading } = useQuery<Project[]>({
    queryKey: ["/api/projects", "owner", walletAddress],
    queryFn: async () => {
      if (!walletAddress) return [];
      const response = await fetch(`/api/projects/owner/${walletAddress}`);
      if (!response.ok) throw new Error('Failed to fetch projects');
      return response.json();
    },
    enabled: !!walletAddress,
  });

  const { data: recentTransactions, isLoading: transactionsLoading } = useQuery<Transaction[]>({
    queryKey: ["/api/transactions/recent"],
  });

  const activeProjects = projects?.filter(p => p.isActive) || [];
  const allProjects = projects || [];

  const stats = [
    {
      title: "Active Projects",
      value: activeProjects.length,
      icon: Flame,
      description: "Currently running",
      color: "text-primary",
    },
    {
      title: "Next Burn",
      value: "2h 34m",
      icon: Clock,
      description: "Scheduled execution",
      color: "text-accent",
    },
    {
      title: "Total Burned",
      value: "1.2M",
      icon: TrendingUp,
      description: "Tokens burned to date",
      color: "text-chart-5",
    },
    {
      title: "Treasury Balance",
      value: "5.8 SOL",
      icon: WalletIcon,
      description: "Available for buybacks",
      color: "text-chart-2",
    },
  ];

  if (projectsLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="animate-spin w-8 h-8 border-4 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  if (!projects || projects.length === 0) {
    return (
      <div className="flex items-center justify-center h-full p-8">
        <Card className="max-w-md w-full">
          <CardHeader>
            <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-4">
              <Flame className="h-6 w-6 text-primary" />
            </div>
            <CardTitle className="text-center">No Projects Yet</CardTitle>
            <CardDescription className="text-center">
              Get started by creating your first automated buyback and burn project
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Link href="/dashboard/new">
              <Button className="w-full bg-accent" data-testid="button-create-first-project">
                Create Your First Project
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  const handleRefresh = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/projects"] });
    queryClient.invalidateQueries({ queryKey: ["/api/transactions/recent"] });
  };

  return (
    <div className="space-y-8">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold mb-2" data-testid="heading-dashboard">Dashboard</h1>
          <p className="text-muted-foreground">Monitor your automated buyback and burn operations</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Button variant="outline" size="sm" onClick={handleRefresh} data-testid="button-refresh">
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh
          </Button>
          <Link href="/learn">
            <Button variant="outline" size="sm" data-testid="button-how-it-works">
              <FileText className="h-4 w-4 mr-2" />
              How It Works
            </Button>
          </Link>
          <Link href="/stats">
            <Button variant="outline" size="sm" data-testid="button-stats">
              <BarChart3 className="h-4 w-4 mr-2" />
              Live Stats
            </Button>
          </Link>
          <Link href="/dashboard/settings">
            <Button variant="outline" size="sm" data-testid="button-settings">
              <Settings className="h-4 w-4 mr-2" />
              Settings
            </Button>
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map((stat, index) => (
          <Card key={index} data-testid={`card-stat-${index}`}>
            <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">{stat.title}</CardTitle>
              <stat.icon className={`h-4 w-4 ${stat.color}`} />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold" data-testid={`stat-value-${index}`}>{stat.value}</div>
              <p className="text-xs text-muted-foreground mt-1">{stat.description}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Quick Actions for GigaBrain AI Bot */}
      <Card className="border-2 border-primary/30 bg-gradient-to-br from-primary/10 to-background">
        <CardHeader>
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-3">
              <div className="h-12 w-12 rounded-full bg-primary/20 flex items-center justify-center">
                <Brain className="h-6 w-6 text-primary" />
              </div>
              <div>
                <CardTitle className="flex items-center gap-2">
                  GigaBrain AI Trading
                  <Badge variant="outline" className="bg-primary/10">
                    12 AI Models
                  </Badge>
                </CardTitle>
                <CardDescription>Autonomous trading bot with hivemind AI</CardDescription>
              </div>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <Link href="/dashboard/ai-bot">
                <Button size="sm" data-testid="button-ai-bot-dashboard">
                  <Brain className="h-4 w-4 mr-2" />
                  Open AI Bot
                </Button>
              </Link>
              <Link href="/analyze">
                <Button variant="outline" size="sm" data-testid="button-analyze-token">
                  <Zap className="h-4 w-4 mr-2" />
                  Analyze Token
                </Button>
              </Link>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="text-center p-4 rounded-lg bg-background/50">
              <p className="text-sm text-muted-foreground mb-1">Trading Mode</p>
              <p className="text-lg font-bold text-primary">Tri-Mode</p>
            </div>
            <div className="text-center p-4 rounded-lg bg-background/50">
              <p className="text-sm text-muted-foreground mb-1">AI Models</p>
              <p className="text-lg font-bold">12 Active</p>
            </div>
            <div className="text-center p-4 rounded-lg bg-background/50">
              <p className="text-sm text-muted-foreground mb-1">Team Rotation</p>
              <p className="text-lg font-bold">4 Teams</p>
            </div>
            <div className="text-center p-4 rounded-lg bg-background/50">
              <p className="text-sm text-muted-foreground mb-1">Status</p>
              <p className="text-lg font-bold text-green-500">Active</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>Buyback & Burn Projects</CardTitle>
                  <CardDescription>Your configured automated buyback projects</CardDescription>
                </div>
                <Link href="/dashboard/new">
                  <Button size="sm" data-testid="button-new-project">
                    <Flame className="mr-2 h-4 w-4" />
                    New Project
                  </Button>
                </Link>
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {allProjects.map((project) => (
                  <div
                    key={project.id}
                    className="flex items-center justify-between p-4 border border-border rounded-md hover-elevate gap-4"
                    data-testid={`project-${project.id}`}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <h3 className="font-semibold">{project.name}</h3>
                        <Badge variant={project.isActive ? "default" : "secondary"} className="text-xs">
                          {project.isActive ? "Active" : "Paused"}
                        </Badge>
                        {WHITELISTED_WALLETS.includes(project.ownerWalletAddress) && (
                          <Badge variant="outline" className="text-xs gap-1">
                            <Crown className="h-3 w-3" />
                            Free Access
                          </Badge>
                        )}
                      </div>
                      <p className="text-sm text-muted-foreground font-mono truncate">
                        {project.tokenMintAddress.slice(0, 8)}...{project.tokenMintAddress.slice(-6)}
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">
                        Schedule: {formatSchedule(project.schedule)}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0 flex-wrap">
                      <Link href={`/dashboard/projects/${project.id}`}>
                        <Button size="sm" data-testid={`button-view-${project.id}`}>
                          <Settings className="h-4 w-4 mr-2" />
                          Manage
                        </Button>
                      </Link>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-8">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>Recent Activity</CardTitle>
                  <CardDescription>Latest transactions</CardDescription>
                </div>
                <Button variant="outline" size="sm" onClick={handleRefresh} data-testid="button-refresh-transactions">
                  <RefreshCw className="h-4 w-4" />
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {transactionsLoading ? (
                  <div className="flex items-center justify-center py-8">
                    <div className="animate-spin w-6 h-6 border-4 border-primary border-t-transparent rounded-full" />
                  </div>
                ) : recentTransactions && recentTransactions.length > 0 ? (
                  recentTransactions.slice(0, 5).map((tx) => (
                    <div key={tx.id} className="flex items-start gap-3" data-testid={`transaction-${tx.id}`}>
                      <div className={`h-8 w-8 rounded-full flex items-center justify-center flex-shrink-0 ${
                        tx.type === 'burn' ? 'bg-chart-5/10' : 'bg-accent/10'
                      }`}>
                        {tx.type === 'burn' ? (
                          <Flame className="h-4 w-4 text-chart-5" />
                        ) : (
                          <Activity className="h-4 w-4 text-accent" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium capitalize">{tx.type}</p>
                        <p className="text-xs text-muted-foreground truncate font-mono">
                          {tx.txSignature.slice(0, 16)}...
                        </p>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <Badge
                          variant={tx.status === 'completed' ? 'default' : tx.status === 'failed' ? 'destructive' : 'secondary'}
                          className="text-xs"
                        >
                          {tx.status}
                        </Badge>
                        <a 
                          href={`https://solscan.io/tx/${tx.txSignature}`} 
                          target="_blank" 
                          rel="noopener noreferrer"
                          className="text-muted-foreground hover:text-primary"
                        >
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="text-center py-8 text-sm text-muted-foreground">
                    No transactions yet
                  </div>
                )}
              </div>
              {recentTransactions && recentTransactions.length > 5 && (
                <Link href="/dashboard/transactions">
                  <Button variant="ghost" size="sm" className="w-full mt-4" data-testid="button-view-all-transactions">
                    View All Transactions
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </Button>
                </Link>
              )}
            </CardContent>
          </Card>

          {/* Quick Links */}
          <Card>
            <CardHeader>
              <CardTitle>Quick Actions</CardTitle>
              <CardDescription>Shortcuts to common tasks</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              <Link href="/analyze">
                <Button variant="outline" className="w-full justify-start" data-testid="button-quick-analyze">
                  <Zap className="h-4 w-4 mr-2" />
                  Analyze Token
                </Button>
              </Link>
              <Link href="/dashboard/ai-bot">
                <Button variant="outline" className="w-full justify-start" data-testid="button-quick-ai-bot">
                  <Brain className="h-4 w-4 mr-2" />
                  GigaBrain AI Bot
                </Button>
              </Link>
              <Link href="/dashboard/transactions">
                <Button variant="outline" className="w-full justify-start" data-testid="button-quick-transactions">
                  <Activity className="h-4 w-4 mr-2" />
                  All Transactions
                </Button>
              </Link>
              <Link href="/stats">
                <Button variant="outline" className="w-full justify-start" data-testid="button-quick-live-stats">
                  <BarChart3 className="h-4 w-4 mr-2" />
                  Live Stats
                </Button>
              </Link>
              <Link href="/learn">
                <Button variant="outline" className="w-full justify-start" data-testid="button-quick-how-it-works">
                  <FileText className="h-4 w-4 mr-2" />
                  How It Works
                </Button>
              </Link>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
