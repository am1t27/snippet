// Local player profile stats (localStorage). Purely client-side - a lightweight
// "My profile" without accounts. (A server-backed global profile would live in
// storage.js behind DATABASE_URL.)

const KEY = "snippet.stats";
const EMPTY = { games: 0, wins: 0, bestScore: 0, correct: 0, rounds: 0 };

export function getStats() {
  try {
    return { ...EMPTY, ...(JSON.parse(localStorage.getItem(KEY) || "{}")) };
  } catch {
    return { ...EMPTY };
  }
}

export function recordGame({ won, score, correct, rounds }) {
  const s = getStats();
  const next = {
    games: s.games + 1,
    wins: s.wins + (won ? 1 : 0),
    bestScore: Math.max(s.bestScore, score || 0),
    correct: s.correct + (correct || 0),
    rounds: s.rounds + (rounds || 0),
  };
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* storage blocked */
  }
  return next;
}

// ----- Daily challenge (guest-local) -----
// Server ranks only verified players; a guest's daily history lives here.
const DAILY_KEY = "snippet.daily";
const DAILY_EMPTY = { lastPlayedDay: null, streak: 0, lastScore: 0, lastPerRound: [] };

export function getDailyLocal() {
  try {
    return { ...DAILY_EMPTY, ...(JSON.parse(localStorage.getItem(DAILY_KEY) || "{}")) };
  } catch {
    return { ...DAILY_EMPTY };
  }
}

// day is the server's "YYYY-MM-DD" (UTC). Streak continues when the previous
// play was exactly yesterday, restarts at 1 otherwise.
export function recordDailyLocal({ day, score, perRound }) {
  const prev = getDailyLocal();
  const yesterday = new Date(Date.parse(day) - 86400000).toISOString().slice(0, 10);
  const streak = prev.lastPlayedDay === yesterday ? prev.streak + 1 : prev.lastPlayedDay === day ? prev.streak : 1;
  const next = { lastPlayedDay: day, streak, lastScore: score || 0, lastPerRound: perRound || [] };
  try {
    localStorage.setItem(DAILY_KEY, JSON.stringify(next));
  } catch {
    /* storage blocked */
  }
  return next;
}

// ----- Guest XP (device-local; verified players are server-side) -----
const XP_KEY = "snippet.xp";

export function getXpLocal() {
  try {
    const n = Number(JSON.parse(localStorage.getItem(XP_KEY) || "0"));
    return Number.isFinite(n) && n > 0 ? n : 0;
  } catch {
    return 0;
  }
}

export function setXpLocal(total) {
  try {
    localStorage.setItem(XP_KEY, JSON.stringify(Math.max(0, Number(total) || 0)));
  } catch {
    /* storage blocked */
  }
}

export default { getStats, recordGame, getDailyLocal, recordDailyLocal, getXpLocal, setXpLocal };
