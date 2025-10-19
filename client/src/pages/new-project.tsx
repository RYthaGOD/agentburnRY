import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { insertProjectSchema, type InsertProject } from "@shared/schema";
import { SOLANA_INCINERATOR_ADDRESS } from "@shared/config";
import { Button } from "@/components/ui/button";
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
import { useToast } from "@/hooks/use-toast";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useLocation } from "wouter";
import { Flame, ArrowRight } from "lucide-react";

export default function NewProject() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [, navigate] = useLocation();

  const form = useForm<InsertProject>({
    resolver: zodResolver(insertProjectSchema),
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
    },
  });

  const createProjectMutation = useMutation({
    mutationFn: async (data: InsertProject) => {
      const response = await apiRequest("POST", "/api/projects", data);
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || "Failed to create project");
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects"] });
      toast({
        title: "Project Created",
        description: "Your buyback and burn project has been created successfully.",
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
    // Convert empty string to undefined for numeric fields
    const processedData = {
      ...data,
      buybackAmountSol: data.buybackAmountSol === "" ? undefined : data.buybackAmountSol,
      customCronExpression: data.customCronExpression === "" ? undefined : data.customCronExpression,
    };
    createProjectMutation.mutate(processedData);
  };

  const schedule = form.watch("schedule");

  return (
    <div className="max-w-3xl mx-auto space-y-8">
      <div>
        <h1 className="text-3xl font-bold mb-2" data-testid="heading-new-project">Create New Project</h1>
        <p className="text-muted-foreground">
          Configure your automated token buyback and burn settings
        </p>
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
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl>
                        <SelectTrigger data-testid="select-schedule">
                          <SelectValue placeholder="Select a schedule" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
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
              disabled={createProjectMutation.isPending}
              className="bg-accent"
              data-testid="button-create-project"
            >
              {createProjectMutation.isPending ? (
                "Creating..."
              ) : (
                <>
                  <Flame className="mr-2 h-4 w-4" />
                  Create Project
                  <ArrowRight className="ml-2 h-4 w-4" />
                </>
              )}
            </Button>
          </div>
        </form>
      </Form>
    </div>
  );
}
