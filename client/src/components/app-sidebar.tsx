import { useState } from "react";
import { MessageCircle, Settings, Archive, Star, Users, LogOut, Shield, Send, Megaphone, Bot, Key, FileText, ChevronDown, ChevronRight } from "lucide-react";
import { SiWhatsapp, SiFacebook, SiInstagram } from "react-icons/si";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
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
  SidebarMenuSub,
  SidebarMenuSubItem,
  SidebarMenuSubButton,
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

interface PlatformSettingsData {
  id: string;
  platform: "whatsapp" | "instagram" | "facebook";
  isConnected: boolean;
  accessToken: string | null;
}

interface AppSidebarProps {
  selectedPlatform: Platform | "all";
  onSelectPlatform: (platform: Platform | "all") => void;
  unreadCounts: Record<Platform | "all", number>;
  onSettingsClick: () => void;
  onAutoReplyClick?: () => void;
}

export function AppSidebar({
  selectedPlatform,
  onSelectPlatform,
  unreadCounts,
  onSettingsClick,
  onAutoReplyClick,
}: AppSidebarProps) {
  const [location, setLocation] = useLocation();
  const { isAdmin } = useAuth();
  const [apiMenuOpen, setApiMenuOpen] = useState(false);
  
  const { data: branding } = useQuery<BrandingData>({
    queryKey: ["/api/admin/branding"],
  });

  const { data: platformSettings = [] } = useQuery<PlatformSettingsData[]>({
    queryKey: ["/api/platform-settings"],
    refetchInterval: 30000,
  });

  const getPlatformStatus = (platformId: string): "connected" | "configured" | "disconnected" => {
    if (platformId === "all") return "connected";
    const settings = platformSettings.find(p => p.platform === platformId);
    if (!settings) return "disconnected";
    if (settings.isConnected) return "connected";
    if (settings.accessToken) return "configured";
    return "disconnected";
  };

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
            {branding?.organizationName || "OmniDesk"}
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
                const status = getPlatformStatus(platform.id);

                return (
                  <SidebarMenuItem key={platform.id}>
                    <SidebarMenuButton
                      onClick={() => onSelectPlatform(platform.id)}
                      isActive={isSelected}
                      data-testid={`button-platform-${platform.id}`}
                    >
                      <span className={`relative ${platform.color}`}>
                        {platform.icon}
                        {platform.id !== "all" && (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span
                                className={`absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full border border-sidebar ${
                                  status === "connected" ? "bg-green-500" : 
                                  status === "configured" ? "bg-yellow-500" : 
                                  "bg-gray-400"
                                }`}
                                data-testid={`status-${platform.id}`}
                              />
                            </TooltipTrigger>
                            <TooltipContent side="right" className="text-xs">
                              {status === "connected" ? "Connected" : 
                               status === "configured" ? "Configured (not tested)" : 
                               "Not connected"}
                            </TooltipContent>
                          </Tooltip>
                        )}
                      </span>
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

        {isAdmin && (
          <>
            <SidebarSeparator />

            <SidebarGroup>
              <SidebarGroupLabel>Automation</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  <SidebarMenuItem>
                    <SidebarMenuButton 
                      onClick={() => setLocation("/blast")} 
                      isActive={location === "/blast"}
                      data-testid="button-blast-campaign"
                    >
                      <Megaphone className="h-5 w-5" />
                      <span>Blast Campaign</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>

                  <Collapsible open={apiMenuOpen} onOpenChange={setApiMenuOpen}>
                    <SidebarMenuItem>
                      <CollapsibleTrigger asChild>
                        <SidebarMenuButton data-testid="button-api-message">
                          <Send className="h-5 w-5" />
                          <span className="flex-1">API Message</span>
                          {apiMenuOpen ? (
                            <ChevronDown className="h-4 w-4" />
                          ) : (
                            <ChevronRight className="h-4 w-4" />
                          )}
                        </SidebarMenuButton>
                      </CollapsibleTrigger>
                      <CollapsibleContent>
                        <SidebarMenuSub>
                          <SidebarMenuSubItem>
                            <SidebarMenuSubButton 
                              onClick={() => setLocation("/admin?tab=api-clients")}
                              data-testid="button-api-key"
                            >
                              <Key className="h-4 w-4" />
                              <span>API Key</span>
                            </SidebarMenuSubButton>
                          </SidebarMenuSubItem>
                          <SidebarMenuSubItem>
                            <SidebarMenuSubButton 
                              onClick={() => setLocation("/admin?tab=api-docs")}
                              data-testid="button-api-docs"
                            >
                              <FileText className="h-4 w-4" />
                              <span>API Documentation</span>
                            </SidebarMenuSubButton>
                          </SidebarMenuSubItem>
                          <SidebarMenuSubItem>
                            <SidebarMenuSubButton 
                              onClick={() => setLocation("/admin?tab=api-queue")}
                              data-testid="button-api-queue"
                            >
                              <Send className="h-4 w-4" />
                              <span>API Queue</span>
                            </SidebarMenuSubButton>
                          </SidebarMenuSubItem>
                        </SidebarMenuSub>
                      </CollapsibleContent>
                    </SidebarMenuItem>
                  </Collapsible>

                  <SidebarMenuItem>
                    <SidebarMenuButton 
                      onClick={onAutoReplyClick}
                      data-testid="button-autoreply"
                    >
                      <Bot className="h-5 w-5" />
                      <span>Autoreply Message</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          </>
        )}
      </SidebarContent>

      <SidebarFooter className="p-2 space-y-2">
        <WhatsAppConnect />
        {isAdmin && (
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton onClick={onSettingsClick} data-testid="button-settings">
                <Settings className="h-5 w-5" />
                <span>Settings</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        )}
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
        <SidebarMenuItem>
          <SidebarMenuButton onClick={() => setLocation("/admin")} data-testid="button-admin">
            <Shield className="h-5 w-5" />
            <span>Admin Panel</span>
          </SidebarMenuButton>
        </SidebarMenuItem>
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
