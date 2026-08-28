# Focus (blurred cover art) — design

Status: approved design, ready for an implementation plan.
Date: 2026-08-28

## Summary

A daily solo puzzle played by eye instead of ear. Five album covers, each
starting as an unreadable block of colour and sharpening over about fifteen
seconds. Four track titles are offered; the player commits a single guess
whenever they dare, and answering earlier scores more.

The mode is called **Focus**.

## Why this mode, and why not the other one

This replaces a previously specced mode, Quartets (audio Connections), which was
dropped on playability grounds before any code was written. That analysis is
worth keeping: Connections works because comparison is parallel and free (16
words re-scanned in a second), whereas audio is serial and slow (one clip at a
time, ~80 seconds for a single survey of 16 tiles, with the early tiles
forgotten by the end). Every successful audio game in the category keeps audio
serial and short with the comparison set rendered in text. See
`2026-08-28-quartets-design.md`; its generator spike findings remain valid if the
idea is ever revisited.

Focus has the opposite property, which is the point: the puzzle is **visible and
parallel**. There is nothing to hold in memory, no rules to explain, and the
player can see their own progress toward the answer.

The mechanic is proven (HumHigh ships a BLUR mode). What makes it ours is the
catalogue: 25,558 tracks, **100% of them carrying artwork**, across genre
families no competitor has.

## Feasibility, established before design

Checked against the real catalogue and the real image host, not assumed:

- **Artwork coverage is 100%** — all 25,558 tracks, every genre family
  (country through bollywood). The backfill noted as pending in earlier project
  notes has already landed.
- **The image host serves arbitrary square sizes** by path substitution.
  Verified live: 20x20 returns 1,114 bytes and 600x600 returns 74,545 bytes,
  both HTTP 200, both valid JPEG.
- **The reveal ladder was rendered against real covers** before this was
  specced. At 8px everything is colour blobs; by 24px a graphic cover (Ed
  Sheeran's divide symbol) is unmistakable and a distinctive photo (The Weeknd's
  silhouette) is gettable; by 44px all tested covers were solvable; 90px gives
  it away.

Two properties observed in that render, both accepted:

1. **Difficulty varies by cover type.** Typographic and graphic covers resolve
   far earlier than photographic ones. Day-to-day difficulty will swing. This is
   inherent to album art and every game in the category lives with it.
2. **Printed titles become legible in late steps.** "BLINDING LIGHTS" and
   "DIVIDE" are readable around 90px. Harmless, because by then the image is
   effectively revealed; it only matters if the ladder runs too long, which is
   why the ladder ends at 300 and the round ends with it.

## The reveal ladder

Six steps over a fifteen-second round, advancing every 2.5 seconds:

```
8px -> 14px -> 24px -> 44px -> 90px -> 300px
```

Rendered at a fixed display size with `image-rendering: pixelated`, so each step
reads as a deliberate mosaic rather than a blurry photo.

## Anti-cheat: the image must be proxied

**The naive implementation is trivially cheatable and must not be built.** The
image host encodes the size as a path segment
(`.../886445438048.jpg/8x8bb.jpg`). Any client holding a step URL can rewrite
`8x8` to `600x600` and see the answer immediately. That is a string edit in
devtools, a far lower bar than the cheats already possible elsewhere in the app
(identifying a preview clip with a music-recognition app), so it would actually
be used.

Therefore the client never receives an image-host URL. It receives an opaque
route on our own server:

```
GET /focus/art/:day/:round/:step
```

The route:

- resolves `(day, round)` to a track via the frozen puzzle, server-side
- **refuses any `step` beyond the step the requesting session has reached**,
  returning 403. This is the actual protection; without it the route is just a
  slower version of the same hole.
- streams the image from the host at the size for that step
- caches the day's images in memory (5 rounds x 6 steps = 30 images, well under
  1MB) so the host is hit at most once per image per day

Session progress is tracked exactly like the existing daily's in-memory session
map. A player who has not started the day gets 403 for every step.

This is the same posture as the rest of the codebase: the server is the only
source of truth, and the answer never reaches the client early.

## Round rules

- Five rounds per UTC day, frozen so everyone plays the same puzzle.
- One round per distinct genre, reusing the existing daily's genre-spreading
  approach.
- Four options, track titles, exactly one correct.
- **One guess per round.** Committing ends the round immediately.
- Not answering within the fifteen seconds scores zero for that round.
- The correct answer and the full-resolution cover are revealed after the round
  resolves, never before.

## Scoring

Deliberately reuses the existing maths so a Focus point is worth exactly what a
room point or a daily point is worth:

- `questionValueFor(roundIndex)` for the base value, unchanged and unclamped
  (five rounds cannot run away the way an uncapped knockout could).
- `speedBonusFor(elapsedMs, 15000)` for the earliness bonus. Answering at step 1
  is worth close to the full bonus; answering at step 6 is worth nearly nothing.
  No new scoring concept is introduced: "answered early" and "answered fast" are
  the same measurement.
- `streakBonusFor(streak)` across consecutive correct rounds, as elsewhere.
- XP at score / 10, as every other mode.

## Streak, archive, share

- Daily streaks reuse `computeStreak(daysPlayed, today)` from `dailyLogic.js`
  unchanged.
- A Past Puzzles archive mirrors `DailyArchive`: any earlier day is replayable
  for practice and never ranked.
- The share grid uses the project's typographic glyphs, never emoji, following
  `dailyLogic.shareText`. Each round contributes one glyph showing how early it
  was solved, so the grid encodes skill rather than just pass/fail:

```
SNIPPET FOCUS #1 - 3450
█ ▓ ░ █ ▒
snippet-flock.vercel.app
```

Full block = solved at the blurriest step, descending shades for later steps,
hollow for missed. No track name appears, so nothing is spoiled.

## Storage

Focus gets its own tables, for the same reason Quartets would have: the existing
`daily_puzzles` table is one row per day and is live in production with real
data, so adding a discriminator would mean migrating a working system for no
benefit.

```sql
CREATE TABLE IF NOT EXISTS focus_puzzles (
  day TEXT PRIMARY KEY,
  rounds JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS focus_results (
  day TEXT NOT NULL,
  sub TEXT NOT NULL,
  score INT NOT NULL,
  answers JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (day, sub)
);
```

Both follow the existing storage module exactly: Postgres when `DATABASE_URL` is
set, an in-memory Map otherwise, first writer freezes the day, one result per
(day, sub) with the first completion winning. Guests play unranked and keep a
local streak; Google-verified players get one ranked run per day.

Generation is on demand and frozen, matching the existing daily.

## Wire protocol

New socket events, namespaced like the existing `daily:*`:

- `focus:status` -> `{ day, number, played, streak }`
- `focus:start` -> `{ day, number, round, options, stepMs, steps }` — no track
  name, no artist, no image URL beyond the proxied route
- `focus:answer` `{ option }` -> resolves the round, then reveals
- `focus:finish` -> `{ score, perRound, share, xp }`
- `focus:archive` -> past days, practice only

Identity resolution and rate limiting reuse the existing `resolveIdentity` and
`rateLimited` helpers.

## Client

- **Home:** a `focus` card replaces one placeholder. The `wordzic`, `lyricles`
  and `crosszic` placeholders are **removed entirely** in the same change: they
  are competitor product names (Wordzic is SongTrivia2's), they use none of our
  catalogue, and Lyricles is not buildable at all since the catalogue carries no
  lyric data.
- **Board:** the cover at the current step, rendered at a fixed size with
  `image-rendering: pixelated`; the existing staged timer bar; the four options
  in the existing option-button language.
- **Preloading:** all six steps of the current round are fetched before the
  round starts, so a step change is instant rather than a loading flash. The
  next round preloads during the reveal.
- **Reduced motion:** the step transition is a hard cut rather than a crossfade
  when `prefers-reduced-motion` is set.
- **Results:** score, per-round breakdown, share grid with copy-to-clipboard,
  streak and XP, following `DailyResults.jsx`.

## Testing

Pure logic in `focusLogic.js`, unit-tested without sockets or network:

- `stepForElapsed(elapsedMs)` — which ladder step is visible at a given time
- `buildFocusRounds({ getSongs, ... })` — five rounds, distinct genres, every
  track carrying artwork
- `scoreFocusAnswer({ isCorrect, elapsedMs, roundIndex, streak })`
- `focusShareText({ number, score, perRound })`
- `stepAllowed(sessionStep, requestedStep)` — the anti-cheat predicate

Required coverage: the ladder boundaries (elapsed 0, 2499, 2500, 14999, 15000+);
a round with no artwork is never built; scoring at the first and last step; an
unanswered round scores zero; the share grid contains no track name; and
`stepAllowed` refuses a step ahead of the session, which is the security
property the whole mode rests on.

End-to-end follows the knockout pattern: a real server and a real browser, one
full five-round run, plus an explicit assertion that requesting a step ahead of
session progress returns 403.

## Out of scope

- No multiplayer or room mode. Knockout fills the social slot.
- No audio. Adding the clip would make the artwork irrelevant.
- No free-text guessing. Four options keep the existing input surface.
