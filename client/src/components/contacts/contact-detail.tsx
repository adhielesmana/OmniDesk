import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Star, Ban, Tag, X, Plus, Mail, Phone, Edit2, Save, MessageCircle } from "lucide-react";
import { SiWhatsapp, SiFacebook, SiInstagram } from "react-icons/si";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Link } from "wouter";
import { format } from "date-fns";
import type { Contact, Platform, Conversation } from "@shared/schema";

interface ContactDetailProps {
  contact: Contact;
  isLoading: boolean;
  onUpdate: (data: Partial<Contact>) => void;
  onToggleFavorite: () => void;
  onToggleBlock: () => void;
  onAddTag: (tag: string) => void;
  onRemoveTag: (tag: string) => void;
  allTags: string[];
}

function getPlatformIcon(platform: Platform) {
  switch (platform) {
    case "whatsapp":
      return <SiWhatsapp className="h-5 w-5 text-[#25D366]" />;
    case "instagram":
      return <SiInstagram className="h-5 w-5 text-[#E4405F]" />;
    case "facebook":
      return <SiFacebook className="h-5 w-5 text-[#1877F2]" />;
    default:
      return null;
  }
}

function getInitials(name: string | null): string {
  if (!name) return "?";
  return name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

export function ContactDetail({
  contact,
  isLoading,
  onUpdate,
  onToggleFavorite,
  onToggleBlock,
  onAddTag,
  onRemoveTag,
  allTags,
}: ContactDetailProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editedName, setEditedName] = useState(contact.name || "");
  const [editedEmail, setEditedEmail] = useState(contact.email || "");
  const [editedNotes, setEditedNotes] = useState(contact.notes || "");
  const [newTag, setNewTag] = useState("");
  const [showTagPopover, setShowTagPopover] = useState(false);

  const { data: conversations = [] } = useQuery<Conversation[]>({
    queryKey: ["/api/contacts", contact.id, "conversations"],
    queryFn: async () => {
      const res = await fetch(`/api/contacts/${contact.id}/conversations`);
      if (!res.ok) throw new Error("Failed to fetch conversations");
      return res.json();
    },
    enabled: !!contact.id,
  });

  const handleSave = () => {
    onUpdate({
      name: editedName || null,
      email: editedEmail || null,
      notes: editedNotes || null,
    });
    setIsEditing(false);
  };

  const handleAddTag = () => {
    if (newTag.trim()) {
      onAddTag(newTag.trim());
      setNewTag("");
      setShowTagPopover(false);
    }
  };

  const existingTags = contact.tags || [];
  const availableTags = allTags.filter((tag) => !existingTags.includes(tag));

  if (isLoading) {
    return (
      <div className="p-6 space-y-6">
        <div className="flex items-center gap-4">
          <Skeleton className="h-16 w-16 rounded-full" />
          <div className="space-y-2">
            <Skeleton className="h-6 w-40" />
            <Skeleton className="h-4 w-24" />
          </div>
        </div>
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }

  return (
    <ScrollArea className="flex-1">
      <div className="p-6 space-y-6">
        <div className="flex items-start gap-4">
          <Avatar className="h-16 w-16">
            <AvatarFallback className="text-xl">{getInitials(contact.name)}</AvatarFallback>
          </Avatar>

          <div className="flex-1 min-w-0">
            {isEditing ? (
              <Input
                value={editedName}
                onChange={(e) => setEditedName(e.target.value)}
                placeholder="Contact name"
                className="text-xl font-semibold mb-2"
                data-testid="input-edit-name"
              />
            ) : (
              <h2 className="text-xl font-semibold truncate">
                {contact.name || contact.phoneNumber || contact.platformId}
              </h2>
            )}
            <div className="flex items-center gap-2 text-muted-foreground">
              {getPlatformIcon(contact.platform)}
              <span className="capitalize">{contact.platform}</span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {isEditing ? (
              <Button onClick={handleSave} data-testid="button-save-contact">
                <Save className="h-4 w-4 mr-2" />
                Save
              </Button>
            ) : (
              <Button variant="outline" onClick={() => setIsEditing(true)} data-testid="button-edit-contact">
                <Edit2 className="h-4 w-4 mr-2" />
                Edit
              </Button>
            )}
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button
            variant={contact.isFavorite ? "default" : "outline"}
            size="sm"
            onClick={onToggleFavorite}
            data-testid="button-toggle-favorite"
          >
            <Star className={`h-4 w-4 mr-2 ${contact.isFavorite ? "fill-current" : ""}`} />
            {contact.isFavorite ? "Favorited" : "Add to Favorites"}
          </Button>
          <Button
            variant={contact.isBlocked ? "destructive" : "outline"}
            size="sm"
            onClick={onToggleBlock}
            data-testid="button-toggle-block"
          >
            <Ban className="h-4 w-4 mr-2" />
            {contact.isBlocked ? "Blocked" : "Block"}
          </Button>
          <Button asChild variant="outline" size="sm" data-testid="button-view-conversation">
            <Link href="/">
              <MessageCircle className="h-4 w-4 mr-2" />
              View Conversation
            </Link>
          </Button>
        </div>

        <Separator />

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Contact Information</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-3">
              <Phone className="h-4 w-4 text-muted-foreground" />
              <span>{contact.phoneNumber || "No phone number"}</span>
            </div>
            {isEditing ? (
              <div className="flex items-center gap-3">
                <Mail className="h-4 w-4 text-muted-foreground" />
                <Input
                  value={editedEmail}
                  onChange={(e) => setEditedEmail(e.target.value)}
                  placeholder="Email address"
                  type="email"
                  data-testid="input-edit-email"
                />
              </div>
            ) : (
              <div className="flex items-center gap-3">
                <Mail className="h-4 w-4 text-muted-foreground" />
                <span>{contact.email || "No email"}</span>
              </div>
            )}
            {contact.lastContactedAt && (
              <div className="text-sm text-muted-foreground">
                Last contacted: {format(new Date(contact.lastContactedAt), "PPp")}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2">
            <CardTitle className="text-base">Tags</CardTitle>
            <Popover open={showTagPopover} onOpenChange={setShowTagPopover}>
              <PopoverTrigger asChild>
                <Button variant="ghost" size="sm" data-testid="button-add-tag">
                  <Plus className="h-4 w-4" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-64" align="end">
                <div className="space-y-2">
                  <div className="flex gap-2">
                    <Input
                      value={newTag}
                      onChange={(e) => setNewTag(e.target.value)}
                      placeholder="New tag"
                      onKeyDown={(e) => e.key === "Enter" && handleAddTag()}
                      data-testid="input-new-tag"
                    />
                    <Button size="sm" onClick={handleAddTag} data-testid="button-confirm-add-tag">
                      Add
                    </Button>
                  </div>
                  {availableTags.length > 0 && (
                    <>
                      <Separator />
                      <div className="flex flex-wrap gap-1">
                        {availableTags.map((tag) => (
                          <Badge
                            key={tag}
                            variant="outline"
                            className="cursor-pointer hover-elevate"
                            onClick={() => {
                              onAddTag(tag);
                              setShowTagPopover(false);
                            }}
                            data-testid={`button-existing-tag-${tag}`}
                          >
                            {tag}
                          </Badge>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              </PopoverContent>
            </Popover>
          </CardHeader>
          <CardContent>
            {existingTags.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {existingTags.map((tag) => (
                  <Badge key={tag} variant="secondary" className="flex items-center gap-1">
                    <Tag className="h-3 w-3" />
                    {tag}
                    <button
                      onClick={() => onRemoveTag(tag)}
                      className="ml-1 hover:text-destructive"
                      data-testid={`button-remove-tag-${tag}`}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No tags added</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Notes</CardTitle>
          </CardHeader>
          <CardContent>
            {isEditing ? (
              <Textarea
                value={editedNotes}
                onChange={(e) => setEditedNotes(e.target.value)}
                placeholder="Add notes about this contact..."
                rows={4}
                data-testid="textarea-edit-notes"
              />
            ) : (
              <p className="text-sm whitespace-pre-wrap">
                {contact.notes || "No notes added"}
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Conversation History</CardTitle>
          </CardHeader>
          <CardContent>
            {conversations.length > 0 ? (
              <div className="space-y-3">
                {conversations.map((conv) => (
                  <Link
                    key={conv.id}
                    href={`/?conversation=${conv.id}`}
                    className="block p-3 rounded-md border hover-elevate"
                    data-testid={`conversation-link-${conv.id}`}
                  >
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <div className="flex items-center gap-2">
                        <MessageCircle className="h-4 w-4 text-muted-foreground" />
                        <span className="text-sm font-medium capitalize">{conv.platform}</span>
                      </div>
                      {conv.unreadCount && conv.unreadCount > 0 && (
                        <Badge variant="default" className="text-xs">
                          {conv.unreadCount} unread
                        </Badge>
                      )}
                    </div>
                    <p className="text-sm text-muted-foreground truncate">
                      {conv.lastMessagePreview || "No messages"}
                    </p>
                    {conv.lastMessageAt && (
                      <p className="text-xs text-muted-foreground mt-1">
                        {format(new Date(conv.lastMessageAt), "PPp")}
                      </p>
                    )}
                  </Link>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No conversations yet</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Platform ID</span>
              <span className="font-mono text-xs">{contact.platformId}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Added</span>
              <span>{contact.createdAt ? format(new Date(contact.createdAt), "PP") : "Unknown"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Updated</span>
              <span>{contact.updatedAt ? format(new Date(contact.updatedAt), "PP") : "Unknown"}</span>
            </div>
          </CardContent>
        </Card>
      </div>
    </ScrollArea>
  );
}
