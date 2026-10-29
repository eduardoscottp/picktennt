import type { NextConfig } from "next";
import legalPublication from "./content/legal/ios/publication.json";

if (process.env.VERCEL_ENV === "production" && !legalPublication.effectiveDate) {
  throw new Error("Legal documents are still a review copy. Approve the text and set its effective date before production deployment.");
}

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: [
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "X-Frame-Options", value: "DENY" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
      { key: "Strict-Transport-Security", value: "max-age=31536000" },
    ] }];
  },
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "lh3.googleusercontent.com" }, // Google profile photos
      { protocol: "https", hostname: "qmiljmxnnryhuaudpuff.supabase.co" },             // Supabase storage
    ],
  },
  experimental: {
    serverActions: { bodySizeLimit: "2mb" },
  },
};

export default nextConfig;
