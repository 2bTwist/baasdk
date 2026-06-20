/**
 * Phase 3: Convex trusts Supabase Auth as the shared identity provider. Supabase
 * issues ES256 JWTs; Convex VERIFIES them here (the `managesCredentials: false`,
 * verify-only design the Convex adapter declares). One sign-in, both backends
 * authenticated, each enforcing with its own native mechanism (Supabase RLS vs
 * Convex mutation-level ctx.auth checks).
 *
 * Uses the `customJwt` provider (explicit JWKS + algorithm) rather than the
 * OIDC-discovery provider, because the local Supabase issuer is HTTP and the
 * discovery flow expects HTTPS. `issuer` matches the token `iss`, `applicationID`
 * matches `aud` (Supabase sets it to "authenticated"), `jwks` is the public key
 * set, ES256 is Supabase's signing algorithm. Env-driven so it points at local or
 * hosted Supabase.
 */
const issuer = process.env.SUPABASE_AUTH_ISSUER ?? "http://127.0.0.1:55321/auth/v1";

export default {
  providers: [
    {
      type: "customJwt",
      applicationID: "authenticated",
      issuer,
      jwks: `${issuer}/.well-known/jwks.json`,
      algorithm: "ES256",
    },
  ],
};
