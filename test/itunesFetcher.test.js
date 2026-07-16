import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock node-fetch (the module imports the default export) so these tests are
// fully offline and deterministic.
vi.mock("node-fetch", () => ({ default: vi.fn() }));
import fetch from "node-fetch";
import { fetchSongs, clearCache } from "../itunesFetcher.js";

const ok = (results) => ({ ok: true, json: async () => ({ results }) });

const RESULTS = [
  { trackId: 1, trackName: "A", artistName: "Ann", previewUrl: "u1", trackTimeMillis: 30000, releaseDate: "2021-01-01T00:00:00Z" },
  { trackId: 1, trackName: "A", artistName: "Ann", previewUrl: "u1", trackTimeMillis: 30000, releaseDate: "2021-01-01T00:00:00Z" }, // dupe trackId
  { trackId: 2, trackName: "B", artistName: "Ben", previewUrl: "u2", trackTimeMillis: 30000, releaseDate: "2015-01-01" },
  { trackId: 3, trackName: "C", artistName: "Cara", previewUrl: "u3", trackTimeMillis: 30000, releaseDate: "2003-01-01" },
  { trackId: 4, trackName: "D", artistName: "Dee", previewUrl: "u4", trackTimeMillis: 10000, releaseDate: "2019-01-01" }, // too short
  { trackId: 5, trackName: "E", artistName: "Eli", previewUrl: null, trackTimeMillis: 30000, releaseDate: "2019-01-01" }, // no preview
  { trackId: 6, trackName: "F", artistName: "Ann", previewUrl: "u6", trackTimeMillis: 40000, releaseDate: "2015-06-01" },
];

beforeEach(() => {
  clearCache();
  fetch.mockReset();
});

describe("fetchSongs (mocked iTunes)", () => {
  it("normalizes: drops no-preview/too-short, dedupes by trackId", async () => {
    fetch.mockResolvedValue(ok(RESULTS));
    const out = await fetchSongs("rap", 10);
    const ids = out.map((t) => t.trackId).sort();
    // valid: 1, 2, 3, 6 (4 too short, 5 no preview, dup 1 removed)
    expect(ids).toEqual([1, 2, 3, 6]);
    expect(out.every((t) => t.previewUrl && t.trackName && t.artistName)).toBe(true);
  });

  it("biases toward a decade but falls back when too sparse", async () => {
    fetch.mockResolvedValue(ok(RESULTS));
    const only2015 = await fetchSongs("rap", 2, { decade: "2010s" });
    expect(only2015.every((t) => t.releaseYear >= 2010 && t.releaseYear <= 2019)).toBe(true);

    // 1990s has zero matches -> falls back to the full pool rather than empty.
    clearCache();
    fetch.mockResolvedValue(ok(RESULTS));
    const fallback = await fetchSongs("rap", 3, { decade: "1990s" });
    expect(fallback.length).toBe(3);
  });

  it("filters out off-genre tracks (iTunes term search is fuzzy)", async () => {
    const MIXED = [
      { trackId: 11, trackName: "H1", artistName: "R1", previewUrl: "u", trackTimeMillis: 30000, primaryGenreName: "Hip-Hop/Rap" },
      { trackId: 12, trackName: "H2", artistName: "R2", previewUrl: "u", trackTimeMillis: 30000, primaryGenreName: "Korean Hip-Hop" },
      { trackId: 13, trackName: "P1", artistName: "R3", previewUrl: "u", trackTimeMillis: 30000, primaryGenreName: "Pop" },
      { trackId: 14, trackName: "C1", artistName: "R4", previewUrl: "u", trackTimeMillis: 30000, primaryGenreName: "Country" },
      { trackId: 15, trackName: "S1", artistName: "R5", previewUrl: "u", trackTimeMillis: 30000, primaryGenreName: "R&B/Soul" },
      { trackId: 16, trackName: "H3", artistName: "R6", previewUrl: "u", trackTimeMillis: 30000, primaryGenreName: "Hip-Hop/Rap" },
      { trackId: 17, trackName: "H4", artistName: "R7", previewUrl: "u", trackTimeMillis: 30000, primaryGenreName: "Hip-Hop/Rap" },
      { trackId: 18, trackName: "H5", artistName: "R8", previewUrl: "u", trackTimeMillis: 30000, primaryGenreName: "Hip-Hop/Rap" },
      { trackId: 19, trackName: "H6", artistName: "R9", previewUrl: "u", trackTimeMillis: 30000, primaryGenreName: "Hip-Hop/Rap" },
      { trackId: 20, trackName: "H7", artistName: "R10", previewUrl: "u", trackTimeMillis: 30000, primaryGenreName: "Hip-Hop/Rap" },
      { trackId: 21, trackName: "H8", artistName: "R11", previewUrl: "u", trackTimeMillis: 30000, primaryGenreName: "Hip-Hop/Rap" },
      { trackId: 22, trackName: "H9", artistName: "R12", previewUrl: "u", trackTimeMillis: 30000, primaryGenreName: "Hip-Hop/Rap" },
      { trackId: 23, trackName: "H10", artistName: "R13", previewUrl: "u", trackTimeMillis: 30000, primaryGenreName: "Hip-Hop/Rap" },
      { trackId: 24, trackName: "H11", artistName: "R14", previewUrl: "u", trackTimeMillis: 30000, primaryGenreName: "Hip-Hop/Rap" },
    ];
    // 11 on-genre (10 Hip-Hop/Rap + 1 Korean Hip-Hop) clears MIN_GENRE_POOL, so
    // the off-genre Pop/Country/R&B tracks are actually dropped (not fallback).
    fetch.mockResolvedValue(ok(MIXED));
    const out = await fetchSongs("hip-hop", 14);
    // Pop, Country, and R&B/Soul must be gone; Korean Hip-Hop stays (it is hip-hop).
    expect(out.every((t) => /hip-hop|rap/i.test(t.primaryGenreName))).toBe(true);
    expect(out.some((t) => t.primaryGenreName === "Pop")).toBe(false);
    expect(out.some((t) => t.primaryGenreName === "Country")).toBe(false);
    expect(out.some((t) => t.primaryGenreName === "R&B/Soul")).toBe(false);
  });

  it("drops bare genre-word titles and collapses near-duplicate titles (drill/trap fix)", async () => {
    const DRILLY = [
      // 20 songs literally titled "Drill" + case/paren variants — all one title.
      ...Array.from({ length: 20 }, (_, i) => ({ trackId: 100 + i, trackName: "Drill", artistName: "A" + i, previewUrl: "u", trackTimeMillis: 30000, primaryGenreName: "Hip-Hop/Rap" })),
      { trackId: 200, trackName: "DRILL", artistName: "B", previewUrl: "u", trackTimeMillis: 30000, primaryGenreName: "Hip-Hop/Rap" },
      { trackId: 201, trackName: "Drill (Instrumental)", artistName: "C", previewUrl: "u", trackTimeMillis: 30000, primaryGenreName: "Hip-Hop/Rap" },
      // real, varied titles that must survive.
      { trackId: 202, trackName: "Welcome to the Party", artistName: "D", previewUrl: "u", trackTimeMillis: 30000, primaryGenreName: "Hip-Hop/Rap" },
      { trackId: 203, trackName: "Dior", artistName: "E", previewUrl: "u", trackTimeMillis: 30000, primaryGenreName: "Hip-Hop/Rap" },
      { trackId: 204, trackName: "You Know the Drill (feat. X)", artistName: "F", previewUrl: "u", trackTimeMillis: 30000, primaryGenreName: "Hip-Hop/Rap" },
    ];
    fetch.mockResolvedValue(ok(DRILLY));
    const out = await fetchSongs("drill", 10);
    const titles = out.map((t) => t.trackName.toLowerCase());
    // No option is the bare genre word.
    expect(titles.includes("drill")).toBe(false);
    expect(titles.includes("drill (instrumental)")).toBe(false);
    // Distinct base titles only (no visual duplicates).
    const base = out.map((t) => t.trackName.toLowerCase().replace(/\s*[([].*$/, "").replace(/[^a-z0-9]/g, ""));
    expect(new Set(base).size).toBe(base.length);
    // The real songs survived (incl. "You Know the Drill", which is not bare "drill").
    expect(titles).toContain("welcome to the party");
    expect(titles).toContain("you know the drill (feat. x)");
  });

  it("caches by genre (one network call for repeated same-genre fetches)", async () => {
    fetch.mockResolvedValue(ok(RESULTS));
    await fetchSongs("rap", 3);
    await fetchSongs("rap", 3);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("prioritizes artist diversity in the sample", async () => {
    fetch.mockResolvedValue(ok(RESULTS));
    // Ann appears twice (tracks 1 and 6); a 3-pick sample should use 3 distinct
    // artists before repeating Ann.
    const out = await fetchSongs("rap", 3);
    const artists = out.map((t) => t.artistName);
    expect(new Set(artists).size).toBe(3);
  });

  it("falls back to stale cache on a network error", async () => {
    fetch.mockResolvedValueOnce(ok(RESULTS));
    await fetchSongs("rap", 3); // warm the cache
    fetch.mockRejectedValueOnce(new Error("network down"));
    const out = await fetchSongs("rap", 3);
    expect(out.length).toBe(3);
  });
});
