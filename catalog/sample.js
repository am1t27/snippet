// Sampling helpers for the catalog.
//
// Deliberately a copy of the equivalent logic in itunesFetcher.js rather than a
// shared import: the live fetcher is the FALLBACK path and stays frozen, so a
// change here can never regress the safety net.

// Decade buckets. "new" is dynamic (last ~3 calendar years) so it keeps meaning
// recent whenever the game is played; "all"/unknown means no filter.
export const DECADE_RANGES = {
  "2020s": [2020, 2029],
  "2010s": [2010, 2019],
  "2000s": [2000, 2009],
  "1990s": [1990, 1999],
  "1980s": [1980, 1989],
};

export function decadeRange(decade) {
  if (decade === "new") {
    const y = new Date().getFullYear();
    return [y - 2, y + 1];
  }
  return DECADE_RANGES[decade] || null;
}

// Fisher-Yates on a copy. Never mutates the input.
export function shuffle(list) {
  const out = list.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// Sample up to n rows, maximising artist diversity: group by artist, then take
// round-robin (one per artist per pass), so every artist appears once before any
// appears twice. Also collapses near-duplicate titles ("Song", "Song (Remix)")
// so a round never shows the same label twice.
export function sampleDiverse(rows, n) {
  const want = Math.min(n, rows.length);
  if (want <= 0) return [];

  const seenTitle = new Set();
  const byArtist = new Map();
  for (const row of shuffle(rows)) {
    const title = row.baseTitle || String(row.trackName || "").toLowerCase();
    if (seenTitle.has(title)) continue;
    seenTitle.add(title);
    const key = row.artistName;
    if (!byArtist.has(key)) byArtist.set(key, []);
    byArtist.get(key).push(row);
  }

  const groups = shuffle([...byArtist.values()]);
  const out = [];
  while (out.length < want) {
    let picked = false;
    for (const group of groups) {
      if (group.length === 0) continue;
      out.push(group.shift());
      picked = true;
      if (out.length === want) break;
    }
    if (!picked) break;
  }
  return out;
}

// Filter rows to a decade. Returns the unfiltered list when the decade is
// unknown/"all", and the caller decides whether a thin result is worth keeping.
export function filterDecade(rows, decade) {
  const range = decadeRange(decade);
  if (!range) return rows;
  const [lo, hi] = range;
  return rows.filter((r) => r.releaseYear != null && r.releaseYear >= lo && r.releaseYear <= hi);
}

export default { sampleDiverse, filterDecade, decadeRange, shuffle, DECADE_RANGES };
