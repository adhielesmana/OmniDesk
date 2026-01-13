import { useState, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { SidebarProvider, SidebarTrigger, SidebarInset, useSidebar } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { ConversationList } from "@/components/inbox/conversation-list";
import { MessageThread } from "@/components/inbox/message-thread";
import { SettingsModal } from "@/components/inbox/settings-modal";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { ArrowLeft, MessageCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useWebSocket } from "@/hooks/use-websocket";
import type {
  Platform,
  ConversationWithContact,
  ConversationWithMessages,
  PlatformSettings,
} from "@shared/schema";

function InboxContent({
  selectedPlatform,
  setSelectedPlatform,
  showSettings,
  setShowSettings,
}: {
  selectedPlatform: Platform | "all";
  setSelectedPlatform: (platform: Platform | "all") => void;
  showSettings: boolean;
  setShowSettings: (show: boolean) => void;
}) {
  const { toast } = useToast();
  const { setOpenMobile } = useSidebar();
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null);
  const [showConversationList, setShowConversationList] = useState(true);

  const handleWebSocketMessage = useCallback((data: { type: string; conversationId?: string }) => {
    if (data.type === "new_message" || data.type === "conversation_updated" || data.type === "chats_synced") {
      queryClient.invalidateQueries({ queryKey: ["/api/conversations"] });
      if (data.conversationId && data.conversationId === selectedConversationId) {
        queryClient.invalidateQueries({
          queryKey: ["/api/conversations", selectedConversationId],
        });
      }
    }
  }, [selectedConversationId]);

  useWebSocket({
    onMessage: handleWebSocketMessage,
    onOpen: () => console.log("WebSocket connected"),
    onClose: () => console.log("WebSocket disconnected"),
  });

  const { data: conversations = [], isLoading: isLoadingConversations } = useQuery<
    ConversationWithContact[]
  >({
    queryKey: ["/api/conversations"],
  });

  const { data: selectedConversation, isLoading: isLoadingConversation } =
    useQuery<ConversationWithMessages>({
      queryKey: ["/api/conversations", selectedConversationId],
      enabled: !!selectedConversationId,
    });

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
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["/api/conversations", selectedConversationId],
      });
      queryClient.invalidateQueries({ queryKey: ["/api/conversations"] });
    },
    onError: () => {
      toast({
        title: "Failed to send message",
        description: "Please try again.",
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
      queryClient.invalidateQueries({ queryKey: ["/api/conversations"] });
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
      queryClient.invalidateQueries({ queryKey: ["/api/conversations"] });
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

  const handleSendMessage = (content: string, mediaUrl?: string) => {
    if (!selectedConversationId) return;
    sendMessageMutation.mutate({
      conversationId: selectedConversationId,
      content,
      mediaUrl,
    });
  };

  const handleTestConnection = async (platform: Platform): Promise<boolean> => {
    try {
      const response = await fetch(`/api/platform-settings/${platform}/test`);
      const data = await response.json();
      return data.success;
    } catch {
      return false;
    }
  };

  const handleSelectConversation = (id: string) => {
    setSelectedConversationId(id);
    setShowConversationList(false);
  };

  const handleBackToList = () => {
    setShowConversationList(true);
    // Keep selectedConversationId to maintain highlight in list (WhatsApp-like behavior)
  };

  const calculateUnreadCounts = (): Record<Platform | "all", number> => {
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
  };

  const sortedConversations = [...conversations].sort((a, b) => {
    if (a.isPinned && !b.isPinned) return -1;
    if (!a.isPinned && b.isPinned) return 1;
    const aDate = a.lastMessageAt ? new Date(a.lastMessageAt).getTime() : 0;
    const bDate = b.lastMessageAt ? new Date(b.lastMessageAt).getTime() : 0;
    return bDate - aDate;
  });

  return (
    <>
      <AppSidebar
        selectedPlatform={selectedPlatform}
        onSelectPlatform={setSelectedPlatform}
        unreadCounts={calculateUnreadCounts()}
        onSettingsClick={() => setShowSettings(true)}
      />

      <SidebarInset className="flex flex-col flex-1 min-w-0">
        {/* Mobile: Show conversation list OR thread, not both */}
        {/* Desktop: Show both side by side */}
        <div className="flex flex-1 min-h-0 h-full">
          {/* Conversation List Panel */}
          <div
            className={`
              flex-col h-full
              md:w-80 lg:w-96 md:flex-shrink-0 md:border-r md:border-border
              ${showConversationList ? "flex w-full md:w-80 lg:w-96" : "hidden md:flex"}
            `}
          >
            {/* Mobile Header for Conversation List */}
            <header className="sticky top-0 z-50 flex items-center justify-between h-14 px-3 border-b border-border bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/60 md:hidden shrink-0">
              <div className="flex items-center gap-2">
                <SidebarTrigger data-testid="button-sidebar-toggle-mobile" />
                <div className="flex items-center gap-2">
                  <MessageCircle className="h-5 w-5 text-primary" />
                  <span className="font-semibold">Chats</span>
                </div>
              </div>
              <ThemeToggle />
            </header>

            {/* Desktop Header */}
            <header className="hidden md:flex items-center justify-between h-14 px-4 border-b border-border bg-card">
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
            />
          </div>

          {/* Message Thread Panel */}
          <div
            className={`
              flex-1 min-w-0 flex-col h-full
              ${!showConversationList ? "flex w-full md:w-auto" : "hidden md:flex"}
            `}
          >
            <MessageThread
              conversation={selectedConversation || null}
              onSendMessage={handleSendMessage}
              isSending={sendMessageMutation.isPending}
              isLoading={isLoadingConversation}
              onBack={handleBackToList}
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
      />
    </>
  );
}

export default function InboxPage() {
  const [selectedPlatform, setSelectedPlatform] = useState<Platform | "all">("all");
  const [showSettings, setShowSettings] = useState(false);

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
        />
      </div>
    </SidebarProvider>
  );
}
