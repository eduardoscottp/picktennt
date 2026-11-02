"use client";

import { useRef, useState, type FormEvent } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { authPath, safeReturnPath } from '@/lib/auth/return-path';
import { authError } from '@/lib/auth/errors';
import { updateRecoveredPassword } from '@/app/reset-password/actions';

export type AuthMode = 'login' | 'signup' | 'forgot' | 'verify' | 'reset';

function PasswordField({ id, label, autoComplete }: { id: string; label: string; autoComplete: string }) {
  const [visible, setVisible] = useState(false);
  return <div className="relative">
    <Input className="pr-20 text-base border-brand-500 focus:ring-brand-500" id={id} name={id} label={label} type={visible ? 'text' : 'password'} autoComplete={autoComplete} required maxLength={1024} aria-describedby="auth-error" onChange={event => event.currentTarget.removeAttribute('aria-invalid')} />
    <button type="button" className="absolute right-2 top-7 min-h-11 px-2 text-sm font-semibold text-brand-800" aria-label={`${visible ? 'Hide' : 'Show'} ${label.toLowerCase()}`} aria-pressed={visible} onClick={() => { setVisible(!visible); document.getElementById(id)?.focus(); }}>{visible ? 'Hide' : 'Show'}</button>
  </div>;
}

export function AuthForm({ mode = 'login', signedIn = false, recoveryAllowed = false }: { mode?: AuthMode; signedIn?: boolean; recoveryAllowed?: boolean }) {
  const search = useSearchParams();
  const next = safeReturnPath(search.get('redirect'));
  const [loading, setLoading] = useState(false);
  const pending = useRef(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState(search.has('error') ? 'This link or sign-in attempt could not be completed. Please try again.' : '');
  const [verification, setVerification] = useState(false);
  const [resetDone, setResetDone] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const credentials = mode === 'login' || mode === 'signup';
  const appleAvailable = process.env.NEXT_PUBLIC_APPLE_WEB_ENABLED === 'true';
  const title = signedIn ? 'You’re signed in' : resetDone ? 'Password updated' : ({ login: 'Welcome back', signup: 'Create your account', forgot: 'Forgot password?', verify: 'Check your email', reset: 'Set a new password' })[mode];
  const primary = ({ login: 'Sign in', signup: 'Create account', forgot: 'Send reset link', verify: 'Resend email', reset: 'Update password' })[mode];

  async function run(action: () => Promise<void>) {
    if (pending.current) return;
    pending.current = true;
    setLoading(true); setError(''); setMessage('');
    try { await action(); } catch { setError(authError(null)); }
    finally { pending.current = false; setLoading(false); }
  }

  function confirmationUrl(flow: 'signup' | 'recovery') {
    const url = new URL('/auth/web-confirm', window.location.origin);
    url.searchParams.set('flow', flow); url.searchParams.set('next', next);
    return url.toString();
  }

  async function provider(name: 'apple' | 'google') {
    await run(async () => {
      const url = new URL('/auth/callback', window.location.origin);
      url.searchParams.set('next', next);
      const supabase = createClient();
      // Expired-session cleanup must finish before OAuth writes its new PKCE verifier.
      await supabase.auth.getSession();
      const { error } = await supabase.auth.signInWithOAuth({ provider: name, options: { redirectTo: url.toString() } });
      if (error) setError(authError(error));
    });
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const email = String(data.get('email') ?? '').trim();
    const password = String(data.get('password') ?? '');
    if ((mode === 'signup' || mode === 'reset') && password !== data.get('confirmation')) {
      setError('Passwords do not match.');
      const field = formRef.current?.elements.namedItem('confirmation') as HTMLInputElement | null;
      field?.setAttribute('aria-invalid', 'true'); field?.focus(); return;
    }
    await run(async () => {
      const supabase = createClient();
      if (mode === 'login') {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) { setError(authError(error)); setVerification(error.code === 'email_not_confirmed'); }
        else window.location.assign(next);
      } else if (mode === 'signup') {
        const { data, error } = await supabase.auth.signUp({ email, password, options: { emailRedirectTo: confirmationUrl('signup') } });
        if (error) setError(authError(error));
        else if (data.session) window.location.assign(next);
        else window.location.assign(authPath('/auth/verify-email', next));
      } else if (mode === 'forgot') {
        const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: confirmationUrl('recovery') });
        if (error && (error.status === 429 || !error.status || error.status >= 500)) setError(authError(error));
        else setMessage('If an eligible email/password account exists, we’ll send a reset link. Check your inbox and spam folder.');
      } else if (mode === 'verify') {
        const { error } = await supabase.auth.resend({ type: 'signup', email, options: { emailRedirectTo: confirmationUrl('signup') } });
        if (error && (error.status === 429 || !error.status || error.status >= 500)) setError(authError(error));
        else setMessage('If your account needs confirmation, we’ll send a new email. Check your inbox and spam folder.');
      } else if (mode === 'reset' && recoveryAllowed) {
        const result = await updateRecoveredPassword(password, String(data.get('confirmation') ?? ''));
        if (result.error) setError(result.error);
        else { formRef.current?.reset(); setResetDone(true); }
      }
    });
  }

  const unavailable = mode === 'reset' && !recoveryAllowed && !resetDone;
  return <main className="min-h-dvh flex items-center justify-center bg-gradient-to-br from-brand-500 to-brand-700 px-4 py-8">
    <section className="w-full max-w-md rounded-3xl border-t-4 border-brand-500 bg-white p-6 sm:p-8 shadow-xl" aria-labelledby="auth-title">
      <Link href="/" className="mb-6 flex items-center gap-3 font-black tracking-wide text-brand-800"><Image src="/images/logo.png" alt="" width={40} height={40} />PICKTENNT</Link>
      {next.startsWith('/join/') || next.startsWith('/tournaments/') ? <p className="mb-3 rounded-xl bg-brand-50 p-3 text-sm text-brand-900">Continue to your tournament. You’ll review it before joining.</p> : next.startsWith('/s/') ? <p className="mb-3 text-sm text-brand-800">Continue to your session invitation.</p> : null}
      <h1 id="auth-title" className="text-2xl font-black text-brand-700">{unavailable ? 'Reset link unavailable' : title}</h1>
      <p className="mt-2 mb-6 text-sm text-gray-600">{signedIn ? 'Continue with this account, or sign out to choose another.' : unavailable ? 'Request a new email/password recovery link. Social sign-in accounts should use their original method.' : resetDone ? 'Sign in with your new password to continue.' : credentials ? 'Use the same sign-in method you used in the app.' : mode === 'verify' ? 'Follow the confirmation link to continue. Need another email? Enter your address below.' : mode === 'forgot' ? 'Enter the email you use for email/password sign-in.' : 'Choose and confirm your new password.'}</p>
      <p id="auth-error" role="alert" className={error ? 'mb-4 rounded-xl bg-red-50 p-3 text-sm text-red-800' : 'sr-only'}>{error}</p>
      <div role="status" aria-live="polite">{message && <p className="mb-4 rounded-xl bg-brand-50 p-3 text-sm text-brand-900">{message}</p>}</div>
      {signedIn ? <div className="space-y-3"><Button asChild className="w-full bg-brand-500 text-gray-900 hover:bg-brand-400 min-h-12"><Link href={next}>Continue</Link></Button><Button variant="outline" disabled={loading} className="w-full min-h-12" onClick={() => run(async () => { const { error } = await createClient().auth.signOut(); if (error) setError(authError(error)); else window.location.assign(authPath('/login', next)); })}>Use a different account</Button></div> : unavailable ? <Link className="font-semibold text-brand-800 underline" href={authPath('/forgot-password', next)}>Request a new link</Link> : resetDone ? <Link className="font-semibold text-brand-800 underline" href={authPath('/login', next)}>Continue to sign in</Link> : <>
        {credentials && <div className="space-y-3 mb-5">
          <Button className="w-full min-h-12 bg-black hover:bg-gray-800" disabled={loading || !appleAvailable} aria-describedby={!appleAvailable ? 'apple-availability' : undefined} onClick={() => provider('apple')}>
            <svg aria-hidden="true" focusable="false" className="h-5 w-5 shrink-0" viewBox="0 0 24 24" fill="currentColor"><path d="M17.05 20.28c-.98.95-2.05.8-3.08.35-1.09-.46-2.09-.48-3.24 0-1.44.62-2.2.44-3.06-.35C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.76 3.08.82 1.18-.24 2.31-.94 3.57-.85 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.08l.01-.01ZM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25Z" /></svg>
            Continue with Apple
          </Button>
          {!appleAvailable && <p id="apple-availability" className="text-sm text-gray-600">Apple sign-in is temporarily unavailable. Existing Apple users should wait until it is restored.</p>}
          <Button variant="outline" className="w-full min-h-12 border-brand-500 text-brand-800" disabled={loading} onClick={() => provider('google')}>
            <svg aria-hidden="true" focusable="false" className="h-5 w-5 shrink-0" viewBox="0 0 24 24">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" />
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
            </svg>
            Continue with Google
          </Button>
          <div className="flex items-center gap-3 pt-2 text-sm text-brand-700"><span className="h-px flex-1 bg-brand-500" /><span>or use email</span><span className="h-px flex-1 bg-brand-500" /></div>
        </div>}
        <form ref={formRef} onSubmit={submit} aria-busy={loading} className="space-y-4" aria-describedby={error ? 'auth-error' : undefined}>
          <fieldset disabled={loading} className="space-y-4">
            {mode !== 'reset' && <Input className="text-base border-brand-500 focus:ring-brand-500" id="email" name="email" label="Email" type="email" autoComplete="email" required maxLength={254} />}
            {(credentials || mode === 'reset') && <PasswordField id="password" label={mode === 'reset' ? 'New password' : 'Password'} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} />}
            {(mode === 'signup' || mode === 'reset') && <><PasswordField id="confirmation" label="Confirm password" autoComplete="new-password" /><p className="text-xs text-gray-600">Use a strong, unique password. We’ll check it against your account’s security requirements.</p></>}
            {mode === 'login' && <Link className="block text-sm font-semibold text-brand-800 underline" href={authPath('/forgot-password', next)}>Forgot password?</Link>}
            <Button type="submit" loading={loading} className="w-full min-h-12 bg-brand-500 text-gray-900 hover:bg-brand-400">{loading ? 'Please wait…' : primary}</Button>
          </fieldset>
        </form>
        {verification && <Link className="mt-3 block text-sm font-semibold text-brand-800 underline" href={authPath('/auth/verify-email', next)}>Resend confirmation email</Link>}
        <p className="mt-5 text-center text-sm text-gray-600">{mode === 'login' ? <>New to Picktennt? <Link className="font-semibold text-brand-800 underline" href={authPath('/signup', next)}>Create account</Link></> : <Link className="font-semibold text-brand-800 underline" href={authPath('/login', next)}>Back to sign in</Link>}</p>
        {mode === 'verify' && <p className="mt-3 text-center text-sm"><Link className="text-brand-800 underline" href={authPath('/signup', next)}>Use a different email</Link></p>}
      </>}
      <p className="mt-6 border-t border-brand-500 pt-4 text-center text-xs text-gray-500">By continuing, you agree to our <Link href="/policy" className="underline">Terms</Link> and <Link href="/privacy" className="underline">Privacy Policy</Link>.</p>
    </section>
  </main>;
}
