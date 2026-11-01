import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { safeReturnPath, authPath } from '@/lib/auth/return-path';
import { hasEmailIdentity, RECOVERY_COOKIE, RECOVERY_SECONDS, recoveryGrant } from '@/lib/auth/recovery';

// Web-specific email templates use TokenHash. Existing native /auth/confirm stays unchanged.
export async function GET(request: NextRequest) {
  const next = safeReturnPath(request.nextUrl.searchParams.get('next'));
  const flow = request.nextUrl.searchParams.get('flow');
  const recovery = flow === 'recovery';
  const failure = new URL(authPath(recovery ? '/reset-password' : '/auth/verify-email', next), request.url);
  failure.searchParams.set('error', 'link_unavailable');
  const response = NextResponse.redirect(failure);
  response.headers.set('Cache-Control', 'no-store');
  response.headers.set('Referrer-Policy', 'no-referrer');
  if (recovery) response.cookies.delete(RECOVERY_COOKIE);
  const tokenHash = request.nextUrl.searchParams.get('token_hash');
  const type = request.nextUrl.searchParams.get('type');
  if (!tokenHash || (recovery ? type !== 'recovery' : flow !== 'signup' || !['email', 'signup'].includes(type ?? ''))) return response;
  const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: values => values.forEach(({ name, value, options }) => response.cookies.set(name, value, options)),
    },
  });
  const { data, error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: recovery ? 'recovery' : 'email' });
  if (error || !data.user || !data.session) return response;
  if (recovery) {
    const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!secret || !hasEmailIdentity(data.user)) {
      await supabase.auth.signOut({ scope: 'local' });
      return response;
    }
    response.cookies.set(RECOVERY_COOKIE, recoveryGrant(data.user.id, data.session.access_token, secret), {
      httpOnly: true, secure: request.nextUrl.protocol === 'https:', sameSite: 'lax', path: '/', maxAge: RECOVERY_SECONDS,
    });
    response.headers.set('location', new URL(authPath('/reset-password', next), request.url).toString());
  } else {
    response.headers.set('location', new URL(next, request.url).toString());
  }
  return response;
}
