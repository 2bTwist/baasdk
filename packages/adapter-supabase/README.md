# @baas/adapter-supabase

The first real adapter. Implements the `@baas/core` ports over Supabase:

| Port | Supabase mapping |
|------|------------------|
| `DocumentStore` direct CRUD | PostgREST (`from(table).select/insert/update/delete`) |
| `DocumentStore` named ops (`run`/`mutate`) | app-supplied functions over the client (per-backend, like the in-memory adapter) |
| `subscribe` | one-shot by default; live updates when a `realtime` watch is declared (`reactiveQueries` flips true) |
| `AuthProvider` + `CredentialAuth` | Supabase Auth (`managesCredentials: true`) |
| `FileStore` | Supabase Storage (FileHandle = `bucket::path`) |

Declared capabilities: `multiDocumentTransactions: false` (no
client-side tx), `reactiveQueries: false`, `serverSideJoins`/`aggregations: true`
(reach them via `.native()`), `managesCredentials: true`, `fileStorage: true`.

## Usage

```ts
import { createSupabaseBackend } from "@baas/adapter-supabase";

const backend = createSupabaseBackend({
  url: process.env.SUPABASE_URL,
  key: process.env.SUPABASE_KEY, // or pass a ready `client`
  queries: {
    listTodos: async (sb) => {
      const { data, error } = await sb.from("todos").select("*");
      if (error) throw error;
      return data;
    },
  },
  mutations: {
    addTodo: async (sb, { title }) => {
      const { data, error } = await sb.from("todos").insert({ title }).select("id").single();
      if (error) throw error;
      return data.id;
    },
  },
});
```

Named operations are per-backend by design: the portable surface is
the calling convention + Result/capability shape, not the query implementations.
Rich PostgREST features (embedded joins, aggregates, RLS-aware Realtime) are
reached through `backend.store.native()` — not added to the core contract.

## Live updates (Realtime)

`subscribe()` is one-shot by default. To get live updates, declare a `realtime`
watch listing the table(s) each query reads:

```ts
const backend = createSupabaseBackend({
  url: process.env.SUPABASE_URL,
  key: process.env.SUPABASE_KEY,
  queries: { listTodos: async (sb) => { /* ... */ } },
  mutations: { /* ... */ },
  realtime: { listTodos: { tables: ["todos"] } },
});
```

Declaring any watch flips `reactiveQueries` to `true`. On a change to a watched
table the adapter re-runs the query and delivers the full fresh result (the same
shape Convex delivers), so portable subscribe code runs unchanged on both
backends. Behavior:

- The whole table is watched, not a filtered slice, so a row leaving the result
  set is never missed. Bursts of changes are coalesced into a single re-run.
- If the Realtime channel cannot establish (table not enabled, connection or auth
  failure), `onChange` receives an error `Result`, never a silent fall-back to
  one-shot. Subscribing to a query with no declared watch is also a loud error.

**Requirements.** The watched tables must be in the `supabase_realtime`
publication (see `supabase/migrations/0002_realtime.sql` for the conformance
`todos` table). On a persisted local stack apply it with `supabase migration up`;
CI applies it on a fresh `supabase start`.

**Scaling caveat.** Supabase per-client `postgres_changes` fans out under RLS
(one write with N subscribers triggers N authorized reads), and re-running the
query multiplies that. For high-write tables, prefer `native()` Realtime with a
server-side fan-in. Filtered watches are not yet supported.

## Running the conformance suite (live)

The suite runs against a real local stack and skips when its env vars are absent.

```bash
cd packages/adapter-supabase
supabase start                       # boots Postgres/PostgREST/GoTrue/Storage via Docker
# migrations in supabase/migrations/ create the `todos`/`notes` tables + bucket

export SUPABASE_URL="http://127.0.0.1:54321"
export SUPABASE_SERVICE_ROLE_KEY="$(supabase status -o env | sed -n 's/^SERVICE_ROLE_KEY="\(.*\)"$/\1/p')"

pnpm vitest run packages/adapter-supabase   # 15/15 against the live stack
supabase stop                        # tear the stack down when done
```

The service-role key is used so the test's reset (table truncation, auth-user
cleanup) bypasses RLS. The fixture (`test/fixture.ts`) resets persistent state on
every construction, since, unlike the in-memory adapter, a real database
carries state between tests.

**CI runs this on every commit.** The `supabase-conformance` job boots the same
stack in GitHub Actions via the Supabase CLI (`supabase/setup-cli` +
`supabase start`, excluding studio/analytics for speed; Realtime IS started so
the reactive `subscribe` test runs), so the portability claim is proven against a
real backend per-commit, not just locally.
