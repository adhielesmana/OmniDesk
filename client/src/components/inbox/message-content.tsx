import { useState, useMemo, memo } from "react";
import { ExternalLink, MapPin, Play } from "lucide-react";
import { ImageLightbox } from "@/components/ui/image-lightbox";

function getProxiedMediaUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  
  // Check if it's a Twilio media URL that needs proxying
  if (url.includes('api.twilio.com') || url.includes('media.twiliocdn.com')) {
    return `/api/twilio/media?url=${encodeURIComponent(url)}`;
  }
  
  return url;
}

interface MessageContentProps {
  content: string;
  mediaUrl?: string | null;
  mediaType?: string | null;
  metadata?: string | null;
  messageId: string;
  isOutbound: boolean;
}

const URL_REGEX = /(https?:\/\/[^\s<]+[^<.,:;"')\]\s])/gi;

interface ParsedContent {
  type: "text" | "link";
  value: string;
}

function parseMessageContent(content: string): ParsedContent[] {
  const parts: ParsedContent[] = [];
  let lastIndex = 0;

  content.replace(URL_REGEX, (match, _url, offset) => {
    if (offset > lastIndex) {
      parts.push({ type: "text", value: content.slice(lastIndex, offset) });
    }
    parts.push({ type: "link", value: match });
    lastIndex = offset + match.length;
    return match;
  });

  if (lastIndex < content.length) {
    parts.push({ type: "text", value: content.slice(lastIndex) });
  }

  return parts.length > 0 ? parts : [{ type: "text", value: content }];
}

function getDomainFromUrl(url: string): string {
  try {
    const domain = new URL(url).hostname.replace("www.", "");
    return domain;
  } catch {
    return url;
  }
}

function isGoogleMapsUrl(url: string): boolean {
  return url.includes("maps.google") || url.includes("goo.gl/maps") || url.includes("google.com/maps");
}

function isYouTubeUrl(url: string): boolean {
  return url.includes("youtube.com") || url.includes("youtu.be");
}

function getYouTubeVideoId(url: string): string | null {
  const match = url.match(/(?:youtube\.com\/(?:watch\?v=|embed\/)|youtu\.be\/)([a-zA-Z0-9_-]+)/);
  return match ? match[1] : null;
}

interface LocationData {
  latitude: number;
  longitude: number;
  name?: string;
  address?: string;
}

function parseLocationMetadata(metadata: string | null): LocationData | null {
  if (!metadata) return null;
  try {
    const parsed = JSON.parse(metadata);
    if (typeof parsed.latitude === "number" && typeof parsed.longitude === "number") {
      return {
        latitude: parsed.latitude,
        longitude: parsed.longitude,
        name: parsed.name,
        address: parsed.address,
      };
    }
  } catch {
    return null;
  }
  return null;
}

function LocationPreview({ location, isOutbound }: { location: LocationData; isOutbound: boolean }) {
  const mapUrl = `https://www.google.com/maps?q=${location.latitude},${location.longitude}`;
  const staticMapUrl = `https://maps.googleapis.com/maps/api/staticmap?center=${location.latitude},${location.longitude}&zoom=15&size=300x150&markers=color:red%7C${location.latitude},${location.longitude}&key=`;
  
  const openStreetMapEmbed = `https://www.openstreetmap.org/export/embed.html?bbox=${location.longitude - 0.005}%2C${location.latitude - 0.003}%2C${location.longitude + 0.005}%2C${location.latitude + 0.003}&layer=mapnik&marker=${location.latitude}%2C${location.longitude}`;

  return (
    <a
      href={mapUrl}
      target="_blank"
      rel="noopener noreferrer"
      className="block rounded-lg overflow-hidden hover:opacity-90 transition-opacity"
      data-testid="location-preview"
    >
      <div className="relative">
        <iframe
          src={openStreetMapEmbed}
          width="280"
          height="150"
          className="border-0 pointer-events-none"
          loading="lazy"
          title="Location Map"
        />
        <div className="absolute inset-0 bg-transparent" />
      </div>
      <div className={`p-2 ${isOutbound ? "bg-primary-foreground/10" : "bg-muted"}`}>
        <div className="flex items-center gap-2">
          <MapPin className="h-4 w-4 flex-shrink-0" />
          <div className="min-w-0">
            {location.name && (
              <p className="text-sm font-medium truncate">{location.name}</p>
            )}
            {location.address ? (
              <p className="text-xs text-muted-foreground truncate">{location.address}</p>
            ) : (
              <p className="text-xs text-muted-foreground">
                {location.latitude.toFixed(6)}, {location.longitude.toFixed(6)}
              </p>
            )}
          </div>
        </div>
      </div>
    </a>
  );
}

function LinkPreview({ url, isOutbound }: { url: string; isOutbound: boolean }) {
  const domain = getDomainFromUrl(url);
  const isMap = isGoogleMapsUrl(url);
  const isYouTube = isYouTubeUrl(url);
  const videoId = isYouTube ? getYouTubeVideoId(url) : null;

  if (isMap) {
    return (
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className={`flex items-center gap-3 p-3 rounded-lg hover-elevate transition-colors ${
          isOutbound ? "bg-primary-foreground/10" : "bg-muted"
        }`}
        data-testid="link-preview-map"
      >
        <div className={`p-2 rounded-lg ${isOutbound ? "bg-primary-foreground/20" : "bg-background"}`}>
          <MapPin className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">Google Maps Location</p>
          <p className="text-xs text-muted-foreground truncate">{domain}</p>
        </div>
        <ExternalLink className="h-4 w-4 flex-shrink-0 opacity-50" />
      </a>
    );
  }

  if (isYouTube && videoId) {
    return (
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="block rounded-lg overflow-hidden hover:opacity-90 transition-opacity"
        data-testid="link-preview-youtube"
      >
        <div className="relative">
          <img
            src={`https://img.youtube.com/vi/${videoId}/mqdefault.jpg`}
            alt="YouTube video thumbnail"
            className="w-full h-auto object-cover"
            loading="lazy"
          />
          <div className="absolute inset-0 flex items-center justify-center bg-black/30">
            <div className="w-12 h-12 rounded-full bg-red-600 flex items-center justify-center">
              <Play className="h-6 w-6 text-white fill-white ml-1" />
            </div>
          </div>
        </div>
        <div className={`p-2 ${isOutbound ? "bg-primary-foreground/10" : "bg-muted"}`}>
          <p className="text-xs text-muted-foreground">youtube.com</p>
        </div>
      </a>
    );
  }

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className={`flex items-center gap-3 p-3 rounded-lg hover-elevate transition-colors ${
        isOutbound ? "bg-primary-foreground/10" : "bg-muted"
      }`}
      data-testid="link-preview"
    >
      <div className={`p-2 rounded-lg ${isOutbound ? "bg-primary-foreground/20" : "bg-background"}`}>
        <ExternalLink className="h-5 w-5" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium truncate">{domain}</p>
        <p className="text-xs text-muted-foreground truncate">{url}</p>
      </div>
    </a>
  );
}

export const MessageContent = memo(function MessageContent({
  content,
  mediaUrl,
  mediaType,
  metadata,
  messageId,
  isOutbound,
}: MessageContentProps) {
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [lightboxSrc, setLightboxSrc] = useState("");

  const locationData = useMemo(() => parseLocationMetadata(metadata ?? null), [metadata]);
  const parsedContent = useMemo(() => parseMessageContent(content || ""), [content]);
  
  // Get proxied URL for Twilio media
  const proxiedMediaUrl = useMemo(() => getProxiedMediaUrl(mediaUrl), [mediaUrl]);

  const hasMediaPlaceholder = ["[Image]", "[Video]", "[Audio]", "[Document]", "[Location]", "[Live Location]", "[Sticker]"].includes(content || "");

  const openLightbox = (src: string) => {
    setLightboxSrc(src);
    setLightboxOpen(true);
  };

  const urls = parsedContent.filter((p) => p.type === "link").map((p) => p.value);

  return (
    <div className="space-y-2">
      {proxiedMediaUrl && (
        <div className="mb-2">
          {mediaType === "image" ? (
            <>
              <img
                src={proxiedMediaUrl}
                alt="Photo"
                className="max-w-full max-h-80 rounded-lg object-contain cursor-pointer hover:opacity-90 transition-opacity"
                onClick={() => openLightbox(proxiedMediaUrl)}
                loading="lazy"
                data-testid={`media-image-${messageId}`}
              />
              <ImageLightbox
                src={lightboxSrc}
                alt="Photo"
                isOpen={lightboxOpen}
                onClose={() => setLightboxOpen(false)}
              />
            </>
          ) : mediaType === "video" ? (
            <video
              src={proxiedMediaUrl}
              controls
              className="max-w-full max-h-80 rounded-lg"
              preload="metadata"
              playsInline
              data-testid={`media-video-${messageId}`}
            />
          ) : mediaType === "audio" ? (
            <audio
              src={proxiedMediaUrl}
              controls
              className="w-full"
              preload="metadata"
              data-testid={`media-audio-${messageId}`}
            />
          ) : (
            <a
              href={proxiedMediaUrl}
              target="_blank"
              rel="noopener noreferrer"
              className={`flex items-center gap-2 p-3 rounded-lg hover-elevate ${
                isOutbound ? "bg-primary-foreground/10" : "bg-muted"
              }`}
              data-testid={`media-file-${messageId}`}
            >
              <ExternalLink className="h-5 w-5" />
              <span className="text-sm">Download attachment</span>
            </a>
          )}
        </div>
      )}

      {locationData && (
        <LocationPreview location={locationData} isOutbound={isOutbound} />
      )}

      {hasMediaPlaceholder && !proxiedMediaUrl && !locationData && (
        <div className={`flex items-center gap-2 p-3 rounded-lg ${
          isOutbound ? "bg-primary-foreground/10" : "bg-muted/50"
        } text-muted-foreground`}>
          <MapPin className="h-5 w-5" />
          <span className="text-sm">Media not available (historical message)</span>
        </div>
      )}

      {!hasMediaPlaceholder && content && (
        <p className={`text-sm whitespace-pre-wrap break-words ${isOutbound ? "" : "text-foreground"}`}>
          {parsedContent.map((part, index) => {
            if (part.type === "link") {
              return (
                <a
                  key={index}
                  href={part.value}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`underline hover:no-underline ${
                    isOutbound ? "text-primary-foreground" : "text-primary"
                  }`}
                  data-testid={`link-inline-${index}`}
                >
                  {part.value}
                </a>
              );
            }
            return <span key={index}>{part.value}</span>;
          })}
        </p>
      )}

      {urls.length > 0 && (
        <div className="space-y-2 mt-2">
          {urls.slice(0, 3).map((url, index) => (
            <LinkPreview key={index} url={url} isOutbound={isOutbound} />
          ))}
        </div>
      )}
    </div>
  );
});
