import { useState } from "react";
import { X, Check, ExternalLink, RefreshCw, AlertCircle } from "lucide-react";
import { SiWhatsapp, SiFacebook, SiInstagram } from "react-icons/si";
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
import type { Platform, PlatformSettings } from "@shared/schema";

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  platformSettings: PlatformSettings[];
  onSaveSettings: (platform: Platform, settings: Partial<PlatformSettings>) => void;
  onTestConnection: (platform: Platform) => Promise<boolean>;
}

export function SettingsModal({
  isOpen,
  onClose,
  platformSettings,
  onSaveSettings,
  onTestConnection,
}: SettingsModalProps) {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState<Platform>("whatsapp");
  const [isTesting, setIsTesting] = useState(false);

  const [whatsappSettings, setWhatsappSettings] = useState({
    accessToken: "",
    phoneNumberId: "",
    businessId: "",
    webhookVerifyToken: "",
  });

  const [instagramSettings, setInstagramSettings] = useState({
    accessToken: "",
    businessId: "",
  });

  const [facebookSettings, setFacebookSettings] = useState({
    accessToken: "",
    pageId: "",
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

  const handleSaveInstagram = () => {
    onSaveSettings("instagram", {
      accessToken: instagramSettings.accessToken,
      businessId: instagramSettings.businessId,
    });
    toast({
      title: "Settings Saved",
      description: "Instagram settings have been saved successfully.",
    });
  };

  const handleSaveFacebook = () => {
    onSaveSettings("facebook", {
      accessToken: facebookSettings.accessToken,
      pageId: facebookSettings.pageId,
    });
    toast({
      title: "Settings Saved",
      description: "Facebook settings have been saved successfully.",
    });
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

        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as Platform)}>
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="whatsapp" className="gap-2" data-testid="tab-whatsapp">
              <SiWhatsapp className="h-4 w-4 text-[#25D366]" />
              WhatsApp
            </TabsTrigger>
            <TabsTrigger value="instagram" className="gap-2" data-testid="tab-instagram">
              <SiInstagram className="h-4 w-4 text-[#E4405F]" />
              Instagram
            </TabsTrigger>
            <TabsTrigger value="facebook" className="gap-2" data-testid="tab-facebook">
              <SiFacebook className="h-4 w-4 text-[#1877F2]" />
              Facebook
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

          <TabsContent value="instagram" className="space-y-4 mt-4">
            <Card>
              <CardHeader className="pb-4">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <CardTitle className="text-lg flex items-center gap-2">
                      <SiInstagram className="h-5 w-5 text-[#E4405F]" />
                      Instagram Messaging API
                    </CardTitle>
                    <CardDescription className="mt-1">
                      Connect your Instagram Business account to manage DMs
                    </CardDescription>
                  </div>
                  <Badge variant={getConnectionStatus("instagram") ? "default" : "secondary"}>
                    {getConnectionStatus("instagram") ? (
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
                  <Label htmlFor="ig-token">Access Token</Label>
                  <Input
                    id="ig-token"
                    type="password"
                    placeholder="Enter your Instagram access token"
                    value={instagramSettings.accessToken}
                    onChange={(e) =>
                      setInstagramSettings({ ...instagramSettings, accessToken: e.target.value })
                    }
                    data-testid="input-instagram-token"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="ig-business">Instagram Business Account ID</Label>
                  <Input
                    id="ig-business"
                    placeholder="Enter your Instagram Business Account ID"
                    value={instagramSettings.businessId}
                    onChange={(e) =>
                      setInstagramSettings({ ...instagramSettings, businessId: e.target.value })
                    }
                    data-testid="input-instagram-business"
                  />
                </div>

                <div className="flex items-center gap-2 pt-2">
                  <Button onClick={handleSaveInstagram} data-testid="button-save-instagram">
                    Save Settings
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => handleTestConnection("instagram")}
                    disabled={isTesting}
                    data-testid="button-test-instagram"
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
                    href="https://developers.facebook.com/docs/instagram-api/"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-primary hover:underline inline-flex items-center gap-1"
                  >
                    View Instagram API Documentation
                    <ExternalLink className="h-3 w-3" />
                  </a>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="facebook" className="space-y-4 mt-4">
            <Card>
              <CardHeader className="pb-4">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <CardTitle className="text-lg flex items-center gap-2">
                      <SiFacebook className="h-5 w-5 text-[#1877F2]" />
                      Facebook Messenger API
                    </CardTitle>
                    <CardDescription className="mt-1">
                      Connect your Facebook Page to manage Messenger conversations
                    </CardDescription>
                  </div>
                  <Badge variant={getConnectionStatus("facebook") ? "default" : "secondary"}>
                    {getConnectionStatus("facebook") ? (
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
                  <Label htmlFor="fb-token">Page Access Token</Label>
                  <Input
                    id="fb-token"
                    type="password"
                    placeholder="Enter your Facebook Page access token"
                    value={facebookSettings.accessToken}
                    onChange={(e) =>
                      setFacebookSettings({ ...facebookSettings, accessToken: e.target.value })
                    }
                    data-testid="input-facebook-token"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="fb-page">Facebook Page ID</Label>
                  <Input
                    id="fb-page"
                    placeholder="Enter your Facebook Page ID"
                    value={facebookSettings.pageId}
                    onChange={(e) =>
                      setFacebookSettings({ ...facebookSettings, pageId: e.target.value })
                    }
                    data-testid="input-facebook-page"
                  />
                </div>

                <div className="flex items-center gap-2 pt-2">
                  <Button onClick={handleSaveFacebook} data-testid="button-save-facebook">
                    Save Settings
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => handleTestConnection("facebook")}
                    disabled={isTesting}
                    data-testid="button-test-facebook"
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
                    href="https://developers.facebook.com/docs/messenger-platform/"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-primary hover:underline inline-flex items-center gap-1"
                  >
                    View Messenger API Documentation
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
