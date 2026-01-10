import { SiWhatsapp, SiFacebook, SiInstagram } from "react-icons/si";
import type { Platform } from "@shared/schema";

interface PlatformIconProps {
  platform: Platform;
  className?: string;
}

export function PlatformIcon({ platform, className = "h-5 w-5" }: PlatformIconProps) {
  switch (platform) {
    case "whatsapp":
      return <SiWhatsapp className={`${className} text-[#25D366]`} />;
    case "instagram":
      return <SiInstagram className={`${className} text-[#E4405F]`} />;
    case "facebook":
      return <SiFacebook className={`${className} text-[#1877F2]`} />;
    default:
      return null;
  }
}

export function getPlatformColor(platform: Platform): string {
  switch (platform) {
    case "whatsapp":
      return "#25D366";
    case "instagram":
      return "#E4405F";
    case "facebook":
      return "#1877F2";
    default:
      return "#666666";
  }
}

export function getPlatformName(platform: Platform): string {
  switch (platform) {
    case "whatsapp":
      return "WhatsApp";
    case "instagram":
      return "Instagram";
    case "facebook":
      return "Facebook";
    default:
      return "Unknown";
  }
}
