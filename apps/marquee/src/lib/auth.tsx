import type { Backend } from "@baas/core";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { BackendKind } from "./backend";
import {
  createSupabaseIdentityProvider,
  type IdentityProvider,
  type IdentityResult,
} from "./identity";
import type { MarqueeSchema } from "./schema";

/**
 * Phase 3 auth context. One issuer (the pluggable `IdentityProvider`, Supabase by
 * default) is the single sign-in; the ACTIVE data backend is then wired from that
 * session per its capability:
 *  - Supabase (`managesCredentials: true`): seat the session on its client so RLS
 *    sees `auth.uid()`.
 *  - Convex (`managesCredentials: false`): feed the issuer's token via `setToken`;
 *    Convex verifies it.
 *  - Memory: no auth (open dev sandbox).
 * Switching backends re-wires from the same session, so it is one login across
 * both. Roles come from a `profiles` row (default `member`).
 */
type Role = "guest" | "member" | "editor" | "admin";

interface AuthUser {
  readonly userId: string;
  readonly email: string;
  readonly role: Role;
}

interface AuthContextValue {
  readonly user: AuthUser | null;
  /** False while the initial session sync is in flight. */
  readonly ready: boolean;
  /** Convenience gate (server enforcement is the real guard): catalog write rights. */
  readonly canEditCatalog: boolean;
  signIn(email: string, password: string): Promise<IdentityResult>;
  signUp(email: string, password: string): Promise<IdentityResult>;
  signOut(): Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function makeIdp(): IdentityProvider | null {
  const url = import.meta.env.VITE_SUPABASE_URL;
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY;
  return url && key ? createSupabaseIdentityProvider(url, key) : null;
}

/** Read the caller's role from their profile row; default `member` when absent. */
async function loadRole(backend: Backend<MarqueeSchema>, userId: string): Promise<Role> {
  const res = await backend.store.list<{ role: Role }>("profiles", {
    where: [["userId", "eq", userId]],
    limit: 1,
  });
  return res.ok ? (res.data.items[0]?.role ?? "member") : "member";
}

interface AuthProviderProps {
  readonly backend: Backend<MarqueeSchema>;
  readonly backendKind: BackendKind;
  readonly children: React.ReactNode;
}

export function AuthProvider({
  backend,
  backendKind,
  children,
}: AuthProviderProps): React.JSX.Element {
  // One issuer instance for the app's lifetime (its session persists reloads).
  const idpRef = useRef<IdentityProvider | null>(null);
  if (idpRef.current === null) idpRef.current = makeIdp();
  const idp = idpRef.current;

  const [user, setUser] = useState<AuthUser | null>(null);
  const [ready, setReady] = useState(false);

  /** Wire the active backend to the issuer's session, then load identity + role. */
  const sync = useCallback(async (): Promise<void> => {
    setReady(false);
    try {
      if (!idp) {
        setUser(null);
        return;
      }
      const session = await idp.getSession();
      if (!session) {
        setUser(null);
        return;
      }
      if (backendKind === "supabase") {
        const client = backend.store.native() as SupabaseClient;
        await client.auth.setSession({
          access_token: session.accessToken,
          refresh_token: session.refreshToken,
        });
      } else if (backendKind === "convex") {
        backend.auth.setToken(async () => idp.getToken());
      }
      const [identity, email] = await Promise.all([backend.auth.getIdentity(), idp.email()]);
      if (identity.ok && identity.data && email) {
        setUser({
          userId: identity.data.subject,
          email,
          role: await loadRole(backend, identity.data.subject),
        });
      } else {
        setUser(null);
      }
    } finally {
      setReady(true);
    }
  }, [backend, backendKind, idp]);

  // Re-sync whenever the active backend changes (a switch re-wires the session).
  useEffect(() => {
    void sync();
  }, [sync]);

  const signIn = useCallback(
    async (email: string, password: string): Promise<IdentityResult> => {
      if (!idp) return { ok: false, message: "Auth is not configured." };
      const r = await idp.signIn(email, password);
      if (!r.ok) return r;
      await sync();
      return { ok: true };
    },
    [idp, sync],
  );

  const signUp = useCallback(
    async (email: string, password: string): Promise<IdentityResult> => {
      if (!idp) return { ok: false, message: "Auth is not configured." };
      const created = await idp.signUp(email, password);
      if (!created.ok) return created;
      // Local dev has email confirmation off, so sign straight in.
      const r = await idp.signIn(email, password);
      if (!r.ok) return r;
      await sync();
      return { ok: true };
    },
    [idp, sync],
  );

  const signOut = useCallback(async (): Promise<void> => {
    if (idp) await idp.signOut();
    if (backendKind === "supabase") {
      await (backend.store.native() as SupabaseClient).auth.signOut().catch(() => undefined);
    } else if (backendKind === "convex") {
      backend.auth.clearToken();
    }
    setUser(null);
  }, [backend, backendKind, idp]);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      ready,
      canEditCatalog: user?.role === "editor" || user?.role === "admin",
      signIn,
      signUp,
      signOut,
    }),
    [user, ready, signIn, signUp, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
}
