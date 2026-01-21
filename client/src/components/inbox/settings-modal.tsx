import { useState, useEffect } from "react";
import { Check, ExternalLink, RefreshCw, AlertCircle, Sparkles, Trash2, Loader2 } from "lucide-react";
import { SiWhatsapp, SiOpenai } from "react-icons/si";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
  initialTab?: SettingsTab;
}

interface OpenAIStatus {
  hasKey: boolean;
  isCustomKey: boolean;
  isValid: boolean | null;
  lastValidatedAt: string | null;
}

export function SettingsModal({
  isOpen,
  onClose,
  platformSettings,
  onSaveSettings,
  onTestConnection,
  initialTab = "whatsapp",
}: SettingsModalProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<SettingsTab>(initialTab);
  
  useEffect(() => {
    if (isOpen) {
      setActiveTab(initialTab);
    }
  }, [isOpen, initialTab]);
  const [isTesting, setIsTesting] = useState(false);
  const [openaiKey, setOpenaiKey] = useState("");

  const [whatsappSettings, setWhatsappSettings] = useState({
    accessToken: "",
    phoneNumberId: "",
    businessId: "",
    webhookVerifyToken: "",
  });

  const [twilioSettings, setTwilioSettings] = useState({
    accountSid: "",
    authToken: "",
    phoneNumber: "",
  });

  const { data: openaiStatus, isLoading: openaiLoading } = useQuery<OpenAIStatus>({
    queryKey: ["/api/settings/openai"],
    enabled: isOpen,
  });

  // Check Twilio status
  const { data: twilioStatus } = useQuery<{ connected: boolean; phoneNumber: string | null; source: string | null }>({
    queryKey: ["/api/twilio/status"],
    enabled: isOpen,
  });

  // Get Twilio settings (masked)
  const { data: twilioSettingsData } = useQuery<{ accountSid: string | null; authTokenSet: boolean; phoneNumber: string | null }>({
    queryKey: ["/api/settings/twilio"],
    enabled: isOpen,
  });

  // Save Twilio settings mutation
  const saveTwilioMutation = useMutation({
    mutationFn: async (settings: { accountSid: string; authToken: string; phoneNumber: string }) => {
      const res = await apiRequest("POST", "/api/settings/twilio", settings);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/twilio/status"] });
      queryClient.invalidateQueries({ queryKey: ["/api/settings/twilio"] });
      setTwilioSettings({ accountSid: "", authToken: "", phoneNumber: "" });
      toast({
        title: "Twilio Settings Saved",
        description: "Your Twilio credentials have been saved successfully.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to save Twilio settings",
        variant: "destructive",
      });
    },
  });

  // Delete Twilio settings mutation
  const deleteTwilioMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("DELETE", "/api/settings/twilio");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/twilio/status"] });
      queryClient.invalidateQueries({ queryKey: ["/api/settings/twilio"] });
      toast({
        title: "Twilio Settings Deleted",
        description: "Your Twilio credentials have been removed.",
      });
    },
  });

  // Load existing WhatsApp platform settings into form state
  // Only update when we have valid data (not during refetch when array is empty)
  useEffect(() => {
    if (platformSettings.length === 0) return; // Skip if no data yet
    const whatsapp = platformSettings.find(s => s.platform === "whatsapp");
    if (whatsapp) {
      setWhatsappSettings(prev => ({
        accessToken: prev.accessToken || "", // Keep user input if already entered
        phoneNumberId: whatsapp.phoneNumberId || "",
        businessId: whatsapp.businessId || "",
        webhookVerifyToken: whatsapp.webhookVerifyToken || "",
      }));
    }
  }, [platformSettings]);

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
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="whatsapp" className="gap-2" data-testid="tab-whatsapp">
              <SiWhatsapp className="h-4 w-4 text-[#25D366]" />
              WhatsApp
            </TabsTrigger>
            <TabsTrigger value="openai" className="gap-2" data-testid="tab-openai">
              <SiOpenai className="h-4 w-4" />
              OpenAI
            </TabsTrigger>
          </TabsList>

          <TabsContent value="whatsapp" className="space-y-4 mt-4">
            {/* Twilio Settings Card */}
            <Card className={twilioStatus?.connected ? "border-green-500/50" : ""}>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <CardTitle className="text-lg flex items-center gap-2">
                      <SiWhatsapp className="h-5 w-5 text-[#25D366]" />
                      Twilio WhatsApp (Recommended)
                    </CardTitle>
                    <CardDescription className="mt-1">
                      Official WhatsApp Business API via Twilio - reliable and compliant
                    </CardDescription>
                  </div>
                  <Badge variant={twilioStatus?.connected ? "default" : "secondary"}>
                    {twilioStatus?.connected ? (
                      <>
                        <Check className="h-3 w-3 mr-1" />
                        Connected {twilioStatus.source === 'database' ? '(Manual)' : '(Replit)'}
                      </>
                    ) : (
                      "Not Configured"
                    )}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {twilioStatus?.connected && (
                  <div className="text-sm text-muted-foreground bg-muted/50 p-3 rounded-md">
                    <p className="flex items-center gap-2">
                      <Check className="h-4 w-4 text-green-500" />
                      Twilio is configured and ready to send messages
                    </p>
                    {twilioStatus.phoneNumber && (
                      <p className="mt-1">Phone: {twilioStatus.phoneNumber}</p>
                    )}
                    {twilioSettingsData?.accountSid && (
                      <p className="mt-1">Account SID: {twilioSettingsData.accountSid}</p>
                    )}
                    <p className="mt-2 text-xs">
                      Webhook URL: <code className="bg-muted px-1 rounded">{window.location.origin}/api/twilio/webhook</code>
                    </p>
                  </div>
                )}

                <div className="space-y-2">
                  <Label htmlFor="twilio-sid">Account SID</Label>
                  <Input
                    id="twilio-sid"
                    placeholder="ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                    value={twilioSettings.accountSid}
                    onChange={(e) => setTwilioSettings({ ...twilioSettings, accountSid: e.target.value })}
                    data-testid="input-twilio-sid"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="twilio-token">Auth Token</Label>
                  <Input
                    id="twilio-token"
                    type="password"
                    placeholder="Enter your Twilio Auth Token"
                    value={twilioSettings.authToken}
                    onChange={(e) => setTwilioSettings({ ...twilioSettings, authToken: e.target.value })}
                    data-testid="input-twilio-token"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="twilio-phone">Phone Number</Label>
                  <Input
                    id="twilio-phone"
                    placeholder="+1234567890"
                    value={twilioSettings.phoneNumber}
                    onChange={(e) => setTwilioSettings({ ...twilioSettings, phoneNumber: e.target.value })}
                    data-testid="input-twilio-phone"
                  />
                  <p className="text-xs text-muted-foreground">
                    Your Twilio WhatsApp-enabled phone number
                  </p>
                </div>

                <div className="flex items-center gap-2 pt-2">
                  <Button 
                    onClick={() => saveTwilioMutation.mutate(twilioSettings)}
                    disabled={saveTwilioMutation.isPending || !twilioSettings.accountSid || !twilioSettings.authToken || !twilioSettings.phoneNumber}
                    data-testid="button-save-twilio"
                  >
                    {saveTwilioMutation.isPending ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : null}
                    Save Twilio Settings
                  </Button>
                  {twilioStatus?.connected && twilioStatus.source === 'database' && (
                    <Button
                      variant="destructive"
                      onClick={() => deleteTwilioMutation.mutate()}
                      disabled={deleteTwilioMutation.isPending}
                      data-testid="button-delete-twilio"
                    >
                      <Trash2 className="h-4 w-4 mr-2" />
                      Delete
                    </Button>
                  )}
                </div>

                <div className="pt-4 border-t border-border">
                  <a
                    href="https://www.twilio.com/console"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-primary hover:underline inline-flex items-center gap-1"
                  >
                    Open Twilio Console
                    <ExternalLink className="h-3 w-3" />
                  </a>
                </div>
              </CardContent>
            </Card>

            {/* Meta Direct API Card (legacy) */}
            <Card>
              <CardHeader className="pb-4">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <CardTitle className="text-lg flex items-center gap-2">
                      <SiWhatsapp className="h-5 w-5 text-[#25D366]" />
                      Meta WhatsApp API (Direct)
                    </CardTitle>
                    <CardDescription className="mt-1">
                      Connect directly to Meta's WhatsApp Cloud API (alternative to Twilio)
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
