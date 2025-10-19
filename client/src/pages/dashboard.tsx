import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Flame, Clock, Wallet as WalletIcon, Activity, TrendingUp, ArrowRight } from "lucide-react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import type { Project, Transaction } from "@shared/schema";

export default function Dashboard() {
  const { data: projects, isLoading: projectsLoading } = useQuery<Project[]>({
    queryKey: ["/api/projects"],
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

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold mb-2" data-testid="heading-dashboard">Dashboard</h1>
        <p className="text-muted-foreground">Monitor your automated buyback and burn operations</p>
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

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>Active Projects</CardTitle>
                  <CardDescription>Your configured buyback and burn projects</CardDescription>
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
                    className="flex items-center justify-between p-4 border border-border rounded-md hover-elevate"
                    data-testid={`project-${project.id}`}
                  >
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className="font-semibold">{project.name}</h3>
                        <Badge variant={project.isActive ? "default" : "secondary"} className="text-xs">
                          {project.isActive ? "Active" : "Paused"}
                        </Badge>
                      </div>
                      <p className="text-sm text-muted-foreground font-mono">
                        {project.tokenMintAddress.slice(0, 8)}...{project.tokenMintAddress.slice(-6)}
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">
                        Schedule: {project.schedule}
                      </p>
                    </div>
                    <Link href={`/dashboard/projects/${project.id}`}>
                      <Button variant="ghost" size="sm" data-testid={`button-view-${project.id}`}>
                        View Details
                        <ArrowRight className="ml-2 h-4 w-4" />
                      </Button>
                    </Link>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>

        <div>
          <Card>
            <CardHeader>
              <CardTitle>Recent Activity</CardTitle>
              <CardDescription>Latest transactions</CardDescription>
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
                      <Badge
                        variant={tx.status === 'completed' ? 'default' : tx.status === 'failed' ? 'destructive' : 'secondary'}
                        className="text-xs"
                      >
                        {tx.status}
                      </Badge>
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
                  </Button>
                </Link>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
