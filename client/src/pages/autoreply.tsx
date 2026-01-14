import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Bot, ArrowLeft, Loader2, Check, Power, PowerOff } from "lucide-react";
import { Link } from "wouter";

interface AutoReplySettings {
  enabled: boolean;
  prompt: string | null;
}

export default function AutoReplyPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [autoReplyPrompt, setAutoReplyPrompt] = useState("");
  const [autoReplyEnabled, setAutoReplyEnabledState] = useState(false);

  const { data: autoReplySettings, isLoading: autoReplyLoading } = useQuery<AutoReplySettings>({
    queryKey: ["/api/autoreply/settings"],
  });

  useEffect(() => {
    if (autoReplySettings) {
      setAutoReplyEnabledState(autoReplySettings.enabled);
      setAutoReplyPrompt(autoReplySettings.prompt || "");
    }
  }, [autoReplySettings]);

  const saveAutoReplyMutation = useMutation({
    mutationFn: async (data: { enabled?: boolean; prompt?: string }) => {
      const res = await apiRequest("POST", "/api/autoreply/settings", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/autoreply/settings"] });
      toast({ title: "Auto-reply settings saved" });
    },
    onError: () => {
      toast({ title: "Failed to save settings", variant: "destructive" });
    },
  });

  return (
    <div className="flex flex-col h-full">
      <header className="flex items-center gap-3 px-4 h-14 border-b border-border bg-card shrink-0">
        <Link href="/">
          <Button variant="ghost" size="icon" data-testid="button-back">
            <ArrowLeft className="h-5 w-5" />
          </Button>
        </Link>
        <div className="flex items-center gap-2">
          <Bot className="h-5 w-5 text-primary" />
          <h1 className="text-lg font-semibold">Autoreply Message</h1>
        </div>
      </header>

      <div className="flex-1 overflow-auto p-4">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              Auto-Reply Settings
              {autoReplyLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Badge variant={autoReplyEnabled ? "default" : "secondary"}>
                  {autoReplyEnabled ? (
                    <>
                      <Power className="h-3 w-3 mr-1" />
                      Enabled
                    </>
                  ) : (
                    <>
                      <PowerOff className="h-3 w-3 mr-1" />
                      Disabled
                    </>
                  )}
                </Badge>
              )}
            </CardTitle>
            <CardDescription>
              Configure automatic AI-powered replies for inactive conversations. 
              Auto-reply triggers when a conversation has been inactive for more than 24 hours, 
              treating it as a new conversation.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label htmlFor="autoreply-enabled" className="font-medium">Enable Auto-Reply</Label>
                <p className="text-sm text-muted-foreground">
                  Automatically respond to inactive conversations using AI
                </p>
              </div>
              <Switch
                id="autoreply-enabled"
                checked={autoReplyEnabled}
                onCheckedChange={(checked) => {
                  setAutoReplyEnabledState(checked);
                  if (!autoReplyPrompt.trim()) {
                    toast({
                      title: "Please set an AI prompt first",
                      description: "You need to save a prompt before enabling auto-reply",
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
                placeholder="Enter the AI prompt for generating auto-replies. For example: 'You are a helpful customer service assistant for [Company Name]. Greet the customer warmly and ask how you can help them today. Keep responses friendly and professional.'"
                className="min-h-[200px]"
                value={autoReplyPrompt}
                onChange={(e) => setAutoReplyPrompt(e.target.value)}
                data-testid="textarea-autoreply-prompt"
              />
              <p className="text-xs text-muted-foreground">
                This prompt will be used by OpenAI to generate personalized auto-replies. 
                The customer's message will be included for context.
              </p>
            </div>

            <Button
              onClick={() => saveAutoReplyMutation.mutate({ prompt: autoReplyPrompt })}
              disabled={saveAutoReplyMutation.isPending}
              data-testid="button-save-autoreply"
            >
              {saveAutoReplyMutation.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Check className="h-4 w-4 mr-2" />
              )}
              Save Prompt
            </Button>

            <div className="p-4 bg-muted rounded-lg space-y-2">
              <h4 className="font-medium text-sm">How Auto-Reply Works:</h4>
              <ul className="text-sm text-muted-foreground space-y-1 list-disc list-inside">
                <li>Monitors conversations inactive for more than 24 hours</li>
                <li>When a new message arrives, generates an AI response using your prompt</li>
                <li>Sends the response automatically via WhatsApp</li>
                <li>Only activates during sending hours (7 AM - 9 PM Jakarta time)</li>
                <li>Requires OpenAI API key to be configured in Settings</li>
              </ul>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
