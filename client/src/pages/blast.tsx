import { useState } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { 
  Plus, 
  Loader2, 
  Send, 
  Pause, 
  Play, 
  XCircle, 
  Eye,
  Trash2,
  ArrowLeft,
  MessageSquare,
  Users,
  Clock,
  CheckCircle2,
  AlertCircle
} from "lucide-react";
import type { BlastCampaign, BlastRecipient, Contact } from "@shared/schema";

type BlastRecipientWithContact = BlastRecipient & { contact: Contact };

interface BlastCampaignWithRecipients extends BlastCampaign {
  recipients?: BlastRecipientWithContact[];
}

function getStatusColor(status: BlastCampaign["status"]): string {
  switch (status) {
    case "draft": return "bg-muted text-muted-foreground";
    case "scheduled": return "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300";
    case "running": return "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300";
    case "paused": return "bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300";
    case "completed": return "bg-primary/10 text-primary";
    case "cancelled": return "bg-destructive/10 text-destructive";
    default: return "bg-muted text-muted-foreground";
  }
}

function getRecipientStatusColor(status: BlastRecipient["status"]): string {
  switch (status) {
    case "pending": return "bg-muted text-muted-foreground";
    case "generating": return "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300";
    case "queued": return "bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300";
    case "sending": return "bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-300";
    case "sent": return "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300";
    case "failed": return "bg-destructive/10 text-destructive";
    default: return "bg-muted text-muted-foreground";
  }
}

export default function BlastPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [selectedCampaign, setSelectedCampaign] = useState<string | null>(null);

  const { data: campaigns = [], isLoading: campaignsLoading } = useQuery<BlastCampaign[]>({
    queryKey: ["/api/blast-campaigns"],
  });

  const { data: campaignDetail, isLoading: detailLoading } = useQuery<BlastCampaignWithRecipients>({
    queryKey: ["/api/blast-campaigns", selectedCampaign],
    enabled: !!selectedCampaign,
  });

  const deleteCampaignMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/blast-campaigns/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/blast-campaigns"] });
      setSelectedCampaign(null);
      toast({ title: "Campaign deleted" });
    },
    onError: () => {
      toast({ title: "Failed to delete campaign", variant: "destructive" });
    },
  });

  const startCampaignMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("POST", `/api/blast-campaigns/${id}/start`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/blast-campaigns"] });
      toast({ title: "Campaign started" });
    },
    onError: (error: Error) => {
      toast({ title: error.message || "Failed to start campaign", variant: "destructive" });
    },
  });

  const pauseCampaignMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("POST", `/api/blast-campaigns/${id}/pause`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/blast-campaigns"] });
      toast({ title: "Campaign paused" });
    },
    onError: () => {
      toast({ title: "Failed to pause campaign", variant: "destructive" });
    },
  });

  const cancelCampaignMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("POST", `/api/blast-campaigns/${id}/cancel`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/blast-campaigns"] });
      toast({ title: "Campaign cancelled" });
    },
    onError: () => {
      toast({ title: "Failed to cancel campaign", variant: "destructive" });
    },
  });

  if (selectedCampaign && campaignDetail) {
    return (
      <CampaignDetail
        campaign={campaignDetail}
        isLoading={detailLoading}
        onBack={() => setSelectedCampaign(null)}
        onStart={() => startCampaignMutation.mutate(selectedCampaign)}
        onPause={() => pauseCampaignMutation.mutate(selectedCampaign)}
        onCancel={() => cancelCampaignMutation.mutate(selectedCampaign)}
        onDelete={() => deleteCampaignMutation.mutate(selectedCampaign)}
        isStarting={startCampaignMutation.isPending}
        isPausing={pauseCampaignMutation.isPending}
        isCancelling={cancelCampaignMutation.isPending}
        isDeleting={deleteCampaignMutation.isPending}
        queryClient={queryClient}
        toast={toast}
      />
    );
  }

  return (
    <div className="h-screen flex flex-col bg-background">
      <header className="border-b px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Send className="h-6 w-6 text-primary" />
          <h1 className="text-xl font-semibold">Blast Campaigns</h1>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => setLocation("/")} data-testid="button-back-inbox">
            Back to Inbox
          </Button>
          <Button onClick={() => setShowCreateDialog(true)} data-testid="button-create-campaign">
            <Plus className="h-4 w-4 mr-2" />
            New Campaign
          </Button>
        </div>
      </header>

      <div className="flex-1 overflow-auto p-6">
        {campaignsLoading ? (
          <div className="flex items-center justify-center h-64">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : campaigns.length === 0 ? (
          <Card className="max-w-md mx-auto mt-12">
            <CardHeader className="text-center">
              <MessageSquare className="h-12 w-12 mx-auto text-muted-foreground mb-2" />
              <CardTitle>No campaigns yet</CardTitle>
              <CardDescription>
                Create your first blast campaign to send personalized AI-generated messages to your contacts.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex justify-center">
              <Button onClick={() => setShowCreateDialog(true)} data-testid="button-create-first-campaign">
                <Plus className="h-4 w-4 mr-2" />
                Create Campaign
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {campaigns.map((campaign) => (
              <Card
                key={campaign.id}
                className="cursor-pointer hover-elevate"
                onClick={() => setSelectedCampaign(campaign.id)}
                data-testid={`card-campaign-${campaign.id}`}
              >
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between gap-2">
                    <CardTitle className="text-base line-clamp-1">{campaign.name}</CardTitle>
                    <Badge className={getStatusColor(campaign.status)}>{campaign.status}</Badge>
                  </div>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground line-clamp-2 mb-4">{campaign.prompt}</p>
                  <div className="flex items-center gap-4 text-sm text-muted-foreground">
                    <div className="flex items-center gap-1">
                      <Users className="h-4 w-4" />
                      <span>{campaign.totalRecipients || 0}</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <CheckCircle2 className="h-4 w-4 text-green-600" />
                      <span>{campaign.sentCount || 0}</span>
                    </div>
                    {(campaign.failedCount || 0) > 0 && (
                      <div className="flex items-center gap-1">
                        <AlertCircle className="h-4 w-4 text-destructive" />
                        <span>{campaign.failedCount}</span>
                      </div>
                    )}
                  </div>
                  {campaign.status === "running" && campaign.totalRecipients && (
                    <Progress 
                      value={((campaign.sentCount || 0) + (campaign.failedCount || 0)) / campaign.totalRecipients * 100} 
                      className="mt-3 h-1"
                    />
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      <CreateCampaignDialog
        open={showCreateDialog}
        onOpenChange={setShowCreateDialog}
        queryClient={queryClient}
        toast={toast}
      />
    </div>
  );
}

function CreateCampaignDialog({
  open,
  onOpenChange,
  queryClient,
  toast,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  queryClient: ReturnType<typeof useQueryClient>;
  toast: ReturnType<typeof useToast>["toast"];
}) {
  const [name, setName] = useState("");
  const [prompt, setPrompt] = useState("");
  const [selectedContacts, setSelectedContacts] = useState<string[]>([]);
  const [minInterval, setMinInterval] = useState("120");
  const [maxInterval, setMaxInterval] = useState("180");

  const { data: contactsData } = useQuery<{ contacts: Contact[]; total: number }>({
    queryKey: ["/api/contacts"],
    enabled: open,
  });

  const contacts = contactsData?.contacts || [];

  const createMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/blast-campaigns", {
        name,
        prompt,
        contactIds: selectedContacts,
        minIntervalSeconds: parseInt(minInterval),
        maxIntervalSeconds: parseInt(maxInterval),
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/blast-campaigns"] });
      onOpenChange(false);
      setName("");
      setPrompt("");
      setSelectedContacts([]);
      toast({ title: "Campaign created successfully" });
    },
    onError: () => {
      toast({ title: "Failed to create campaign", variant: "destructive" });
    },
  });

  const toggleContact = (contactId: string) => {
    setSelectedContacts((prev) =>
      prev.includes(contactId)
        ? prev.filter((id) => id !== contactId)
        : [...prev, contactId]
    );
  };

  const selectAllContacts = () => {
    if (selectedContacts.length === contacts.length) {
      setSelectedContacts([]);
    } else {
      setSelectedContacts(contacts.map((c) => c.id));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>Create Blast Campaign</DialogTitle>
          <DialogDescription>
            Create a new campaign to send AI-generated personalized messages to your contacts.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-auto space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="campaign-name">Campaign Name</Label>
            <Input
              id="campaign-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., New Year Promotion"
              data-testid="input-campaign-name"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="campaign-prompt">AI Prompt</Label>
            <Textarea
              id="campaign-prompt"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Describe the message you want AI to generate. E.g., 'Write a friendly message about our new product launch, make it personal and mention we value their business...'"
              className="min-h-[100px]"
              data-testid="input-campaign-prompt"
            />
            <p className="text-xs text-muted-foreground">
              AI will generate unique messages for each contact based on this prompt.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="min-interval">Min Interval (seconds)</Label>
              <Input
                id="min-interval"
                type="number"
                value={minInterval}
                onChange={(e) => setMinInterval(e.target.value)}
                min="60"
                data-testid="input-min-interval"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="max-interval">Max Interval (seconds)</Label>
              <Input
                id="max-interval"
                type="number"
                value={maxInterval}
                onChange={(e) => setMaxInterval(e.target.value)}
                min="60"
                data-testid="input-max-interval"
              />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Messages will be sent with a random delay between these intervals to avoid detection.
          </p>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Select Recipients ({selectedContacts.length} selected)</Label>
              <Button
                variant="ghost"
                size="sm"
                onClick={selectAllContacts}
                data-testid="button-select-all-contacts"
              >
                {selectedContacts.length === contacts.length ? "Deselect All" : "Select All"}
              </Button>
            </div>
            <ScrollArea className="h-48 border rounded-md p-2">
              {contacts.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">
                  No contacts available
                </p>
              ) : (
                <div className="space-y-2">
                  {contacts.map((contact) => (
                    <div
                      key={contact.id}
                      className="flex items-center gap-2 p-2 rounded hover-elevate cursor-pointer"
                      onClick={() => toggleContact(contact.id)}
                      data-testid={`contact-checkbox-${contact.id}`}
                    >
                      <Checkbox
                        checked={selectedContacts.includes(contact.id)}
                        onCheckedChange={() => toggleContact(contact.id)}
                      />
                      <span className="flex-1 text-sm">
                        {contact.name || contact.phoneNumber || "Unknown"}
                      </span>
                      <Badge variant="outline" className="text-xs">
                        {contact.platform}
                      </Badge>
                    </div>
                  ))}
                </div>
              )}
            </ScrollArea>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} data-testid="button-cancel-create">
            Cancel
          </Button>
          <Button
            onClick={() => createMutation.mutate()}
            disabled={!name || !prompt || selectedContacts.length === 0 || createMutation.isPending}
            data-testid="button-confirm-create"
          >
            {createMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Create Campaign
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CampaignDetail({
  campaign,
  isLoading,
  onBack,
  onStart,
  onPause,
  onCancel,
  onDelete,
  isStarting,
  isPausing,
  isCancelling,
  isDeleting,
  queryClient,
  toast,
}: {
  campaign: BlastCampaignWithRecipients;
  isLoading: boolean;
  onBack: () => void;
  onStart: () => void;
  onPause: () => void;
  onCancel: () => void;
  onDelete: () => void;
  isStarting: boolean;
  isPausing: boolean;
  isCancelling: boolean;
  isDeleting: boolean;
  queryClient: ReturnType<typeof useQueryClient>;
  toast: ReturnType<typeof useToast>["toast"];
}) {
  const [previewContact, setPreviewContact] = useState<Contact | null>(null);
  const [previewMessage, setPreviewMessage] = useState<string>("");
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);

  const handlePreview = async (contact: Contact) => {
    setPreviewContact(contact);
    setIsPreviewLoading(true);
    try {
      const res = await apiRequest("POST", `/api/blast-campaigns/${campaign.id}/preview`, {
        contactId: contact.id,
      });
      const data = await res.json();
      setPreviewMessage(data.message);
    } catch (error) {
      toast({ title: "Failed to generate preview", variant: "destructive" });
      setPreviewMessage("");
    } finally {
      setIsPreviewLoading(false);
    }
  };

  const progress = campaign.totalRecipients
    ? ((campaign.sentCount || 0) + (campaign.failedCount || 0)) / campaign.totalRecipients * 100
    : 0;

  return (
    <div className="h-screen flex flex-col bg-background">
      <header className="border-b px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={onBack} data-testid="button-back">
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <h1 className="text-xl font-semibold">{campaign.name}</h1>
            <div className="flex items-center gap-2 mt-1">
              <Badge className={getStatusColor(campaign.status)}>{campaign.status}</Badge>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {campaign.status === "draft" && (
            <Button onClick={onStart} disabled={isStarting} data-testid="button-start-campaign">
              {isStarting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Play className="h-4 w-4 mr-2" />}
              Start Campaign
            </Button>
          )}
          {campaign.status === "paused" && (
            <Button onClick={onStart} disabled={isStarting} data-testid="button-resume-campaign">
              {isStarting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Play className="h-4 w-4 mr-2" />}
              Resume
            </Button>
          )}
          {campaign.status === "running" && (
            <Button variant="outline" onClick={onPause} disabled={isPausing} data-testid="button-pause-campaign">
              {isPausing ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Pause className="h-4 w-4 mr-2" />}
              Pause
            </Button>
          )}
          {(campaign.status === "draft" || campaign.status === "running" || campaign.status === "paused") && (
            <Button variant="destructive" onClick={onCancel} disabled={isCancelling} data-testid="button-cancel-campaign">
              {isCancelling ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <XCircle className="h-4 w-4 mr-2" />}
              Cancel
            </Button>
          )}
          {(campaign.status === "completed" || campaign.status === "cancelled" || campaign.status === "draft") && (
            <Button variant="ghost" onClick={onDelete} disabled={isDeleting} data-testid="button-delete-campaign">
              {isDeleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
            </Button>
          )}
        </div>
      </header>

      <div className="flex-1 overflow-auto p-6 space-y-6">
        <div className="grid gap-4 md:grid-cols-4">
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Total Recipients</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{campaign.totalRecipients || 0}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Sent</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-green-600">{campaign.sentCount || 0}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Failed</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-destructive">{campaign.failedCount || 0}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Progress</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{Math.round(progress)}%</div>
              <Progress value={progress} className="mt-2 h-1" />
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>AI Prompt</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm whitespace-pre-wrap">{campaign.prompt}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Recipients</CardTitle>
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Clock className="h-4 w-4" />
                <span>Interval: {campaign.minIntervalSeconds}-{campaign.maxIntervalSeconds}s</span>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <div className="space-y-2">
                {campaign.recipients?.map((recipient) => (
                  <div
                    key={recipient.id}
                    className="flex items-center justify-between p-3 border rounded-lg"
                    data-testid={`recipient-${recipient.id}`}
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center">
                        {(recipient.contact.name || "?")[0].toUpperCase()}
                      </div>
                      <div>
                        <p className="font-medium">
                          {recipient.contact.name || recipient.contact.phoneNumber || "Unknown"}
                        </p>
                        {recipient.contact.phoneNumber && recipient.contact.name && (
                          <p className="text-xs text-muted-foreground">{recipient.contact.phoneNumber}</p>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {recipient.generatedMessage && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setPreviewContact(recipient.contact);
                            setPreviewMessage(recipient.generatedMessage || "");
                          }}
                          data-testid={`button-view-message-${recipient.id}`}
                        >
                          <Eye className="h-4 w-4" />
                        </Button>
                      )}
                      {campaign.status === "draft" && !recipient.generatedMessage && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handlePreview(recipient.contact)}
                          disabled={isPreviewLoading}
                          data-testid={`button-preview-${recipient.id}`}
                        >
                          {isPreviewLoading && previewContact?.id === recipient.contact.id ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Eye className="h-4 w-4" />
                          )}
                        </Button>
                      )}
                      <Badge className={getRecipientStatusColor(recipient.status)}>
                        {recipient.status}
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Dialog open={!!previewContact && !!previewMessage} onOpenChange={() => { setPreviewContact(null); setPreviewMessage(""); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Message Preview</DialogTitle>
            <DialogDescription>
              {previewContact?.name || previewContact?.phoneNumber || "Unknown Contact"}
            </DialogDescription>
          </DialogHeader>
          <div className="p-4 bg-muted rounded-lg">
            <p className="text-sm whitespace-pre-wrap">{previewMessage}</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setPreviewContact(null); setPreviewMessage(""); }}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
