import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { useEffect } from "react";
import { insertProjectSchema, type InsertProject, type Project } from "@shared/schema";
import { SOLANA_INCINERATOR_ADDRESS, WHITELISTED_WALLETS } from "@shared/config";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useLocation, useRoute } from "wouter";
import { Flame, ArrowLeft, Save, Zap, Trash2, Crown } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

export default function ProjectDetails() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [, navigate] = useLocation();
  const [, params] = useRoute("/dashboard/projects/:id");

  const projectId = params?.id;

  const { data: project, isLoading } = useQuery<Project>({
    queryKey: ["/api/projects", projectId],
    enabled: !!projectId,
  });

  const form = useForm<InsertProject>({
    resolver: zodResolver(insertProjectSchema.partial()),
    defaultValues: {
      name: "",
      tokenMintAddress: "",
      treasuryWalletAddress: "",
      burnAddress: SOLANA_INCINERATOR_ADDRESS,
      schedule: "daily",
      customCronExpression: "",
      buybackAmountSol: "",
      isActive: false,
      ownerWalletAddress: "",
      isPumpfunToken: false,
      pumpfunCreatorWallet: "",
    },
  });

  // Reset form when project data loads
  useEffect(() => {
    if (project) {
      form.reset({
        name: project.name,
        tokenMintAddress: project.tokenMintAddress,
        treasuryWalletAddress: project.treasuryWalletAddress,
        burnAddress: project.burnAddress,
        schedule: project.schedule,
        customCronExpression: project.customCronExpression || "",
        buybackAmountSol: project.buybackAmountSol || "",
        isActive: project.isActive,
        ownerWalletAddress: project.ownerWalletAddress,
        isPumpfunToken: project.isPumpfunToken,
        pumpfunCreatorWallet: project.pumpfunCreatorWallet || "",
      });
    }
  }, [project, form]);

  const updateProjectMutation = useMutation({
    mutationFn: async (data: Partial<InsertProject>) => {
      const response = await apiRequest("PATCH", `/api/projects/${projectId}`, data);
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || "Failed to update project");
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects"] });
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId] });
      toast({
        title: "Project Updated",
        description: "Your project settings have been saved successfully.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const deleteProjectMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("DELETE", `/api/projects/${projectId}`);
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || "Failed to delete project");
      }
      // DELETE returns 204 No Content, no JSON to parse
      return null;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects"] });
      toast({
        title: "Project Deleted",
        description: "Your project has been permanently deleted.",
      });
      navigate("/dashboard");
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const onSubmit = (data: InsertProject) => {
    const processedData = {
      ...data,
      buybackAmountSol: data.buybackAmountSol === "" ? undefined : data.buybackAmountSol,
      customCronExpression: data.customCronExpression === "" ? undefined : data.customCronExpression,
      pumpfunCreatorWallet: data.pumpfunCreatorWallet === "" ? undefined : data.pumpfunCreatorWallet,
    };
    updateProjectMutation.mutate(processedData);
  };

  const schedule = form.watch("schedule");
  const isPumpfunToken = form.watch("isPumpfunToken");

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="animate-spin w-8 h-8 border-4 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  if (!project) {
    return (
      <div className="max-w-3xl mx-auto space-y-8">
        <div>
          <h1 className="text-3xl font-bold mb-2">Project Not Found</h1>
          <p className="text-muted-foreground">The requested project could not be found.</p>
        </div>
        <Button onClick={() => navigate("/dashboard")}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to Dashboard
        </Button>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate("/dashboard")}
            className="mb-2"
            data-testid="button-back"
          >
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Dashboard
          </Button>
          <div className="flex items-center gap-3">
            <h1 className="text-3xl font-bold" data-testid="heading-project-details">
              Edit Project
            </h1>
            {WHITELISTED_WALLETS.includes(project.ownerWalletAddress) && (
              <Badge variant="outline" className="gap-1">
                <Crown className="h-3 w-3" />
                Free Access
              </Badge>
            )}
          </div>
          <p className="text-muted-foreground mt-1">Update your buyback and burn settings</p>
        </div>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="destructive" size="sm" data-testid="button-delete-project">
              <Trash2 className="h-4 w-4 mr-2" />
              Delete Project
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete Project?</AlertDialogTitle>
              <AlertDialogDescription>
                This will permanently delete "{project.name}" and all associated data including
                transaction history and stored keys. This action cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => deleteProjectMutation.mutate()}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                Delete Project
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Project Information</CardTitle>
              <CardDescription>Basic details about your token project</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Project Name</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="My Token Project"
                        {...field}
                        data-testid="input-project-name"
                      />
                    </FormControl>
                    <FormDescription>A friendly name to identify this project</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="tokenMintAddress"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Token Mint Address</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="Enter Solana token mint address"
                        className="font-mono text-sm"
                        {...field}
                        data-testid="input-token-mint"
                      />
                    </FormControl>
                    <FormDescription>The SPL token contract address to buyback and burn</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Wallet Addresses</CardTitle>
              <CardDescription>Configure treasury and burn wallet addresses</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <FormField
                control={form.control}
                name="treasuryWalletAddress"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Treasury Wallet Address</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="Enter treasury wallet address"
                        className="font-mono text-sm"
                        {...field}
                        data-testid="input-treasury-wallet"
                      />
                    </FormControl>
                    <FormDescription>Wallet that holds SOL for executing buybacks</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="burnAddress"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Burn Address</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="Solana incinerator address"
                        className="font-mono text-sm bg-muted"
                        {...field}
                        readOnly
                        data-testid="input-burn-address"
                      />
                    </FormControl>
                    <FormDescription>
                      <Flame className="inline h-3 w-3 mr-1 text-orange-500" />
                      Tokens are burned via the official Solana incinerator (permanent destruction)
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="ownerWalletAddress"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Owner Wallet Address</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="Your wallet address"
                        className="font-mono text-sm"
                        {...field}
                        data-testid="input-owner-wallet"
                      />
                    </FormControl>
                    <FormDescription>Your Solana wallet address for authentication</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>
                <Zap className="inline h-5 w-5 mr-2 text-purple-500" />
                PumpFun Configuration
              </CardTitle>
              <CardDescription>Optional: Configure PumpFun creator rewards claiming</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <FormField
                control={form.control}
                name="isPumpfunToken"
                render={({ field }) => (
                  <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                    <div className="space-y-0.5">
                      <FormLabel className="text-base">
                        This is a PumpFun Token
                      </FormLabel>
                      <FormDescription>
                        Enable automated claiming of PumpFun creator rewards (0.05% of trading volume)
                      </FormDescription>
                    </div>
                    <FormControl>
                      <Switch
                        checked={field.value}
                        onCheckedChange={field.onChange}
                        data-testid="switch-pumpfun-token"
                      />
                    </FormControl>
                  </FormItem>
                )}
              />

              {isPumpfunToken && (
                <FormField
                  control={form.control}
                  name="pumpfunCreatorWallet"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>PumpFun Creator Wallet Address</FormLabel>
                      <FormControl>
                        <Input
                          placeholder="Enter PumpFun creator wallet address"
                          className="font-mono text-sm"
                          {...field}
                          value={field.value || ""}
                          data-testid="input-pumpfun-creator-wallet"
                        />
                      </FormControl>
                      <FormDescription>
                        The wallet address that receives PumpFun creator rewards. This will be used to claim rewards before buybacks.
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Buyback Configuration</CardTitle>
              <CardDescription>Set your buyback amount and execution schedule</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <FormField
                control={form.control}
                name="buybackAmountSol"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Buyback Amount (SOL)</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        step="0.001"
                        placeholder="0.1"
                        {...field}
                        data-testid="input-buyback-amount"
                      />
                    </FormControl>
                    <FormDescription>Amount of SOL to spend on each buyback</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="schedule"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Execution Schedule</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger data-testid="select-schedule">
                          <SelectValue placeholder="Select a schedule" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="5min">Every 5 Minutes</SelectItem>
                        <SelectItem value="10min">Every 10 Minutes</SelectItem>
                        <SelectItem value="30min">Every 30 Minutes</SelectItem>
                        <SelectItem value="hourly">Hourly</SelectItem>
                        <SelectItem value="daily">Daily</SelectItem>
                        <SelectItem value="weekly">Weekly</SelectItem>
                        <SelectItem value="custom">Custom</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormDescription>How often to execute buyback and burn</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {schedule === "custom" && (
                <FormField
                  control={form.control}
                  name="customCronExpression"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Custom Cron Expression</FormLabel>
                      <FormControl>
                        <Input
                          placeholder="0 0 * * *"
                          className="font-mono text-sm"
                          {...field}
                          value={field.value || ""}
                          data-testid="input-cron-expression"
                        />
                      </FormControl>
                      <FormDescription>Advanced: Use cron syntax for custom schedules</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}

              <FormField
                control={form.control}
                name="isActive"
                render={({ field }) => (
                  <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                    <div className="space-y-0.5">
                      <FormLabel className="text-base">
                        Project Active
                      </FormLabel>
                      <FormDescription>
                        Enable or pause automated buyback execution
                      </FormDescription>
                    </div>
                    <FormControl>
                      <Switch
                        checked={field.value}
                        onCheckedChange={field.onChange}
                        data-testid="switch-is-active"
                      />
                    </FormControl>
                  </FormItem>
                )}
              />
            </CardContent>
          </Card>

          <div className="flex items-center justify-between gap-4">
            <Button
              type="button"
              variant="outline"
              onClick={() => navigate("/dashboard")}
              data-testid="button-cancel"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={updateProjectMutation.isPending}
              className="bg-accent"
              data-testid="button-save-project"
            >
              {updateProjectMutation.isPending ? (
                "Saving..."
              ) : (
                <>
                  <Save className="mr-2 h-4 w-4" />
                  Save Changes
                </>
              )}
            </Button>
          </div>
        </form>
      </Form>
    </div>
  );
}
