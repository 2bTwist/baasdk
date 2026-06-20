import type { Backend } from "@baas/core";
import type { MigratePlan, MigrateProgress, MigrateReport } from "@baas/migrate";
import { useCallback, useMemo, useState } from "react";
import { type BackendKind, makeBackend } from "../lib/backend";
import { collectionsFor, type MigrateDirection, planMigration, runMigration } from "../lib/migrate";
import type { MarqueeSchema } from "../lib/schema";

interface MigratePanelProps {
  readonly onBack: () => void;
}

const LABEL: Record<BackendKind, string> = {
  memory: "Memory",
  supabase: "Supabase",
  convex: "Convex",
};

/**
 * Phase 5 admin Migrate panel: run `@baas/migrate` Supabase<->Convex with a live
 * per-collection progress readout, on top of the SAME portable backends the app
 * uses. It constructs BOTH backends at once (the app otherwise holds one) and
 * drives a dry-run preview then a real cutover. The panel is admin-gated in the
 * UI; the real guard is credentials — see the catalog-only note for `->Supabase`.
 */
export function MigratePanel({ onBack }: MigratePanelProps): React.JSX.Element {
  // Both live backends, built once. Migration reads one and writes the other.
  const supabase = useMemo<Backend<MarqueeSchema>>(() => makeBackend("supabase"), []);
  const convex = useMemo<Backend<MarqueeSchema>>(() => makeBackend("convex"), []);

  const [direction, setDirection] = useState<MigrateDirection>({ from: "supabase", to: "convex" });
  const [plan, setPlan] = useState<MigratePlan | null>(null);
  const [report, setReport] = useState<MigrateReport | null>(null);
  const [progress, setProgress] = useState<Record<string, { phase: string; done: number }>>({});
  const [busy, setBusy] = useState<"plan" | "run" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const endpoints = useCallback(
    (d: MigrateDirection): { source: Backend<MarqueeSchema>; target: Backend<MarqueeSchema> } => ({
      source: d.from === "supabase" ? supabase : convex,
      target: d.to === "supabase" ? supabase : convex,
    }),
    [supabase, convex],
  );

  const collections = collectionsFor(direction.to);
  const catalogOnly = direction.to === "supabase";

  const flip = useCallback((): void => {
    setDirection((d) => ({ from: d.to, to: d.from }));
    setPlan(null);
    setReport(null);
    setProgress({});
    setError(null);
  }, []);

  const dryRun = useCallback(async (): Promise<void> => {
    setBusy("plan");
    setError(null);
    setReport(null);
    const { source, target } = endpoints(direction);
    try {
      setPlan(await planMigration(source, target, direction));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }, [direction, endpoints]);

  const run = useCallback(async (): Promise<void> => {
    setBusy("run");
    setError(null);
    setReport(null);
    setProgress({});
    const { source, target } = endpoints(direction);
    const onProgress = (e: MigrateProgress): void => {
      setProgress((prev) => ({ ...prev, [e.collection]: { phase: e.phase, done: e.done } }));
    };
    try {
      setReport(await runMigration(source, target, direction, onProgress));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }, [direction, endpoints]);

  return (
    <main className="form-view migrate-panel">
      <button type="button" className="link-btn" onClick={onBack}>
        ← Back to catalog
      </button>
      <h1 className="form-title">Migrate</h1>

      <div className="migrate-direction">
        <span className="backend-pill" data-kind={direction.from}>
          {LABEL[direction.from]}
        </span>
        <button
          type="button"
          className="link-btn migrate-flip"
          onClick={flip}
          disabled={busy !== null}
          aria-label="Swap direction"
        >
          →
        </button>
        <span className="backend-pill" data-kind={direction.to}>
          {LABEL[direction.to]}
        </span>
      </div>

      <p className="muted-note">
        Copies {collections.length} collections through the portable store, remapping foreign keys
        to the ids {LABEL[direction.to]} mints. Idempotent — a re-run resumes.
      </p>
      {catalogOnly ? (
        <p className="migrate-warn">
          Catalog only: reviews and profiles are row-level-security protected on Supabase, so a
          browser session cannot write them. Migrating user data into Supabase needs service
          credentials.
        </p>
      ) : null}

      <div className="form-actions">
        <button
          type="button"
          className="add-btn"
          onClick={() => void dryRun()}
          disabled={busy !== null}
        >
          {busy === "plan" ? "Planning…" : "Dry run"}
        </button>
        <button
          type="button"
          className="add-btn"
          onClick={() => void run()}
          disabled={busy !== null}
        >
          {busy === "run" ? "Migrating…" : "Run migration"}
        </button>
      </div>

      {error ? (
        <div className="error" role="alert">
          {error}
        </div>
      ) : null}

      {plan && !report ? (
        <table className="migrate-table">
          <thead>
            <tr>
              <th>Collection</th>
              <th>Total</th>
              <th>To copy</th>
              <th>To skip</th>
            </tr>
          </thead>
          <tbody>
            {collections.map((c) => {
              const row = plan.collections[c];
              return (
                <tr key={c}>
                  <td>{c}</td>
                  <td>{row?.total ?? 0}</td>
                  <td>{row?.toCopy ?? 0}</td>
                  <td>{row?.toSkip ?? 0}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : null}

      {plan && !plan.ok && plan.error ? (
        <div className="error" role="alert">
          Dry run found a blocker in {plan.error.collection}: {plan.error.error.message}
        </div>
      ) : null}

      {busy === "run" ? (
        <ul className="migrate-progress">
          {collections.map((c) => (
            <li key={c}>
              <span className="migrate-collection">{c}</span>
              <span className="migrate-count">
                {progress[c] ? `${progress[c]?.phase} · ${progress[c]?.done}` : "waiting…"}
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      {report ? (
        <>
          <div className={report.ok ? "migrate-result ok" : "migrate-result fail"}>
            {report.ok ? "Migration complete" : "Migration stopped on the first error"}
          </div>
          <table className="migrate-table">
            <thead>
              <tr>
                <th>Collection</th>
                <th>Copied</th>
                <th>Skipped</th>
                <th>Relinked</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(report.collections).map(([c, r]) => (
                <tr key={c}>
                  <td>{c}</td>
                  <td>{r.copied}</td>
                  <td>{r.skipped}</td>
                  <td>{r.relinked}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {report.error ? (
            <div className="error" role="alert">
              {report.error.collection} ({report.error.phase}): {report.error.error.message}
            </div>
          ) : null}
        </>
      ) : null}
    </main>
  );
}
