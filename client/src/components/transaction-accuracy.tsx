// Transaction accuracy display component
// Shows recent transactions with expected vs actual prices and deviation

import { useQuery } from "@tanstack/react-query";
import { useTransactionEvents } from "@/hooks/use-realtime";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AlertTriangle, CheckCircle2, TrendingUp, TrendingDown } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

interface Transaction {
  id: string;
  type: string;
  amount: string;
  tokenAmount: string | null;
  txSignature: string;
  status: string;
  expectedPriceSOL: string | null;
  actualPriceSOL: string | null;
  priceDeviationBps: number | null;
  createdAt: string;
}

interface TransactionAccuracyProps {
  projectId: string;
}

export default function TransactionAccuracy({ projectId }: TransactionAccuracyProps) {
  // Fetch recent transactions
  const { data: transactions, isLoading } = useQuery<Transaction[]>({
    queryKey: ["/api/projects", projectId, "transactions", "recent"],
    enabled: !!projectId,
  });

  // Subscribe to real-time transaction events
  useTransactionEvents((event) => {
    console.log("[TransactionAccuracy] New transaction event:", event);
  });

  if (isLoading) {
    return (
      <Card data-testid="card-transaction-accuracy-loading">
        <CardHeader>
          <CardTitle>Recent Transactions</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center p-8">
            <div className="animate-spin w-6 h-6 border-4 border-primary border-t-transparent rounded-full" />
          </div>
        </CardContent>
      </Card>
    );
  }

  const recentTransactions = transactions?.slice(0, 10) || [];

  const getTypeBadge = (type: string) => {
    switch (type) {
      case "volume_buy":
        return <Badge variant="default" className="bg-blue-600 hover:bg-blue-700">Volume Buy</Badge>;
      case "volume_sell":
        return <Badge variant="secondary">Volume Sell</Badge>;
      case "limit_buy":
        return <Badge variant="default" className="bg-purple-600 hover:bg-purple-700">Limit Buy</Badge>;
      case "buyback":
        return <Badge variant="default">Buyback</Badge>;
      case "burn":
        return <Badge variant="destructive">Burn</Badge>;
      case "claim":
        return <Badge variant="outline">Claim</Badge>;
      default:
        return <Badge variant="outline">{type}</Badge>;
    }
  };

  const getAccuracyBadge = (deviationBps: number | null) => {
    if (deviationBps === null) return null;

    const deviation = Math.abs(deviationBps);
    const isPositive = deviationBps > 0;

    if (deviation <= 100) {
      // < 1% deviation
      return (
        <Badge variant="default" className="gap-1 bg-green-600 hover:bg-green-700" data-testid="badge-accuracy-good">
          <CheckCircle2 className="w-3 h-3" />
          Excellent ({(deviationBps / 100).toFixed(2)}%)
        </Badge>
      );
    } else if (deviation <= 500) {
      // 1-5% deviation
      return (
        <Badge variant="secondary" className="gap-1" data-testid="badge-accuracy-fair">
          {isPositive ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
          Fair ({(deviationBps / 100).toFixed(2)}%)
        </Badge>
      );
    } else {
      // > 5% deviation
      return (
        <Badge variant="destructive" className="gap-1" data-testid="badge-accuracy-poor">
          <AlertTriangle className="w-3 h-3" />
          High Slippage ({(deviationBps / 100).toFixed(2)}%)
        </Badge>
      );
    }
  };

  const formatPrice = (price: string | null) => {
    if (!price) return "N/A";
    return parseFloat(price).toFixed(9) + " SOL";
  };

  const formatTimestamp = (timestamp: string) => {
    try {
      return formatDistanceToNow(new Date(timestamp), { addSuffix: true });
    } catch {
      return "Unknown";
    }
  };

  return (
    <Card data-testid="card-transaction-accuracy">
      <CardHeader>
        <CardTitle>Recent Transactions & Accuracy</CardTitle>
      </CardHeader>
      <CardContent>
        {recentTransactions.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            No transactions yet. Trading bots will appear here once they execute.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Type</TableHead>
                  <TableHead>Expected Price</TableHead>
                  <TableHead>Actual Price</TableHead>
                  <TableHead>Accuracy</TableHead>
                  <TableHead>Time</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recentTransactions.map((tx) => (
                  <TableRow key={tx.id} data-testid={`row-transaction-${tx.id}`}>
                    <TableCell>{getTypeBadge(tx.type)}</TableCell>
                    <TableCell className="font-mono text-xs" data-testid={`text-expected-price-${tx.id}`}>
                      {formatPrice(tx.expectedPriceSOL)}
                    </TableCell>
                    <TableCell className="font-mono text-xs" data-testid={`text-actual-price-${tx.id}`}>
                      {formatPrice(tx.actualPriceSOL)}
                    </TableCell>
                    <TableCell>{getAccuracyBadge(tx.priceDeviationBps)}</TableCell>
                    <TableCell className="text-xs text-muted-foreground" data-testid={`text-time-${tx.id}`}>
                      {formatTimestamp(tx.createdAt)}
                    </TableCell>
                    <TableCell>
                      {tx.status === "completed" ? (
                        <Badge variant="outline" className="gap-1 text-green-600 border-green-600">
                          <CheckCircle2 className="w-3 h-3" />
                          Success
                        </Badge>
                      ) : tx.status === "failed" ? (
                        <Badge variant="destructive" className="gap-1">
                          <AlertTriangle className="w-3 h-3" />
                          Failed
                        </Badge>
                      ) : (
                        <Badge variant="secondary">Pending</Badge>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
