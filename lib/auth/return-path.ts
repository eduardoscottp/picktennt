const origin = 'https://picktennt.invalid';

/** Only application destinations; authentication URLs must never become continuations. */
export function safeReturnPath(value: string | null | undefined): string {
  if (!value || value.length > 4096 || /[\\\u0000-\u0020\u007f]/.test(value)) return '/dashboard';
  try {
    const decoded = decodeURIComponent(value);
    if (/[\\\u0000-\u0020\u007f]/.test(decoded) || !decoded.startsWith('/') || decoded.startsWith('//')) return '/dashboard';
    const url = new URL(value, origin);
    if (url.origin !== origin || !/^\/(dashboard|profile|setup|tournaments|join|s)(\/|$)/.test(url.pathname) && url.pathname !== '/oauth/authorize') return '/dashboard';
    for (const key of ['code', 'token', 'token_hash', 'access_token', 'refresh_token', 'password']) {
      if (url.searchParams.has(key)) return '/dashboard';
    }
    return url.pathname + url.search;
  } catch {
    return '/dashboard';
  }
}

export function authPath(path: string, destination: string) {
  return `${path}?redirect=${encodeURIComponent(safeReturnPath(destination))}`;
}
