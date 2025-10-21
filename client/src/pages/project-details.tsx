import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { useEffect, useState } from "react";
import { insertProjectSchema, type InsertProject, type Project } from "@shared/schema";
import { SOLANA_INCINERATOR_ADDRESS, WHITELISTED_WALLETS } from "@shared/config";
import { PaymentModal } from "@/components/payment-modal";
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
import { Flame, ArrowLeft, Save, Zap, Trash2, Crown, Play, AlertTriangle, DollarSign, Wallet, RefreshCw, Clock } from "lucide-react";
import { useWalletSignature } from "@/hooks/use-wallet-signature";
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
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [pendingUpdates, setPendingUpdates] = useState<InsertProject | null>(null);
  const [burnAmount, setBurnAmount] = useState<string>("");
  const { signMessage, createMessage, isConnected } = useWalletSignature();

  const projectId = params?.id;

  const { data: project, isLoading } = useQuery<Project>({
    queryKey: ["/api/projects", projectId],
    enabled: !!projectId,
  });

  // Fetch wallet balances
  const { data: walletBalances, refetch: refetchBalances, isLoading: balancesLoading } = useQuery<{
    treasury: {
      solBalance: number;
      tokenBalance: number;
      walletAddress: string;
    };
    pumpfunCreator: {
      solBalance: number;
      walletAddress: string;
    } | null;
  }>({
    queryKey: ["/api/projects", projectId, "wallet-balances"],
    enabled: !!projectId && !!project,
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
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "wallet-balances"] });
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

  const executeManualBuybackMutation = useMutation({
    mutationFn: async () => {
      if (!project) {
        throw new Error("Project not found");
      }

      if (!isConnected) {
        throw new Error("Please connect your wallet first");
      }

      // Create message and get wallet signature
      const message = createMessage("Execute buyback", projectId!);
      
      // Sign message with connected wallet
      const signatureResult = await signMessage(message);

      const response = await apiRequest("POST", `/api/execute-buyback/${projectId}`, {
        ownerWalletAddress: signatureResult.publicKey,
        signature: signatureResult.signature,
        message: signatureResult.message,
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || "Failed to execute buyback");
      }

      return response.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/transactions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "wallet-balances"] });
      toast({
        title: "Buyback Executed",
        description: data.message || "Manual buyback has been successfully executed!",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Buyback Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const executeAutomatedProcessMutation = useMutation({
    mutationFn: async () => {
      if (!project) {
        throw new Error("Project not found");
      }

      if (!isConnected) {
        throw new Error("Please connect your wallet first");
      }

      // Create message and get wallet signature
      const message = createMessage("Execute automated process", projectId!);
      
      // Sign message with connected wallet
      const signatureResult = await signMessage(message);

      const response = await apiRequest("POST", `/api/projects/${projectId}/execute-automated-process`, {
        ownerWalletAddress: signatureResult.publicKey,
        signature: signatureResult.signature,
        message: signatureResult.message,
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || "Failed to execute automated process");
      }

      return response.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/transactions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "wallet-balances"] });
      toast({
        title: "Automated Process Executed",
        description: data.message || "The complete automated buyback and burn process has been executed!",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Execution Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const executeManualBurnMutation = useMutation({
    mutationFn: async () => {
      if (!project) {
        throw new Error("Project not found");
      }

      if (!isConnected) {
        throw new Error("Please connect your wallet first");
      }

      const amount = parseFloat(burnAmount);
      if (isNaN(amount) || amount <= 0) {
        throw new Error("Please enter a valid burn amount");
      }

      // Create message and get wallet signature
      const message = `Burn ${burnAmount} tokens for project ${projectId} at ${Date.now()}`;
      
      // Sign message with connected wallet
      const signatureResult = await signMessage(message);

      const response = await apiRequest("POST", `/api/projects/${projectId}/manual-burn`, {
        ownerWalletAddress: signatureResult.publicKey,
        signature: signatureResult.signature,
        message: signatureResult.message,
        amount: burnAmount,
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || "Failed to execute burn");
      }

      return response.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/transactions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "wallet-balances"] });
      setBurnAmount(""); // Clear input after successful burn
      toast({
        title: "Burn Executed",
        description: data.message || "Tokens have been successfully burned!",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Burn Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const executeManualClaimMutation = useMutation({
    mutationFn: async () => {
      if (!project) {
        throw new Error("Project not found");
      }

      if (!isConnected) {
        throw new Error("Please connect your wallet first");
      }

      // Create message and get wallet signature
      const message = createMessage("Claim creator rewards", projectId!);
      
      // Sign message with connected wallet
      const signatureResult = await signMessage(message);

      const response = await apiRequest("POST", `/api/projects/${projectId}/manual-claim`, {
        ownerWalletAddress: signatureResult.publicKey,
        signature: signatureResult.signature,
        message: signatureResult.message,
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || "Failed to claim rewards");
      }

      return response.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/transactions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "wallet-balances"] });
      toast({
        title: "Rewards Claimed",
        description: data.message || "Creator rewards have been successfully claimed!",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Claim Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const onSubmit = async (data: InsertProject) => {
    const processedData = {
      ...data,
      buybackAmountSol: data.buybackAmountSol === "" ? undefined : data.buybackAmountSol,
      customCronExpression: data.customCronExpression === "" ? undefined : data.customCronExpression,
      pumpfunCreatorWallet: data.pumpfunCreatorWallet === "" ? undefined : data.pumpfunCreatorWallet,
    };

    // If trying to activate and not whitelisted, check for payment or trial first
    if (data.isActive && !project?.isActive && project && !WHITELISTED_WALLETS.includes(project.ownerWalletAddress)) {
      // Check for active trial first
      const hasActiveTrial = project.trialEndsAt && new Date(project.trialEndsAt) > new Date();
      
      if (!hasActiveTrial) {
        // Check if there's a valid payment
        try {
          const response = await fetch(`/api/payments/project/${projectId}`);
          const payments = await response.json();
          const now = new Date();
          const hasValidPayment = payments.some((p: any) => 
            p.verified && new Date(p.expiresAt) > now
          );

          if (!hasValidPayment) {
            // Show payment modal instead of submitting
            setPendingUpdates(processedData);
            setShowPaymentModal(true);
            return;
          }
        } catch (error) {
          console.error("Error checking payment status:", error);
        }
      }
    }

    updateProjectMutation.mutate(processedData);
  };

  const handlePaymentSuccess = () => {
    // After successful payment, submit the pending updates
    if (pendingUpdates) {
      updateProjectMutation.mutate(pendingUpdates);
      setPendingUpdates(null);
    }
    queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId] });
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
            {project.trialEndsAt && new Date(project.trialEndsAt) > new Date() && (
              <Badge variant="secondary" className="gap-1" data-testid="badge-trial">
                <Clock className="h-3 w-3" />
                Trial: {Math.ceil((new Date(project.trialEndsAt).getTime() - Date.now()) / (1000 * 60 * 60 * 24))} days left
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
                        {WHITELISTED_WALLETS.includes(project.ownerWalletAddress) 
                          ? "Enable or pause automated buyback execution (Free Access)" 
                          : "Enable or pause automated buyback execution. Payment required to activate."
                        }
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

          {/* Wallet Balances Card */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Wallet className="h-5 w-5 text-primary" />
                Wallet Balances
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => refetchBalances()}
                  disabled={balancesLoading}
                  className="ml-auto"
                  data-testid="button-refresh-balances"
                >
                  <RefreshCw className={`h-4 w-4 ${balancesLoading ? 'animate-spin' : ''}`} />
                </Button>
              </CardTitle>
              <CardDescription>
                Current balances for your project wallets
              </CardDescription>
            </CardHeader>
            <CardContent>
              {balancesLoading ? (
                <div className="space-y-4">
                  <div className="h-32 bg-muted/50 rounded animate-pulse" />
                  {project?.isPumpfunToken && project?.pumpfunCreatorWallet && (
                    <div className="h-24 bg-muted/50 rounded animate-pulse" />
                  )}
                </div>
              ) : walletBalances ? (
                <div className="space-y-4">
                  {/* Treasury Wallet */}
                  <div className="p-4 rounded-lg border bg-card">
                    <div className="flex items-center justify-between mb-3">
                      <h4 className="font-semibold text-sm">Treasury Wallet</h4>
                      <a
                        href={`https://solscan.io/account/${walletBalances.treasury.walletAddress}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-primary hover:underline"
                        data-testid="link-treasury-explorer"
                      >
                        View on Explorer
                      </a>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <p className="text-xs text-muted-foreground mb-1">SOL Balance</p>
                        <p className="text-lg font-mono font-semibold" data-testid="text-treasury-sol-balance">
                          {walletBalances.treasury.solBalance.toFixed(4)} SOL
                        </p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          For transaction fees
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground mb-1">Token Balance</p>
                        <p className="text-lg font-mono font-semibold" data-testid="text-treasury-token-balance">
                          {walletBalances.treasury.tokenBalance.toLocaleString()}
                        </p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          Available to burn
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* PumpFun Creator Wallet (if applicable) */}
                  {walletBalances.pumpfunCreator && (
                    <div className="p-4 rounded-lg border bg-card">
                      <div className="flex items-center justify-between mb-3">
                        <h4 className="font-semibold text-sm">PumpFun Creator Wallet</h4>
                        <a
                          href={`https://solscan.io/account/${walletBalances.pumpfunCreator.walletAddress}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-primary hover:underline"
                          data-testid="link-pumpfun-explorer"
                        >
                          View on Explorer
                        </a>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground mb-1">SOL Balance</p>
                        <p className="text-lg font-mono font-semibold" data-testid="text-pumpfun-sol-balance">
                          {walletBalances.pumpfunCreator.solBalance.toFixed(4)} SOL
                        </p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          Unclaimed rewards claimed here
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">Unable to load wallet balances</p>
              )}
            </CardContent>
          </Card>

          {/* Automated Process Card */}
          <Card className="border-2 border-primary/20">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Zap className="h-5 w-5 text-primary" />
                Run Complete Automated Process
              </CardTitle>
              <CardDescription>
                Execute the full automated workflow: claim, buyback, and burn
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  Run the complete automated process immediately without waiting for the schedule. This will:
                </p>
                <ul className="text-sm text-muted-foreground list-disc list-inside space-y-1 ml-2">
                  <li>Claim available PumpFun creator rewards (if applicable)</li>
                  <li>Check treasury balance and verify sufficient funds</li>
                  <li>Execute optimal SOL to token swap via Jupiter Ultra API</li>
                  <li>Burn acquired tokens to the Solana incinerator</li>
                  <li>Record all transactions in your history</li>
                </ul>
                <div className="flex gap-3 pt-2">
                  <Button
                    type="button"
                    onClick={() => executeAutomatedProcessMutation.mutate()}
                    disabled={executeAutomatedProcessMutation.isPending || !isConnected}
                    className="bg-gradient-to-r from-primary to-accent"
                    data-testid="button-execute-automated-process"
                  >
                    {executeAutomatedProcessMutation.isPending ? (
                      "Running Process..."
                    ) : (
                      <>
                        <Zap className="mr-2 h-4 w-4" />
                        Run Automated Process
                      </>
                    )}
                  </Button>
                  {!isConnected && (
                    <p className="text-sm text-amber-600 dark:text-amber-500 flex items-center">
                      <AlertTriangle className="mr-1.5 h-4 w-4" />
                      Connect your wallet to run the automated process
                    </p>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Manual Controls Card */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Play className="h-5 w-5 text-primary" />
                Manual Buyback
              </CardTitle>
              <CardDescription>
                Trigger a buyback immediately without waiting for the schedule
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  Execute just the buyback portion. This will:
                </p>
                <ul className="text-sm text-muted-foreground list-disc list-inside space-y-1 ml-2">
                  <li>Swap SOL for tokens using Jupiter aggregator</li>
                  <li>Record the buyback transaction</li>
                </ul>
                <div className="flex gap-3 pt-2">
                  <Button
                    type="button"
                    onClick={() => executeManualBuybackMutation.mutate()}
                    disabled={executeManualBuybackMutation.isPending || !isConnected}
                    variant="outline"
                    data-testid="button-execute-manual-buyback"
                  >
                    {executeManualBuybackMutation.isPending ? (
                      "Executing..."
                    ) : (
                      <>
                        <Play className="mr-2 h-4 w-4" />
                        Execute Buyback Now
                      </>
                    )}
                  </Button>
                  {!isConnected && (
                    <p className="text-sm text-amber-600 dark:text-amber-500 flex items-center">
                      Connect your wallet to execute manual buybacks
                    </p>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Manual Burn Card */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Flame className="h-5 w-5 text-destructive" />
                Manual Burn
              </CardTitle>
              <CardDescription>
                Burn tokens already in your treasury wallet without buying more
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  Burn tokens that are already in your treasury wallet. This will:
                </p>
                <ul className="text-sm text-muted-foreground list-disc list-inside space-y-1 ml-2">
                  <li>Permanently destroy the specified amount of tokens</li>
                  <li>Reduce the total circulating supply</li>
                  <li>Record the burn transaction on-chain</li>
                </ul>
                <div className="space-y-3 pt-2">
                  <div className="space-y-2">
                    <label htmlFor="burn-amount" className="text-sm font-medium">
                      Amount to Burn
                    </label>
                    <Input
                      id="burn-amount"
                      type="number"
                      placeholder="Enter token amount"
                      value={burnAmount}
                      onChange={(e) => setBurnAmount(e.target.value)}
                      disabled={executeManualBurnMutation.isPending}
                      min="0"
                      step="any"
                      data-testid="input-burn-amount"
                    />
                    <p className="text-xs text-muted-foreground">
                      Make sure you have sufficient token balance in your treasury wallet
                    </p>
                  </div>
                  <div className="flex gap-3">
                    <Button
                      type="button"
                      onClick={() => executeManualBurnMutation.mutate()}
                      disabled={executeManualBurnMutation.isPending || !isConnected || !burnAmount}
                      variant="destructive"
                      data-testid="button-execute-manual-burn"
                    >
                      {executeManualBurnMutation.isPending ? (
                        "Burning..."
                      ) : (
                        <>
                          <Flame className="mr-2 h-4 w-4" />
                          Burn Tokens
                        </>
                      )}
                    </Button>
                    {!isConnected && (
                      <p className="text-sm text-amber-600 dark:text-amber-500 flex items-center">
                        <AlertTriangle className="mr-1.5 h-4 w-4" />
                        Connect your wallet to burn tokens
                      </p>
                    )}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Manual Claim Creator Rewards Card - Only show for PumpFun tokens */}
          {project.isPumpfunToken && project.pumpfunCreatorWallet && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <DollarSign className="h-5 w-5 text-green-600 dark:text-green-500" />
                  Claim Creator Rewards
                </CardTitle>
                <CardDescription>
                  Claim your PumpFun creator fee rewards to your treasury wallet
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <p className="text-sm text-muted-foreground">
                    Claim available PumpFun creator fee rewards. This will:
                  </p>
                  <ul className="text-sm text-muted-foreground list-disc list-inside space-y-1 ml-2">
                    <li>Claim all unclaimed trading fee rewards</li>
                    <li>Transfer SOL to your treasury wallet</li>
                    <li>Make funds available for buyback operations</li>
                    <li>Record the claim transaction</li>
                  </ul>
                  <div className="flex gap-3 pt-2">
                    <Button
                      type="button"
                      onClick={() => executeManualClaimMutation.mutate()}
                      disabled={executeManualClaimMutation.isPending || !isConnected}
                      className="bg-green-600 hover:bg-green-700 dark:bg-green-700 dark:hover:bg-green-800"
                      data-testid="button-execute-manual-claim"
                    >
                      {executeManualClaimMutation.isPending ? (
                        "Claiming..."
                      ) : (
                        <>
                          <DollarSign className="mr-2 h-4 w-4" />
                          Claim Rewards Now
                        </>
                      )}
                    </Button>
                    {!isConnected && (
                      <p className="text-sm text-amber-600 dark:text-amber-500 flex items-center">
                        <AlertTriangle className="mr-1.5 h-4 w-4" />
                        Connect your wallet to claim rewards
                      </p>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

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

      {/* Payment Modal */}
      <PaymentModal
        open={showPaymentModal}
        onClose={() => setShowPaymentModal(false)}
        projectId={projectId!}
        tier="STARTER"
        ownerWalletAddress={project.ownerWalletAddress}
        onSuccess={handlePaymentSuccess}
      />
    </div>
  );
}
