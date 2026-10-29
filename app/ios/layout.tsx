import type { Viewport } from "next";

// Legal text must remain readable with browser zoom and large text settings.
export const viewport: Viewport = { width: "device-width", initialScale: 1, maximumScale: 5, userScalable: true };

export default function IOSLegalLayout({ children }: { children: React.ReactNode }) {
  return children;
}
