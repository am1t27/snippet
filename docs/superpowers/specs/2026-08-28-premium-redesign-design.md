# Premium Redesign + Progression — design

Date: 2026-08-28 (IST). Approved direction: "refined arcade" — elevate the
existing vibrant-arcade identity, do not replace it. Features approved: song
reveal cards + live waveform, XP/levels/ranks, daily archive + calendar,
ghost race on the daily.

Hard rules (§12, unchanged): no TypeScript, no UI component libraries, dark
theme, server-authoritative answers/scores, typographic glyphs never emoji,
`prefers-reduced-motion` respected everywhere.

## Sub-project A — visual elevation + reveal cards

### A1. Design tokens (tailwind.config.js + index.css)

- Fluid display type: `--fs-display: clamp(2.5rem, 8vw, 4.5rem)` used by score,
  countdown digits, and result numbers (Archivo weight 900, tracking -0.02em).
  Hierarchy trims to: display, title (text-2xl), body (text-sm), label
  (text-[11px] tracking-[0.2em]). Press Start 2P only for "INSERT COIN".
- New keyframes: `cascade` (rise+fade, used with per-child `animation-delay`
  40ms steps), `odometer` (translateY roll for score digits), `shake3`
  (3-axis wrong-answer shake), `flood` (correct-answer green wash),
  `burst` (typographic ✦ starburst particles), `ghostblip` (ghost marker
  pulse), `levelup` (overlay zoom-settle).
- Depth utilities: `.glow-wash` (radial gradient header wash), `.panel-lux`
  (1px gradient border via background-clip trick over the existing PANEL),
  `.grain` (2% noise overlay, pure CSS repeating gradient — no image asset).
- Timer bar hue: amber→red interpolation driven by width % (CSS only:
  two stacked bars, red one revealed as width shrinks).

### A2. Motion choreography (screens)

- Every screen mounts with `cascade` staggering its top-level children.
- Buttons: `hover:-translate-y-0.5 hover:shadow-glow active:scale-[.96]`
  with 150ms springy cubic-bezier(.34,1.56,.64,1).
- Reveal: correct = flood + burst glyphs + odometer count-up of gained
  points; wrong = shake3 + red phosphor flash.
- Reduced motion: all new animations under the existing global kill switch.

### A3. Live waveform (Playing screen)

`client/src/waveform.jsx`: component owning a WebAudio `AnalyserNode` fed by
`createMediaElementSource(audioRef.current)` (created once, module-level, since
a media element allows only one source node; routed through the analyser to
`destination`). 48 frequency bars rendered as divs updated via rAF writing
`transform: scaleY()` (no per-frame React state). Falls back to a static bar
row when AudioContext is unavailable and when reduced-motion is set. Colors:
bar gradient cyan→pink; peaks flash amber.

### A4. Reveal cards + artwork

- Data: `catalog/normalize.js` keeps `artworkUrl` (from raw `artworkUrl100`,
  upgraded to 300x300 via the documented `100x100` → `300x300` URL substitution);
  `catalog/store.js` adds `artwork_url` column (`ALTER TABLE ... ADD COLUMN IF
  NOT EXISTS` on init) + snapshot field; `itunesFetcher` already returns raw
  iTunes rows — confirm and pass through. `buildRound` carries `artworkUrl`;
  server reveal payloads (live `endRound` + daily `resolveRound`) add
  `track.artworkUrl`. NEVER sent before reveal.
- UI: `Reveal.jsx` becomes a card: artwork (or glyph tile fallback ♬ when
  null), staggered title/artist entrance, odometer points, winner flash.
  Old rows have null artwork until the next ingest refresh fills them.

## Sub-project B — progression + daily depth

### B1. XP / levels / ranks

- `xpLogic.js` (pure): `xpForScore(score) = round(score / 10)`;
  `levelForXp(xp)` with thresholds `100 * level^1.5` cumulative; rank titles
  (one per 5 levels): CADET, BUSKER, OPENER, SIDESTAGE, HEADLINER, ENCORE,
  LEGEND. Exports `progressWithin(xp)` for the bar.
- Storage: `player_xp (sub TEXT PRIMARY KEY, name TEXT, xp INTEGER)` +
  `addXp(sub, name, delta)` / `getXp(sub)` with memory fallback. Wired into
  `recordMatch` (per verified player) and `finishDaily`.
- Client: guests mirror XP in localStorage (`snippet.xp`). `gameOver` and
  `daily:finish` payloads gain `xp: { gained, total, level, rank, leveledUp }`
  for verified players; guests compute the same shape locally with xpLogic
  (duplicated in `client/src/xp.js` — client copy, no shared import across
  the workspace boundary). Level-up = full-screen overlay (rank name,
  burst, continue button). Profile screen rebuilt: rank, level, XP progress
  bar, games/wins/accuracy.

### B2. Daily archive + calendar

- Storage: `getDailyDays(sub, limit=60)` returns recent puzzle days with
  the player's result summary when present (`perRound` derived from answers).
- Socket: `daily:archive {idToken?}` → `{ days: [{ day, number, played,
  score, perRound }] }` (guest: played always false server-side; client
  overlays its local record for today only — past guest plays are not
  tracked, shown as unplayed).
- `daily:start { day? }`: a past day loads that frozen puzzle and runs
  UNRANKED for everyone (no result row written, `ranked: false`, no streak
  effect); missing puzzle day → errorMsg. Today (or omitted day) behaves
  exactly as now.
- Client: calendar grid on a new "archive" view reached from the Daily
  results screen + Daily entry ("Past puzzles"): month grid, each day cell
  shows the glyph row when played, tap → play unranked.

### B3. Ghost race

- On ranked `daily:start`, server fetches current #1's `daily_results.answers`
  (skip when it is the same player — cannot happen, they are blocked; skip
  when board empty) and includes in a new `daily:ghost` emit:
  `{ name, perRound: [{ correct, ms }] }`. Sent once at session start —
  timings only, never answers.
- Client: during each daily round, a ghost blip sits on the timer bar at the
  ghost's `ms` for that round; when the clock passes it, the blip pulses and
  a label shows "<name> answered". Reveal compares your time vs ghost. Only
  on ranked (today) runs.

## Rollout / testing

Waves: A1+A2 (tokens+motion) → A3 (waveform) → A4 (artwork server + reveal
cards) → B1 (XP) → B2 (archive) → B3 (ghost). Each wave: vitest for pure
logic (xp curve, archive shaping, ghost payload), headless socket smoke for
new events, browser pass, client build, commit (auto-push).

Out of scope: playlist import (next project), seasons/resets, friend graphs,
push notifications.
