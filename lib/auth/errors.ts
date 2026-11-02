export function authError(error: { code?: string; status?: number } | null | undefined): string {
  if (error?.code === 'email_not_confirmed') return 'Confirm your email before signing in. You can resend the confirmation below.';
  if (error?.code === 'invalid_credentials') return 'Email or password is incorrect. Use the same sign-in method you used in the app.';
  if (error?.code === 'weak_password') return 'This password does not meet the account security requirements. Choose a stronger password.';
  if (error?.code === 'same_password') return 'Choose a password different from your current password.';
  if (error?.status === 429 || error?.code?.includes('rate_limit') || error?.code === 'over_email_send_rate_limit') return 'Too many attempts. Please wait before trying again.';
  return 'We could not complete this request. Please try again.';
}
