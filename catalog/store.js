// Catalog storage — where the ingested tracks live and how rounds sample them.
//
// Two interchangeable backends, chosen automatically at init:
//
//   postgres  DATABASE_URL is set AND `pg` is installed. Survives restarts and
//             is shared across instances. The real production setup.
//   file      Otherwise: an in-memory table persisted to a JSON snapshot
//             (CATALOG_FILE, default ./catalog/snapshot.json). Zero setup, and
//             good enough on a single host — the ingest simply re-runs on boot
//             if the snapshot was lost to an ephemeral disk.
//
// Either way the game only ever calls sampleTracks(); nothing above this module
// knows or cares which backend answered.

import { readFile, writeFile, rename, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sampleDiverse, filterDecade, decadeRange } from "./sample.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
// Resolved per call, not at import: tests (and ops) set CATALOG_FILE at runtime.
const snapshotPath = () => process.env.CATALOG_FILE || path.join(HERE, "snapshot.json");

// Candidate rows pulled before sampling. Wide enough that artist-diversity and
// title-dedupe have room to work, bounded so a huge catalog can't blow memory.
const CANDIDATE_MULTIPLIER = 12;
const CANDIDATE_CAP = 900;

let backend = "none"; // "postgres" | "file" | "none"
let pool = null; // pg pool when backend === "postgres"
let rows = new Map(); // trackId -> row, when backend === "file"
let logger = null;
let dirty = false;

const CREATE_SQL = `
  CREATE TABLE IF NOT EXISTS catalog_tracks (
    track_id     TEXT PRIMARY KEY,
    track_name   TEXT NOT NULL,
    artist_name  TEXT NOT NULL,
    artist_id    TEXT,
    preview_url  TEXT NOT NULL,
    apple_genre  TEXT,
    genre_keys   TEXT[] NOT NULL,
    release_year INTEGER,
    duration_ms  INTEGER,
    base_title   TEXT,
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE INDEX IF NOT EXISTS catalog_tracks_genre_idx ON catalog_tracks USING GIN (genre_keys);
  CREATE INDEX IF NOT EXISTS catalog_tracks_year_idx  ON catalog_tracks (release_year);
`;

// ----- init -----

export async function initCatalog(log) {
  logger = log || null;
  const url = process.env.DATABASE_URL;
  if (url) {
    try {
      const { default: pg } = await import("pg");
      pool = new pg.Pool({ connectionString: url, max: 4 });
      await pool.query(CREATE_SQL);
      backend = "postgres";
      const { total } = await catalogStats();
      logger?.info?.("catalog ready (postgres)", { tracks: total });
      return backend;
    } catch (e) {
      pool = null;
      logger?.warn?.("DATABASE_URL set but catalog storage failed; falling back to the JSON snapshot", {
        error: String((e && e.message) || e),
      });
    }
  }
  backend = "file";
  await loadSnapshot();
  logger?.info?.("catalog ready (file)", { tracks: rows.size, path: snapshotPath() });
  return backend;
}

async function loadSnapshot() {
  try {
    const raw = await readFile(snapshotPath(), "utf8");
    const parsed = JSON.parse(raw);
    const list = Array.isArray(parsed) ? parsed : parsed.tracks || [];
    rows = new Map(list.filter((r) => r && r.trackId).map((r) => [String(r.trackId), r]));
  } catch {
    rows = new Map(); // no snapshot yet — the first ingest creates one
  }
}

// Atomic write (temp file + rename) so a crash mid-save can't truncate the
// snapshot the next boot depends on.
export async function saveSnapshot() {
  if (backend !== "file" || !dirty) return false;
  const target = snapshotPath();
  const payload = JSON.stringify({ savedAt: new Date().toISOString(), tracks: [...rows.values()] });
  const tmp = `${target}.tmp`;
  try {
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(tmp, payload, "utf8");
    await rename(tmp, target);
    dirty = false;
    return true;
  } catch (e) {
    logger?.warn?.("catalog snapshot save failed", { error: String((e && e.message) || e) });
    return false;
  }
}

export function catalogBackend() {
  return backend;
}

export function catalogReady() {
  return backend !== "none";
}

// ----- writes -----

// Insert or merge rows. Existing tracks keep their genre memberships and gain
// any new ones (a track can be both `pop` from the chart sweep and `trap` from
// an artist seed), and always take the newest preview URL.
export async function upsertTracks(list) {
  const batch = (list || []).filter((r) => r && r.trackId && r.previewUrl);
  if (batch.length === 0) return 0;

  if (backend === "postgres") {
    let written = 0;
    for (let i = 0; i < batch.length; i += 200) {
      const chunk = batch.slice(i, i + 200);
      const values = [];
      const params = [];
      chunk.forEach((r, n) => {
        const b = n * 10;
        values.push(`($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6},$${b + 7}::text[],$${b + 8},$${b + 9},$${b + 10})`);
        params.push(
          r.trackId, r.trackName, r.artistName, r.artistId, r.previewUrl,
          r.appleGenre, r.genreKeys, r.releaseYear, r.durationMs, r.baseTitle
        );
      });
      await pool.query(
        `INSERT INTO catalog_tracks
           (track_id, track_name, artist_name, artist_id, preview_url, apple_genre, genre_keys, release_year, duration_ms, base_title)
         VALUES ${values.join(",")}
         ON CONFLICT (track_id) DO UPDATE SET
           preview_url = EXCLUDED.preview_url,
           apple_genre = COALESCE(EXCLUDED.apple_genre, catalog_tracks.apple_genre),
           release_year = COALESCE(EXCLUDED.release_year, catalog_tracks.release_year),
           genre_keys = ARRAY(SELECT DISTINCT unnest(catalog_tracks.genre_keys || EXCLUDED.genre_keys)),
           updated_at = now()`,
        params
      );
      written += chunk.length;
    }
    return written;
  }

  for (const r of batch) {
    const prev = rows.get(r.trackId);
    if (prev) {
      prev.previewUrl = r.previewUrl;
      prev.appleGenre = r.appleGenre ?? prev.appleGenre;
      prev.releaseYear = r.releaseYear ?? prev.releaseYear;
      prev.genreKeys = [...new Set([...(prev.genreKeys || []), ...(r.genreKeys || [])])];
    } else {
      rows.set(r.trackId, { ...r });
    }
  }
  dirty = true;
  return batch.length;
}

// ----- reads -----

export async function catalogStats() {
  if (backend === "postgres") {
    const total = await pool.query("SELECT count(*)::int AS n FROM catalog_tracks");
    const byGenre = await pool.query(
      "SELECT g AS genre, count(*)::int AS n FROM catalog_tracks, unnest(genre_keys) AS g GROUP BY g ORDER BY n DESC"
    );
    return {
      backend,
      total: total.rows[0]?.n ?? 0,
      byGenre: Object.fromEntries(byGenre.rows.map((r) => [r.genre, r.n])),
    };
  }
  const byGenre = {};
  for (const r of rows.values()) for (const g of r.genreKeys || []) byGenre[g] = (byGenre[g] || 0) + 1;
  return { backend, total: rows.size, byGenre };
}

// How many tracks the catalog holds for one genre — the server uses this to
// decide whether the catalog can serve a match or the live fetcher should.
export async function genreCount(genre) {
  const key = String(genre ?? "").toLowerCase();
  if (backend === "postgres") {
    const res = await pool.query("SELECT count(*)::int AS n FROM catalog_tracks WHERE genre_keys @> ARRAY[$1]", [key]);
    return res.rows[0]?.n ?? 0;
  }
  let n = 0;
  for (const r of rows.values()) if ((r.genreKeys || []).includes(key)) n++;
  return n;
}

async function candidates(genre, count) {
  const key = String(genre ?? "").toLowerCase();
  const limit = Math.min(CANDIDATE_CAP, Math.max(count * CANDIDATE_MULTIPLIER, count));
  if (backend === "postgres") {
    const res = await pool.query(
      `SELECT track_id AS "trackId", track_name AS "trackName", artist_name AS "artistName",
              preview_url AS "previewUrl", release_year AS "releaseYear", base_title AS "baseTitle",
              apple_genre AS "appleGenre"
         FROM catalog_tracks
        WHERE genre_keys @> ARRAY[$1]
        ORDER BY random()
        LIMIT $2`,
      [key, limit]
    );
    return res.rows;
  }
  const all = [];
  for (const r of rows.values()) if ((r.genreKeys || []).includes(key)) all.push(r);
  return all;
}

// Sample `count` playable tracks for a genre, biased to a decade.
//
// Returns rows in exactly the shape gameLogic.buildRound expects
// ({ trackId, trackName, artistName, previewUrl, releaseYear }), so the catalog
// is a drop-in replacement for the live fetcher. Returns [] when the catalog
// cannot serve the request — the caller then falls back.
export async function sampleTracks({ genre, decade = "all", count = 20 } = {}) {
  if (!catalogReady()) return [];
  const n = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
  if (n === 0) return [];

  const pool_ = await candidates(genre, n);
  if (pool_.length === 0) return [];

  // Prefer the requested decade, but never start a game with a starved pool:
  // fall back to the full genre pool when the decade can't fill the round.
  const inDecade = decadeRange(decade) ? filterDecade(pool_, decade) : pool_;
  const usable = inDecade.length >= n ? inDecade : pool_;
  return sampleDiverse(usable, n);
}

// Test/teardown hook.
export async function closeCatalog() {
  await saveSnapshot();
  if (pool) await pool.end().catch(() => {});
  pool = null;
  rows = new Map();
  backend = "none";
  dirty = false;
}

export default { initCatalog, upsertTracks, sampleTracks, catalogStats, genreCount, catalogBackend, catalogReady, saveSnapshot };
