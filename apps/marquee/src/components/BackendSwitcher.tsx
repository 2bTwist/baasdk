import type { CSSProperties } from "react";
import { BACKENDS, type BackendKind } from "../lib/backend";

interface BackendSwitcherProps {
  readonly active: BackendKind;
  readonly onSelect: (kind: BackendKind) => void;
}

/**
 * Segmented control over `BACKENDS`. The memory backend is selectable; the
 * Supabase and Convex segments render but are disabled until Phase 1.
 */
export function BackendSwitcher({ active, onSelect }: BackendSwitcherProps): React.JSX.Element {
  return (
    <fieldset className="switcher">
      <legend className="sr-only">Active backend</legend>
      {BACKENDS.map((b) => {
        const on = b.kind === active;
        const style = { "--seg-color": b.color } as CSSProperties;
        return (
          <button
            key={b.kind}
            type="button"
            className={on ? "on" : undefined}
            style={on ? style : undefined}
            disabled={!b.available}
            aria-pressed={on}
            title={b.available ? undefined : "Available in Phase 1"}
            onClick={() => {
              if (b.available && !on) onSelect(b.kind);
            }}
          >
            {b.label}
          </button>
        );
      })}
    </fieldset>
  );
}
