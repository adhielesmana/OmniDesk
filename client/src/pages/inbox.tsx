import { useState, useCallback, useMemo, useRef, useEffect } from "react";
import { useQuery, useMutation, useInfiniteQuery } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { getCachedConversation, setCachedConversation } from "@/lib/conversationCache";
import { SidebarProvider, SidebarTrigger, SidebarInset, useSidebar } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { ConversationList } from "@/components/inbox/conversation-list";
import { MessageThread } from "@/components/inbox/message-thread";
import { SettingsModal } from "@/components/inbox/settings-modal";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { ArrowLeft, MessageCircle, X } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useWebSocket } from "@/hooks/use-websocket";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { PlatformIcon } from "@/components/platform-icons";
import type {
  Platform,
  ConversationWithContact,
  ConversationWithMessages,
  PlatformSettings,
} from "@shared/schema";

type SettingsTab = "whatsapp" | "instagram" | "facebook" | "openai" | "autoreply";

function InboxContent({
  selectedPlatform,
  setSelectedPlatform,
  showSettings,
  setShowSettings,
  settingsInitialTab,
  onOpenSettings,
}: {
  selectedPlatform: Platform | "all";
  setSelectedPlatform: (platform: Platform | "all") => void;
  showSettings: boolean;
  setShowSettings: (show: boolean) => void;
  settingsInitialTab: SettingsTab;
  onOpenSettings: (tab?: SettingsTab) => void;
}) {
  const { toast } = useToast();
  const { setOpenMobile } = useSidebar();
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null);

  const debounceRef = useRef<NodeJS.Timeout | null>(null);
  const pendingInvalidationsRef = useRef<Set<string>>(new Set());

  const handleWebSocketMessage = useCallback((data: { type: string; conversationId?: string }) => {
    if (data.type === "new_message" || data.type === "conversation_updated" || data.type === "chats_synced") {
      pendingInvalidationsRef.current.add("conversations");
      if (data.conversationId && data.conversationId === selectedConversationId) {
        pendingInvalidationsRef.current.add("selected");
      }
      
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        // Longer debounce to prevent typing lag from constant refetches
        if (pendingInvalidationsRef.current.has("conversations")) {
          // Reset infinite query to force fresh data with correct sort order
          queryClient.resetQueries({ queryKey: ["/api/conversations"], exact: false });
        }
        if (pendingInvalidationsRef.current.has("selected") && selectedConversationId) {
          queryClient.invalidateQueries({
            queryKey: ["/api/conversations", selectedConversationId],
          });
        }
        pendingInvalidationsRef.current.clear();
      }, 1000); // Increased from 500ms to reduce typing lag
    }
  }, [selectedConversationId]);

  useWebSocket({
    onMessage: handleWebSocketMessage,
    onOpen: () => console.log("WebSocket connected"),
    onClose: () => console.log("WebSocket disconnected"),
  });

  // Paginated conversations with infinite scroll
  const CONVERSATIONS_LIMIT = 30;
  
  const {
    data: conversationsData,
    isLoading: isLoadingConversations,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery({
    queryKey: ["/api/conversations", { platform: selectedPlatform }],
    queryFn: async ({ pageParam = 0 }) => {
      const params = new URLSearchParams({
        limit: String(CONVERSATIONS_LIMIT),
        offset: String(pageParam),
      });
      const res = await fetch(`/api/conversations?${params}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to fetch conversations");
      return res.json() as Promise<{ conversations: ConversationWithContact[]; total: number; hasMore: boolean }>;
    },
    getNextPageParam: (lastPage, allPages) => {
      if (!lastPage.hasMore) return undefined;
      const totalLoaded = allPages.reduce((sum, page) => sum + page.conversations.length, 0);
      return totalLoaded;
    },
    initialPageParam: 0,
  });

  // Flatten paginated data into single array
  const conversations = useMemo(() => {
    if (!conversationsData?.pages) return [];
    return conversationsData.pages.flatMap(page => page.conversations);
  }, [conversationsData]);

  const totalConversations = conversationsData?.pages[0]?.total ?? 0;

  // Handle load more from conversation list
  const handleLoadMore = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) {
      fetchNextPage();
    }
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  // Get cached conversation for instant loading
  const cachedConversation = selectedConversationId 
    ? getCachedConversation(selectedConversationId) 
    : null;

  const { data: selectedConversation, isLoading: isLoadingConversation } =
    useQuery<ConversationWithMessages>({
      queryKey: ["/api/conversations", selectedConversationId],
      enabled: !!selectedConversationId,
      initialData: cachedConversation || undefined,
      staleTime: 10000, // Cache for 10 seconds to prevent constant refetching during typing
      gcTime: 30000, // Keep in cache for 30 seconds
      refetchOnWindowFocus: false, // Don't refetch on window focus to prevent typing interruption
    });

  // Cache the conversation when it's fetched
  useEffect(() => {
    if (selectedConversation && selectedConversation.id) {
      setCachedConversation(selectedConversation);
    }
  }, [selectedConversation]);

  // Stable conversation reference - only update when actual content changes
  const prevConversationRef = useRef<ConversationWithMessages | null>(null);
  const stableConversation = useMemo(() => {
    if (!selectedConversation) {
      prevConversationRef.current = null;
      return null;
    }
    
    const prev = prevConversationRef.current;
    // Only update reference if conversation changed meaningfully
    const shouldUpdate = !prev ||
      prev.id !== selectedConversation.id ||
      prev.messages?.length !== selectedConversation.messages?.length ||
      prev.messages?.[prev.messages?.length - 1]?.id !== selectedConversation.messages?.[selectedConversation.messages?.length - 1]?.id;
    
    if (shouldUpdate) {
      prevConversationRef.current = selectedConversation;
      return selectedConversation;
    }
    
    return prev;
  }, [selectedConversation]);

  const { data: platformSettings = [] } = useQuery<PlatformSettings[]>({
    queryKey: ["/api/platform-settings"],
  });

  const sendMessageMutation = useMutation({
    mutationFn: async ({
      conversationId,
      content,
      mediaUrl,
    }: {
      conversationId: string;
      content: string;
      mediaUrl?: string;
    }) => {
      return apiRequest("POST", `/api/conversations/${conversationId}/messages`, {
        content,
        mediaUrl,
      });
    },
    onSuccess: (_data, variables) => {
      // Use the conversationId from the mutation variables, not from state
      queryClient.invalidateQueries({
        queryKey: ["/api/conversations", variables.conversationId],
      });
      // Reset to ensure fresh sort order
      queryClient.resetQueries({ queryKey: ["/api/conversations"], exact: false });
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to send message",
        description: error.message || "Please try again.",
        variant: "destructive",
      });
    },
  });

  const archiveMutation = useMutation({
    mutationFn: async (conversationId: string) => {
      return apiRequest("PATCH", `/api/conversations/${conversationId}`, {
        isArchived: true,
      });
    },
    onSuccess: () => {
      queryClient.resetQueries({ queryKey: ["/api/conversations"], exact: false });
      toast({
        title: "Conversation archived",
      });
    },
  });

  const pinMutation = useMutation({
    mutationFn: async (conversationId: string) => {
      const conversation = conversations.find((c) => c.id === conversationId);
      return apiRequest("PATCH", `/api/conversations/${conversationId}`, {
        isPinned: !conversation?.isPinned,
      });
    },
    onSuccess: () => {
      queryClient.resetQueries({ queryKey: ["/api/conversations"], exact: false });
    },
  });

  const saveSettingsMutation = useMutation({
    mutationFn: async ({
      platform,
      settings,
    }: {
      platform: Platform;
      settings: Partial<PlatformSettings>;
    }) => {
      return apiRequest("POST", `/api/platform-settings/${platform}`, settings);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/platform-settings"] });
    },
  });

  // Use ref to access mutation without triggering re-renders
  const sendMessageMutationRef = useRef(sendMessageMutation);
  sendMessageMutationRef.current = sendMessageMutation;

  const handleSendMessage = useCallback((conversationId: string, content: string, mediaUrl?: string) => {
    if (!conversationId) return;
    
    // Debug: Log which conversation we're sending to
    console.log("[SendMessage] Sending to conversationId:", conversationId, "content:", content.substring(0, 50));
    
    sendMessageMutationRef.current.mutate({
      conversationId,
      content,
      mediaUrl,
    });
  }, []);

  // Memoize isSending to prevent re-renders when other mutation state changes
  const isSending = sendMessageMutation.isPending;

  const handleTestConnection = async (platform: Platform): Promise<boolean> => {
    try {
      const response = await fetch(`/api/platform-settings/${platform}/test`);
      const data = await response.json();
      return data.success;
    } catch {
      return false;
    }
  };

  const [mobileSheetOpen, setMobileSheetOpen] = useState(false);

  const handleSelectConversation = (id: string) => {
    console.log("[SelectConversation] Selecting conversation:", id);
    setSelectedConversationId(id);
    // Only open sheet overlay on mobile (check window width directly for reliability)
    if (typeof window !== 'undefined' && window.innerWidth < 768) {
      setMobileSheetOpen(true);
    }
  };

  // Prefetch conversation on hover for faster loading
  const handlePrefetchConversation = useCallback((id: string) => {
    queryClient.prefetchQuery({
      queryKey: ["/api/conversations", id],
      staleTime: 10000,
    });
  }, []);

  const handleCloseSheet = () => {
    setMobileSheetOpen(false);
  };

  // Close sheet when resizing to desktop mode
  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth >= 768) {
        setMobileSheetOpen(false);
      }
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const getInitials = useCallback((name: string | null | undefined) => {
    if (!name) return "?";
    return name.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2);
  }, []);

  const unreadCounts = useMemo(() => {
    const counts: Record<Platform | "all", number> = {
      all: 0,
      whatsapp: 0,
      instagram: 0,
      facebook: 0,
    };
    conversations.forEach((conv) => {
      if (conv.unreadCount && conv.unreadCount > 0) {
        counts[conv.platform] += conv.unreadCount;
        counts.all += conv.unreadCount;
      }
    });
    return counts;
  }, [conversations]);

  const sortedConversations = useMemo(() => {
    return [...conversations].sort((a, b) => {
      if (a.isPinned && !b.isPinned) return -1;
      if (!a.isPinned && b.isPinned) return 1;
      const aDate = a.lastMessageAt ? new Date(a.lastMessageAt).getTime() : 0;
      const bDate = b.lastMessageAt ? new Date(b.lastMessageAt).getTime() : 0;
      return bDate - aDate;
    });
  }, [conversations]);

  return (
    <>
      <AppSidebar
        selectedPlatform={selectedPlatform}
        onSelectPlatform={setSelectedPlatform}
        unreadCounts={unreadCounts}
        onSettingsClick={() => onOpenSettings("whatsapp")}
      />

      <SidebarInset className="flex flex-col flex-1 min-w-0">
        {/* Mobile: Conditional render - show one panel at a time */}
        {/* Desktop: Show both side by side */}
        <div className="flex flex-1 min-h-0 h-full">
          {/* Mobile View - List always visible, conversation opens as Sheet overlay */}
          <div className="md:hidden flex flex-col h-full w-full overflow-hidden">
            {/* Fixed Mobile Header */}
            <header className="flex items-center justify-between h-14 px-3 border-b border-border bg-card shrink-0">
              <div className="flex items-center gap-2 min-w-0">
                <SidebarTrigger data-testid="button-sidebar-toggle-mobile" />
                <div className="flex items-center gap-2 min-w-0">
                  <MessageCircle className="h-5 w-5 text-primary shrink-0" />
                  <span className="font-semibold">Chats</span>
                </div>
              </div>
              <ThemeToggle />
            </header>

            {/* Conversation List - Always visible */}
            <div className="flex-1 min-h-0 overflow-hidden">
              <ConversationList
                conversations={sortedConversations}
                selectedConversationId={selectedConversationId}
                onSelectConversation={handleSelectConversation}
                onArchive={(id) => archiveMutation.mutate(id)}
                onPin={(id) => pinMutation.mutate(id)}
                isLoading={isLoadingConversations}
                selectedPlatform={selectedPlatform}
                onLoadMore={handleLoadMore}
                hasMore={hasNextPage}
                isLoadingMore={isFetchingNextPage}
                totalCount={totalConversations}
                onPrefetch={handlePrefetchConversation}
              />
            </div>

            {/* Conversation Sheet - Slides in from right */}
            <Sheet open={mobileSheetOpen} onOpenChange={setMobileSheetOpen}>
              <SheetContent 
                side="right" 
                className="w-full sm:w-full p-0 flex flex-col"
                data-testid="mobile-conversation-sheet"
                hideCloseButton
              >
                {/* Sheet Header */}
                <div className="flex items-center justify-between px-3 h-14 border-b border-border bg-card shrink-0">
                  <div className="flex items-center gap-3 min-w-0">
                    <Button 
                      variant="ghost" 
                      size="icon" 
                      onClick={handleCloseSheet}
                      data-testid="button-close-sheet"
                    >
                      <ArrowLeft className="h-5 w-5" />
                    </Button>
                    {selectedConversation && (
                      <>
                        <div className="relative shrink-0">
                          <Avatar className="h-9 w-9">
                            <AvatarFallback className="bg-muted text-muted-foreground text-sm">
                              {getInitials(selectedConversation.contact.name)}
                            </AvatarFallback>
                          </Avatar>
                          <div className="absolute -bottom-0.5 -right-0.5 bg-background rounded-full p-0.5">
                            <PlatformIcon platform={selectedConversation.platform} className="h-3 w-3" />
                          </div>
                        </div>
                        <div className="min-w-0">
                          <h2 className="font-semibold text-foreground text-sm truncate">
                            {selectedConversation.contact.name || selectedConversation.contact.phoneNumber || "Unknown"}
                          </h2>
                          <p className="text-xs text-muted-foreground truncate">
                            {selectedConversation.platform === "whatsapp" ? "WhatsApp" : 
                             selectedConversation.platform === "instagram" ? "Instagram" : "Facebook"}
                          </p>
                        </div>
                      </>
                    )}
                  </div>
                </div>

                {/* Message Thread */}
                <div className="flex-1 min-h-0 overflow-hidden">
                  <MessageThread
                    conversation={stableConversation}
                    onSendMessage={handleSendMessage}
                    isSending={isSending}
                    isLoading={isLoadingConversation}
                    hideHeader
                  />
                </div>
              </SheetContent>
            </Sheet>
          </div>

          {/* Desktop View - Both panels visible */}
          <div className="hidden md:flex flex-col h-full w-80 lg:w-96 flex-shrink-0 border-r border-border">
            <header className="flex items-center justify-between h-14 px-4 border-b border-border bg-card shrink-0">
              <div className="flex items-center gap-2">
                <SidebarTrigger data-testid="button-sidebar-toggle" />
                <span className="font-semibold">Conversations</span>
              </div>
              <ThemeToggle />
            </header>
            <ConversationList
              conversations={sortedConversations}
              selectedConversationId={selectedConversationId}
              onSelectConversation={handleSelectConversation}
              onArchive={(id) => archiveMutation.mutate(id)}
              onPin={(id) => pinMutation.mutate(id)}
              isLoading={isLoadingConversations}
              selectedPlatform={selectedPlatform}
              onLoadMore={handleLoadMore}
              hasMore={hasNextPage}
              isLoadingMore={isFetchingNextPage}
              totalCount={totalConversations}
              onPrefetch={handlePrefetchConversation}
            />
          </div>

          <div className="hidden md:flex flex-1 min-w-0 flex-col h-full">
            <MessageThread
              conversation={stableConversation}
              onSendMessage={handleSendMessage}
              isSending={isSending}
              isLoading={isLoadingConversation}
            />
          </div>
        </div>
      </SidebarInset>

      <SettingsModal
        isOpen={showSettings}
        onClose={() => setShowSettings(false)}
        platformSettings={platformSettings}
        onSaveSettings={(platform, settings) =>
          saveSettingsMutation.mutate({ platform, settings })
        }
        onTestConnection={handleTestConnection}
        initialTab={settingsInitialTab}
      />
    </>
  );
}

export default function InboxPage() {
  const [selectedPlatform, setSelectedPlatform] = useState<Platform | "all">("all");
  const [showSettings, setShowSettings] = useState(false);
  const [settingsInitialTab, setSettingsInitialTab] = useState<"whatsapp" | "instagram" | "facebook" | "openai" | "autoreply">("whatsapp");

  const handleOpenSettings = (tab: "whatsapp" | "instagram" | "facebook" | "openai" | "autoreply" = "whatsapp") => {
    setSettingsInitialTab(tab);
    setShowSettings(true);
  };

  const sidebarStyle = {
    "--sidebar-width": "16rem",
    "--sidebar-width-icon": "3rem",
  } as React.CSSProperties;

  return (
    <SidebarProvider style={sidebarStyle} defaultOpen={false}>
      <div className="flex h-screen w-full overflow-hidden">
        <InboxContent
          selectedPlatform={selectedPlatform}
          setSelectedPlatform={setSelectedPlatform}
          showSettings={showSettings}
          setShowSettings={setShowSettings}
          settingsInitialTab={settingsInitialTab}
          onOpenSettings={handleOpenSettings}
        />
      </div>
    </SidebarProvider>
  );
}
