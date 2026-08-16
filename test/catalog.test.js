import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import os from "node:os";
import path from "node:path";
import { mkdtemp, readFile } from "node:fs/promises";

// Offline: mock the network layer before anything imports it.
vi.mock("node-fetch", () => ({ default: vi.fn() }));
import fetch from "node-fetch";

import { GENRE_FAMILIES, GENRE_KEYS, familiesForAppleGenre, seedArtistsFor } from "../catalog/genres.js";
import { toCatalogRow, toCatalogRows } from "../catalog/normalize.js";
import { sampleDiverse, filterDecade, decadeRange } from "../catalog/sample.js";
import {
  initCatalog, upsertTracks, sampleTracks, catalogStats, genreCount, saveSnapshot, closeCatalog, catalogBackend,
} from "../catalog/store.js";

const raw = (over = {}) => ({
  wrapperType: "track",
  trackId: 100,
  trackName: "Song",
  artistName: "Artist",
  artistId: 7,
  previewUrl: "https://cdn/preview.m4a",
  primaryGenreName: "Hip-Hop/Rap",
  trackTimeMillis: 30000,
  releaseDate: "2015-06-01T00:00:00Z",
  ...over,
});

describe("genres registry", () => {
  it("every family has a label and seed artists; matched families have a regex", () => {
    for (const key of GENRE_KEYS) {
      const fam = GENRE_FAMILIES[key];
      expect(fam.label, key).toBeTruthy();
      expect(fam.seedArtists.length, key).toBeGreaterThan(5);
      expect(fam.match === null || fam.match instanceof RegExp).toBe(true);
    }
  });

  it("default genre (first key) stays hip-hop", () => {
    expect(GENRE_KEYS[0]).toBe("hip-hop");
  });

  it("maps Apple labels to families; drill/trap stay seeded-only", () => {
    expect(familiesForAppleGenre("Hip-Hop/Rap")).toEqual(expect.arrayContaining(["hip-hop", "rap"]));
    expect(familiesForAppleGenre("Hip-Hop/Rap")).not.toContain("drill");
    expect(familiesForAppleGenre("R&B/Soul")).toContain("r&b");
    expect(familiesForAppleGenre("Música Mexicana")).toContain("latin");
    expect(familiesForAppleGenre("Afrobeats")).toContain("afrobeats");
    expect(familiesForAppleGenre("K-Pop")).toContain("k-pop");
    expect(familiesForAppleGenre("Nonexistent Genre")).toEqual([]);
    expect(seedArtistsFor("drill").length).toBeGreaterThan(0);
    expect(seedArtistsFor("nope")).toEqual([]);
  });
});

describe("normalize", () => {
  it("converts a raw track and classifies it", () => {
    const row = toCatalogRow(raw());
    expect(row).toMatchObject({
      trackId: "100",
      trackName: "Song",
      artistName: "Artist",
      previewUrl: "https://cdn/preview.m4a",
      releaseYear: 2015,
    });
    expect(row.genreKeys).toEqual(expect.arrayContaining(["hip-hop", "rap"]));
  });

  it("drops unusable tracks: no preview, too short, unclassifiable", () => {
    expect(toCatalogRow(raw({ previewUrl: null }))).toBeNull();
    expect(toCatalogRow(raw({ trackTimeMillis: 10000 }))).toBeNull();
    expect(toCatalogRow(raw({ primaryGenreName: "Spoken Word" }))).toBeNull();
  });

  it("seed genre tags a track into a seeded-only family and merges on dupes", () => {
    const row = toCatalogRow(raw(), ["drill"]);
    expect(row.genreKeys).toEqual(expect.arrayContaining(["hip-hop", "rap", "drill"]));

    const rows = toCatalogRows([raw(), raw({ primaryGenreName: "Pop" })], ["trap"]);
    expect(rows).toHaveLength(1); // same trackId collapses
    expect(rows[0].genreKeys).toEqual(expect.arrayContaining(["hip-hop", "trap", "pop"]));
  });

  it("keeps a seeded track whose Apple label matches nothing", () => {
    const row = toCatalogRow(raw({ primaryGenreName: "Spoken Word" }), ["drill"]);
    expect(row.genreKeys).toEqual(["drill"]);
  });
});

describe("sample", () => {
  const mk = (id, artist, year, title) => ({
    trackId: String(id), trackName: title || `T${id}`, artistName: artist,
    previewUrl: "u", releaseYear: year, baseTitle: (title || `t${id}`).toLowerCase(),
  });

  it("maximises artist diversity (round-robin before repeats)", () => {
    const rows = [mk(1, "A", 2020), mk(2, "A", 2020), mk(3, "A", 2020), mk(4, "B", 2020), mk(5, "C", 2020)];
    const out = sampleDiverse(rows, 3);
    expect(new Set(out.map((r) => r.artistName)).size).toBe(3);
  });

  it("collapses duplicate base titles", () => {
    const rows = [mk(1, "A", 2020, "Hit"), mk(2, "B", 2020, "Hit"), mk(3, "C", 2020, "Other")];
    const out = sampleDiverse(rows, 3);
    expect(out.length).toBe(2);
  });

  it("decade filter is inclusive; 'new' tracks the current year", () => {
    const rows = [mk(1, "A", 1994), mk(2, "B", 2005), mk(3, "C", new Date().getFullYear())];
    expect(filterDecade(rows, "1990s").map((r) => r.trackId)).toEqual(["1"]);
    expect(filterDecade(rows, "new").map((r) => r.trackId)).toEqual(["3"]);
    expect(filterDecade(rows, "all")).toHaveLength(3);
    const [lo, hi] = decadeRange("new");
    expect(hi - lo).toBe(3);
  });
});

describe("store (file backend)", () => {
  let dir;
  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "catalog-test-"));
    process.env.CATALOG_FILE = path.join(dir, "snapshot.json");
    delete process.env.DATABASE_URL;
    await closeCatalog();
    await initCatalog(null);
  });
  afterEach(async () => {
    await closeCatalog();
    delete process.env.CATALOG_FILE;
  });

  const seed = () =>
    upsertTracks([
      ...Array.from({ length: 30 }, (_, i) =>
        toCatalogRow(raw({ trackId: 1000 + i, trackName: `Rap ${i}`, artistName: `MC ${i % 10}`, releaseDate: "2021-01-01" }))
      ),
      ...Array.from({ length: 10 }, (_, i) =>
        toCatalogRow(raw({ trackId: 2000 + i, trackName: `Old ${i}`, artistName: `OG ${i}`, releaseDate: "1995-01-01" }))
      ),
    ]);

  it("uses the file backend without DATABASE_URL", () => {
    expect(catalogBackend()).toBe("file");
  });

  it("upserts, counts, and samples in the fetcher's row shape", async () => {
    await seed();
    expect(await genreCount("hip-hop")).toBe(40);
    expect(await genreCount("pop")).toBe(0);

    const out = await sampleTracks({ genre: "hip-hop", count: 8 });
    expect(out).toHaveLength(8);
    for (const t of out) {
      expect(t.trackId).toBeTruthy();
      expect(t.trackName).toBeTruthy();
      expect(t.artistName).toBeTruthy();
      expect(t.previewUrl).toBeTruthy();
    }
  });

  it("biases to a decade and falls back when the decade is starved", async () => {
    await seed();
    const nineties = await sampleTracks({ genre: "hip-hop", decade: "1990s", count: 8 });
    expect(nineties.every((t) => t.releaseYear >= 1990 && t.releaseYear <= 1999)).toBe(true);
    // Only 10 nineties tracks exist; asking for 20 falls back to the full pool.
    const wide = await sampleTracks({ genre: "hip-hop", decade: "1990s", count: 20 });
    expect(wide.length).toBe(20);
  });

  it("merges genreKeys on re-upsert instead of overwriting", async () => {
    await upsertTracks([toCatalogRow(raw({ trackId: 1 }))]);
    await upsertTracks([toCatalogRow(raw({ trackId: 1 }), ["drill"])]);
    expect(await genreCount("drill")).toBe(1);
    expect(await genreCount("hip-hop")).toBe(1);
  });

  it("persists through a snapshot and reloads", async () => {
    await seed();
    await saveSnapshot();
    const onDisk = JSON.parse(await readFile(process.env.CATALOG_FILE, "utf8"));
    expect(onDisk.tracks).toHaveLength(40);

    await closeCatalog();
    await initCatalog(null);
    expect(await genreCount("hip-hop")).toBe(40);
  });

  it("returns [] for an unknown genre or empty catalog", async () => {
    expect(await sampleTracks({ genre: "nope", count: 5 })).toEqual([]);
    const stats = await catalogStats();
    expect(stats.total).toBe(0);
  });
});

describe("songProvider fallback wiring", () => {
  let dir;
  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "catalog-test-"));
    process.env.CATALOG_FILE = path.join(dir, "snapshot.json");
    delete process.env.DATABASE_URL;
    await closeCatalog();
    await initCatalog(null);
    fetch.mockReset();
  });
  afterEach(async () => {
    await closeCatalog();
    delete process.env.CATALOG_FILE;
  });

  it("serves from the catalog when warm (no network call)", async () => {
    await upsertTracks(
      Array.from({ length: 40 }, (_, i) =>
        toCatalogRow(raw({ trackId: 5000 + i, trackName: `S${i}`, artistName: `A${i}` }))
      )
    );
    const { getSongs } = await import("../songProvider.js");
    const out = await getSongs("hip-hop", 10);
    expect(out).toHaveLength(10);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("falls back to the live fetcher when the catalog is thin", async () => {
    const results = Array.from({ length: 30 }, (_, i) => ({
      trackId: 9000 + i, trackName: `Live ${i}`, artistName: `LA ${i}`,
      previewUrl: "u", trackTimeMillis: 30000, primaryGenreName: "Hip-Hop/Rap",
      releaseDate: "2020-01-01",
    }));
    fetch.mockResolvedValue({ ok: true, json: async () => ({ results }) });
    const { getSongs } = await import("../songProvider.js");
    const { clearCache } = await import("../itunesFetcher.js");
    clearCache();
    const out = await getSongs("hip-hop", 10);
    expect(out).toHaveLength(10);
    expect(fetch).toHaveBeenCalled();
  });
});
