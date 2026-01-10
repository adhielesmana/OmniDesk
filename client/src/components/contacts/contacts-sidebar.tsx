import { Users, Star, Ban, Tag, MessageCircle } from "lucide-react";
import { SiWhatsapp, SiFacebook, SiInstagram } from "react-icons/si";
import { Badge } from "@/components/ui/badge";
import { Link, useLocation } from "wouter";
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
import type { Platform } from "@shared/schema";

interface ContactsSidebarProps {
  selectedPlatform: Platform | "all";
  onSelectPlatform: (platform: Platform | "all") => void;
  platformCounts: Record<Platform | "all", number>;
  showFavorites: boolean;
  onToggleFavorites: () => void;
  showBlocked: boolean;
  onToggleBlocked: () => void;
  allTags: string[];
  selectedTag: string | null;
  onSelectTag: (tag: string | null) => void;
}

export function ContactsSidebar({
  selectedPlatform,
  onSelectPlatform,
  platformCounts,
  showFavorites,
  onToggleFavorites,
  showBlocked,
  onToggleBlocked,
  allTags,
  selectedTag,
  onSelectTag,
}: ContactsSidebarProps) {
  const [location] = useLocation();

  const platforms: { id: Platform | "all"; name: string; icon: React.ReactNode; color: string }[] = [
    {
      id: "all",
      name: "All Contacts",
      icon: <Users className="h-5 w-5" />,
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
          <Users className="h-5 w-5 text-primary" />
          Contacts
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
                const isSelected = selectedPlatform === platform.id && !showFavorites && !showBlocked;
                const count = platformCounts[platform.id] || 0;

                return (
                  <SidebarMenuItem key={platform.id}>
                    <SidebarMenuButton
                      onClick={() => {
                        onSelectPlatform(platform.id);
                        if (showFavorites) onToggleFavorites();
                        if (showBlocked) onToggleBlocked();
                        if (selectedTag) onSelectTag(null);
                      }}
                      isActive={isSelected}
                      data-testid={`button-platform-${platform.id}`}
                    >
                      <span className={platform.color}>{platform.icon}</span>
                      <span className="flex-1">{platform.name}</span>
                      {count > 0 && (
                        <Badge variant="secondary" className="min-w-[24px] justify-center">
                          {count}
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
                <SidebarMenuButton
                  onClick={onToggleFavorites}
                  isActive={showFavorites}
                  data-testid="button-favorites"
                >
                  <Star className="h-5 w-5" />
                  <span>Favorites</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton
                  onClick={onToggleBlocked}
                  isActive={showBlocked}
                  data-testid="button-blocked"
                >
                  <Ban className="h-5 w-5" />
                  <span>Blocked</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {allTags.length > 0 && (
          <>
            <SidebarSeparator />
            <SidebarGroup>
              <SidebarGroupLabel>Tags</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {allTags.map((tag) => (
                    <SidebarMenuItem key={tag}>
                      <SidebarMenuButton
                        onClick={() => onSelectTag(selectedTag === tag ? null : tag)}
                        isActive={selectedTag === tag}
                        data-testid={`button-tag-${tag}`}
                      >
                        <Tag className="h-4 w-4" />
                        <span>{tag}</span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          </>
        )}
      </SidebarContent>

      <SidebarFooter className="p-2">
        <p className="text-xs text-muted-foreground text-center">
          Manage your contacts
        </p>
      </SidebarFooter>
    </Sidebar>
  );
}
