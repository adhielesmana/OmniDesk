import { useEffect, useRef, memo } from "react";
import { Send } from "lucide-react";
import { Button } from "@/components/ui/button";

interface MessageComposerProps {
  onSendMessage: (content: string, mediaUrl?: string) => void;
  isSending: boolean;
  platform: string;
  conversationId?: string;
}

export const MessageComposer = memo(function MessageComposer({
  onSendMessage,
  isSending,
  conversationId,
}: MessageComposerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const onSendRef = useRef(onSendMessage);
  const isSendingRef = useRef(isSending);
  const conversationIdRef = useRef(conversationId);
  
  onSendRef.current = onSendMessage;
  isSendingRef.current = isSending;
  conversationIdRef.current = conversationId;

  const handleSend = () => {
    if (!inputRef.current) return;
    const message = inputRef.current.value.trim();
    if (message && !isSendingRef.current) {
      console.log("[MessageComposer] Sending message for conversationId:", conversationId, "message:", message.substring(0, 30));
      onSendRef.current(message);
      inputRef.current.value = "";
    }
  };

  useEffect(() => {
    if (!containerRef.current || inputRef.current) return;
    
    const input = document.createElement("input");
    input.type = "text";
    input.placeholder = "Type a message...";
    input.autocomplete = "off";
    input.setAttribute("data-testid", "input-message");
    input.style.cssText = `
      flex: 1;
      padding: 12px 16px;
      border: 1px solid #555;
      border-radius: 8px;
      background-color: #1a1a1a;
      color: #ffffff;
      font-size: 14px;
      outline: none;
      box-sizing: border-box;
    `;
    
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        const message = input.value.trim();
        if (message && !isSendingRef.current) {
          console.log("[MessageComposer:Enter] Sending for conversationId:", conversationIdRef.current, "message:", message.substring(0, 30));
          onSendRef.current(message);
          input.value = "";
        }
      }
    });
    
    input.addEventListener("focus", () => {
      input.style.borderColor = "#3b82f6";
    });
    
    input.addEventListener("blur", () => {
      input.style.borderColor = "#555";
    });
    
    containerRef.current.insertBefore(input, containerRef.current.firstChild);
    inputRef.current = input;
    
    return () => {
      if (input.parentNode) {
        input.parentNode.removeChild(input);
      }
      inputRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.disabled = isSending;
    }
  }, [isSending]);

  return (
    <div style={{ borderTop: "1px solid #333", padding: "12px" }}>
      <div 
        ref={containerRef}
        style={{ display: "flex", gap: "8px", alignItems: "center" }}
      >
        <Button
          size="icon"
          onClick={handleSend}
          disabled={isSending}
          className="h-10 w-10 rounded-full shrink-0"
          data-testid="button-send"
        >
          <Send className="h-5 w-5" />
        </Button>
      </div>
    </div>
  );
}, (prevProps, nextProps) => {
  return prevProps.isSending === nextProps.isSending;
});
