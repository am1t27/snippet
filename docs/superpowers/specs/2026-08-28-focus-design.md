# Focus (blurred cover art) — design

Status: approved design, ready for an implementation plan.
Date: 2026-08-28

## Summary

A room game mode played by eye instead of ear. Instead of a clip, each round
shows the album cover starting as an unreadable block of colour and sharpening
across the round. The options, the timer, the scoring and the reveal are
unchanged; only the clue changes.

The mode is called **Focus**. It is a **multiplayer game mode, not a daily
puzzle** — the standing rule for this project is that new modes are game modes.
The existing daily challenge is untouched by this work.

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

## Settings axis

Focus is a third orthogonal axis, following the pattern Knockout established:

| Axis | Meaning | Values |
|---|---|---|
| `mode` | what you name | TITLE, ARTIST |
| `format` | match structure | CLASSIC, KNOCKOUT |
| **`clue`** | **what you are given** | **AUDIO, COVER** |

All three compose. Focus works with title or artist naming, and inside a classic
match or a knockout. `clip` (RANDOM/INTRO) becomes meaningless under COVER and
is hidden in the lobby, exactly as `rounds` is hidden under knockout.

Adding `clue` to `sanitizeSettings` does not reach the daily challenge: `daily.js`
builds rounds with its own settings object and never consults this field.

## The reveal ladder

Six steps spread across the round, so the ladder tracks the host's chosen timer
(7.5s, 10s or 15s) rather than assuming a fixed length:

```
8px -> 14px -> 24px -> 44px -> 90px -> 300px
```

Step index is `floor(elapsedMs / (roundMs / 6))`, clamped to the last step. At
the default 10s round each step lasts about 1.7 seconds.

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
GET /art/:token/:step
```

`token` is an unguessable random id minted per round and delivered only to the
players in that room, via `roundStart`. The server maps it to the round's track.
Room codes are deliberately not used in the route: they are short and were the
subject of an earlier enumeration fix, so they must not become an image key.

The route:

- resolves the token to `{ room, round, artworkUrl }`, server-side
- **refuses any `step` beyond what the round clock allows**, returning 403.
  The bound is `stepForElapsed(Date.now() - room.roundStartedAt, roundMs)`. This
  is the actual protection; without it the route is just a slower version of the
  same hole. The server already owns `roundStartedAt`, so no per-player
  progress state is needed.
- refuses a token whose round is over or whose room no longer exists
- streams the image from the host at the size for that step
- caches fetched images in memory, keyed by `trackId:step`, bounded and evicted,
  so the host is hit at most once per image

Tokens are dropped when the round ends, so a token can never be replayed against
a later round.

**Under COVER the server must not send `audioUrl` at all.** Sending it would
hand the player the answer through the other sense and defeat the entire mode.

This is the same posture as the rest of the codebase: the server is the only
source of truth, and the answer never reaches the client early.

## Round rules

Everything here is the existing round loop, unchanged:

- Host-chosen round count, timer, option count, genre and era, as today.
- Options are track titles or artist names per `mode`.
- One guess per player per round, as today.
- Not answering scores zero for that round, as today.
- The correct answer and the full cover are revealed after the round resolves,
  never before.

The only new rule: **the pool is restricted to tracks that carry artwork** when
`clue` is COVER. Coverage is currently 100%, so this is a guard against a future
thin ingest rather than a live constraint, and it fails loudly (the existing
"not enough songs for these settings" path) rather than showing a blank tile.

## Scoring

Deliberately reuses the existing maths so a Focus point is worth exactly what a
room point or a daily point is worth:

- `questionValueFor(roundIndex, format)` for the base value, exactly as today,
  including the knockout plateau when the two modes are combined.
- `speedBonusFor(elapsedMs, roundMs)` for the earliness bonus, unchanged.
  Answering at step 1 is worth close to the full bonus; answering at step 6 is
  worth nearly nothing. **No new scoring concept is introduced**: "answered
  early" and "answered fast" are already the same measurement.
- `streakBonusFor(streak)` across consecutive correct rounds, as elsewhere.
- XP at score / 10, as every other mode.

## Wire protocol

No new socket events and no new phase. Two existing payloads are extended:

- `publicState` gains `clue`, and under COVER sets `audioUrl` to `null`.
- `roundStart` gains `artToken` and `artSteps` under COVER.

`reveal` already carries `track.artworkUrl`, so the full-resolution reveal needs
no change at all.

## Storage

None. Focus adds no tables and no persistence. It is a match setting, so it is
recorded in the existing match history and leaderboard exactly like genre or era.

## Client

- **Home:** a `focus` card, presetting `clue: COVER`, the way the Knockout card
  presets its format. The `wordzic`, `lyricles` and `crosszic` placeholders are
  **removed entirely** in the same change: they are competitor product names
  (Wordzic is SongTrivia2's), they use none of our catalogue, and Lyricles is
  not buildable at all since the catalogue carries no lyric data.
- **Lobby:** a Clue toggle (Audio / Cover), host only. The Clip row is hidden
  under COVER since it controls nothing there.
- **Playing:** under COVER the waveform and audio are replaced by the cover at
  the current step, rendered at a fixed size with `image-rendering: pixelated`.
  The staged timer bar and the option buttons are unchanged. The audio element
  is never pointed at a source, so nothing plays.
- **Preloading:** the round's later steps are fetched during the countdown so a
  step change is instant rather than a loading flash.
- **Reduced motion:** the step change is a hard cut rather than a crossfade when
  `prefers-reduced-motion` is set.

## Testing

Pure logic in `focusLogic.js`, unit-tested without sockets or network:

- `ART_STEPS` — the ladder, exported so client and server cannot drift
- `stepForElapsed(elapsedMs, roundMs)` — which ladder step is visible
- `artUrlForStep(artworkUrl, step)` — host URL substitution, server-side only
- `stepAllowed(elapsedMs, roundMs, requestedStep)` — the anti-cheat predicate
- extended `sanitizeSettings` for `clue`

Required coverage: ladder boundaries at each of the three legal round lengths
(7.5s, 10s, 15s), including elapsed 0, the exact step boundary, and past the
end; `artUrlForStep` substituting only the size segment; settings sanitisation
of a bad `clue`; and **`stepAllowed` refusing a step ahead of the clock**, which
is the security property the whole mode rests on.

End-to-end follows the knockout pattern: a real server and a real browser
playing a Focus match, plus explicit assertions that `audioUrl` is null under
COVER and that requesting a step ahead of the round clock returns 403.

## Out of scope

- **No daily variant.** New modes are game modes in this project. The existing
  daily challenge is not touched.
- No audio under COVER. Sending the clip would make the artwork irrelevant and
  hand over the answer.
- No free-text guessing. Four options keep the existing input surface.
- No new phase, no new tables, no new socket events.
