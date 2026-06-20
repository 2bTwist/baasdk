/**
 * Marquee dev seed. Populates a chosen backend with genres, ~300 movies, and the
 * movieGenres join rows that link them, ALL through the portable store (the same
 * insert path the app uses). Run from apps/marquee with the live env set:
 *
 *   SUPABASE_URL=... SUPABASE_KEY=... npx tsx scripts/seed.mts supabase
 *   CONVEX_URL=...                    npx tsx scripts/seed.mts convex
 *                                     npx tsx scripts/seed.mts memory
 *
 * The data is DETERMINISTIC (no randomness): movies are generated from a curated
 * base list crossed with deterministic per-index variations, so two runs produce
 * the identical catalog. It is NOT idempotent: re-running inserts a second copy
 * (acceptable for a dev seed; clear the tables first if you want a clean slate).
 */
import { createConvexBackend } from "@baas/adapter-convex";
import { createMemoryBackend } from "@baas/adapter-memory";
import { createSupabaseBackend } from "@baas/adapter-supabase";
import type { Backend, DocumentId } from "@baas/core";

// ---------------------------------------------------------------------------
// Backend selection from the CLI arg + env (same construction the live tests use).
// ---------------------------------------------------------------------------

type Kind = "memory" | "supabase" | "convex";

const arg = process.argv[2];
if (arg !== "memory" && arg !== "supabase" && arg !== "convex") {
  console.error("Usage: seed.mts <memory|supabase|convex> [movieCount]");
  process.exit(1);
}
const kind: Kind = arg;

// Optional movie count (Phase 5 scale stress). Default 300 dev catalog; pass e.g.
// 5000 to generate ~50-80k rows and exercise Convex per-mutation write limits +
// pagination at scale. Each movie fans out to ~2 genre joins + ~4 credits.
const countArg = process.argv[3];
const MOVIE_COUNT = countArg ? Number(countArg) : 300;
if (!Number.isInteger(MOVIE_COUNT) || MOVIE_COUNT < 1) {
  console.error(`movieCount must be a positive integer, got "${countArg}"`);
  process.exit(1);
}

function buildBackend(target: Kind): Backend {
  switch (target) {
    case "memory":
      return createMemoryBackend({ queries: {}, mutations: {} });
    case "supabase": {
      const url = process.env.SUPABASE_URL;
      const key = process.env.SUPABASE_KEY;
      if (!url || !key) throw new Error("supabase seed needs SUPABASE_URL and SUPABASE_KEY");
      return createSupabaseBackend({ url, key, queries: {}, mutations: {} });
    }
    case "convex": {
      const url = process.env.CONVEX_URL;
      if (!url) throw new Error("convex seed needs CONVEX_URL");
      return createConvexBackend({ url, queries: {}, mutations: {} });
    }
  }
}

// ---------------------------------------------------------------------------
// Curated source data. 16 genres; a base list of real-ish movies that the
// generator expands by deterministic variation to reach ~300.
// ---------------------------------------------------------------------------

interface GenreSeed {
  readonly name: string;
  readonly slug: string;
}

const GENRES: readonly GenreSeed[] = [
  { name: "Drama", slug: "drama" },
  { name: "Science Fiction", slug: "scifi" },
  { name: "Thriller", slug: "thriller" },
  { name: "Comedy", slug: "comedy" },
  { name: "Romance", slug: "romance" },
  { name: "Horror", slug: "horror" },
  { name: "Animation", slug: "animation" },
  { name: "Documentary", slug: "documentary" },
  { name: "Action", slug: "action" },
  { name: "Mystery", slug: "mystery" },
  { name: "Fantasy", slug: "fantasy" },
  { name: "Crime", slug: "crime" },
  { name: "Adventure", slug: "adventure" },
  { name: "Western", slug: "western" },
  { name: "Musical", slug: "musical" },
  { name: "War", slug: "war" },
];

interface BaseMovie {
  readonly title: string;
  readonly year: number;
  readonly runtime: number;
  readonly director: string;
  readonly primaryGenre: string;
  readonly secondaryGenre: string;
}

/** A curated base list. The generator cross-multiplies these into ~300 titles. */
const BASE: readonly BaseMovie[] = [
  {
    title: "The Lighthouse",
    year: 2019,
    runtime: 109,
    director: "Robert Eggers",
    primaryGenre: "horror",
    secondaryGenre: "drama",
  },
  {
    title: "Arrival",
    year: 2016,
    runtime: 116,
    director: "Denis Villeneuve",
    primaryGenre: "scifi",
    secondaryGenre: "drama",
  },
  {
    title: "Parasite",
    year: 2019,
    runtime: 132,
    director: "Bong Joon-ho",
    primaryGenre: "thriller",
    secondaryGenre: "drama",
  },
  {
    title: "Whiplash",
    year: 2014,
    runtime: 106,
    director: "Damien Chazelle",
    primaryGenre: "drama",
    secondaryGenre: "musical",
  },
  {
    title: "Spirited Away",
    year: 2001,
    runtime: 125,
    director: "Hayao Miyazaki",
    primaryGenre: "animation",
    secondaryGenre: "fantasy",
  },
  {
    title: "Blade Runner",
    year: 1982,
    runtime: 117,
    director: "Ridley Scott",
    primaryGenre: "scifi",
    secondaryGenre: "thriller",
  },
  {
    title: "In the Mood for Love",
    year: 2000,
    runtime: 98,
    director: "Wong Kar-wai",
    primaryGenre: "romance",
    secondaryGenre: "drama",
  },
  {
    title: "Mad Max: Fury Road",
    year: 2015,
    runtime: 120,
    director: "George Miller",
    primaryGenre: "action",
    secondaryGenre: "adventure",
  },
  {
    title: "No Country for Old Men",
    year: 2007,
    runtime: 122,
    director: "Joel Coen",
    primaryGenre: "crime",
    secondaryGenre: "thriller",
  },
  {
    title: "Pan's Labyrinth",
    year: 2006,
    runtime: 118,
    director: "Guillermo del Toro",
    primaryGenre: "fantasy",
    secondaryGenre: "war",
  },
  {
    title: "The Grand Budapest Hotel",
    year: 2014,
    runtime: 99,
    director: "Wes Anderson",
    primaryGenre: "comedy",
    secondaryGenre: "adventure",
  },
  {
    title: "Hereditary",
    year: 2018,
    runtime: 127,
    director: "Ari Aster",
    primaryGenre: "horror",
    secondaryGenre: "mystery",
  },
  {
    title: "The Social Network",
    year: 2010,
    runtime: 120,
    director: "David Fincher",
    primaryGenre: "drama",
    secondaryGenre: "thriller",
  },
  {
    title: "Dune",
    year: 2021,
    runtime: 155,
    director: "Denis Villeneuve",
    primaryGenre: "scifi",
    secondaryGenre: "adventure",
  },
  {
    title: "True Grit",
    year: 2010,
    runtime: 110,
    director: "Joel Coen",
    primaryGenre: "western",
    secondaryGenre: "drama",
  },
  {
    title: "Her",
    year: 2013,
    runtime: 126,
    director: "Spike Jonze",
    primaryGenre: "romance",
    secondaryGenre: "scifi",
  },
  {
    title: "1917",
    year: 2019,
    runtime: 119,
    director: "Sam Mendes",
    primaryGenre: "war",
    secondaryGenre: "drama",
  },
  {
    title: "Knives Out",
    year: 2019,
    runtime: 130,
    director: "Rian Johnson",
    primaryGenre: "mystery",
    secondaryGenre: "comedy",
  },
  {
    title: "La La Land",
    year: 2016,
    runtime: 128,
    director: "Damien Chazelle",
    primaryGenre: "musical",
    secondaryGenre: "romance",
  },
  {
    title: "Inception",
    year: 2010,
    runtime: 148,
    director: "Christopher Nolan",
    primaryGenre: "scifi",
    secondaryGenre: "action",
  },
];

/**
 * Deterministic title variants. The generator appends one of these (keyed by
 * index) so we reach ~300 distinct rows without randomness, and shifts the year
 * by a fixed offset per chapter to spread the year filter.
 */
const VARIANTS: readonly string[] = [
  "",
  ": Redux",
  ": Chapter Two",
  " (Director's Cut)",
  ": The Reckoning",
  " Revisited",
  ": Origins",
  ": Aftermath",
  ": Coda",
  ": Remastered",
  ": Part III",
  ": The Final Reel",
  ": Echoes",
  ": Nightfall",
  ": Daybreak",
];

/** A deterministic actor pool for the cast relation (Phase 2 join). */
const ACTORS: readonly string[] = [
  "Tilda Swinton",
  "Oscar Isaac",
  "Florence Pugh",
  "Mahershala Ali",
  "Saoirse Ronan",
  "Adam Driver",
  "Lupita Nyong'o",
  "Cillian Murphy",
  "Zendaya",
  "Toni Collette",
  "Riz Ahmed",
  "Anya Taylor-Joy",
  "Daniel Kaluuya",
  "Rooney Mara",
  "Steven Yeun",
  "Rebecca Ferguson",
];

/** Character names cycled deterministically for actor credits. */
const CHARACTERS: readonly string[] = [
  "The Stranger",
  "Captain Reyes",
  "Dr. Lin",
  "Eleanor",
  "The Pilot",
  "Marcus",
  "Vivian",
  "The Witness",
];

interface MovieSeed {
  readonly title: string;
  readonly year: number;
  readonly synopsis: string;
  readonly runtime: number;
  readonly director: string;
  readonly primaryGenre: string;
  readonly genres: readonly string[];
}

/** Build the full ~300-movie list deterministically by index. */
function generateMovies(target: number): MovieSeed[] {
  const movies: MovieSeed[] = [];
  for (let i = 0; movies.length < target; i++) {
    const base = BASE[i % BASE.length];
    if (!base) break;
    const chapter = Math.floor(i / BASE.length);
    const variant = VARIANTS[chapter % VARIANTS.length] ?? "";
    const yearOffset = chapter * 2 - 12; // spread years deterministically around the base
    const year = base.year + yearOffset;
    const runtime = base.runtime + (chapter % 5) * 3;
    movies.push({
      title: `${base.title}${variant}`,
      year,
      synopsis: `${base.title} is a ${base.primaryGenre} feature directed by ${base.director}. A deterministic seed entry (#${i + 1}).`,
      runtime,
      director: base.director,
      primaryGenre: base.primaryGenre,
      genres: [base.primaryGenre, base.secondaryGenre],
    });
  }
  return movies;
}

// ---------------------------------------------------------------------------
// Seeding. Inserts genres first (capturing their _id by slug), then movies
// (capturing each _id), then a movieGenres join row per (movie, genre) pair.
// Inserts run sequentially in small awaited batches to keep the live backends
// from being hammered and to surface the first error immediately.
// ---------------------------------------------------------------------------

async function seed(backend: Backend): Promise<void> {
  console.log(`Seeding ${kind}: ${GENRES.length} genres, ${MOVIE_COUNT} movies...`);

  // 1. Genres. Map slug -> inserted _id so join rows can reference them.
  const genreIdBySlug = new Map<string, DocumentId>();
  for (const g of GENRES) {
    const res = await backend.store.insert("genres", g);
    if (!res.ok) throw new Error(`genre ${g.slug}: ${res.error.code} ${res.error.message}`);
    genreIdBySlug.set(g.slug, res.data);
  }
  console.log(`  genres inserted: ${genreIdBySlug.size}`);

  // 2. People: every director (from the base list) plus the actor pool. Map
  // name -> inserted _id so credits can reference them (the Phase 2 join).
  const personIdByName = new Map<string, DocumentId>();
  const directors = [...new Set(BASE.map((b) => b.director))];
  for (const name of [...directors, ...ACTORS]) {
    const res = await backend.store.insert("people", { name, bio: "" });
    if (!res.ok) throw new Error(`person ${name}: ${res.error.code} ${res.error.message}`);
    personIdByName.set(name, res.data);
  }
  console.log(`  people inserted: ${personIdByName.size}`);

  // 3. Movies, their genre join rows, and their credits (director + 3 actors).
  const movies = generateMovies(MOVIE_COUNT);
  let movieCount = 0;
  let joinCount = 0;
  let creditCount = 0;
  for (let i = 0; i < movies.length; i++) {
    const m = movies[i];
    if (!m) continue;
    const res = await backend.store.insert("movies", m);
    if (!res.ok) throw new Error(`movie "${m.title}": ${res.error.code} ${res.error.message}`);
    const movieId = res.data;
    movieCount++;

    // Genre join rows: link this movie to each of its genres by their captured _ids.
    for (const slug of m.genres) {
      const genreId = genreIdBySlug.get(slug);
      if (!genreId) continue; // a genre slug with no row; skip rather than fail the run
      const joinRes = await backend.store.insert("movieGenres", {
        movieId: String(movieId),
        genreId: String(genreId),
      });
      if (!joinRes.ok) {
        throw new Error(
          `movieGenres for "${m.title}": ${joinRes.error.code} ${joinRes.error.message}`,
        );
      }
      joinCount++;
    }

    // Credits: the director at billing 0, then three actors picked deterministically.
    const directorId = personIdByName.get(m.director);
    const cast: Array<{ name: string; role: string; character: string; billing: number }> = [];
    if (directorId) cast.push({ name: m.director, role: "director", character: "", billing: 0 });
    for (let k = 0; k < 3; k++) {
      const actor = ACTORS[(i * 3 + k) % ACTORS.length];
      const character = CHARACTERS[(i + k) % CHARACTERS.length];
      if (actor && character) {
        cast.push({ name: actor, role: "actor", character, billing: k + 1 });
      }
    }
    for (const c of cast) {
      const personId = personIdByName.get(c.name);
      if (!personId) continue;
      const creditRes = await backend.store.insert("credits", {
        movieId: String(movieId),
        personId: String(personId),
        role: c.role,
        character: c.character,
        billing: c.billing,
      });
      if (!creditRes.ok) {
        throw new Error(
          `credit for "${m.title}": ${creditRes.error.code} ${creditRes.error.message}`,
        );
      }
      creditCount++;
    }

    if (movieCount % 50 === 0) console.log(`  movies inserted: ${movieCount}/${movies.length}`);
  }

  console.log(`\nSeed complete on ${kind}:`);
  console.log(`  genres:      ${genreIdBySlug.size}`);
  console.log(`  people:      ${personIdByName.size}`);
  console.log(`  movies:      ${movieCount}`);
  console.log(`  movieGenres: ${joinCount}`);
  console.log(`  credits:     ${creditCount}`);
}

/**
 * Phase 4: ensure the `posters` Storage bucket exists (Supabase only; Convex
 * needs no bucket). Idempotent — a "already exists" error is success. Convex's
 * file store has no buckets, so this is a no-op there.
 */
async function ensurePostersBucket(target: Kind, backend: Backend): Promise<void> {
  if (target !== "supabase") return;
  const storage = backend.files.native() as {
    createBucket: (
      id: string,
      opts: { public: boolean },
    ) => Promise<{ error: { message: string } | null }>;
  };
  const { error } = await storage.createBucket("posters", { public: true });
  if (error && !/already exists/i.test(error.message)) {
    throw new Error(`could not create posters bucket: ${error.message}`);
  }
  console.log("  posters bucket: ready");
}

const backend = buildBackend(kind);
await ensurePostersBucket(kind, backend);
await seed(backend);
process.exit(0);
