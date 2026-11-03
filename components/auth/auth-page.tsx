import { Suspense } from 'react';
import { createClient } from '@/lib/supabase/server';
import { AuthForm, type AuthMode } from './auth-form';

export async function AuthPage({ mode }: { mode: AuthMode }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return <Suspense><AuthForm mode={mode} signedIn={!!user} /></Suspense>;
}
