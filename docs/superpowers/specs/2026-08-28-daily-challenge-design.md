# Daily Challenge — design

Date: 2026-08-28. Approved direction: solo async daily ("Wordle model"),
guests play + only signed-in are ranked, 5 songs mixed across all genres.

## What it is

One shared puzzle per UTC day: 5 songs drawn from the catalog. Every player
gets the same 5 songs in the same order with the same answer options. Played
solo, any time that day. Score + streak persist; verified (Google) players
land on a per-day global leaderboard. Shareable result text (emoji-free,
typographic glyphs per §12).

## Why these choices

- **Solo async**: works with zero concurrent players; the habit mechanic that
  brings people back without friends online.
- **Guests play, signed-in ranked**: no sign-in wall on the habit loop;
  leaderboard keyed on server-only Google `sub`, so clearing localStorage
  cannot farm the board. Guests keep score/streak locally.
- **5 songs, all genres**: ~2 min; taste never locks anyone out.
- **Precomputed frozen puzzle** (not date-seeded PRNG): catalog changes daily
  via chart ingest, so re-derivation would give different players different
  songs. A `daily_puzzles` row freezes the day at first request. Also allows
  manual regeneration and a future archive.
- **Socket.IO transport, per-player session**: reuses the live round engine's
  event shapes so `Playing.jsx` renders the daily nearly unchanged. No second
  transport, no duplicated state machine.

## Server-authoritative rules (extends existing §12 stance)

- Correct answer never leaves the server while a round is unanswered.
- No shared clock in solo: the server timestamps roundStart when it emits the
  round and computes elapsed from its own clock at answer time. Client-reported
  timings are never trusted. Round hard-expires server-side at timer +
  2s network grace; late answers score 0.
- One play per day per identity: verified → UNIQUE(sub, day) in Postgres;
  guest → localStorage flag (best-effort, accepted; guests aren't ranked).
- Abandoned session = played. Reconnecting the same day resumes mid-puzzle
  (verified) or shows results if finished.

## Data model (Postgres; graceful no-DB fallback)

```sql
CREATE TABLE IF NOT EXISTS daily_puzzles (
  day DATE PRIMARY KEY,                -- UTC
  tracks JSONB NOT NULL                -- [{trackId,trackName,artistName,previewUrl,options:[4],answerIndex}] x5
);
CREATE TABLE IF NOT EXISTS daily_results (
  day DATE NOT NULL,
  sub TEXT NOT NULL,                   -- Google subject id (verified only)
  name TEXT NOT NULL,
  score INTEGER NOT NULL,
  answers JSONB NOT NULL,              -- per-round {correct, ms}
  created_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (day, sub)
);
```

Without DATABASE_URL: puzzle held in memory (regenerated per boot — acceptable
degraded mode, single instance), results not persisted, leaderboard empty.
Guests unaffected (their state is client-side).

## Puzzle generation

On first request of a UTC day: sample 5 tracks via existing
`sampleTracks`/`getSongs` machinery — one track from each of 5 distinct
genres chosen from the 8, artist-diverse, then build options with existing
`buildRound` decoy logic (same-genre decoys). INSERT ... ON CONFLICT DO
NOTHING, then read back the winning row (handles two instances racing).

## Flow (socket events, new `daily:` namespace-by-prefix)

1. `daily:status` → { day, played, score?, rank?, leaderboard? } — Home screen
   uses it to render the card state.
2. `daily:start` → server creates in-memory session { day, roundIdx,
   roundSentAt }, emits round 0 payload (same shape as live `roundStart`:
   preview URL, options, timer; NO answer).
3. `daily:answer` { choiceIndex } → server scores from its own clock
   (reuse `questionValueFor`/`speedBonusFor`), emits reveal payload
   (answerIndex, correct, points, runningScore), then next round or finish.
4. On finish: verified → INSERT daily_results (ON CONFLICT DO NOTHING —
   first completion wins); emit final { score, perRound, leaderboard, rank,
   shareText }.
5. Rate-limited like other events; sessions GC'd on disconnect + day end.

## Client

- **Home**: "Daily" card in the games grid (replaces one "Soon" slot or sits
  first): shows today's number ("Daily #N", N = days since 2026-08-28 epoch + 1), played/unplayed state, streak.
- **Play**: reuse `Playing.jsx` round UI in solo mode (no other-player
  presence, no reactions rail). Same audio/timer/options components.
- **Results screen**: score, per-round correct/incorrect glyph row
  (■/□ per §12 — no emoji), streak, countdown to next puzzle, share button
  (navigator.clipboard), leaderboard top 10 + your rank (verified) or
  sign-in nudge (guest).
- **Guest local state**: { lastPlayedDay, streak, lastScore } in localStorage.

## Streaks

Computed client-side for guests (localStorage). For verified: derived
server-side from daily_results contiguity at `daily:status` time (no extra
table; a 90-day window query is fine at this scale).

## Testing

- Vitest (offline): puzzle generation determinism given a fixed store; option
  building; scoring from server timestamps; streak derivation; share text.
- Headless Socket.IO smoke script (scratch `_daily.mjs`, gitignored):
  full guest play-through against a dev server; replay-block for verified path
  exercised with DB present.
- Browser pass via preview tool: Home card → play 5 rounds → results.

## Out of scope (explicitly)

Playlist import (next project), puzzle archive UI, ghost replays, ranked/ELO,
push notifications.
