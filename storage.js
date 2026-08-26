// Optional persistent storage (Postgres) for a GLOBAL leaderboard + match
// history. Completely dormant unless DATABASE_URL is set AND the `pg` package is
// installed on the host (it is NOT a hard dependency). Every failure is
// swallowed so the live game never breaks because of the database.
//
// Enable: `npm install pg` on the backend host and set DATABASE_URL (Railway's
// Postgres add-on provides one). See DEPLOY.md.

let pool = null;
let ready = false;

export async function initStorage(log) {
  const url = process.env.DATABASE_URL;
  if (!url) return false;
  try {
    const { default: pg } = await import("pg");
    pool = new pg.Pool({ connectionString: url, max: 4 });
    await pool.query(`
      CREATE TABLE IF NOT EXISTS scores (
        id BIGSERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        sub TEXT,
        score INTEGER NOT NULL,
        rounds INTEGER NOT NULL,
        mode TEXT,
        genre TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS daily_puzzles (
        day DATE PRIMARY KEY,
        tracks JSONB NOT NULL
      );
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS daily_results (
        day DATE NOT NULL,
        sub TEXT NOT NULL,
        name TEXT NOT NULL,
        score INTEGER NOT NULL,
        answers JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (day, sub)
      );
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS player_xp (
        sub TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        xp INTEGER NOT NULL DEFAULT 0,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);
    ready = true;
    log?.info?.("postgres storage ready (global leaderboard enabled)");
    return true;
  } catch (e) {
    log?.warn?.("DATABASE_URL set but storage init failed; run `npm install pg` or check the URL", {
      error: String((e && e.message) || e),
    });
    return false;
  }
}

export function storageReady() {
  return ready;
}

// Persist each non-spectator player's final score for a finished match.
export async function recordMatch({ players, settings }, log) {
  if (!ready || !pool) return;
  try {
    for (const p of players) {
      if (p.spectator) continue;
      await pool.query(
        "INSERT INTO scores(name, sub, score, rounds, mode, genre) VALUES($1,$2,$3,$4,$5,$6)",
        [p.name, p.sub || null, p.score, settings.rounds, settings.mode, settings.genre]
      );
    }
  } catch (e) {
    log?.warn?.("recordMatch failed", { error: String((e && e.message) || e) });
  }
}

// Global top scores (each player's best single-match score).
export async function topScores(limit = 20) {
  if (!ready || !pool) return [];
  try {
    const res = await pool.query(
      "SELECT name, MAX(score) AS score FROM scores GROUP BY name ORDER BY score DESC LIMIT $1",
      [Math.min(100, Math.max(1, Number(limit) || 20))]
    );
    return res.rows.map((r, i) => ({ rank: i + 1, name: r.name, score: Number(r.score) }));
  } catch {
    return [];
  }
}

// ----- Daily challenge persistence -----
//
// Same philosophy as the rest of this file: Postgres when DATABASE_URL is up,
// an in-process memory fallback otherwise, and every pg failure degrades to
// the memory path instead of breaking play. In memory mode puzzles and
// results last until the process restarts, which is the accepted degraded
// mode for a single-instance no-DB deploy (guests are unaffected: their
// streaks live in their own browser).

const memPuzzles = new Map(); // day -> rounds[]
const memResults = new Map(); // day -> Map(sub -> { name, score, answers, createdAt })

// pg returns DATE columns as JS Date objects; normalize to "YYYY-MM-DD".
function toDayString(v) {
  return v instanceof Date ? v.toISOString().slice(0, 10) : String(v);
}

// First writer freezes the day. Returns the winning (frozen) puzzle either way.
export async function saveDailyPuzzle(day, rounds) {
  if (ready && pool) {
    try {
      await pool.query(
        "INSERT INTO daily_puzzles(day, tracks) VALUES($1, $2) ON CONFLICT (day) DO NOTHING",
        [day, JSON.stringify(rounds)]
      );
      const res = await pool.query("SELECT tracks FROM daily_puzzles WHERE day = $1", [day]);
      if (res.rows[0]) return res.rows[0].tracks;
    } catch {
      /* fall through to memory */
    }
  }
  if (!memPuzzles.has(day)) memPuzzles.set(day, rounds);
  return memPuzzles.get(day);
}

export async function getDailyPuzzle(day) {
  if (ready && pool) {
    try {
      const res = await pool.query("SELECT tracks FROM daily_puzzles WHERE day = $1", [day]);
      if (res.rows[0]) return res.rows[0].tracks;
      return memPuzzles.get(day) ?? null;
    } catch {
      /* fall through to memory */
    }
  }
  return memPuzzles.get(day) ?? null;
}

// One row per (day, sub); the FIRST completion wins. Returns false when the
// player already has a result for that day.
export async function saveDailyResult({ day, sub, name, score, answers }) {
  if (ready && pool) {
    try {
      const res = await pool.query(
        "INSERT INTO daily_results(day, sub, name, score, answers) VALUES($1,$2,$3,$4,$5) ON CONFLICT (day, sub) DO NOTHING",
        [day, sub, name, score, JSON.stringify(answers)]
      );
      return res.rowCount === 1;
    } catch {
      /* fall through to memory */
    }
  }
  if (!memResults.has(day)) memResults.set(day, new Map());
  const bySub = memResults.get(day);
  if (bySub.has(sub)) return false;
  bySub.set(sub, { name, score, answers, createdAt: Date.now() });
  return true;
}

export async function getDailyResult(day, sub) {
  if (ready && pool) {
    try {
      const res = await pool.query("SELECT score, answers FROM daily_results WHERE day = $1 AND sub = $2", [day, sub]);
      if (res.rows[0]) return { score: Number(res.rows[0].score), answers: res.rows[0].answers };
      return null;
    } catch {
      /* fall through to memory */
    }
  }
  const row = memResults.get(day)?.get(sub);
  return row ? { score: row.score, answers: row.answers } : null;
}

// Ties rank by earlier completion (created_at / insertion order).
export async function getDailyLeaderboard(day, limit = 10) {
  if (ready && pool) {
    try {
      const res = await pool.query(
        "SELECT name, score FROM daily_results WHERE day = $1 ORDER BY score DESC, created_at ASC LIMIT $2",
        [day, Math.min(100, Math.max(1, Number(limit) || 10))]
      );
      return res.rows.map((r, i) => ({ rank: i + 1, name: r.name, score: Number(r.score) }));
    } catch {
      return [];
    }
  }
  const bySub = memResults.get(day);
  if (!bySub) return [];
  return [...bySub.values()]
    .sort((a, b) => b.score - a.score || a.createdAt - b.createdAt)
    .slice(0, limit)
    .map((r, i) => ({ rank: i + 1, name: r.name, score: r.score }));
}

export async function getDailyRank(day, sub) {
  if (ready && pool) {
    try {
      const res = await pool.query(
        `SELECT rank FROM (
           SELECT sub, RANK() OVER (ORDER BY score DESC, created_at ASC) AS rank
           FROM daily_results WHERE day = $1
         ) ranked WHERE sub = $2`,
        [day, sub]
      );
      return res.rows[0] ? Number(res.rows[0].rank) : null;
    } catch {
      return null;
    }
  }
  const bySub = memResults.get(day);
  if (!bySub || !bySub.has(sub)) return null;
  const sorted = [...bySub.entries()].sort(
    (a, b) => b[1].score - a[1].score || a[1].createdAt - b[1].createdAt
  );
  return sorted.findIndex(([s]) => s === sub) + 1;
}

// Recent puzzle days (newest first) with this player's result when present.
// sub may be null (guest): every day comes back unplayed.
export async function getDailyDays(sub, limit = 60) {
  const cap = Math.min(120, Math.max(1, Number(limit) || 60));
  if (ready && pool) {
    try {
      const res = await pool.query(
        `SELECT p.day, r.score, r.answers
           FROM daily_puzzles p
           LEFT JOIN daily_results r ON r.day = p.day AND r.sub = $2
          ORDER BY p.day DESC
          LIMIT $1`,
        [cap, sub ?? ""]
      );
      return res.rows.map((row) => ({
        day: toDayString(row.day),
        played: row.score != null,
        score: row.score != null ? Number(row.score) : null,
        perRound: Array.isArray(row.answers) ? row.answers.map((a) => Boolean(a.correct)) : null,
      }));
    } catch {
      /* fall through to memory */
    }
  }
  const days = [...memPuzzles.keys()].sort().reverse().slice(0, cap);
  return days.map((day) => {
    const r = sub ? memResults.get(day)?.get(sub) : null;
    return {
      day,
      played: Boolean(r),
      score: r ? r.score : null,
      perRound: r ? (r.answers || []).map((a) => Boolean(a.correct)) : null,
    };
  });
}

// Today's #1 result (name + per-round timings) for the ghost race. Timings
// only ever describe rounds that are OVER for the leader; they reveal nothing
// about answers.
export async function getDailyLeaderAnswers(day) {
  if (ready && pool) {
    try {
      const res = await pool.query(
        "SELECT name, answers FROM daily_results WHERE day = $1 ORDER BY score DESC, created_at ASC LIMIT 1",
        [day]
      );
      if (!res.rows[0]) return null;
      return { name: res.rows[0].name, answers: res.rows[0].answers || [] };
    } catch {
      return null;
    }
  }
  const bySub = memResults.get(day);
  if (!bySub || bySub.size === 0) return null;
  const top = [...bySub.values()].sort((a, b) => b.score - a.score || a.createdAt - b.createdAt)[0];
  return { name: top.name, answers: top.answers || [] };
}

// Days this player completed, newest first, for streak derivation.
export async function getDailyDaysPlayed(sub, sinceDays = 90) {
  if (ready && pool) {
    try {
      const res = await pool.query(
        "SELECT day FROM daily_results WHERE sub = $1 AND day > now() - ($2 || ' days')::interval ORDER BY day DESC",
        [sub, String(Math.max(1, Number(sinceDays) || 90))]
      );
      return res.rows.map((r) => toDayString(r.day));
    } catch {
      return [];
    }
  }
  const days = [];
  for (const [day, bySub] of memResults) if (bySub.has(sub)) days.push(day);
  return days.sort().reverse();
}

// ----- Player XP (verified players only; guests live in their browser) -----

const memXp = new Map(); // sub -> { name, xp }

// Returns the player's total BEFORE this add plus the new total, so callers
// can hand xpLogic.awardFor an accurate before/after pair atomically.
export async function addXp(sub, name, delta) {
  const d = Math.max(0, Number(delta) || 0);
  if (ready && pool) {
    try {
      const res = await pool.query(
        `INSERT INTO player_xp(sub, name, xp) VALUES($1, $2, $3)
         ON CONFLICT (sub) DO UPDATE SET xp = player_xp.xp + $3, name = $2, updated_at = now()
         RETURNING xp`,
        [sub, name, d]
      );
      const total = Number(res.rows[0].xp);
      return { before: total - d, total };
    } catch {
      /* fall through to memory */
    }
  }
  const row = memXp.get(sub) || { name, xp: 0 };
  const before = row.xp;
  row.xp += d;
  row.name = name;
  memXp.set(sub, row);
  return { before, total: row.xp };
}

export async function getXp(sub) {
  if (ready && pool) {
    try {
      const res = await pool.query("SELECT xp FROM player_xp WHERE sub = $1", [sub]);
      return res.rows[0] ? Number(res.rows[0].xp) : 0;
    } catch {
      /* fall through */
    }
  }
  return memXp.get(sub)?.xp ?? 0;
}

export default { initStorage, storageReady, recordMatch, topScores };
