import type { Metadata } from "next";
import Link from "next/link";
import { cache } from "react";
import { createClient } from "@supabase/supabase-js";
import { CalendarDays, Clock3, MapPin, Smartphone, Users, LayoutGrid } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import type { PublicPlaySessionInvitation } from "@/types/database";

type Props = { params: Promise<{ code: string }> };

const getInvitation = cache(async (code: string): Promise<PublicPlaySessionInvitation | null> => {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseAnonKey) return null;
  const supabase = createClient(
    supabaseUrl,
    supabaseAnonKey,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );
  const { data, error } = await supabase.rpc("play_session_public_invitation", {
    p_code: code.toUpperCase(),
  });
  if (error || !data?.length) return null;
  return data[0] as PublicPlaySessionInvitation;
});

function dateLabel(session: PublicPlaySessionInvitation) {
  try {
    return new Intl.DateTimeFormat("en-US", {
      weekday: "long", month: "long", day: "numeric", year: "numeric",
      hour: "numeric", minute: "2-digit", timeZoneName: "short", timeZone: session.timezone,
    }).format(new Date(session.starts_at));
  } catch {
    return new Intl.DateTimeFormat("en-US", {
      weekday: "long", month: "long", day: "numeric", year: "numeric",
      hour: "numeric", minute: "2-digit", timeZoneName: "short",
    }).format(new Date(session.starts_at));
  }
}

function invitationState(session: PublicPlaySessionInvitation) {
  if (session.cancelled_at) return { label: "Cancelled", tone: "danger" as const };
  if (new Date(session.starts_at) <= new Date()) return { label: "Registration ended", tone: "secondary" as const };
  if (session.registration_closed) return { label: "Registration closed", tone: "secondary" as const };
  if (Number(session.active_players) >= session.max_players) return { label: "Session full", tone: "secondary" as const };
  return { label: "Spots available", tone: "success" as const };
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { code } = await params;
  const session = await getInvitation(code);
  const title = session ? `Join ${session.title} on Picktennt` : "Picktennt session invitation";
  const description = session
    ? `${dateLabel(session)} at ${session.location_name}. ${session.active_players}/${session.max_players} players.`
    : "Open this invitation in Picktennt.";
  return {
    title,
    description,
    robots: { index: false, follow: false },
    openGraph: { title, description, type: "website", images: ["/images/og-image.png"] },
    twitter: { card: "summary_large_image", title, description, images: ["/images/og-image.png"] },
  };
}

export default async function SessionInvitationPage({ params }: Props) {
  const { code } = await params;
  const session = await getInvitation(code);

  if (!session) {
    return (
      <main className="min-h-dvh grid place-items-center bg-gradient-to-br from-brand-500 to-brand-800 px-4">
        <Card className="w-full max-w-md overflow-hidden">
          <div className="h-2 bg-brand-500" />
          <CardContent className="py-10 text-center space-y-4">
            <CalendarDays className="h-12 w-12 text-gray-300 mx-auto" />
            <h1 className="text-2xl font-black text-gray-900">Session not found</h1>
            <p className="text-sm text-gray-500">Check the invitation code or ask the organizer for a new link.</p>
            <Button asChild variant="outline"><Link href="/">Visit Picktennt</Link></Button>
          </CardContent>
        </Card>
      </main>
    );
  }

  const state = invitationState(session);
  const invitationUrl = `https://app.picktennt.com/s/${session.join_code}`;
  const appStoreUrl = process.env.NEXT_PUBLIC_APP_STORE_URL;

  return (
    <main className="min-h-dvh bg-gradient-to-br from-brand-500 to-brand-800 px-4 py-10">
      <div className="mx-auto max-w-lg space-y-5">
        <header className="text-center text-white">
          <div className="text-3xl font-black tracking-tight">PICK<span className="text-brand-200">TENNT</span></div>
          <p className="mt-1 text-sm text-brand-100">You have been invited to play</p>
        </header>

        <Card className="overflow-hidden shadow-xl">
          <div className="h-2 bg-gradient-to-r from-brand-300 to-brand-600" />
          <CardContent className="p-6 space-y-6">
            <div>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h1 className="text-2xl font-black text-gray-900">{session.title}</h1>
                  <p className="mt-1 text-sm text-gray-500">Hosted by {session.organizer_name || "a Picktennt player"}</p>
                </div>
                <Badge variant={state.tone}>{state.label}</Badge>
              </div>
            </div>

            <div className="grid gap-3 text-sm">
              <div className="flex gap-3"><CalendarDays className="h-5 w-5 text-brand-500 shrink-0" /><span>{dateLabel(session)}</span></div>
              <div className="flex gap-3"><Clock3 className="h-5 w-5 text-brand-500 shrink-0" /><span>{session.duration_minutes} minutes</span></div>
              <div className="flex gap-3"><MapPin className="h-5 w-5 text-brand-500 shrink-0" /><span><strong>{session.location_name}</strong><br /><span className="text-gray-500">{session.location_address}</span></span></div>
              <div className="flex gap-3"><Users className="h-5 w-5 text-brand-500 shrink-0" /><span>{session.active_players} of {session.max_players} players</span></div>
              <div className="flex gap-3"><LayoutGrid className="h-5 w-5 text-brand-500 shrink-0" /><span>{session.court_count} {session.court_count === 1 ? "court" : "courts"} · {session.format === "by_partner" ? "Choose your partner" : "Partners decided at the court"}</span></div>
            </div>

            {session.description && <p className="whitespace-pre-wrap rounded-xl bg-gray-50 p-4 text-sm leading-relaxed text-gray-700">{session.description}</p>}

            <div className="space-y-3">
              <Button asChild className="w-full h-12 text-base">
                <a href={invitationUrl}>
                  <Smartphone className="h-5 w-5" /> Open in Picktennt
                </a>
              </Button>
              {appStoreUrl ? (
                <Button asChild variant="outline" className="w-full"><a href={appStoreUrl}>Get Picktennt</a></Button>
              ) : (
                <p className="text-center text-xs text-gray-400">Install or update Picktennt, then open this invitation again.</p>
              )}
            </div>

            <div className="text-center">
              <div className="text-xs font-semibold uppercase tracking-wide text-gray-400">Invitation code</div>
              <div className="mt-1 font-mono text-xl font-black tracking-[0.2em] text-brand-700">{session.join_code}</div>
            </div>
          </CardContent>
        </Card>

        <p className="text-center text-xs text-brand-100">Opening this page does not reserve a spot. Join explicitly in the app.</p>
      </div>
    </main>
  );
}
