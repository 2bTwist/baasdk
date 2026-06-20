import type { Backend, DocumentId } from "@baas/core";
import { useCallback, useMemo, useState } from "react";
import { AuthBar } from "./components/AuthBar";
import { BackendBadge } from "./components/BackendBadge";
import { BackendSwitcher } from "./components/BackendSwitcher";
import { MigratePanel } from "./components/MigratePanel";
import { MovieDetail } from "./components/MovieDetail";
import { MovieForm } from "./components/MovieForm";
import { AuthProvider, useAuth } from "./lib/auth";
import { BACKENDS, type BackendKind, initialBackendKind, makeBackend } from "./lib/backend";
import type { MarqueeSchema } from "./lib/schema";
import { Catalog } from "./routes/Catalog";

/**
 * Minimal view state, no router dependency. The catalog is the home view;
 * `detail` and `form` carry the id they act on (`form` with no id is a create).
 */
type View =
  | { readonly name: "catalog" }
  | { readonly name: "detail"; readonly id: DocumentId }
  | { readonly name: "form"; readonly id?: DocumentId }
  | { readonly name: "migrate" };

/** Admin-only nav (the Migrate panel). Lives inside AuthProvider so it can read
 *  the role; renders nothing for non-admins. */
function AdminNav({ onMigrate }: { readonly onMigrate: () => void }): React.JSX.Element | null {
  const { canAdmin } = useAuth();
  if (!canAdmin) return null;
  return (
    <button type="button" className="link-btn admin-nav" onClick={onMigrate}>
      Migrate
    </button>
  );
}

export function App(): React.JSX.Element {
  const [kind, setKind] = useState<BackendKind>(initialBackendKind);
  const [view, setView] = useState<View>({ name: "catalog" });

  // Re-create the active backend whenever the kind changes. A fresh instance
  // means a fresh store; reset to the catalog so we never view a stale id.
  const backend: Backend<MarqueeSchema> = useMemo(() => makeBackend(kind), [kind]);

  const onSelectBackend = useCallback((next: BackendKind): void => {
    setKind(next);
    setView({ name: "catalog" });
  }, []);

  const choice = BACKENDS.find((b) => b.kind === kind);
  if (!choice) throw new Error(`unknown backend kind: ${kind}`);

  return (
    <AuthProvider backend={backend} backendKind={kind}>
      {/* Expose the active backend's accent as a CSS var so any descendant
          (e.g. the live badge) can color itself by backend at a glance. */}
      <div className="wrap" style={{ "--backend-accent": choice.color } as React.CSSProperties}>
        <header className="app-header">
          <button
            type="button"
            className="brand brand-btn"
            onClick={() => setView({ name: "catalog" })}
          >
            <span className="word">Marquee</span>
            <span className="tag">· a @baas dogfood</span>
          </button>
          <div className="header-right">
            <AuthBar />
            <AdminNav onMigrate={() => setView({ name: "migrate" })} />
            <BackendSwitcher active={kind} onSelect={onSelectBackend} />
            <BackendBadge kind={choice.kind} label={choice.label} color={choice.color} />
          </div>
        </header>

        {view.name === "catalog" ? (
          <Catalog
            backend={backend}
            onOpen={(id) => setView({ name: "detail", id })}
            onCreate={() => setView({ name: "form" })}
          />
        ) : view.name === "detail" ? (
          <MovieDetail
            backend={backend}
            movieId={view.id}
            onBack={() => setView({ name: "catalog" })}
            onEdit={(id) => setView({ name: "form", id })}
          />
        ) : view.name === "form" ? (
          <MovieForm
            backend={backend}
            {...(view.id !== undefined ? { movieId: view.id } : {})}
            onSaved={(id) => setView({ name: "detail", id })}
            onCancel={() => setView({ name: "catalog" })}
          />
        ) : (
          <MigratePanel onBack={() => setView({ name: "catalog" })} />
        )}
      </div>
    </AuthProvider>
  );
}
