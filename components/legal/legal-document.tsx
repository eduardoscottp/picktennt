import Link from "next/link";
import type { ReactNode } from "react";
import publication from "@/content/legal/ios/publication.json";

type Block = { kind: "heading" | "paragraph" | "list"; text?: string; items?: string[]; id?: string };
export type DocumentContent = { title: string; blocks: Block[] };

function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*|\[[^\]]+\]\([^)]+\))/g).filter(Boolean).map((part, index) => {
    if (part.startsWith("**")) return <strong key={index}>{part.slice(2, -2)}</strong>;
    const link = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if (link && /^(\/|https:\/\/|mailto:)/.test(link[2])) {
      return <a key={index} href={link[2]} className="font-medium text-cyan-800 underline decoration-cyan-300 underline-offset-4">{link[1]}</a>;
    }
    return part;
  });
}

export function LegalShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-dvh bg-slate-50 text-slate-800">
      <header className="border-b border-slate-200 bg-white px-5 py-5 print:hidden">
        <nav aria-label="Legal navigation" className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-4 text-sm">
          <Link href="/policy" className="text-xl font-black tracking-tight text-cyan-700">PICKTENNT</Link>
          <div className="flex flex-wrap gap-5 font-medium">
            <Link href="/ios/terms" className="hover:underline">Terms of Use</Link>
            <Link href="/ios/privacy" className="hover:underline">Privacy Policy</Link>
            <Link href="/support" className="hover:underline">Support</Link>
          </div>
        </nav>
      </header>
      <main className="mx-auto max-w-5xl px-5 py-10 sm:py-16">
        {!publication.effectiveDate && (
          <aside role="note" className="mb-8 rounded-xl border border-amber-300 bg-amber-50 px-5 py-4 text-sm leading-6 text-amber-950">
            <strong>Review copy — not yet in effect.</strong> These documents are being reviewed before publication.
          </aside>
        )}
        {children}
      </main>
      <footer className="mx-auto max-w-5xl border-t border-slate-200 px-5 py-8 text-sm leading-7 text-slate-600">
        <p>Idddeas LLC · Miami, Florida, USA</p>
        <a href="mailto:info@picktennt.com" className="text-cyan-800 underline">info@picktennt.com</a>
        <p>Version {publication.version} · {publication.effectiveDate ? `Effective ${publication.effectiveDate}` : "Effective date pending publication"}</p>
      </footer>
    </div>
  );
}

export function LegalDocument({ document }: { document: DocumentContent }) {
  const headings = document.blocks.filter((block) => block.kind === "heading");
  const contents = (
    <ol className="space-y-2">
      {headings.map((heading) => <li key={heading.id}><a className="hover:text-cyan-800 hover:underline" href={`#${heading.id}`}>{heading.text}</a></li>)}
    </ol>
  );
  return (
    <LegalShell>
      <p className="mb-3 text-xs font-bold uppercase tracking-widest text-cyan-800">iPhone &amp; Apple Watch</p>
      <h1 className="text-4xl font-bold tracking-tight text-slate-950 sm:text-5xl">{document.title}</h1>
      <p className="mt-4 text-slate-600">Picktennt · Version {publication.version}</p>
      <div className="mt-10 grid items-start gap-10 md:grid-cols-[210px_minmax(0,1fr)]">
        <nav aria-label="On this page" className="rounded-xl border border-slate-200 bg-white p-5 text-sm leading-6 print:hidden">
          <details className="md:hidden">
            <summary className="cursor-pointer font-bold text-slate-900">On this page</summary>
            <div className="mt-4">{contents}</div>
          </details>
          <div className="hidden md:block">
            <p className="mb-3 font-bold text-slate-900">On this page</p>
            {contents}
          </div>
        </nav>
        <article className="min-w-0 rounded-2xl border border-slate-200 bg-white px-6 pb-8 sm:px-9 print:border-0">
          {document.blocks.map((block, index) => {
            if (block.kind === "heading") return <h2 id={block.id} key={index} className="mb-4 mt-9 scroll-mt-8 text-xl font-bold tracking-tight text-slate-950">{block.text}</h2>;
            if (block.kind === "list") return <ul key={index} className="my-5 list-disc space-y-3 pl-5 leading-7">{block.items?.map((item, i) => <li key={i}>{inline(item)}</li>)}</ul>;
            return <p key={index} className="my-5 break-words leading-7">{inline(block.text ?? "")}</p>;
          })}
        </article>
      </div>
    </LegalShell>
  );
}
