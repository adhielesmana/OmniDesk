import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { SidebarProvider, SidebarTrigger, SidebarInset } from "@/components/ui/sidebar";
import { ContactsSidebar } from "@/components/contacts/contacts-sidebar";
import { ContactList } from "@/components/contacts/contact-list";
import { ContactDetail } from "@/components/contacts/contact-detail";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import type { Platform, Contact } from "@shared/schema";

export default function ContactsPage() {
  const { toast } = useToast();
  const [selectedPlatform, setSelectedPlatform] = useState<Platform | "all">("all");
  const [selectedContactId, setSelectedContactId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [showFavorites, setShowFavorites] = useState(false);
  const [showBlocked, setShowBlocked] = useState(false);
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [isMobileListOpen, setIsMobileListOpen] = useState(true);

  const { data: contactsData, isLoading: isLoadingContacts } = useQuery<{
    contacts: Contact[];
    total: number;
  }>({
    queryKey: [
      "/api/contacts",
      {
        search: searchQuery || undefined,
        platform: selectedPlatform !== "all" ? selectedPlatform : undefined,
        isFavorite: showFavorites ? true : undefined,
        isBlocked: showBlocked ? true : undefined,
        tag: selectedTag || undefined,
      },
    ],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (searchQuery) params.set("search", searchQuery);
      if (selectedPlatform !== "all") params.set("platform", selectedPlatform);
      if (showFavorites) params.set("isFavorite", "true");
      if (showBlocked) params.set("isBlocked", "true");
      if (selectedTag) params.set("tag", selectedTag);
      params.set("sortBy", "name");
      params.set("sortOrder", "asc");
      
      const res = await fetch(`/api/contacts?${params.toString()}`);
      if (!res.ok) throw new Error("Failed to fetch contacts");
      return res.json();
    },
  });

  const { data: selectedContact, isLoading: isLoadingContact } = useQuery<Contact>({
    queryKey: ["/api/contacts", selectedContactId],
    enabled: !!selectedContactId,
  });

  const { data: allTags = [] } = useQuery<string[]>({
    queryKey: ["/api/contacts/tags"],
  });

  const toggleFavoriteMutation = useMutation({
    mutationFn: async (contactId: string) => {
      return apiRequest("POST", `/api/contacts/${contactId}/favorite`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/contacts"] });
      if (selectedContactId) {
        queryClient.invalidateQueries({ queryKey: ["/api/contacts", selectedContactId] });
      }
    },
    onError: () => {
      toast({
        title: "Failed to update favorite status",
        variant: "destructive",
      });
    },
  });

  const toggleBlockMutation = useMutation({
    mutationFn: async (contactId: string) => {
      return apiRequest("POST", `/api/contacts/${contactId}/block`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/contacts"] });
      if (selectedContactId) {
        queryClient.invalidateQueries({ queryKey: ["/api/contacts", selectedContactId] });
      }
      toast({
        title: "Contact block status updated",
      });
    },
    onError: () => {
      toast({
        title: "Failed to update block status",
        variant: "destructive",
      });
    },
  });

  const updateContactMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<Contact> }) => {
      return apiRequest("PATCH", `/api/contacts/${id}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/contacts"] });
      if (selectedContactId) {
        queryClient.invalidateQueries({ queryKey: ["/api/contacts", selectedContactId] });
      }
      toast({
        title: "Contact updated",
      });
    },
    onError: () => {
      toast({
        title: "Failed to update contact",
        variant: "destructive",
      });
    },
  });

  const addTagMutation = useMutation({
    mutationFn: async ({ contactId, tag }: { contactId: string; tag: string }) => {
      return apiRequest("POST", `/api/contacts/${contactId}/tags`, { tag });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/contacts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/contacts/tags"] });
      if (selectedContactId) {
        queryClient.invalidateQueries({ queryKey: ["/api/contacts", selectedContactId] });
      }
    },
    onError: () => {
      toast({
        title: "Failed to add tag",
        variant: "destructive",
      });
    },
  });

  const removeTagMutation = useMutation({
    mutationFn: async ({ contactId, tag }: { contactId: string; tag: string }) => {
      return apiRequest("DELETE", `/api/contacts/${contactId}/tags/${encodeURIComponent(tag)}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/contacts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/contacts/tags"] });
      if (selectedContactId) {
        queryClient.invalidateQueries({ queryKey: ["/api/contacts", selectedContactId] });
      }
    },
    onError: () => {
      toast({
        title: "Failed to remove tag",
        variant: "destructive",
      });
    },
  });

  const handleSelectContact = (contactId: string) => {
    setSelectedContactId(contactId);
    setIsMobileListOpen(false);
  };

  const handleBackToList = () => {
    setIsMobileListOpen(true);
  };

  const contacts = contactsData?.contacts || [];
  const totalContacts = contactsData?.total || 0;

  const platformCounts: Record<Platform | "all", number> = {
    all: totalContacts,
    whatsapp: contacts.filter((c) => c.platform === "whatsapp").length,
    instagram: contacts.filter((c) => c.platform === "instagram").length,
    facebook: contacts.filter((c) => c.platform === "facebook").length,
  };

  return (
    <SidebarProvider>
      <div className="flex h-screen w-full" data-testid="contacts-page">
        <ContactsSidebar
          selectedPlatform={selectedPlatform}
          onSelectPlatform={setSelectedPlatform}
          platformCounts={platformCounts}
          showFavorites={showFavorites}
          onToggleFavorites={() => setShowFavorites(!showFavorites)}
          showBlocked={showBlocked}
          onToggleBlocked={() => setShowBlocked(!showBlocked)}
          allTags={allTags}
          selectedTag={selectedTag}
          onSelectTag={setSelectedTag}
        />

        <SidebarInset className="flex flex-col flex-1 min-w-0">
          <header className="flex h-14 items-center gap-4 border-b px-4">
            <SidebarTrigger data-testid="button-sidebar-toggle" />
            <div className="flex-1">
              <h2 className="font-semibold text-lg">Contacts</h2>
              <p className="text-sm text-muted-foreground">{totalContacts} contacts</p>
            </div>
            <ThemeToggle />
          </header>

          <main className="flex flex-1 overflow-hidden">
            <div
              className={`w-full md:w-96 border-r flex-shrink-0 ${
                !isMobileListOpen ? "hidden md:flex" : "flex"
              } flex-col`}
            >
              <ContactList
                contacts={contacts}
                isLoading={isLoadingContacts}
                selectedContactId={selectedContactId}
                onSelectContact={handleSelectContact}
                searchQuery={searchQuery}
                onSearchChange={setSearchQuery}
                onToggleFavorite={(id: string) => toggleFavoriteMutation.mutate(id)}
              />
            </div>

            <div
              className={`flex-1 ${
                isMobileListOpen ? "hidden md:flex" : "flex"
              } flex-col`}
            >
              {selectedContact ? (
                <>
                  <div className="md:hidden flex items-center gap-2 p-4 border-b">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={handleBackToList}
                      data-testid="button-back-to-list"
                    >
                      <ArrowLeft className="h-5 w-5" />
                    </Button>
                    <span className="font-medium">Back to list</span>
                  </div>
                  <ContactDetail
                    contact={selectedContact}
                    isLoading={isLoadingContact}
                    onUpdate={(data: Partial<Contact>) =>
                      updateContactMutation.mutate({ id: selectedContact.id, data })
                    }
                    onToggleFavorite={() => toggleFavoriteMutation.mutate(selectedContact.id)}
                    onToggleBlock={() => toggleBlockMutation.mutate(selectedContact.id)}
                    onAddTag={(tag: string) =>
                      addTagMutation.mutate({ contactId: selectedContact.id, tag })
                    }
                    onRemoveTag={(tag: string) =>
                      removeTagMutation.mutate({ contactId: selectedContact.id, tag })
                    }
                    allTags={allTags}
                  />
                </>
              ) : (
                <div className="flex-1 flex items-center justify-center text-muted-foreground">
                  <p>Select a contact to view details</p>
                </div>
              )}
            </div>
          </main>
        </SidebarInset>
      </div>
    </SidebarProvider>
  );
}
