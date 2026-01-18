const AVATAR_COLORS = [
  { bg: "#ef4444", text: "#ffffff" }, // red
  { bg: "#f97316", text: "#ffffff" }, // orange
  { bg: "#f59e0b", text: "#ffffff" }, // amber
  { bg: "#eab308", text: "#000000" }, // yellow
  { bg: "#84cc16", text: "#000000" }, // lime
  { bg: "#22c55e", text: "#ffffff" }, // green
  { bg: "#14b8a6", text: "#ffffff" }, // teal
  { bg: "#06b6d4", text: "#ffffff" }, // cyan
  { bg: "#0ea5e9", text: "#ffffff" }, // sky
  { bg: "#3b82f6", text: "#ffffff" }, // blue
  { bg: "#6366f1", text: "#ffffff" }, // indigo
  { bg: "#8b5cf6", text: "#ffffff" }, // violet
  { bg: "#a855f7", text: "#ffffff" }, // purple
  { bg: "#d946ef", text: "#ffffff" }, // fuchsia
  { bg: "#ec4899", text: "#ffffff" }, // pink
  { bg: "#f43f5e", text: "#ffffff" }, // rose
];

export function getAvatarColor(name: string | null | undefined): { bg: string; text: string } {
  if (!name) return AVATAR_COLORS[0];
  
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  
  const index = Math.abs(hash) % AVATAR_COLORS.length;
  return AVATAR_COLORS[index];
}

export function getInitials(name: string | null | undefined): string {
  if (!name) return "?";
  return name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}
