/**
 * Marquee's Convex schema. The field names match the Supabase columns EXACTLY
 * (camelCase) so the same movie/genre object round-trips through the portable
 * store on either backend with no per-backend mapping.
 *
 * `schemaValidation: false` keeps the app schemaless for the generic CRUD
 * helpers (the adapter writes dynamic table names); declaring the tables here is
 * purely to attach the `by_<field>` indexes that portable field-ordering needs
 * on Convex (`list({ order: { field } })` requires a matching `by_<field>`
 * index, otherwise it returns `unsupported_capability`). Supabase/memory order
 * by any field directly, so this is the Convex-specific cost.
 */
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema(
  {
    movies: defineTable({
      title: v.string(),
      year: v.number(),
      synopsis: v.string(),
      runtime: v.number(),
      director: v.string(),
      primaryGenre: v.string(),
      genres: v.array(v.string()),
      // Phase 4: opaque file-port handle (a Convex storage id) for the poster.
      posterFile: v.optional(v.string()),
    })
      .index("by_year", ["year"])
      .index("by_title", ["title"])
      .index("by_primaryGenre", ["primaryGenre"]),

    genres: defineTable({
      name: v.string(),
      slug: v.string(),
    }).index("by_slug", ["slug"]),

    movieGenres: defineTable({
      movieId: v.string(),
      genreId: v.string(),
    })
      .index("by_movieId", ["movieId"])
      .index("by_genreId", ["genreId"]),

    // Phase 2: the cast/director relation the rich detail page joins over.
    people: defineTable({
      name: v.string(),
      bio: v.string(),
    }),

    credits: defineTable({
      movieId: v.string(),
      personId: v.string(),
      role: v.string(), // "director" | "actor"
      character: v.string(),
      billing: v.number(),
    }).index("by_movieId", ["movieId"]),

    // Phase 3: auth + RBAC. userId is the shared-issuer subject (Supabase auth uid),
    // so identity matches the Supabase backend and survives migration.
    profiles: defineTable({
      userId: v.string(),
      role: v.string(), // guest | member | editor | admin
      displayName: v.string(),
    }).index("by_userId", ["userId"]),

    reviews: defineTable({
      movieId: v.string(),
      userId: v.string(),
      rating: v.number(),
      body: v.string(),
    })
      .index("by_movieId", ["movieId"])
      .index("by_userId", ["userId"]),
  },
  { schemaValidation: false },
);
