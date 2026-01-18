import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import { Search, Filter, MoreVertical, Pin, Archive, ChevronDown } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { getAvatarColor, getInitials } from "@/lib/avatar-colors";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { PlatformIcon } from "@/components/platform-icons";
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

const INITIAL_VISIBLE = 30;
const LOAD_MORE_COUNT = 20;

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
  const [visibleCount, setVisibleCount] = useState(INITIAL_VISIBLE);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  const filteredConversations = useMemo(() => {
    const query = searchQuery.toLowerCase();
    return conversations.filter((conv) => {
      const matchesSearch =
        !query ||
        conv.contact.name?.toLowerCase().includes(query) ||
        conv.contact.phoneNumber?.includes(searchQuery) ||
        conv.lastMessagePreview?.toLowerCase().includes(query);

      const matchesPlatform =
        selectedPlatform === "all" || conv.platform === selectedPlatform;

      return matchesSearch && matchesPlatform;
    });
  }, [conversations, searchQuery, selectedPlatform]);

  const visibleConversations = useMemo(() => {
    return filteredConversations.slice(0, visibleCount);
  }, [filteredConversations, visibleCount]);

  const hasMore = filteredConversations.length > visibleCount;

  useEffect(() => {
    setVisibleCount(INITIAL_VISIBLE);
  }, [searchQuery, selectedPlatform]);

  const handleScroll = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container || !hasMore) return;

    const { scrollTop, scrollHeight, clientHeight } = container;
    if (scrollHeight - scrollTop - clientHeight < 200) {
      setVisibleCount(prev => Math.min(prev + LOAD_MORE_COUNT, filteredConversations.length));
    }
  }, [hasMore, filteredConversations.length]);


  const formatTime = useCallback((date: Date | null | undefined) => {
    if (!date) return "";
    try {
      return formatDistanceToNow(new Date(date), { addSuffix: false });
    } catch {
      return "";
    }
  }, []);

  if (isLoading) {
    return (
      <div className="flex flex-col h-full bg-background overflow-hidden">
        <div className="p-3 border-b border-border space-y-3 shrink-0 bg-background">
          <div className="h-10 bg-muted rounded-lg animate-pulse" />
        </div>
        <div className="flex-1 p-2 space-y-1">
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
    <div className="flex flex-col h-full bg-background overflow-hidden">
      <div className="p-3 border-b border-border space-y-2 shrink-0 bg-background">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9 h-10 bg-muted/50 border-0 focus-visible:ring-1"
            data-testid="input-search-conversations"
          />
        </div>
        <div className="flex items-center justify-between px-1">
          <span className="text-xs text-muted-foreground">
            {filteredConversations.length} chat{filteredConversations.length !== 1 ? "s" : ""}
          </span>
          <Button variant="ghost" size="sm" className="h-7 px-2" data-testid="button-filter">
            <Filter className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      <div 
        ref={scrollContainerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto"
      >
        <div className="p-1.5 space-y-0.5">
          {visibleConversations.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
              <div className="h-14 w-14 rounded-full bg-muted flex items-center justify-center mb-4">
                <Search className="h-7 w-7 text-muted-foreground" />
              </div>
              <p className="text-muted-foreground font-medium text-sm">No chats found</p>
              <p className="text-xs text-muted-foreground mt-1">
                {searchQuery
                  ? "Try adjusting your search"
                  : "Messages will appear here"}
              </p>
            </div>
          ) : (
            <>
              {visibleConversations.map((conv) => {
                const isSelected = conv.id === selectedConversationId;

                return (
                  <div
                    role="button"
                    tabIndex={0}
                    key={conv.id}
                    className={`group relative p-2.5 rounded-xl cursor-pointer w-full text-left ${
                      isSelected 
                        ? "bg-primary/10 border border-primary/20" 
                        : "hover:bg-muted/50 active:bg-muted"
                    }`}
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      onSelectConversation(conv.id);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        onSelectConversation(conv.id);
                      }
                    }}
                    data-testid={`conversation-item-${conv.id}`}
                  >
                    <div className="flex items-center gap-3">
                      <div className="relative shrink-0">
                        <Avatar className="h-12 w-12">
                          <AvatarFallback 
                            style={{ 
                              backgroundColor: getAvatarColor(conv.contact.name).bg,
                              color: getAvatarColor(conv.contact.name).text 
                            }}
                          >
                            {getInitials(conv.contact.name)}
                          </AvatarFallback>
                        </Avatar>
                        <div className="absolute -bottom-0.5 -right-0.5 bg-background rounded-full p-0.5 border border-background">
                          <PlatformIcon platform={conv.platform} className="h-3.5 w-3.5" />
                        </div>
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-medium text-foreground text-sm truncate">
                            {conv.contact.name || conv.contact.phoneNumber || "Unknown"}
                          </span>
                          <span className="text-[10px] text-muted-foreground whitespace-nowrap shrink-0">
                            {formatTime(conv.lastMessageAt)}
                          </span>
                        </div>

                        <div className="flex items-center justify-between gap-2 mt-0.5">
                          <p className="text-xs text-muted-foreground truncate">
                            {conv.lastMessagePreview || "No messages yet"}
                          </p>
                          <div className="flex items-center gap-1 shrink-0">
                            {conv.isPinned && (
                              <Pin className="h-3 w-3 text-primary" />
                            )}
                            {conv.unreadCount && conv.unreadCount > 0 && (
                              <Badge variant="default" className="min-w-[18px] h-[18px] text-[10px] justify-center px-1">
                                {conv.unreadCount > 99 ? "99+" : conv.unreadCount}
                              </Badge>
                            )}
                          </div>
                        </div>
                      </div>

                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 opacity-0 group-hover:opacity-100 transition-opacity hidden md:flex shrink-0"
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
              })}
              
              {hasMore && (
                <div className="py-3 text-center">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setVisibleCount(prev => prev + LOAD_MORE_COUNT)}
                    className="text-muted-foreground"
                  >
                    <ChevronDown className="h-4 w-4 mr-1" />
                    Load more ({filteredConversations.length - visibleCount} remaining)
                  </Button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
