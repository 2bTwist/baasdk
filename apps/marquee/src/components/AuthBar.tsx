import { useState } from "react";
import { useAuth } from "../lib/auth";
import type { IdentityResult } from "../lib/identity";

/**
 * Header auth control. Signed out: a compact email/password form with Sign in +
 * Sign up. Signed in: the email, a role badge, and Sign out. The gating it drives
 * (e.g. catalog edit affordances) is convenience; the backend is the real guard.
 */
export function AuthBar(): React.JSX.Element {
  const { user, ready, signIn, signUp, signOut } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!ready) return <span className="auth-status">…</span>;

  if (user) {
    return (
      <div className="auth-bar">
        <span className="auth-email">{user.email}</span>
        <span className="role-badge">{user.role}</span>
        <button type="button" className="link-btn" onClick={() => void signOut()}>
          Sign out
        </button>
      </div>
    );
  }

  const run = async (fn: (e: string, p: string) => Promise<IdentityResult>): Promise<void> => {
    setBusy(true);
    setError(null);
    const r = await fn(email, password);
    setBusy(false);
    if (!r.ok) setError(r.message ?? "Could not sign in.");
  };

  return (
    <form
      className="auth-bar"
      onSubmit={(e) => {
        e.preventDefault();
        void run(signIn);
      }}
    >
      <input
        className="text-input auth-input"
        type="email"
        placeholder="email"
        autoComplete="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />
      <input
        className="text-input auth-input"
        type="password"
        placeholder="password"
        autoComplete="current-password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />
      <button type="submit" className="link-btn" disabled={busy}>
        Sign in
      </button>
      <button type="button" className="link-btn" disabled={busy} onClick={() => void run(signUp)}>
        Sign up
      </button>
      {error ? <span className="auth-error">{error}</span> : null}
    </form>
  );
}
