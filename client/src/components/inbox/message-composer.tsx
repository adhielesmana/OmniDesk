import { useEffect, useRef } from "react";

interface MessageComposerProps {
  onSendMessage: (content: string, mediaUrl?: string) => void;
  isSending: boolean;
  platform: string;
}

export function MessageComposer({
  onSendMessage,
  isSending,
}: MessageComposerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const onSendRef = useRef(onSendMessage);
  const isSendingRef = useRef(isSending);
  
  onSendRef.current = onSendMessage;
  isSendingRef.current = isSending;

  useEffect(() => {
    if (!containerRef.current) return;
    
    const input = document.createElement("input");
    input.type = "text";
    input.placeholder = "Type a message and press Enter...";
    input.autocomplete = "off";
    input.setAttribute("data-testid", "input-message");
    input.style.cssText = `
      width: 100%;
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
    
    containerRef.current.appendChild(input);
    inputRef.current = input;
    
    return () => {
      if (input.parentNode) {
        input.parentNode.removeChild(input);
      }
    };
  }, []);

  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.disabled = isSending;
    }
  }, [isSending]);

  return (
    <div 
      ref={containerRef}
      style={{ borderTop: "1px solid #333", padding: "12px" }}
    />
  );
}
