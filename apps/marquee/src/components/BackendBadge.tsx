import type { CSSProperties } from "react";
import type { BackendKind } from "../lib/backend";

interface BackendBadgeProps {
  readonly kind: BackendKind;
  readonly label: string;
  readonly color: string;
}

/** Faint glow around the status dot, keyed to each backend's accent. */
const HALO: Record<BackendKind, string> = {
  memory: "rgba(47, 107, 220, 0.22)",
  supabase: "rgba(16, 154, 100, 0.22)",
  convex: "rgba(219, 79, 36, 0.22)",
};

/** A pill showing the active backend: a colored dot + the uppercase label. */
export function BackendBadge({ kind, label, color }: BackendBadgeProps): React.JSX.Element {
  const style = {
    "--badge-color": color,
    "--badge-halo": HALO[kind],
  } as CSSProperties;
  const text = label.toUpperCase();
  return (
    <span className="badge" style={style} role="status" aria-label={`Active backend: ${text}`}>
      <span className="dot" aria-hidden="true" />
      {text}
    </span>
  );
}
