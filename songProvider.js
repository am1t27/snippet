// Song provider - the one place the game asks for tracks.
//
// Order of preference:
//   1. CATALOG  the local ingested pool (catalog/). Instant, huge, genre- and
//      decade-indexed, immune to third-party outages mid-match.
//   2. LIVE     the original iTunes search fetcher. Kept as the safety net for
//      first boot (ingest still running) and for any genre the catalog is thin
//      on. Frozen behavior, fully unit-tested.
//
// The returned rows are identical in shape either way, so server.js and
// gameLogic.buildRound cannot tell which path served a match.

import { fetchSongs } from "./itunesFetcher.js";
import { sampleTracks, genreCount, catalogReady } from "./catalog/store.js";
import { log } from "./log.js";

// The catalog serves a match only when it can fill the pool comfortably -
// below this it defers to the live fetcher rather than recycling a tiny pool.
const MIN_CATALOG_POOL = 30;

export async function getSongs(genre, count, opts = {}) {
  const decade = (opts && opts.decade) || "all";

  if (catalogReady()) {
    try {
      const available = await genreCount(genre);
      if (available >= Math.max(MIN_CATALOG_POOL, count)) {
        const rows = await sampleTracks({ genre, decade, count });
        if (rows.length >= count) return rows;
      }
    } catch (e) {
      log.warn("catalog sample failed; using live fetcher", { error: String((e && e.message) || e) });
    }
  }

  // Fallback: the original live iTunes search (throws on total failure, which
  // the server already handles with a user-facing error).
  return fetchSongs(genre, count, { decade });
}

export default getSongs;
