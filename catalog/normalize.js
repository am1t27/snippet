// Raw iTunes record -> catalog row.
//
// The row shape is deliberately close to what the game already consumes
// (itunesFetcher's output: trackName / artistName / previewUrl / trackId /
// releaseYear), so the round builder in gameLogic.js needs no changes at all.
// The extra fields (genreKeys, artistId, durationMs) exist for querying.

import { familiesForAppleGenre } from "./genres.js";

export const MIN_DURATION_MS = 20 * 1000; // same floor the live fetcher uses

// Non-original versions. Verified against live iTunes data: track releaseDate
// stays the ORIGINAL song date even on compilations ("The Essential …",
// "Number Ones" both report Billie Jean as 1982) - the versions that DO carry a
// misleading date are exactly these: live cuts, re-records, karaoke/tribute
// covers, DJ mixes, remasters released as new products. They are also the
// versions a trivia game shouldn't play. Dropped at ingest, which is what keeps
// the decade labels accurate.
const JUNK_VERSION_RE =
  /\b(live|karaoke|tribute|cover|remaster(ed)?|re-?record(ed)?|instrumental|acoustic version|sped.?up|slowed|reverb|8.?bit|lullaby|workout|dj mix|medley|originally performed|in the style of|made famous|demo)\b/i;

// Hits compilations, checked against the ALBUM title only. Compilations
// usually keep original track dates, but they are the one album type observed
// carrying wrong ones (a 1999 single dated 1982 on a "…Number One Hits"
// package). Since the original-album copy of every such track is ingested
// anyway, dropping the compilation copy costs nothing and removes the only
// bad-date source found.
const COMPILATION_RE =
  /\b(greatest hits|best of|number one|number ones|anthology|essential|the hits|hits collection|for the record|ultimate collection|decades|the collection)\b/i;

// A track is junk when the version markers appear in its title or its album
// title. Checked against the raw strings (with brackets), not baseTitle, since
// markers usually live in the "(…)" suffix that baseTitle strips.
export function isJunkVersion(trackName, collectionName) {
  return (
    JUNK_VERSION_RE.test(String(trackName || "")) ||
    JUNK_VERSION_RE.test(String(collectionName || "")) ||
    COMPILATION_RE.test(String(collectionName || ""))
  );
}

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
// `seedGenreKeys` carries the family a track was ingested FOR - the only way
// seeded-only families (drill, trap) ever get members, since Apple labels them
// all "Hip-Hop/Rap".
export function toCatalogRow(raw, seedGenreKeys = []) {
  if (!raw || !raw.previewUrl || !raw.trackId) return null;
  if (!(Number(raw.trackTimeMillis) > MIN_DURATION_MS)) return null;
  const trackName = String(raw.trackName || "").trim();
  const artistName = String(raw.artistName || "").trim();
  if (!trackName || !artistName) return null;
  // Live/karaoke/tribute/remaster editions: wrong-era dates and wrong audio.
  if (isJunkVersion(trackName, raw.collectionName)) return null;

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
    // iTunes serves any square size via URL substitution; 300 is crisp enough
    // for the reveal card without weighing down the payload.
    artworkUrl: raw.artworkUrl100 ? String(raw.artworkUrl100).replace("100x100", "300x300") : null,
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
