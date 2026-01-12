import { MessageCircle, Settings, Archive, Star } from "lucide-react";
import { SiWhatsapp, SiFacebook, SiInstagram } from "react-icons/si";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import type { Platform } from "@shared/schema";

interface PlatformSidebarProps {
  selectedPlatform: Platform | "all";
  onSelectPlatform: (platform: Platform | "all") => void;
  unreadCounts: Record<Platform | "all", number>;
  onSettingsClick: () => void;
}

export function PlatformSidebar({
  selectedPlatform,
  onSelectPlatform,
  unreadCounts,
  onSettingsClick,
}: PlatformSidebarProps) {
  const platforms: { id: Platform | "all"; name: string; icon: React.ReactNode; color: string }[] = [
    {
      id: "all",
      name: "All Inboxes",
      icon: <MessageCircle className="h-5 w-5" />,
      color: "text-foreground",
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
    <div className="flex flex-col h-full bg-sidebar border-r border-sidebar-border">
      <div className="p-4 border-b border-sidebar-border">
        <h1 className="text-lg font-semibold text-sidebar-foreground flex items-center gap-2">
          <MessageCircle className="h-5 w-5 text-primary" />
          OmniDesk
        </h1>
      </div>

      <nav className="flex-1 p-2 space-y-1">
        {platforms.map((platform) => {
          const isSelected = selectedPlatform === platform.id;
          const unreadCount = unreadCounts[platform.id] || 0;

          return (
            <Button
              key={platform.id}
              variant={isSelected ? "secondary" : "ghost"}
              className={`w-full justify-start gap-3 ${isSelected ? "bg-sidebar-accent" : ""}`}
              onClick={() => onSelectPlatform(platform.id)}
              data-testid={`button-platform-${platform.id}`}
            >
              <span className={platform.color}>{platform.icon}</span>
              <span className="flex-1 text-left text-sidebar-foreground">{platform.name}</span>
              {unreadCount > 0 && (
                <Badge variant="default" className="min-w-[24px] justify-center">
                  {unreadCount > 99 ? "99+" : unreadCount}
                </Badge>
              )}
            </Button>
          );
        })}

        <Separator className="my-4" />

        <Button
          variant="ghost"
          className="w-full justify-start gap-3"
          data-testid="button-starred"
        >
          <Star className="h-5 w-5 text-muted-foreground" />
          <span className="text-sidebar-foreground">Starred</span>
        </Button>

        <Button
          variant="ghost"
          className="w-full justify-start gap-3"
          data-testid="button-archived"
        >
          <Archive className="h-5 w-5 text-muted-foreground" />
          <span className="text-sidebar-foreground">Archived</span>
        </Button>
      </nav>

      <div className="p-2 border-t border-sidebar-border">
        <Button
          variant="ghost"
          className="w-full justify-start gap-3"
          onClick={onSettingsClick}
          data-testid="button-settings"
        >
          <Settings className="h-5 w-5 text-muted-foreground" />
          <span className="text-sidebar-foreground">Settings</span>
        </Button>
      </div>
    </div>
  );
}
