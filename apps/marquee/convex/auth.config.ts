/**
 * Phase 3: Convex trusts Supabase Auth as the shared identity provider. Supabase
 * is the single IdP (it manages credentials); it issues ES256 JWTs, and Convex
 * VERIFIES them here via the issuer's JWKS (the `managesCredentials: false`,
 * verify-only design the Convex adapter already declares). One sign-in, both
 * backends authenticated, each enforcing with its own native mechanism (Supabase
 * RLS vs Convex mutation-level ctx.auth checks).
 *
 * `domain` is the Supabase Auth issuer (the token `iss`); Convex fetches
 * `${domain}/.well-known/openid-configuration` to find the JWKS. `applicationID`
 * is the token `aud`, which Supabase sets to "authenticated".
 *
 * The issuer is env-driven so the same config points at local or hosted Supabase.
 */
export default {
  providers: [
    {
      domain: process.env.SUPABASE_AUTH_ISSUER ?? "http://127.0.0.1:55321/auth/v1",
      applicationID: "authenticated",
    },
  ],
};
