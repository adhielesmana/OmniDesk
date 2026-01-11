import { useRef, useEffect } from "react";
import { useLocation } from "wouter";
import { Phone, Video, MoreVertical, Check, CheckCheck, Clock, AlertCircle, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ScrollArea } from "@/components/ui/scroll-area";
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

export function MessageThread({
  conversation,
  onSendMessage,
  isSending,
  isLoading,
}: MessageThreadProps) {
  const [, setLocation] = useLocation();
  const scrollRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const handleViewContactInfo = () => {
    if (conversation?.contact?.id) {
      setLocation(`/contacts?selected=${conversation.contact.id}`);
    }
  };

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [conversation?.messages]);

  if (isLoading) {
    return (
      <div className="flex flex-col h-full bg-background">
        <div className="h-16 border-b border-border p-4">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-full bg-muted animate-pulse" />
            <div className="space-y-2">
              <div className="h-4 w-24 bg-muted rounded animate-pulse" />
              <div className="h-3 w-16 bg-muted rounded animate-pulse" />
            </div>
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
            Choose a conversation from the list to start messaging. Your conversations from WhatsApp, Instagram, and Facebook will appear here.
          </p>
        </div>
      </div>
    );
  }

  const { contact, messages, platform } = conversation;

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
    <div className="flex flex-col h-full bg-background">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-card">
        <div className="flex items-center gap-3">
          <div className="relative">
            <Avatar className="h-10 w-10">
              <AvatarImage src={contact.profilePictureUrl || undefined} />
              <AvatarFallback className="bg-muted text-muted-foreground">
                {getInitials(contact.name)}
              </AvatarFallback>
            </Avatar>
            <div className="absolute -bottom-1 -right-1 bg-background rounded-full p-0.5">
              <PlatformIcon platform={platform} className="h-3.5 w-3.5" />
            </div>
          </div>
          <div>
            <h2 className="font-semibold text-foreground">
              {contact.name || contact.phoneNumber || "Unknown"}
            </h2>
            <p className="text-xs text-muted-foreground flex items-center gap-1">
              <span>{getPlatformName(platform)}</span>
              {contact.phoneNumber && (
                <>
                  <span className="text-border">•</span>
                  <span>{contact.phoneNumber}</span>
                </>
              )}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" data-testid="button-call">
            <Phone className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" data-testid="button-video">
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
                View Contact Info
              </DropdownMenuItem>
              <DropdownMenuItem>Mark as Unread</DropdownMenuItem>
              <DropdownMenuItem>Block Contact</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <ScrollArea className="flex-1 px-4" ref={scrollRef}>
        <div className="py-4 space-y-4">
          {messages.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-muted-foreground">
                No messages yet. Send a message to start the conversation.
              </p>
            </div>
          ) : (
            messages.map((message, index) => {
              const previousMessage = index > 0 ? messages[index - 1] : null;
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
                      className={`max-w-[75%] rounded-2xl px-4 py-2 ${
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
                        <span className="text-xs">{formatMessageTime(message.timestamp)}</span>
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
      </ScrollArea>

      <MessageComposer
        onSendMessage={onSendMessage}
        isSending={isSending}
        platform={platform}
      />
    </div>
  );
}
