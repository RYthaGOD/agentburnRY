// Real-time monitoring component for token price and bot activity
// Displays live price updates, bot status, and recent transaction accuracy

import { useEffect, useState, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRealtime } from "@/hooks/use-realtime";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Activity, TrendingUp, Bot, Clock, AlertTriangle, CheckCircle2, Zap } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

interface RealtimeMonitoringProps {
  projectId: string;
  tokenMintAddress: string;
}

interface ProjectMetrics {
  projectId: string;
  tokenMintAddress: string;
  latestPriceSOL: string | null;
  priceTimestamp: string | null;
  lastBotRunAt: string | null;
  lastBotStatus: string | null;
  volumeBotEnabled: boolean;
  buyBotEnabled: boolean;
}

export default function RealtimeMonitoring({ projectId, tokenMintAddress }: RealtimeMonitoringProps) {
  const { isConnected, latestPrices } = useRealtime();
  const [lastUpdate, setLastUpdate] = useState<Date>(new Date());

  // Fetch initial metrics via REST
  const { data: metrics } = useQuery<ProjectMetrics>({
    queryKey: ["/api/projects", projectId, "metrics"],
    enabled: !!projectId,
  });

  // Subscribe to real-time price updates
  useEffect(() => {
    const cachedPrice = latestPrices.get(tokenMintAddress);
    if (cachedPrice) {
      setLastUpdate(new Date(cachedPrice.timestamp));
    }
  }, [latestPrices, tokenMintAddress]);

  const currentPrice = latestPrices.get(tokenMintAddress)?.priceSOL || 
    (metrics?.latestPriceSOL ? parseFloat(metrics.latestPriceSOL) : null);

  const formatPrice = (price: number | null) => {
    if (!price) return "Loading...";
    return price.toFixed(9) + " SOL";
  };

  const formatTimestamp = (timestamp: string | Date | null | undefined) => {
    if (!timestamp) return "Never";
    try {
      return formatDistanceToNow(new Date(timestamp), { addSuffix: true });
    } catch {
      return "Unknown";
    }
  };

  const getBotStatusBadge = (status: string | null | undefined) => {
    if (!status) return <Badge variant="secondary" className="gap-1"><Clock className="w-3 h-3" />Pending</Badge>;
    
    switch (status) {
      case "success":
        return <Badge variant="default" className="gap-1 bg-green-600 hover:bg-green-700"><CheckCircle2 className="w-3 h-3" />Success</Badge>;
      case "failed":
        return <Badge variant="destructive" className="gap-1"><AlertTriangle className="w-3 h-3" />Failed</Badge>;
      case "skipped":
        return <Badge variant="secondary" className="gap-1"><Zap className="w-3 h-3" />Skipped</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  return (
    <div className="grid gap-4 md:grid-cols-3" data-testid="realtime-monitoring">
      {/* Live Price Card */}
      <Card className="ember-glow" data-testid="card-live-price">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Live Token Price</CardTitle>
          <TrendingUp className="h-4 w-4 text-primary" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold text-primary" data-testid="text-current-price">
            {formatPrice(currentPrice)}
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground mt-2">
            <Activity className={`h-3 w-3 ${isConnected ? "text-green-500" : "text-red-500"}`} />
            <span data-testid="text-connection-status">
              {isConnected ? "Connected" : "Disconnected"}
            </span>
            {isConnected && (
              <span className="text-muted-foreground" data-testid="text-last-update">
                • Updated {formatTimestamp(lastUpdate)}
              </span>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Volume Bot Status Card */}
      <Card data-testid="card-volume-bot-status">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Volume Bot</CardTitle>
          <Bot className="h-4 w-4 text-accent" />
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-2">
            {getBotStatusBadge(metrics?.lastBotStatus)}
            {metrics?.volumeBotEnabled && (
              <Badge variant="outline" className="gap-1">
                <Activity className="w-3 h-3" />Active
              </Badge>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-2" data-testid="text-last-volume-run">
            Last run: {formatTimestamp(metrics?.lastBotRunAt)}
          </p>
        </CardContent>
      </Card>

      {/* Buy Bot Status Card */}
      <Card data-testid="card-buy-bot-status">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Buy Bot</CardTitle>
          <Bot className="h-4 w-4 text-accent" />
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-2">
            {getBotStatusBadge(metrics?.lastBotStatus)}
            {metrics?.buyBotEnabled && (
              <Badge variant="outline" className="gap-1">
                <Activity className="w-3 h-3" />Active
              </Badge>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-2" data-testid="text-last-buy-run">
            Last run: {formatTimestamp(metrics?.lastBotRunAt)}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
