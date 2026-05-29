import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";

const COOKIE_MAX_AGE = 60 * 60 * 24 * 400; // 400 days

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const rawNext = searchParams.get("next") ?? "/dashboard";
  const next = rawNext.startsWith("/") && !rawNext.startsWith("//")
    ? rawNext
    : "/dashboard";

  if (code) {
    const supabaseResponse = NextResponse.redirect(`${origin}${next}`);

    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return request.cookies.getAll();
          },
          setAll(cookiesToSet) {
            cookiesToSet.forEach(({ name, value, options }) =>
              supabaseResponse.cookies.set(name, value, { maxAge: COOKIE_MAX_AGE, ...options })
            );
          },
        },
      }
    );

    const { data, error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error && data.user) {
      const user = data.user;
      const meta = user.user_metadata ?? {};

      // Upsert profile — guarantees it exists regardless of trigger
      await supabase.from("profiles").upsert({
        id: user.id,
        email: user.email ?? "",
        first_name: meta.given_name ?? meta.name?.split(" ")[0] ?? "",
        last_name: meta.family_name ?? meta.name?.split(" ").slice(1).join(" ") ?? "",
        avatar_url: meta.avatar_url ?? meta.picture ?? null,
      }, { onConflict: "id" });

      // Redirect new users (no DUPR ID) to setup
      const { data: profile } = await supabase
        .from("profiles")
        .select("dupr_id")
        .eq("id", user.id)
        .single();
      if (!profile?.dupr_id && next === "/dashboard") {
        const setupResponse = NextResponse.redirect(`${origin}/setup`);
        supabaseResponse.cookies.getAll().forEach(({ name, value }) => {
          setupResponse.cookies.set(name, value, { maxAge: COOKIE_MAX_AGE });
        });
        return setupResponse;
      }

      return supabaseResponse;
    }
  }

  return NextResponse.redirect(`${origin}/login?error=auth_callback_failed`);
}
