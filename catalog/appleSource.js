// Apple network layer for the catalog ingest.
//
// Two public, keyless Apple endpoints do all the work:
//
//   1. Marketing Tools RSS  — https://rss.marketingtools.apple.com/api/v2/...
//      Per-storefront "most played" charts (Apple Music streaming, max 100 per
//      feed). Gives track IDs + artist, but NO preview URL.
//   2. iTunes lookup/search — https://itunes.apple.com/{lookup,search}
//      Hydrates those IDs into full track records WITH previewUrl,
//      primaryGenreName and releaseDate, 100 IDs per request. Also expands one
//      artist into up to 200 of their tracks.
//
// WHY BOTH: the iTunes *search* endpoint is hard-capped at ~200 results per term
// and ignores `offset`, so no amount of searching reaches a large pool. Charts
// (breadth: ~175 storefronts) plus artist lookup (depth: 200 tracks per artist)
// have no such ceiling — that is the whole point of the ingest.
//
// Every request is paced. These are unmetered public endpoints and Apple
// rate-limits aggressively when hammered; the ingest is a background job, so
// slow is fine.

import fetch from "node-fetch";

const RSS_BASE = process.env.APPLE_RSS_BASE || "https://rss.marketingtools.apple.com/api/v2";
const ITUNES_BASE = process.env.ITUNES_BASE || "https://itunes.apple.com/search";
// Derive the lookup endpoint from the (test-overridable) search base so a
// fixture server can serve both.
const ITUNES_LOOKUP = ITUNES_BASE.replace(/\/search$/, "/lookup");

export const CHART_MAX = 100; // hard ceiling of the RSS feed (200 returns HTTP 500)
export const LOOKUP_BATCH = 100; // iTunes lookup accepts 100 comma-separated ids
const REQUEST_PACE_MS = Number(process.env.INGEST_PACE_MS) || 250;
const MAX_RETRIES = 2;

// Storefronts worth sweeping by default: the big streaming markets plus the ones
// that carry genres the US chart never surfaces (Afrobeats, Bollywood, K-Pop,
// Música Mexicana, Sertanejo). Override with INGEST_STOREFRONTS=us,gb,… or "all".
export const DEFAULT_STOREFRONTS = [
  "us", "gb", "ca", "au", "ie", "nz",
  "in", "ng", "za", "ke", "gh",
  "br", "mx", "ar", "co", "cl", "es",
  "fr", "de", "it", "nl", "se", "no", "pl", "pt",
  "jp", "kr", "id", "ph", "th", "vn", "my", "sg", "tw", "hk",
  "ae", "sa", "eg", "tr", "il",
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// One paced, retrying JSON GET. Returns null instead of throwing: a single dead
// storefront or a throttled batch must never abort a whole ingest run.
async function getJson(url, { pace = REQUEST_PACE_MS, retries = MAX_RETRIES } = {}) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, { redirect: "follow" });
      if (res.ok) {
        const body = await res.json();
        await sleep(pace);
        return body;
      }
      // 403/429 mean we are going too fast — back off before the next attempt.
      if (res.status === 403 || res.status === 429) await sleep(pace * (attempt + 2) * 4);
      else if (res.status >= 400 && res.status < 500) return null; // 404 etc: no retry
    } catch {
      await sleep(pace * (attempt + 2));
    }
  }
  return null;
}

// Chart entries for one storefront. Returns [{ id, name, artistName }].
export async function chartEntries(storefront, limit = CHART_MAX) {
  const n = Math.min(Math.max(1, Math.floor(limit)), CHART_MAX);
  const url = `${RSS_BASE}/${encodeURIComponent(storefront)}/music/most-played/${n}/songs.json`;
  const body = await getJson(url);
  const results = body?.feed?.results;
  if (!Array.isArray(results)) return [];
  return results
    .filter((r) => r && r.id)
    .map((r) => ({ id: String(r.id), name: r.name, artistName: r.artistName }));
}

// Hydrate raw iTunes track records for up to LOOKUP_BATCH ids at a time.
export async function lookupTracks(ids) {
  const unique = [...new Set((ids || []).map(String).filter(Boolean))];
  const out = [];
  for (let i = 0; i < unique.length; i += LOOKUP_BATCH) {
    const batch = unique.slice(i, i + LOOKUP_BATCH);
    const url = `${ITUNES_LOOKUP}?id=${batch.join(",")}&entity=song&limit=${LOOKUP_BATCH * 2}`;
    const body = await getJson(url);
    for (const r of body?.results || []) {
      if (r && r.wrapperType === "track") out.push(r);
    }
  }
  return out;
}

// Resolve an artist name to an iTunes artistId (null when unknown).
export async function artistIdFor(name) {
  const url = `${ITUNES_BASE}?term=${encodeURIComponent(name)}&entity=musicArtist&limit=1`;
  const body = await getJson(url);
  const hit = (body?.results || [])[0];
  return hit && hit.artistId ? String(hit.artistId) : null;
}

// Every track iTunes will return for one artist (its own 200-row ceiling, but
// per ARTIST rather than per search term — that is where catalogue depth and
// older releases come from).
export async function songsForArtist(artistId, limit = 200) {
  const url = `${ITUNES_LOOKUP}?id=${encodeURIComponent(artistId)}&entity=song&limit=${Math.min(200, limit)}`;
  const body = await getJson(url);
  return (body?.results || []).filter((r) => r && r.wrapperType === "track");
}

export default { chartEntries, lookupTracks, artistIdFor, songsForArtist, DEFAULT_STOREFRONTS };
