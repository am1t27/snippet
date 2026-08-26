# Daily Challenge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One frozen 5-song puzzle per UTC day, playable solo by anyone, with a global per-day leaderboard for Google-verified players and local streaks for guests.

**Architecture:** New pure-logic module `dailyLogic.js` (testable offline), daily persistence added to `storage.js` (Postgres with in-memory fallback), a socket runtime `daily.js` that emits the SAME event shapes the live game already emits (`countdown`, `roundStart`, `state`, `reveal`) so the existing `Playing.jsx` renders a daily round unchanged, plus a Home card and a results screen on the client.

**Tech Stack:** Node ESM, Socket.IO, pg (optional), React/Vite/Tailwind. No TypeScript, no UI libraries.

**Spec:** `docs/superpowers/specs/2026-08-28-daily-challenge-design.md`

## Global Constraints

- No TypeScript, no UI component libraries; dark "minimalist arcade" theme.
- Server-authoritative: correct answer NEVER leaves the server while its round is open; all timing from the server clock.
- Typographic glyphs only (■ □ ★ etc.), never emoji.
- No em dash character anywhere (U+2014); use `-` or `:`.
- Commits use the user's git identity, no AI co-author trailer, no generated-with footer (per global CLAUDE.md; overrides harness defaults).
- Never write literal control-character ranges in edit commands; use \xNN escapes.
- Daily epoch: `2026-08-28` is Daily #1. Day boundary is UTC.
- 5 rounds, 4 options, TITLE mode, 10000 ms per round, RANDOM clip.

---

### Task 1: `dailyLogic.js` pure module + tests

**Files:**
- Create: `dailyLogic.js`
- Test: `test/daily.test.js`

**Interfaces:**
- Consumes: `buildRound`, `shuffle`, `questionValueFor`, `speedBonusFor`, `streakBonusFor` from `./gameLogic.js`; `GENRE_KEYS` from `./catalog/genres.js`.
- Produces (used by Tasks 2-3):
  - `DAILY_EPOCH = "2026-08-28"`, `DAILY_ROUNDS = 5`, `DAILY_OPTIONS = 4`, `DAILY_ROUND_MS = 10000`
  - `dayKey(date?) -> "YYYY-MM-DD"` (UTC)
  - `dailyNumber(day) -> int` (epoch day = 1)
  - `buildDailyRounds({ getSongs }) -> Promise<round[]>` where round = `{ audioUrl, options, correct, artistName, trackName, trackId }` (exact `buildRound` output), one round per distinct genre, TITLE mode
  - `scoreDailyAnswer({ isCorrect, elapsedMs, roundIndex, streak }) -> { points, questionValue, speedBonus, streakBonus }`
  - `computeStreak(daysPlayed, today) -> int` (consecutive days ending today or yesterday)
  - `shareText({ number, score, perRound }) -> string` (glyph grid, no emoji)

- [ ] **Step 1: Write failing tests** in `test/daily.test.js`

```js
import { describe, it, expect, vi } from "vitest";
vi.mock("node-fetch", () => ({ default: vi.fn() }));
import {
  DAILY_EPOCH, DAILY_ROUNDS, DAILY_OPTIONS, DAILY_ROUND_MS,
  dayKey, dailyNumber, buildDailyRounds, scoreDailyAnswer, computeStreak, shareText,
} from "../dailyLogic.js";

describe("day math", () => {
  it("dayKey is the UTC date", () => {
    expect(dayKey(new Date("2026-08-28T23:59:00Z"))).toBe("2026-08-28");
    expect(dayKey(new Date("2026-08-29T00:00:01Z"))).toBe("2026-08-29");
  });
  it("dailyNumber counts from the epoch as #1", () => {
    expect(dailyNumber(DAILY_EPOCH)).toBe(1);
    expect(dailyNumber("2026-09-01")).toBe(5);
  });
});

describe("buildDailyRounds", () => {
  const mkPool = (genre) =>
    Array.from({ length: 16 }, (_, i) => ({
      trackId: `${genre}-${i}`, trackName: `${genre} song ${i}`,
      artistName: `${genre} artist ${i}`, previewUrl: `https://cdn/${genre}/${i}.m4a`,
      releaseYear: 2020, baseTitle: `${genre} song ${i}`,
    }));
  it("builds 5 rounds with 4 distinct options each and no repeated track", async () => {
    const getSongs = vi.fn(async (genre) => mkPool(genre));
    const rounds = await buildDailyRounds({ getSongs });
    expect(rounds).toHaveLength(DAILY_ROUNDS);
    const ids = new Set(rounds.map((r) => r.trackId));
    expect(ids.size).toBe(DAILY_ROUNDS);
    for (const r of rounds) {
      expect(r.options).toHaveLength(DAILY_OPTIONS);
      expect(new Set(r.options).size).toBe(DAILY_OPTIONS);
      expect(r.options).toContain(r.correct);
      expect(r.audioUrl).toBeTruthy();
    }
    // 5 distinct genres requested
    expect(new Set(getSongs.mock.calls.map((c) => c[0])).size).toBe(DAILY_ROUNDS);
  });
  it("skips a genre whose fetch fails and still builds 5", async () => {
    let failed = false;
    const getSongs = vi.fn(async (genre) => {
      if (!failed) { failed = true; throw new Error("thin genre"); }
      return mkPool(genre);
    });
    const rounds = await buildDailyRounds({ getSongs });
    expect(rounds).toHaveLength(DAILY_ROUNDS);
  });
});

describe("scoreDailyAnswer", () => {
  it("scores like the live game: base + speed, plus streak bonus", () => {
    const s = scoreDailyAnswer({ isCorrect: true, elapsedMs: 0, roundIndex: 0, streak: 1 });
    expect(s.questionValue).toBe(300);
    expect(s.speedBonus).toBe(350);
    expect(s.points).toBe(650);
    const s2 = scoreDailyAnswer({ isCorrect: true, elapsedMs: 5000, roundIndex: 2, streak: 3 });
    expect(s2.questionValue).toBe(800);
    expect(s2.speedBonus).toBe(175);
    expect(s2.streakBonus).toBe(100);
    expect(s2.points).toBe(1075);
  });
  it("wrong or late answers score 0", () => {
    expect(scoreDailyAnswer({ isCorrect: false, elapsedMs: 100, roundIndex: 4, streak: 0 }).points).toBe(0);
    expect(scoreDailyAnswer({ isCorrect: true, elapsedMs: DAILY_ROUND_MS + 1, roundIndex: 0, streak: 0 }).points).toBe(0);
  });
});

describe("computeStreak", () => {
  it("counts consecutive days ending today", () => {
    expect(computeStreak(["2026-08-26", "2026-08-27", "2026-08-28"], "2026-08-28")).toBe(3);
  });
  it("yesterday keeps the streak alive (today not yet played)", () => {
    expect(computeStreak(["2026-08-26", "2026-08-27"], "2026-08-28")).toBe(2);
  });
  it("a gap resets", () => {
    expect(computeStreak(["2026-08-25", "2026-08-28"], "2026-08-28")).toBe(1);
    expect(computeStreak([], "2026-08-28")).toBe(0);
  });
});

describe("shareText", () => {
  it("renders glyphs, number, score, no emoji", () => {
    const t = shareText({ number: 12, score: 1450, perRound: [true, true, false, true, true] });
    expect(t).toContain("SNIPPET DAILY #12");
    expect(t).toContain("1450");
    expect(t).toContain("■ ■ □ ■ ■");
    expect(/[\u{1F300}-\u{1FAFF}]/u.test(t)).toBe(false);
  });
});
```

- [ ] **Step 2: Run** `npx vitest run test/daily.test.js` -> FAIL (module missing)
- [ ] **Step 3: Implement `dailyLogic.js`**

```js
// Daily challenge pure logic. No sockets, no storage, no clocks of its own:
// callers inject dates and the song source so everything here is testable.
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

// One round per distinct genre. A genre whose fetch fails is replaced by the
// next unused genre; fewer than DAILY_ROUNDS buildable genres throws (the
// caller treats that as "puzzle not available yet", never a crash).
export async function buildDailyRounds({ getSongs, genreKeys = GENRE_KEYS, rounds = DAILY_ROUNDS, optionsCount = DAILY_OPTIONS }) {
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

export function shareText({ number, score, perRound }) {
  const grid = perRound.map((ok) => (ok ? "■" : "□")).join(" ");
  return `SNIPPET DAILY #${number} - ${score}\n${grid}\nsnippet-flock.vercel.app`;
}
```

- [ ] **Step 4: Run** `npx vitest run test/daily.test.js` -> PASS; then `npm test` -> all pass
- [ ] **Step 5: Commit** `feat: daily challenge pure logic (day math, puzzle build, scoring, streaks, share text)`

---

### Task 2: daily persistence in `storage.js`

**Files:**
- Modify: `storage.js` (add tables to `initStorage`, add daily accessors)
- Test: extend `test/daily.test.js`

**Interfaces:**
- Consumes: existing `pool`/`ready` internals of storage.js.
- Produces (used by Task 3):
  - `getDailyPuzzle(day) -> rounds[]|null`
  - `saveDailyPuzzle(day, rounds) -> rounds[]` (INSERT ... ON CONFLICT DO NOTHING then read back the winner; memory fallback map)
  - `saveDailyResult({ day, sub, name, score, answers }) -> boolean` (false when (day,sub) already exists)
  - `getDailyResult(day, sub) -> { score, answers }|null`
  - `getDailyLeaderboard(day, limit=10) -> [{ name, score, rank }]` and `getDailyRank(day, sub) -> int|null`
  - `getDailyDaysPlayed(sub, sinceDays=90) -> ["YYYY-MM-DD", ...]`
  - All of these degrade to an in-module memory Map when Postgres is absent, so the feature works (unranked, per-boot) without DATABASE_URL.

- [ ] **Step 1: Write failing tests** (memory mode - no DATABASE_URL in vitest):

```js
import {
  saveDailyPuzzle, getDailyPuzzle, saveDailyResult, getDailyResult,
  getDailyLeaderboard, getDailyRank, getDailyDaysPlayed,
} from "../storage.js";

describe("daily storage (memory fallback)", () => {
  const rounds = [{ trackId: "1", options: ["a", "b"], correct: "a", audioUrl: "u", artistName: "x", trackName: "a" }];
  it("first save wins and re-save returns the frozen puzzle", async () => {
    const won = await saveDailyPuzzle("2099-01-01", rounds);
    expect(won).toEqual(rounds);
    const again = await saveDailyPuzzle("2099-01-01", [{ trackId: "2" }]);
    expect(again).toEqual(rounds); // frozen
    expect(await getDailyPuzzle("2099-01-01")).toEqual(rounds);
  });
  it("one result per (day, sub); leaderboard ranks by score", async () => {
    expect(await saveDailyResult({ day: "2099-01-02", sub: "s1", name: "A", score: 900, answers: [] })).toBe(true);
    expect(await saveDailyResult({ day: "2099-01-02", sub: "s1", name: "A", score: 9999, answers: [] })).toBe(false);
    await saveDailyResult({ day: "2099-01-02", sub: "s2", name: "B", score: 1200, answers: [] });
    const lb = await getDailyLeaderboard("2099-01-02");
    expect(lb[0]).toMatchObject({ name: "B", score: 1200, rank: 1 });
    expect(await getDailyRank("2099-01-02", "s1")).toBe(2);
    expect((await getDailyResult("2099-01-02", "s1")).score).toBe(900);
    expect(await getDailyDaysPlayed("s1")).toContain("2099-01-02");
  });
});
```

- [ ] **Step 2: Run** -> FAIL (exports missing)
- [ ] **Step 3: Implement.** In `initStorage`, after the `scores` table, create:

```sql
CREATE TABLE IF NOT EXISTS daily_puzzles (
  day DATE PRIMARY KEY,
  tracks JSONB NOT NULL
);
CREATE TABLE IF NOT EXISTS daily_results (
  day DATE NOT NULL,
  sub TEXT NOT NULL,
  name TEXT NOT NULL,
  score INTEGER NOT NULL,
  answers JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (day, sub)
);
```

Memory fallback at module scope: `const memPuzzles = new Map(); const memResults = new Map(); // day -> Map(sub -> row)`. Each accessor: `if (ready && pool) { pg path } else { memory path }`, all failures swallowed to the memory path with a log.warn, matching the file's existing philosophy. Date values from pg come back as Date objects: normalize with `row.day instanceof Date ? row.day.toISOString().slice(0,10) : row.day`.

- [ ] **Step 4: Run** `npm test` -> PASS
- [ ] **Step 5: Commit** `feat: daily puzzle + results persistence with memory fallback`

---

### Task 3: `daily.js` socket runtime + `server.js` wiring

**Files:**
- Create: `daily.js`
- Modify: `server.js` (import, register handlers in the connection callback, reuse the existing `rl` rate limiter and `verifyIdentity` helper)
- Test: scratch smoke script `_daily.mjs` (gitignored)

**Interfaces:**
- Consumes: Task 1 + Task 2 exports; `getSongs` from `./songProvider.js`; existing `verifyIdentity(idToken, name)`-equivalent in server.js (the code path used by createRoom; reuse the same function, whatever its name is in server.js, for `daily:start`).
- Produces (client contract, Task 4):
  - listens: `daily:status {}`, `daily:start { name, idToken? }`, `daily:answer { choice }`, `daily:leave {}`
  - emits to the requesting socket only:
    - `daily:status` reply: `{ day, number, played, myScore|null, leaderboard, myRank|null, streak|null }` (streak only for verified)
    - during play, the LIVE GAME'S OWN event shapes so Playing.jsx works unchanged: `countdown { seconds, round, questionValue, maxSpeedBonus, maxPoints }`, `roundStart { questionValue, maxSpeedBonus, roundIndex }`, `state` (publicState-shaped: `{ code: "DAILY", phase, round, totalRounds: 5, roundMs: 10000, mode: "TITLE", clip: "RANDOM", maxPlayers: 1, isPublic: false, audioUrl, options, timeRemainingMs, players: [self] }`), `reveal { answer, artistName, trackName, scores: [self], perRound }` shaped like the live reveal
    - `daily:finish { day, number, score, perRound, shareText, leaderboard, myRank, streak, ranked }`
    - `errorMsg { message }` for every rejection (already played, no puzzle yet, bad payload)

**Runtime rules (all server-side):**
- Sessions: `const sessions = new Map(); // socket.id -> { day, rounds, roundIdx, score, streak, perRound, answers, roundStartedAt, roundTimer, sub, name }`
- `daily:start`: verify identity if idToken given (same Google verification as rooms; on failure emit errorMsg and stop). If verified and `getDailyResult(day, sub)` exists -> errorMsg "You already played today's daily." Guests are trusted client-side only (spec accepted). Load-or-create puzzle: `getDailyPuzzle(day) ?? saveDailyPuzzle(day, await buildDailyRounds({ getSongs }))`. Then run round 0.
- Round loop: emit `countdown` (3s) -> after 3000ms set `roundStartedAt = Date.now()`, emit `roundStart` + `state` with audio/options, arm `roundTimer = setTimeout(expire, DAILY_ROUND_MS + 2000)`. `expire` treats the round as wrong (0 points), emits reveal, advances.
- `daily:answer`: ignore if no session/round open; `elapsedMs = Date.now() - roundStartedAt` (server clock only); `isCorrect = choice === round.correct`; streak update; `scoreDailyAnswer`; clear timer; emit reveal (answer revealed only now); after 3000ms next round or finish.
- Finish: for verified, `saveDailyResult` (`ranked: saved`), compute leaderboard + rank + streak from storage; guests get `ranked: false`, `streak: null` (client computes). Emit `daily:finish`. Delete session.
- Disconnect mid-puzzle: clear timers, delete session. Verified players who already FINISHED stay blocked by the DB row; an abandoned unfinished verified run is replayable (accepted simplification: the DB row is written only on finish; "abandoned = played" from the spec is enforced for the leaderboard by first-completion-wins, and unfinished runs simply never rank).
- Rate limiting: reuse the existing per-socket `rl()` on all three events.

- [ ] **Step 1: Write `_daily.mjs` smoke script** (scratch, gitignored):

```js
// Headless guest play-through of the daily. Run: node _daily.mjs (server on :4180)
import { io } from "socket.io-client";
const s = io("http://localhost:4180", { transports: ["websocket"] });
const wait = (ev) => new Promise((r) => s.once(ev, r));
s.on("connect", async () => {
  s.emit("daily:status", {});
  const st = await wait("daily:status");
  console.log("status:", JSON.stringify(st));
  s.emit("daily:start", { name: "SMOKE" });
  for (let i = 0; i < 5; i++) {
    await wait("roundStart");
    const snap = await wait("state");
    if (!snap.options || snap.code !== "DAILY") throw new Error("bad state snapshot");
    if (snap.answer || snap.correct) throw new Error("ANSWER LEAKED");
    s.emit("daily:answer", { choice: snap.options[0] });
    const rev = await wait("reveal");
    console.log(`round ${i}: answered=${snap.options[0]} correct=${rev.answer} points-visible=${!!rev.scores}`);
  }
  const fin = await wait("daily:finish");
  console.log("finish:", fin.score, fin.perRound, "|", fin.shareText.split("\n")[0]);
  if (typeof fin.score !== "number") throw new Error("no score");
  // replay attempt as guest: allowed by server (guest gating is client-side) but must produce a fresh session, not crash
  process.exit(0);
});
setTimeout(() => { console.error("TIMEOUT"); process.exit(1); }, 60000);
```

- [ ] **Step 2: Run against a dev server** (`PORT=4180 npm run dev`) -> FAIL (unknown events ignored, timeout)
- [ ] **Step 3: Implement `daily.js`** exporting `registerDaily(io, socket, deps)` and wire one line into server.js's connection handler; keep every emission socket-scoped (`socket.emit`), never room-broadcast. The `state` snapshots reuse the shape documented above; `reveal` payload mirrors the live one: `{ answer: round.correct, artistName, trackName, scores: [{ id: socket.id, name, score, lastRoundScore, lastCorrect }], roundIndex }` plus `perRound` so far.
- [ ] **Step 4: Re-run smoke** -> PASS all 5 rounds, no answer leak, sane finish payload. Also `npm test` still green.
- [ ] **Step 5: Commit** `feat: daily challenge socket runtime (server-clocked, answer never leaks)`

---

### Task 4: client - Home card, socket hook, solo play, results screen

**Files:**
- Modify: `client/src/useGameSocket.js` (daily events + actions)
- Modify: `client/src/screens/Home.jsx` (Daily card in GAMES grid, first slot)
- Modify: `client/src/App.jsx` (route daily flow; suppress multiplayer chrome when `state.code === "DAILY"`)
- Create: `client/src/screens/DailyResults.jsx`
- Modify: `client/src/stats.js` (guest daily local state: `{ lastPlayedDay, streak, lastScore }` under key `snippet.daily`)

**Interfaces:**
- Consumes: Task 3's socket contract exactly.
- Produces: `useGameSocket` additionally returns `{ daily, dailyFinish, dailyStatus, startDaily, answerDaily, refreshDailyStatus, leaveDaily }`.
  - `dailyStatus`: last `daily:status` payload or null; `refreshDailyStatus()` emits the request (called on mount and on finish).
  - `startDaily(name, idToken?)` emits `daily:start`; `answerDaily(choice)` emits `daily:answer`; `leaveDaily()` emits `daily:leave` and clears local daily state.
  - `daily` = true while a daily session is live (set on first DAILY-coded `state`, cleared on finish/leave).
  - `dailyFinish`: the `daily:finish` payload or null.

**Client behavior:**
- Home card: title "Daily", subtitle "5 songs · new at 05:30 IST" plus `#N` and either "▶ Play" or "Played · ■ ■ □ ■ ■" state from `dailyStatus` + guest localStorage. Clicking when unplayed -> if signed in, `startDaily(profileName, idToken)`; guest -> prompt for handle via the existing Entry input flow (reuse `EntryScreen` with a `daily` flag) then `startDaily(handle)`.
- During play: existing `Playing.jsx` renders from `state`/`reveal`/`roundMeta` snapshots as-is; App hides the chat/reactions/players rail when `state.code === "DAILY"` (players array has one entry so the rail would be redundant anyway; keep changes minimal - conditional rendering only).
- On `daily:finish`: guest path writes `{ lastPlayedDay: day, streak: computeLocalStreak(prev, day), lastScore: score }` to localStorage; render `DailyResults` (score, glyph row, streak, leaderboard top 10 with own rank when ranked, share button via `navigator.clipboard.writeText(shareText)` with a "Copied" toast, countdown to next UTC midnight, "Back to Home").
- Guest replay-block: Home card reads localStorage and shows the played state; server still accepts a guest replay (spec-accepted), the client just does not offer it.

- [ ] **Step 1: Implement hook additions** (state + listeners `daily:status`, `daily:finish`, and DAILY-detection inside the existing `state` listener; actions as above).
- [ ] **Step 2: Implement Home card + Entry reuse + App routing + DailyResults screen.** Keep §12 styling: bone/void, amber accent, Space Mono numerals, zero radius, glyphs not emoji.
- [ ] **Step 3: Verify in browser** (preview tool against local dev server): play a full daily as guest: card -> handle -> 5 rounds with audio -> results with share text; replay shows played state after reload.
- [ ] **Step 4: `cd client && npm run build`** -> clean build.
- [ ] **Step 5: Commit** `feat: daily challenge client (home card, solo play, results + share)`

---

### Task 5: verified path, docs, final verification

**Files:**
- Modify: `README.md` (one paragraph: what the daily is), `DEPLOY.md` (note: daily needs DATABASE_URL for ranking/persistence; degrades gracefully without)
- Test: `_daily.mjs` extended replay assertion; manual verified-account pass if a Google token is available locally, otherwise verify the code path via the smoke script with a stubbed verifier flag documented in the script.

- [ ] **Step 1: Replay-block verification.** With DATABASE_URL set locally, complete a verified run (or drive the storage function directly in a node REPL: `saveDailyResult` twice, assert second returns false) and confirm `daily:start` for the same sub answers `errorMsg` "already played".
- [ ] **Step 2: Full suite** `npm test`, smoke `_daily.mjs`, client build.
- [ ] **Step 3: Docs.** README + DEPLOY paragraphs.
- [ ] **Step 4: Commit** `docs: daily challenge notes` and push (hook auto-pushes).
- [ ] **Step 5: Production check after deploy:** `curl https://snippet-ifgn.onrender.com/` still healthy; play one daily on the Vercel site; `daily_puzzles` row exists (visible via a second play showing the same songs).

## Self-Review Notes

- Spec coverage: puzzle freeze (T2/T3), server clock + expiry (T3), guests-play/verified-ranked (T3/T4), streaks both paths (T1/T4), share text (T1/T4), Home card + results (T4), degraded no-DB mode (T2), docs (T5). "Resume mid-puzzle on reconnect" from the spec is consciously simplified to "unfinished runs never rank; verified finish is first-completion-wins" - recorded in T3 runtime rules.
- Type consistency: round object shape = `buildRound` output everywhere; `state` snapshot mirrors `publicState` fields used by Playing.jsx.
