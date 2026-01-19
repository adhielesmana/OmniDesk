import { useState, useMemo, useCallback } from "react";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { MessageTemplate, VariableMapping } from "@shared/schema";
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
  AlertCircle,
  RefreshCw,
  Edit,
  SkipForward,
  Zap
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
    case "awaiting_review": return "bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300";
    case "approved": return "bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300";
    case "sending": return "bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-300";
    case "sent": return "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300";
    case "failed": return "bg-destructive/10 text-destructive";
    case "skipped": return "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400";
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
    refetchInterval: 5000,
  });

  const quickPauseMutation = useMutation({
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

  const quickCancelMutation = useMutation({
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

  const quickResumeMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("POST", `/api/blast-campaigns/${id}/start`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/blast-campaigns"] });
      toast({ title: "Campaign resumed" });
    },
    onError: () => {
      toast({ title: "Failed to resume campaign", variant: "destructive" });
    },
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
                  <div className="flex items-center gap-4 text-sm text-muted-foreground flex-wrap">
                    <div className="flex items-center gap-1">
                      <Users className="h-4 w-4" />
                      <span>{campaign.totalRecipients || 0}</span>
                    </div>
                    {(campaign as any).isGenerating && (
                      <div className="flex items-center gap-1 text-blue-600">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        <span>Generating {(campaign as any).generatedCount || 0}/{campaign.totalRecipients || 0}</span>
                      </div>
                    )}
                    {!(campaign as any).isGenerating && ((campaign as any).generatedCount || 0) > 0 && (
                      <div className="flex items-center gap-1 text-blue-600">
                        <MessageSquare className="h-4 w-4" />
                        <span>{(campaign as any).generatedCount || 0} ready</span>
                      </div>
                    )}
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
                  {(campaign.status === "running" || campaign.status === "paused") && (
                    <div className="flex items-center gap-2 mt-3 pt-3 border-t" onClick={(e) => e.stopPropagation()}>
                      {campaign.status === "running" && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={(e) => {
                            e.stopPropagation();
                            quickPauseMutation.mutate(campaign.id);
                          }}
                          disabled={quickPauseMutation.isPending}
                          data-testid={`button-quick-pause-${campaign.id}`}
                        >
                          {quickPauseMutation.isPending ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <Pause className="h-3 w-3" />
                          )}
                          <span className="ml-1">Pause</span>
                        </Button>
                      )}
                      {campaign.status === "paused" && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={(e) => {
                            e.stopPropagation();
                            quickResumeMutation.mutate(campaign.id);
                          }}
                          disabled={quickResumeMutation.isPending}
                          data-testid={`button-quick-resume-${campaign.id}`}
                        >
                          {quickResumeMutation.isPending ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <Play className="h-3 w-3" />
                          )}
                          <span className="ml-1">Resume</span>
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={(e) => {
                          e.stopPropagation();
                          quickCancelMutation.mutate(campaign.id);
                        }}
                        disabled={quickCancelMutation.isPending}
                        data-testid={`button-quick-stop-${campaign.id}`}
                      >
                        {quickCancelMutation.isPending ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <XCircle className="h-3 w-3" />
                        )}
                        <span className="ml-1">Stop</span>
                      </Button>
                    </div>
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
  const [selectedContacts, setSelectedContacts] = useState<Set<string>>(new Set());
  const [minInterval, setMinInterval] = useState("600");
  const [maxInterval, setMaxInterval] = useState("1800");
  const [contactSearch, setContactSearch] = useState("");
  const [displayLimit, setDisplayLimit] = useState(50);
  const [templateId, setTemplateId] = useState<string>("");
  const [templateMode, setTemplateMode] = useState<"none" | "existing" | "new">("none");
  const [newTemplateContent, setNewTemplateContent] = useState("Hi {{1}}, {{2}}");
  const [variableMappings, setVariableMappings] = useState<VariableMapping[]>([
    { placeholder: "1", type: "recipient_name", label: "Recipient Name" },
    { placeholder: "2", type: "ai_prompt", label: "AI Message" },
  ]);

  // Extract variables from template content and sync with mappings
  const updateVariableMappings = useCallback((content: string) => {
    const matches = content.match(/\{\{(\d+)\}\}/g) || [];
    const placeholders = [...new Set(matches.map(m => m.replace(/[{}]/g, '')))].sort();
    
    setVariableMappings(prev => {
      const newMappings: VariableMapping[] = placeholders.map(p => {
        const existing = prev.find(m => m.placeholder === p);
        if (existing) return existing;
        // Default mapping based on position
        if (p === "1") return { placeholder: p, type: "recipient_name", label: "Recipient Name" };
        if (p === "2") return { placeholder: p, type: "ai_prompt", label: "AI Message" };
        return { placeholder: p, type: "custom", label: `Variable ${p}`, customValue: "" };
      });
      return newMappings;
    });
  }, []);

  const { data: templatesData } = useQuery<MessageTemplate[]>({
    queryKey: ["/api/admin/templates"],
    enabled: open,
  });

  const approvedTemplates = useMemo(() => {
    return (templatesData || []).filter(t => 
      t.isActive && 
      t.twilioContentSid && 
      t.twilioApprovalStatus === "approved"
    );
  }, [templatesData]);

  const { data: contactsData, isLoading: contactsLoading } = useQuery<{ contacts: Contact[]; total: number }>({
    queryKey: ["/api/contacts", { limit: 50000 }],
    queryFn: async () => {
      const res = await fetch("/api/contacts?limit=50000", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch contacts");
      return res.json();
    },
    enabled: open,
  });

  const contacts = contactsData?.contacts || [];
  
  const filteredContacts = useMemo(() => {
    if (!contactSearch) return contacts;
    const search = contactSearch.toLowerCase();
    return contacts.filter(c => 
      c.name?.toLowerCase().includes(search) || 
      c.phoneNumber?.includes(search)
    );
  }, [contacts, contactSearch]);
  
  const displayedContacts = useMemo(() => {
    return filteredContacts.slice(0, displayLimit);
  }, [filteredContacts, displayLimit]);

  const createMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/blast-campaigns", {
        name,
        prompt,
        contactIds: Array.from(selectedContacts),
        minIntervalSeconds: parseInt(minInterval),
        maxIntervalSeconds: parseInt(maxInterval),
        templateId: templateMode === "existing" ? templateId : undefined,
        createNewTemplate: templateMode === "new",
        templateContent: templateMode === "new" ? newTemplateContent : undefined,
        variableMappings: templateMode === "new" ? variableMappings : undefined,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/blast-campaigns"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/templates"] });
      onOpenChange(false);
      setName("");
      setPrompt("");
      setSelectedContacts(new Set());
      setContactSearch("");
      setDisplayLimit(50);
      setTemplateId("");
      setTemplateMode("none");
      setNewTemplateContent("Hi {{1}}, {{2}}");
      setVariableMappings([
        { placeholder: "1", type: "recipient_name", label: "Recipient Name" },
        { placeholder: "2", type: "ai_prompt", label: "AI Message" },
      ]);
      toast({ title: "Campaign created successfully" });
    },
    onError: () => {
      toast({ title: "Failed to create campaign", variant: "destructive" });
    },
  });

  const toggleContact = useCallback((contactId: string) => {
    setSelectedContacts((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(contactId)) {
        newSet.delete(contactId);
      } else {
        newSet.add(contactId);
      }
      return newSet;
    });
  }, []);

  const selectAllContacts = () => {
    if (selectedContacts.size === contacts.length) {
      setSelectedContacts(new Set());
    } else {
      setSelectedContacts(new Set(contacts.map((c) => c.id)));
    }
  };
  
  const selectFilteredContacts = () => {
    setSelectedContacts((prev) => {
      const newSet = new Set(prev);
      filteredContacts.forEach(c => newSet.add(c.id));
      return newSet;
    });
  };
  
  const loadMore = () => {
    setDisplayLimit(prev => prev + 100);
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
              <Label htmlFor="min-interval">Min Interval (seconds) - Default: 10 min</Label>
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
              <Label htmlFor="max-interval">Max Interval (seconds) - Default: 30 min</Label>
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

          <div className="space-y-3">
            <Label>WhatsApp Template (Required for Twilio)</Label>
            <div className="flex flex-col gap-2">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="templateMode"
                  checked={templateMode === "none"}
                  onChange={() => { setTemplateMode("none"); setTemplateId(""); }}
                  className="w-4 h-4"
                  data-testid="radio-template-none"
                />
                <span className="text-sm">No template (Baileys only)</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="templateMode"
                  checked={templateMode === "new"}
                  onChange={() => { setTemplateMode("new"); setTemplateId(""); }}
                  className="w-4 h-4"
                  data-testid="radio-template-new"
                />
                <span className="text-sm">Create new template for this campaign</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="templateMode"
                  checked={templateMode === "existing"}
                  onChange={() => setTemplateMode("existing")}
                  className="w-4 h-4"
                  data-testid="radio-template-existing"
                />
                <span className="text-sm">Use existing approved template</span>
              </label>
            </div>
            
            {templateMode === "existing" && (
              <Select value={templateId} onValueChange={setTemplateId}>
                <SelectTrigger data-testid="select-blast-template">
                  <SelectValue placeholder="Select an approved template..." />
                </SelectTrigger>
                <SelectContent>
                  {approvedTemplates.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.name} {t.category && `(${t.category})`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            
            {templateMode === "new" && (
              <div className="space-y-3">
                <div>
                  <Label className="text-sm">Template Content</Label>
                  <Textarea
                    value={newTemplateContent}
                    onChange={(e) => {
                      setNewTemplateContent(e.target.value);
                      updateVariableMappings(e.target.value);
                    }}
                    placeholder="Hi {{1}}, {{2}}"
                    rows={3}
                    className="mt-1"
                    data-testid="input-create-template-content"
                  />
                </div>
                
                {variableMappings.length > 0 && (
                  <div className="space-y-2">
                    <Label className="text-sm">Variable Mappings</Label>
                    {variableMappings.map((mapping, index) => (
                      <div key={mapping.placeholder} className="flex items-center gap-2 p-2 rounded border bg-muted/30">
                        <span className="text-sm font-mono w-12">{`{{${mapping.placeholder}}}`}</span>
                        <Select
                          value={mapping.type}
                          onValueChange={(value: VariableMapping["type"]) => {
                            setVariableMappings(prev => prev.map((m, i) => 
                              i === index ? { ...m, type: value, customValue: value === "custom" ? "" : undefined } : m
                            ));
                          }}
                        >
                          <SelectTrigger className="flex-1" data-testid={`select-var-type-${mapping.placeholder}`}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="recipient_name">Recipient Name</SelectItem>
                            <SelectItem value="ai_prompt">AI Message</SelectItem>
                            <SelectItem value="phone_number">Phone Number</SelectItem>
                            <SelectItem value="custom">Custom Value</SelectItem>
                          </SelectContent>
                        </Select>
                        {mapping.type === "custom" && (
                          <Input
                            value={mapping.customValue || ""}
                            onChange={(e) => {
                              setVariableMappings(prev => prev.map((m, i) =>
                                i === index ? { ...m, customValue: e.target.value } : m
                              ));
                            }}
                            placeholder="Enter value..."
                            className="flex-1"
                            data-testid={`input-custom-value-${mapping.placeholder}`}
                          />
                        )}
                      </div>
                    ))}
                  </div>
                )}
                
                <div className="p-3 rounded-md bg-muted/50 border">
                  <p className="text-xs text-muted-foreground">
                    After creation, sync it to Twilio and wait for approval.
                  </p>
                </div>
              </div>
            )}
            
            <p className="text-xs text-muted-foreground">
              Templates must be approved by Twilio before sending.
            </p>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <Label>Select Recipients ({selectedContacts.size} selected)</Label>
              <div className="flex gap-2">
                {contactSearch && filteredContacts.length > 0 && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={selectFilteredContacts}
                    data-testid="button-select-filtered"
                  >
                    Select {filteredContacts.length} filtered
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={selectAllContacts}
                  data-testid="button-select-all-contacts"
                >
                  {selectedContacts.size === contacts.length ? "Deselect All" : "Select All"}
                </Button>
              </div>
            </div>
            <Input
              placeholder="Search contacts..."
              value={contactSearch}
              onChange={(e) => {
                setContactSearch(e.target.value);
                setDisplayLimit(50);
              }}
              className="mb-2"
              data-testid="input-contact-search"
            />
            <ScrollArea className="h-48 border rounded-md p-2">
              {contactsLoading ? (
                <div className="flex items-center justify-center py-4">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                  <span className="ml-2 text-sm text-muted-foreground">Loading contacts...</span>
                </div>
              ) : contacts.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">
                  No contacts available
                </p>
              ) : filteredContacts.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">
                  No contacts match your search
                </p>
              ) : (
                <div className="space-y-1">
                  {displayedContacts.map((contact) => (
                    <div
                      key={contact.id}
                      className="flex items-center gap-2 p-2 rounded hover-elevate cursor-pointer"
                      onClick={() => toggleContact(contact.id)}
                      data-testid={`contact-checkbox-${contact.id}`}
                    >
                      <Checkbox
                        checked={selectedContacts.has(contact.id)}
                        onCheckedChange={() => toggleContact(contact.id)}
                      />
                      <span className="flex-1 text-sm truncate">
                        {contact.name || contact.phoneNumber || "Unknown"}
                      </span>
                      <Badge variant="outline" className="text-xs shrink-0">
                        {contact.platform}
                      </Badge>
                    </div>
                  ))}
                  {displayLimit < filteredContacts.length && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="w-full mt-2"
                      onClick={loadMore}
                      data-testid="button-load-more"
                    >
                      Load more ({filteredContacts.length - displayLimit} remaining)
                    </Button>
                  )}
                </div>
              )}
            </ScrollArea>
            <p className="text-xs text-muted-foreground">
              Total: {contacts.length} contacts | Showing: {displayedContacts.length} | Filtered: {filteredContacts.length}
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} data-testid="button-cancel-create">
            Cancel
          </Button>
          <Button
            onClick={() => createMutation.mutate()}
            disabled={!name || !prompt || selectedContacts.size === 0 || createMutation.isPending}
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

interface QueueCounts {
  pending: number;
  generating: number;
  awaitingReview: number;
  approved: number;
}

interface QueueResponse {
  recipients: BlastRecipientWithContact[];
  counts: QueueCounts;
}

function MessageQueueCard({
  campaignId,
  campaignStatus,
  queryClient,
  toast,
}: {
  campaignId: string;
  campaignStatus: string;
  queryClient: ReturnType<typeof useQueryClient>;
  toast: ReturnType<typeof useToast>["toast"];
}) {
  const [editingRecipient, setEditingRecipient] = useState<BlastRecipientWithContact | null>(null);
  const [editedMessage, setEditedMessage] = useState("");

  const { data: queueData, isLoading } = useQuery<QueueResponse>({
    queryKey: ["/api/blast-campaigns", campaignId, "queue"],
    queryFn: async () => {
      const res = await fetch(`/api/blast-campaigns/${campaignId}/queue`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch queue");
      return res.json();
    },
    refetchInterval: 5000,
  });

  const generateMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/blast-campaigns/${campaignId}/generate`);
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/blast-campaigns", campaignId, "queue"] });
      toast({ title: `Generated ${data.generated} messages` });
    },
    onError: () => {
      toast({ title: "Failed to generate messages", variant: "destructive" });
    },
  });

  const skipMutation = useMutation({
    mutationFn: async (recipientId: string) => {
      const res = await apiRequest("POST", `/api/blast-recipients/${recipientId}/skip`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/blast-campaigns", campaignId, "queue"] });
      toast({ title: "Message skipped" });
    },
    onError: () => {
      toast({ title: "Failed to skip message", variant: "destructive" });
    },
  });

  const regenerateMutation = useMutation({
    mutationFn: async (recipientId: string) => {
      const res = await apiRequest("POST", `/api/blast-recipients/${recipientId}/regenerate`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/blast-campaigns", campaignId, "queue"] });
      toast({ title: "Message will be regenerated" });
    },
    onError: () => {
      toast({ title: "Failed to regenerate message", variant: "destructive" });
    },
  });

  const updateMessageMutation = useMutation({
    mutationFn: async ({ recipientId, message }: { recipientId: string; message: string }) => {
      const res = await apiRequest("PATCH", `/api/blast-recipients/${recipientId}`, {
        reviewedMessage: message,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/blast-campaigns", campaignId, "queue"] });
      setEditingRecipient(null);
      toast({ title: "Message updated" });
    },
    onError: () => {
      toast({ title: "Failed to update message", variant: "destructive" });
    },
  });

  const startEdit = (recipient: BlastRecipientWithContact) => {
    setEditingRecipient(recipient);
    setEditedMessage(recipient.reviewedMessage || recipient.generatedMessage || "");
  };

  const saveEdit = () => {
    if (editingRecipient) {
      updateMessageMutation.mutate({ recipientId: editingRecipient.id, message: editedMessage });
    }
  };

  const queuedRecipients = queueData?.recipients || [];
  const counts = queueData?.counts || { pending: 0, generating: 0, awaitingReview: 0, approved: 0 };
  const isActive = campaignStatus === "draft" || campaignStatus === "running" || campaignStatus === "paused";

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between flex-wrap gap-2">
          <CardTitle className="flex items-center gap-2">
            <MessageSquare className="h-5 w-5" />
            Message Queue
          </CardTitle>
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant="outline">
              {counts.pending} pending
            </Badge>
            <Badge variant="outline" className="bg-blue-50 dark:bg-blue-950">
              {counts.generating} generating
            </Badge>
            <Badge variant="outline" className="bg-purple-50 dark:bg-purple-950">
              {counts.approved} ready to send
            </Badge>
            {isActive && (
              <Button 
                size="sm" 
                variant="outline"
                onClick={() => generateMutation.mutate()}
                disabled={generateMutation.isPending || counts.pending === 0}
                data-testid="button-generate-more"
              >
                {generateMutation.isPending ? (
                  <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                ) : (
                  <Zap className="h-4 w-4 mr-1" />
                )}
                Generate More
              </Button>
            )}
          </div>
        </div>
        <CardDescription>
          Messages are generated 5 at a time and automatically queued for sending.
          You can review, edit, or skip any message before it's sent.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : queuedRecipients.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <MessageSquare className="h-12 w-12 mx-auto mb-3 opacity-50" />
            <p>No messages in queue</p>
            {isActive && counts.pending > 0 && (
              <p className="text-sm mt-1">Click "Generate More" to generate messages</p>
            )}
          </div>
        ) : (
          <div className="space-y-3 max-h-96 overflow-y-auto">
            {queuedRecipients.map((recipient) => (
              <div
                key={recipient.id}
                className="p-3 border rounded-lg"
                data-testid={`queue-recipient-${recipient.id}`}
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center text-sm shrink-0">
                      {(recipient.contact.name || "?")[0].toUpperCase()}
                    </div>
                    <div>
                      <p className="font-medium text-sm">
                        {recipient.contact.name || recipient.contact.phoneNumber || "Unknown"}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge className={getRecipientStatusColor(recipient.status)}>
                      {recipient.status === "awaiting_review" ? "reviewing" : recipient.status}
                    </Badge>
                    {isActive && ["awaiting_review", "approved"].includes(recipient.status) && (
                      <>
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => startEdit(recipient)}
                          data-testid={`button-edit-${recipient.id}`}
                        >
                          <Edit className="h-4 w-4" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => regenerateMutation.mutate(recipient.id)}
                          disabled={regenerateMutation.isPending}
                          data-testid={`button-regenerate-${recipient.id}`}
                        >
                          <RefreshCw className="h-4 w-4" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => skipMutation.mutate(recipient.id)}
                          disabled={skipMutation.isPending}
                          data-testid={`button-skip-${recipient.id}`}
                        >
                          <SkipForward className="h-4 w-4" />
                        </Button>
                      </>
                    )}
                  </div>
                </div>
                {editingRecipient?.id === recipient.id ? (
                  <div className="mt-2 space-y-2">
                    <Textarea
                      value={editedMessage}
                      onChange={(e) => setEditedMessage(e.target.value)}
                      className="text-sm"
                      rows={4}
                    />
                    <div className="flex gap-2">
                      <Button size="sm" onClick={saveEdit} disabled={updateMessageMutation.isPending}>
                        {updateMessageMutation.isPending && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
                        Save
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => setEditingRecipient(null)}>
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="mt-2 p-2 bg-muted rounded text-sm whitespace-pre-wrap">
                    {recipient.reviewedMessage || recipient.generatedMessage || "No message"}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
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
  const [showEditPromptDialog, setShowEditPromptDialog] = useState(false);
  const [editedPrompt, setEditedPrompt] = useState(campaign.prompt);
  const [showEditTemplateDialog, setShowEditTemplateDialog] = useState(false);
  const [selectedTemplateId, setSelectedTemplateId] = useState(campaign.templateId || "");
  const [templateMode, setTemplateMode] = useState<"none" | "existing" | "new">(
    campaign.templateId ? "existing" : "none"
  );
  const [newTemplateContent, setNewTemplateContent] = useState("Hi {{1}}, {{2}}");
  const [variableMappings, setVariableMappings] = useState<VariableMapping[]>([
    { placeholder: "1", type: "recipient_name", label: "Recipient Name" },
    { placeholder: "2", type: "ai_prompt", label: "AI Message" },
  ]);

  // Extract variables from template content and sync with mappings
  const updateVariableMappings = useCallback((content: string) => {
    const matches = content.match(/\{\{(\d+)\}\}/g) || [];
    const placeholders = [...new Set(matches.map(m => m.replace(/[{}]/g, '')))].sort();
    
    setVariableMappings(prev => {
      const newMappings: VariableMapping[] = placeholders.map(p => {
        const existing = prev.find(m => m.placeholder === p);
        if (existing) return existing;
        if (p === "1") return { placeholder: p, type: "recipient_name", label: "Recipient Name" };
        if (p === "2") return { placeholder: p, type: "ai_prompt", label: "AI Message" };
        return { placeholder: p, type: "custom", label: `Variable ${p}`, customValue: "" };
      });
      return newMappings;
    });
  }, []);

  const { data: templatesData } = useQuery<MessageTemplate[]>({
    queryKey: ["/api/admin/templates"],
  });

  const approvedTemplates = useMemo(() => {
    return (templatesData || []).filter(
      (t) => t.isActive && t.twilioContentSid && t.twilioApprovalStatus === "approved"
    );
  }, [templatesData]);

  const allTemplates = templatesData || [];

  const linkedTemplate = useMemo(() => {
    if (!campaign.templateId || !templatesData) return null;
    return templatesData.find((t) => t.id === campaign.templateId);
  }, [campaign.templateId, templatesData]);

  const updateTemplateMutation = useMutation({
    mutationFn: async (data: { templateId: string | null; createNewTemplate?: boolean; templateContent?: string; variableMappings?: VariableMapping[] }) => {
      const res = await apiRequest("PATCH", `/api/blast-campaigns/${campaign.id}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/blast-campaigns"] });
      queryClient.invalidateQueries({ queryKey: ["/api/blast-campaigns", campaign.id] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/templates"] });
      toast({ title: "Template updated successfully" });
      setShowEditTemplateDialog(false);
    },
    onError: () => {
      toast({ title: "Failed to update template", variant: "destructive" });
    },
  });

  const updatePromptMutation = useMutation({
    mutationFn: async (newPrompt: string) => {
      const res = await apiRequest("PATCH", `/api/blast-campaigns/${campaign.id}`, { prompt: newPrompt });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/blast-campaigns"] });
      queryClient.invalidateQueries({ queryKey: ["/api/blast-campaigns", campaign.id] });
      toast({ title: "Prompt updated successfully" });
      setShowEditPromptDialog(false);
    },
    onError: () => {
      toast({ title: "Failed to update prompt", variant: "destructive" });
    },
  });

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
        <div className="grid gap-4 md:grid-cols-5">
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
              <CardDescription>Messages Generated</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-blue-600">
                {(campaign as any).generatedCount || 0}
                {(campaign as any).isGenerating && (
                  <Loader2 className="inline-block h-4 w-4 ml-2 animate-spin" />
                )}
              </div>
              {(campaign as any).isGenerating && (
                <p className="text-xs text-muted-foreground mt-1">Generating...</p>
              )}
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
              <CardDescription>Send Progress</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{Math.round(progress)}%</div>
              <Progress value={progress} className="mt-2 h-1" />
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2">
            <CardTitle>AI Prompt</CardTitle>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => {
                setEditedPrompt(campaign.prompt);
                setShowEditPromptDialog(true);
              }}
              data-testid="button-edit-prompt"
            >
              <Edit className="h-4 w-4" />
            </Button>
          </CardHeader>
          <CardContent>
            <p className="text-sm whitespace-pre-wrap">{campaign.prompt}</p>
          </CardContent>
        </Card>

        <Dialog open={showEditPromptDialog} onOpenChange={setShowEditPromptDialog}>
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>Edit AI Prompt</DialogTitle>
              <DialogDescription>
                Update the prompt used to generate personalized messages for this campaign.
              </DialogDescription>
            </DialogHeader>
            <div className="py-4">
              <Textarea
                value={editedPrompt}
                onChange={(e) => setEditedPrompt(e.target.value)}
                placeholder="Enter your message prompt..."
                rows={6}
                className="resize-none"
                data-testid="input-edit-prompt"
              />
              <p className="text-xs text-muted-foreground mt-2">
                Note: Updating the prompt will only affect newly generated messages, not messages already in the queue.
              </p>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowEditPromptDialog(false)}>
                Cancel
              </Button>
              <Button 
                onClick={() => updatePromptMutation.mutate(editedPrompt)}
                disabled={!editedPrompt.trim() || updatePromptMutation.isPending}
                data-testid="button-save-prompt"
              >
                {updatePromptMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Save Prompt
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2">
            <CardTitle>WhatsApp Template</CardTitle>
            {(campaign.status === "draft" || campaign.status === "paused") && (
              <Button
                variant="ghost"
                size="icon"
                onClick={() => {
                  setSelectedTemplateId(campaign.templateId || "");
                  setTemplateMode(campaign.templateId ? "existing" : "none");
                  setShowEditTemplateDialog(true);
                }}
                data-testid="button-edit-template"
              >
                <Edit className="h-4 w-4" />
              </Button>
            )}
          </CardHeader>
          <CardContent>
            {linkedTemplate ? (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{linkedTemplate.name}</span>
                  {linkedTemplate.twilioApprovalStatus && (
                    <Badge variant={linkedTemplate.twilioApprovalStatus === "approved" ? "default" : "secondary"}>
                      {linkedTemplate.twilioApprovalStatus}
                    </Badge>
                  )}
                </div>
                <p className="text-sm text-muted-foreground">{linkedTemplate.content}</p>
                {linkedTemplate.twilioApprovalStatus !== "approved" && (
                  <p className="text-xs text-amber-600">
                    Template must be approved by Twilio before the campaign can send messages.
                  </p>
                )}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                No template linked. This campaign will use Baileys (unofficial WhatsApp) to send messages.
              </p>
            )}
          </CardContent>
        </Card>

        <Dialog open={showEditTemplateDialog} onOpenChange={setShowEditTemplateDialog}>
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>Edit Template</DialogTitle>
              <DialogDescription>
                Link a WhatsApp template to this campaign for Twilio messaging.
              </DialogDescription>
            </DialogHeader>
            <div className="py-4 space-y-4">
              <div className="flex flex-col gap-2">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="editTemplateMode"
                    checked={templateMode === "none"}
                    onChange={() => { setTemplateMode("none"); setSelectedTemplateId(""); }}
                    className="w-4 h-4"
                    data-testid="radio-edit-template-none"
                  />
                  <span className="text-sm">No template (Baileys only)</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="editTemplateMode"
                    checked={templateMode === "new"}
                    onChange={() => { setTemplateMode("new"); setSelectedTemplateId(""); }}
                    className="w-4 h-4"
                    data-testid="radio-edit-template-new"
                  />
                  <span className="text-sm">Create new template for this campaign</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="editTemplateMode"
                    checked={templateMode === "existing"}
                    onChange={() => setTemplateMode("existing")}
                    className="w-4 h-4"
                    data-testid="radio-edit-template-existing"
                  />
                  <span className="text-sm">Use existing template</span>
                </label>
              </div>

              {templateMode === "existing" && (
                <Select value={selectedTemplateId} onValueChange={setSelectedTemplateId}>
                  <SelectTrigger data-testid="select-edit-template">
                    <SelectValue placeholder="Select a template..." />
                  </SelectTrigger>
                  <SelectContent>
                    {allTemplates.map((t) => (
                      <SelectItem key={t.id} value={t.id}>
                        {t.name} {t.twilioApprovalStatus && `(${t.twilioApprovalStatus})`}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}

              {templateMode === "new" && (
                <div className="space-y-3">
                  <div>
                    <Label className="text-sm">Template Content</Label>
                    <Textarea
                      value={newTemplateContent}
                      onChange={(e) => {
                        setNewTemplateContent(e.target.value);
                        updateVariableMappings(e.target.value);
                      }}
                      placeholder="Hi {{1}}, {{2}}"
                      rows={3}
                      className="mt-1"
                      data-testid="input-new-template-content"
                    />
                  </div>
                  
                  {variableMappings.length > 0 && (
                    <div className="space-y-2">
                      <Label className="text-sm">Variable Mappings</Label>
                      {variableMappings.map((mapping, index) => (
                        <div key={mapping.placeholder} className="flex items-center gap-2 p-2 rounded border bg-muted/30">
                          <span className="text-sm font-mono w-12">{`{{${mapping.placeholder}}}`}</span>
                          <Select
                            value={mapping.type}
                            onValueChange={(value: VariableMapping["type"]) => {
                              setVariableMappings(prev => prev.map((m, i) => 
                                i === index ? { ...m, type: value, customValue: value === "custom" ? "" : undefined } : m
                              ));
                            }}
                          >
                            <SelectTrigger className="flex-1" data-testid={`select-edit-var-type-${mapping.placeholder}`}>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="recipient_name">Recipient Name</SelectItem>
                              <SelectItem value="ai_prompt">AI Message</SelectItem>
                              <SelectItem value="phone_number">Phone Number</SelectItem>
                              <SelectItem value="custom">Custom Value</SelectItem>
                            </SelectContent>
                          </Select>
                          {mapping.type === "custom" && (
                            <Input
                              value={mapping.customValue || ""}
                              onChange={(e) => {
                                setVariableMappings(prev => prev.map((m, i) =>
                                  i === index ? { ...m, customValue: e.target.value } : m
                                ));
                              }}
                              placeholder="Enter value..."
                              className="flex-1"
                              data-testid={`input-edit-custom-value-${mapping.placeholder}`}
                            />
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                  
                  <div className="p-3 rounded-md bg-muted/50 border">
                    <p className="text-xs text-muted-foreground">
                      After creation, sync it to Twilio and wait for approval.
                    </p>
                  </div>
                </div>
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowEditTemplateDialog(false)}>
                Cancel
              </Button>
              <Button
                onClick={() => {
                  if (templateMode === "none") {
                    updateTemplateMutation.mutate({ templateId: null });
                  } else if (templateMode === "new") {
                    updateTemplateMutation.mutate({ 
                      templateId: null, 
                      createNewTemplate: true,
                      templateContent: newTemplateContent,
                      variableMappings: variableMappings
                    });
                  } else if (templateMode === "existing" && selectedTemplateId) {
                    updateTemplateMutation.mutate({ templateId: selectedTemplateId });
                  }
                }}
                disabled={
                  updateTemplateMutation.isPending ||
                  (templateMode === "existing" && !selectedTemplateId) ||
                  (templateMode === "new" && !newTemplateContent.trim())
                }
                data-testid="button-save-template"
              >
                {updateTemplateMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Save Template
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <MessageQueueCard 
          campaignId={campaign.id} 
          campaignStatus={campaign.status}
          queryClient={queryClient}
          toast={toast}
        />

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Recipients</CardTitle>
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Clock className="h-4 w-4" />
                <span>Interval: {Math.round((campaign.minIntervalSeconds || 0) / 60)}-{Math.round((campaign.maxIntervalSeconds || 0) / 60)} min</span>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <div className="space-y-3">
                {campaign.recipients?.map((recipient) => (
                  <div
                    key={recipient.id}
                    className="p-3 border rounded-lg"
                    data-testid={`recipient-${recipient.id}`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center shrink-0">
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
                        {recipient.status === "pending" && !recipient.generatedMessage && (
                          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                        )}
                        <Badge className={getRecipientStatusColor(recipient.status)}>
                          {recipient.status}
                        </Badge>
                      </div>
                    </div>
                    {recipient.generatedMessage && (
                      <div className="mt-3 p-3 bg-muted rounded-md">
                        <p className="text-sm text-muted-foreground mb-1">Generated Message:</p>
                        <p className="text-sm whitespace-pre-wrap">{recipient.generatedMessage}</p>
                      </div>
                    )}
                    {recipient.errorMessage && (
                      <div className="mt-2 p-2 bg-destructive/10 text-destructive text-sm rounded">
                        {recipient.errorMessage}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

    </div>
  );
}
