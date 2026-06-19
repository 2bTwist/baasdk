/**
 * baasdk console, ONE todo app, swapped between two backends at runtime, with a
 * one-click cutover via @baas/migrate.
 *
 * Layout: the center panel is the todo APP (add / check / delete). The left and
 * right panels are the RAW database tables (Supabase Postgres rows / Convex
 * documents), read-only, so you can see exactly what the app wrote and watch it
 * move when you migrate. The app and both tables are driven by the SAME baasdk
 * surface; `makeSupabase()`/`makeConvex()` are the only backend-specific code.
 */
import { createConvexBackend } from "@baas/adapter-convex";
import { createMemoryBackend, MemoryError } from "@baas/adapter-memory";
import { createSupabaseBackend } from "@baas/adapter-supabase";
import type { Backend } from "@baas/core";
import { migrate } from "@baas/migrate";
import { createClient } from "@supabase/supabase-js";
import { ConvexClient } from "convex/browser";
import { anyApi } from "convex/server";

declare global {
  interface Window {
    BAAS_CONFIG?: {
      mode?: string;
      supabaseUrl?: string;
      supabaseKey?: string;
      convexUrl?: string;
    };
  }
}
const cfg = window.BAAS_CONFIG;
// REAL mode talks to YOUR OWN local Supabase + Convex (via a config.js you
// generate locally). With no such config the demo runs entirely in-memory in the
// browser: no server, no database, nothing saved, the public, spam-proof default.
const REAL = Boolean(cfg && cfg.mode === "real" && cfg.supabaseUrl && cfg.convexUrl);

type Which = "supabase" | "convex";
type Row = Record<string, unknown>;

// --- Backend wiring (the ONLY backend-specific code) ------------------------

function makeSupabase(): Backend {
  const sb = createClient(cfg?.supabaseUrl ?? "", cfg?.supabaseKey ?? "", {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return createSupabaseBackend({
    client: sb,
    realtime: { listTodos: { tables: ["todos"] } },
    queries: {
      listTodos: async (c) => {
        const { data, error } = await c.from("todos").select("*").order("created_at");
        if (error) throw error;
        return data ?? [];
      },
    },
    mutations: {
      addTodo: async (c, { title }: { title: string }) => {
        const { data, error } = await c
          .from("todos")
          .insert({ title, done: false })
          .select("id")
          .single();
        if (error) throw error;
        return data.id;
      },
      toggleTodo: async (c, { id }: { id: string }) => {
        const { data, error } = await c.from("todos").select("done").eq("id", id).maybeSingle();
        if (error) throw error;
        if (!data) throw new Error("not found");
        const { error: e2 } = await c.from("todos").update({ done: !data.done }).eq("id", id);
        if (e2) throw e2;
      },
    },
  });
}

function makeConvex(): Backend {
  const client = new ConvexClient(cfg?.convexUrl ?? "");
  const todos = anyApi.todos;
  return createConvexBackend({
    client,
    queries: { listTodos: todos.listTodos, getTodo: todos.getTodo },
    mutations: { addTodo: todos.addTodo, toggleTodo: todos.toggleTodo },
  });
}

// An in-memory backend is a real Backend with no server: it passes the same
// conformance suite the real adapters do. The public demo runs two of these.
function makeMemory(): Backend {
  return createMemoryBackend({
    queries: { listTodos: (ctx) => ctx.all("todos") },
    mutations: {
      addTodo: (ctx, { title }: { title: string }) => ctx.insert("todos", { title, done: false }),
      toggleTodo: (ctx, { id }: { id: string }) => {
        const t = ctx.get<{ done: boolean }>("todos", id as never);
        if (!t) throw new MemoryError("not_found", "no todo");
        ctx.patch("todos", id as never, { done: !t.done });
      },
    },
  });
}

const backends: Record<Which, Backend> = REAL
  ? { supabase: makeSupabase(), convex: makeConvex() }
  : { supabase: makeMemory(), convex: makeMemory() };

const ACCENT: Record<Which, string> = { supabase: "#3ecf8e", convex: "#f0612f" };
const LABEL: Record<Which, string> = { supabase: "Supabase", convex: "Convex" };
const other = (w: Which): Which => (w === "supabase" ? "convex" : "supabase");
let active: Which = "supabase";

// --- Helpers ----------------------------------------------------------------

const $ = (id: string) => document.getElementById(id) as HTMLElement;
function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string,
  );
}
const truncId = (v: unknown): string => {
  const s = String(v);
  return s.length > 13 ? `${s.slice(0, 6)}…${s.slice(-4)}` : s;
};
function setNote(msg: string, isErr = false): void {
  const note = $("migrate-note");
  note.innerHTML = msg;
  note.classList.toggle("err", isErr);
}

// Fetch the RAW rows straight from each backend via native(), the escape hatch.
// In-memory: read the in-process store. Real: Supabase PostgREST / Convex helper.
async function fetchRaw(which: Which): Promise<{ rows: Row[]; idField: string }> {
  if (!REAL) {
    const db = backends[which].store.native() as { all: (collection: string) => Row[] };
    return { rows: db.all("todos"), idField: "_id" };
  }
  if (which === "supabase") {
    const sb = backends.supabase.store.native() as ReturnType<typeof createClient>;
    const { data, error } = await sb.from("todos").select("*").order("created_at");
    if (error) throw error;
    return { rows: (data ?? []) as Row[], idField: "id" };
  }
  const c = backends.convex.store.native() as ConvexClient;
  const rows = (await c.query(anyApi.baas.list, { collection: "todos" })) as Row[];
  return { rows: rows ?? [], idField: "_id" };
}

// Flash bookkeeping: rows that just appeared (added or migrated in) pulse once.
const seenRaw: Record<Which, Set<string>> = { supabase: new Set(), convex: new Set() };
const rawDrawn: Record<Which, boolean> = { supabase: false, convex: false };
let seenApp = new Set<string>();
let appDrawn = false;

// --- Render: the two RAW tables (read-only proof) ---------------------------

function renderRawTable(which: Which, rows: Row[], idField: string): void {
  const table = $(`list-${which}`);
  const live = $(`live-${which}`);
  live.textContent = "live";
  live.classList.add("on");
  $(`count-${which}`).innerHTML =
    `<b>${rows.length}</b> ${which === "supabase" ? "row" : "document"}${rows.length === 1 ? "" : "s"}`;

  if (rows.length === 0) {
    table.innerHTML = `<tbody><tr><td class="empty">no rows yet</td></tr></tbody>`;
    seenRaw[which] = new Set();
    rawDrawn[which] = true;
    return;
  }
  const PREF = [idField, "title", "done", "migratedFrom"];
  const present = Object.keys(rows[0]);
  const cols = PREF.filter((c) => present.includes(c));
  const head = `<thead><tr>${cols
    .map((c) => `<th>${escapeHtml(c === idField ? "id" : c === "migratedFrom" ? "from" : c)}</th>`)
    .join("")}</tr></thead>`;
  const next = new Set<string>();
  const body = rows
    .map((row) => {
      const id = String(row[idField]);
      next.add(id);
      const fresh = rawDrawn[which] && !seenRaw[which].has(id);
      const cells = cols
        .map((c) => {
          const v = row[c];
          if (c === idField) return `<td class="id">${escapeHtml(truncId(v))}</td>`;
          if (c === "migratedFrom")
            return `<td class="lineage">${v == null ? "·" : escapeHtml(truncId(v))}</td>`;
          if (typeof v === "boolean") return `<td class="bool-${v}">${v}</td>`;
          if (c === "title") return `<td class="title">${escapeHtml(String(v))}</td>`;
          return `<td>${escapeHtml(String(v))}</td>`;
        })
        .join("");
      return `<tr class="${row.done ? "done" : ""} ${fresh ? "landed" : ""}" data-id="${escapeHtml(id)}">${cells}</tr>`;
    })
    .join("");
  table.innerHTML = `${head}<tbody>${body}</tbody>`;
  seenRaw[which] = next;
  rawDrawn[which] = true;
}

// --- Render: the todo APP list (interactive, the active backend) ------------

function renderTodoApp(rows: Row[], idField: string): void {
  const list = $("todo-list");
  if (rows.length === 0) {
    list.innerHTML = `<li class="todo-empty">No todos on ${LABEL[active]} yet, add one above.</li>`;
    seenApp = new Set();
    appDrawn = true;
    return;
  }
  const next = new Set<string>();
  list.innerHTML = rows
    .map((row) => {
      const id = String(row[idField]);
      next.add(id);
      const done = row.done === true;
      const fresh = appDrawn && !seenApp.has(id);
      return `<li class="todo ${done ? "done" : ""} ${fresh ? "landed" : ""}" data-id="${escapeHtml(id)}">
        <button class="check" data-act="toggle" aria-label="toggle done">${done ? "✓" : ""}</button>
        <span class="todo-title">${escapeHtml(String(row.title ?? ""))}</span>
        <button class="del" data-act="delete" aria-label="delete">×</button>
      </li>`;
    })
    .join("");
  seenApp = next;
  appDrawn = true;
}

// Read a backend and repaint its raw table; if it's the active one, repaint the
// app list too. This runs on load, after every mutation, and on each live tick,
// so the UI never depends on realtime being healthy.
async function refresh(which: Which): Promise<void> {
  const { rows, idField } = await fetchRaw(which);
  renderRawTable(which, rows, idField);
  if (which === active) renderTodoApp(rows, idField);
}

// --- Live updates (a bonus on top of explicit refresh) ----------------------

for (const which of ["supabase", "convex"] as Which[]) {
  try {
    backends[which].store.subscribe("listTodos", {}, async (r) => {
      if (!r.ok) {
        setNote(`${LABEL[which]}: ${r.error.code}, ${escapeHtml(r.error.message)}`, true);
        return;
      }
      try {
        await refresh(which);
      } catch (e) {
        setNote(e instanceof Error ? escapeHtml(e.message) : String(e), true);
      }
    });
  } catch (e) {
    setNote(
      `${LABEL[which]} live updates unavailable: ${e instanceof Error ? escapeHtml(e.message) : String(e)}`,
      true,
    );
  }
}

// --- App interactions -------------------------------------------------------

// Add to the active backend.
$("form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const input = $("title") as HTMLInputElement;
  const title = input.value.trim();
  if (!title) return;
  input.value = "";
  try {
    const r = await backends[active].store.mutate("addTodo", { title });
    if (!r.ok) setNote(`${LABEL[active]}: ${r.error.code}, ${escapeHtml(r.error.message)}`, true);
    await refresh(active);
  } catch (err) {
    setNote(err instanceof Error ? escapeHtml(err.message) : String(err), true);
  }
});

// Check off / delete a todo (acts on the active backend).
$("todo-list").addEventListener("click", async (e) => {
  const btn = (e.target as HTMLElement).closest("button");
  if (!btn) return;
  const id = (btn.closest("li") as HTMLElement | null)?.dataset.id;
  if (!id) return;
  try {
    if (btn.dataset.act === "toggle") await backends[active].store.mutate("toggleTodo", { id });
    else await backends[active].store.remove("todos", id);
    await refresh(active);
  } catch (err) {
    setNote(err instanceof Error ? escapeHtml(err.message) : String(err), true);
  }
});

// --- The cutover (one click, replaces the target with a fresh snapshot) ------

function playFlow(dst: Which): void {
  const conduit = $("conduit");
  // Supabase deck is on the LEFT, Convex on the RIGHT, so the packets travel
  // toward whichever backend is the destination.
  const cls = dst === "convex" ? "flow-right" : "flow-left";
  conduit.querySelectorAll<HTMLElement>(".packet").forEach((p, i) => {
    p.style.animationDelay = `${i * 0.1}s`;
  });
  conduit.classList.remove("flow-right", "flow-left");
  void conduit.offsetWidth;
  conduit.classList.add(cls);
  window.setTimeout(() => conduit.classList.remove(cls), 1200);
}

async function clearBackend(which: Which): Promise<void> {
  for (;;) {
    const r = await backends[which].store.list("todos", {});
    if (!r.ok) throw new Error(`${LABEL[which]}: ${r.error.message}`);
    const items = r.data.items as { _id: string }[];
    if (items.length === 0) break;
    for (const it of items) {
      const rm = await backends[which].store.remove("todos", it._id);
      if (!rm.ok) throw new Error(`${LABEL[which]}: ${rm.error.message}`);
    }
  }
}

let migrating = false;

/** Highlight which provider the toggle shows as active (no side effects). */
function markToggle(b: Which): void {
  for (const el of $("toggle").querySelectorAll("button")) {
    el.classList.toggle("on", (el as HTMLElement).dataset.b === b);
  }
}

/**
 * Cut over from the active backend to the other: clear the target, copy a fresh
 * snapshot in, then continue on the target. Triggered by the migrate button AND
 * by switching providers (the switch auto-migrates). Guarded against re-entry.
 */
async function runCutover(): Promise<void> {
  if (migrating) return;
  const src = active;
  const dst = other(active);
  migrating = true;
  const btn = $("migrate") as HTMLButtonElement;
  btn.disabled = true;
  markToggle(dst); // light up the destination immediately for responsiveness
  playFlow(dst);
  setNote(`moving your todos to ${LABEL[dst]}…`);
  try {
    await clearBackend(dst); // replace: target becomes a clean snapshot, no dupes
    const report = await migrate(backends[src], backends[dst], {
      collections: ["todos"],
      stripFields: ["id", "created_at"],
      onProgress: (ev) => setNote(`moving your todos to ${LABEL[dst]}… <b>${ev.done}</b>`),
    });
    if (!report.ok) {
      setNote(`couldn't move todos: ${escapeHtml(report.error?.error.message ?? "")}`, true);
      markToggle(src); // migration didn't complete; stay on the source
      await refresh(src);
      await refresh(dst);
    } else {
      const c = report.collections.todos;
      setNote(`Moved <b>${c?.copied ?? 0}</b> todos to ${LABEL[dst]}.`);
      applyActive(dst); // a cutover moves you to the fresh copy; continue there
      await refresh(src);
    }
  } catch (err) {
    setNote(err instanceof Error ? escapeHtml(err.message) : String(err), true);
    markToggle(src);
  } finally {
    migrating = false;
    btn.disabled = false;
  }
}

$("migrate").addEventListener("click", () => void runCutover());

// --- The backend switch (which backend the app is pointed at) ---------------

function applyActive(b: Which): void {
  active = b;
  const dst = other(b);
  markToggle(b);
  // Direction-aware accents drive the app panel, conduit, checkboxes, button.
  const app = $("app");
  app.style.setProperty("--from", ACCENT[b]);
  app.style.setProperty("--to", ACCENT[dst]);
  // Fixed positions, only the arrow flips to show source -> target.
  $("migrate-label").textContent = `Supabase ${b === "supabase" ? "→" : "←"} Convex`;
  appDrawn = false; // switching backends shouldn't flash the whole list
  void refresh(b); // show the newly-active backend's todos in the app
}

// Switching providers AUTO-MIGRATES your todos to the new backend (a cutover),
// then continues there. The migrate button does the same thing explicitly.
$("toggle").addEventListener("click", (e) => {
  const b = (e.target as HTMLElement).closest("button")?.dataset.b as Which | undefined;
  if (b && b !== active) void runCutover();
});

// --- Initial load: paint both tables + the app, independent of realtime -----

// In-memory mode (the public default): show the banner, and hide the local-only
// "open table" links, which only resolve against a local stack.
if (!REAL) {
  const banner = document.getElementById("mode-banner");
  if (banner) banner.style.display = "flex";
  for (const a of document.querySelectorAll(".deck-ft a")) {
    (a as HTMLElement).style.display = "none";
  }
}

applyActive("supabase");
void (async () => {
  for (const which of ["supabase", "convex"] as Which[]) {
    try {
      await refresh(which);
    } catch (e) {
      setNote(`${LABEL[which]}: ${e instanceof Error ? escapeHtml(e.message) : String(e)}`, true);
    }
  }
})();

// --- Hero code switcher: the same store calls, a different import per backend.
// Static illustration; guarded so it never interferes with the live demo. ------
const snipCode = document.getElementById("snip-code");
if (snipCode) {
  const SNIPPETS: Record<string, { name: string; create: string }> = {
    supabase: {
      name: "Supabase",
      create:
        'import { createSupabaseBackend } from "@baas/adapter-supabase";\n\n' +
        "const backend = createSupabaseBackend({\n  url: process.env.SUPABASE_URL,\n  key: process.env.SUPABASE_KEY,\n});",
    },
    convex: {
      name: "Convex",
      create:
        'import { createConvexBackend } from "@baas/adapter-convex";\n\n' +
        "const backend = createConvexBackend({\n  url: process.env.CONVEX_URL,\n});",
    },
    memory: {
      name: "In-memory",
      create:
        'import { createMemoryBackend } from "@baas/adapter-memory";\n\n' +
        "const backend = createMemoryBackend({ queries: {}, mutations: {} });",
    },
  };
  const SHARED =
    "\n\n// these calls never change across backends\n" +
    'await backend.store.insert("todos", { title, done: false });\n' +
    'const page = await backend.store.list("todos", {\n  where: [["done", "eq", false]],\n});';

  const hl = (code: string): string =>
    code
      .split("\n")
      .map((line) => {
        const esc = escapeHtml(line);
        if (line.trim().startsWith("//")) return `<span class="c-cm">${esc}</span>`;
        return esc
          .replace(/(&quot;.*?&quot;)/g, '<span class="c-str">$1</span>')
          .replace(/\b(import|from|const|await|false|true)\b/g, '<span class="c-kw">$1</span>')
          .replace(
            /\b(createSupabaseBackend|createConvexBackend|createMemoryBackend|insert|list)\b/g,
            '<span class="c-fn">$1</span>',
          );
      })
      .join("\n");

  let plain = "";
  const renderSnippet = (p: string): void => {
    const t = SNIPPETS[p];
    if (!t) return;
    plain = `${t.create}${SHARED}`;
    snipCode.innerHTML = hl(plain);
    const name = document.getElementById("snip-name");
    if (name) name.textContent = t.name;
    for (const el of document.querySelectorAll("#snip-logos button")) {
      el.classList.toggle("on", (el as HTMLElement).dataset.p === p);
    }
  };

  document.getElementById("snip-logos")?.addEventListener("click", (e) => {
    const p = (e.target as HTMLElement).closest("button")?.dataset.p;
    if (p) renderSnippet(p);
  });
  document.getElementById("snip-copy")?.addEventListener("click", () => {
    void navigator.clipboard?.writeText(plain);
    const b = document.getElementById("snip-copy");
    if (b) {
      b.textContent = "Copied";
      window.setTimeout(() => (b.textContent = "Copy"), 1200);
    }
  });
  renderSnippet("supabase");
}
