import { useRef, useCallback } from "react";
import { Search, Star, Loader2 } from "lucide-react";
import { SiWhatsapp, SiFacebook, SiInstagram } from "react-icons/si";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { getAvatarColor, getInitials } from "@/lib/avatar-colors";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import type { Contact, Platform } from "@shared/schema";

interface ContactListProps {
  contacts: Contact[];
  isLoading: boolean;
  selectedContactId: string | null;
  onSelectContact: (contactId: string) => void;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  onToggleFavorite: (contactId: string) => void;
  onLoadMore: () => void;
  hasMore: boolean;
  isLoadingMore: boolean;
}

function getPlatformIcon(platform: Platform) {
  switch (platform) {
    case "whatsapp":
      return <SiWhatsapp className="h-3 w-3 text-[#25D366]" />;
    case "instagram":
      return <SiInstagram className="h-3 w-3 text-[#E4405F]" />;
    case "facebook":
      return <SiFacebook className="h-3 w-3 text-[#1877F2]" />;
    default:
      return null;
  }
}

export function ContactList({
  contacts,
  isLoading,
  selectedContactId,
  onSelectContact,
  searchQuery,
  onSearchChange,
  onToggleFavorite,
  onLoadMore,
  hasMore,
  isLoadingMore,
}: ContactListProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const target = e.target as HTMLDivElement;
    const { scrollTop, scrollHeight, clientHeight } = target;
    
    if (scrollHeight - scrollTop - clientHeight < 200 && hasMore && !isLoadingMore) {
      onLoadMore();
    }
  }, [hasMore, isLoadingMore, onLoadMore]);

  if (isLoading) {
    return (
      <div className="flex flex-col h-full">
        <div className="p-4 border-b">
          <Skeleton className="h-10 w-full" />
        </div>
        <div className="flex-1 p-4 space-y-4">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="flex items-center gap-3">
              <Skeleton className="h-10 w-10 rounded-full" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-3 w-1/2" />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="p-4 border-b">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search contacts..."
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            className="pl-10"
            data-testid="input-search-contacts"
          />
        </div>
      </div>

      <ScrollArea className="flex-1" onScrollCapture={handleScroll}>
        <div ref={scrollRef}>
          {contacts.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-64 text-muted-foreground p-4">
              <p className="text-center">No contacts found</p>
              {searchQuery && (
                <p className="text-sm text-center mt-2">
                  Try a different search term
                </p>
              )}
            </div>
          ) : (
            <div className="divide-y">
              {contacts.map((contact) => (
                <div
                  key={contact.id}
                  className={`flex items-center gap-3 p-4 cursor-pointer hover-elevate ${
                    selectedContactId === contact.id
                      ? "bg-accent"
                      : ""
                  }`}
                  onClick={() => onSelectContact(contact.id)}
                  data-testid={`contact-item-${contact.id}`}
                >
                  <Avatar className="h-10 w-10">
                    <AvatarFallback
                      style={{ 
                        backgroundColor: getAvatarColor(contact.name).bg,
                        color: getAvatarColor(contact.name).text 
                      }}
                    >
                      {getInitials(contact.name)}
                    </AvatarFallback>
                  </Avatar>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium truncate">
                        {contact.name || contact.phoneNumber || contact.platformId}
                      </span>
                      {getPlatformIcon(contact.platform)}
                    </div>
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      {contact.phoneNumber && (
                        <span className="truncate">{contact.phoneNumber}</span>
                      )}
                    </div>
                    {contact.tags && contact.tags.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1">
                        {contact.tags.slice(0, 2).map((tag) => (
                          <Badge key={tag} variant="outline" className="text-xs px-1 py-0">
                            {tag}
                          </Badge>
                        ))}
                        {contact.tags.length > 2 && (
                          <Badge variant="outline" className="text-xs px-1 py-0">
                            +{contact.tags.length - 2}
                          </Badge>
                        )}
                      </div>
                    )}
                  </div>

                  <Button
                    variant="ghost"
                    size="icon"
                    className="flex-shrink-0"
                    onClick={(e) => {
                      e.stopPropagation();
                      onToggleFavorite(contact.id);
                    }}
                    data-testid={`button-favorite-${contact.id}`}
                  >
                    <Star
                      className={`h-4 w-4 ${
                        contact.isFavorite ? "fill-yellow-400 text-yellow-400" : ""
                      }`}
                    />
                  </Button>
                </div>
              ))}
              
              {isLoadingMore && (
                <div className="flex items-center justify-center py-4">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                  <span className="ml-2 text-sm text-muted-foreground">Loading more...</span>
                </div>
              )}
              
              {!hasMore && contacts.length > 0 && (
                <div className="py-4 text-center text-sm text-muted-foreground">
                  {contacts.length} contacts loaded
                </div>
              )}
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
