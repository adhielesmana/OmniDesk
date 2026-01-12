import { MessageCircle, Settings, Archive, Star, Users, LogOut, Shield, Send } from "lucide-react";
import { SiWhatsapp, SiFacebook, SiInstagram } from "react-icons/si";
import { Badge } from "@/components/ui/badge";
import { Link, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarFooter,
  SidebarSeparator,
} from "@/components/ui/sidebar";
import { WhatsAppConnect } from "./whatsapp-connect";
import { useAuth } from "@/hooks/use-auth";
import type { Platform } from "@shared/schema";

interface BrandingData {
  logoUrl: string | null;
  organizationName: string | null;
}

interface AppSidebarProps {
  selectedPlatform: Platform | "all";
  onSelectPlatform: (platform: Platform | "all") => void;
  unreadCounts: Record<Platform | "all", number>;
  onSettingsClick: () => void;
}

export function AppSidebar({
  selectedPlatform,
  onSelectPlatform,
  unreadCounts,
  onSettingsClick,
}: AppSidebarProps) {
  const [location] = useLocation();
  
  const { data: branding } = useQuery<BrandingData>({
    queryKey: ["/api/admin/branding"],
  });

  const platforms: { id: Platform | "all"; name: string; icon: React.ReactNode; color: string }[] = [
    {
      id: "all",
      name: "All Inboxes",
      icon: <MessageCircle className="h-5 w-5" />,
      color: "",
    },
    {
      id: "whatsapp",
      name: "WhatsApp",
      icon: <SiWhatsapp className="h-5 w-5" />,
      color: "text-[#25D366]",
    },
    {
      id: "instagram",
      name: "Instagram",
      icon: <SiInstagram className="h-5 w-5" />,
      color: "text-[#E4405F]",
    },
    {
      id: "facebook",
      name: "Facebook",
      icon: <SiFacebook className="h-5 w-5" />,
      color: "text-[#1877F2]",
    },
  ];

  return (
    <Sidebar>
      <SidebarHeader className="p-4">
        <h1 className="text-lg font-semibold flex items-center gap-2">
          {branding?.logoUrl ? (
            <img
              src={branding.logoUrl}
              alt="Logo"
              className="h-7 w-7 rounded object-cover"
              data-testid="img-sidebar-logo"
            />
          ) : (
            <MessageCircle className="h-5 w-5 text-primary" />
          )}
          <span className="truncate">
            {branding?.organizationName || "Unified Inbox"}
          </span>
        </h1>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Navigation</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton asChild isActive={location === "/"}>
                  <Link href="/" data-testid="link-inbox">
                    <MessageCircle className="h-5 w-5" />
                    <span>Inbox</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton asChild isActive={location === "/contacts"}>
                  <Link href="/contacts" data-testid="link-contacts">
                    <Users className="h-5 w-5" />
                    <span>Contacts</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarSeparator />

        <SidebarGroup>
          <SidebarGroupLabel>Platforms</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {platforms.map((platform) => {
                const isSelected = selectedPlatform === platform.id;
                const unreadCount = unreadCounts[platform.id] || 0;

                return (
                  <SidebarMenuItem key={platform.id}>
                    <SidebarMenuButton
                      onClick={() => onSelectPlatform(platform.id)}
                      isActive={isSelected}
                      data-testid={`button-platform-${platform.id}`}
                    >
                      <span className={platform.color}>{platform.icon}</span>
                      <span className="flex-1">{platform.name}</span>
                      {unreadCount > 0 && (
                        <Badge variant="default" className="min-w-[24px] justify-center">
                          {unreadCount > 99 ? "99+" : unreadCount}
                        </Badge>
                      )}
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarSeparator />

        <SidebarGroup>
          <SidebarGroupLabel>Filters</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton data-testid="button-starred">
                  <Star className="h-5 w-5" />
                  <span>Starred</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton data-testid="button-archived">
                  <Archive className="h-5 w-5" />
                  <span>Archived</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="p-2 space-y-2">
        <WhatsAppConnect />
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton onClick={onSettingsClick} data-testid="button-settings">
              <Settings className="h-5 w-5" />
              <span>Settings</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
        <UserMenu />
      </SidebarFooter>
    </Sidebar>
  );
}

function UserMenu() {
  const { user, isAdmin, logout } = useAuth();
  const [, setLocation] = useLocation();

  if (!user) return null;

  return (
    <SidebarMenu>
      {isAdmin && (
        <>
          <SidebarMenuItem>
            <SidebarMenuButton onClick={() => setLocation("/blast")} data-testid="button-blast">
              <Send className="h-5 w-5" />
              <span>Blast Campaigns</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton onClick={() => setLocation("/admin")} data-testid="button-admin">
              <Shield className="h-5 w-5" />
              <span>Admin Panel</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </>
      )}
      <SidebarMenuItem>
        <SidebarMenuButton onClick={logout} data-testid="button-logout">
          <LogOut className="h-5 w-5" />
          <span>Logout</span>
          <span className="ml-auto text-xs text-muted-foreground truncate max-w-[80px]">
            {user.displayName || user.username}
          </span>
        </SidebarMenuButton>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
