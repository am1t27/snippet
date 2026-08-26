# Premium Redesign + Progression Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Elevate Snippet's UI to premium "refined arcade" (motion, type, depth, live waveform, reveal cards) and ship the progression layer (XP/ranks, daily archive, ghost race).

**Architecture:** Pure-CSS/Tailwind design-token upgrade + choreographed animations; one WebAudio analyser component; additive server payload fields (artwork, xp, ghost, archive) that never leak answers pre-reveal; new pure modules `xpLogic.js` (server) and `client/src/xp.js` (client mirror).

**Tech Stack:** Node ESM, Socket.IO, pg optional, React/Vite/Tailwind. No TS, no UI libs.

**Spec:** `docs/superpowers/specs/2026-08-28-premium-redesign-design.md` (the spec carries full details; this plan maps waves to files).

## Global Constraints

- §12: dark theme, typographic glyphs only (■ □ ✦ ♬), no emoji, no em dash in output, reduced-motion respected, server-authoritative.
- Commits: user identity, no AI attribution.
- Each wave: implement → verify (vitest / socket smoke / browser) → commit.

---

### Wave 1: Design tokens + motion choreography (A1+A2)

**Files:** `client/tailwind.config.js`, `client/src/index.css`, `client/src/ui.jsx`, all `client/src/screens/*.jsx` (class-level changes only).

- [ ] Add keyframes/animations: cascade, odometer, shake3, flood, burst, ghostblip, levelup; springy button transition utilities; `.glow-wash`, `.panel-lux`, `.grain`, fluid display sizes.
- [ ] Apply: staggered cascade on screen mounts (per-child animation-delay), button hover-lift/press, timer hue shift, display-type hierarchy pass over every screen.
- [ ] Verify in browser (Home, Entry, Lobby, Playing, Reveal, GameOver, DailyResults) + `npm run build`. Commit `feat: refined-arcade design tokens + motion choreography`.

### Wave 2: Live waveform (A3)

**Files:** create `client/src/waveform.jsx`; modify `client/src/screens/Playing.jsx`, `client/src/App.jsx` (pass audioRef).

- [ ] Module-level single `createMediaElementSource` guard; AnalyserNode fftSize 128; 48 bars, rAF + direct style writes; static fallback (no AudioContext or reduced motion).
- [ ] Browser-verify bars move during a round; build; commit `feat: live audio waveform on the play screen`.

### Wave 3: Artwork + reveal cards (A4)

**Files:** `catalog/normalize.js`, `catalog/store.js` (column + snapshot field), `server.js` (reveal payload), `daily.js` (reveal payload), `gameLogic.js` (buildRound passthrough), `client/src/screens/Reveal.jsx`, `client/src/screens/DailyResults.jsx` (artwork strip), tests in `test/catalog.test.js`.

- [ ] normalize keeps `artworkUrl` (100→300 substitution); store column `artwork_url` via `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`; buildRound + reveal payloads carry it post-reveal only.
- [ ] Reveal card UI with glyph fallback; tests for normalize/store field; socket smoke asserts no artwork pre-reveal; browser pass; commit `feat: album-art reveal cards`.

### Wave 4: XP / levels / ranks (B1)

**Files:** create `xpLogic.js`, `client/src/xp.js`, `client/src/screens/LevelUp.jsx`; modify `storage.js` (player_xp + addXp/getXp), `server.js` (gameOver xp for verified), `daily.js` (finish xp), `client/src/stats.js` (guest xp), `client/src/screens/Home.jsx` (Profile rebuild), `client/src/App.jsx`; tests `test/xp.test.js`.

- [ ] Pure curve: `xpForScore`, `levelForXp` (cumulative `100 * level^1.5`), `rankForLevel` (7 ranks / 5 levels each), `progressWithin`.
- [ ] Server: addXp on recordMatch + finishDaily; payloads gain `xp` block for verified. Client mirrors for guests; level-up overlay; Profile v2 (rank, bar, accuracy).
- [ ] vitest curve tests; smoke asserts xp block; browser: play → gain XP → profile shows bar. Commit `feat: XP, levels, arcade ranks`.

### Wave 5: Daily archive + calendar (B2)

**Files:** `storage.js` (`getDailyDays`), `daily.js` (`daily:archive`, `daily:start {day}` unranked), `client/src/useGameSocket.js`, create `client/src/screens/DailyArchive.jsx`, `client/src/App.jsx` + entry points from Daily entry/results.

- [ ] Past-day start loads frozen puzzle, never writes results, `ranked:false`; archive listing with per-day glyphs.
- [ ] vitest for archive shaping; smoke: archive list + past-day unranked run; browser calendar. Commit `feat: daily archive + calendar`.

### Wave 6: Ghost race (B3)

**Files:** `daily.js` (`daily:ghost` emit on ranked start), `storage.js` (leader answers fetch — reuse getDailyLeaderboard + new `getDailyLeaderAnswers(day)`), `client/src/screens/Playing.jsx` (ghost blip on timer), `client/src/useGameSocket.js`, Reveal comparison line.

- [ ] Ghost = current #1's `{name, perRound:[{correct,ms}]}`; timings only; ranked runs only.
- [ ] Smoke: verified run then second player sees ghost; browser blip check. Commit `feat: ghost race on the daily`.

### Wave 7: Final verification

- [ ] Full `npm test`, all smokes, client build, browser end-to-end (room game + daily), docs touch-up (README feature list). Commit `docs: premium redesign notes`.
