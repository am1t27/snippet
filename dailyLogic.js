// Daily challenge pure logic. No sockets, no storage, no clocks of its own:
// callers inject dates and the song source so everything here is testable
// offline. The daily is one frozen 5-song puzzle per UTC day; scoring reuses
// the live game's maths so a daily point is worth the same as a room point.
import { buildRound, shuffle, questionValueFor, speedBonusFor, streakBonusFor } from "./gameLogic.js";
import { GENRE_KEYS } from "./catalog/genres.js";

export const DAILY_EPOCH = "2026-08-28"; // Daily #1
export const DAILY_ROUNDS = 5;
export const DAILY_OPTIONS = 4;
export const DAILY_ROUND_MS = 10000;

const MS_PER_DAY = 86400000;

export function dayKey(date = new Date()) {
  return date.toISOString().slice(0, 10); // UTC calendar day
}

export function dailyNumber(day) {
  return Math.round((Date.parse(day) - Date.parse(DAILY_EPOCH)) / MS_PER_DAY) + 1;
}

// One round per distinct genre. A genre whose fetch fails or is too thin is
// replaced by the next unused genre; fewer than DAILY_ROUNDS buildable genres
// throws (the caller treats that as "puzzle not available yet", never a crash).
export async function buildDailyRounds({
  getSongs,
  genreKeys = GENRE_KEYS,
  rounds = DAILY_ROUNDS,
  optionsCount = DAILY_OPTIONS,
}) {
  const queue = shuffle(genreKeys);
  const built = [];
  const usedTrackIds = new Set();
  const settings = { optionsCount, mode: "TITLE" };
  while (built.length < rounds && queue.length > 0) {
    const genre = queue.shift();
    let pool;
    try {
      pool = await getSongs(genre, 16);
    } catch {
      continue; // thin or failing genre: use the next one
    }
    if (!pool || pool.length < optionsCount) continue;
    const round = buildRound(pool, usedTrackIds, settings);
    usedTrackIds.add(round.trackId);
    built.push(round);
  }
  if (built.length < rounds) throw new Error("not enough playable genres for a daily puzzle");
  return built;
}

// Identical scoring maths to the live game, evaluated from server-side timing.
// elapsedMs beyond the round length scores 0 even if the guess was right (the
// server's expiry timer should normally fire first; this is the backstop).
export function scoreDailyAnswer({ isCorrect, elapsedMs, roundIndex, streak }) {
  const questionValue = questionValueFor(roundIndex);
  if (!isCorrect || elapsedMs > DAILY_ROUND_MS) {
    return { points: 0, questionValue, speedBonus: 0, streakBonus: 0 };
  }
  const speedBonus = speedBonusFor(elapsedMs, DAILY_ROUND_MS);
  const streakBonus = streakBonusFor(streak);
  return { points: questionValue + speedBonus + streakBonus, questionValue, speedBonus, streakBonus };
}

// daysPlayed: array of "YYYY-MM-DD". Streak = consecutive run ending today,
// or ending yesterday when today is still unplayed.
export function computeStreak(daysPlayed, today) {
  const played = new Set(daysPlayed);
  let cursor = played.has(today)
    ? today
    : dayKey(new Date(Date.parse(today) - MS_PER_DAY));
  let streak = 0;
  while (played.has(cursor)) {
    streak++;
    cursor = dayKey(new Date(Date.parse(cursor) - MS_PER_DAY));
  }
  return streak;
}

// Clipboard-ready result. Typographic glyphs only (no emoji, per the design
// rules): filled square = correct round, hollow square = missed.
export function shareText({ number, score, perRound }) {
  const grid = perRound.map((ok) => (ok ? "■" : "□")).join(" ");
  return `SNIPPET DAILY #${number} - ${score}\n${grid}\nsnippet-flock.vercel.app`;
}
