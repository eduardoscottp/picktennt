import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatDate(date: string | Date) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(date));
}

export function getInitials(firstName?: string | null, lastName?: string | null) {
  const f = firstName?.[0] ?? "";
  const l = lastName?.[0] ?? "";
  return (f + l).toUpperCase() || "?";
}

export function generateJoinUrl(joinCode: string) {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  return `${base}/join/${joinCode}`;
}

export function duprRatingColor(rating: number | null) {
  if (!rating) return "text-gray-400";
  if (rating >= 5.0) return "text-purple-600";
  if (rating >= 4.5) return "text-red-500";
  if (rating >= 4.0) return "text-orange-500";
  if (rating >= 3.5) return "text-yellow-500";
  return "text-green-500";
}

export function statusLabel(status: string) {
  const map: Record<string, string> = {
    draft: "Draft",
    registration: "Registration Open",
    active: "In Progress",
    finals: "Finals",
    completed: "Completed",
    scheduled: "Scheduled",
    in_progress: "In Progress",
    score_entered: "Score Entered",
    validated: "Validated",
    disputed: "Disputed",
    pending: "Pending",
    approved: "Approved",
    rejected: "Rejected",
  };
  return map[status] ?? status;
}

export function tournamentTypeLabel(type: string) {
  return { singles: "Singles", doubles: "Doubles", mixed: "Mixed" }[type] ?? type;
}
