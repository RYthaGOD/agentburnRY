import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { WalletButton } from "@/components/wallet-button";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import type { Project } from "@shared/schema";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Shield, Eye, EyeOff, Lock, CheckCircle2, AlertTriangle, Trash2, AlertCircle } from "lucide-react";
import { useWalletSignature } from "@/hooks/use-wallet-signature";
import { useWallet } from '@solana/wallet-adapter-react';
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

interface KeyMetadata {
  hasTreasuryKey: boolean;
  hasPumpFunKey: boolean;
  lastRotated: Date | null;
}

export default function Settings() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { signMessage, createMessage, isConnected } = useWalletSignature();
  const { publicKey } = useWallet();
  const walletAddress = publicKey?.toBase58();
  const [selectedProjectId, setSelectedProjectId] = useState<string>("");
  const [treasuryKey, setTreasuryKey] = useState("");
  const [pumpfunKey, setPumpfunKey] = useState("");
  const [showTreasuryKey, setShowTreasuryKey] = useState(false);
  const [showPumpfunKey, setShowPumpfunKey] = useState(false);

  const { data: projects } = useQuery<Project[]>({
    queryKey: ["/api/projects", "owner", walletAddress],
    queryFn: async () => {
      if (!walletAddress) return [];
      const response = await fetch(`/api/projects/owner/${walletAddress}`);
      if (!response.ok) throw new Error('Failed to fetch projects');
      return response.json();
    },
    enabled: !!walletAddress,
  });

  const selectedProject = projects?.find((p) => p.id === selectedProjectId);

  const { data: keyMetadata, isLoading: metadataLoading } = useQuery<KeyMetadata>({
    queryKey: ["/api/projects", selectedProjectId, "keys", "metadata"],
    enabled: !!selectedProjectId,
  });

  const saveKeysMutation = useMutation({
    mutationFn: async ({ projectId, keys }: { projectId: string; keys: { treasuryPrivateKey: string; pumpfunPrivateKey?: string } }) => {
      if (!selectedProject) {
        throw new Error("Project not found");
      }

      // Create message and get wallet signature
      const message = createMessage("Set keys", projectId);
      
      // Sign message with connected wallet
      const signatureResult = await signMessage(message);

      const response = await apiRequest("POST", `/api/projects/${projectId}/keys`, {
        ownerWalletAddress: signatureResult.publicKey,
        signature: signatureResult.signature,
        message: signatureResult.message,
        keys,
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || "Failed to save keys");
      }

      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", selectedProjectId, "keys", "metadata"] });
      toast({
        title: "Keys Saved",
        description: "Your automation keys have been encrypted and stored securely.",
      });
      setTreasuryKey("");
      setPumpfunKey("");
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const deleteKeysMutation = useMutation({
    mutationFn: async (projectId: string) => {
      if (!selectedProject) {
        throw new Error("Project not found");
      }

      // Create message and get wallet signature
      const message = createMessage("Delete keys", projectId);
      
      // Sign message with connected wallet
      const signatureResult = await signMessage(message);

      const response = await apiRequest("DELETE", `/api/projects/${projectId}/keys`, {
        ownerWalletAddress: signatureResult.publicKey,
        signature: signatureResult.signature,
        message: signatureResult.message,
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || "Failed to delete keys");
      }

      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", selectedProjectId, "keys", "metadata"] });
      toast({
        title: "Keys Deleted",
        description: "Your automation keys have been removed from secure storage.",
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

  const handleSaveKeys = () => {
    if (!selectedProjectId) {
      toast({
        title: "Error",
        description: "Please select a project first",
        variant: "destructive",
      });
      return;
    }

    if (!treasuryKey.trim()) {
      toast({
        title: "Error",
        description: "Treasury private key is required",
        variant: "destructive",
      });
      return;
    }

    saveKeysMutation.mutate({
      projectId: selectedProjectId,
      keys: {
        treasuryPrivateKey: treasuryKey.trim(),
        pumpfunPrivateKey: pumpfunKey.trim() || undefined,
      },
    });
  };

  const handleDeleteKeys = () => {
    if (!selectedProjectId) return;
    deleteKeysMutation.mutate(selectedProjectId);
  };

  return (
    <div className="max-w-3xl space-y-8">
      <div>
        <h1 className="text-3xl font-bold mb-2" data-testid="heading-settings">Settings</h1>
        <p className="text-muted-foreground">Manage your account and automation keys</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Wallet Connection</CardTitle>
          <CardDescription>Connect your Solana wallet to manage projects</CardDescription>
        </CardHeader>
        <CardContent>
          <WalletButton />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center gap-3 space-y-0 pb-4">
          <div className="flex items-center justify-center w-10 h-10 rounded-full bg-primary/10">
            <Shield className="h-5 w-5 text-primary" />
          </div>
          <div className="flex-1">
            <CardTitle>Automation Keys</CardTitle>
            <CardDescription>
              Securely store private keys for automated buyback execution
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          <Alert data-testid="alert-security-info">
            <Lock className="h-4 w-4" />
            <AlertDescription className="text-sm">
              <strong>Security:</strong> Your private keys are encrypted using AES-256-GCM encryption before storage.
              Only you can access them with your wallet signature. Never share your private keys.
            </AlertDescription>
          </Alert>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="project-select">Select Project</Label>
              <Select value={selectedProjectId} onValueChange={setSelectedProjectId}>
                <SelectTrigger id="project-select" data-testid="select-project">
                  <SelectValue placeholder="Choose a project" />
                </SelectTrigger>
                <SelectContent>
                  {projects?.map((project) => (
                    <SelectItem key={project.id} value={project.id}>
                      {project.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {selectedProjectId && (
              <>
                {!metadataLoading && keyMetadata && (
                  <div className="flex items-center gap-2 p-3 rounded-lg bg-muted/50">
                    {keyMetadata.hasTreasuryKey ? (
                      <CheckCircle2 className="h-4 w-4 text-green-500" />
                    ) : (
                      <AlertTriangle className="h-4 w-4 text-amber-500" />
                    )}
                    <span className="text-sm" data-testid="text-key-status">
                      Treasury Key: {keyMetadata.hasTreasuryKey ? "Configured" : "Not configured"}
                    </span>
                    {selectedProject?.isPumpfunToken && (
                      <>
                        <span className="text-muted-foreground mx-2">•</span>
                        {keyMetadata.hasPumpFunKey ? (
                          <CheckCircle2 className="h-4 w-4 text-green-500" />
                        ) : (
                          <AlertTriangle className="h-4 w-4 text-amber-500" />
                        )}
                        <span className="text-sm">
                          PumpFun Key: {keyMetadata.hasPumpFunKey ? "Configured" : "Not configured"}
                        </span>
                      </>
                    )}
                  </div>
                )}

                <div className="space-y-2">
                  <Label htmlFor="treasury-key">Treasury Wallet Private Key (Base58)</Label>
                  <div className="relative">
                    <Input
                      id="treasury-key"
                      type={showTreasuryKey ? "text" : "password"}
                      value={treasuryKey}
                      onChange={(e) => setTreasuryKey(e.target.value)}
                      placeholder="Enter treasury wallet private key"
                      className="font-mono pr-10"
                      data-testid="input-treasury-key"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="absolute right-1 top-1/2 -translate-y-1/2"
                      onClick={() => setShowTreasuryKey(!showTreasuryKey)}
                      data-testid="button-toggle-treasury-visibility"
                    >
                      {showTreasuryKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Required for automated buyback execution. This wallet must hold SOL for swaps.
                  </p>
                </div>

                {selectedProject?.isPumpfunToken && (
                  <div className="space-y-2">
                    <Label htmlFor="pumpfun-key">PumpFun Creator Wallet Private Key (Base58) - Optional</Label>
                    <div className="relative">
                      <Input
                        id="pumpfun-key"
                        type={showPumpfunKey ? "text" : "password"}
                        value={pumpfunKey}
                        onChange={(e) => setPumpfunKey(e.target.value)}
                        placeholder="Enter PumpFun creator wallet private key"
                        className="font-mono pr-10"
                        data-testid="input-pumpfun-key"
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="absolute right-1 top-1/2 -translate-y-1/2"
                        onClick={() => setShowPumpfunKey(!showPumpfunKey)}
                        data-testid="button-toggle-pumpfun-visibility"
                      >
                        {showPumpfunKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </Button>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Used to claim PumpFun creator rewards (0.05% of trading volume) before buybacks.
                    </p>
                  </div>
                )}

                <div className="flex gap-3 pt-4">
                  <Button
                    onClick={handleSaveKeys}
                    disabled={saveKeysMutation.isPending}
                    data-testid="button-save-keys"
                    className="flex-1"
                  >
                    {saveKeysMutation.isPending ? "Saving..." : "Save Keys Securely"}
                  </Button>

                  {keyMetadata?.hasTreasuryKey && (
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button
                          variant="destructive"
                          disabled={deleteKeysMutation.isPending}
                          data-testid="button-delete-keys"
                        >
                          <Trash2 className="h-4 w-4 mr-2" />
                          Delete Keys
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Delete Automation Keys?</AlertDialogTitle>
                          <AlertDialogDescription>
                            This will permanently delete your encrypted private keys for this project.
                            Automated buybacks will stop working until you add new keys.
                            This action cannot be undone.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction
                            onClick={handleDeleteKeys}
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                          >
                            Delete Keys
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  )}
                </div>

                <Alert>
                  <AlertDescription className="text-xs">
                    <strong>Note:</strong> When you click "Save Keys Securely", you'll be prompted to sign a message with your wallet
                    to verify ownership. This signature is not stored and only proves you own the project.
                  </AlertDescription>
                </Alert>
              </>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Payment Address</CardTitle>
          <CardDescription>Solana address where service fees should be sent</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="payment-address">Treasury Address</Label>
            <Input
              id="payment-address"
              value="jawKuQ3xtcYoAuqE9jyG2H35sv2pWJSzsyjoNpsxG38"
              readOnly
              className="font-mono text-sm"
              data-testid="input-payment-address"
            />
            <p className="text-sm text-muted-foreground">
              Send 0.2 SOL (Starter) or 0.4 SOL (Pro) to this address to activate your projects
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
