import { Home, Plus, History, Settings, Flame, TrendingUp, DollarSign, Brain } from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { Link, useLocation } from "wouter";

const menuItems = [
  {
    title: "Overview",
    url: "/dashboard",
    icon: Home,
  },
  {
    title: "New Project",
    url: "/dashboard/new",
    icon: Plus,
  },
  {
    title: "Volume Bot",
    url: "/dashboard/volume-bot",
    icon: TrendingUp,
  },
  {
    title: "Trading Bot",
    url: "/dashboard/trading-bot",
    icon: DollarSign,
  },
  {
    title: "AI Bot",
    url: "/dashboard/ai-bot",
    icon: Brain,
  },
  {
    title: "Transactions",
    url: "/dashboard/transactions",
    icon: History,
  },
  {
    title: "Settings",
    url: "/dashboard/settings",
    icon: Settings,
  },
];

export function AppSidebar() {
  const [location] = useLocation();

  return (
    <Sidebar>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel className="flex items-center gap-2 py-4">
            <Flame className="h-5 w-5 text-primary" />
            <span className="text-lg font-bold">BurnBot</span>
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {menuItems.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton
                    asChild
                    isActive={location === item.url}
                    data-testid={`sidebar-${item.title.toLowerCase().replace(' ', '-')}`}
                  >
                    <Link href={item.url}>
                      <item.icon />
                      <span>{item.title}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  );
}
