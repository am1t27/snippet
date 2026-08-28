# Knockout Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a multiplayer knockout format in which players are eliminated as the match runs, until one remains, with two host-selectable rules (SLOWEST and LIVES).

**Architecture:** All decision logic lands in `gameLogic.js` as pure functions and is unit-tested without sockets or timers, matching how that file already isolates logic from the server. `server.js` calls those functions from the existing round loop; no new game phase is introduced. The client gains a Home card, two lobby controls, and knockout-aware Playing/Reveal/GameOver rendering.

**Tech Stack:** Node.js + Socket.IO server, React + Vite + Tailwind client, Vitest for unit tests.

**Spec:** `docs/superpowers/specs/2026-08-28-knockout-mode-design.md`

## Global Constraints

- Never use the em dash character (U+2014) in any file, comment, commit message, or UI copy. Use commas, colons, parentheses, semicolons, or a plain hyphen.
- Git commits must be authored by `amitdas <amitdas1844@gmail.com>`. Never add Claude or Anthropic as author, committer, or co-author, and never add a generation footer.
- The server is the only source of truth. Nothing added here may send the correct answer to any client before the round is over.
- UI glyphs are typographic marks, never emoji (existing project rule, see `client/src/screens/Home.jsx` GAMES array).
- All animation must respect `prefers-reduced-motion`.
- Run `npm test` from the repo root. It runs `vitest run`.
- `KNOCKOUT_LIVES = 3`, `KNOCKOUT_LIVES_DUEL = 4`, plateau round = 10 (flat value 2550).
- SLOWEST requires 3 players minimum; LIVES requires 2.
- Knockout has no round limit. `settings.rounds` is ignored entirely under KNOCKOUT.

---

### Task 1: Knockout settings axis

**Files:**
- Modify: `gameLogic.js` (settings allowlists near line 20, `DEFAULT_SETTINGS`, `sanitizeSettings`)
- Test: `test/gameLogic.test.js`

**Interfaces:**
- Consumes: nothing
- Produces: `FORMAT_CHOICES: string[]`, `KNOCKOUT_CHOICES: string[]`, `KNOCKOUT_LIVES: number`, `KNOCKOUT_LIVES_DUEL: number`; `DEFAULT_SETTINGS` gains `format: "CLASSIC"` and `knockout: "SLOWEST"`; `sanitizeSettings(payload)` returns those two extra keys.

- [ ] **Step 1: Write the failing test**

Add to `test/gameLogic.test.js`, inside the existing `describe("sanitizeSettings")` block:

```js
  it("accepts and uppercases knockout settings", () => {
    const s = sanitizeSettings({ format: "knockout", knockout: "lives" });
    expect(s.format).toBe("KNOCKOUT");
    expect(s.knockout).toBe("LIVES");
  });

  it("defaults knockout settings and clamps junk values", () => {
    expect(sanitizeSettings({}).format).toBe("CLASSIC");
    expect(sanitizeSettings({}).knockout).toBe("SLOWEST");
    expect(sanitizeSettings({ format: "battle" }).format).toBe("CLASSIC");
    expect(sanitizeSettings({ knockout: "sudden" }).knockout).toBe("SLOWEST");
  });

  it("keeps knockout rule populated even under CLASSIC", () => {
    // Fixed object shape: the rule is always present, just unused in CLASSIC.
    expect(sanitizeSettings({ format: "CLASSIC", knockout: "LIVES" })).toHaveProperty("knockout", "LIVES");
  });
```

The existing `it("accepts valid values")` test uses `toEqual` on the whole object and WILL break once two keys are added. Update its expected object to include `format: "CLASSIC"` and `knockout: "SLOWEST"`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- gameLogic`
Expected: FAIL. The new tests fail because `format` is `undefined`, and `accepts valid values` fails on the object shape.

- [ ] **Step 3: Write minimal implementation**

In `gameLogic.js`, after the `CLIP_CHOICES` declaration:

```js
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
```

In `DEFAULT_SETTINGS`, add:

```js
  format: FORMAT_CHOICES[0],
  knockout: KNOCKOUT_CHOICES[0],
```

In `sanitizeSettings`, add to the returned object:

```js
    format: pick(String(p.format || "").toUpperCase(), FORMAT_CHOICES),
    // Always populated so the settings object keeps a fixed shape; ignored
    // unless format is KNOCKOUT.
    knockout: pick(String(p.knockout || "").toUpperCase(), KNOCKOUT_CHOICES),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- gameLogic`
Expected: PASS, all tests in the file.

- [ ] **Step 5: Commit**

```bash
git add gameLogic.js test/gameLogic.test.js
git commit -m "feat: knockout format and rule settings axis

Orthogonal to mode (TITLE/ARTIST) so knockout works with either
question type. The rule stays populated under CLASSIC to keep the
settings object a fixed shape."
```

---

### Task 2: Round result ranking and SLOWEST elimination

**Files:**
- Modify: `gameLogic.js` (append after `streakBonusFor`)
- Test: `test/gameLogic.test.js`

**Interfaces:**
- Consumes: nothing from Task 1
- Produces:
  - `rankRoundResults(entries)` where `entries: Array<{ id: string, correct: boolean, elapsedMs: number|null, score: number, joinIndex: number }>`, returning a NEW array sorted best-first. Never mutates its input.
  - `pickEliminated(entries)` returning the `id` of the worst-ranked entry, or `null` for an empty list.

- [ ] **Step 1: Write the failing test**

Add a new `describe` block at the end of `test/gameLogic.test.js`:

```js
describe("rankRoundResults / pickEliminated", () => {
  // Helper: keeps the tests readable. joinIndex defaults ascending.
  const e = (id, correct, elapsedMs, score = 0, joinIndex = 0) =>
    ({ id, correct, elapsedMs, score, joinIndex });

  it("ranks correct answers first, fastest to slowest", () => {
    const ranked = rankRoundResults([
      e("slow", true, 8000),
      e("fast", true, 1000),
      e("mid", true, 4000),
    ]);
    expect(ranked.map((r) => r.id)).toEqual(["fast", "mid", "slow"]);
  });

  it("ranks every correct answer above every wrong one", () => {
    const ranked = rankRoundResults([
      e("wrong", false, 100),
      e("correct", true, 9000),
    ]);
    expect(ranked.map((r) => r.id)).toEqual(["correct", "wrong"]);
  });

  it("ranks a missing answer below a wrong one", () => {
    const ranked = rankRoundResults([
      e("absent", false, null),
      e("wrong", false, 9000),
    ]);
    expect(ranked.map((r) => r.id)).toEqual(["wrong", "absent"]);
  });

  it("does not reward answering wrong quickly", () => {
    // Both wrong: speed is irrelevant, score breaks the tie.
    const ranked = rankRoundResults([
      e("fastWrong", false, 100, 500),
      e("slowWrong", false, 9000, 900),
    ]);
    expect(ranked.map((r) => r.id)).toEqual(["slowWrong", "fastWrong"]);
  });

  it("breaks ties by higher score, then by earlier join order", () => {
    const ranked = rankRoundResults([
      e("late", false, null, 100, 5),
      e("early", false, null, 100, 1),
      e("rich", false, null, 999, 9),
    ]);
    expect(ranked.map((r) => r.id)).toEqual(["rich", "early", "late"]);
  });

  it("does not mutate its input", () => {
    const input = [e("b", true, 5000), e("a", true, 1000)];
    const copy = input.slice();
    rankRoundResults(input);
    expect(input).toEqual(copy);
  });

  it("eliminates the last-ranked player", () => {
    expect(pickEliminated([e("a", true, 1000), e("b", false, 2000)])).toBe("b");
  });

  it("eliminates the slowest player even when everyone was correct", () => {
    // The signature moment of SLOWEST: right answer, still knocked out.
    expect(
      pickEliminated([e("a", true, 1000), e("b", true, 2000), e("c", true, 9000)])
    ).toBe("c");
  });

  it("returns null for an empty round", () => {
    expect(pickEliminated([])).toBe(null);
  });
});
```

Add `rankRoundResults` and `pickEliminated` to the import list at the top of the test file.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- gameLogic`
Expected: FAIL with "rankRoundResults is not a function".

- [ ] **Step 3: Write minimal implementation**

Append to `gameLogic.js`:

```js
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- gameLogic`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add gameLogic.js test/gameLogic.test.js
git commit -m "feat: deterministic round ranking and SLOWEST elimination

Correct beats wrong beats absent; speed separates only correct
answers, so answering wrong fast earns nothing. Ties resolve by score
then join order, so elimination is never random."
```

---

### Task 3: LIVES rule with the Sweep guarantee

**Files:**
- Modify: `gameLogic.js` (append after `pickEliminated`)
- Test: `test/gameLogic.test.js`

**Interfaces:**
- Consumes: `rankRoundResults` from Task 2
- Produces: `applyLives(entries, livesById)` where `livesById` is a `Map<string, number>`. Returns `{ lives: Map<string, number>, lost: string[], swept: boolean }`. Never mutates the input map.

- [ ] **Step 1: Write the failing test**

Add a new `describe` block at the end of `test/gameLogic.test.js`:

```js
describe("applyLives (LIVES rule and Sweep)", () => {
  const e = (id, correct, elapsedMs, score = 0, joinIndex = 0) =>
    ({ id, correct, elapsedMs, score, joinIndex });
  const lives = (pairs) => new Map(pairs);

  it("takes one life from every player who was wrong or absent", () => {
    const out = applyLives(
      [e("a", true, 1000), e("b", false, 2000), e("c", false, null)],
      lives([["a", 3], ["b", 3], ["c", 2]])
    );
    expect(out.lost.sort()).toEqual(["b", "c"]);
    expect(out.lives.get("a")).toBe(3);
    expect(out.lives.get("b")).toBe(2);
    expect(out.lives.get("c")).toBe(1);
    expect(out.swept).toBe(false);
  });

  it("Sweep: a clean round costs the slowest correct player a life", () => {
    const out = applyLives(
      [e("a", true, 1000), e("b", true, 2000), e("c", true, 9000)],
      lives([["a", 3], ["b", 3], ["c", 3]])
    );
    expect(out.swept).toBe(true);
    expect(out.lost).toEqual(["c"]);
    expect(out.lives.get("c")).toBe(2);
    expect(out.lives.get("a")).toBe(3);
  });

  it("Sweep fires at two alive players, which is the old final-two case", () => {
    const out = applyLives(
      [e("a", true, 1000), e("b", true, 1001)],
      lives([["a", 4], ["b", 4]])
    );
    expect(out.swept).toBe(true);
    expect(out.lost).toEqual(["b"]);
  });

  it("Sweep fires at four alive players too", () => {
    const out = applyLives(
      [e("a", true, 10), e("b", true, 20), e("c", true, 30), e("d", true, 40)],
      lives([["a", 3], ["b", 3], ["c", 3], ["d", 3]])
    );
    expect(out.swept).toBe(true);
    expect(out.lost).toEqual(["d"]);
  });

  it("Sweep stays dormant when anyone was wrong", () => {
    const out = applyLives(
      [e("a", true, 1000), e("b", false, 2000)],
      lives([["a", 3], ["b", 3]])
    );
    expect(out.swept).toBe(false);
    expect(out.lost).toEqual(["b"]);
    expect(out.lives.get("a")).toBe(3);
  });

  it("Sweep stays dormant when a held player misses the round", () => {
    // A player inside the rejoin grace window scores as no-answer, so the
    // round is not a clean sweep and a network blip never triggers Sweep.
    const out = applyLives(
      [e("a", true, 1000), e("held", false, null)],
      lives([["a", 3], ["held", 3]])
    );
    expect(out.swept).toBe(false);
    expect(out.lost).toEqual(["held"]);
  });

  it("never drops a life below zero", () => {
    const out = applyLives([e("a", false, null)], lives([["a", 0]]));
    expect(out.lives.get("a")).toBe(0);
  });

  it("does not mutate the input map", () => {
    const before = lives([["a", 3]]);
    applyLives([e("a", false, 100)], before);
    expect(before.get("a")).toBe(3);
  });

  it("every round costs at least one life, which is what bounds the match", () => {
    // Termination proof in miniature: no round can leave the board unchanged.
    for (const entries of [
      [e("a", true, 1), e("b", true, 2)],
      [e("a", false, 1), e("b", true, 2)],
      [e("a", false, null), e("b", false, null)],
    ]) {
      const out = applyLives(entries, lives([["a", 3], ["b", 3]]));
      expect(out.lost.length).toBeGreaterThan(0);
    }
  });

  it("handles an empty round without throwing", () => {
    const out = applyLives([], lives([]));
    expect(out.lost).toEqual([]);
    expect(out.swept).toBe(false);
  });
});
```

Add `applyLives` to the test file's import list.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- gameLogic`
Expected: FAIL with "applyLives is not a function".

- [ ] **Step 3: Write minimal implementation**

Append to `gameLogic.js`:

```js
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- gameLogic`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add gameLogic.js test/gameLogic.test.js
git commit -m "feat: LIVES rule with the Sweep guarantee

Sweep: a round where everyone answers correctly costs the slowest one
a life. Every round therefore removes at least one life, which is what
lets knockout run without a round cap and still terminate."
```

---

### Task 4: Placement assignment

**Files:**
- Modify: `gameLogic.js` (append after `applyLives`)
- Test: `test/gameLogic.test.js`

**Interfaces:**
- Consumes: nothing
- Produces: `placementFor(startingCount, alreadyEliminated, batch)` where `batch: Array<{ id: string, score: number }>`. Returns `Array<{ id: string, placement: number }>`.

- [ ] **Step 1: Write the failing test**

Add a new `describe` block at the end of `test/gameLogic.test.js`:

```js
describe("placementFor", () => {
  it("gives the first player eliminated of eight the last place", () => {
    expect(placementFor(8, 0, [{ id: "a", score: 100 }])).toEqual([
      { id: "a", placement: 8 },
    ]);
  });

  it("counts placements down as the field thins", () => {
    expect(placementFor(8, 1, [{ id: "b", score: 100 }])).toEqual([
      { id: "b", placement: 7 },
    ]);
    expect(placementFor(8, 6, [{ id: "g", score: 100 }])).toEqual([
      { id: "g", placement: 2 },
    ]);
  });

  it("orders a simultaneous batch by score, higher score placing better", () => {
    expect(
      placementFor(8, 5, [
        { id: "low", score: 100 },
        { id: "high", score: 900 },
      ])
    ).toEqual([
      { id: "high", placement: 2 },
      { id: "low", placement: 3 },
    ]);
  });

  it("awards 1st to the highest score when everyone left goes out together", () => {
    // No draw state: the last two both hit zero, score separates them.
    expect(
      placementFor(8, 6, [
        { id: "loser", score: 400 },
        { id: "winner", score: 800 },
      ])
    ).toEqual([
      { id: "winner", placement: 1 },
      { id: "loser", placement: 2 },
    ]);
  });

  it("gives the sole survivor first place", () => {
    expect(placementFor(3, 2, [{ id: "champ", score: 50 }])).toEqual([
      { id: "champ", placement: 1 },
    ]);
  });

  it("handles an empty batch", () => {
    expect(placementFor(8, 0, [])).toEqual([]);
  });
});
```

Add `placementFor` to the test file's import list.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- gameLogic`
Expected: FAIL with "placementFor is not a function".

- [ ] **Step 3: Write minimal implementation**

Append to `gameLogic.js`:

```js
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- gameLogic`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add gameLogic.js test/gameLogic.test.js
git commit -m "feat: knockout placement assignment

Placements count down from the starting player count. Simultaneous
eliminations fill the bottom block ordered by score, which also settles
the all-remaining-players-out case without a draw state."
```

---

### Task 5: Lives count, minimum players, round bound, pool sizing, score plateau

**Files:**
- Modify: `gameLogic.js` (`questionValueFor` near line 143, `poolSizeFor` near line 60, append helpers)
- Test: `test/gameLogic.test.js`

**Interfaces:**
- Consumes: `KNOCKOUT_LIVES`, `KNOCKOUT_LIVES_DUEL` from Task 1
- Produces:
  - `livesFor(startingPlayers: number): number`
  - `minPlayersFor(settings): number`
  - `knockoutMaxRounds(settings, playerCount): number|null` (null under CLASSIC)
  - `poolSizeFor(settings, playerCount = 0)` (second parameter is new and optional)
  - `questionValueFor(roundIndex, format = "CLASSIC")` (second parameter is new and optional)
  - `KNOCKOUT_VALUE_PLATEAU_ROUND: number`

**Caution:** `questionValueFor` is also called by `dailyLogic.js` and `server.js` with one argument. The new parameter defaults to `"CLASSIC"`, preserving every existing call site unchanged. Do not change the existing signature order.

- [ ] **Step 1: Write the failing test**

Add a new `describe` block at the end of `test/gameLogic.test.js`:

```js
describe("knockout sizing and scoring helpers", () => {
  const ko = (knockout) => sanitizeSettings({ format: "KNOCKOUT", knockout });

  it("gives a duel more lives than a crowd", () => {
    expect(livesFor(2)).toBe(4);
    expect(livesFor(3)).toBe(3);
    expect(livesFor(8)).toBe(3);
  });

  it("requires three players for SLOWEST and two for LIVES", () => {
    // A 2-player SLOWEST match would end after a single round.
    expect(minPlayersFor(ko("SLOWEST"))).toBe(3);
    expect(minPlayersFor(ko("LIVES"))).toBe(2);
    expect(minPlayersFor(sanitizeSettings({ format: "CLASSIC" }))).toBe(1);
  });

  it("bounds SLOWEST at one elimination per round", () => {
    expect(knockoutMaxRounds(ko("SLOWEST"), 8)).toBe(7);
    expect(knockoutMaxRounds(ko("SLOWEST"), 3)).toBe(2);
  });

  it("bounds LIVES by the lives on the board", () => {
    // 8 players * 3 lives - 1: every round costs a life, survivor ends on one.
    expect(knockoutMaxRounds(ko("LIVES"), 8)).toBe(23);
    // A duel: 2 players * 4 lives - 1.
    expect(knockoutMaxRounds(ko("LIVES"), 2)).toBe(7);
  });

  it("returns no bound under CLASSIC", () => {
    expect(knockoutMaxRounds(sanitizeSettings({ format: "CLASSIC" }), 8)).toBe(null);
  });

  it("sizes the pool from the knockout bound, not settings.rounds", () => {
    const s = ko("LIVES");
    // Worst case 23 rounds + 4 options + 6 headroom, under the 60 ceiling.
    expect(poolSizeFor(s, 8)).toBe(33);
    // CLASSIC is unchanged by the new parameter.
    const classic = sanitizeSettings({ format: "CLASSIC" });
    expect(poolSizeFor(classic)).toBe(poolSizeFor(classic, 8));
  });

  it("plateaus the knockout question value after round 10", () => {
    // Identical to classic through round 10 (roundIndex 9).
    for (const i of [0, 5, 9]) {
      expect(questionValueFor(i, "KNOCKOUT")).toBe(questionValueFor(i));
    }
    // Flat at 2550 from round 11 onward, so a long match cannot print XP.
    expect(questionValueFor(9, "KNOCKOUT")).toBe(2550);
    expect(questionValueFor(10, "KNOCKOUT")).toBe(2550);
    expect(questionValueFor(22, "KNOCKOUT")).toBe(2550);
  });

  it("leaves classic scoring untouched at every round", () => {
    expect(questionValueFor(0)).toBe(300);
    expect(questionValueFor(22)).toBe(300 + 22 * 250);
  });
});
```

Add `livesFor`, `minPlayersFor`, `knockoutMaxRounds` to the test file's import list.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- gameLogic`
Expected: FAIL with "livesFor is not a function".

- [ ] **Step 3: Write minimal implementation**

Append to `gameLogic.js`:

```js
// A duel starts with more lives: it has no thinning field to build pressure,
// so it needs runway. Fixed at match start and never changed mid-match.
export function livesFor(startingPlayers) {
  return startingPlayers === 2 ? KNOCKOUT_LIVES_DUEL : KNOCKOUT_LIVES;
}

// SLOWEST needs 3: with 2 players it would end after a single round, which
// does not read as a game. LIVES needs only 2, because Sweep makes a duel
// terminate cleanly.
export function minPlayersFor(settings) {
  if (settings.format !== "KNOCKOUT") return 1;
  return settings.knockout === "LIVES" ? 2 : 3;
}

// Worst-case round count, used for pool sizing only. Knockout has NO round
// cap: this is what the rules can produce, not a limit imposed on the match.
export function knockoutMaxRounds(settings, playerCount) {
  if (settings.format !== "KNOCKOUT") return null;
  const n = Math.max(2, Number(playerCount) || 0);
  if (settings.knockout === "SLOWEST") return n - 1; // one out per round
  return n * livesFor(n) - 1; // at least one life lost per round
}
```

Replace `poolSizeFor` with:

```js
// Pool size needed for a match: enough distinct tracks for every round plus a
// full set of distractors, with headroom. Bounded so we never hammer the API.
// Under knockout the driver is the rules' worst case, not settings.rounds,
// which knockout ignores entirely.
export function poolSizeFor(settings, playerCount = 0) {
  const rounds = knockoutMaxRounds(settings, playerCount) ?? settings.rounds;
  return Math.min(60, Math.max(16, rounds + settings.optionsCount + 6));
}
```

**Note:** `knockoutMaxRounds` is declared with `function`, so hoisting makes this ordering safe regardless of where each sits in the file.

Replace `questionValueFor` with:

```js
// Round 10 (roundIndex 9) is where the ramp stops under knockout. Knockout has
// no round cap, so an unclamped ramp would reach ~5800 points a question in a
// long match, making early rounds worthless and printing XP against every
// other mode (XP is score / 10). Placement carries the drama instead.
export const KNOCKOUT_VALUE_PLATEAU_ROUND = 10;

export function questionValueFor(roundIndex, format = "CLASSIC") {
  const idx =
    format === "KNOCKOUT"
      ? Math.min(roundIndex, KNOCKOUT_VALUE_PLATEAU_ROUND - 1)
      : roundIndex;
  return QUESTION_BASE + idx * QUESTION_STEP;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS, the WHOLE suite including `daily.test.js` and `xp.test.js`, which call `questionValueFor` indirectly. If `daily.test.js` fails, the default parameter was changed incorrectly.

- [ ] **Step 5: Commit**

```bash
git add gameLogic.js test/gameLogic.test.js
git commit -m "feat: knockout lives, player minimums, pool sizing, score plateau

Pool sizing now derives from the rules' worst case rather than
settings.rounds, which knockout ignores. Question value plateaus after
round 10 under knockout so an uncapped match cannot inflate XP against
other modes. Both new parameters are optional and default to existing
behaviour, so daily and classic call sites are untouched."
```

---

### Task 6: Server knockout state and start guard

**Files:**
- Modify: `server.js` (`makePlayer` near line 128, `makeRoom` near line 90, the `startGame` handler near line 941, `resetToLobby` near line 355)
- Test: manual, covered by Task 12

**Interfaces:**
- Consumes: `minPlayersFor`, `livesFor`, `poolSizeFor` from Task 5
- Produces: `room.knockout` object `{ startingPlayers: number, eliminatedCount: number }`; player fields `eliminated`, `eliminatedRound`, `placement`, `lives`; helpers `aliveCount(room)`, `alivePlayers(room)`, `isKnockout(room)`.

- [ ] **Step 1: Add the player and room state**

In `server.js`, import the new helpers by adding to the existing `gameLogic.js` import block:

```js
  minPlayersFor,
  livesFor,
  pickEliminated,
  applyLives,
  placementFor,
```

`rankRoundResults` and `knockoutMaxRounds` are deliberately NOT imported here: the server only reaches them through `pickEliminated`, `applyLives`, and `poolSizeFor`. Do not add unused imports.

In `makePlayer`, after `lastCorrect: false,`:

```js
    // Knockout. `eliminated` is deliberately NOT `spectator`: an eliminated
    // player keeps their score, their leaderboard row, their XP, and their
    // host eligibility, and only loses the ability to guess.
    eliminated: false,
    eliminatedRound: null,
    placement: null,
    lives: 0,
```

In `makeRoom`, after `isPublic: false,`:

```js
    // Knockout bookkeeping. startingPlayers freezes the field size at kickoff
    // so placements stay stable as people are eliminated.
    knockout: { startingPlayers: 0, eliminatedCount: 0 },
```

- [ ] **Step 2: Add the helpers**

Next to the existing `playerCount` helper:

```js
function isKnockout(room) {
  return room.settings.format === "KNOCKOUT";
}

// Players still in the fight: not spectating, not eliminated. Disconnected
// players still count as alive while inside their rejoin grace window.
function alivePlayers(room) {
  return [...room.players.values()].filter((p) => !p.spectator && !p.eliminated);
}

function aliveCount(room) {
  return alivePlayers(room).length;
}
```

- [ ] **Step 3: Guard the start and seed lives**

In the `startGame` handler, after the existing host and phase checks and after `settings` has been sanitized, add:

```js
    const minPlayers = minPlayersFor(settings);
    const starting = playerCount(room);
    if (starting < minPlayers) {
      socket.emit("errorMsg", {
        message:
          settings.knockout === "LIVES"
            ? "Knockout needs at least 2 players."
            : "Knockout with Slowest out needs at least 3 players. Try Lives for a 2-player duel.",
      });
      return;
    }
    room.knockout = { startingPlayers: starting, eliminatedCount: 0 };
    if (settings.format === "KNOCKOUT" && settings.knockout === "LIVES") {
      const seed = livesFor(starting);
      for (const p of room.players.values()) {
        if (!p.spectator) p.lives = seed;
      }
    }
```

Update the existing `poolSizeFor(...)` call in the same handler to pass the player count:

```js
    const pool = await getSongs(settings.genre, poolSizeFor(settings, starting), {
      decade: settings.decade,
    });
```

- [ ] **Step 4: Reset knockout state on rematch**

In `resetToLobby`, inside the loop that resets each player, add:

```js
    p.eliminated = false;
    p.eliminatedRound = null;
    p.placement = null;
    p.lives = 0;
```

And after the loop:

```js
  room.knockout = { startingPlayers: 0, eliminatedCount: 0 };
```

Verify the existing `p.spectator = false` promotion in the rematch path still runs; eliminated players are already non-spectators so they need no promotion, only the reset above.

- [ ] **Step 5: Verify the server still boots and the suite passes**

Run: `node -e "import('./server.js').then(() => { console.log('boot ok'); process.exit(0); })"`
Expected: prints `boot ok` with no import or syntax error. Stop the process if it hangs on the port; a clean start is enough.

Run: `npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server.js
git commit -m "feat: knockout room and player state, start guard

eliminated is a separate flag from spectator on purpose: spectator also
means no score, no leaderboard row, no XP and no host eligibility, all
of which an eliminated player must keep."
```

---

### Task 7: Server elimination in the round loop

**Files:**
- Modify: `server.js` (`endRound` near line 493, `publicState` near line 312, `allGuessed` near line 349, the `guess` handler near line 999)
- Test: manual, covered by Task 12

**Interfaces:**
- Consumes: everything from Tasks 2-6
- Produces: `reveal` payload gains `eliminated`, `format`, `knockout`, `livesLeft`, `swept`; `publicState` players gain `eliminated`, `lives`, `placement`; `publicState.totalRounds` is `null` under knockout.

- [ ] **Step 1: Stop eliminated players from guessing or blocking a round**

In `allGuessed`, change the filter so eliminated players never hold up a round:

```js
  const active = [...room.players.values()].filter(
    (p) => !p.spectator && !p.eliminated && p.connected
  );
```

In the `guess` handler, after the existing spectator rejection:

```js
    if (player.eliminated) {
      socket.emit("errorMsg", { message: "You're out. Watch the rest play it out." });
      return;
    }
```

- [ ] **Step 2: Broadcast the knockout state**

In `publicState`, change `totalRounds` and add the per-player fields:

```js
    // Knockout has no fixed length, so there is no total to show. The client
    // renders a bare round number plus a players-remaining count instead.
    totalRounds: room.settings.format === "KNOCKOUT" ? null : room.settings.rounds,
    format: room.settings.format,
    knockout: room.settings.knockout,
```

And inside the `players` map, after `lastRoundScore: p.lastRoundScore,`:

```js
      eliminated: p.eliminated,
      placement: p.placement,
      lives: room.settings.format === "KNOCKOUT" && room.settings.knockout === "LIVES" ? p.lives : null,
```

- [ ] **Step 3: Apply elimination in endRound**

In `endRound`, after the existing `results` array is built and scores are settled, and BEFORE `room.history.push(...)`, insert:

```js
  // ----- Knockout: decide who leaves this round -----
  let eliminatedThisRound = [];
  let swept = false;
  if (isKnockout(room)) {
    const joinOrder = [...room.players.keys()];
    const entries = alivePlayers(room).map((p) => {
      const g = room.guesses.get(p.id) || null;
      return {
        id: p.id,
        correct: g != null && g.option === correctName,
        elapsedMs: g != null ? g.elapsedMs : null,
        score: p.score,
        joinIndex: joinOrder.indexOf(p.id),
      };
    });

    let outIds = [];
    if (room.settings.knockout === "SLOWEST") {
      const out = pickEliminated(entries);
      if (out) outIds = [out];
    } else {
      const applied = applyLives(entries, new Map(entries.map((x) => [x.id, room.players.get(x.id).lives])));
      swept = applied.swept;
      for (const [id, left] of applied.lives) {
        const p = room.players.get(id);
        if (p) p.lives = left;
      }
      outIds = [...applied.lives.keys()].filter((id) => applied.lives.get(id) === 0);
    }

    // Never eliminate the whole field down to nobody: if every remaining
    // player would go out at once they still get placed, and the best score
    // takes first. placementFor handles that ordering.
    const batch = outIds
      .map((id) => room.players.get(id))
      .filter(Boolean)
      .map((p) => ({ id: p.id, score: p.score }));

    const placements = placementFor(
      room.knockout.startingPlayers,
      room.knockout.eliminatedCount,
      batch
    );
    for (const { id, placement } of placements) {
      const p = room.players.get(id);
      if (!p) continue;
      p.eliminated = true;
      p.eliminatedRound = room.round;
      p.placement = placement;
      eliminatedThisRound.push({ id: p.id, name: p.name, placement });
    }
    room.knockout.eliminatedCount += placements.length;
  }
```

- [ ] **Step 4: Extend the reveal payload**

In the `revealPayload` object, add:

```js
    format: room.settings.format,
    knockout: room.settings.knockout,
    eliminated: eliminatedThisRound,
    // LIVES only: what everyone has left, and whether Sweep took this one.
    livesLeft:
      isKnockout(room) && room.settings.knockout === "LIVES"
        ? [...room.players.values()]
            .filter((p) => !p.spectator)
            .map((p) => ({ id: p.id, lives: p.lives }))
        : null,
    swept,
```

Also change `totalRounds: room.settings.rounds` in the same payload to:

```js
    totalRounds: isKnockout(room) ? null : room.settings.rounds,
```

- [ ] **Step 5: Use the knockout question value**

In `endRound`, change:

```js
  const questionValue = questionValueFor(room.round - 1, room.settings.format);
```

And in `startRound` and `beginPlaying`, pass the format at both existing `questionValueFor` call sites the same way.

- [ ] **Step 6: Verify**

Run: `npm test`
Expected: PASS.

Run: `node -e "import('./server.js').then(() => { console.log('boot ok'); process.exit(0); })"`
Expected: `boot ok`.

- [ ] **Step 7: Commit**

```bash
git add server.js
git commit -m "feat: apply knockout elimination in the round loop

Eliminated players stop guessing and stop blocking a round from ending,
but stay in results and on the leaderboard. Reveal carries who left,
their placement, remaining lives, and whether Sweep decided the round."
```

---

### Task 8: Server game end, leaderboard, and disconnect handling

**Files:**
- Modify: `server.js` (the reveal timer at the end of `endRound` near line 570, `gameOver` near line 582, `finalizeLeave` near line 250)
- Test: manual, covered by Task 12

**Interfaces:**
- Consumes: everything from Task 7
- Produces: `gameOver` payload gains `format` and placement-ordered `leaderboard` entries carrying `placement`.

- [ ] **Step 1: End the match when one player stands**

In `endRound`, replace the round-advance branch inside the reveal timer:

```js
  room.timers.reveal = setTimeout(() => {
    if (playerCount(room) === 0) {
      resetToLobby(room);
      broadcastState(room);
      return;
    }
    if (isKnockout(room)) {
      // Knockout has NO round limit. It ends only when one player is left.
      if (aliveCount(room) <= 1) {
        const last = alivePlayers(room)[0];
        if (last && last.placement == null) last.placement = 1;
        gameOver(room);
      } else {
        startRound(room, room.round + 1);
      }
      return;
    }
    if (room.round >= room.settings.rounds) {
      gameOver(room);
    } else {
      startRound(room, room.round + 1);
    }
  }, isKnockout(room) ? KNOCKOUT_REVEAL_MS : REVEAL_MS);
```

Add the constant next to `REVEAL_MS`:

```js
const KNOCKOUT_REVEAL_MS = 4500; // longer hold: an elimination needs to land
```

- [ ] **Step 2: Order the final leaderboard by placement**

In `gameOver`, replace the leaderboard construction:

```js
  const scoring = [...room.players.values()].filter((p) => !p.spectator);
  const leaderboard = (
    isKnockout(room)
      ? // Placement decides knockout, not score. Anyone without a placement
        // (a rematch edge, or a match ended early) falls back behind those
        // who have one, ordered by score.
        scoring
          .slice()
          .sort((a, b) => {
            const pa = a.placement ?? Number.MAX_SAFE_INTEGER;
            const pb = b.placement ?? Number.MAX_SAFE_INTEGER;
            if (pa !== pb) return pa - pb;
            return b.score - a.score;
          })
      : scoring.slice().sort((a, b) => b.score - a.score)
  ).map((p, i) => ({
    rank: i + 1,
    id: p.id,
    name: p.name,
    score: p.score,
    placement: p.placement,
    eliminatedRound: p.eliminatedRound,
  }));
  io.to(room.code).emit("gameOver", {
    leaderboard,
    roundHistory: room.history,
    format: room.settings.format,
  }); // SAFE: round over
```

**Do not touch the XP loop below it.** It filters on `p.spectator`, not `p.eliminated`, so eliminated players already receive XP, which is the required behaviour.

- [ ] **Step 3: Place a player who leaves mid-knockout**

In `finalizeLeave`, before `room.players.delete(id)`:

```js
  // A player who walks out of a knockout still gets a placement, so the
  // standings stay honest rather than having them silently disappear.
  const midKnockout =
    room.settings.format === "KNOCKOUT" &&
    (room.phase === PHASE.ROUND_PLAYING || room.phase === PHASE.ROUND_REVEAL);
  if (midKnockout && !player.spectator && !player.eliminated) {
    const [placed] = placementFor(room.knockout.startingPlayers, room.knockout.eliminatedCount, [
      { id: player.id, score: player.score },
    ]);
    if (placed) {
      player.eliminated = true;
      player.eliminatedRound = room.round;
      player.placement = placed.placement;
      room.knockout.eliminatedCount += 1;
    }
  }
```

After the existing `activePlayers` check in the same function, add:

```js
  // Disconnections can decide a knockout: if only one fighter is left, the
  // match is over and they won.
  if (
    room.settings.format === "KNOCKOUT" &&
    (room.phase === PHASE.ROUND_PLAYING || room.phase === PHASE.ROUND_REVEAL) &&
    aliveCount(room) <= 1 &&
    room.players.size > 0
  ) {
    const last = alivePlayers(room)[0];
    if (last && last.placement == null) last.placement = 1;
    gameOver(room);
    return;
  }
```

- [ ] **Step 4: Verify**

Run: `npm test`
Expected: PASS.

Run: `node -e "import('./server.js').then(() => { console.log('boot ok'); process.exit(0); })"`
Expected: `boot ok`.

- [ ] **Step 5: Commit**

```bash
git add server.js
git commit -m "feat: knockout ends when one player stands, never on a counter

No round limit: a match at round 18 with three players still fighting
keeps going. Final standings sort by placement rather than score, and a
player who leaves mid-match is placed instead of vanishing."
```

---

### Task 9: Home card and format routing

**Files:**
- Modify: `client/src/screens/Home.jsx` (the `GAMES` array near line 10)
- Modify: `client/src/App.jsx` (`openGame` near line 198, the `Lobby` render props near lines 376 and 387)
- Test: manual, covered by Task 12

**Interfaces:**
- Consumes: nothing
- Produces: `GAMES` entry `{ key: "knockout", format: "KNOCKOUT", knockout: "SLOWEST" }`; App state `formatPref` and `knockoutPref` passed to `Lobby` as props of the same names.

- [ ] **Step 1: Replace the Harmonies placeholder with Knockout**

In `client/src/screens/Home.jsx`, in the `GAMES` array, DELETE the `harmonies` entry and INSERT a knockout entry immediately after `create`, so the playable block stays contiguous and the grid stays at 8 cards:

```js
  { key: "create", glyph: "+", title: "Create", sub: "Private room — challenge your friends", status: "play", clip: "RANDOM" },
  { key: "knockout", glyph: "✕", title: "Knockout", sub: "Get it wrong, you're out — last one standing wins", status: "play", clip: "RANDOM", format: "KNOCKOUT", knockout: "SLOWEST" },
  { key: "wordzic", glyph: "▦", title: "Wordzic", sub: "Guess the music word", status: "soon" },
```

**Copy check:** the existing `create` entry uses an em dash. Do not copy that character into the new line; the knockout `sub` above must use a plain hyphen. Leave the existing lines alone.

- [ ] **Step 2: Carry the preference into the lobby**

In `client/src/App.jsx`, beside the existing `clipPref` state near line 133:

```js
  const [formatPref, setFormatPref] = useState("CLASSIC"); // preset by the Knockout card
  const [knockoutPref, setKnockoutPref] = useState("SLOWEST");
```

In `openGame`, beside the existing `setClipPref(game.clip || "RANDOM")`:

```js
    setFormatPref(game.format || "CLASSIC");
    setKnockoutPref(game.knockout || "SLOWEST");
```

At BOTH `<Lobby ... />` render sites (near lines 376 and 387), add the two props next to the existing `clipPref`:

```jsx
              formatPref={formatPref}
              knockoutPref={knockoutPref}
```

- [ ] **Step 3: Verify**

Run: `cd client && npm run build`
Expected: build succeeds with no unresolved import or syntax error.

Confirm by eye that the Home grid still renders 8 cards, 5 playable and 3 marked Soon.

- [ ] **Step 4: Commit**

```bash
git add client/src/screens/Home.jsx client/src/App.jsx
git commit -m "feat: knockout home card, replacing the Harmonies placeholder

Sits with the playable block after Create so the grid stays at 8 cards
with the playable entries contiguous."
```

---

### Task 10: Lobby knockout controls

**Files:**
- Modify: `client/src/screens/Lobby.jsx` (option constants near line 20, `Lobby` component near line 57)
- Test: manual, covered by Task 12

**Interfaces:**
- Consumes: `formatPref`, `knockoutPref` props from Task 9
- Produces: `onStart` payload gains `format` and `knockout`.

- [ ] **Step 1: Add the option lists**

In `client/src/screens/Lobby.jsx`, beside the other option constants:

```js
const FORMAT_OPTS = [
  { label: "Classic", value: "CLASSIC" },
  { label: "Knockout", value: "KNOCKOUT" },
];
const KNOCKOUT_OPTS = [
  { label: "Slowest out", value: "SLOWEST" },
  { label: "Lives", value: "LIVES" },
];
```

- [ ] **Step 2: Seed and wire the settings**

In the `Lobby` signature, accept the new props:

```jsx
export function Lobby({ players, myId, isHost, onStart, code, messages, onChat, clipPref, formatPref, knockoutPref, onLeave }) {
```

In the `useState` settings initialiser, add:

```js
    format: formatPref === "KNOCKOUT" ? "KNOCKOUT" : "CLASSIC",
    knockout: knockoutPref === "LIVES" ? "LIVES" : "SLOWEST",
```

- [ ] **Step 3: Render the controls and the minimum-players notice**

The file already defines `SettingRow({ label, options, value, onChange })` at the bottom of `client/src/screens/Lobby.jsx`. Reuse it exactly; do not add a new component. The host settings block is the `{isHost ? (...)}` branch, where `SettingRow` is currently called six times for Mode, Clip, Rounds, Timer, Answers, and Era.

Insert Format as the FIRST `SettingRow` in that block, above Mode, and the Rule row directly under it:

```jsx
      {/* Format picker. Under Knockout the rounds picker is hidden, not
          disabled: it controls nothing, since knockout runs until one player
          is left standing. */}
      <SettingRow label="Format" options={FORMAT_OPTS} value={settings.format} onChange={setField("format")} />
      {settings.format === "KNOCKOUT" && (
        <>
          <SettingRow label="Rule" options={KNOCKOUT_OPTS} value={settings.knockout} onChange={setField("knockout")} />
          <p className="font-console text-[11px] leading-relaxed text-dim">
            {settings.knockout === "LIVES"
              ? "3 lives each (4 in a 2-player duel). Wrong or no answer costs one. If everyone gets it right, the slowest still loses one. Needs 2 players."
              : "One player is knocked out every round, and being right is not enough if you were the slowest. Needs 3 players."}
          </p>
        </>
      )}
```

Then wrap the EXISTING Rounds row so it disappears under knockout. Change this line:

```jsx
          <SettingRow label="Rounds" options={ROUND_OPTS} value={settings.rounds} onChange={setField("rounds")} />
```

into:

```jsx
          {settings.format !== "KNOCKOUT" && (
            <SettingRow label="Rounds" options={ROUND_OPTS} value={settings.rounds} onChange={setField("rounds")} />
          )}
```

Leave the other five `SettingRow` calls untouched: Mode, Clip, Timer, Answers, and Era all still apply under knockout.

- [ ] **Step 4: Verify**

Run: `cd client && npm run build`
Expected: build succeeds.

- [ ] **Step 5: Commit**

```bash
git add client/src/screens/Lobby.jsx
git commit -m "feat: lobby format and knockout rule controls

The rounds picker is hidden under knockout rather than disabled, since
knockout ignores it entirely."
```

---

### Task 11: Knockout rendering in Masthead, Playing, Reveal, and GameOver

**Files:**
- Modify: `client/src/App.jsx` (`Masthead` at line 441)
- Modify: `client/src/screens/Playing.jsx` (component signature at line 20, `locked` at line 21)
- Modify: `client/src/screens/Reveal.jsx` (line 12, round label at line 36)
- Modify: `client/src/screens/GameOver.jsx` (rows at line 8, champion block at line 24)
- Test: manual, covered by Task 12

**Interfaces:**
- Consumes: `state.format`, `state.knockout`, `state.totalRounds` (null under knockout), per-player `eliminated`/`lives`/`placement`; reveal `eliminated[]`, `livesLeft[]`, `swept`, `format`; gameOver `leaderboard[].placement`, `leaderboard[].eliminatedRound`, `format`
- Produces: no new exports

**Two latent bugs to fix, not optional.** Both currently coerce a null total into a fake "10", so under knockout the UI would confidently display a round total that does not exist:
- `client/src/App.jsx:444` renders `String(total ?? 10)`
- `client/src/screens/Reveal.jsx:12` reads `const total = reveal?.totalRounds ?? 10;`

- [ ] **Step 1: Masthead drops the total under knockout**

In `client/src/App.jsx`, replace the `label` in `Masthead`:

```jsx
function Masthead({ phase, round, total, onMenu, onBrand }) {
  const inRound = phase === "ROUND_PLAYING" || phase === "ROUND_REVEAL";
  // Knockout sends total as null: it has no fixed length, so there is no
  // total to show. Never fall back to a made-up number here.
  const label = inRound
    ? total == null
      ? `Track ${String(round).padStart(2, "0")}`
      : `Track ${String(round).padStart(2, "0")} / ${String(total).padStart(2, "0")}`
    : phase === "GAME_OVER"
    ? "Side B · Final"
    : "Side A · Lobby";
```

Leave the rest of the component unchanged.

- [ ] **Step 2: Playing blocks eliminated players and shows the field**

In `client/src/screens/Playing.jsx`, extend the signature and the lock:

```jsx
export function Playing({ state, roundMeta, myGuess, hasGuessed, spectator, eliminated, onGuess, onReact, ghost, audioRef }) {
  const locked = hasGuessed || spectator || eliminated; // spectators and knocked-out players can't answer
```

In `client/src/App.jsx`, pass the new prop at the `<Playing ... />` render site, deriving it from the player's own state:

```jsx
              eliminated={Boolean(me?.eliminated)}
```

`me` is already computed at `client/src/App.jsx:93`.

Then add a knockout status strip to `Playing`, directly above the existing `<TimeCounter ... />` call. There is currently no player roster on this screen, so this is a new block rather than an edit:

```jsx
      {state.format === "KNOCKOUT" && (
        <div className="flex items-center justify-between gap-3 border-b border-rule pb-3">
          <span className={EYEBROW}>
            {state.players.filter((p) => !p.spectator && !p.eliminated).length} still in
          </span>
          {state.knockout === "LIVES" && (
            <span className="flex flex-wrap justify-end gap-2">
              {state.players
                .filter((p) => !p.spectator)
                .map((p) => (
                  <span
                    key={p.id}
                    className={`font-console text-[11px] uppercase tracking-[0.15em] ${
                      p.eliminated ? "text-dim line-through" : "text-bone"
                    }`}
                  >
                    {p.name}{" "}
                    <span aria-hidden="true" className={p.eliminated ? "text-dim" : "text-amber"}>
                      {"●".repeat(Math.max(0, p.lives ?? 0))}
                    </span>
                    <span className="sr-only">{p.lives ?? 0} lives left</span>
                  </span>
                ))}
            </span>
          )}
        </div>
      )}
```

`EYEBROW` is already imported in this file. Glyphs are typographic marks, matching the project rule; do not substitute emoji hearts.

- [ ] **Step 3: Reveal stops inventing a total and names who went out**

In `client/src/screens/Reveal.jsx`, replace line 12:

```jsx
  const total = reveal?.totalRounds ?? null; // null under knockout: no fixed length
```

Replace the round label at line 36:

```jsx
      <p className={`${EYEBROW} animate-rise`}>
        Round {String(round).padStart(2, "0")}
        {total != null && ` / ${String(total).padStart(2, "0")}`}
      </p>
```

Add the elimination callout directly below that paragraph. It reuses `PANEL`, `EYEBROW`, and the file's existing `animate-rise` entrance so it sits in the established register:

```jsx
      {(reveal?.eliminated?.length > 0 || reveal?.swept) && (
        <div className={`${PANEL} animate-rise border-l-2 border-l-bad px-5 py-4`} style={{ animationDelay: "40ms" }}>
          {reveal.swept && (
            // A life vanishing with no wrong answer on screen would read as a
            // bug. Always say which rule took it.
            <p className={EYEBROW}>Everyone got it · slowest loses a life</p>
          )}
          {reveal.eliminated.map((e) => (
            <p key={e.id} className="mt-2 font-marquee text-lg font-black uppercase tracking-tight text-bad">
              {e.name} is out
              <span className="ml-2 font-console text-xs tracking-[0.2em] text-dim">
                {String(e.placement).padStart(2, "0")}
                {e.placement === 1 ? "st" : e.placement === 2 ? "nd" : e.placement === 3 ? "rd" : "th"}
              </span>
            </p>
          ))}
        </div>
      )}
```

The existing `animate-rise` class is already governed by the project's `prefers-reduced-motion` handling, so no extra guard is needed.

- [ ] **Step 4: GameOver shows placements under knockout**

In `client/src/screens/GameOver.jsx`, the server already sorts `gameOver.leaderboard` by placement, so render in the order received and only change the labels. Add near the top of the component:

```jsx
  const isKnockout = gameOver?.format === "KNOCKOUT";
```

In the champion block, replace the eyebrow line:

```jsx
          <p className="font-coin text-xs text-amber">{isKnockout ? "1UP · Last one standing" : "1UP · Champion"}</p>
```

In the `rest` list, show when each player went out instead of only their score:

```jsx
                <span className="font-console text-sm tabular-nums text-dim">
                  {isKnockout && r.eliminatedRound ? `out in round ${r.eliminatedRound}` : r.score}
                </span>
```

- [ ] **Step 5: Verify**

Run: `cd client && npm run build`
Expected: build succeeds with no unresolved import.

- [ ] **Step 6: Commit**

```bash
git add client/src/App.jsx client/src/screens/Playing.jsx client/src/screens/Reveal.jsx client/src/screens/GameOver.jsx
git commit -m "feat: knockout rendering across masthead, playing, reveal, game over

Also fixes two spots that coerced a missing round total into a fake 10,
which would have shown knockout matches a total that does not exist.
Reveal names who went out and says when Sweep took a life, so a lost
life is never unexplained."
```

---

### Task 12: End-to-end verification

**Files:**
- No production code changes. Fixes discovered here belong in the task that owns the file.

- [ ] **Step 1: Run the full suite**

Run: `npm test`
Expected: PASS, every file.

- [ ] **Step 2: Start both processes**

Run in one terminal: `node server.js`
Run in another: `cd client && npm run dev`

- [ ] **Step 3: SLOWEST, 3 players**

Open three browser tabs on `http://localhost:5173`. Create a room in the first, join with the code from the other two. Host picks Knockout, Slowest out, then starts.

Verify, in order:
- the lobby shows no rounds picker while Knockout is selected
- exactly one player is eliminated each round, no more and no less
- a round where all three answer correctly still eliminates the slowest one
- the eliminated tab cannot submit a guess and sees the "You're out" message
- the eliminated player still appears in the standings with their score
- the match ends the round after only one player remains
- game over shows placements 1, 2, 3 with the survivor as winner

- [ ] **Step 4: LIVES duel, 2 players**

Restart to lobby, host picks Knockout, Lives, with only two players present. Verify:
- the match starts (2 players is allowed under Lives)
- each player begins with 4 lives, shown in the player list
- a round both players answer correctly still costs the slower one a life, and the reveal says why
- the match ends when one player reaches zero
- the match never exceeds 7 rounds

- [ ] **Step 5: SLOWEST minimum-players guard**

With only two players in the lobby, host picks Knockout with Slowest out and starts. Expected: the start is refused with the message naming the 3-player minimum and suggesting Lives.

- [ ] **Step 6: Length and disconnect**

Start a 3-player Lives match and verify it passes round 10 without ending on a counter, and that the question value stops climbing after round 10 (compare the round header's points readout at rounds 9, 10, 12).

Close one tab mid-match. Verify the leaver receives a placement in the final standings rather than disappearing, and that if only one fighter remains the match ends immediately with that player as winner.

- [ ] **Step 7: Rematch**

From game over, run a rematch. Verify every player is un-eliminated, lives are reseeded, placements are cleared, and the new match plays normally.

- [ ] **Step 8: Regression check on classic**

Play one CLASSIC match to completion. Verify the masthead still reads "Track 03 / 10", the reveal still reads "Round 03 / 10", scoring is unchanged, and no knockout element appears anywhere.

Then confirm the inverse in a knockout match: neither surface shows a "/ 10" or any other invented total.

- [ ] **Step 9: Commit any fixes and push**

```bash
git add -A
git commit -m "fix: <what the verification run turned up>"
git push origin main
```

If nothing needed fixing, push the existing commits:

```bash
git push origin main
```

---

## Notes for the implementer

- `settings.rounds` is meaningless under knockout. If you find yourself reading it in a knockout code path, that is a bug.
- `p.spectator` and `p.eliminated` are different things and must never be conflated. Every `!p.spectator` filter you touch needs a deliberate decision about whether `!p.eliminated` belongs beside it. The four that DO need it: `allGuessed`, the `guess` handler, `alivePlayers`, and the round-entry builder. The ones that must NOT get it: round scoring, the game-over leaderboard, the XP award loop, and host transfer.
- The server stays the only source of truth. No client may be trusted for elimination, lives, or placement.
