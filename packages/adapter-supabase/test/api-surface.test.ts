import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";

// Snapshot the BUILT public type surface (`dist/index.d.ts`). Any unintended
// change to the published API fails until the committed snapshot is reviewed and
// updated (`vitest -u`). Skips when dist is absent (run after a build).
const dts = fileURLToPath(new URL("../dist/index.d.ts", import.meta.url));

test.skipIf(!existsSync(dts))("public .d.ts surface is stable", async () => {
  await expect(readFileSync(dts, "utf8")).toMatchFileSnapshot(
    fileURLToPath(new URL("./__snapshots__/index.d.ts.snap", import.meta.url)),
  );
});
