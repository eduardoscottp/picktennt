import type { Metadata } from "next";
import { LegalDocument, type DocumentContent } from "@/components/legal/legal-document";
import terms from "@/content/legal/ios/terms.json";
import publication from "@/content/legal/ios/publication.json";

export const metadata: Metadata = {
  title: "Terms of Use | Picktennt for iPhone & Apple Watch",
  description: "Terms for the Picktennt iPhone and Apple Watch app, provided by Idddeas LLC.",
  alternates: { canonical: "/ios/terms" },
  robots: { index: Boolean(publication.effectiveDate), follow: true },
};

export default function TermsPage() {
  return <LegalDocument document={terms as DocumentContent} />;
}
