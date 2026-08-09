'use client';

import {
  ApolloClient,
  ApolloProvider,
  HttpLink,
  InMemoryCache,
  split,
  type NormalizedCacheObject,
} from '@apollo/client';
import { setContext } from '@apollo/client/link/context';
import { GraphQLWsLink } from '@apollo/client/link/subscriptions';
import { getMainDefinition } from '@apollo/client/utilities';
import { createClient } from 'graphql-ws';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  GRAPHQL_HTTP,
  GRAPHQL_WS,
  persistRefreshToken,
  refreshSession,
  revokeSession,
  signInWithPassword,
  signUpWithPassword,
  storedRefreshToken,
  tokenStore,
  type NhostSession,
  type NhostUser,
} from './nhost';

type AuthState = {
  user: NhostUser | null;
  ready: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string, displayName: string) => Promise<string | null>;
  signOut: () => Promise<void>;
  /** Re-mints the access token, e.g. after a membership grants new allowed roles. */
  refresh: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);
export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <Providers>');
  return ctx;
};

type RoleState = {
  orgId: string | null;
  role: string;
  setOrg: (orgId: string | null, role: string) => void;
  /**
   * Pinned to the `user` role. The org switcher must list every org the caller
   * belongs to, which the per-org roles deliberately cannot see.
   */
  userClient: ApolloClient<NormalizedCacheObject>;
};

const RoleContext = createContext<RoleState | null>(null);
export const useRole = () => {
  const ctx = useContext(RoleContext);
  if (!ctx) throw new Error('useRole must be used inside <Providers>');
  return ctx;
};

const ORG_KEY = 'awb.orgId';

function makeClient(role: string) {
  const authLink = setContext((_, { headers }) => ({
    headers: {
      ...headers,
      ...(tokenStore.accessToken ? { authorization: `Bearer ${tokenStore.accessToken}` } : {}),
      // The role is only a *request*: Hasura still resolves every row through
      // org_members, so asking for `owner` in an org you do not own yields nothing.
      'x-hasura-role': role,
    },
  }));

  const httpLink = new HttpLink({ uri: GRAPHQL_HTTP });

  const wsLink =
    typeof window === 'undefined'
      ? null
      : new GraphQLWsLink(
          createClient({
            url: GRAPHQL_WS,
            lazy: true,
            retryAttempts: 20,
            connectionParams: () => ({
              headers: {
                ...(tokenStore.accessToken
                  ? { authorization: `Bearer ${tokenStore.accessToken}` }
                  : {}),
                'x-hasura-role': role,
              },
            }),
          }),
        );

  const link = wsLink
    ? split(
        ({ query }) => {
          const def = getMainDefinition(query);
          return def.kind === 'OperationDefinition' && def.operation === 'subscription';
        },
        wsLink,
        authLink.concat(httpLink),
      )
    : authLink.concat(httpLink);

  return new ApolloClient({
    link,
    cache: new InMemoryCache(),
    defaultOptions: { watchQuery: { fetchPolicy: 'cache-and-network' } },
  });
}

export function Providers({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<NhostUser | null>(null);
  const [ready, setReady] = useState(false);
  const [orgId, setOrgId] = useState<string | null>(null);
  const [role, setRole] = useState('user');
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearSession = useCallback((): void => {
    if (refreshTimer.current) clearTimeout(refreshTimer.current);
    tokenStore.accessToken = null;
    persistRefreshToken(null);
    if (typeof window !== 'undefined') window.localStorage.removeItem(ORG_KEY);
    setUser(null);
    setOrgId(null);
    setRole('user');
  }, []);

  const applySession = useCallback((session: NhostSession): void => {
    tokenStore.accessToken = session.accessToken;
    persistRefreshToken(session.refreshToken);
    setUser(session.user);

    if (refreshTimer.current) clearTimeout(refreshTimer.current);
    const delay = Math.max((session.accessTokenExpiresIn - 60) * 1000, 30_000);
    refreshTimer.current = setTimeout(async () => {
      const token = storedRefreshToken();
      if (!token) return;
      try {
        applySessionRef.current(await refreshSession(token));
      } catch {
        clearSession();
      }
    }, delay);
  }, [clearSession]);

  const applySessionRef = useRef(applySession);
  applySessionRef.current = applySession;

  useEffect(() => {
    const token = storedRefreshToken();
    if (!token) {
      setReady(true);
      return;
    }
    refreshSession(token)
      .then(applySession)
      .catch(() => persistRefreshToken(null))
      .finally(() => setReady(true));
  }, [applySession]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const saved = window.localStorage.getItem(ORG_KEY);
    if (saved) setOrgId(saved);
  }, []);

  const setOrg = useCallback((nextOrgId: string | null, nextRole: string) => {
    setOrgId(nextOrgId);
    setRole(nextRole);
    tokenStore.role = nextRole;
    if (typeof window !== 'undefined') {
      if (nextOrgId) window.localStorage.setItem(ORG_KEY, nextOrgId);
      else window.localStorage.removeItem(ORG_KEY);
    }
  }, []);

  const auth = useMemo<AuthState>(
    () => ({
      user,
      ready,
      signIn: async (email, password) => applySession(await signInWithPassword(email, password)),
      signUp: async (email, password, displayName) => {
        const session = await signUpWithPassword(email, password, displayName);
        if (session) {
          applySession(session);
          return null;
        }
        return 'Account created. Check your inbox to verify the email, then sign in.';
      },
      signOut: async () => {
        const token = storedRefreshToken();
        clearSession();
        if (token) await revokeSession(token);
      },
      refresh: async () => {
        const token = storedRefreshToken();
        if (token) applySession(await refreshSession(token));
      },
    }),
    [user, ready, applySession, clearSession],
  );

  const client = useMemo(() => makeClient(role), [role]);
  const userClient = useMemo(() => makeClient('user'), []);

  return (
    <AuthContext.Provider value={auth}>
      <RoleContext.Provider value={{ orgId, role, setOrg, userClient }}>
        <ApolloProvider client={client}>{children}</ApolloProvider>
      </RoleContext.Provider>
    </AuthContext.Provider>
  );
}
