// XP / level / rank curve - pure and deterministic, shared by the server
// (verified players, persisted) and mirrored on the client for guests
// (client/src/xp.js is a copy; keep the two in sync).
//
// XP source: final score / 10, both live matches and dailies, so a daily
// point is worth the same as a room point.

export function xpForScore(score) {
  return Math.max(0, Math.round((Number(score) || 0) / 10));
}

// Cost to go FROM level L to L+1. Gentle early game, real grind later:
// L1->2 = 100, L5->6 = 1118, L10->11 = 3162.
export function xpToNext(level) {
  return Math.round(100 * Math.pow(level, 1.5));
}

// Arcade ranks, one per 5 levels; the last one holds forever.
export const RANKS = ["CADET", "BUSKER", "OPENER", "SIDESTAGE", "HEADLINER", "ENCORE", "LEGEND"];

export function rankForLevel(level) {
  return RANKS[Math.min(RANKS.length - 1, Math.floor((level - 1) / 5))];
}

// Total XP -> level (1-based).
export function levelForXp(xp) {
  let level = 1;
  let remaining = Math.max(0, Number(xp) || 0);
  while (remaining >= xpToNext(level)) {
    remaining -= xpToNext(level);
    level += 1;
  }
  return level;
}

// Everything a progress bar needs: current level, rank, xp into this level,
// and the cost of the next one.
export function progressWithin(xp) {
  let level = 1;
  let remaining = Math.max(0, Number(xp) || 0);
  while (remaining >= xpToNext(level)) {
    remaining -= xpToNext(level);
    level += 1;
  }
  return { level, rank: rankForLevel(level), into: remaining, needed: xpToNext(level) };
}

// One award = the whole xp block a finish payload carries.
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
