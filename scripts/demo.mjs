/**
 * Build and serve the baasdk demo locally.
 *
 *   pnpm demo
 *
 * Runs in-memory by default (no database, nothing to set up). To point it at
 * your OWN local Supabase + Convex, copy demo/config.example.js to demo/config.js,
 * set mode:"real" and fill in your URLs/key, then run this again. config.js is
 * gitignored, so your keys never get committed.
 */
import { spawnSync } from "node:child_process";
import { access, copyFile, readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const demoDir = join(root, "demo");
const port = Number(process.env.PORT ?? 8788);

// 1. Ensure a config.js exists (in-memory default) so index.html has one to load.
const cfgPath = join(demoDir, "config.js");
let mode = "in-memory";
try {
  await access(cfgPath);
  mode = /mode:\s*["']real["']/.test(await readFile(cfgPath, "utf8"))
    ? "real backends"
    : "in-memory";
} catch {
  await copyFile(join(demoDir, "config.example.js"), cfgPath);
}

// 2. Build the bundle (esbuild resolves @baas/* to source via tsconfig paths).
console.log("Building the demo bundle…");
const build = spawnSync(
  "pnpm",
  [
    "exec",
    "esbuild",
    "demo/app.ts",
    "--bundle",
    "--outfile=demo/bundle.js",
    "--platform=browser",
    "--format=esm",
  ],
  { cwd: root, stdio: "inherit" },
);
if (build.status !== 0) process.exit(build.status ?? 1);

// 3. Serve demo/ statically.
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json",
};
createServer(async (req, res) => {
  const url = decodeURIComponent((req.url ?? "/").split("?")[0]);
  const rel = normalize(url === "/" ? "/index.html" : url).replace(/^(\.\.[/\\])+/, "");
  const file = join(demoDir, rel);
  if (!file.startsWith(demoDir)) {
    res.writeHead(403).end("forbidden");
    return;
  }
  try {
    const data = await readFile(file);
    res.writeHead(200, {
      "content-type": TYPES[extname(file)] ?? "application/octet-stream",
      "cache-control": "no-cache",
    });
    res.end(data);
  } catch {
    res.writeHead(404).end("not found");
  }
}).listen(port, () => {
  console.log(`\n  baasdk demo  →  http://localhost:${port}`);
  console.log(`  mode: ${mode}  (edit demo/config.js to switch)\n`);
});
