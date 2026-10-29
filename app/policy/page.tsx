import Link from "next/link";
import type { Metadata, Viewport } from "next";
import { LegalShell } from "@/components/legal/legal-document";
import publication from "@/content/legal/ios/publication.json";

export const metadata: Metadata = {
  title: "Legal & Privacy | Picktennt",
  description: "Read the terms and privacy documents for your Picktennt app.",
  robots: { index: Boolean(publication.effectiveDate), follow: true },
};
export const viewport: Viewport = { width: "device-width", initialScale: 1, maximumScale: 5, userScalable: true };

export default function PolicyPage() {
  return (
    <LegalShell>
      <p className="mb-3 text-xs font-bold uppercase tracking-widest text-cyan-800">Your information. Your choices.</p>
      <h1 className="text-4xl font-bold tracking-tight text-slate-950 sm:text-5xl">Legal &amp; privacy</h1>
      <p className="mt-5 max-w-2xl text-lg leading-8 text-slate-600">Read how Picktennt works and how your information is handled.</p>
      <h2 className="mb-5 mt-12 text-xl font-bold">iPhone &amp; Apple Watch</h2>
      <div className="grid gap-5 sm:grid-cols-2">
        <Link href="/ios/terms" className="rounded-2xl border border-slate-200 bg-white p-7 transition hover:border-cyan-600">
          <h3 className="text-xl font-bold text-cyan-800">Terms of Use →</h3>
          <p className="mt-3 leading-7 text-slate-600">Your account, recreational use, safety, and the terms for using Picktennt.</p>
        </Link>
        <Link href="/ios/privacy" className="rounded-2xl border border-slate-200 bg-white p-7 transition hover:border-cyan-600">
          <h3 className="text-xl font-bold text-cyan-800">Privacy Policy →</h3>
          <p className="mt-3 leading-7 text-slate-600">Account and game information, Apple Health, deletion, and your choices.</p>
        </Link>
      </div>
      <section className="mt-10 rounded-xl border border-slate-200 p-6">
        <h2 className="font-bold">Android &amp; Wear OS</h2>
        <Link href="/privacy" className="mt-3 inline-block text-cyan-800 underline">Read the Android privacy policy</Link>
      </section>
    </LegalShell>
  );
}
