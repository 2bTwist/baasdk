/**
 * Sync the README "Quickstart" block from the CI-executed source of truth, so
 * the published snippet can't drift from code that actually runs.
 *
 *   node scripts/quickstart-snippet.mjs           # regenerate the README block
 *   node scripts/quickstart-snippet.mjs --check    # fail if README is stale
 *
 * The canonical code lives between `// #region quickstart` / `// #endregion` in
 * `packages/adapter-memory/test/quickstart.test.ts`, which executes it under
 * vitest. This script lifts that region verbatim into the fenced block between
 * the `<!-- BEGIN:quickstart -->` / `<!-- END:quickstart -->` markers in
 * README.md. `--check` mode runs in `verify` + CI. Mirrors
 * `capability-matrix.mjs`: same generate-then-check contract.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const SRC = fileURLToPath(
  new URL("../packages/adapter-memory/test/quickstart.test.ts", import.meta.url),
);
const README = fileURLToPath(new URL("../README.md", import.meta.url));

const REGION = /\/\/ #region quickstart\n([\s\S]*?)\n[ \t]*\/\/ #endregion/;
const MARKERS = /(<!-- BEGIN:quickstart -->\n)[\s\S]*?(\n<!-- END:quickstart -->)/;

const regionMatch = REGION.exec(readFileSync(SRC, "utf8"));
if (!regionMatch) {
  console.error(`No \`// #region quickstart\` ... \`// #endregion\` block found in ${SRC}`);
  process.exit(1);
}

// The region sits at column 0 in the source, so it transplants verbatim with no
// dedent. Just trim stray surrounding blank lines.
const snippet = regionMatch[1].replace(/^\n+/, "").replace(/\n+$/, "");
const FENCE = "```";
const block = `${FENCE}ts\n${snippet}\n${FENCE}`;

const readme = readFileSync(README, "utf8");
// Exactly one marker pair, or the rewrite is ambiguous: `replace` only rewrites
// the FIRST pair, so a stray second pair would hold un-checked content and pass
// silently. Fail closed instead.
const begins = (readme.match(/<!-- BEGIN:quickstart -->/g) ?? []).length;
const ends = (readme.match(/<!-- END:quickstart -->/g) ?? []).length;
if (begins !== 1 || ends !== 1) {
  console.error(
    `README.md must have exactly one <!-- BEGIN:quickstart --> / <!-- END:quickstart --> pair (found ${begins} / ${ends}).`,
  );
  process.exit(1);
}
if (!MARKERS.test(readme)) {
  console.error("README.md quickstart markers are malformed (BEGIN must precede END).");
  process.exit(1);
}
const generated = readme.replace(MARKERS, `$1${block}$2`);

if (process.argv.includes("--check")) {
  if (readme !== generated) {
    console.error("README.md quickstart is stale. Run `pnpm docs:quickstart` and commit.");
    process.exit(1);
  }
  console.log("README quickstart is in sync.");
} else {
  writeFileSync(README, generated);
  console.log(`wrote quickstart block to ${README}`);
}
