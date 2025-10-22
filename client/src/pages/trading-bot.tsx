import { useQuery, useMutation } from "@tanstack/react-query";
import { useWallet } from "@solana/wallet-adapter-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { DollarSign, Loader2, Settings2, Plus, Trash2 } from "lucide-react";
import { Link } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import type { Project } from "@shared/schema";

const limitOrderSchema = z.object({
  priceSOL: z.string().min(1, "Price is required").refine(
    (val) => !isNaN(parseFloat(val)) && parseFloat(val) > 0,
    "Must be a positive number"
  ),
  amountSOL: z.string().min(1, "Amount is required").refine(
    (val) => !isNaN(parseFloat(val)) && parseFloat(val) > 0,
    "Must be a positive number"
  ),
});

const buyBotConfigSchema = z.object({
  buyBotEnabled: z.boolean(),
  buyBotMaxSlippage: z.string().refine(
    (val) => !isNaN(parseFloat(val)) && parseFloat(val) >= 0 && parseFloat(val) <= 100,
    "Must be between 0 and 100"
  ),
  limitOrders: z.array(limitOrderSchema).min(0, "At least one limit order is recommended"),
});

type BuyBotConfigFormData = z.infer<typeof buyBotConfigSchema>;
type LimitOrder = z.infer<typeof limitOrderSchema>;

function TradingBotConfigDialog({ project }: { project: Project }) {
  const [open, setOpen] = useState(false);
  const { toast } = useToast();
  const { publicKey } = useWallet();

  let initialLimitOrders: LimitOrder[] = [];
  try {
    initialLimitOrders = project.buyBotLimitOrders ? JSON.parse(project.buyBotLimitOrders) : [];
  } catch (e) {
    initialLimitOrders = [];
  }

  const form = useForm<BuyBotConfigFormData>({
    resolver: zodResolver(buyBotConfigSchema),
    defaultValues: {
      buyBotEnabled: project.buyBotEnabled || false,
      buyBotMaxSlippage: project.buyBotMaxSlippage || "0.5",
      limitOrders: initialLimitOrders.length > 0 ? initialLimitOrders : [],
    },
  });

  const [limitOrders, setLimitOrders] = useState<LimitOrder[]>(initialLimitOrders);
  const [newOrder, setNewOrder] = useState<LimitOrder>({ priceSOL: "", amountSOL: "" });

  const addLimitOrder = () => {
    if (!newOrder.priceSOL || !newOrder.amountSOL) {
      toast({
        title: "Invalid order",
        description: "Please fill in both price and amount",
        variant: "destructive",
      });
      return;
    }

    const updatedOrders = [...limitOrders, newOrder];
    setLimitOrders(updatedOrders);
    form.setValue("limitOrders", updatedOrders);
    setNewOrder({ priceSOL: "", amountSOL: "" });
  };

  const removeLimitOrder = (index: number) => {
    const updatedOrders = limitOrders.filter((_, i) => i !== index);
    setLimitOrders(updatedOrders);
    form.setValue("limitOrders", updatedOrders);
  };

  const updateMutation = useMutation({
    mutationFn: async (data: BuyBotConfigFormData) => {
      return await apiRequest("PATCH", `/api/projects/${project.id}`, {
        buyBotEnabled: data.buyBotEnabled,
        buyBotMaxSlippage: data.buyBotMaxSlippage,
        buyBotLimitOrders: JSON.stringify(data.limitOrders),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects/owner", publicKey?.toString()] });
      toast({
        title: "Configuration saved",
        description: "Trading bot settings have been updated successfully.",
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

  const onSubmit = (data: BuyBotConfigFormData) => {
    if (data.buyBotEnabled && data.limitOrders.length === 0) {
      toast({
        title: "No limit orders",
        description: "Please add at least one limit order before enabling the bot",
        variant: "destructive",
      });
      return;
    }
    updateMutation.mutate(data);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="w-full" data-testid={`button-configure-${project.id}`}>
          <Settings2 className="h-4 w-4 mr-2" />
          {project.buyBotEnabled ? "Configure Orders" : "Enable & Configure"}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Trading Bot Configuration</DialogTitle>
          <DialogDescription>
            Configure limit orders for {project.name}. Bot will execute buys when target prices are reached.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
            <FormField
              control={form.control}
              name="buyBotEnabled"
              render={({ field }) => (
                <FormItem className="flex items-center justify-between rounded-lg border p-4">
                  <div className="space-y-0.5">
                    <FormLabel className="text-base">Enable Trading Bot</FormLabel>
                    <FormDescription>
                      Automatically execute buy orders when price targets are reached
                    </FormDescription>
                  </div>
                  <FormControl>
                    <Switch
                      checked={field.value}
                      onCheckedChange={field.onChange}
                      data-testid="switch-buy-bot-enabled"
                    />
                  </FormControl>
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="buyBotMaxSlippage"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Max Slippage (%)</FormLabel>
                  <FormControl>
                    <Input
                      type="text"
                      placeholder="0.5"
                      {...field}
                      data-testid="input-max-slippage"
                    />
                  </FormControl>
                  <FormDescription>
                    Maximum slippage tolerance for trades (0-100%)
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-medium">Limit Orders</h4>
                <p className="text-xs text-muted-foreground">
                  {limitOrders.length} order{limitOrders.length !== 1 ? "s" : ""} configured
                </p>
              </div>

              {/* Add New Order */}
              <div className="rounded-lg border p-4 space-y-3">
                <p className="text-sm font-medium">Add New Limit Order</p>
                <div className="grid gap-3 md:grid-cols-3">
                  <div className="space-y-2">
                    <label className="text-sm text-muted-foreground">Target Price (SOL)</label>
                    <Input
                      type="text"
                      placeholder="0.001"
                      value={newOrder.priceSOL}
                      onChange={(e) => setNewOrder({ ...newOrder, priceSOL: e.target.value })}
                      data-testid="input-new-order-price"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm text-muted-foreground">Buy Amount (SOL)</label>
                    <Input
                      type="text"
                      placeholder="0.1"
                      value={newOrder.amountSOL}
                      onChange={(e) => setNewOrder({ ...newOrder, amountSOL: e.target.value })}
                      data-testid="input-new-order-amount"
                    />
                  </div>
                  <div className="flex items-end">
                    <Button
                      type="button"
                      onClick={addLimitOrder}
                      className="w-full"
                      data-testid="button-add-order"
                    >
                      <Plus className="h-4 w-4 mr-2" />
                      Add Order
                    </Button>
                  </div>
                </div>
              </div>

              {/* Existing Orders */}
              {limitOrders.length > 0 && (
                <div className="space-y-2">
                  <p className="text-sm font-medium">Configured Orders</p>
                  <div className="space-y-2">
                    {limitOrders.map((order, index) => (
                      <div
                        key={index}
                        className="flex items-center justify-between rounded-lg border p-3"
                        data-testid={`order-item-${index}`}
                      >
                        <div className="flex gap-4 text-sm">
                          <div>
                            <span className="text-muted-foreground">Price: </span>
                            <span className="font-medium">{order.priceSOL} SOL</span>
                          </div>
                          <div>
                            <span className="text-muted-foreground">Amount: </span>
                            <span className="font-medium">{order.amountSOL} SOL</span>
                          </div>
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() => removeLimitOrder(index)}
                          data-testid={`button-remove-order-${index}`}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {limitOrders.length === 0 && (
                <div className="rounded-lg border border-dashed p-8 text-center">
                  <p className="text-sm text-muted-foreground">
                    No limit orders configured. Add orders above to get started.
                  </p>
                </div>
              )}
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
                    <TradingBotConfigDialog project={project} />
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
                  <TradingBotConfigDialog project={project} />
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
