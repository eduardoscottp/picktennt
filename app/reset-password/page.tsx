import { Suspense } from 'react';
import { cookies } from 'next/headers';
import { AuthForm } from '@/components/auth/auth-form';
import { createClient } from '@/lib/supabase/server';
import { RECOVERY_COOKIE, hasEmailIdentity, validRecoveryGrant } from '@/lib/auth/recovery';

export default async function ResetPasswordPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: { session } } = await supabase.auth.getSession();
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const grant = (await cookies()).get(RECOVERY_COOKIE)?.value;
  const allowed = !!user && !!session && !!secret && hasEmailIdentity(user) && validRecoveryGrant(grant, user.id, session.access_token, secret);
  return <Suspense><AuthForm mode="reset" recoveryAllowed={allowed} /></Suspense>;
}
