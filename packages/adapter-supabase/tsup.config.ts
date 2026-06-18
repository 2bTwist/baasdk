import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  dts: true,
  clean: true,
  sourcemap: true,
  target: "es2022",
  // The provider SDK is a peer dependency — never bundle it.
  external: ["@supabase/supabase-js"],
});
