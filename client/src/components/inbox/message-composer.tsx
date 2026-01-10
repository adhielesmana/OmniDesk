import { useState, useRef, useEffect } from "react";
import { Send, Paperclip, Smile, Mic, Image as ImageIcon, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
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

export function MessageComposer({
  onSendMessage,
  isSending,
  platform,
}: MessageComposerProps) {
  const [message, setMessage] = useState("");
  const [attachmentPreview, setAttachmentPreview] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleSubmit = () => {
    if (!message.trim() && !attachmentPreview) return;
    onSendMessage(message.trim(), attachmentPreview || undefined);
    setMessage("");
    setAttachmentPreview(null);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setAttachmentPreview(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 200)}px`;
    }
  }, [message]);

  return (
    <div className="border-t border-border bg-card p-4">
      {attachmentPreview && (
        <div className="mb-3 relative inline-block">
          <img
            src={attachmentPreview}
            alt="Attachment preview"
            className="h-20 rounded-lg border border-border"
          />
          <Button
            variant="secondary"
            size="icon"
            className="absolute -top-2 -right-2 h-6 w-6 rounded-full"
            onClick={() => setAttachmentPreview(null)}
            data-testid="button-remove-attachment"
          >
            <X className="h-3 w-3" />
          </Button>
        </div>
      )}

      <div className="flex items-end gap-2">
        <div className="flex gap-1">
          <input
            type="file"
            ref={fileInputRef}
            className="hidden"
            accept="image/*"
            onChange={handleFileSelect}
            data-testid="input-file-upload"
          />
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => fileInputRef.current?.click()}
                data-testid="button-attach-file"
              >
                <Paperclip className="h-5 w-5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Attach file</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => fileInputRef.current?.click()}
                data-testid="button-attach-image"
              >
                <ImageIcon className="h-5 w-5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Send image</TooltipContent>
          </Tooltip>
        </div>

        <div className="flex-1 relative">
          <Textarea
            ref={textareaRef}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type a message..."
            className="min-h-[44px] max-h-[200px] resize-none pr-10"
            rows={1}
            data-testid="input-message"
          />
          <Button
            variant="ghost"
            size="icon"
            className="absolute right-1 bottom-1 h-8 w-8"
            data-testid="button-emoji"
          >
            <Smile className="h-5 w-5" />
          </Button>
        </div>

        <div className="flex gap-1">
          {!message.trim() && !attachmentPreview ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" data-testid="button-voice">
                  <Mic className="h-5 w-5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Send voice message</TooltipContent>
            </Tooltip>
          ) : (
            <Button
              onClick={handleSubmit}
              disabled={isSending || (!message.trim() && !attachmentPreview)}
              data-testid="button-send"
            >
              <Send className="h-4 w-4 mr-2" />
              Send
            </Button>
          )}
        </div>
      </div>

      <div className="mt-2 flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          Press Enter to send, Shift+Enter for new line
        </p>
        <p className="text-xs text-muted-foreground">
          {message.length}/4096
        </p>
      </div>
    </div>
  );
}
