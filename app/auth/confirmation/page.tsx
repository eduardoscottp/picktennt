import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import {
  ArrowRight,
  CircleCheckBig,
  ClockAlert,
  MailCheck,
  ShieldCheck,
} from "lucide-react";

export const metadata: Metadata = {
  title: "Email confirmation | Picktennt",
  description: "Picktennt email confirmation status.",
  robots: { index: false, follow: false },
};

type ConfirmationStatus = "success" | "expired" | "invalid";

const content = {
  success: {
    eyebrow: "EMAIL CONFIRMED",
    title: "You’re all set.",
    description:
      "Your email address has been confirmed successfully. You can now return to Picktennt and sign in to your account.",
    detail: "This confirmation link has been securely verified.",
    action: "Continue to Picktennt",
    href: "/login",
    Icon: CircleCheckBig,
    tone: "success",
  },
  expired: {
    eyebrow: "LINK EXPIRED",
    title: "This link has expired.",
    description:
      "For your security, confirmation links only work for a limited time. Return to Picktennt and request a new confirmation email.",
    detail: "Your account is safe. No changes were made.",
    action: "Return to Picktennt",
    href: "/",
    Icon: ClockAlert,
    tone: "warning",
  },
  invalid: {
    eyebrow: "LINK NOT AVAILABLE",
    title: "We couldn’t confirm this email.",
    description:
      "The link may have already been used or may be incomplete. Return to Picktennt and request a new confirmation email.",
    detail: "Your account is safe. No changes were made.",
    action: "Return to Picktennt",
    href: "/",
    Icon: MailCheck,
    tone: "warning",
  },
} as const;

function normalizeStatus(value: string | string[] | undefined): ConfirmationStatus {
  const status = Array.isArray(value) ? value[0] : value;
  return status === "success" || status === "expired" ? status : "invalid";
}

export default async function ConfirmationPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string | string[] }>;
}) {
  const status = normalizeStatus((await searchParams).status);
  const state = content[status];
  const isSuccess = state.tone === "success";

  return (
    <main className="relative flex min-h-dvh items-center justify-center overflow-hidden bg-slate-950 px-5 py-12 text-slate-900">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(43,175,199,0.28),transparent_38%),radial-gradient(circle_at_bottom_right,rgba(22,125,144,0.22),transparent_42%)]" />
      <div className="absolute left-[-7rem] top-[-7rem] h-80 w-80 rounded-full border border-white/10" />
      <div className="absolute bottom-[-10rem] right-[-8rem] h-96 w-96 rounded-full border border-white/10" />

      <section className="relative w-full max-w-xl overflow-hidden rounded-[2rem] border border-white/20 bg-white shadow-2xl shadow-black/30">
        <div className="h-2 bg-gradient-to-r from-brand-300 via-brand-500 to-brand-700" />

        <div className="px-7 py-8 sm:px-12 sm:py-11">
          <div className="mb-10 flex items-center justify-between gap-4">
            <Link href="/" className="flex items-center gap-3" aria-label="Picktennt home">
              <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-50 ring-1 ring-brand-100">
                <Image
                  src="/images/logo.png"
                  alt=""
                  width={34}
                  height={34}
                  className="object-contain"
                  priority
                />
              </span>
              <span className="text-lg font-black tracking-[0.12em] text-slate-900">
                PICKTENNT
              </span>
            </Link>

            <span className="flex items-center gap-1.5 rounded-full bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-600">
              <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
              Secure verification
            </span>
          </div>

          <div
            className={`mb-7 flex h-16 w-16 items-center justify-center rounded-2xl ${
              isSuccess
                ? "bg-emerald-50 text-emerald-600 ring-1 ring-emerald-100"
                : "bg-amber-50 text-amber-600 ring-1 ring-amber-100"
            }`}
          >
            <state.Icon className="h-8 w-8" strokeWidth={2.25} aria-hidden="true" />
          </div>

          <p
            className={`mb-3 text-xs font-extrabold tracking-[0.2em] ${
              isSuccess ? "text-emerald-700" : "text-amber-700"
            }`}
          >
            {state.eyebrow}
          </p>
          <h1 className="mb-4 text-3xl font-black tracking-tight text-slate-950 sm:text-4xl">
            {state.title}
          </h1>
          <p className="text-base leading-7 text-slate-600">{state.description}</p>

          <div className="my-8 h-px bg-slate-200" />

          <p className="mb-7 flex items-start gap-2.5 text-sm leading-6 text-slate-500">
            <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-brand-600" aria-hidden="true" />
            {state.detail}
          </p>

          <Link
            href={state.href}
            className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-brand-700 px-5 py-3.5 text-sm font-bold text-white shadow-lg shadow-brand-700/20 transition hover:bg-brand-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-700"
          >
            {state.action}
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Link>
        </div>

        <footer className="border-t border-slate-200 bg-slate-50 px-7 py-5 text-center text-xs leading-5 text-slate-500 sm:px-12">
          Need help?{" "}
          <a className="font-semibold text-brand-700 hover:text-brand-800" href="mailto:info@picktennt.com">
            info@picktennt.com
          </a>
        </footer>
      </section>
    </main>
  );
}
