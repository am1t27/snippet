// Catalog ingest — the background job that builds the big song pool.
//
// Two passes, both keyless and free:
//
//   BREADTH  chart sweep: every storefront's "most played" RSS feed (100 ids
//            each), hydrated through iTunes lookup into rows with previews.
//            Covers what the world is playing right now, worldwide.
//   DEPTH    artist seeds: each genre family's curated artist list, expanded via
//            iTunes artist lookup (up to 200 tracks per artist). Covers back
//            catalogue and past decades, and is the only source for
//            seeded-only families (drill/trap).
//
// The job is resumable and additive: every batch is upserted as soon as it is
// hydrated, so a crash mid-run just means a smaller catalog until the next run.
// Designed to be started from server boot (fire-and-forget) or run manually:
//
//   node catalog/ingest.js            # full ingest (charts + all artist seeds)
//   node catalog/ingest.js charts     # chart sweep only (fast refresh)
//   node catalog/ingest.js artists    # artist seeding only
//   INGEST_STOREFRONTS=us,gb node catalog/ingest.js

import { chartEntries, lookupTracks, artistIdFor, songsForArtist, DEFAULT_STOREFRONTS } from "./appleSource.js";
import { toCatalogRows } from "./normalize.js";
import { GENRE_KEYS, seedArtistsFor } from "./genres.js";
import { initCatalog, upsertTracks, saveSnapshot, catalogStats, catalogReady } from "./store.js";
import { log } from "../log.js";

function storefronts() {
  const env = process.env.INGEST_STOREFRONTS;
  if (!env || env === "all") return DEFAULT_STOREFRONTS;
  return env.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
}

// ----- Pass 1: chart sweep (breadth) -----

export async function ingestCharts() {
  const fronts = storefronts();
  const ids = new Set();
  for (const front of fronts) {
    const entries = await chartEntries(front);
    for (const e of entries) ids.add(e.id);
  }
  log.info("ingest: chart sweep collected ids", { storefronts: fronts.length, ids: ids.size });

  let written = 0;
  const all = [...ids];
  for (let i = 0; i < all.length; i += 100) {
    const raw = await lookupTracks(all.slice(i, i + 100));
    written += await upsertTracks(toCatalogRows(raw));
  }
  await saveSnapshot();
  log.info("ingest: chart sweep done", { tracksWritten: written });
  return written;
}

// ----- Pass 2: artist seeding (depth) -----

// artistId cache so repeated runs skip the name->id search round-trip.
const artistIdCache = new Map();

export async function ingestArtists(genreKeys = GENRE_KEYS) {
  let written = 0;
  for (const genre of genreKeys) {
    const artists = seedArtistsFor(genre);
    for (const name of artists) {
      let id = artistIdCache.get(name);
      if (id === undefined) {
        id = await artistIdFor(name);
        artistIdCache.set(name, id);
      }
      if (!id) {
        log.warn("ingest: artist not found on iTunes", { artist: name, genre });
        continue;
      }
      const raw = await songsForArtist(id);
      // Tag every track with the seeding family — this is what places a
      // Hip-Hop/Rap-labelled Pop Smoke track into `drill`.
      const rows = toCatalogRows(raw, [genre]);
      written += await upsertTracks(rows);
    }
    await saveSnapshot(); // checkpoint per genre so progress survives a crash
    log.info("ingest: genre seeded", { genre, artists: artists.length });
  }
  log.info("ingest: artist seeding done", { tracksWritten: written });
  return written;
}

// ----- Orchestration -----

let running = false;

// Full ingest. Serialized: overlapping runs (boot + interval timer) collapse
// into one.
export async function runIngest(mode = "full") {
  if (running) {
    log.info("ingest: already running, skipping");
    return null;
  }
  running = true;
  const startedAt = Date.now();
  try {
    if (!catalogReady()) await initCatalog(log);
    if (mode === "charts" || mode === "full") await ingestCharts();
    if (mode === "artists" || mode === "full") await ingestArtists();
    const stats = await catalogStats();
    log.info("ingest: complete", {
      mode,
      seconds: Math.round((Date.now() - startedAt) / 1000),
      total: stats.total,
      byGenre: stats.byGenre,
    });
    return stats;
  } catch (e) {
    log.error("ingest: failed", { error: String((e && e.stack) || e) });
    return null;
  } finally {
    running = false;
  }
}

// Boot hook for server.js: first ingest immediately when the catalog is thin,
// then a periodic chart refresh to keep "new" fresh. All timers unref()ed so
// they never hold the process open.
export function scheduleIngest({ refreshHours = 24 } = {}) {
  (async () => {
    if (!catalogReady()) await initCatalog(log);
    const stats = await catalogStats();
    // A populated catalog (snapshot or Postgres) skips the expensive full run
    // and just refreshes charts in the background.
    const mode = stats.total < 1000 ? "full" : "charts";
    await runIngest(mode);
  })().catch((e) => log.error("ingest: boot run failed", { error: String(e) }));

  const t = setInterval(() => {
    runIngest("charts").catch(() => {});
  }, Math.max(1, refreshHours) * 3600 * 1000);
  if (typeof t.unref === "function") t.unref();
  return t;
}

// ----- CLI entry -----
// `node catalog/ingest.js [full|charts|artists]`
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop())) {
  const mode = ["full", "charts", "artists"].includes(process.argv[2]) ? process.argv[2] : "full";
  runIngest(mode).then(async (stats) => {
    if (stats) {
      console.log(`Catalog: ${stats.total} tracks (${stats.backend})`);
      const DECADES = ["2020s", "2010s", "2000s", "1990s", "1980s", "pre-1980", "unknown"];
      console.log(`  ${"genre".padEnd(10)} ${"total".padStart(6)}  ${DECADES.map((d) => d.padStart(8)).join("")}`);
      for (const [g, n] of Object.entries(stats.byGenre).sort((a, b) => b[1] - a[1])) {
        const per = stats.byGenreDecade?.[g] || {};
        console.log(
          `  ${g.padEnd(10)} ${String(n).padStart(6)}  ${DECADES.map((d) => String(per[d] || 0).padStart(8)).join("")}`
        );
      }
    }
    process.exit(stats ? 0 : 1);
  });
}

export default { runIngest, scheduleIngest, ingestCharts, ingestArtists };
