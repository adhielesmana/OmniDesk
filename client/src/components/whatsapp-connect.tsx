import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Loader2, Smartphone, QrCode, Check, X, LogOut } from "lucide-react";
import { SiWhatsapp } from "react-icons/si";
import { apiRequest, queryClient } from "@/lib/queryClient";

type ConnectionStatus = "disconnected" | "connecting" | "qr" | "connected";

interface WhatsAppStatus {
  status: ConnectionStatus;
  qr: string | null;
  connectionMethod?: "baileys" | "twilio" | "waba";
  twilioConnected?: boolean;
  wabaConnected?: boolean;
  baileysConnected?: boolean;
}

export function WhatsAppConnect() {
  const [open, setOpen] = useState(false);
  const [qrCode, setQrCode] = useState<string | null>(null);

  const { data: status, refetch } = useQuery<WhatsAppStatus>({
    queryKey: ["/api/whatsapp/status"],
    refetchInterval: open ? 3000 : false, // Only poll when modal is open
  });

  const connectMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/whatsapp/connect"),
    onSuccess: () => {
      refetch();
    },
  });

  const disconnectMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/whatsapp/disconnect"),
    onSuccess: () => {
      setQrCode(null);
      refetch();
    },
  });

  const logoutMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/whatsapp/logout"),
    onSuccess: () => {
      setQrCode(null);
      refetch();
    },
  });

  // Handle modal close - stop connection if not connected
  const handleOpenChange = (isOpen: boolean) => {
    if (!isOpen && status?.status !== "connected") {
      // Stop connection when modal closes (if not connected)
      disconnectMutation.mutate();
    }
    setOpen(isOpen);
  };

  useEffect(() => {
    if (status?.qr) {
      setQrCode(status.qr);
    } else if (status?.status === "connected") {
      setQrCode(null);
    }
  }, [status?.qr, status?.status]);

  useEffect(() => {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws`);
    
    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.type === "whatsapp_qr") {
        setQrCode(data.qr);
      } else if (data.type === "whatsapp_status") {
        refetch();
        if (data.status === "connected") {
          setQrCode(null);
        }
      }
    };

    return () => ws.close();
  }, [refetch]);

  const connectionStatus = status?.status || "disconnected";
  const connectionMethod = status?.connectionMethod;
  const isConnectedViaApi = status?.twilioConnected || status?.wabaConnected;

  const getConnectionLabel = () => {
    if (connectionMethod === "twilio") return "Twilio";
    if (connectionMethod === "waba") return "WABA";
    return "";
  };

  const getStatusBadge = () => {
    switch (connectionStatus) {
      case "connected":
        return (
          <Badge variant="outline" className="border-green-600 text-green-600">
            <Check className="w-3 h-3 mr-1" />
            Connected
          </Badge>
        );
      case "qr":
        return (
          <Badge variant="secondary">
            <QrCode className="w-3 h-3 mr-1" />
            Scan QR
          </Badge>
        );
      case "connecting":
        return (
          <Badge variant="secondary">
            <Loader2 className="w-3 h-3 mr-1 animate-spin" />
            Connecting
          </Badge>
        );
      default:
        return (
          <Badge variant="outline">
            <X className="w-3 h-3 mr-1" />
            Disconnected
          </Badge>
        );
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="w-full justify-start gap-2"
          data-testid="button-whatsapp-connect"
          disabled={connectionStatus === "connected"}
        >
          <SiWhatsapp className="w-4 h-4 text-green-500" />
          <span className="flex-1 text-left">WhatsApp</span>
          {getStatusBadge()}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <SiWhatsapp className="w-5 h-5 text-green-500" />
            Connect WhatsApp
          </DialogTitle>
          <DialogDescription>
            Scan the QR code with your WhatsApp mobile app to connect
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col items-center gap-4 py-4">
          {connectionStatus === "connected" ? (
            <div className="flex flex-col items-center gap-4">
              <div className="w-48 h-48 rounded-lg bg-green-50 dark:bg-green-950 flex items-center justify-center">
                <Check className="w-20 h-20 text-green-500" />
              </div>
              <p className="text-sm text-muted-foreground text-center">
                WhatsApp is connected and ready to receive messages
              </p>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  onClick={() => disconnectMutation.mutate()}
                  disabled={disconnectMutation.isPending}
                  data-testid="button-whatsapp-disconnect"
                >
                  Disconnect
                </Button>
                <Button
                  variant="destructive"
                  onClick={() => logoutMutation.mutate()}
                  disabled={logoutMutation.isPending}
                  data-testid="button-whatsapp-logout"
                >
                  <LogOut className="w-4 h-4 mr-2" />
                  Logout
                </Button>
              </div>
            </div>
          ) : connectionStatus === "qr" && qrCode ? (
            <div className="flex flex-col items-center gap-4">
              <div className="p-4 bg-white rounded-lg">
                <img
                  src={qrCode}
                  alt="WhatsApp QR Code"
                  className="w-48 h-48"
                  data-testid="img-whatsapp-qr"
                />
              </div>
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Smartphone className="w-4 h-4" />
                <span>Open WhatsApp on your phone</span>
              </div>
              <ol className="text-sm text-muted-foreground space-y-1 list-decimal list-inside">
                <li>Tap Menu or Settings</li>
                <li>Tap Linked Devices</li>
                <li>Tap Link a Device</li>
                <li>Scan the QR code</li>
              </ol>
              <p className="text-xs text-muted-foreground">
                QR code expires in 5 minutes if not scanned
              </p>
              <Button
                variant="outline"
                onClick={() => disconnectMutation.mutate()}
                disabled={disconnectMutation.isPending}
                data-testid="button-whatsapp-cancel-qr"
              >
                Cancel
              </Button>
            </div>
          ) : connectionStatus === "connecting" ? (
            <div className="flex flex-col items-center gap-4">
              <div className="w-48 h-48 rounded-lg bg-muted flex items-center justify-center">
                <Loader2 className="w-12 h-12 animate-spin text-muted-foreground" />
              </div>
              <p className="text-sm text-muted-foreground">
                Connecting to WhatsApp...
              </p>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  onClick={() => disconnectMutation.mutate()}
                  disabled={disconnectMutation.isPending}
                  data-testid="button-whatsapp-stop"
                >
                  Stop
                </Button>
                <Button
                  variant="destructive"
                  onClick={() => logoutMutation.mutate()}
                  disabled={logoutMutation.isPending}
                  data-testid="button-whatsapp-logout-connecting"
                >
                  <LogOut className="w-4 h-4 mr-2" />
                  Logout & Clear
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-4">
              <div className="w-48 h-48 rounded-lg bg-muted flex items-center justify-center">
                <QrCode className="w-20 h-20 text-muted-foreground" />
              </div>
              <p className="text-sm text-muted-foreground text-center">
                Click to generate a QR code for scanning
              </p>
              <Button
                onClick={() => connectMutation.mutate()}
                disabled={connectMutation.isPending}
                data-testid="button-whatsapp-scan-qr"
              >
                {connectMutation.isPending ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <QrCode className="w-4 h-4 mr-2" />
                )}
                Scan QR Code
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
