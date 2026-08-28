// Client mirror of the server's xpLogic.js - keep the two in sync.
// Guests earn XP on this device only; verified players get the server's
// authoritative award and this module just renders it.

export function xpForScore(score) {
  return Math.max(0, Math.round((Number(score) || 0) / 10));
}

export function xpToNext(level) {
  return Math.round(100 * Math.pow(level, 1.5));
}

export const RANKS = ["CADET", "BUSKER", "OPENER", "SIDESTAGE", "HEADLINER", "ENCORE", "LEGEND"];

export function rankForLevel(level) {
  return RANKS[Math.min(RANKS.length - 1, Math.floor((level - 1) / 5))];
}

export function levelForXp(xp) {
  let level = 1;
  let remaining = Math.max(0, Number(xp) || 0);
  while (remaining >= xpToNext(level)) {
    remaining -= xpToNext(level);
    level += 1;
  }
  return level;
}

export function progressWithin(xp) {
  let level = 1;
  let remaining = Math.max(0, Number(xp) || 0);
  while (remaining >= xpToNext(level)) {
    remaining -= xpToNext(level);
    level += 1;
  }
  return { level, rank: rankForLevel(level), into: remaining, needed: xpToNext(level) };
}

export function awardFor(totalBefore, score) {
  const gained = xpForScore(score);
  const total = (Math.max(0, Number(totalBefore) || 0)) + gained;
  const before = levelForXp(totalBefore);
  const after = progressWithin(total);
  return {
    gained,
    total,
    level: after.level,
    rank: after.rank,
    into: after.into,
    needed: after.needed,
    leveledUp: after.level > before,
  };
}
