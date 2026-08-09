'use client';

export type NhostUser = {
  id: string;
  email: string;
  displayName: string;
};

export type NhostSession = {
  accessToken: string;
  accessTokenExpiresIn: number;
  refreshToken: string;
  user: NhostUser;
};

const SUBDOMAIN = process.env.NEXT_PUBLIC_NHOST_SUBDOMAIN!;
const REGION = process.env.NEXT_PUBLIC_NHOST_REGION!;

export const AUTH_URL = `https://${SUBDOMAIN}.auth.${REGION}.nhost.run/v1`;
export const GRAPHQL_HTTP = `https://${SUBDOMAIN}.graphql.${REGION}.nhost.run/v1`;
export const GRAPHQL_WS = `wss://${SUBDOMAIN}.graphql.${REGION}.nhost.run/v1`;

const REFRESH_KEY = 'awb.refreshToken';

/**
 * Kept outside React so the Apollo links always read the freshest token
 * without needing to be rebuilt on every silent refresh.
 */
export const tokenStore = {
  accessToken: null as string | null,
  role: 'user' as string,
};

async function authFetch<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${AUTH_URL}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(json?.message || json?.error || `Request failed (${res.status})`);
  }
  return json as T;
}

export const storedRefreshToken = () =>
  typeof window === 'undefined' ? null : window.localStorage.getItem(REFRESH_KEY);

export const persistRefreshToken = (token: string | null) => {
  if (typeof window === 'undefined') return;
  if (token) window.localStorage.setItem(REFRESH_KEY, token);
  else window.localStorage.removeItem(REFRESH_KEY);
};

export async function signInWithPassword(email: string, password: string): Promise<NhostSession> {
  const data = await authFetch<{ session: NhostSession | null }>('/signin/email-password', {
    email: email.trim().toLowerCase(),
    password,
  });
  if (!data.session) throw new Error('Sign-in did not return a session. Is the email verified?');
  return data.session;
}

export async function signUpWithPassword(
  email: string,
  password: string,
  displayName: string,
): Promise<NhostSession | null> {
  const data = await authFetch<{ session: NhostSession | null }>('/signup/email-password', {
    email: email.trim().toLowerCase(),
    password,
    options: { displayName },
  });
  return data.session;
}

export async function refreshSession(refreshToken: string): Promise<NhostSession> {
  return authFetch<NhostSession>('/token', { refreshToken });
}

export async function revokeSession(refreshToken: string) {
  await fetch(`${AUTH_URL}/signout`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ refreshToken, all: false }),
  }).catch(() => undefined);
}
