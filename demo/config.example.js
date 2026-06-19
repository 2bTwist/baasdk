// Copy to config.js to point the demo at REAL backends (your own, never shared).
// Leave it absent (or mode:"memory") to run the public, in-memory demo, no
// database, nothing saved, nothing to spam.
window.BAAS_CONFIG = {
  mode: "memory",
  // For real mode, set mode:"real" and fill these in from YOUR local stack:
  // supabaseUrl: "http://127.0.0.1:54321",
  // supabaseKey: "<your supabase anon key>",
  // convexUrl: "http://127.0.0.1:3210",
};
