import { format as dateFnsFormat, isToday, isYesterday } from "date-fns";
import { formatInTimeZone, toZonedTime } from "date-fns-tz";

export const APP_TIMEZONE = "Asia/Jakarta";

export function formatTime(date: Date | string | null | undefined): string {
  if (!date) return "";
  try {
    return formatInTimeZone(new Date(date), APP_TIMEZONE, "h:mm a");
  } catch {
    return "";
  }
}

export function formatFullTime(date: Date | string | null | undefined): string {
  if (!date) return "";
  try {
    return formatInTimeZone(new Date(date), APP_TIMEZONE, "h:mm:ss a");
  } catch {
    return "";
  }
}

export function formatDate(date: Date | string | null | undefined): string {
  if (!date) return "";
  try {
    const zonedDate = toZonedTime(new Date(date), APP_TIMEZONE);
    if (isToday(zonedDate)) return "Today";
    if (isYesterday(zonedDate)) return "Yesterday";
    return formatInTimeZone(new Date(date), APP_TIMEZONE, "MMMM d, yyyy");
  } catch {
    return "";
  }
}

export function formatDateTime(date: Date | string | null | undefined): string {
  if (!date) return "";
  try {
    return formatInTimeZone(new Date(date), APP_TIMEZONE, "MMM d, yyyy h:mm a");
  } catch {
    return "";
  }
}

export function formatShortDate(date: Date | string | null | undefined): string {
  if (!date) return "";
  try {
    return formatInTimeZone(new Date(date), APP_TIMEZONE, "MMM d");
  } catch {
    return "";
  }
}

export function formatRelativeTime(date: Date | string | null | undefined): string {
  if (!date) return "";
  try {
    const now = new Date();
    const targetDate = new Date(date);
    const diffMs = now.getTime() - targetDate.getTime();
    const diffMins = Math.floor(diffMs / (1000 * 60));
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffMins < 1) return "just now";
    if (diffMins < 60) return `${diffMins}m`;
    if (diffHours < 24) return `${diffHours}h`;
    if (diffDays < 7) return `${diffDays}d`;
    
    return formatInTimeZone(targetDate, APP_TIMEZONE, "MMM d");
  } catch {
    return "";
  }
}

export function toJakartaTime(date: Date | string): Date {
  return toZonedTime(new Date(date), APP_TIMEZONE);
}
