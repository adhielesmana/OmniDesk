import { useRef, useEffect, useState, useCallback, useMemo, memo } from "react";
import { useLocation } from "wouter";
import { Phone, Video, MoreVertical, Check, CheckCheck, Clock, AlertCircle, User, ArrowLeft, Loader2 } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { PlatformIcon, getPlatformName } from "@/components/platform-icons";
import { MessageComposer } from "./message-composer";
import { MessageContent } from "./message-content";
import type { ConversationWithMessages, Message, MessageStatus } from "@shared/schema";
import { format, isToday, isYesterday, isSameDay } from "date-fns";

interface MessageThreadProps {
  conversation: ConversationWithMessages | null;
  onSendMessage: (content: string, mediaUrl?: string) => void;
  isSending: boolean;
  isLoading: boolean;
  onBack?: () => void;
  hideHeader?: boolean;
}

function MessageStatusIcon({ status }: { status: MessageStatus | null }) {
  switch (status) {
    case "sent":
      return <Check className="h-3 w-3 text-muted-foreground" />;
    case "delivered":
      return <CheckCheck className="h-3 w-3 text-muted-foreground" />;
    case "read":
      return <CheckCheck className="h-3 w-3 text-primary" />;
    case "failed":
      return <AlertCircle className="h-3 w-3 text-destructive" />;
    default:
      return <Clock className="h-3 w-3 text-muted-foreground" />;
  }
}

function formatMessageTime(date: Date | null | undefined): string {
  if (!date) return "";
  try {
    return format(new Date(date), "h:mm a");
  } catch {
    return "";
  }
}

function formatDateSeparator(date: Date): string {
  if (isToday(date)) return "Today";
  if (isYesterday(date)) return "Yesterday";
  return format(date, "MMMM d, yyyy");
}

function shouldShowDateSeparator(
  currentMessage: Message,
  previousMessage: Message | null
): boolean {
  if (!previousMessage) return true;
  if (!currentMessage.timestamp || !previousMessage.timestamp) return false;
  return !isSameDay(
    new Date(currentMessage.timestamp),
    new Date(previousMessage.timestamp)
  );
}

export const MessageThread = memo(function MessageThread({
  conversation,
  onSendMessage,
  isSending,
  isLoading,
  onBack,
  hideHeader = false,
}: MessageThreadProps) {
  const [, setLocation] = useLocation();
  const scrollRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [olderMessages, setOlderMessages] = useState<Message[]>([]);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [hasMoreToLoad, setHasMoreToLoad] = useState(false);
  const prevConversationId = useRef<string | null>(null);

  // Reset older messages when conversation changes
  useEffect(() => {
    if (conversation?.id && conversation.id !== prevConversationId.current) {
      setOlderMessages([]);
      setHasMoreToLoad(conversation.hasMoreMessages || false);
      prevConversationId.current = conversation.id;
    }
  }, [conversation?.id, conversation?.hasMoreMessages]);

  const handleViewContactInfo = () => {
    if (conversation?.contact?.id) {
      setLocation(`/contacts?selected=${conversation.contact.id}`);
    }
  };

  // Combine older messages with current messages and dedupe by id
  const allMessages = useMemo(() => {
    const combined = [...olderMessages, ...(conversation?.messages || [])];
    const seen = new Set<string>();
    return combined.filter(msg => {
      if (seen.has(msg.id)) return false;
      seen.add(msg.id);
      return true;
    });
  }, [olderMessages, conversation?.messages]);

  const loadOlderMessages = useCallback(async () => {
    if (!conversation?.id || isLoadingMore || allMessages.length === 0) return;

    const oldestMessage = allMessages[0];
    if (!oldestMessage?.timestamp || !oldestMessage?.id) return;

    setIsLoadingMore(true);
    try {
      const response = await fetch(
        `/api/conversations/${conversation.id}/older-messages?before=${new Date(oldestMessage.timestamp).toISOString()}&beforeId=${oldestMessage.id}&limit=50`
      );
      const data = await response.json() as { messages: Message[]; hasMore: boolean };
      
      if (data.messages && data.messages.length > 0) {
        // Dedupe when adding to prevent duplicates
        setOlderMessages(prev => {
          const existingIds = new Set(prev.map(m => m.id));
          const newMessages = data.messages.filter(m => !existingIds.has(m.id));
          return [...newMessages, ...prev];
        });
      }
      setHasMoreToLoad(data.hasMore);
    } catch (error) {
      console.error("Failed to load older messages:", error);
    } finally {
      setIsLoadingMore(false);
    }
  }, [conversation?.id, isLoadingMore, allMessages]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [conversation?.messages]);

  if (isLoading) {
    return (
      <div className="flex flex-col h-full bg-background">
        <div className="h-14 border-b border-border px-3 flex items-center gap-3">
          {onBack && (
            <Button variant="ghost" size="icon" className="md:hidden" onClick={onBack}>
              <ArrowLeft className="h-5 w-5" />
            </Button>
          )}
          <div className="h-10 w-10 rounded-full bg-muted animate-pulse" />
          <div className="space-y-2">
            <div className="h-4 w-24 bg-muted rounded animate-pulse" />
            <div className="h-3 w-16 bg-muted rounded animate-pulse" />
          </div>
        </div>
        <div className="flex-1 p-4 space-y-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className={`flex ${i % 2 === 0 ? "justify-end" : "justify-start"}`}>
              <div className={`h-12 ${i % 2 === 0 ? "w-48" : "w-64"} bg-muted rounded-2xl animate-pulse`} />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (!conversation) {
    return (
      <div className="flex flex-col h-full bg-background items-center justify-center">
        <div className="text-center px-8">
          <div className="h-24 w-24 rounded-full bg-muted flex items-center justify-center mx-auto mb-6">
            <svg
              className="h-12 w-12 text-muted-foreground"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
              />
            </svg>
          </div>
          <h2 className="text-xl font-semibold text-foreground mb-2">Select a conversation</h2>
          <p className="text-muted-foreground max-w-sm">
            Choose a conversation from the list to start messaging
          </p>
        </div>
      </div>
    );
  }

  const { contact, platform } = conversation;

  const getInitials = (name: string | null | undefined) => {
    if (!name) return "?";
    return name
      .split(" ")
      .map((n) => n[0])
      .join("")
      .toUpperCase()
      .slice(0, 2);
  };

  return (
    <div className="flex flex-col h-full bg-background overflow-hidden">
      {/* Header - Only show if not hidden (desktop always shows, mobile uses parent header) */}
      {!hideHeader && (
        <div className="flex items-center justify-between px-2 md:px-4 h-14 border-b border-border bg-card shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            {onBack && (
              <Button 
                variant="ghost" 
                size="icon" 
                className="md:hidden shrink-0" 
                onClick={onBack}
                data-testid="button-back-to-list"
              >
                <ArrowLeft className="h-5 w-5" />
              </Button>
            )}
            <div className="relative shrink-0">
              <Avatar className="h-9 w-9">
                <AvatarFallback className="bg-muted text-muted-foreground text-sm">
                  {getInitials(contact.name)}
                </AvatarFallback>
              </Avatar>
              <div className="absolute -bottom-0.5 -right-0.5 bg-background rounded-full p-0.5">
                <PlatformIcon platform={platform} className="h-3 w-3" />
              </div>
            </div>
            <div className="min-w-0">
              <h2 className="font-semibold text-foreground text-sm truncate">
                {contact.name || contact.phoneNumber || "Unknown"}
              </h2>
              <p className="text-xs text-muted-foreground truncate">
                {getPlatformName(platform)}
              </p>
            </div>
          </div>

          <div className="flex items-center shrink-0">
            <Button variant="ghost" size="icon" className="hidden sm:inline-flex" data-testid="button-call">
              <Phone className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon" className="hidden sm:inline-flex" data-testid="button-video">
              <Video className="h-4 w-4" />
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" data-testid="button-thread-menu">
                  <MoreVertical className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={handleViewContactInfo} data-testid="menu-view-contact">
                  <User className="h-4 w-4 mr-2" />
                  View Contact
                </DropdownMenuItem>
                <DropdownMenuItem>
                  <Phone className="h-4 w-4 mr-2 sm:hidden" />
                  Call
                </DropdownMenuItem>
                <DropdownMenuItem>Mark as Unread</DropdownMenuItem>
                <DropdownMenuItem>Block Contact</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      )}

      {/* Messages - scrollable area */}
      <div className="flex-1 overflow-y-auto px-3 md:px-4 min-h-0" ref={scrollRef}>
        <div className="py-4 space-y-3">
          {/* Load more button */}
          {hasMoreToLoad && (
            <div className="flex justify-center pb-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={loadOlderMessages}
                disabled={isLoadingMore}
                data-testid="button-load-more-messages"
              >
                {isLoadingMore ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Loading...
                  </>
                ) : (
                  "Load older messages"
                )}
              </Button>
            </div>
          )}

          {allMessages.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-muted-foreground text-sm">
                No messages yet. Send a message to start the conversation.
              </p>
            </div>
          ) : (
            allMessages.map((message, index) => {
              const previousMessage = index > 0 ? allMessages[index - 1] : null;
              const showDateSeparator = shouldShowDateSeparator(message, previousMessage);
              const isOutbound = message.direction === "outbound";

              return (
                <div key={message.id}>
                  {showDateSeparator && message.timestamp && (
                    <div className="flex items-center justify-center my-4">
                      <div className="bg-muted text-muted-foreground text-xs px-3 py-1 rounded-full">
                        {formatDateSeparator(new Date(message.timestamp))}
                      </div>
                    </div>
                  )}

                  <div
                    className={`flex ${isOutbound ? "justify-end" : "justify-start"}`}
                    data-testid={`message-${message.id}`}
                  >
                    <div
                      className={`max-w-[85%] md:max-w-[70%] rounded-2xl px-3 py-2 ${
                        isOutbound
                          ? "bg-primary text-primary-foreground rounded-br-md"
                          : "bg-card border border-card-border rounded-bl-md"
                      }`}
                    >
                      <MessageContent
                        content={message.content || ""}
                        mediaUrl={message.mediaUrl}
                        mediaType={message.mediaType}
                        metadata={message.metadata}
                        messageId={message.id}
                        isOutbound={isOutbound}
                      />

                      <div
                        className={`flex items-center justify-end gap-1 mt-1 ${
                          isOutbound ? "text-primary-foreground/70" : "text-muted-foreground"
                        }`}
                      >
                        <span className="text-[10px]">{formatMessageTime(message.timestamp)}</span>
                        {isOutbound && <MessageStatusIcon status={message.status} />}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })
          )}
          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Message Composer */}
      <MessageComposer
        onSendMessage={onSendMessage}
        isSending={isSending}
        platform={platform}
      />
    </div>
  );
});
