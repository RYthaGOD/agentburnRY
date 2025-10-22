import { useQuery } from "@tanstack/react-query";
import { useWallet } from "@solana/wallet-adapter-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { TrendingUp, Loader2 } from "lucide-react";
import { Link } from "wouter";
import type { Project } from "@shared/schema";

export default function VolumeBot() {
  const { publicKey } = useWallet();

  const { data: projects, isLoading } = useQuery<Project[]>({
    queryKey: ["/api/projects/owner", publicKey?.toString() ?? ""],
    enabled: !!publicKey,
  });

  if (!publicKey) {
    return (
      <div className="container mx-auto p-6">
        <div className="text-center py-12">
          <h1 className="text-3xl font-bold mb-4">Volume Bot</h1>
          <p className="text-muted-foreground mb-6">
            Please connect your wallet to manage volume bots
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

  const activeProjects = projects?.filter((p: Project) => p.volumeBotEnabled) || [];
  const inactiveProjects = projects?.filter((p: Project) => !p.volumeBotEnabled) || [];

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <TrendingUp className="h-8 w-8 text-primary" />
            Volume Bot
          </h1>
          <p className="text-muted-foreground mt-2">
            Generate trading volume with automated buy/sell cycles
          </p>
        </div>
      </div>

      {/* Active Volume Bots */}
      {activeProjects.length > 0 && (
        <div className="space-y-4">
          <h2 className="text-xl font-semibold">Active Volume Bots</h2>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {activeProjects.map((project: Project) => (
              <Card key={project.id} className="hover-elevate" data-testid={`card-volume-bot-${project.id}`}>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <TrendingUp className="h-5 w-5 text-primary" />
                    {project.name}
                  </CardTitle>
                  <CardDescription>
                    {project.tokenMintAddress.slice(0, 8)}...{project.tokenMintAddress.slice(-6)}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <div>
                      <p className="text-muted-foreground">Buy Amount</p>
                      <p className="font-semibold">{project.volumeBotBuyAmountSOL} SOL</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Sell %</p>
                      <p className="font-semibold">{project.volumeBotSellPercentage}%</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Interval</p>
                      <p className="font-semibold">{project.volumeBotIntervalMinutes}m</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Status</p>
                      <p className="font-semibold text-green-500">Active</p>
                    </div>
                  </div>
                  {(project.volumeBotMinPriceSOL || project.volumeBotMaxPriceSOL) && (
                    <div className="pt-2 border-t">
                      <p className="text-xs text-muted-foreground mb-1">Price Guards</p>
                      <div className="grid grid-cols-2 gap-2 text-xs">
                        {project.volumeBotMinPriceSOL && (
                          <div>
                            <span className="text-muted-foreground">Min: </span>
                            <span className="font-medium">{project.volumeBotMinPriceSOL} SOL</span>
                          </div>
                        )}
                        {project.volumeBotMaxPriceSOL && (
                          <div>
                            <span className="text-muted-foreground">Max: </span>
                            <span className="font-medium">{project.volumeBotMaxPriceSOL} SOL</span>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                  <Link href={`/dashboard/projects/${project.id}`}>
                    <Button className="w-full" variant="outline" data-testid={`button-configure-${project.id}`}>
                      Configure
                    </Button>
                  </Link>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* Available Projects */}
      {inactiveProjects.length > 0 && (
        <div className="space-y-4">
          <h2 className="text-xl font-semibold">Enable Volume Bot</h2>
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
                      Enable Volume Bot
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
              Create a project first to enable volume bot
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
