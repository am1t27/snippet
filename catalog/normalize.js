// Raw iTunes record -> catalog row.
//
// The row shape is deliberately close to what the game already consumes
// (itunesFetcher's output: trackName / artistName / previewUrl / trackId /
// releaseYear), so the round builder in gameLogic.js needs no changes at all.
// The extra fields (genreKeys, artistId, durationMs) exist for querying.

import { familiesForAppleGenre } from "./genres.js";

export const MIN_DURATION_MS = 20 * 1000; // same floor the live fetcher uses

// Canonical title form for near-duplicate collapsing: drop a trailing
// "(feat …)" / "[remix]" suffix, then keep alphanumerics only.
// Mirrors itunesFetcher.baseTitle so both paths dedupe identically.
export function baseTitle(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/\s*[([].*$/, "")
    .replace(/[^a-z0-9]/g, "");
}

// Convert one raw iTunes track. Returns null when the track is unusable.
// `seedGenreKeys` carries the family a track was ingested FOR — the only way
// seeded-only families (drill, trap) ever get members, since Apple labels them
// all "Hip-Hop/Rap".
export function toCatalogRow(raw, seedGenreKeys = []) {
  if (!raw || !raw.previewUrl || !raw.trackId) return null;
  if (!(Number(raw.trackTimeMillis) > MIN_DURATION_MS)) return null;
  const trackName = String(raw.trackName || "").trim();
  const artistName = String(raw.artistName || "").trim();
  if (!trackName || !artistName) return null;

  const appleGenre = raw.primaryGenreName || null;
  const matched = familiesForAppleGenre(appleGenre);
  const seeded = (seedGenreKeys || []).map((k) => String(k).toLowerCase());
  const genreKeys = [...new Set([...matched, ...seeded])];
  // A track nothing can classify is dead weight: it could never be sampled.
  if (genreKeys.length === 0) return null;

  const year = raw.releaseDate ? Number(String(raw.releaseDate).slice(0, 4)) : null;
  return {
    trackId: String(raw.trackId),
    trackName,
    artistName,
    artistId: raw.artistId ? String(raw.artistId) : null,
    previewUrl: raw.previewUrl,
    appleGenre,
    genreKeys,
    releaseYear: Number.isFinite(year) ? year : null,
    durationMs: Number(raw.trackTimeMillis),
    baseTitle: baseTitle(trackName),
  };
}

// Normalize a batch, dropping unusable records and collapsing duplicate track
// IDs. Rows that repeat merge their genreKeys rather than overwrite, so a track
// ingested first from the pop chart and later from a drill artist ends up in
// both families.
export function toCatalogRows(rawList, seedGenreKeys = []) {
  const byId = new Map();
  for (const raw of rawList || []) {
    const row = toCatalogRow(raw, seedGenreKeys);
    if (!row) continue;
    const prev = byId.get(row.trackId);
    if (prev) prev.genreKeys = [...new Set([...prev.genreKeys, ...row.genreKeys])];
    else byId.set(row.trackId, row);
  }
  return [...byId.values()];
}

export default { toCatalogRow, toCatalogRows, baseTitle, MIN_DURATION_MS };
