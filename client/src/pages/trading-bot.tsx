import { useQuery } from "@tanstack/react-query";
import { useWallet } from "@solana/wallet-adapter-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { DollarSign, Loader2 } from "lucide-react";
import { Link } from "wouter";
import type { Project } from "@shared/schema";

export default function TradingBot() {
  const { publicKey } = useWallet();

  const { data: projects, isLoading } = useQuery<Project[]>({
    queryKey: ["/api/projects/owner", publicKey?.toString() ?? ""],
    enabled: !!publicKey,
  });

  if (!publicKey) {
    return (
      <div className="container mx-auto p-6">
        <div className="text-center py-12">
          <h1 className="text-3xl font-bold mb-4">Trading Bot</h1>
          <p className="text-muted-foreground mb-6">
            Please connect your wallet to manage trading bots
          </p>
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="container mx-auto p-6">
        <div className="flex justify-center items-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </div>
    );
  }

  const activeProjects = projects?.filter((p: Project) => p.buyBotEnabled) || [];
  const inactiveProjects = projects?.filter((p: Project) => !p.buyBotEnabled) || [];

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <DollarSign className="h-8 w-8 text-primary" />
            Trading Bot (Limit Orders)
          </h1>
          <p className="text-muted-foreground mt-2">
            Execute buy orders automatically when price reaches target levels
          </p>
        </div>
      </div>

      {/* Active Trading Bots */}
      {activeProjects.length > 0 && (
        <div className="space-y-4">
          <h2 className="text-xl font-semibold">Active Trading Bots</h2>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {activeProjects.map((project: Project) => {
              let limitOrders: any[] = [];
              try {
                limitOrders = project.buyBotLimitOrders ? JSON.parse(project.buyBotLimitOrders) : [];
              } catch (e) {
                limitOrders = [];
              }

              return (
                <Card key={project.id} className="hover-elevate" data-testid={`card-trading-bot-${project.id}`}>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <DollarSign className="h-5 w-5 text-primary" />
                      {project.name}
                    </CardTitle>
                    <CardDescription>
                      {project.tokenMintAddress.slice(0, 8)}...{project.tokenMintAddress.slice(-6)}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="grid grid-cols-2 gap-2 text-sm">
                      <div>
                        <p className="text-muted-foreground">Limit Orders</p>
                        <p className="font-semibold">{limitOrders.length}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Max Slippage</p>
                        <p className="font-semibold">{project.buyBotMaxSlippage || "0.5"}%</p>
                      </div>
                      <div className="col-span-2">
                        <p className="text-muted-foreground">Status</p>
                        <p className="font-semibold text-green-500">Active</p>
                      </div>
                    </div>
                    {limitOrders.length > 0 && (
                      <div className="pt-2 border-t space-y-1">
                        <p className="text-xs text-muted-foreground mb-1">Next Orders</p>
                        {limitOrders.slice(0, 2).map((order: any, idx: number) => (
                          <div key={idx} className="text-xs flex justify-between">
                            <span className="text-muted-foreground">@ {order.priceSOL} SOL</span>
                            <span className="font-medium">{order.amountSOL} SOL</span>
                          </div>
                        ))}
                        {limitOrders.length > 2 && (
                          <p className="text-xs text-muted-foreground">+{limitOrders.length - 2} more...</p>
                        )}
                      </div>
                    )}
                    <Link href={`/dashboard/projects/${project.id}`}>
                      <Button className="w-full" variant="outline" data-testid={`button-configure-${project.id}`}>
                        Configure Orders
                      </Button>
                    </Link>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>
      )}

      {/* Available Projects */}
      {inactiveProjects.length > 0 && (
        <div className="space-y-4">
          <h2 className="text-xl font-semibold">Enable Trading Bot</h2>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {inactiveProjects.map((project: Project) => (
              <Card key={project.id} className="hover-elevate" data-testid={`card-project-${project.id}`}>
                <CardHeader>
                  <CardTitle>{project.name}</CardTitle>
                  <CardDescription>
                    {project.tokenMintAddress.slice(0, 8)}...{project.tokenMintAddress.slice(-6)}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <Link href={`/dashboard/projects/${project.id}`}>
                    <Button className="w-full" data-testid={`button-enable-${project.id}`}>
                      Enable Trading Bot
                    </Button>
                  </Link>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}

      {projects?.length === 0 && (
        <Card>
          <CardHeader>
            <CardTitle>No Projects Found</CardTitle>
            <CardDescription>
              Create a project first to enable trading bot
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Link href="/dashboard/new">
              <Button data-testid="button-create-project">
                Create New Project
              </Button>
            </Link>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
