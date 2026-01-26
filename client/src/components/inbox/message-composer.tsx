import { useEffect, useRef, memo, useCallback } from "react";
import { Send } from "lucide-react";
import { Button } from "@/components/ui/button";

interface MessageComposerProps {
  onSendMessage: (content: string, mediaUrl?: string) => void;
  isSending: boolean;
  platform: string;
  conversationId: string;
}

const DRAFT_STORAGE_KEY = "omnidesk_drafts";

function getDraft(conversationId: string): string {
  try {
    const drafts = JSON.parse(localStorage.getItem(DRAFT_STORAGE_KEY) || "{}");
    return drafts[conversationId] || "";
  } catch {
    return "";
  }
}

function saveDraft(conversationId: string, content: string) {
  try {
    const drafts = JSON.parse(localStorage.getItem(DRAFT_STORAGE_KEY) || "{}");
    if (content.trim()) {
      drafts[conversationId] = content;
    } else {
      delete drafts[conversationId];
    }
    localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(drafts));
  } catch {
    // Ignore storage errors
  }
}

function clearDraft(conversationId: string) {
  try {
    const drafts = JSON.parse(localStorage.getItem(DRAFT_STORAGE_KEY) || "{}");
    delete drafts[conversationId];
    localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(drafts));
  } catch {
    // Ignore storage errors
  }
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

  const handleSend = useCallback(() => {
    if (!inputRef.current) return;
    const message = inputRef.current.value.trim();
    if (message && !isSendingRef.current) {
      console.log("[MessageComposer] Sending message for conversationId:", conversationIdRef.current, "message:", message.substring(0, 30));
      onSendRef.current(message);
      inputRef.current.value = "";
      clearDraft(conversationIdRef.current);
    }
  }, []);

  // Create input element once
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
    
    // Restore draft on creation
    input.value = getDraft(conversationIdRef.current);
    
    // Save draft on input
    input.addEventListener("input", () => {
      saveDraft(conversationIdRef.current, input.value);
    });
    
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        const message = input.value.trim();
        if (message && !isSendingRef.current) {
          console.log("[MessageComposer:Enter] Sending for conversationId:", conversationIdRef.current, "message:", message.substring(0, 30));
          onSendRef.current(message);
          input.value = "";
          clearDraft(conversationIdRef.current);
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

  // Handle conversation change - restore draft for new conversation
  useEffect(() => {
    if (inputRef.current && conversationId) {
      const draft = getDraft(conversationId);
      inputRef.current.value = draft;
    }
  }, [conversationId]);

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
  return prevProps.isSending === nextProps.isSending && 
         prevProps.conversationId === nextProps.conversationId;
});
