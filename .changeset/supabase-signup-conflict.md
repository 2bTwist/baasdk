---
"@baas/adapter-supabase": patch
---

`signUp()` now detects a duplicate registration reliably. It maps by the stable `error.code === "user_already_exists"` instead of regex-matching the (localized, version-dependent) error message, and it surfaces the enumeration-protection obfuscated success (a user with an empty `identities` array and no session, returned when email confirmation is ON) as `conflict` rather than a misleading `ok(null)`. A genuine confirmation-pending signup (one identity, no session) is still `ok(null)`.
