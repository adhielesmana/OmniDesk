import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { AppSidebar } from "@/components/app-sidebar";
import { SidebarProvider, SidebarInset, SidebarTrigger } from "@/components/ui/sidebar";
import { ThemeToggle } from "@/components/theme-toggle";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { FileText, Plus, Edit, Trash2, Copy, Code, BookOpen, Loader2, Download, Upload, RefreshCw, CloudUpload, CheckCircle2, XCircle, Clock } from "lucide-react";
import type { Platform, MessageTemplate } from "@shared/schema";

export default function TemplatesPage() {
  const [selectedPlatform, setSelectedPlatform] = useState<Platform | "all">("all");
  const [editingTemplate, setEditingTemplate] = useState<MessageTemplate | null>(null);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [importData, setImportData] = useState("");
  const [overwriteExisting, setOverwriteExisting] = useState(false);
  const { toast } = useToast();

  const handleExport = async () => {
    try {
      const response = await fetch("/api/admin/templates/export", { credentials: "include" });
      const data = await response.json();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `templates-export-${new Date().toISOString().split('T')[0]}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast({ title: "Templates exported successfully" });
    } catch (error) {
      toast({ title: "Failed to export templates", variant: "destructive" });
    }
  };

  const importMutation = useMutation({
    mutationFn: async ({ templates, overwrite }: { templates: unknown[]; overwrite: boolean }) => {
      const res = await apiRequest("POST", "/api/admin/templates/import", { templates, overwrite });
      return res.json() as Promise<{ imported: number; updated: number; skipped: number; errors: string[] }>;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/templates"] });
      setIsImportOpen(false);
      setImportData("");
      const msg = [];
      if (data.imported > 0) msg.push(`${data.imported} imported`);
      if (data.updated > 0) msg.push(`${data.updated} updated`);
      if (data.skipped > 0) msg.push(`${data.skipped} skipped`);
      toast({ title: `Import complete: ${msg.join(", ")}` });
    },
    onError: () => {
      toast({ title: "Failed to import templates", variant: "destructive" });
    },
  });

  const handleImport = () => {
    try {
      const parsed = JSON.parse(importData);
      const templates = parsed.templates || parsed;
      if (!Array.isArray(templates)) {
        toast({ title: "Invalid format: expected templates array", variant: "destructive" });
        return;
      }
      importMutation.mutate({ templates, overwrite: overwriteExisting });
    } catch {
      toast({ title: "Invalid JSON format", variant: "destructive" });
    }
  };

  const { data: templates = [], isLoading } = useQuery<MessageTemplate[]>({
    queryKey: ["/api/admin/templates"],
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, ...data }: Partial<MessageTemplate> & { id: string }) => {
      return apiRequest("PUT", `/api/admin/templates/${id}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/templates"] });
      setEditingTemplate(null);
      toast({ title: "Template updated successfully" });
    },
    onError: () => {
      toast({ title: "Failed to update template", variant: "destructive" });
    },
  });

  const createMutation = useMutation({
    mutationFn: async (data: Partial<MessageTemplate>) => {
      return apiRequest("POST", "/api/admin/templates", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/templates"] });
      setIsCreateOpen(false);
      toast({ title: "Template created successfully" });
    },
    onError: () => {
      toast({ title: "Failed to create template", variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest("DELETE", `/api/admin/templates/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/templates"] });
      toast({ title: "Template deleted successfully" });
    },
    onError: () => {
      toast({ title: "Failed to delete template", variant: "destructive" });
    },
  });

  const [syncingTemplateId, setSyncingTemplateId] = useState<string | null>(null);
  const [refreshingStatusId, setRefreshingStatusId] = useState<string | null>(null);
  const [isSyncingFromTwilio, setIsSyncingFromTwilio] = useState(false);

  const syncFromTwilioMutation = useMutation({
    mutationFn: async () => {
      setIsSyncingFromTwilio(true);
      const res = await apiRequest("POST", "/api/admin/templates/sync-from-twilio");
      return res.json() as Promise<{ success: boolean; synced: number; errors: string[]; message: string }>;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/templates"] });
      toast({ 
        title: "Synced from Twilio", 
        description: data.message 
      });
      setIsSyncingFromTwilio(false);
    },
    onError: (error: any) => {
      toast({ title: "Failed to sync from Twilio", description: error.message, variant: "destructive" });
      setIsSyncingFromTwilio(false);
    },
  });

  const syncTwilioMutation = useMutation({
    mutationFn: async (id: string) => {
      setSyncingTemplateId(id);
      const res = await apiRequest("POST", `/api/admin/templates/${id}/sync-to-twilio`);
      return res.json() as Promise<{ success: boolean; contentSid: string; status: string }>;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/templates"] });
      toast({ title: "Template synced to Twilio", description: `Status: ${data.status}` });
      setSyncingTemplateId(null);
    },
    onError: (error: any) => {
      toast({ title: "Failed to sync template", description: error.message, variant: "destructive" });
      setSyncingTemplateId(null);
    },
  });

  const refreshTwilioStatusMutation = useMutation({
    mutationFn: async (id: string) => {
      setRefreshingStatusId(id);
      const res = await apiRequest("POST", `/api/admin/templates/${id}/refresh-status`);
      return res.json() as Promise<{ success: boolean; status: string }>;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/templates"] });
      toast({ title: "Status updated", description: `Approval status: ${data.status}` });
      setRefreshingStatusId(null);
    },
    onError: () => {
      toast({ title: "Failed to refresh status", variant: "destructive" });
      setRefreshingStatusId(null);
    },
  });

  const getTwilioStatusBadge = (template: MessageTemplate) => {
    if (!template.twilioContentSid) return null;
    
    const status = template.twilioApprovalStatus;
    switch (status) {
      case 'approved':
        return <Badge variant="default" className="bg-green-600"><CheckCircle2 className="h-3 w-3 mr-1" />Twilio Approved</Badge>;
      case 'pending':
      case 'received':
      case 'in_review':
        return <Badge variant="secondary"><Clock className="h-3 w-3 mr-1" />Twilio Pending</Badge>;
      case 'rejected':
        return (
          <Badge variant="destructive" title={template.twilioRejectionReason || 'No reason provided'}>
            <XCircle className="h-3 w-3 mr-1" />Twilio Rejected
          </Badge>
        );
      case 'paused':
        return <Badge variant="outline" className="border-yellow-500 text-yellow-600"><Clock className="h-3 w-3 mr-1" />Paused</Badge>;
      case 'disabled':
        return <Badge variant="destructive"><XCircle className="h-3 w-3 mr-1" />Disabled</Badge>;
      case 'sync_only':
        return <Badge variant="outline"><CloudUpload className="h-3 w-3 mr-1" />Synced (Not Submitted)</Badge>;
      case 'unknown':
        return <Badge variant="outline"><CloudUpload className="h-3 w-3 mr-1" />Status Unknown</Badge>;
      default:
        return <Badge variant="outline"><CloudUpload className="h-3 w-3 mr-1" />Synced</Badge>;
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast({ title: "Copied to clipboard" });
  };

  return (
    <SidebarProvider>
      <AppSidebar
        selectedPlatform={selectedPlatform}
        onSelectPlatform={setSelectedPlatform}
        unreadCounts={{ all: 0, whatsapp: 0, instagram: 0, facebook: 0 }}
        onSettingsClick={() => {}}
      />
      <SidebarInset className="flex flex-col h-screen">
        <header className="flex items-center justify-between p-4 border-b bg-background">
          <div className="flex items-center gap-4">
            <SidebarTrigger data-testid="button-sidebar-toggle" />
            <div className="flex items-center gap-2">
              <FileText className="h-5 w-5" />
              <h1 className="text-lg font-semibold">Message Templates</h1>
            </div>
          </div>
          <ThemeToggle />
        </header>

        <main className="flex-1 overflow-auto p-6">
          <Tabs defaultValue="templates" className="space-y-6">
            <TabsList>
              <TabsTrigger value="templates" data-testid="tab-templates">Templates</TabsTrigger>
              <TabsTrigger value="documentation" data-testid="tab-documentation">API Documentation</TabsTrigger>
            </TabsList>

            <TabsContent value="templates" className="space-y-6">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-xl font-semibold">Invoice & Notification Templates</h2>
                  <p className="text-muted-foreground text-sm">Manage message templates for automated notifications</p>
                </div>
                <div className="flex items-center gap-2">
                  <Button 
                    variant="outline" 
                    onClick={() => syncFromTwilioMutation.mutate()}
                    disabled={isSyncingFromTwilio}
                    data-testid="button-sync-from-twilio"
                  >
                    {isSyncingFromTwilio ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <RefreshCw className="h-4 w-4 mr-2" />
                    )}
                    Sync from Twilio
                  </Button>
                  <Button variant="outline" onClick={handleExport} data-testid="button-export-templates">
                    <Download className="h-4 w-4 mr-2" />
                    Export
                  </Button>
                  <Dialog open={isImportOpen} onOpenChange={setIsImportOpen}>
                    <DialogTrigger asChild>
                      <Button variant="outline" data-testid="button-import-templates">
                        <Upload className="h-4 w-4 mr-2" />
                        Import
                      </Button>
                    </DialogTrigger>
                    <DialogContent className="max-w-2xl">
                      <DialogHeader>
                        <DialogTitle>Import Templates</DialogTitle>
                        <DialogDescription>Paste the exported JSON or upload a file</DialogDescription>
                      </DialogHeader>
                      <div className="space-y-4">
                        <div>
                          <Label>Template JSON</Label>
                          <Textarea
                            value={importData}
                            onChange={(e) => setImportData(e.target.value)}
                            placeholder='Paste exported JSON here or {"templates": [...]}'
                            className="font-mono text-sm h-64"
                            data-testid="input-import-json"
                          />
                        </div>
                        <div className="flex items-center gap-2">
                          <Switch
                            checked={overwriteExisting}
                            onCheckedChange={setOverwriteExisting}
                            id="overwrite"
                            data-testid="switch-overwrite"
                          />
                          <Label htmlFor="overwrite" className="text-sm">
                            Overwrite existing templates with same name
                          </Label>
                        </div>
                      </div>
                      <DialogFooter>
                        <Button variant="outline" onClick={() => setIsImportOpen(false)}>Cancel</Button>
                        <Button onClick={handleImport} disabled={!importData.trim() || importMutation.isPending} data-testid="button-confirm-import">
                          {importMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Upload className="h-4 w-4 mr-2" />}
                          Import
                        </Button>
                      </DialogFooter>
                    </DialogContent>
                  </Dialog>
                  <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
                    <DialogTrigger asChild>
                      <Button data-testid="button-create-template">
                        <Plus className="h-4 w-4 mr-2" />
                        Create Template
                      </Button>
                    </DialogTrigger>
                  <DialogContent className="max-w-2xl">
                    <DialogHeader>
                      <DialogTitle>Create New Template</DialogTitle>
                      <DialogDescription>Create a new message template for automated notifications</DialogDescription>
                    </DialogHeader>
                    <CreateTemplateForm onSubmit={(data) => createMutation.mutate(data)} isPending={createMutation.isPending} />
                  </DialogContent>
                </Dialog>
                </div>
              </div>

              {isLoading ? (
                <div className="flex items-center justify-center h-48">
                  <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                </div>
              ) : templates.length === 0 ? (
                <Card>
                  <CardContent className="flex flex-col items-center justify-center h-48 text-center">
                    <FileText className="h-12 w-12 text-muted-foreground mb-4" />
                    <p className="text-muted-foreground">No templates found</p>
                    <p className="text-sm text-muted-foreground">Create your first message template to get started</p>
                  </CardContent>
                </Card>
              ) : (
                <div className="grid gap-4">
                  {templates.map((template) => (
                    <Card key={template.id}>
                      <CardHeader className="flex flex-row items-start justify-between gap-4">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <CardTitle className="text-lg">{template.name}</CardTitle>
                            <Badge variant={template.isActive ? "default" : "secondary"}>
                              {template.isActive ? "Active" : "Inactive"}
                            </Badge>
                            {template.category && (
                              <Badge variant="outline">{template.category}</Badge>
                            )}
                            {getTwilioStatusBadge(template)}
                          </div>
                          <CardDescription className="mt-1">{template.description}</CardDescription>
                          {template.twilioRejectionReason && (
                            <p className="text-xs text-destructive mt-1">Rejection: {template.twilioRejectionReason}</p>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => syncTwilioMutation.mutate(template.id)}
                            disabled={syncingTemplateId === template.id}
                            title={template.twilioContentSid ? "Re-sync to Twilio" : "Sync to Twilio"}
                            data-testid={`button-sync-twilio-${template.id}`}
                          >
                            {syncingTemplateId === template.id ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <CloudUpload className="h-4 w-4" />
                            )}
                          </Button>
                          {template.twilioContentSid && (
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => refreshTwilioStatusMutation.mutate(template.id)}
                              disabled={refreshingStatusId === template.id}
                              title="Refresh Twilio status"
                              data-testid={`button-refresh-twilio-${template.id}`}
                            >
                              {refreshingStatusId === template.id ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <RefreshCw className="h-4 w-4" />
                              )}
                            </Button>
                          )}
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => setEditingTemplate(template)}
                            data-testid={`button-edit-template-${template.id}`}
                          >
                            <Edit className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => deleteMutation.mutate(template.id)}
                            data-testid={`button-delete-template-${template.id}`}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </CardHeader>
                      <CardContent className="space-y-4">
                        <div>
                          <Label className="text-xs text-muted-foreground">Variables</Label>
                          <div className="flex flex-wrap gap-1 mt-1">
                            {template.variables?.map((v) => (
                              <Badge key={v} variant="secondary" className="font-mono text-xs">
                                {`{{${v}}}`}
                              </Badge>
                            ))}
                          </div>
                        </div>
                        <div>
                          <Label className="text-xs text-muted-foreground">Template Content</Label>
                          <pre className="mt-1 p-3 bg-muted rounded-md text-sm whitespace-pre-wrap font-mono">
                            {template.content}
                          </pre>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </TabsContent>

            <TabsContent value="documentation" className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <BookOpen className="h-5 w-5" />
                    API Documentation
                  </CardTitle>
                  <CardDescription>
                    How to use message templates with the External API
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  <section>
                    <h3 className="font-semibold mb-2">Supported Message Types</h3>
                    <div className="grid gap-2">
                      <div className="flex items-center gap-2">
                        <Badge>new_invoice</Badge>
                        <span className="text-sm text-muted-foreground">New invoice notification</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge>reminder_invoices</Badge>
                        <span className="text-sm text-muted-foreground">Payment reminder</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge>overdue</Badge>
                        <span className="text-sm text-muted-foreground">Overdue payment notice</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge>payment_confirmation</Badge>
                        <span className="text-sm text-muted-foreground">Payment received confirmation</span>
                      </div>
                    </div>
                  </section>

                  <section>
                    <h3 className="font-semibold mb-2">API Payload Examples</h3>
                    
                    <div className="space-y-4">
                      <div>
                        <div className="flex items-center justify-between mb-2">
                          <Label>New Invoice</Label>
                          <Button variant="ghost" size="sm" onClick={() => copyToClipboard(payloadExamples.new_invoice)}>
                            <Copy className="h-4 w-4 mr-1" />
                            Copy
                          </Button>
                        </div>
                        <pre className="p-3 bg-muted rounded-md text-xs overflow-x-auto font-mono">
                          {payloadExamples.new_invoice}
                        </pre>
                      </div>

                      <div>
                        <div className="flex items-center justify-between mb-2">
                          <Label>Reminder</Label>
                          <Button variant="ghost" size="sm" onClick={() => copyToClipboard(payloadExamples.reminder)}>
                            <Copy className="h-4 w-4 mr-1" />
                            Copy
                          </Button>
                        </div>
                        <pre className="p-3 bg-muted rounded-md text-xs overflow-x-auto font-mono">
                          {payloadExamples.reminder}
                        </pre>
                      </div>

                      <div>
                        <div className="flex items-center justify-between mb-2">
                          <Label>Overdue</Label>
                          <Button variant="ghost" size="sm" onClick={() => copyToClipboard(payloadExamples.overdue)}>
                            <Copy className="h-4 w-4 mr-1" />
                            Copy
                          </Button>
                        </div>
                        <pre className="p-3 bg-muted rounded-md text-xs overflow-x-auto font-mono">
                          {payloadExamples.overdue}
                        </pre>
                      </div>

                      <div>
                        <div className="flex items-center justify-between mb-2">
                          <Label>Payment Confirmation</Label>
                          <Button variant="ghost" size="sm" onClick={() => copyToClipboard(payloadExamples.payment_confirmation)}>
                            <Copy className="h-4 w-4 mr-1" />
                            Copy
                          </Button>
                        </div>
                        <pre className="p-3 bg-muted rounded-md text-xs overflow-x-auto font-mono">
                          {payloadExamples.payment_confirmation}
                        </pre>
                      </div>
                    </div>
                  </section>

                  <section>
                    <h3 className="font-semibold mb-2">WABA Template (for Twilio Console)</h3>
                    <p className="text-sm text-muted-foreground mb-2">
                      Register this template in Twilio Console for proactive messaging outside 24-hour window:
                    </p>
                    <div className="flex items-center justify-between mb-2">
                      <Label>Template Body</Label>
                      <Button variant="ghost" size="sm" onClick={() => copyToClipboard(wabaTemplate)}>
                        <Copy className="h-4 w-4 mr-1" />
                        Copy
                      </Button>
                    </div>
                    <pre className="p-3 bg-muted rounded-md text-xs overflow-x-auto font-mono whitespace-pre-wrap">
                      {wabaTemplate}
                    </pre>
                    <div className="mt-4 p-3 bg-muted/50 rounded-md">
                      <h4 className="font-medium text-sm mb-2">Variable Mapping:</h4>
                      <ul className="text-sm space-y-1 text-muted-foreground">
                        <li><code className="bg-muted px-1 rounded">{`{{1}}`}</code> = recipient_name</li>
                        <li><code className="bg-muted px-1 rounded">{`{{2}}`}</code> = message_type (dynamic text)</li>
                        <li><code className="bg-muted px-1 rounded">{`{{3}}`}</code> = invoice_number</li>
                        <li><code className="bg-muted px-1 rounded">{`{{4}}`}</code> = grand_total (formatted)</li>
                        <li><code className="bg-muted px-1 rounded">{`{{5}}`}</code> = invoice_url</li>
                      </ul>
                    </div>
                  </section>

                  <section>
                    <h3 className="font-semibold mb-2">cURL Example</h3>
                    <div className="flex items-center justify-between mb-2">
                      <Label>Send Message via API</Label>
                      <Button variant="ghost" size="sm" onClick={() => copyToClipboard(curlExample)}>
                        <Copy className="h-4 w-4 mr-1" />
                        Copy
                      </Button>
                    </div>
                    <pre className="p-3 bg-muted rounded-md text-xs overflow-x-auto font-mono">
                      {curlExample}
                    </pre>
                  </section>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </main>
      </SidebarInset>
      {editingTemplate && (
        <Dialog open={!!editingTemplate} onOpenChange={() => setEditingTemplate(null)}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>Edit Template</DialogTitle>
              <DialogDescription>Modify the template content and settings</DialogDescription>
            </DialogHeader>
            <EditTemplateForm
              template={editingTemplate}
              onSubmit={(data) => updateMutation.mutate({ id: editingTemplate.id, ...data })}
              isPending={updateMutation.isPending}
            />
          </DialogContent>
        </Dialog>
      )}
    </SidebarProvider>
  );
}

function CreateTemplateForm({ onSubmit, isPending }: { onSubmit: (data: Partial<MessageTemplate>) => void; isPending: boolean }) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [content, setContent] = useState("");
  const [category, setCategory] = useState("");
  const [variables, setVariables] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit({
      name,
      description,
      content,
      category: category || undefined,
      variables: variables.split(",").map((v) => v.trim()).filter(Boolean),
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="name">Template Name</Label>
          <Input id="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g., invoice_reminder" required />
        </div>
        <div className="space-y-2">
          <Label htmlFor="category">Category</Label>
          <Input id="category" value={category} onChange={(e) => setCategory(e.target.value)} placeholder="e.g., billing" />
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor="description">Description</Label>
        <Input id="description" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Brief description of this template" />
      </div>
      <div className="space-y-2">
        <Label htmlFor="variables">Variables (comma-separated)</Label>
        <Input id="variables" value={variables} onChange={(e) => setVariables(e.target.value)} placeholder="e.g., recipient_name, invoice_number, grand_total" />
      </div>
      <div className="space-y-2">
        <Label htmlFor="content">Template Content</Label>
        <Textarea id="content" value={content} onChange={(e) => setContent(e.target.value)} placeholder="Use {{variable_name}} for placeholders" rows={8} required />
      </div>
      <DialogFooter>
        <Button type="submit" disabled={isPending}>
          {isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
          Create Template
        </Button>
      </DialogFooter>
    </form>
  );
}

function EditTemplateForm({ template, onSubmit, isPending }: { template: MessageTemplate; onSubmit: (data: Partial<MessageTemplate>) => void; isPending: boolean }) {
  const [name, setName] = useState(template.name);
  const [description, setDescription] = useState(template.description || "");
  const [content, setContent] = useState(template.content);
  const [category, setCategory] = useState(template.category || "");
  const [variables, setVariables] = useState(template.variables?.join(", ") || "");
  const [isActive, setIsActive] = useState(template.isActive ?? true);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit({
      name,
      description,
      content,
      category: category || undefined,
      variables: variables.split(",").map((v) => v.trim()).filter(Boolean),
      isActive,
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="edit-name">Template Name</Label>
          <Input id="edit-name" value={name} onChange={(e) => setName(e.target.value)} required />
        </div>
        <div className="space-y-2">
          <Label htmlFor="edit-category">Category</Label>
          <Input id="edit-category" value={category} onChange={(e) => setCategory(e.target.value)} />
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor="edit-description">Description</Label>
        <Input id="edit-description" value={description} onChange={(e) => setDescription(e.target.value)} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="edit-variables">Variables (comma-separated)</Label>
        <Input id="edit-variables" value={variables} onChange={(e) => setVariables(e.target.value)} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="edit-content">Template Content</Label>
        <Textarea id="edit-content" value={content} onChange={(e) => setContent(e.target.value)} rows={8} required />
      </div>
      <div className="flex items-center gap-2">
        <Switch id="edit-active" checked={isActive} onCheckedChange={setIsActive} />
        <Label htmlFor="edit-active">Active</Label>
      </div>
      <DialogFooter>
        <Button type="submit" disabled={isPending}>
          {isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
          Save Changes
        </Button>
      </DialogFooter>
    </form>
  );
}

const payloadExamples = {
  new_invoice: `{
    "request_id": "inv_new_001",
    "phone_number": "6285156815391",
    "recipient_name": "Ikhsan",
    "message": "https://invoice.maxnetplus.id/inv/c50f753f7003ce8134a6",
    "metadata": {
        "messageType": "new_invoice",
        "grand_total": "123000",
        "invoice_number": "INV260113421",
        "uuid": "3f2b725421e1e844016a"
    }
}`,
  reminder: `{
    "request_id": "inv_reminder_001",
    "phone_number": "6285156815391",
    "recipient_name": "Ikhsan",
    "message": "https://invoice.maxnetplus.id/inv/c50f753f7003ce8134a6",
    "metadata": {
        "messageType": "reminder_invoices",
        "grand_total": "123000",
        "invoice_number": "INV260113421",
        "uuid": "3f2b725421e1e844016a"
    }
}`,
  overdue: `{
    "request_id": "inv_overdue_001",
    "phone_number": "6285156815391",
    "recipient_name": "Ikhsan",
    "message": "https://invoice.maxnetplus.id/inv/c50f753f7003ce8134a6",
    "metadata": {
        "messageType": "overdue",
        "grand_total": "123000",
        "invoice_number": "INV260113421",
        "uuid": "3f2b725421e1e844016a"
    }
}`,
  payment_confirmation: `{
    "request_id": "inv_paid_001",
    "phone_number": "6285156815391",
    "recipient_name": "Ikhsan",
    "message": "https://invoice.maxnetplus.id/inv/c50f753f7003ce8134a6",
    "metadata": {
        "messageType": "payment_confirmation",
        "grand_total": "123000",
        "invoice_number": "INV260113421",
        "uuid": "3f2b725421e1e844016a"
    }
}`,
};

const wabaTemplate = `Yth. {{1}},

{{2}}

Nomor Invoice: {{3}}
Total Tagihan: Rp {{4}}

Untuk melihat detail dan pembayaran, silakan klik:
{{5}}

Jika sudah melakukan pembayaran, mohon abaikan pesan ini.

Terima kasih,
MAXNET Customer Care
wa.me/6285156815391`;

const curlExample = `curl -X POST "https://omnidesk.maxnetplus.id/ext-api/messages" \\
  -H "Content-Type: application/json" \\
  -H "X-Client-Id: YOUR_CLIENT_ID" \\
  -H "X-Timestamp: $(date +%s000)" \\
  -H "X-Signature: YOUR_HMAC_SIGNATURE" \\
  -d '{
    "request_id": "inv_reminder_001",
    "phone_number": "6285156815391",
    "recipient_name": "Ikhsan",
    "message": "https://invoice.maxnetplus.id/inv/c50f753f7003ce8134a6",
    "metadata": {
        "messageType": "reminder_invoices",
        "grand_total": "123000",
        "invoice_number": "INV260113421"
    }
}'`;
