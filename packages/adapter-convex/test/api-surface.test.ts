import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";

// Snapshot the BUILT public type surface (`dist/index.d.ts`). Any unintended
// change to the published API fails until the committed snapshot is reviewed and
// updated (`vitest -u`).
const dts = fileURLToPath(new URL("../dist/index.d.ts", import.meta.url));

test("public .d.ts surface is stable", async () => {
  if (!existsSync(dts)) {
    if (process.env.CI) {
      throw new Error(`${dts} is missing: build must run before the API-surface test`);
    }
    return;
  }
  await expect(readFileSync(dts, "utf8")).toMatchFileSnapshot(
    fileURLToPath(new URL("./__snapshots__/index.d.ts.snap", import.meta.url)),
  );
});
