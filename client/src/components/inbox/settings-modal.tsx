import { useState, useEffect } from "react";
import { X, Check, ExternalLink, RefreshCw, AlertCircle, Sparkles, Trash2, MessageCircle, Loader2 } from "lucide-react";
import { SiWhatsapp, SiOpenai } from "react-icons/si";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import type { Platform, PlatformSettings } from "@shared/schema";

type SettingsTab = Platform | "openai" | "autoreply";

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  platformSettings: PlatformSettings[];
  onSaveSettings: (platform: Platform, settings: Partial<PlatformSettings>) => void;
  onTestConnection: (platform: Platform) => Promise<boolean>;
}

interface OpenAIStatus {
  hasKey: boolean;
  isCustomKey: boolean;
  isValid: boolean | null;
  lastValidatedAt: string | null;
}

interface AutoReplySettings {
  enabled: boolean;
  prompt: string | null;
}

export function SettingsModal({
  isOpen,
  onClose,
  platformSettings,
  onSaveSettings,
  onTestConnection,
}: SettingsModalProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<SettingsTab>("whatsapp");
  const [isTesting, setIsTesting] = useState(false);
  const [openaiKey, setOpenaiKey] = useState("");

  const [whatsappSettings, setWhatsappSettings] = useState({
    accessToken: "",
    phoneNumberId: "",
    businessId: "",
    webhookVerifyToken: "",
  });


  const [autoReplyPrompt, setAutoReplyPrompt] = useState("");
  const [autoReplyEnabled, setAutoReplyEnabledState] = useState(false);

  const { data: openaiStatus, isLoading: openaiLoading } = useQuery<OpenAIStatus>({
    queryKey: ["/api/settings/openai"],
    enabled: isOpen,
  });

  const { data: autoReplySettings, isLoading: autoReplyLoading } = useQuery<AutoReplySettings>({
    queryKey: ["/api/autoreply/settings"],
    enabled: isOpen,
  });

  useEffect(() => {
    if (autoReplySettings) {
      setAutoReplyEnabledState(autoReplySettings.enabled);
      setAutoReplyPrompt(autoReplySettings.prompt || "");
    }
  }, [autoReplySettings]);

  // Load existing WhatsApp platform settings into form state
  useEffect(() => {
    const whatsapp = platformSettings.find(s => s.platform === "whatsapp");
    if (whatsapp) {
      setWhatsappSettings({
        accessToken: "", // Don't load masked token - user must re-enter
        phoneNumberId: whatsapp.phoneNumberId || "",
        businessId: whatsapp.businessId || "",
        webhookVerifyToken: whatsapp.webhookVerifyToken || "",
      });
    }
  }, [platformSettings]);

  const saveAutoReplyMutation = useMutation({
    mutationFn: async (data: { enabled?: boolean; prompt?: string }) => {
      const res = await apiRequest("POST", "/api/autoreply/settings", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/autoreply/settings"] });
      toast({
        title: "Settings Saved",
        description: "Auto-reply settings have been saved successfully.",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to save auto-reply settings.",
        variant: "destructive",
      });
    },
  });

  const saveOpenAIMutation = useMutation({
    mutationFn: async (apiKey: string) => {
      const res = await apiRequest("POST", "/api/settings/openai", { apiKey });
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/settings/openai"] });
      setOpenaiKey("");
      toast({
        title: data.isValid ? "API Key Saved" : "API Key Saved (Invalid)",
        description: data.isValid 
          ? "OpenAI API key has been saved and validated successfully."
          : "The API key was saved but could not be validated. Please check if it's correct.",
        variant: data.isValid ? "default" : "destructive",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to save OpenAI API key.",
        variant: "destructive",
      });
    },
  });

  const deleteOpenAIMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("DELETE", "/api/settings/openai");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/settings/openai"] });
      toast({
        title: "API Key Removed",
        description: "Custom OpenAI API key has been removed.",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to remove OpenAI API key.",
        variant: "destructive",
      });
    },
  });

  const validateOpenAIMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/settings/openai/validate");
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/settings/openai"] });
      toast({
        title: data.isValid ? "Key Valid" : "Key Invalid",
        description: data.isValid 
          ? "OpenAI API key is valid and working."
          : "The API key could not be validated. Please check if it's correct.",
        variant: data.isValid ? "default" : "destructive",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to validate OpenAI API key.",
        variant: "destructive",
      });
    },
  });

  const handleTestConnection = async (platform: Platform) => {
    setIsTesting(true);
    try {
      const success = await onTestConnection(platform);
      if (success) {
        toast({
          title: "Connection Successful",
          description: `${platform.charAt(0).toUpperCase() + platform.slice(1)} is connected and ready to use.`,
        });
      } else {
        toast({
          title: "Connection Failed",
          description: "Please check your credentials and try again.",
          variant: "destructive",
        });
      }
    } catch (error) {
      toast({
        title: "Connection Error",
        description: "Failed to test connection. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsTesting(false);
    }
  };

  const handleSaveWhatsApp = () => {
    onSaveSettings("whatsapp", {
      accessToken: whatsappSettings.accessToken,
      phoneNumberId: whatsappSettings.phoneNumberId,
      businessId: whatsappSettings.businessId,
      webhookVerifyToken: whatsappSettings.webhookVerifyToken,
    });
    toast({
      title: "Settings Saved",
      description: "WhatsApp settings have been saved successfully.",
    });
  };

  const generateRandomToken = () => {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let token = '';
    for (let i = 0; i < 32; i++) {
      token += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return token;
  };

  const getConnectionStatus = (platform: Platform) => {
    const settings = platformSettings.find((s) => s.platform === platform);
    return settings?.isConnected || false;
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-xl">Platform Settings</DialogTitle>
        </DialogHeader>

        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as SettingsTab)}>
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="whatsapp" className="gap-2" data-testid="tab-whatsapp">
              <SiWhatsapp className="h-4 w-4 text-[#25D366]" />
              WhatsApp
            </TabsTrigger>
            <TabsTrigger value="openai" className="gap-2" data-testid="tab-openai">
              <SiOpenai className="h-4 w-4" />
              OpenAI
            </TabsTrigger>
            <TabsTrigger value="autoreply" className="gap-2" data-testid="tab-autoreply">
              <MessageCircle className="h-4 w-4" />
              Auto Reply
            </TabsTrigger>
          </TabsList>

          <TabsContent value="whatsapp" className="space-y-4 mt-4">
            <Card>
              <CardHeader className="pb-4">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <CardTitle className="text-lg flex items-center gap-2">
                      <SiWhatsapp className="h-5 w-5 text-[#25D366]" />
                      WhatsApp Business API
                    </CardTitle>
                    <CardDescription className="mt-1">
                      Connect your WhatsApp Business API account to send and receive messages
                    </CardDescription>
                  </div>
                  <Badge variant={getConnectionStatus("whatsapp") ? "default" : "secondary"}>
                    {getConnectionStatus("whatsapp") ? (
                      <>
                        <Check className="h-3 w-3 mr-1" />
                        Connected
                      </>
                    ) : (
                      "Not Connected"
                    )}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="wa-token">Access Token</Label>
                  <Input
                    id="wa-token"
                    type="password"
                    placeholder="Enter your Meta access token"
                    value={whatsappSettings.accessToken}
                    onChange={(e) =>
                      setWhatsappSettings({ ...whatsappSettings, accessToken: e.target.value })
                    }
                    data-testid="input-whatsapp-token"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="wa-phone">Phone Number ID</Label>
                  <Input
                    id="wa-phone"
                    placeholder="Enter your WhatsApp Phone Number ID"
                    value={whatsappSettings.phoneNumberId}
                    onChange={(e) =>
                      setWhatsappSettings({ ...whatsappSettings, phoneNumberId: e.target.value })
                    }
                    data-testid="input-whatsapp-phone"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="wa-business">Business Account ID</Label>
                  <Input
                    id="wa-business"
                    placeholder="Enter your WhatsApp Business Account ID"
                    value={whatsappSettings.businessId}
                    onChange={(e) =>
                      setWhatsappSettings({ ...whatsappSettings, businessId: e.target.value })
                    }
                    data-testid="input-whatsapp-business"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="wa-webhook">Webhook Verify Token</Label>
                  <Input
                    id="wa-webhook"
                    placeholder="Create a custom verify token"
                    value={whatsappSettings.webhookVerifyToken}
                    onChange={(e) =>
                      setWhatsappSettings({
                        ...whatsappSettings,
                        webhookVerifyToken: e.target.value,
                      })
                    }
                    data-testid="input-whatsapp-webhook"
                  />
                  <p className="text-xs text-muted-foreground">
                    Use this token when setting up webhooks in Meta Developer Portal
                  </p>
                </div>

                <div className="flex items-center gap-2 pt-2">
                  <Button onClick={handleSaveWhatsApp} data-testid="button-save-whatsapp">
                    Save Settings
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => handleTestConnection("whatsapp")}
                    disabled={isTesting}
                    data-testid="button-test-whatsapp"
                  >
                    {isTesting ? (
                      <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <RefreshCw className="h-4 w-4 mr-2" />
                    )}
                    Test Connection
                  </Button>
                </div>

                <div className="pt-4 border-t border-border">
                  <a
                    href="https://developers.facebook.com/docs/whatsapp/cloud-api/get-started"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-primary hover:underline inline-flex items-center gap-1"
                  >
                    View WhatsApp API Documentation
                    <ExternalLink className="h-3 w-3" />
                  </a>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="openai" className="space-y-4 mt-4">
            <Card>
              <CardHeader className="pb-4">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <CardTitle className="text-lg flex items-center gap-2">
                      <Sparkles className="h-5 w-5 text-primary" />
                      OpenAI Integration
                    </CardTitle>
                    <CardDescription className="mt-1">
                      Configure your OpenAI API key to enable AI-powered features
                    </CardDescription>
                  </div>
                  {openaiLoading ? (
                    <Badge variant="secondary">Loading...</Badge>
                  ) : (
                    <Badge variant={openaiStatus?.hasKey && openaiStatus?.isValid ? "default" : openaiStatus?.hasKey ? "destructive" : "secondary"}>
                      {openaiStatus?.hasKey && openaiStatus?.isValid ? (
                        <>
                          <Check className="h-3 w-3 mr-1" />
                          Valid
                        </>
                      ) : openaiStatus?.hasKey && openaiStatus?.isValid === false ? (
                        <>
                          <AlertCircle className="h-3 w-3 mr-1" />
                          Invalid
                        </>
                      ) : openaiStatus?.hasKey ? (
                        "Not Validated"
                      ) : (
                        "Not Configured"
                      )}
                    </Badge>
                  )}
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {openaiStatus?.hasKey && (
                  <div className="p-3 bg-muted/50 rounded-lg space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium">Current Key Status</span>
                      <div className="flex items-center gap-2">
                        {openaiStatus.isCustomKey ? (
                          <Badge variant="outline">Custom Key</Badge>
                        ) : (
                          <Badge variant="outline">Environment Key</Badge>
                        )}
                      </div>
                    </div>
                    {openaiStatus.lastValidatedAt && (
                      <p className="text-xs text-muted-foreground">
                        Last validated: {new Date(openaiStatus.lastValidatedAt).toLocaleString()}
                      </p>
                    )}
                    <div className="flex items-center gap-2 pt-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => validateOpenAIMutation.mutate()}
                        disabled={validateOpenAIMutation.isPending}
                        data-testid="button-validate-openai"
                      >
                        {validateOpenAIMutation.isPending ? (
                          <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                        ) : (
                          <RefreshCw className="h-4 w-4 mr-2" />
                        )}
                        Validate Key
                      </Button>
                      {openaiStatus.isCustomKey && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => deleteOpenAIMutation.mutate()}
                          disabled={deleteOpenAIMutation.isPending}
                          data-testid="button-delete-openai"
                        >
                          <Trash2 className="h-4 w-4 mr-2" />
                          Remove Custom Key
                        </Button>
                      )}
                    </div>
                  </div>
                )}

                <div className="space-y-2">
                  <Label htmlFor="openai-key">
                    {openaiStatus?.hasKey ? "Replace API Key" : "OpenAI API Key"}
                  </Label>
                  <Input
                    id="openai-key"
                    type="password"
                    placeholder="sk-..."
                    value={openaiKey}
                    onChange={(e) => setOpenaiKey(e.target.value)}
                    data-testid="input-openai-key"
                  />
                  <p className="text-xs text-muted-foreground">
                    Enter your OpenAI API key to enable AI features. The key will be validated automatically.
                  </p>
                </div>

                <div className="flex items-center gap-2 pt-2">
                  <Button
                    onClick={() => saveOpenAIMutation.mutate(openaiKey)}
                    disabled={!openaiKey || saveOpenAIMutation.isPending}
                    data-testid="button-save-openai"
                  >
                    {saveOpenAIMutation.isPending ? (
                      <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                    ) : null}
                    Save API Key
                  </Button>
                </div>

                <div className="pt-4 border-t border-border">
                  <a
                    href="https://platform.openai.com/api-keys"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-primary hover:underline inline-flex items-center gap-1"
                  >
                    Get an OpenAI API Key
                    <ExternalLink className="h-3 w-3" />
                  </a>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="autoreply" className="space-y-4 mt-4">
            <Card>
              <CardHeader className="pb-4">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <CardTitle className="text-lg flex items-center gap-2">
                      <MessageCircle className="h-5 w-5 text-primary" />
                      Auto-Reply Settings
                    </CardTitle>
                    <CardDescription className="mt-1">
                      Automatically respond to new conversations after 24 hours of inactivity
                    </CardDescription>
                  </div>
                  {autoReplyLoading ? (
                    <Badge variant="secondary">Loading...</Badge>
                  ) : (
                    <Badge variant={autoReplyEnabled ? "default" : "secondary"}>
                      {autoReplyEnabled ? (
                        <>
                          <Check className="h-3 w-3 mr-1" />
                          Enabled
                        </>
                      ) : (
                        "Disabled"
                      )}
                    </Badge>
                  )}
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between p-4 bg-muted/50 rounded-lg">
                  <div>
                    <Label htmlFor="autoreply-enabled" className="font-medium">Enable Auto-Reply</Label>
                    <p className="text-sm text-muted-foreground mt-1">
                      When enabled, the AI will automatically respond to messages from conversations 
                      that have been inactive for more than 24 hours.
                    </p>
                  </div>
                  <Switch
                    id="autoreply-enabled"
                    checked={autoReplyEnabled}
                    onCheckedChange={(checked) => {
                      setAutoReplyEnabledState(checked);
                      if (!autoReplyPrompt.trim()) {
                        toast({
                          title: "Prompt Required",
                          description: "Please configure the auto-reply prompt before enabling.",
                          variant: "destructive",
                        });
                        setAutoReplyEnabledState(false);
                        return;
                      }
                      saveAutoReplyMutation.mutate({ enabled: checked });
                    }}
                    disabled={saveAutoReplyMutation.isPending || (!autoReplyPrompt.trim() && !autoReplyEnabled)}
                    data-testid="switch-autoreply-enabled"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="autoreply-prompt">AI Prompt</Label>
                  <Textarea
                    id="autoreply-prompt"
                    placeholder="Enter instructions for how the AI should respond to new conversations. For example:

You are a customer service representative. Greet the customer warmly and ask how you can help them today. Be professional and friendly."
                    value={autoReplyPrompt}
                    onChange={(e) => setAutoReplyPrompt(e.target.value)}
                    rows={6}
                    data-testid="textarea-autoreply-prompt"
                  />
                  <p className="text-xs text-muted-foreground">
                    This prompt will guide the AI on how to respond. Without a prompt, auto-reply will be disabled.
                  </p>
                </div>

                <div className="flex items-center gap-2 pt-2">
                  <Button
                    onClick={() => saveAutoReplyMutation.mutate({ prompt: autoReplyPrompt })}
                    disabled={saveAutoReplyMutation.isPending}
                    data-testid="button-save-autoreply"
                  >
                    {saveAutoReplyMutation.isPending ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : null}
                    Save Prompt
                  </Button>
                </div>

                <div className="pt-4 border-t border-border">
                  <div className="p-3 bg-muted rounded-lg">
                    <p className="text-sm font-medium flex items-center gap-2">
                      <AlertCircle className="h-4 w-4" />
                      How it works
                    </p>
                    <ul className="text-sm text-muted-foreground mt-2 space-y-1 list-disc list-inside">
                      <li>Auto-reply only triggers for conversations inactive for more than 24 hours</li>
                      <li>Each new message from a "new" conversation will get one automatic response</li>
                      <li>The AI uses the prompt above to generate personalized responses</li>
                      <li>Requires a valid OpenAI API key configured in the OpenAI tab</li>
                    </ul>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        <div className="mt-4 p-4 bg-muted/50 rounded-lg">
          <div className="flex items-start gap-3">
            <AlertCircle className="h-5 w-5 text-muted-foreground mt-0.5" />
            <div>
              <p className="text-sm font-medium">Webhook URL</p>
              <p className="text-sm text-muted-foreground mt-1">
                Configure your webhooks in Meta Developer Portal with this URL:
              </p>
              <code className="text-xs bg-background px-2 py-1 rounded mt-2 block break-all">
                {window.location.origin}/api/webhook/[platform]
              </code>
              <p className="text-xs text-muted-foreground mt-2">
                Replace [platform] with: whatsapp, instagram, or facebook
              </p>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
