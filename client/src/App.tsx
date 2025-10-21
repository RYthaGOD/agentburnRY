import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/components/theme-provider";
import { SolanaWalletProvider } from "@/lib/wallet-provider";
import Landing from "@/pages/landing";
import Dashboard from "@/pages/dashboard";
import NewProject from "@/pages/new-project";
import ProjectDetails from "@/pages/project-details";
import Transactions from "@/pages/transactions";
import Settings from "@/pages/settings";
import Whitepaper from "@/pages/whitepaper";
import DashboardLayout from "@/pages/dashboard-layout";
import NotFound from "@/pages/not-found";

function Router() {
  return (
    <Switch>
      <Route path="/" component={Landing} />
      <Route path="/whitepaper" component={Whitepaper} />
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
            <Toaster />
            <Router />
          </TooltipProvider>
        </ThemeProvider>
      </SolanaWalletProvider>
    </QueryClientProvider>
  );
}

export default App;
