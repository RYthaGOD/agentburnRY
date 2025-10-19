import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Copy, CheckCircle, AlertCircle, ExternalLink } from "lucide-react";
import { TREASURY_WALLET_ADDRESS, PRICING } from "@shared/config";
import { useToast } from "@/hooks/use-toast";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";

interface PaymentModalProps {
  open: boolean;
  onClose: () => void;
  projectId: string;
  tier: "STARTER" | "PRO";
  ownerWalletAddress: string;
  onSuccess?: () => void;
}

export function PaymentModal({ open, onClose, projectId, tier, ownerWalletAddress, onSuccess }: PaymentModalProps) {
  const [txSignature, setTxSignature] = useState("");
  const { toast } = useToast();

  const tierData = PRICING[tier];

  const verifyPaymentMutation = useMutation({
    mutationFn: async (signature: string) => {
      const response = await apiRequest("POST", "/api/verify-payment-onchain", {
        txSignature: signature,
        projectId,
        tier,
        ownerWalletAddress,
      });
      
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || "Payment verification failed");
      }
      
      return response.json();
    },
    onSuccess: () => {
      toast({
        title: "Payment Verified!",
        description: "Your project has been activated successfully.",
      });
      onSuccess?.();
      onClose();
    },
    onError: (error: Error) => {
      toast({
        title: "Verification Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast({
      title: "Copied!",
      description: "Address copied to clipboard",
    });
  };

  const handleVerify = () => {
    if (!txSignature.trim()) {
      toast({
        title: "Error",
        description: "Please enter a transaction signature",
        variant: "destructive",
      });
      return;
    }
    verifyPaymentMutation.mutate(txSignature.trim());
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[500px]" data-testid="dialog-payment">
        <DialogHeader>
          <DialogTitle>Complete Payment</DialogTitle>
          <DialogDescription>
            Send {tierData.priceSOL} SOL to activate your {tierData.name} subscription
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Step 1: Send SOL */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <div className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-primary-foreground text-sm font-bold">
                1
              </div>
              <h4 className="font-semibold">Send SOL to Treasury Wallet</h4>
            </div>
            
            <div className="ml-8 space-y-2">
              <div className="flex items-center gap-2 p-3 bg-muted rounded-md">
                <code className="flex-1 text-sm font-mono break-all" data-testid="text-treasury-address">
                  {TREASURY_WALLET_ADDRESS}
                </code>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => copyToClipboard(TREASURY_WALLET_ADDRESS)}
                  data-testid="button-copy-address"
                >
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
              
              <Alert>
                <AlertCircle className="h-4 w-4" />
                <AlertDescription className="text-sm">
                  Amount: <strong>{tierData.priceSOL} SOL</strong> (send exact amount or more)
                </AlertDescription>
              </Alert>
            </div>
          </div>

          {/* Step 2: Get Transaction Signature */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <div className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-primary-foreground text-sm font-bold">
                2
              </div>
              <h4 className="font-semibold">Enter Transaction Signature</h4>
            </div>
            
            <div className="ml-8 space-y-2">
              <Label htmlFor="txSignature">Transaction Signature</Label>
              <Input
                id="txSignature"
                placeholder="Paste your transaction signature here"
                value={txSignature}
                onChange={(e) => setTxSignature(e.target.value)}
                className="font-mono text-sm"
                data-testid="input-tx-signature"
              />
              <p className="text-xs text-muted-foreground">
                After sending SOL, copy the transaction signature from your wallet and paste it here.
                You can also find it on{" "}
                <a
                  href="https://solscan.io"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline inline-flex items-center gap-1"
                >
                  Solscan
                  <ExternalLink className="h-3 w-3" />
                </a>
              </p>
            </div>
          </div>

          {/* Verification Status */}
          {verifyPaymentMutation.isPending && (
            <Alert>
              <AlertCircle className="h-4 w-4 animate-pulse" />
              <AlertDescription>
                Verifying payment on Solana blockchain...
              </AlertDescription>
            </Alert>
          )}

          {verifyPaymentMutation.isSuccess && (
            <Alert className="border-green-500 bg-green-50 dark:bg-green-950">
              <CheckCircle className="h-4 w-4 text-green-600" />
              <AlertDescription className="text-green-800 dark:text-green-200">
                Payment verified successfully! Your project is now active.
              </AlertDescription>
            </Alert>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={onClose}
            disabled={verifyPaymentMutation.isPending}
            data-testid="button-cancel-payment"
          >
            Cancel
          </Button>
          <Button
            onClick={handleVerify}
            disabled={!txSignature.trim() || verifyPaymentMutation.isPending}
            data-testid="button-verify-payment"
          >
            {verifyPaymentMutation.isPending ? "Verifying..." : "Verify Payment"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
