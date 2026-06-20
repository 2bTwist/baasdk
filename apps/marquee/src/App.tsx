import type { Backend } from "@baas/core";
import { useMemo, useState } from "react";
import { BackendBadge } from "./components/BackendBadge";
import { BackendSwitcher } from "./components/BackendSwitcher";
import { BACKENDS, type BackendKind, initialBackendKind, makeBackend } from "./lib/backend";
import { Catalog } from "./routes/Catalog";

export function App(): React.JSX.Element {
  const [kind, setKind] = useState<BackendKind>(initialBackendKind);

  // Re-create the active backend whenever the kind changes. A fresh instance
  // means a fresh store, so the catalog resets on switch (expected in Phase 0).
  const backend: Backend = useMemo(() => makeBackend(kind), [kind]);

  const choice = BACKENDS.find((b) => b.kind === kind);
  if (!choice) throw new Error(`unknown backend kind: ${kind}`);

  return (
    <div className="wrap">
      <header className="app-header">
        <span className="brand">
          <span className="word">Marquee</span>
          <span className="tag">· a @baas dogfood</span>
        </span>
        <div className="header-right">
          <BackendSwitcher active={kind} onSelect={setKind} />
          <BackendBadge kind={choice.kind} label={choice.label} color={choice.color} />
        </div>
      </header>
      <Catalog backend={backend} />
    </div>
  );
}
