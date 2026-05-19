import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

const COOKIE_MAX_AGE = 60 * 60 * 24 * 400; // 400 days

export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, { maxAge: COOKIE_MAX_AGE, ...options })
            );
          } catch {}
        },
      },
    }
  );
}

export async function createAdminClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, { maxAge: COOKIE_MAX_AGE, ...options })
            );
          } catch {}
        },
      },
    }
  );
}
