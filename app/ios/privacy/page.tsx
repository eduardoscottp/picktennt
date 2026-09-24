import type { Metadata } from "next";
import { LegalDocument, type DocumentContent } from "@/components/legal/legal-document";
import privacy from "@/content/legal/ios/privacy.json";
import publication from "@/content/legal/ios/publication.json";

export const metadata: Metadata = {
  title: "Privacy Policy | Picktennt for iPhone & Apple Watch",
  description: "How Picktennt handles account, game and Apple Health information, and your privacy choices.",
  alternates: { canonical: "/ios/privacy" },
  robots: { index: Boolean(publication.effectiveDate), follow: true },
};

export default function PrivacyPage() {
  return <LegalDocument document={privacy as DocumentContent} />;
}
