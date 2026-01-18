import { useRef, useState, useCallback, memo } from "react";
import { Send, Paperclip, Smile, Mic, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { Platform } from "@shared/schema";

interface MessageComposerProps {
  onSendMessage: (content: string, mediaUrl?: string) => void;
  isSending: boolean;
  platform: Platform;
}

export const MessageComposer = memo(function MessageComposer({
  onSendMessage,
  isSending,
  platform,
}: MessageComposerProps) {
  const [attachmentPreview, setAttachmentPreview] = useState<string | null>(null);
  const [hasContent, setHasContent] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleSubmit = useCallback(() => {
    const message = textareaRef.current?.value || "";
    if (!message.trim() && !attachmentPreview) return;
    
    onSendMessage(message.trim(), attachmentPreview || undefined);
    
    if (textareaRef.current) {
      textareaRef.current.value = "";
      textareaRef.current.style.height = "auto";
    }
    setAttachmentPreview(null);
    setHasContent(false);
  }, [onSendMessage, attachmentPreview]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  }, [handleSubmit]);

  const handleInput = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 120)}px`;
    
    const newHasContent = textarea.value.trim().length > 0;
    if (newHasContent !== hasContent) {
      setHasContent(newHasContent);
    }
  }, [hasContent]);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setAttachmentPreview(reader.result as string);
        setHasContent(true);
      };
      reader.readAsDataURL(file);
    }
  }, []);

  const removeAttachment = useCallback(() => {
    setAttachmentPreview(null);
    const hasText = (textareaRef.current?.value || "").trim().length > 0;
    setHasContent(hasText);
  }, []);

  const showSendButton = hasContent || attachmentPreview;

  return (
    <div className="border-t border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 p-3">
      {attachmentPreview && (
        <div className="mb-3 relative inline-block">
          <img
            src={attachmentPreview}
            alt="Attachment preview"
            className="h-20 rounded-lg border border-border object-cover"
          />
          <Button
            variant="secondary"
            size="icon"
            className="absolute -top-2 -right-2 h-6 w-6 rounded-full shadow-md"
            onClick={removeAttachment}
            data-testid="button-remove-attachment"
          >
            <X className="h-3 w-3" />
          </Button>
        </div>
      )}

      <div className="flex items-end gap-2">
        <div className="flex-1 flex items-end gap-2 bg-muted/50 rounded-2xl border border-border/50 px-3 py-2 focus-within:border-primary/50 focus-within:ring-1 focus-within:ring-primary/20 transition-all">
          <input
            type="file"
            ref={fileInputRef}
            className="hidden"
            accept="image/*"
            onChange={handleFileSelect}
            data-testid="input-file-upload"
          />
          
          <div className="flex items-center gap-1 pb-0.5">
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="p-1.5 rounded-full hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                  data-testid="button-attach-file"
                >
                  <Paperclip className="h-5 w-5" />
                </button>
              </TooltipTrigger>
              <TooltipContent>Attach file</TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  className="p-1.5 rounded-full hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                  data-testid="button-emoji"
                >
                  <Smile className="h-5 w-5" />
                </button>
              </TooltipTrigger>
              <TooltipContent>Add emoji</TooltipContent>
            </Tooltip>
          </div>

          <textarea
            ref={textareaRef}
            defaultValue=""
            onInput={handleInput}
            onKeyDown={handleKeyDown}
            placeholder="Type a message..."
            className="flex-1 bg-transparent border-0 resize-none min-h-[24px] max-h-[120px] py-1 px-1 text-sm focus:outline-none focus:ring-0 placeholder:text-muted-foreground/70"
            rows={1}
            data-testid="input-message"
          />
        </div>

        <Tooltip>
          <TooltipTrigger asChild>
            {showSendButton ? (
              <Button
                size="icon"
                onClick={handleSubmit}
                disabled={isSending}
                className="h-10 w-10 rounded-full shrink-0 bg-primary hover:bg-primary/90"
                data-testid="button-send"
              >
                <Send className="h-5 w-5" />
              </Button>
            ) : (
              <Button
                size="icon"
                variant="secondary"
                className="h-10 w-10 rounded-full shrink-0"
                data-testid="button-voice"
              >
                <Mic className="h-5 w-5" />
              </Button>
            )}
          </TooltipTrigger>
          <TooltipContent>{showSendButton ? "Send message" : "Voice message"}</TooltipContent>
        </Tooltip>
      </div>

      <p className="text-[10px] text-muted-foreground/50 mt-2 text-center">
        Press Enter to send, Shift+Enter for new line
      </p>
    </div>
  );
});
