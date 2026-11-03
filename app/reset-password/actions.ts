'use server';

import { cookies } from 'next/headers';
import { createClient } from '@/lib/supabase/server';
import { hasEmailIdentity, RECOVERY_COOKIE, validRecoveryGrant } from '@/lib/auth/recovery';
import { authError } from '@/lib/auth/errors';

export async function updateRecoveredPassword(password: string, confirmation: string) {
  if (!password || password.length > 1024 || password !== confirmation) return { error: 'Enter matching passwords.' };
  const store = await cookies();
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  const { data: { session } } = await supabase.auth.getSession();
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (error || !user || !session || !secret || !hasEmailIdentity(user) || !validRecoveryGrant(store.get(RECOVERY_COOKIE)?.value, user.id, session.access_token, secret)) {
    return { error: 'This reset link is unavailable or expired. Request a new link.' };
  }
  const result = await supabase.auth.updateUser({ password });
  if (result.error) return { error: authError(result.error) };
  store.delete(RECOVERY_COOKIE);
  await supabase.auth.signOut();
  return { success: true };
}
