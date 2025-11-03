import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/components/theme-provider";
import { SolanaWalletProvider } from "@/lib/wallet-provider";
import { RealtimeProvider } from "@/hooks/use-realtime";
import Landing from "@/pages/landing";
import Dashboard from "@/pages/dashboard";
import NewProject from "@/pages/new-project";
import ProjectDetails from "@/pages/project-details";
import Transactions from "@/pages/transactions";
import Settings from "@/pages/settings";
import Blacklist from "@/pages/blacklist";
import Whitepaper from "@/pages/whitepaper";
import PublicStats from "@/pages/public-stats";
import TokenAnalyzer from "@/pages/token-analyzer";
import HowItWorks from "@/pages/how-it-works";
import AgentBurn from "@/pages/agent-burn";
import DashboardLayout from "@/pages/dashboard-layout";
import NotFound from "@/pages/not-found";

function Router() {
  return (
    <Switch>
      <Route path="/" component={Landing} />
      <Route path="/stats" component={PublicStats} />
      <Route path="/analyze" component={TokenAnalyzer} />
      <Route path="/learn" component={HowItWorks} />
      <Route path="/whitepaper" component={Whitepaper} />
      <Route path="/agent-burn" component={AgentBurn} />
      <Route path="/dashboard">
        <DashboardLayout>
          <Dashboard />
        </DashboardLayout>
      </Route>
      <Route path="/dashboard/new">
        <DashboardLayout>
          <NewProject />
        </DashboardLayout>
      </Route>
      <Route path="/dashboard/projects/:id">
        <DashboardLayout>
          <ProjectDetails />
        </DashboardLayout>
      </Route>
      <Route path="/dashboard/transactions">
        <DashboardLayout>
          <Transactions />
        </DashboardLayout>
      </Route>
      <Route path="/dashboard/settings">
        <DashboardLayout>
          <Settings />
        </DashboardLayout>
      </Route>
      <Route path="/dashboard/blacklist">
        <DashboardLayout>
          <Blacklist />
        </DashboardLayout>
      </Route>
      <Route path="/dashboard/agent-burn">
        <DashboardLayout>
          <AgentBurn />
        </DashboardLayout>
      </Route>
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <SolanaWalletProvider>
        <ThemeProvider defaultTheme="dark">
          <TooltipProvider>
            <RealtimeProvider>
              <Toaster />
              <Router />
            </RealtimeProvider>
          </TooltipProvider>
        </ThemeProvider>
      </SolanaWalletProvider>
    </QueryClientProvider>
  );
}

export default App;
