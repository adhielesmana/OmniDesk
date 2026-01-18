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
    <div className="border-t border-border p-3">
      <input
        ref={inputRef}
        type="text"
        placeholder="Type a message and press Enter..."
        onKeyDown={handleKeyDown}
        disabled={isSending}
        className="w-full px-4 py-3 border border-border rounded-lg bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
        data-testid="input-message"
        autoComplete="off"
      />
    </div>
  );
});
