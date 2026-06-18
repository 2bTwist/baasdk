/**
 * Wires the canonical ConformanceSchema onto Supabase, and — crucially for a
 * real stateful backend — resets persistent state on every construction so the
 * suite's "fresh, empty backend" precondition holds (the in-memory adapter got
 * this for free; Supabase must truncate tables and drop the test user).
 *
 * Requires a reachable local stack. Uses the service-role/secret key so the
 * reset (table truncation, auth admin delete) bypasses RLS.
 */

import { createSupabaseBackend } from "@baas/adapter-supabase";
import type { ConformanceSchema } from "@baas/conformance";
import type { Backend, DocumentId } from "@baas/core";
import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

/** True when the live stack credentials are present. Gates the suite. */
export const supabaseAvailable = Boolean(url && key);

const CONFORMANCE_EMAIL = "a@example.com";

export async function makeSupabaseConformanceBackend(): Promise<Backend<ConformanceSchema>> {
  const sb = createClient(url as string, key as string, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Reset persistent state: each test must see an empty backend.
  await sb.from("todos").delete().not("id", "is", null);
  await sb.from("notes").delete().not("id", "is", null);
  const { data: list } = await sb.auth.admin.listUsers();
  for (const u of list?.users ?? []) {
    if (u.email === CONFORMANCE_EMAIL) await sb.auth.admin.deleteUser(u.id);
  }

  return createSupabaseBackend<ConformanceSchema>({
    client: sb,
    bucket: "conformance",
    queries: {
      listTodos: async (c) => {
        const { data, error } = await c.from("todos").select("*").order("created_at");
        if (error) throw error;
        return (data ?? []).map((r) => ({ _id: r.id as DocumentId, title: r.title, done: r.done }));
      },
      getTodo: async (c, { id }) => {
        const { data, error } = await c.from("todos").select("*").eq("id", id).maybeSingle();
        if (error) throw error;
        return data ? { _id: data.id as DocumentId, title: data.title, done: data.done } : null;
      },
    },
    mutations: {
      addTodo: async (c, { title }) => {
        const { data, error } = await c
          .from("todos")
          .insert({ title, done: false })
          .select("id")
          .single();
        if (error) throw error;
        return data.id as DocumentId;
      },
      toggleTodo: async (c, { id }) => {
        const { data, error } = await c.from("todos").select("done").eq("id", id).maybeSingle();
        if (error) throw error;
        if (!data) throw new Error(`no todo ${id}`);
        const { error: upErr } = await c.from("todos").update({ done: !data.done }).eq("id", id);
        if (upErr) throw upErr;
      },
      addThenFail: async (c, { title }) => {
        const { error } = await c.from("todos").insert({ title, done: false });
        if (error) throw error;
        throw new Error("intentional failure — Supabase has no client transaction to roll back");
      },
    },
  });
}
