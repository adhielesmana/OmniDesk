import { useRef, memo } from "react";

interface MessageComposerProps {
  onSendMessage: (content: string, mediaUrl?: string) => void;
  isSending: boolean;
  platform: string;
}

export const MessageComposer = memo(function MessageComposer({
  onSendMessage,
  isSending,
}: MessageComposerProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      const message = inputRef.current?.value?.trim();
      if (message && !isSending) {
        onSendMessage(message);
        if (inputRef.current) {
          inputRef.current.value = "";
        }
      }
    }
  };

  return (
    <div style={{ borderTop: "1px solid #333", padding: "12px" }}>
      <input
        ref={inputRef}
        type="text"
        placeholder="Type a message and press Enter..."
        onKeyDown={handleKeyDown}
        disabled={isSending}
        style={{
          width: "100%",
          padding: "12px 16px",
          border: "1px solid #555",
          borderRadius: "8px",
          backgroundColor: "#1a1a1a",
          color: "#ffffff",
          fontSize: "14px",
          outline: "none",
        }}
        data-testid="input-message"
        autoComplete="off"
      />
    </div>
  );
});
