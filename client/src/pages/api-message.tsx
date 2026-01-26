import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { 
  Key, Plus, Copy, Trash2, RefreshCw, Pencil, Loader2, Eye, EyeOff,
  Send, Clock, CheckCircle2, XCircle, Phone, ArrowLeft, FileText
} from "lucide-react";
import { formatDateTime } from "@/lib/timezone";
import { Link } from "wouter";

interface ApiVariableMapping {
  placeholder: string;
  payloadField: string;
}

interface ApiClient {
  id: string;
  name: string;
  clientId: string;
  isActive: boolean;
  aiPrompt: string | null;
  defaultTemplateId: string | null;
  ipWhitelist: string[] | null;
  variableMappings: ApiVariableMapping[] | null;
  rateLimitPerMinute: number;
  rateLimitPerDay: number;
  createdAt: Date;
  lastRequestAt: Date | null;
  requestCountToday: number;
}

interface MessageTemplate {
  id: string;
  name: string;
  description: string | null;
  content: string;
  variables: string[] | null;
  twilioContentSid: string | null;
  twilioApprovalStatus: string | null;
  isActive: boolean;
}

interface ApiClientWithSecret extends ApiClient {
  secretKey?: string;
}

interface ApiQueueMessage {
  id: string;
  requestId: string;
  clientId: string;
  clientName: string;
  phoneNumber: string;
  recipientName: string | null;
  message: string;
  status: "queued" | "processing" | "sending" | "sent" | "failed";
  priority: number;
  errorMessage: string | null;
  scheduledAt: string | null;
  sentAt: string | null;
  createdAt: string;
}

export default function ApiMessagePage() {
  const { toast } = useToast();
  const { isAdmin } = useAuth();
  const [activeTab, setActiveTab] = useState("clients");

  return (
    <div className="flex flex-col h-full">
      <header className="flex items-center gap-3 px-4 h-14 border-b border-border bg-card shrink-0">
        <Link href="/">
          <Button variant="ghost" size="icon" data-testid="button-back">
            <ArrowLeft className="h-5 w-5" />
          </Button>
        </Link>
        <div className="flex items-center gap-2">
          <Send className="h-5 w-5 text-primary" />
          <h1 className="text-lg font-semibold">API Message</h1>
        </div>
        {!isAdmin && (
          <Badge variant="secondary" className="ml-auto">View Only</Badge>
        )}
      </header>

      <div className="flex-1 overflow-auto p-4">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
          <TabsList data-testid="api-message-tabs">
            <TabsTrigger value="clients" data-testid="tab-api-clients">
              <Key className="h-4 w-4 mr-2" />
              API Clients
            </TabsTrigger>
            <TabsTrigger value="queue" data-testid="tab-api-queue">
              <Send className="h-4 w-4 mr-2" />
              Queue
            </TabsTrigger>
            <TabsTrigger value="docs" data-testid="tab-api-docs">
              <FileText className="h-4 w-4 mr-2" />
              Documentation
            </TabsTrigger>
          </TabsList>

          <TabsContent value="clients" className="space-y-4">
            <ApiClientsTab toast={toast} isAdmin={isAdmin} />
          </TabsContent>

          <TabsContent value="queue" className="space-y-4">
            <ApiQueueTab toast={toast} isAdmin={isAdmin} />
          </TabsContent>

          <TabsContent value="docs" className="space-y-4">
            <ApiDocsTab />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

function ApiClientsTab({ toast, isAdmin }: { toast: ReturnType<typeof useToast>["toast"]; isAdmin: boolean }) {
  const queryClient = useQueryClient();
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [editingClient, setEditingClient] = useState<ApiClient | null>(null);
  const [newSecret, setNewSecret] = useState<{ clientId: string; secret: string } | null>(null);
  const [showSecret, setShowSecret] = useState(false);
  
  const [formData, setFormData] = useState({
    name: "",
    defaultTemplateId: "" as string,
    ipWhitelist: "",
    rateLimitPerMinute: 60,
    rateLimitPerDay: 1000,
    isActive: true,
    variableMappings: [] as ApiVariableMapping[],
  });

  // Use admin route for admins, read-only route for regular users
  const { data: apiClients = [], isLoading } = useQuery<ApiClient[]>({
    queryKey: [isAdmin ? "/api/admin/api-clients" : "/api/api-clients"],
  });

  // Fetch templates for the selector (admin only)
  const { data: templates = [] } = useQuery<MessageTemplate[]>({
    queryKey: ["/api/admin/templates"],
    enabled: isAdmin,
  });

  const createMutation = useMutation({
    mutationFn: async (data: { name: string; defaultTemplateId?: string; ipWhitelist?: string[]; variableMappings?: ApiVariableMapping[]; rateLimitPerMinute?: number; rateLimitPerDay?: number }) => {
      const res = await apiRequest("POST", "/api/admin/api-clients", data);
      return res.json();
    },
    onSuccess: (data: ApiClientWithSecret) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/api-clients"] });
      setShowCreateDialog(false);
      setNewSecret({ clientId: data.clientId, secret: data.secretKey || "" });
      setFormData({ name: "", defaultTemplateId: "", ipWhitelist: "", rateLimitPerMinute: 60, rateLimitPerDay: 1000, isActive: true, variableMappings: [] });
      toast({ title: "API client created successfully" });
    },
    onError: () => {
      toast({ title: "Failed to create API client", variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, ...data }: { id: string; name?: string; defaultTemplateId?: string | null; ipWhitelist?: string[] | null; variableMappings?: ApiVariableMapping[] | null; rateLimitPerMinute?: number; rateLimitPerDay?: number; isActive?: boolean }) => {
      const res = await apiRequest("PATCH", `/api/admin/api-clients/${id}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/api-clients"] });
      setEditingClient(null);
      toast({ title: "API client updated" });
    },
    onError: () => {
      toast({ title: "Failed to update API client", variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("DELETE", `/api/admin/api-clients/${id}`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/api-clients"] });
      toast({ title: "API client deleted" });
    },
    onError: () => {
      toast({ title: "Failed to delete API client", variant: "destructive" });
    },
  });

  const regenerateMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("POST", `/api/admin/api-clients/${id}/regenerate-secret`);
      return res.json();
    },
    onSuccess: (data: { clientId: string; secretKey: string }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/api-clients"] });
      setNewSecret({ clientId: data.clientId, secret: data.secretKey });
      toast({ title: "API secret regenerated" });
    },
    onError: () => {
      toast({ title: "Failed to regenerate secret", variant: "destructive" });
    },
  });

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    toast({ title: `${label} copied to clipboard` });
  };

  const handleCreate = () => {
    const ipWhitelist = formData.ipWhitelist.trim()
      ? formData.ipWhitelist.split(",").map(ip => ip.trim()).filter(ip => ip)
      : undefined;
    createMutation.mutate({
      name: formData.name,
      defaultTemplateId: formData.defaultTemplateId && formData.defaultTemplateId !== 'none' ? formData.defaultTemplateId : undefined,
      ipWhitelist,
      variableMappings: formData.variableMappings.length > 0 ? formData.variableMappings : undefined,
      rateLimitPerMinute: formData.rateLimitPerMinute,
      rateLimitPerDay: formData.rateLimitPerDay,
    });
  };

  const handleUpdate = () => {
    if (!editingClient) return;
    const ipWhitelist = formData.ipWhitelist.trim()
      ? formData.ipWhitelist.split(",").map(ip => ip.trim()).filter(ip => ip)
      : null;
    updateMutation.mutate({
      id: editingClient.id,
      name: formData.name,
      defaultTemplateId: formData.defaultTemplateId && formData.defaultTemplateId !== 'none' ? formData.defaultTemplateId : null,
      ipWhitelist,
      variableMappings: formData.variableMappings.length > 0 ? formData.variableMappings : null,
      rateLimitPerMinute: formData.rateLimitPerMinute,
      rateLimitPerDay: formData.rateLimitPerDay,
      isActive: formData.isActive,
    });
  };

  // Extract template placeholders from template content (e.g., {{1}}, {{2}})
  const getTemplatePlaceholders = (templateId: string): string[] => {
    const template = templates.find(t => t.id === templateId);
    if (!template) return [];
    const matches = template.content.match(/\{\{(\d+)\}\}/g) || [];
    return [...new Set(matches.map(m => m.replace(/[{}]/g, '')))].sort((a, b) => parseInt(a) - parseInt(b));
  };

  // Update variable mapping for a placeholder
  const updateVariableMapping = (placeholder: string, payloadField: string) => {
    setFormData(prev => {
      const existingIndex = prev.variableMappings.findIndex(m => m.placeholder === placeholder);
      const newMappings = [...prev.variableMappings];
      if (payloadField === "") {
        // Remove mapping if empty
        if (existingIndex >= 0) {
          newMappings.splice(existingIndex, 1);
        }
      } else if (existingIndex >= 0) {
        newMappings[existingIndex] = { placeholder, payloadField };
      } else {
        newMappings.push({ placeholder, payloadField });
      }
      return { ...prev, variableMappings: newMappings };
    });
  };

  // Get mapping for a specific placeholder
  const getMappingForPlaceholder = (placeholder: string): string => {
    const mapping = formData.variableMappings.find(m => m.placeholder === placeholder);
    return mapping?.payloadField || "";
  };

  const openEditDialog = (client: ApiClient) => {
    setFormData({
      name: client.name,
      defaultTemplateId: client.defaultTemplateId || "",
      ipWhitelist: client.ipWhitelist?.join(", ") || "",
      rateLimitPerMinute: client.rateLimitPerMinute,
      rateLimitPerDay: client.rateLimitPerDay,
      isActive: client.isActive,
      variableMappings: client.variableMappings || [],
    });
    setEditingClient(client);
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div>
              <CardTitle>External API Clients</CardTitle>
              <CardDescription>Manage API keys for external applications to send WhatsApp messages through OmniDesk</CardDescription>
            </div>
            {isAdmin && (
            <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
              <DialogTrigger asChild>
                <Button data-testid="button-create-api-client">
                  <Plus className="h-4 w-4 mr-2" />
                  Create API Client
                </Button>
              </DialogTrigger>
              <DialogContent className="max-h-[90vh] flex flex-col overflow-hidden">
                <DialogHeader className="shrink-0">
                  <DialogTitle>Create API Client</DialogTitle>
                  <DialogDescription>Create a new API client for external applications</DialogDescription>
                </DialogHeader>
                <ScrollArea className="flex-1 min-h-0 pr-4">
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="name">Client Name *</Label>
                    <Input
                      id="name"
                      placeholder="e.g. My CRM System"
                      value={formData.name}
                      onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                      data-testid="input-api-client-name"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="defaultTemplate">Message Template *</Label>
                    <Select
                      value={formData.defaultTemplateId || "none"}
                      onValueChange={(value) => setFormData({ ...formData, defaultTemplateId: value === "none" ? "" : value })}
                    >
                      <SelectTrigger data-testid="select-api-default-template">
                        <SelectValue placeholder="Select a template..." />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">No template (use 4-tier selection)</SelectItem>
                        {templates
                          .filter(t => t.isActive && t.twilioContentSid)
                          .map(template => (
                            <SelectItem key={template.id} value={template.id}>
                              <div className="flex items-center gap-2">
                                <span>{template.name}</span>
                                {template.twilioApprovalStatus === "approved" ? (
                                  <Badge variant="outline" className="text-xs bg-green-500/10 text-green-600">Approved</Badge>
                                ) : (
                                  <Badge variant="outline" className="text-xs bg-yellow-500/10 text-yellow-600">Pending</Badge>
                                )}
                              </div>
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                    {formData.defaultTemplateId && formData.defaultTemplateId !== 'none' && (
                      <details className="mt-2">
                        <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground">Show template preview</summary>
                        <div className="mt-2 p-3 bg-muted rounded-md max-h-[120px] overflow-y-auto">
                          <pre className="text-sm whitespace-pre-wrap font-mono">
                            {templates.find(t => t.id === formData.defaultTemplateId)?.content || 'Template not found'}
                          </pre>
                        </div>
                      </details>
                    )}
                    <p className="text-xs text-muted-foreground">Variables: {templates.find(t => t.id === formData.defaultTemplateId)?.variables?.join(', ') || 'None'}</p>
                  </div>
                  
                  {/* Variable Mapping Section for Create */}
                  {formData.defaultTemplateId && formData.defaultTemplateId !== 'none' && getTemplatePlaceholders(formData.defaultTemplateId).length > 0 && (
                    <div className="space-y-3">
                      <Label className="text-sm font-medium">Variable Mappings</Label>
                      <p className="text-xs text-muted-foreground">
                        Map each template variable to an API payload field.
                      </p>
                      <div className="space-y-2">
                        {getTemplatePlaceholders(formData.defaultTemplateId).map(placeholder => (
                          <div key={placeholder} className="flex items-center gap-2 p-2 rounded border bg-muted/30">
                            <span className="text-sm font-mono w-12">{`{{${placeholder}}}`}</span>
                            <Select
                              value={getMappingForPlaceholder(placeholder) || "recipient_name"}
                              onValueChange={(value) => updateVariableMapping(placeholder, value)}
                            >
                              <SelectTrigger className="flex-1" data-testid={`select-create-var-${placeholder}`}>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="recipient_name">Recipient Name</SelectItem>
                                <SelectItem value="message_type">Message Type</SelectItem>
                                <SelectItem value="invoice_number">Invoice Number</SelectItem>
                                <SelectItem value="grand_total">Grand Total (Rp)</SelectItem>
                                <SelectItem value="invoice_url">Invoice URL / Message</SelectItem>
                                <SelectItem value="phone_number">Phone Number</SelectItem>
                                <SelectItem value="due_date">Due Date</SelectItem>
                                <SelectItem value="company_name">Company Name</SelectItem>
                                <SelectItem value="custom_1">Custom Field 1</SelectItem>
                                <SelectItem value="custom_2">Custom Field 2</SelectItem>
                                <SelectItem value="custom_3">Custom Field 3</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                        ))}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        API payload must include these fields. Example: {`"recipient_name": "John"`}
                      </p>
                    </div>
                  )}

                  <div className="space-y-2">
                    <Label htmlFor="ipWhitelist">Allowed IP Addresses (comma-separated)</Label>
                    <Input
                      id="ipWhitelist"
                      placeholder="e.g. 192.168.1.1, 10.0.0.1"
                      value={formData.ipWhitelist}
                      onChange={(e) => setFormData({ ...formData, ipWhitelist: e.target.value })}
                      data-testid="input-api-allowed-ips"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="rateLimitPerMinute">Rate Limit (per minute)</Label>
                      <Input
                        id="rateLimitPerMinute"
                        type="number"
                        min={1}
                        value={formData.rateLimitPerMinute}
                        onChange={(e) => setFormData({ ...formData, rateLimitPerMinute: parseInt(e.target.value) || 60 })}
                        data-testid="input-api-rate-limit"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="rateLimitPerDay">Daily Limit</Label>
                      <Input
                        id="rateLimitPerDay"
                        type="number"
                        min={1}
                        value={formData.rateLimitPerDay}
                        onChange={(e) => setFormData({ ...formData, rateLimitPerDay: parseInt(e.target.value) || 1000 })}
                        data-testid="input-api-daily-limit"
                      />
                    </div>
                  </div>
                </div>
                </ScrollArea>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setShowCreateDialog(false)}>Cancel</Button>
                  <Button onClick={handleCreate} disabled={createMutation.isPending || !formData.name.trim()} data-testid="button-confirm-create-api-client">
                    {createMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                    Create
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : apiClients.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Key className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>No API clients configured</p>
              <p className="text-sm">Create an API client to allow external applications to send messages</p>
            </div>
          ) : (
            <div className="space-y-4">
              {apiClients.map((client) => (
                <Card key={client.id} className={!client.isActive ? "opacity-60" : ""}>
                  <CardContent className="pt-4">
                    <div className="flex items-start justify-between gap-4 flex-wrap">
                      <div className="space-y-2 flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h3 className="font-semibold">{client.name}</h3>
                          {client.isActive ? (
                            <Badge variant="default" className="bg-green-600">Active</Badge>
                          ) : (
                            <Badge variant="secondary">Inactive</Badge>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          <code className="text-xs bg-muted px-2 py-1 rounded font-mono">{client.clientId}</code>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6"
                            onClick={() => copyToClipboard(client.clientId, "Client ID")}
                            data-testid={`button-copy-client-id-${client.id}`}
                          >
                            <Copy className="h-3 w-3" />
                          </Button>
                        </div>
                        <div className="text-xs text-muted-foreground space-y-1">
                          <p>Rate limit: {client.rateLimitPerMinute}/min | Daily: {client.rateLimitPerDay}</p>
                          <p>Today: {client.requestCountToday} requests</p>
                          {client.defaultTemplateId && (
                            <p className="flex items-center gap-1">
                              <FileText className="h-3 w-3" />
                              Template: {templates.find(t => t.id === client.defaultTemplateId)?.name || 'Unknown'}
                            </p>
                          )}
                          {client.ipWhitelist && client.ipWhitelist.length > 0 && (
                            <p>Allowed IPs: {client.ipWhitelist.join(", ")}</p>
                          )}
                          {client.lastRequestAt && (
                            <p>Last used: {formatDateTime(client.lastRequestAt)}</p>
                          )}
                        </div>
                      </div>
                      {isAdmin && (
                        <div className="flex items-center gap-2 flex-wrap">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              if (confirm("Regenerating the secret will invalidate the current one. Continue?")) {
                                regenerateMutation.mutate(client.id);
                              }
                            }}
                            disabled={regenerateMutation.isPending}
                            data-testid={`button-regenerate-secret-${client.id}`}
                          >
                            <RefreshCw className="h-4 w-4 mr-1" />
                            Regenerate Secret
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => openEditDialog(client)}
                            data-testid={`button-edit-api-client-${client.id}`}
                          >
                            <Pencil className="h-4 w-4 mr-1" />
                            Edit
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              if (confirm(`Delete API client "${client.name}"?`)) {
                                deleteMutation.mutate(client.id);
                              }
                            }}
                            disabled={deleteMutation.isPending}
                            data-testid={`button-delete-api-client-${client.id}`}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!editingClient} onOpenChange={(open) => !open && setEditingClient(null)}>
        <DialogContent className="max-h-[90vh] flex flex-col overflow-hidden">
          <DialogHeader className="shrink-0">
            <DialogTitle>Edit API Client</DialogTitle>
            <DialogDescription>Update API client settings</DialogDescription>
          </DialogHeader>
          <ScrollArea className="flex-1 min-h-0 pr-4">
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="edit-name">Client Name *</Label>
              <Input
                id="edit-name"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                data-testid="input-edit-api-client-name"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-defaultTemplate">Message Template *</Label>
              <Select
                value={formData.defaultTemplateId || "none"}
                onValueChange={(value) => {
                  const newTemplateId = value === "none" ? "" : value;
                  // When template changes, filter variable mappings to only include placeholders that exist in the new template
                  const newPlaceholders = newTemplateId ? getTemplatePlaceholders(newTemplateId) : [];
                  const filteredMappings = formData.variableMappings.filter(m => 
                    newPlaceholders.includes(m.placeholder)
                  );
                  setFormData({ 
                    ...formData, 
                    defaultTemplateId: newTemplateId,
                    variableMappings: filteredMappings
                  });
                }}
              >
                <SelectTrigger data-testid="select-edit-api-default-template">
                  <SelectValue placeholder="Select a template..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No template (use 4-tier selection)</SelectItem>
                  {templates
                    .filter(t => t.isActive && t.twilioContentSid)
                    .map(template => (
                      <SelectItem key={template.id} value={template.id}>
                        <div className="flex items-center gap-2">
                          <span>{template.name}</span>
                          {template.twilioApprovalStatus === "approved" ? (
                            <Badge variant="outline" className="text-xs bg-green-500/10 text-green-600">Approved</Badge>
                          ) : (
                            <Badge variant="outline" className="text-xs bg-yellow-500/10 text-yellow-600">Pending</Badge>
                          )}
                        </div>
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
              {formData.defaultTemplateId && formData.defaultTemplateId !== 'none' && (
                <details className="mt-2">
                  <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground">Show template preview</summary>
                  <div className="mt-2 p-3 bg-muted rounded-md max-h-[120px] overflow-y-auto">
                    <pre className="text-sm whitespace-pre-wrap font-mono">
                      {templates.find(t => t.id === formData.defaultTemplateId)?.content || 'Template not found'}
                    </pre>
                  </div>
                </details>
              )}
              <p className="text-xs text-muted-foreground">Variables: {templates.find(t => t.id === formData.defaultTemplateId)?.variables?.join(', ') || 'None'}</p>
            </div>
            
            {/* Variable Mapping Section */}
            {formData.defaultTemplateId && formData.defaultTemplateId !== 'none' && getTemplatePlaceholders(formData.defaultTemplateId).length > 0 && (
              <div className="space-y-3">
                <Label className="text-sm font-medium">Variable Mappings</Label>
                <p className="text-xs text-muted-foreground">
                  Map each template variable to an API payload field.
                </p>
                <div className="space-y-2">
                  {getTemplatePlaceholders(formData.defaultTemplateId).map(placeholder => (
                    <div key={placeholder} className="flex items-center gap-2 p-2 rounded border bg-muted/30">
                      <span className="text-sm font-mono w-12">{`{{${placeholder}}}`}</span>
                      <Select
                        value={getMappingForPlaceholder(placeholder) || "recipient_name"}
                        onValueChange={(value) => updateVariableMapping(placeholder, value)}
                      >
                        <SelectTrigger className="flex-1" data-testid={`select-edit-var-${placeholder}`}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="recipient_name">Recipient Name</SelectItem>
                          <SelectItem value="message_type">Message Type</SelectItem>
                          <SelectItem value="invoice_number">Invoice Number</SelectItem>
                          <SelectItem value="grand_total">Grand Total (Rp)</SelectItem>
                          <SelectItem value="invoice_url">Invoice URL / Message</SelectItem>
                          <SelectItem value="phone_number">Phone Number</SelectItem>
                          <SelectItem value="due_date">Due Date</SelectItem>
                          <SelectItem value="company_name">Company Name</SelectItem>
                          <SelectItem value="custom_1">Custom Field 1</SelectItem>
                          <SelectItem value="custom_2">Custom Field 2</SelectItem>
                          <SelectItem value="custom_3">Custom Field 3</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">
                  API payload must include these fields. Example: {`"recipient_name": "John"`}
                </p>
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="edit-ipWhitelist">Allowed IP Addresses</Label>
              <Input
                id="edit-ipWhitelist"
                value={formData.ipWhitelist}
                onChange={(e) => setFormData({ ...formData, ipWhitelist: e.target.value })}
                data-testid="input-edit-api-allowed-ips"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="edit-rateLimitPerMinute">Rate Limit (per minute)</Label>
                <Input
                  id="edit-rateLimitPerMinute"
                  type="number"
                  min={1}
                  value={formData.rateLimitPerMinute}
                  onChange={(e) => setFormData({ ...formData, rateLimitPerMinute: parseInt(e.target.value) || 60 })}
                  data-testid="input-edit-api-rate-limit"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-rateLimitPerDay">Daily Limit</Label>
                <Input
                  id="edit-rateLimitPerDay"
                  type="number"
                  min={1}
                  value={formData.rateLimitPerDay}
                  onChange={(e) => setFormData({ ...formData, rateLimitPerDay: parseInt(e.target.value) || 1000 })}
                  data-testid="input-edit-api-daily-limit"
                />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Switch
                id="edit-isActive"
                checked={formData.isActive}
                onCheckedChange={(checked) => setFormData({ ...formData, isActive: checked })}
                data-testid="switch-edit-api-active"
              />
              <Label htmlFor="edit-isActive">Active</Label>
            </div>
          </div>
          </ScrollArea>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingClient(null)}>Cancel</Button>
            <Button onClick={handleUpdate} disabled={updateMutation.isPending || !formData.name.trim()} data-testid="button-confirm-edit-api-client">
              {updateMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
              Save Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!newSecret} onOpenChange={(open) => { if (!open) { setNewSecret(null); setShowSecret(false); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>API Credentials</DialogTitle>
            <DialogDescription>Save these credentials securely. The secret key will only be shown once.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Client ID</Label>
              <div className="flex items-center gap-2">
                <code className="flex-1 bg-muted px-3 py-2 rounded text-sm font-mono">{newSecret?.clientId}</code>
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => copyToClipboard(newSecret?.clientId || "", "Client ID")}
                  data-testid="button-copy-new-client-id"
                >
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
            </div>
            <div className="space-y-2">
              <Label>Secret Key</Label>
              <div className="flex items-center gap-2">
                <code className="flex-1 bg-muted px-3 py-2 rounded text-sm font-mono overflow-hidden">
                  {showSecret ? newSecret?.secret : "••••••••••••••••••••••••"}
                </code>
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => setShowSecret(!showSecret)}
                  data-testid="button-toggle-secret-visibility"
                >
                  {showSecret ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => copyToClipboard(newSecret?.secret || "", "Secret Key")}
                  data-testid="button-copy-new-secret"
                >
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
            </div>
            <div className="p-3 bg-yellow-500/10 border border-yellow-500/20 rounded-md">
              <p className="text-sm text-yellow-600 dark:text-yellow-500">
                Store the secret key securely. It cannot be retrieved after closing this dialog.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button onClick={() => { setNewSecret(null); setShowSecret(false); }} data-testid="button-close-credentials">
              I've saved these credentials
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ApiQueueTab({ toast, isAdmin }: { toast: ReturnType<typeof useToast>["toast"]; isAdmin: boolean }) {
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [expandedMessage, setExpandedMessage] = useState<string | null>(null);

  // Use admin route for admins, read-only route for regular users
  const { data: messages = [], isLoading, refetch } = useQuery<ApiQueueMessage[]>({
    queryKey: [isAdmin ? "/api/admin/api-message-queue" : "/api/api-queue"],
    refetchInterval: 10000,
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("DELETE", `/api/admin/api-message-queue/${id}`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/api-message-queue"] });
      toast({ title: "Message cancelled" });
    },
    onError: () => {
      toast({ title: "Failed to cancel message", variant: "destructive" });
    },
  });

  const resendMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("POST", `/api/admin/api-message-queue/${id}/resend`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/api-message-queue"] });
      toast({ title: "Message queued for resend" });
    },
    onError: () => {
      toast({ title: "Failed to resend message", variant: "destructive" });
    },
  });

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "queued":
        return <Badge variant="secondary"><Clock className="h-3 w-3 mr-1" />Queued</Badge>;
      case "processing":
        return <Badge className="bg-blue-500"><Loader2 className="h-3 w-3 mr-1 animate-spin" />Processing</Badge>;
      case "sending":
        return <Badge className="bg-yellow-500"><Send className="h-3 w-3 mr-1" />Sending</Badge>;
      case "sent":
        return <Badge className="bg-green-500"><CheckCircle2 className="h-3 w-3 mr-1" />Sent</Badge>;
      case "failed":
        return <Badge variant="destructive"><XCircle className="h-3 w-3 mr-1" />Failed</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  const filteredMessages = statusFilter === "all" 
    ? messages 
    : messages.filter(m => m.status === statusFilter);

  const counts = {
    all: messages.length,
    queued: messages.filter(m => m.status === "queued").length,
    processing: messages.filter(m => m.status === "processing").length,
    sending: messages.filter(m => m.status === "sending").length,
    sent: messages.filter(m => m.status === "sent").length,
    failed: messages.filter(m => m.status === "failed").length,
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2">
          <div>
            <CardTitle>API Message Queue</CardTitle>
            <CardDescription>Messages sent via external API awaiting delivery</CardDescription>
          </div>
          <Button variant="outline" size="icon" onClick={() => refetch()} data-testid="button-refresh-queue">
            <RefreshCw className="h-4 w-4" />
          </Button>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2 mb-4">
            <Button 
              variant={statusFilter === "all" ? "default" : "outline"} 
              size="sm" 
              onClick={() => setStatusFilter("all")}
              data-testid="filter-all"
            >
              All ({counts.all})
            </Button>
            <Button 
              variant={statusFilter === "queued" ? "default" : "outline"} 
              size="sm" 
              onClick={() => setStatusFilter("queued")}
              data-testid="filter-queued"
            >
              Queued ({counts.queued})
            </Button>
            <Button 
              variant={statusFilter === "processing" ? "default" : "outline"} 
              size="sm" 
              onClick={() => setStatusFilter("processing")}
              data-testid="filter-processing"
            >
              Processing ({counts.processing})
            </Button>
            <Button 
              variant={statusFilter === "sending" ? "default" : "outline"} 
              size="sm" 
              onClick={() => setStatusFilter("sending")}
              data-testid="filter-sending"
            >
              Sending ({counts.sending})
            </Button>
            <Button 
              variant={statusFilter === "sent" ? "default" : "outline"} 
              size="sm" 
              onClick={() => setStatusFilter("sent")}
              data-testid="filter-sent"
            >
              Sent ({counts.sent})
            </Button>
            <Button 
              variant={statusFilter === "failed" ? "default" : "outline"} 
              size="sm" 
              onClick={() => setStatusFilter("failed")}
              data-testid="filter-failed"
            >
              Failed ({counts.failed})
            </Button>
          </div>

          {isLoading ? (
            <div className="flex items-center justify-center h-32">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : filteredMessages.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Send className="h-12 w-12 mx-auto mb-2 opacity-50" />
              <p>No messages in queue</p>
            </div>
          ) : (
            <ScrollArea className="h-[500px]">
              <div className="space-y-2">
                {filteredMessages.map((msg) => (
                  <Card 
                    key={msg.id} 
                    className="cursor-pointer hover-elevate"
                    onClick={() => setExpandedMessage(expandedMessage === msg.id ? null : msg.id)}
                    data-testid={`queue-message-${msg.id}`}
                  >
                    <CardContent className="p-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <Phone className="h-4 w-4 text-muted-foreground" />
                            <span className="font-medium">{msg.phoneNumber}</span>
                            {msg.recipientName && (
                              <span className="text-muted-foreground">({msg.recipientName})</span>
                            )}
                          </div>
                          <div className="flex items-center gap-2 text-xs text-muted-foreground mb-2">
                            <span>Client: {msg.clientName}</span>
                            <span>-</span>
                            <span>{formatDateTime(msg.createdAt)}</span>
                            {msg.scheduledAt && (
                              <>
                                <span>-</span>
                                <span>Scheduled: {formatDateTime(msg.scheduledAt)}</span>
                              </>
                            )}
                          </div>
                          <p className={`text-sm ${expandedMessage === msg.id ? "" : "line-clamp-2"}`}>
                            {msg.message}
                          </p>
                          {msg.status === "failed" && msg.errorMessage && (
                            <p className="text-sm text-destructive mt-1">{msg.errorMessage}</p>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          {getStatusBadge(msg.status)}
                          {isAdmin && msg.status === "failed" && (
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={(e) => {
                                e.stopPropagation();
                                resendMutation.mutate(msg.id);
                              }}
                              disabled={resendMutation.isPending}
                              title="Resend message"
                              data-testid={`button-resend-${msg.id}`}
                            >
                              {resendMutation.isPending ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <RefreshCw className="h-4 w-4 text-primary" />
                              )}
                            </Button>
                          )}
                          {isAdmin && (msg.status === "queued" || msg.status === "failed") && (
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={(e) => {
                                e.stopPropagation();
                                deleteMutation.mutate(msg.id);
                              }}
                              disabled={deleteMutation.isPending}
                              title="Delete message"
                              data-testid={`button-delete-${msg.id}`}
                            >
                              {deleteMutation.isPending ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <Trash2 className="h-4 w-4 text-destructive" />
                              )}
                            </Button>
                          )}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </ScrollArea>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function ApiDocsTab() {
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>API Documentation</CardTitle>
          <CardDescription>How to integrate with OmniDesk API using static numbered variables</CardDescription>
        </CardHeader>
        <CardContent className="text-sm space-y-4">
          <div>
            <p className="font-medium mb-2">Authentication:</p>
            <p className="text-muted-foreground mb-2">All requests must include HMAC signature headers:</p>
            <ul className="list-disc list-inside text-muted-foreground space-y-1 ml-2">
              <li><code className="bg-muted px-1 rounded">X-Client-Id</code>: Your client ID</li>
              <li><code className="bg-muted px-1 rounded">X-Timestamp</code>: Unix timestamp in milliseconds</li>
              <li><code className="bg-muted px-1 rounded">X-Signature</code>: HMAC-SHA256 signature (hex)</li>
            </ul>
            <div className="mt-3 p-2 bg-muted rounded text-xs">
              <p className="font-medium mb-1">Signature Calculation:</p>
              <code>message = clientId + "." + timestamp + "." + requestBody</code><br/>
              <code>signature = HMAC-SHA256(message, secretKey).toHex()</code>
              <p className="mt-2 text-muted-foreground">Note: For POST requests, sign the exact raw JSON body you send.</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="border-primary/50">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Badge variant="default">Recommended</Badge>
            Static Variable Mapping
          </CardTitle>
          <CardDescription>
            Use numbered metadata keys "1" through "10" that map directly to WhatsApp template placeholders
          </CardDescription>
        </CardHeader>
        <CardContent className="text-sm space-y-4">
          <div>
            <p className="font-medium mb-2">Minimum Payload (Only phone_number required):</p>
            <code className="block bg-muted p-2 rounded text-xs">POST /api/external/messages</code>
            <pre className="bg-muted p-2 rounded text-xs mt-2 overflow-x-auto">{`{
  "phone_number": "628123456789",
  "metadata": {
    "1": "Customer Name",
    "2": "INV-001234",
    "3": "150.000",
    "4": "https://invoice.example.com/inv/xxx",
    "5": "Bapak/Ibu"
  }
}`}</pre>
          </div>
          
          <div className="p-3 bg-primary/5 rounded-lg border border-primary/20">
            <p className="font-medium mb-2">Variable Mapping Reference:</p>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="space-y-1">
                <div><code className="bg-muted px-1 rounded">"1"</code> maps to <code className="bg-muted px-1 rounded">{"{{1}}"}</code></div>
                <div><code className="bg-muted px-1 rounded">"2"</code> maps to <code className="bg-muted px-1 rounded">{"{{2}}"}</code></div>
                <div><code className="bg-muted px-1 rounded">"3"</code> maps to <code className="bg-muted px-1 rounded">{"{{3}}"}</code></div>
                <div><code className="bg-muted px-1 rounded">"4"</code> maps to <code className="bg-muted px-1 rounded">{"{{4}}"}</code></div>
                <div><code className="bg-muted px-1 rounded">"5"</code> maps to <code className="bg-muted px-1 rounded">{"{{5}}"}</code></div>
              </div>
              <div className="space-y-1">
                <div><code className="bg-muted px-1 rounded">"6"</code> maps to <code className="bg-muted px-1 rounded">{"{{6}}"}</code></div>
                <div><code className="bg-muted px-1 rounded">"7"</code> maps to <code className="bg-muted px-1 rounded">{"{{7}}"}</code></div>
                <div><code className="bg-muted px-1 rounded">"8"</code> maps to <code className="bg-muted px-1 rounded">{"{{8}}"}</code></div>
                <div><code className="bg-muted px-1 rounded">"9"</code> maps to <code className="bg-muted px-1 rounded">{"{{9}}"}</code></div>
                <div><code className="bg-muted px-1 rounded">"10"</code> maps to <code className="bg-muted px-1 rounded">{"{{10}}"}</code></div>
              </div>
            </div>
          </div>

          <div className="mt-2 text-xs text-muted-foreground">
            <p className="font-medium">Simplified Fields:</p>
            <ul className="list-disc list-inside ml-2 space-y-1">
              <li><code className="bg-muted px-1 rounded">phone_number</code>: <strong>Required</strong> - WhatsApp number (without +)</li>
              <li><code className="bg-muted px-1 rounded">metadata</code>: Object with numbered keys "1" to "10" for template variables</li>
              <li><code className="bg-muted px-1 rounded">request_id</code>: Optional - auto-generated if not provided</li>
              <li><code className="bg-muted px-1 rounded">recipient_name</code>: Optional - use metadata."1" instead</li>
              <li><code className="bg-muted px-1 rounded">message</code>: Optional - not needed when using templates</li>
              <li><code className="bg-muted px-1 rounded">priority</code>: Optional (0-10, higher = sooner)</li>
              <li><code className="bg-muted px-1 rounded">scheduled_at</code>: Optional ISO datetime</li>
            </ul>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Example: Invoice Notification</CardTitle>
          <CardDescription>Real-world example for sending invoice notifications</CardDescription>
        </CardHeader>
        <CardContent className="text-sm space-y-4">
          <div>
            <p className="font-medium mb-2">Template Format (in WhatsApp):</p>
            <pre className="bg-muted p-2 rounded text-xs overflow-x-auto">{`Halo {{1}},

{{5}} tagihan internet Anda:
No. Invoice: {{2}}
Total: Rp {{3}}

Klik untuk bayar: {{4}}

Terima kasih.`}</pre>
          </div>
          
          <div>
            <p className="font-medium mb-2">API Payload:</p>
            <pre className="bg-muted p-2 rounded text-xs overflow-x-auto">{`{
  "phone_number": "6285156815391",
  "metadata": {
    "1": "Ahmad Wijaya",
    "2": "INV260125001",
    "3": "250.000",
    "4": "https://invoice.maxnetplus.id/inv/abc123",
    "5": "Berikut"
  }
}`}</pre>
          </div>

          <div>
            <p className="font-medium mb-2">Result Message:</p>
            <pre className="bg-muted p-2 rounded text-xs overflow-x-auto">{`Halo Ahmad Wijaya,

Berikut tagihan internet Anda:
No. Invoice: INV260125001
Total: Rp 250.000

Klik untuk bayar: https://invoice.maxnetplus.id/inv/abc123

Terima kasih.`}</pre>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Batch Messages</CardTitle>
          <CardDescription>Send multiple messages in a single request</CardDescription>
        </CardHeader>
        <CardContent className="text-sm space-y-4">
          <div>
            <code className="block bg-muted p-2 rounded text-xs">POST /api/external/messages/batch</code>
            <pre className="bg-muted p-2 rounded text-xs mt-2 overflow-x-auto">{`{
  "messages": [
    {
      "phone_number": "628123456789",
      "metadata": { "1": "Customer A", "2": "INV-001", "3": "100.000" }
    },
    {
      "phone_number": "628987654321",
      "metadata": { "1": "Customer B", "2": "INV-002", "3": "200.000" }
    }
  ]
}`}</pre>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Rate Limiting & Sending Hours</CardTitle>
        </CardHeader>
        <CardContent className="text-sm">
          <ul className="list-disc list-inside text-muted-foreground space-y-1 ml-2">
            <li>Per-minute and daily limits configured per API client</li>
            <li>Response headers include remaining quota</li>
            <li>Messages are queued and sent with 1-5 minute delays</li>
            <li>Sending hours: 7 AM - 9 PM (Jakarta time, GMT+7)</li>
            <li>Messages outside these hours are held until 7 AM next day</li>
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
