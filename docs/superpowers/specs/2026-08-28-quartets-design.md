# Quartets (audio Connections) — design

Status: approved design, ready for an implementation plan.
Date: 2026-08-28

## Summary

A daily solo puzzle: 16 song clips, 4 hidden groups of 4, sorted by ear. The
NYT Connections loop, except the tiles are audio rather than words. One puzzle
per UTC day, frozen so everyone plays the same board, four mistakes allowed, a
shareable spoiler-free result grid.

The mode is called **Quartets**. It cannot be called Harmonies: that is the
product name of a live game by SongTrivia, our closest competitor.

## Why this mode

Research (August 2026) found that the daily constraint is the retention
mechanic in this category: one puzzle a day, identical for everyone, with a
shareable grid. Without it players binge for a few days and churn.

Every adjacent idea is occupied. Timeline placement is taken (Hitster,
ChronoHits, Hitify, Timdle). Shrinking clips are taken (Songspot). Music Wordle
is taken (Wordzic, Spotle). Music Connections exists (Harmonies) but is
**text-only**: 16 words drawn from song titles, artist names, instruments, and
genres. Verified by reading the product.

Nobody has done Connections with audio. It is also the idea where our catalogue
is the moat rather than decoration: a word game needs no catalogue at all, which
is precisely why that space is full of clones.

## Feasibility, established by spike

A throwaway generator was run against the real 25,558-track catalogue before
this design was written.

- Fair puzzles generate reliably by rejection sampling: **46.7% of attempts**
  produce a valid puzzle with all quality gates enabled. No constraint solver is
  needed.
- The verifier rejected every unfair puzzle; none reached the output.
- Catalogue depth is sufficient: 562 artists have 4+ tracks (319 have 8+), and
  16,359 tracks belong to exactly one genre family.

The spike also proved that **fairness is the easy half**. Its first run was 100%
fair and still produced bad puzzles. The quality gates below all come from
observed failures, not speculation.

## Fairness rule

A puzzle is fair only if **every track satisfies exactly one group's rule**.

Group rules are predicates over a track:

- `ARTIST(artistId)` — `track.artistId === artistId`
- `GENRE(key)` — `track.genreKeys.includes(key)`
- `DECADE(bucket)` — the track's release decade equals the bucket

Since a Drake track is simultaneously *Drake*, *hip-hop*, and *2020s*, groups
must be chosen so their rules do not overlap on any selected track. Generation
picks candidate groups, selects only tracks matching one group and no other, and
then re-verifies the finished board before it is allowed to ship. A puzzle
failing verification is discarded and regenerated; it is never repaired.

This matters more than anything else in the mode: a puzzle that calls a
defensible grouping wrong is unforgivable, and unlike a wrong trivia answer the
player cannot even tell they were cheated.

## Quality gates

Each gate exists because the spike produced the failure it prevents.

1. **No duplicate songs.** The spike produced a group containing "Apologize"
   twice and "Up Jumps Da' Boogie" twice: different `trackId`, same song. Dedupe
   on `baseTitle`, which the catalogue already computes for exactly this purpose,
   across the whole board and not just within a group.
2. **Solo artist credits only for ARTIST groups.** The spike labelled a group
   "Mika Singh, Payal Dev, Neha Kakkar & Badshah". An ARTIST group's credit must
   contain no `&`, `,`, `feat`, `with`, or ` x `.
3. **At most one DECADE group per puzzle.** Decade is the weakest audio signal;
   a board leaning on it stops being a listening test.
4. **No dominant voice in a non-ARTIST group.** The spike produced a trap group
   with Lil Yachty on three of four tracks (once as primary, twice as a feature),
   which reads as an artist group and makes the board ambiguous in practice even
   though it passes the formal fairness check. The check must compare artist
   **names as substrings**, not `artistId`: featured credits carry different ids
   for the same audible performer.

## Tiles are audio-only

The 4x4 grid shows numbered tiles. **No track name, no artist, no artwork** on an
unsolved tile. Tapping a tile plays its clip; replay is unlimited and instant.

This is the decision the mode rests on. If tiles showed track names, grouping by
artist would become reading rather than listening, and the result would be
Harmonies with a soundtrack. Audio-only tiles are the entire differentiator.

**Known product risk, accepted deliberately:** 16 anonymous clips is a heavy
memory load. Connections works partly because words can be re-scanned instantly
and audio cannot. Mitigations are unlimited replay and preloading all 16 clips so
a replay is instantaneous. If real play proves it too hard, the fallback is an
opt-in "reveal titles" assist that forfeits the clean share result. Ship the pure
version first; do not pre-emptively weaken it.

A solved group reveals its four track names, artists, and its category label.
Unsolved tiles stay anonymous.

## Puzzle shape

Server-side truth:

```
{
  day: "YYYY-MM-DD",
  groups: [
    { id, type: "ARTIST"|"GENRE"|"DECADE", label, difficulty: 0..3, trackIds: [4] }
  ],
  tracks: [ 16 x { trackId, trackName, artistName, previewUrl, artworkUrl } ]
}
```

**Security: the client never receives group membership before it is solved.**
`quartets:start` sends 16 shuffled tiles carrying only `{ tileId, previewUrl }`.
Track names, artists, artwork, and grouping are disclosed per group, at the
moment that group is solved, and never before. This is the same discipline that
keeps `room.correct` server-only, and it is not optional: the grouping is the
answer.

Difficulty ordering approximates the NYT colour tiers: ARTIST groups are the
most recognisable and rank easiest, GENRE is middle, DECADE hardest. Difficulty
is an ordering for the share grid and the reveal, not a scoring input.

## Rules

- Select exactly 4 tiles, then submit.
- A correct group locks, reveals its label and its four tracks, and clears from
  the grid.
- A wrong guess costs one mistake. **Four mistakes ends the run**, revealing the
  remaining groups.
- When a wrong guess contains exactly 3 tiles of a single real group, the player
  is told "one away". Any other wrong guess gets no hint.
- Resubmitting a set already guessed does not cost a mistake; it is rejected as
  a repeat.
- Solving all four groups wins, whatever the mistake count.

## Scoring, streak, XP

- Base 1000 for a solved board, minus 150 per mistake, minus nothing for time.
  A failed board scores the value of the groups solved (250 each).
- Score converts to XP at score / 10, identical to every other mode, so a
  Quartets point is worth the same as a room point.
- Streaks reuse `computeStreak(daysPlayed, today)` from `dailyLogic.js`
  unchanged.

Time is deliberately not scored. The mode is a puzzle, not a speed test, and the
rest of the app already rewards speed everywhere else.

## Share grid

Four rows of four, in the order the player solved them, using the project's
typographic glyphs rather than emoji (existing rule; see `dailyLogic.shareText`).
The four shade blocks encode difficulty the way NYT's colours do:

```
SNIPPET QUARTETS #12 - 3/4
▓▓▓▓
░░░░
██▒█
snippet-flock.vercel.app
```

A row of mixed glyphs marks a wrong guess, showing which groups the player
confused without naming any track. Nothing in the grid spoils the answer.

## Storage

Quartets gets **its own tables**. The existing `daily_puzzles` table is keyed one
row per day and is live in production with real data; adding a `kind`
discriminator would mean migrating a working system for no benefit.

```sql
CREATE TABLE IF NOT EXISTS quartets_puzzles (
  day TEXT PRIMARY KEY,
  puzzle JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS quartets_results (
  day TEXT NOT NULL,
  sub TEXT NOT NULL,
  solved INT NOT NULL,          -- groups solved, 0..4
  mistakes INT NOT NULL,
  score INT NOT NULL,
  grid JSONB NOT NULL,          -- guess history, for the share grid
  created_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (day, sub)
);
```

Both follow the existing storage module's pattern exactly: a Postgres path when
`DATABASE_URL` is set, an in-memory Map fallback otherwise, first writer freezes
the day, and one result per (day, sub) with the first completion winning.

Generation is **on demand and frozen**: the first request for a day generates,
verifies, and saves; every later request reads the frozen row. Same model as the
existing daily. The first visitor of a day absorbs the generation cost, which
rejection sampling keeps small.

## Wire protocol

New socket events, namespaced like the existing `daily:*`:

- `quartets:status` -> `{ day, number, played, streak }`
- `quartets:start` -> `{ day, number, tiles: [{ tileId, previewUrl }] }` (16,
  shuffled; **no grouping**)
- `quartets:guess` `{ tileIds: [4] }` -> `{ correct, oneAway, mistakes,
  group?, remaining }` where `group` is disclosed only on a correct guess
- `quartets:finish` -> `{ solved, mistakes, score, groups, share, xp }`
- `quartets:archive` -> past days, replayable for practice, never ranked

Rate limiting and identity resolution reuse the existing `rateLimited` and
`resolveIdentity` helpers passed into `registerDaily`.

## Client

- **Home:** a `quartets` card replaces one placeholder. The `wordzic`,
  `lyricles`, and `crosszic` placeholders are **removed entirely** in the same
  change: they are competitor product names (Wordzic is SongTrivia2's), they use
  none of our catalogue, and Lyricles is not buildable at all since the
  catalogue carries no lyric data.
- **Board:** a 4x4 grid of numbered tiles in the existing refined-arcade
  register. Selected tiles are marked; the currently playing tile is marked
  distinctly. Solved groups stack above the grid with their label and tracks.
  Mistakes render as four pips that extinguish.
- **Audio:** all 16 clips preload; tapping a tile plays it and stops any other.
  Reuses the existing persistent `<audio>` element and the blob-based priming
  already in `App.jsx`.
- **Results:** solved/failed state, the share grid with copy-to-clipboard, the
  streak, and the XP award, following `DailyResults.jsx`.
- All motion respects `prefers-reduced-motion`.

## Testing

Pure logic in a new `quartetsLogic.js`, unit-tested without sockets:

- `buildPuzzle({ tracks, rand })` — deterministic under an injected RNG
- `verifyPuzzle(puzzle)` — the fairness gate
- `gradeGuess(puzzle, tileIds, alreadyGuessed)` — correct / one-away / repeat
- `scoreQuartets({ solved, mistakes })`
- `shareGrid({ number, solved, history })`

Required coverage: a track matching two rules fails verification; duplicate
`baseTitle` fails; a collaboration credit is rejected for an ARTIST group; a
second DECADE group is rejected; a dominant-voice genre group is rejected; a
guess with 3 of 4 reports one-away; a repeated guess costs no mistake; four
mistakes ends the run; scoring at each solved/mistake combination; the share
grid never contains a track name.

A generation soak test asserts that 200 consecutive puzzles built from the real
catalogue all pass `verifyPuzzle`, since the spike's whole value was showing
that unfairness is caught rather than assumed.

End-to-end coverage follows the knockout pattern: a real server, a real client,
one full solve and one full failure, run via `npm run test:e2e`.

## Out of scope

- No multiplayer or room mode. Knockout already fills the social slot, and the
  streak-plus-share loop is what makes this genre retain.
- No hand-authoring or curation path. Generation is automatic.
- No time scoring.
