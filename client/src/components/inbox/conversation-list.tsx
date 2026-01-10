import { useState } from "react";
import { Search, Filter, MoreVertical, Pin, Archive } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { PlatformIcon, getPlatformName } from "@/components/platform-icons";
import type { ConversationWithContact, Platform } from "@shared/schema";
import { formatDistanceToNow } from "date-fns";

interface ConversationListProps {
  conversations: ConversationWithContact[];
  selectedConversationId: string | null;
  onSelectConversation: (id: string) => void;
  onArchive: (id: string) => void;
  onPin: (id: string) => void;
  isLoading: boolean;
  selectedPlatform: Platform | "all";
}

export function ConversationList({
  conversations,
  selectedConversationId,
  onSelectConversation,
  onArchive,
  onPin,
  isLoading,
  selectedPlatform,
}: ConversationListProps) {
  const [searchQuery, setSearchQuery] = useState("");

  const filteredConversations = conversations.filter((conv) => {
    const matchesSearch =
      !searchQuery ||
      conv.contact.name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      conv.contact.phoneNumber?.includes(searchQuery) ||
      conv.lastMessagePreview?.toLowerCase().includes(searchQuery.toLowerCase());

    const matchesPlatform =
      selectedPlatform === "all" || conv.platform === selectedPlatform;

    return matchesSearch && matchesPlatform;
  });

  const getInitials = (name: string | null | undefined) => {
    if (!name) return "?";
    return name
      .split(" ")
      .map((n) => n[0])
      .join("")
      .toUpperCase()
      .slice(0, 2);
  };

  const formatTime = (date: Date | null | undefined) => {
    if (!date) return "";
    try {
      return formatDistanceToNow(new Date(date), { addSuffix: false });
    } catch {
      return "";
    }
  };

  if (isLoading) {
    return (
      <div className="flex flex-col h-full border-r border-border bg-background">
        <div className="p-4 border-b border-border space-y-3">
          <div className="h-9 bg-muted rounded-md animate-pulse" />
        </div>
        <div className="flex-1 p-2 space-y-2">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="p-3 rounded-lg">
              <div className="flex items-center gap-3">
                <div className="h-12 w-12 rounded-full bg-muted animate-pulse" />
                <div className="flex-1 space-y-2">
                  <div className="h-4 w-24 bg-muted rounded animate-pulse" />
                  <div className="h-3 w-36 bg-muted rounded animate-pulse" />
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full border-r border-border bg-background">
      <div className="p-4 border-b border-border space-y-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search conversations..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
            data-testid="input-search-conversations"
          />
        </div>
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">
            {filteredConversations.length} conversation{filteredConversations.length !== 1 ? "s" : ""}
          </span>
          <Button variant="ghost" size="icon" data-testid="button-filter">
            <Filter className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-2 space-y-1">
          {filteredConversations.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
              <div className="h-16 w-16 rounded-full bg-muted flex items-center justify-center mb-4">
                <Search className="h-8 w-8 text-muted-foreground" />
              </div>
              <p className="text-muted-foreground font-medium">No conversations found</p>
              <p className="text-sm text-muted-foreground mt-1">
                {searchQuery
                  ? "Try adjusting your search"
                  : "Messages will appear here when you receive them"}
              </p>
            </div>
          ) : (
            filteredConversations.map((conv) => {
              const isSelected = conv.id === selectedConversationId;

              return (
                <div
                  key={conv.id}
                  className={`group relative p-3 rounded-lg cursor-pointer transition-colors hover-elevate ${
                    isSelected ? "bg-accent" : ""
                  }`}
                  onClick={() => onSelectConversation(conv.id)}
                  data-testid={`conversation-item-${conv.id}`}
                >
                  <div className="flex items-start gap-3">
                    <div className="relative">
                      <Avatar className="h-12 w-12">
                        <AvatarImage src={conv.contact.profilePictureUrl || undefined} />
                        <AvatarFallback className="bg-muted text-muted-foreground">
                          {getInitials(conv.contact.name)}
                        </AvatarFallback>
                      </Avatar>
                      <div className="absolute -bottom-1 -right-1 bg-background rounded-full p-0.5">
                        <PlatformIcon platform={conv.platform} className="h-4 w-4" />
                      </div>
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium text-foreground truncate">
                          {conv.contact.name || conv.contact.phoneNumber || "Unknown"}
                        </span>
                        <span className="text-xs text-muted-foreground whitespace-nowrap">
                          {formatTime(conv.lastMessageAt)}
                        </span>
                      </div>

                      <div className="flex items-center justify-between gap-2 mt-1">
                        <p className="text-sm text-muted-foreground truncate">
                          {conv.lastMessagePreview || "No messages yet"}
                        </p>
                        {conv.unreadCount && conv.unreadCount > 0 && (
                          <Badge variant="default" className="min-w-[20px] h-5 justify-center">
                            {conv.unreadCount}
                          </Badge>
                        )}
                      </div>

                      {conv.isPinned && (
                        <div className="flex items-center gap-1 mt-1">
                          <Pin className="h-3 w-3 text-primary" />
                          <span className="text-xs text-primary">Pinned</span>
                        </div>
                      )}
                    </div>

                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 opacity-0 group-hover:opacity-100 transition-opacity"
                          onClick={(e) => e.stopPropagation()}
                          data-testid={`button-conversation-menu-${conv.id}`}
                        >
                          <MoreVertical className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          onClick={(e) => {
                            e.stopPropagation();
                            onPin(conv.id);
                          }}
                        >
                          <Pin className="h-4 w-4 mr-2" />
                          {conv.isPinned ? "Unpin" : "Pin"}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={(e) => {
                            e.stopPropagation();
                            onArchive(conv.id);
                          }}
                        >
                          <Archive className="h-4 w-4 mr-2" />
                          Archive
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
