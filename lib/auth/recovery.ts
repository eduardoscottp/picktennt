import { createHmac, timingSafeEqual } from 'node:crypto';

export const RECOVERY_COOKIE = 'picktennt-web-recovery';
export const RECOVERY_SECONDS = 15 * 60;

export function hasEmailIdentity(user: { identities?: { provider: string }[] }) {
  return user.identities?.some(identity => identity.provider === 'email') === true;
}

// A validated recovery OTP creates a short-lived grant bound to that exact session.
export function recoveryGrant(userId: string, accessToken: string, secret: string, expires = Date.now() + RECOVERY_SECONDS * 1000) {
  const payload = String(expires);
  const signature = createHmac('sha256', secret).update(`${userId}:${accessToken}:${payload}`).digest('hex');
  return `${payload}.${signature}`;
}

export function validRecoveryGrant(grant: string | undefined, userId: string, accessToken: string, secret: string, now = Date.now()) {
  if (!grant || !/^\d{13}\.[a-f0-9]{64}$/.test(grant)) return false;
  const expires = Number(grant.split('.')[0]);
  if (expires <= now || expires > now + RECOVERY_SECONDS * 1000) return false;
  const expected = recoveryGrant(userId, accessToken, secret, expires);
  return timingSafeEqual(Buffer.from(grant), Buffer.from(expected));
}
