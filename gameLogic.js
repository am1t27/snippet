// Pure, side-effect-free game logic — extracted from server.js so it can be
// unit-tested without spinning up a server or hitting the network. Nothing here
// touches sockets, timers, or rooms; it's all deterministic given its inputs
// (except shuffle/buildRound, which use Math.random by design).

import { maskProfanity } from "./profanity.js";
import { GENRE_KEYS } from "./catalog/genres.js";

// ----- Scoring constants -----
export const QUESTION_BASE = 300;
export const QUESTION_STEP = 250;
export const MAX_SPEED_BONUS = 350;

// ----- Host-configurable settings (allowlists; first item is the default) -----
export const ROUND_CHOICES = [10, 5, 15];
export const TIMER_CHOICES = [10000, 7500, 15000];
export const OPTION_CHOICES = [4, 3, 6];
export const MODE_CHOICES = ["TITLE", "ARTIST"];
// "new" = last ~3 years (resolved dynamically in the fetcher); the rest are
// fixed decade buckets. First item is the default.
export const DECADE_CHOICES = ["all", "new", "2020s", "2010s", "2000s", "1990s", "1980s"];
// Clip start: RANDOM plays from a random offset; INTRO (Heardle-style) plays
// from the very start of the track. The offset itself is applied client-side;
// the server just records the choice and tells the client via state.clip.
export const CLIP_CHOICES = ["RANDOM", "INTRO"];
// Match format. CLASSIC is the fixed-round game. KNOCKOUT removes players as
// the match runs and ends only when one is left standing (no round limit).
export const FORMAT_CHOICES = ["CLASSIC", "KNOCKOUT"];
// Knockout rule. SLOWEST eliminates exactly one player per round. LIVES gives
// everyone a life pool and eliminates them at zero.
export const KNOCKOUT_CHOICES = ["SLOWEST", "LIVES"];
// Lives under the LIVES rule. A 2-player duel starts with more, because it has
// no thinning field to create pressure.
export const KNOCKOUT_LIVES = 3;
export const KNOCKOUT_LIVES_DUEL = 4;
// Playable genres come from the catalog's genre registry (one source of truth
// for ingest, validation, and the lobby picker). First key is the default.
export const ALLOWED_GENRES = GENRE_KEYS;

export const DEFAULT_SETTINGS = {
  rounds: ROUND_CHOICES[0],
  roundMs: TIMER_CHOICES[0],
  optionsCount: OPTION_CHOICES[0],
  mode: MODE_CHOICES[0],
  decade: DECADE_CHOICES[0],
  clip: CLIP_CHOICES[0],
  genre: "hip-hop",
  format: FORMAT_CHOICES[0],
  knockout: KNOCKOUT_CHOICES[0],
};

// Coerce an untrusted settings payload into a safe, fully-populated object.
export function sanitizeSettings(payload) {
  const p = payload && typeof payload === "object" ? payload : {};
  const pick = (val, choices) => (choices.includes(val) ? val : choices[0]);
  const genre = String(p.genre ?? "").toLowerCase();
  return {
    rounds: pick(Number(p.rounds), ROUND_CHOICES),
    roundMs: pick(Number(p.roundMs), TIMER_CHOICES),
    optionsCount: pick(Number(p.optionsCount), OPTION_CHOICES),
    mode: pick(String(p.mode || "").toUpperCase(), MODE_CHOICES),
    decade: pick(String(p.decade || "").toLowerCase(), DECADE_CHOICES),
    clip: pick(String(p.clip || "").toUpperCase(), CLIP_CHOICES),
    genre: ALLOWED_GENRES.includes(genre) ? genre : DEFAULT_SETTINGS.genre,
    format: pick(String(p.format || "").toUpperCase(), FORMAT_CHOICES),
    // Always populated so the settings object keeps a fixed shape; ignored
    // unless format is KNOCKOUT.
    knockout: pick(String(p.knockout || "").toUpperCase(), KNOCKOUT_CHOICES),
  };
}

// Pool size needed for a match: enough distinct tracks for every round plus a
// full set of distractors, with headroom. Bounded so we never hammer the API.
export function poolSizeFor(settings) {
  return Math.min(60, Math.max(16, settings.rounds + settings.optionsCount + 6));
}

// Allow letters, digits, space, underscore, hyphen; then mask guest profanity.
export function cleanName(raw) {
  const cleaned = String(raw ?? "")
    .replace(/[^a-zA-Z0-9 _\-]/g, "")
    .trim()
    .slice(0, 20);
  return maskProfanity(cleaned);
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

// Build one round: a correct track + (optionsCount - 1) distractors. In TITLE
// mode the options are track names; in ARTIST mode they are artist names. Every
// option is a distinct value AND (where the pool allows) a distinct artist.
export function buildRound(pool, usedTrackIds, settings) {
  const need = settings.optionsCount - 1;
  const valueOf = settings.mode === "ARTIST" ? (t) => t.artistName : (t) => t.trackName;

  const unused = pool.filter((t) => !usedTrackIds.has(t.trackId));
  const candidates = unused.length > 0 ? unused : pool;
  const correct = candidates[Math.floor(Math.random() * candidates.length)];
  const correctValue = valueOf(correct);

  const usedValues = new Set([correctValue]);
  const usedArtists = new Set([correct.artistName]);
  const distractors = [];
  const others = shuffle(pool.filter((t) => t.trackId !== correct.trackId));

  // First pass: distinct artist and distinct displayed value.
  for (const t of others) {
    if (distractors.length === need) break;
    if (usedArtists.has(t.artistName)) continue;
    if (usedValues.has(valueOf(t))) continue;
    distractors.push(t);
    usedArtists.add(t.artistName);
    usedValues.add(valueOf(t));
  }
  // Fallback: relax the distinct-artist rule, keep distinct displayed values.
  if (distractors.length < need) {
    for (const t of others) {
      if (distractors.length === need) break;
      if (usedValues.has(valueOf(t))) continue;
      distractors.push(t);
      usedValues.add(valueOf(t));
    }
  }

  const options = shuffle([correctValue, ...distractors.map(valueOf)]);
  return {
    audioUrl: correct.previewUrl,
    options,
    correct: correctValue,
    artistName: correct.artistName,
    trackName: correct.trackName,
    trackId: correct.trackId,
    artworkUrl: correct.artworkUrl || null, // shown on reveal only
  };
}

export function questionValueFor(roundIndex) {
  return QUESTION_BASE + roundIndex * QUESTION_STEP;
}
export function speedBonusFor(elapsedMs, roundMs) {
  const ratio = Math.max(0, Math.min(1, (roundMs - elapsedMs) / roundMs));
  return Math.round(MAX_SPEED_BONUS * ratio);
}
export function streakBonusFor(streak) {
  if (streak >= 4) return 200;
  if (streak === 3) return 100;
  if (streak === 2) return 50;
  return 0;
}

// ----- Knockout -----

// Rank one round's outcomes best-first. The ordering is total and
// deterministic, so "who goes out" is never random:
//   1. correct answers, fastest first
//   2. wrong answers (answering wrong quickly is not rewarded)
//   3. no answer at all
// Ties fall through to higher score, then earlier join order.
// `entries` is [{ id, correct, elapsedMs, score, joinIndex }]; elapsedMs is
// null when the player did not answer. Returns a new array; never mutates.
export function rankRoundResults(entries) {
  const tier = (x) => (x.correct ? 0 : x.elapsedMs == null ? 2 : 1);
  return entries.slice().sort((a, b) => {
    const ta = tier(a);
    const tb = tier(b);
    if (ta !== tb) return ta - tb;
    // Speed only separates correct answers.
    if (ta === 0 && a.elapsedMs !== b.elapsedMs) return a.elapsedMs - b.elapsedMs;
    if (a.score !== b.score) return b.score - a.score;
    return a.joinIndex - b.joinIndex;
  });
}

// SLOWEST: exactly one player leaves per round, the worst-ranked one.
export function pickEliminated(entries) {
  const ranked = rankRoundResults(entries);
  return ranked.length > 0 ? ranked[ranked.length - 1].id : null;
}

// LIVES: a wrong or missing answer costs one life.
//
// The Sweep rule closes the stalemate hole. When every alive player answers
// correctly, no life would be lost and the round would change nothing; with no
// round cap that is an unbounded match, not merely a dull stretch. So a clean
// sweep costs the slowest correct player a life. It fires only when nobody was
// already wrong, so normal play keeps its forgiving feel, and it applies at
// every player count, which is why no separate two-player endgame is needed.
//
// Because every round removes at least one life, a match is bounded by the
// lives on the board: at most startingPlayers * lives - 1 rounds.
//
// Returns a new Map; the input is never mutated.
export function applyLives(entries, livesById) {
  const missed = entries.filter((x) => !x.correct);
  const lost = [];
  let swept = false;

  if (missed.length > 0) {
    for (const x of missed) lost.push(x.id);
  } else if (entries.length > 0) {
    swept = true;
    const ranked = rankRoundResults(entries);
    lost.push(ranked[ranked.length - 1].id);
  }

  const next = new Map(livesById);
  for (const id of lost) next.set(id, Math.max(0, (next.get(id) ?? 0) - 1));
  return { lives: next, lost, swept };
}

// Placements count DOWN as the field thins: the first player out of eight
// takes 8th, the survivor takes 1st. When several players go out in the same
// round they fill the contiguous block at the bottom of what is still
// available, ordered among themselves by score, so a higher score always
// places better. That also resolves the case where every remaining player is
// eliminated at once: the best score takes 1st and there is no draw.
export function placementFor(startingCount, alreadyEliminated, batch) {
  const worstAvailable = startingCount - alreadyEliminated;
  const ordered = batch.slice().sort((a, b) => b.score - a.score);
  return ordered.map((x, i) => ({
    id: x.id,
    placement: worstAvailable - (ordered.length - 1 - i),
  }));
}
