import { useQuery, useMutation } from "@tanstack/react-query";
import { useWallet } from "@solana/wallet-adapter-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { TrendingUp, Loader2, Settings2 } from "lucide-react";
import { Link } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import type { Project } from "@shared/schema";

const volumeBotConfigSchema = z.object({
  volumeBotEnabled: z.boolean(),
  volumeBotBuyAmountSOL: z.string().min(1, "Buy amount is required").refine(
    (val) => !isNaN(parseFloat(val)) && parseFloat(val) > 0,
    "Must be a positive number"
  ),
  volumeBotSellPercentage: z.string().min(1, "Sell percentage is required").refine(
    (val) => !isNaN(parseFloat(val)) && parseFloat(val) > 0 && parseFloat(val) <= 100,
    "Must be between 0 and 100"
  ),
  volumeBotIntervalMinutes: z.number().min(1, "Must be at least 1 minute").max(1440, "Max 1440 minutes (24 hours)"),
  volumeBotMinPriceSOL: z.string().optional().refine(
    (val) => !val || (val && !isNaN(parseFloat(val)) && parseFloat(val) >= 0),
    "Must be a positive number or empty"
  ),
  volumeBotMaxPriceSOL: z.string().optional().refine(
    (val) => !val || (val && !isNaN(parseFloat(val)) && parseFloat(val) >= 0),
    "Must be a positive number or empty"
  ),
});

type VolumeBotConfigFormData = z.infer<typeof volumeBotConfigSchema>;

function VolumeBotConfigDialog({ project }: { project: Project }) {
  const [open, setOpen] = useState(false);
  const { toast } = useToast();
  const { publicKey } = useWallet();

  const form = useForm<VolumeBotConfigFormData>({
    resolver: zodResolver(volumeBotConfigSchema),
    defaultValues: {
      volumeBotEnabled: project.volumeBotEnabled || false,
      volumeBotBuyAmountSOL: project.volumeBotBuyAmountSOL || "0.1",
      volumeBotSellPercentage: project.volumeBotSellPercentage || "95",
      volumeBotIntervalMinutes: project.volumeBotIntervalMinutes || 60,
      volumeBotMinPriceSOL: project.volumeBotMinPriceSOL || "",
      volumeBotMaxPriceSOL: project.volumeBotMaxPriceSOL || "",
    },
  });

  const updateMutation = useMutation({
    mutationFn: async (data: VolumeBotConfigFormData) => {
      return await apiRequest("PATCH", `/api/projects/${project.id}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects/owner", publicKey?.toString()] });
      toast({
        title: "Configuration saved",
        description: "Volume bot settings have been updated successfully.",
      });
      setOpen(false);
    },
    onError: (error: Error) => {
      toast({
        title: "Configuration failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const onSubmit = (data: VolumeBotConfigFormData) => {
    updateMutation.mutate(data);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="w-full" data-testid={`button-configure-${project.id}`}>
          <Settings2 className="h-4 w-4 mr-2" />
          {project.volumeBotEnabled ? "Configure" : "Enable & Configure"}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Volume Bot Configuration</DialogTitle>
          <DialogDescription>
            Configure automated buy/sell cycles for {project.name}
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
            <FormField
              control={form.control}
              name="volumeBotEnabled"
              render={({ field }) => (
                <FormItem className="flex items-center justify-between rounded-lg border p-4">
                  <div className="space-y-0.5">
                    <FormLabel className="text-base">Enable Volume Bot</FormLabel>
                    <FormDescription>
                      Start automated buy/sell cycles to generate trading volume
                    </FormDescription>
                  </div>
                  <FormControl>
                    <Switch
                      checked={field.value}
                      onCheckedChange={field.onChange}
                      data-testid="switch-volume-bot-enabled"
                    />
                  </FormControl>
                </FormItem>
              )}
            />

            <div className="grid gap-4 md:grid-cols-2">
              <FormField
                control={form.control}
                name="volumeBotBuyAmountSOL"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Buy Amount (SOL)</FormLabel>
                    <FormControl>
                      <Input
                        type="text"
                        placeholder="0.1"
                        {...field}
                        data-testid="input-buy-amount"
                      />
                    </FormControl>
                    <FormDescription>
                      Amount of SOL to spend per buy cycle
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="volumeBotSellPercentage"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Sell Percentage (%)</FormLabel>
                    <FormControl>
                      <Input
                        type="text"
                        placeholder="95"
                        {...field}
                        data-testid="input-sell-percentage"
                      />
                    </FormControl>
                    <FormDescription>
                      % of tokens to sell (0-100)
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="volumeBotIntervalMinutes"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Trading Interval (Minutes)</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      placeholder="60"
                      {...field}
                      onChange={(e) => field.onChange(parseInt(e.target.value))}
                      data-testid="input-interval-minutes"
                    />
                  </FormControl>
                  <FormDescription>
                    Time between buy/sell cycles (1-1440 minutes)
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-medium">Price Guards (Optional)</h4>
                <p className="text-xs text-muted-foreground">Bot will pause if price is outside these limits</p>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <FormField
                  control={form.control}
                  name="volumeBotMinPriceSOL"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Min Price (SOL)</FormLabel>
                      <FormControl>
                        <Input
                          type="text"
                          placeholder="Optional"
                          {...field}
                          data-testid="input-min-price"
                        />
                      </FormControl>
                      <FormDescription>
                        Pause if token price drops below
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="volumeBotMaxPriceSOL"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Max Price (SOL)</FormLabel>
                      <FormControl>
                        <Input
                          type="text"
                          placeholder="Optional"
                          {...field}
                          data-testid="input-max-price"
                        />
                      </FormControl>
                      <FormDescription>
                        Pause if token price rises above
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </div>

            <div className="flex gap-3">
              <Button
                type="button"
                variant="outline"
                onClick={() => setOpen(false)}
                className="flex-1"
                data-testid="button-cancel"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={updateMutation.isPending}
                className="flex-1"
                data-testid="button-save-config"
              >
                {updateMutation.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Saving...
                  </>
                ) : (
                  "Save Configuration"
                )}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

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
                  <VolumeBotConfigDialog project={project} />
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
                  <VolumeBotConfigDialog project={project} />
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
