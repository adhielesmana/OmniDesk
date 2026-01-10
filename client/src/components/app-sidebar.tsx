import { MessageCircle, Settings, Archive, Star } from "lucide-react";
import { SiWhatsapp, SiFacebook, SiInstagram } from "react-icons/si";
import { Badge } from "@/components/ui/badge";
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
import type { Platform } from "@shared/schema";

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
          <MessageCircle className="h-5 w-5 text-primary" />
          Unified Inbox
        </h1>
      </SidebarHeader>

      <SidebarContent>
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
      </SidebarFooter>
    </Sidebar>
  );
}
