# Focus Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a room game mode where the clue is a progressively sharpening album cover instead of an audio clip.

**Architecture:** A third orthogonal settings axis, `clue: AUDIO | COVER`, following the pattern Knockout established with `format`. No new phase, no new tables, no new socket events. The round loop is untouched; only what the client is given changes. A small HTTP proxy route serves cover art at the resolution the round clock currently permits.

**Tech Stack:** Node.js + Socket.IO server, React + Vite + Tailwind client, Vitest.

**Spec:** `docs/superpowers/specs/2026-08-28-focus-design.md`

## Global Constraints

- Never use the em dash character (U+2014) anywhere: code, comments, commit messages, UI copy. Use commas, colons, parentheses, semicolons, or a plain hyphen.
- Git commits must be authored by `amitdas <amitdas1844@gmail.com>`. Never add Claude or Anthropic as author, committer, or co-author, and never add a generation footer.
- The server is the only source of truth. Under COVER, `audioUrl` must never reach the client, and no image-host URL may ever reach the client.
- UI glyphs are typographic marks, never emoji.
- All motion respects `prefers-reduced-motion`.
- `ART_STEPS = [8, 14, 24, 44, 90, 300]`.
- **Do not touch the daily challenge.** `daily.js` builds rounds with its own settings object; nothing in this plan may change its behaviour.
- Run `npm test` from the repo root. E2E is `npm run test:e2e`.

---

### Task 1: The `clue` settings axis

**Files:**
- Modify: `gameLogic.js` (allowlists near `CLIP_CHOICES`, `DEFAULT_SETTINGS`, `sanitizeSettings`)
- Test: `test/gameLogic.test.js`

**Interfaces:**
- Produces: `CLUE_CHOICES: string[]`; `DEFAULT_SETTINGS.clue === "AUDIO"`; `sanitizeSettings` returns a validated `clue`.

- [ ] **Step 1: Write the failing test**

In `test/gameLogic.test.js`, inside the existing `describe("sanitizeSettings")`:

```js
  it("accepts and uppercases the clue axis", () => {
    expect(sanitizeSettings({ clue: "cover" }).clue).toBe("COVER");
  });

  it("defaults clue to AUDIO and clamps junk", () => {
    expect(sanitizeSettings({}).clue).toBe("AUDIO");
    expect(sanitizeSettings({ clue: "smell" }).clue).toBe("AUDIO");
  });
```

The existing `it("accepts valid values")` uses `toEqual` on the whole object and WILL break. Add `clue: "AUDIO"` to its expected object.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- gameLogic`
Expected: FAIL, `clue` is `undefined`.

- [ ] **Step 3: Write minimal implementation**

After `CLIP_CHOICES` in `gameLogic.js`:

```js
// What the player is given each round. AUDIO plays a clip; COVER shows the
// album art sharpening across the round and plays nothing at all.
export const CLUE_CHOICES = ["AUDIO", "COVER"];
```

Add `clue: CLUE_CHOICES[0],` to `DEFAULT_SETTINGS`, and to the object returned by `sanitizeSettings`:

```js
    clue: pick(String(p.clue || "").toUpperCase(), CLUE_CHOICES),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS, the whole suite. If `daily.test.js` fails, something reached the daily that should not have.

- [ ] **Step 5: Commit**

```bash
git add gameLogic.js test/gameLogic.test.js
git commit -m "feat: clue settings axis (AUDIO or COVER)

Third orthogonal axis after mode and format, so a cover round composes
with title/artist naming and with knockout."
```

---

### Task 2: The reveal ladder and its anti-cheat predicate

**Files:**
- Create: `focusLogic.js`
- Test: `test/focus.test.js`

**Interfaces:**
- Produces:
  - `ART_STEPS: number[]` — `[8, 14, 24, 44, 90, 300]`
  - `stepForElapsed(elapsedMs, roundMs): number` — 0-based index, clamped
  - `stepAllowed(elapsedMs, roundMs, requested): boolean`
  - `artUrlForStep(artworkUrl, step): string|null`

- [ ] **Step 1: Write the failing test**

Create `test/focus.test.js`:

```js
import { describe, it, expect } from "vitest";
import { ART_STEPS, stepForElapsed, stepAllowed, artUrlForStep } from "../focusLogic.js";

const ART = "https://is1-ssl.mzstatic.com/image/thumb/Music124/v4/aa/bb/cc/x/886445438048.jpg/300x300bb.jpg";

describe("ART_STEPS", () => {
  it("is a six-rung ladder that only ever sharpens", () => {
    expect(ART_STEPS).toEqual([8, 14, 24, 44, 90, 300]);
    for (let i = 1; i < ART_STEPS.length; i++) {
      expect(ART_STEPS[i]).toBeGreaterThan(ART_STEPS[i - 1]);
    }
  });
});

describe("stepForElapsed", () => {
  it("starts at the blurriest step", () => {
    expect(stepForElapsed(0, 10000)).toBe(0);
    expect(stepForElapsed(-500, 10000)).toBe(0); // clock skew must not skip ahead
  });

  it("advances once per slice of the round", () => {
    // 10s / 6 steps = 1666.67ms per step
    expect(stepForElapsed(1666, 10000)).toBe(0);
    expect(stepForElapsed(1667, 10000)).toBe(1);
    expect(stepForElapsed(5000, 10000)).toBe(3);
  });

  it("clamps to the sharpest step at and past the end", () => {
    expect(stepForElapsed(10000, 10000)).toBe(5);
    expect(stepForElapsed(99999, 10000)).toBe(5);
  });

  it("spreads the ladder across every legal round length", () => {
    for (const roundMs of [7500, 10000, 15000]) {
      expect(stepForElapsed(0, roundMs)).toBe(0);
      expect(stepForElapsed(roundMs - 1, roundMs)).toBe(5);
      expect(stepForElapsed(roundMs, roundMs)).toBe(5);
    }
  });

  it("never returns an out-of-range index", () => {
    for (const ms of [0, 1, 999, 4000, 9999, 100000]) {
      const s = stepForElapsed(ms, 10000);
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThan(ART_STEPS.length);
    }
  });
});

describe("stepAllowed", () => {
  it("allows the current step and everything behind it", () => {
    expect(stepAllowed(5000, 10000, 0)).toBe(true);
    expect(stepAllowed(5000, 10000, 3)).toBe(true);
  });

  it("REFUSES a step ahead of the clock", () => {
    // The security property the whole mode rests on: asking for a sharper
    // image than the round has reached must fail.
    expect(stepAllowed(0, 10000, 5)).toBe(false);
    expect(stepAllowed(5000, 10000, 4)).toBe(false);
  });

  it("refuses garbage step values", () => {
    for (const bad of [-1, 6, 99, NaN, "3", null, undefined]) {
      expect(stepAllowed(9999, 10000, bad)).toBe(false);
    }
  });
});

describe("artUrlForStep", () => {
  it("substitutes only the size segment", () => {
    expect(artUrlForStep(ART, 0)).toContain("/8x8bb.jpg");
    expect(artUrlForStep(ART, 5)).toContain("/300x300bb.jpg");
    // the rest of the path is untouched
    expect(artUrlForStep(ART, 0)).toContain("886445438048.jpg");
  });

  it("returns null for a missing url or a bad step", () => {
    expect(artUrlForStep(null, 0)).toBe(null);
    expect(artUrlForStep(ART, 9)).toBe(null);
    expect(artUrlForStep(ART, -1)).toBe(null);
  });

  it("only accepts the image host we expect", () => {
    // Never fetch an arbitrary attacker-supplied URL server-side.
    expect(artUrlForStep("https://evil.example.com/a/300x300bb.jpg", 0)).toBe(null);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- focus`
Expected: FAIL, cannot resolve `../focusLogic.js`.

- [ ] **Step 3: Write minimal implementation**

Create `focusLogic.js`:

```js
// Focus mode: the clue is the album cover, revealed as a resolution ladder.
//
// Pure and side-effect free so both the server and the tests can use it without
// a socket, a clock, or the network. The client imports nothing from here: it
// only ever asks our own proxy for a step index.

// Six rungs. The numbers are real image sizes, and the ladder only sharpens.
export const ART_STEPS = [8, 14, 24, 44, 90, 300];

// The image host we are willing to fetch from. Anything else is refused so a
// crafted artwork value can never turn the proxy into an open relay.
const ART_HOST = "is1-ssl.mzstatic.com";

// Which rung is visible after `elapsedMs` of a `roundMs` round. The ladder is
// spread across the round so it tracks the host's chosen timer rather than
// assuming one length. Clamped at both ends: negative clock skew must not skip
// ahead, and overrun must not index past the ladder.
export function stepForElapsed(elapsedMs, roundMs) {
  const total = Number(roundMs) > 0 ? Number(roundMs) : 10000;
  const per = total / ART_STEPS.length;
  const raw = Math.floor((Number(elapsedMs) || 0) / per);
  return Math.max(0, Math.min(ART_STEPS.length - 1, raw));
}

// THE security predicate. A client may ask for the current rung or any blurrier
// one; asking for a sharper image than the round has reached is the whole cheat
// this mode has to prevent, so it is refused here and nowhere else.
export function stepAllowed(elapsedMs, roundMs, requested) {
  if (typeof requested !== "number" || !Number.isInteger(requested)) return false;
  if (requested < 0 || requested >= ART_STEPS.length) return false;
  return requested <= stepForElapsed(elapsedMs, roundMs);
}

// Host URL for one rung. The host encodes the size as a path segment, which is
// exactly why the client is never given one of these: rewriting 8x8 to 300x300
// would reveal the answer. Server-side only.
export function artUrlForStep(artworkUrl, step) {
  if (!artworkUrl || typeof artworkUrl !== "string") return null;
  if (!Number.isInteger(step) || step < 0 || step >= ART_STEPS.length) return null;
  let host;
  try {
    host = new URL(artworkUrl).hostname;
  } catch {
    return null;
  }
  if (host !== ART_HOST) return null;
  const n = ART_STEPS[step];
  return artworkUrl.replace(/\/\d+x\d+bb\.jpg$/, `/${n}x${n}bb.jpg`);
}

export default { ART_STEPS, stepForElapsed, stepAllowed, artUrlForStep };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS, whole suite.

- [ ] **Step 5: Commit**

```bash
git add focusLogic.js test/focus.test.js
git commit -m "feat: focus reveal ladder and its anti-cheat predicate

stepAllowed refuses any step ahead of the round clock, which is the
property the whole mode rests on. artUrlForStep refuses any host but
the image CDN so the proxy can never become an open relay."
```

---

### Task 3: The art proxy route

**Files:**
- Modify: `server.js` (imports; a token registry near the rooms registry; the HTTP handler at line 790)
- Test: covered by Task 7

**Interfaces:**
- Consumes: `stepAllowed`, `artUrlForStep`, `ART_STEPS` from Task 2
- Produces: `mintArtToken(room, artworkUrl): string`, `dropArtToken(room)`; route `GET /art/:token/:step`

- [ ] **Step 1: Import and add the token registry**

Add to the `focusLogic.js` import in `server.js`:

```js
import { ART_STEPS, stepAllowed, artUrlForStep } from "./focusLogic.js";
```

Next to the `rooms` registry:

```js
// Focus art tokens: an unguessable id per round, handed only to the players in
// that room. The room CODE is deliberately not used as an image key - codes are
// short and were the subject of an earlier enumeration fix.
const artTokens = new Map(); // token -> { code, round, artworkUrl }
// Fetched cover bytes, keyed trackId:step. Small and bounded: a round needs at
// most six entries and each is a few KB.
const artCache = new Map();
const ART_CACHE_MAX = 240;

function mintArtToken(room, artworkUrl, trackId) {
  dropArtToken(room);
  const token = randomUUID();
  artTokens.set(token, { code: room.code, round: room.round, artworkUrl, trackId });
  room.artToken = token;
  return token;
}

function dropArtToken(room) {
  if (room.artToken) artTokens.delete(room.artToken);
  room.artToken = null;
}
```

- [ ] **Step 2: Add the route**

Inside the `http.createServer` handler, alongside the other `req.url.startsWith` branches:

```js
  // Cover art for a Focus round, at the resolution the round clock allows.
  // The client never receives an image-host URL: the host encodes the size in
  // the path, so holding one would let anyone rewrite 8x8 to 300x300 and read
  // the answer.
  if (req.method === "GET" && req.url && req.url.startsWith("/art/")) {
    const parts = req.url.split("?")[0].split("/").filter(Boolean); // ["art", token, step]
    const entry = parts.length === 3 ? artTokens.get(parts[1]) : null;
    const step = parts.length === 3 ? Number(parts[2]) : NaN;
    const room = entry ? rooms.get(entry.code) : null;

    // Token unknown, room gone, or the round moved on: the token is dead.
    if (!entry || !room || room.round !== entry.round || room.phase !== PHASE.ROUND_PLAYING) {
      res.writeHead(403, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "expired" }));
      return;
    }
    const elapsed = Date.now() - room.roundStartedAt;
    if (!stepAllowed(elapsed, room.settings.roundMs, step)) {
      res.writeHead(403, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "too sharp" }));
      return;
    }

    const key = `${entry.trackId}:${step}`;
    let buf = artCache.get(key);
    if (!buf) {
      const url = artUrlForStep(entry.artworkUrl, step);
      if (!url) {
        res.writeHead(404).end();
        return;
      }
      try {
        const upstream = await fetch(url);
        if (!upstream.ok) throw new Error(String(upstream.status));
        buf = Buffer.from(await upstream.arrayBuffer());
      } catch {
        res.writeHead(502, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "art unavailable" }));
        return;
      }
      if (artCache.size >= ART_CACHE_MAX) artCache.delete(artCache.keys().next().value);
      artCache.set(key, buf);
    }
    res.writeHead(200, {
      "Content-Type": "image/jpeg",
      "Content-Length": buf.length,
      // Per-step immutable, but never shared across rounds by a proxy.
      "Cache-Control": "private, max-age=300",
    });
    res.end(buf);
    return;
  }
```

- [ ] **Step 3: Verify**

Run: `node --check server.js` then `npm test`
Expected: syntax ok, suite passes.

Run: `PORT=3999 node -e "import('./server.js').then(()=>{console.log('boot ok');process.exit(0)})"`
Expected: `boot ok`.

Run with the server up: `curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3999/art/nope/0`
Expected: `403`. An unknown token must never 500.

- [ ] **Step 4: Commit**

```bash
git add server.js
git commit -m "feat: cover art proxy bounded by the round clock

The image host puts the size in the URL path, so any client holding a
step URL could rewrite 8x8 to 300x300 and read the answer. The client
gets an opaque per-round token instead, and the route refuses any step
ahead of the round clock the server already owns."
```

---

### Task 4: Serve cover rounds and withhold the audio

**Files:**
- Modify: `server.js` (`makeRoom`, `beginPlaying`, `publicState`, `endRound`, `resetToLobby`, the `startGame` pool guard)
- Test: covered by Task 7

**Interfaces:**
- Produces: `publicState.clue`; `publicState.audioUrl === null` under COVER; `roundStart.artToken` and `roundStart.artSteps` under COVER.

- [ ] **Step 1: Room field**

In `makeRoom`, next to the knockout field:

```js
    artToken: null, // Focus: current round's opaque art token
```

In `resetToLobby`, next to the other resets:

```js
  dropArtToken(room);
```

- [ ] **Step 2: Mint the token and withhold audio**

In `beginPlaying`, after `room.correctArtwork` is assigned:

```js
  // Focus: mint this round's art token. Under COVER the audio URL is withheld
  // entirely - handing over the clip would give away the answer through the
  // other sense and make the artwork pointless.
  const cover = room.settings.clue === "COVER";
  if (cover) mintArtToken(room, room.correctArtwork, picked.trackId);
  else dropArtToken(room);
```

In the same function, change the `roundStart` emit to carry the token:

```js
  io.to(room.code).emit("roundStart", {
    questionValue: questionValueFor(roundIndex, room.settings.format),
    maxSpeedBonus: MAX_SPEED_BONUS,
    roundIndex,
    artToken: cover ? room.artToken : null,
    artSteps: cover ? ART_STEPS.length : 0,
  });
```

- [ ] **Step 3: Withhold audioUrl in publicState**

In `publicState`, replace the `audioUrl` line:

```js
    // COVER rounds send no audio at all: the cover is the whole clue.
    audioUrl: inRound && room.settings.clue !== "COVER" ? room.audioUrl : null,
    clue: room.settings.clue,
```

- [ ] **Step 4: Drop the token when the round ends**

In `endRound`, immediately after `room.phase = PHASE.ROUND_REVEAL;`:

```js
  dropArtToken(room); // the round is over; the token must not outlive it
```

- [ ] **Step 5: Require artwork in the pool under COVER**

In the `startGame` handler, after the pool is fetched and before the length check:

```js
    // A cover round needs a cover. Coverage is currently 100%, so this guards
    // against a future thin ingest rather than a live gap, and it fails through
    // the existing "not enough songs" path instead of showing a blank tile.
    if (room.settings.clue === "COVER" && pool) {
      pool = pool.filter((t) => t.artworkUrl);
    }
```

Change `let pool;` to remain `let` (it already is) so the reassignment is legal.

- [ ] **Step 6: Verify**

Run: `node --check server.js && npm test`
Expected: syntax ok, 100% of the suite passes.

Run: `PORT=3999 node -e "import('./server.js').then(()=>{console.log('boot ok');process.exit(0)})"`
Expected: `boot ok`.

- [ ] **Step 7: Commit**

```bash
git add server.js
git commit -m "feat: serve cover rounds and withhold the clip

Under COVER the round mints an opaque art token and audioUrl is null in
every state broadcast, so the answer cannot arrive through the other
sense. The token is dropped the moment the round ends."
```

---

### Task 5: Home card and lobby control

**Files:**
- Modify: `client/src/screens/Home.jsx` (`GAMES`)
- Modify: `client/src/App.jsx` (`cluePref` state, `openGame`, the Lobby render site)
- Modify: `client/src/screens/Lobby.jsx`
- Test: covered by Task 7

- [ ] **Step 1: Home card, and remove the competitor placeholders**

In `client/src/screens/Home.jsx`, in `GAMES`: insert a `focus` entry after `knockout`, and DELETE the `wordzic`, `lyricles` and `crosszic` entries entirely.

```js
  { key: "knockout", glyph: "✕", title: "Knockout", sub: "Get it wrong, you're out - last one standing wins", status: "play", clip: "RANDOM", format: "KNOCKOUT", knockout: "SLOWEST" },
  { key: "focus", glyph: "◱", title: "Focus", sub: "Name the track before the cover sharpens", status: "play", clip: "RANDOM", clue: "COVER" },
```

Those three are removed because they are competitor product names (Wordzic is SongTrivia2's), they use none of our catalogue, and Lyricles is not buildable without lyric data. The grid becomes six playable cards and no placeholders.

- [ ] **Step 2: Carry the preference**

In `client/src/App.jsx`, beside `formatPref`:

```js
  const [cluePref, setCluePref] = useState("AUDIO"); // preset by the Focus card
```

In `openGame`, beside `setFormatPref`:

```js
    setCluePref(game.clue || "AUDIO");
```

At the `<Lobby ... />` render site, beside `knockoutPref`:

```jsx
              cluePref={cluePref}
```

- [ ] **Step 3: Lobby control**

In `client/src/screens/Lobby.jsx`, beside `KNOCKOUT_OPTS`:

```js
// What the player is given each round. COVER shows the album art sharpening and
// plays nothing, so the Clip setting has nothing to act on.
const CLUE_OPTS = [
  { label: "Audio", value: "AUDIO" },
  { label: "Cover", value: "COVER" },
];
```

Extend the signature:

```jsx
export function Lobby({ players, myId, isHost, onStart, code, messages, onChat, clipPref, formatPref, knockoutPref, cluePref, onLeave }) {
```

Add to the settings initialiser:

```js
    clue: cluePref === "COVER" ? "COVER" : "AUDIO",
```

Add a Clue row directly under the existing Format/Rule block, and wrap the existing Clip row so it hides under COVER. Replace this line:

```jsx
          <SettingRow label="Clip" options={CLIP_OPTS} value={settings.clip} onChange={setField("clip")} />
```

with:

```jsx
          <SettingRow label="Clue" options={CLUE_OPTS} value={settings.clue} onChange={setField("clue")} />
          {settings.clue !== "COVER" && (
            <SettingRow label="Clip" options={CLIP_OPTS} value={settings.clip} onChange={setField("clip")} />
          )}
```

- [ ] **Step 4: Verify**

Run: `cd client && npm run build`
Expected: build succeeds.

- [ ] **Step 5: Commit**

```bash
git add client/src/screens/Home.jsx client/src/App.jsx client/src/screens/Lobby.jsx
git commit -m "feat: focus home card and lobby clue control

Also removes the wordzic, lyricles and crosszic placeholders: they are
competitor product names, they use none of our catalogue, and lyricles
is not buildable without lyric data."
```

---

### Task 6: Render the cover round

**Files:**
- Modify: `client/src/screens/Playing.jsx`
- Test: covered by Task 7

- [ ] **Step 1: Do not touch the audio element under COVER**

In `client/src/screens/Playing.jsx`, the effect at line 28 assigns `el.src = state.audioUrl`. Under COVER `audioUrl` is null, so guard the whole effect at its top:

```js
    // COVER rounds have no clip. Leave the primed element alone entirely rather
    // than pointing it at null, which would abort playback noisily.
    if (state.clue === "COVER" || !state.audioUrl) return;
```

- [ ] **Step 2: Add the cover panel**

Add a `CoverArt` component at the bottom of the file:

```jsx
// The Focus clue: the album cover as a resolution ladder. Every step is a
// separate request to our own proxy, which refuses any step the round clock has
// not reached, so there is no sharper image on the client to uncover.
function CoverArt({ token, steps, timeRemainingMs, roundMs, round }) {
  const [step, setStep] = useState(0);
  const reduced = usePrefersReducedMotion();

  useEffect(() => {
    setStep(0);
  }, [round, token]);

  useEffect(() => {
    if (!token || !steps) return;
    const elapsed = Math.max(0, roundMs - (timeRemainingMs ?? roundMs));
    const next = Math.min(steps - 1, Math.floor(elapsed / (roundMs / steps)));
    setStep((s) => (next > s ? next : s)); // only ever sharpens
  }, [timeRemainingMs, roundMs, steps, token]);

  if (!token) return null;
  const base = import.meta.env.VITE_SOCKET_URL || "";
  return (
    <div className="grid place-items-center">
      <img
        key={`${token}-${step}`}
        src={`${base}/art/${token}/${step}`}
        alt="Album cover, partly revealed"
        width="320"
        height="320"
        className={`h-[min(70vw,20rem)] w-[min(70vw,20rem)] border border-rule bg-void object-cover ${
          reduced ? "" : "transition-opacity duration-300"
        }`}
        style={{ imageRendering: "pixelated" }}
      />
    </div>
  );
}
```

Add the reduced-motion hook if the file does not already have one:

```jsx
function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const q = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(q.matches);
    const on = () => setReduced(q.matches);
    q.addEventListener("change", on);
    return () => q.removeEventListener("change", on);
  }, []);
  return reduced;
}
```

Ensure `useState` and `useEffect` are imported at the top of the file.

- [ ] **Step 3: Swap the waveform for the cover**

Replace the `<Waveform audioRef={audioRef} />` line with:

```jsx
      {state.clue === "COVER" ? (
        <CoverArt
          token={roundMeta?.artToken ?? null}
          steps={roundMeta?.artSteps ?? 0}
          timeRemainingMs={state.timeRemainingMs}
          roundMs={state.roundMs ?? 10000}
          round={state.round}
        />
      ) : (
        <Waveform audioRef={audioRef} />
      )}
```

- [ ] **Step 4: Suppress the audio affordances under COVER**

The `audioError` retry button and the `needsTap` "Play clip" button are meaningless without audio. Guard both blocks with `state.clue !== "COVER" &&`.

- [ ] **Step 5: Verify**

Run: `cd client && npm run build`
Expected: build succeeds with no unresolved import.

- [ ] **Step 6: Commit**

```bash
git add client/src/screens/Playing.jsx
git commit -m "feat: render the focus cover ladder

Each step is a separate request to our proxy, so the client never holds
a sharper image than the round has reached. The step only ever
increases, so a late state update cannot re-blur the cover."
```

---

### Task 7: End-to-end verification

**Files:**
- Create: `test/e2e/focus.e2e.test.js`
- No production changes here; fixes belong in the task that owns the file.

- [ ] **Step 1: Write the e2e test**

Create `test/e2e/focus.e2e.test.js`, following the structure of `test/e2e/knockout.e2e.test.js` (spawn the server on a spare port, connect real Socket.IO clients). It must assert:

```js
// 1. A COVER match never sends audio.
expect(roundStates.every((s) => s.audioUrl === null)).toBe(true);
expect(roundStates.every((s) => s.clue === "COVER")).toBe(true);

// 2. roundStart carries a token and the ladder length.
expect(typeof started.artToken).toBe("string");
expect(started.artSteps).toBe(6);

// 3. Step 0 is served immediately.
const early = await fetch(`${URL}/art/${started.artToken}/0`);
expect(early.status).toBe(200);
expect(early.headers.get("content-type")).toBe("image/jpeg");

// 4. THE security assertion: a step ahead of the clock is refused.
const ahead = await fetch(`${URL}/art/${started.artToken}/5`);
expect(ahead.status).toBe(403);

// 5. An unknown token is refused, not a 500.
const bogus = await fetch(`${URL}/art/not-a-token/0`);
expect(bogus.status).toBe(403);

// 6. An AUDIO match is unregressed: audio still arrives, no token.
expect(audioStates.some((s) => typeof s.audioUrl === "string")).toBe(true);
```

- [ ] **Step 2: Run it**

Run: `npm run test:e2e`
Expected: PASS, both the focus file and the existing knockout file.

- [ ] **Step 3: Browser verification**

Start the server (`CATALOG_INGEST=off node server.js`) and the client (`cd client && npm run dev`). Drive two tabs into a Focus room and confirm by eye:

- the lobby shows a Clue row and hides Clip when Cover is selected
- the cover starts as unreadable colour and visibly sharpens through the round
- nothing plays
- the reveal shows the full-resolution cover and the answer
- an AUDIO match still plays audio and shows the waveform

Capture a screenshot of a mid-round cover and of the reveal.

- [ ] **Step 4: Commit any fixes and push**

```bash
git add -A
git commit -m "test: end-to-end focus coverage"
git push origin main
```

---

## Notes for the implementer

- **The client must never hold an image-host URL.** If you find yourself sending `artworkUrl` to a client during a round, that is the bug this whole design exists to prevent. The reveal payload's `track.artworkUrl` is fine: the round is over by then.
- `audioUrl` must be null in every COVER broadcast, not merely ignored by the client.
- Do not change `daily.js`. It builds rounds with its own settings object and must keep behaving exactly as it does now.
