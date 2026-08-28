# Knockout mode — design

Status: approved design, ready for an implementation plan.
Date: 2026-08-28

## Summary

A new multiplayer game format in which players are removed from the match as it
runs, until one remains. The host chooses between two knockout rules:

- **SLOWEST** — exactly one player is eliminated every round.
- **LIVES** — every player starts with 3 lives; a wrong or missing answer costs
  one; a player is eliminated at zero.

Knockout reuses the existing round loop, scoring maths, audio pipeline, and
reveal cadence. It changes who may answer, when the game ends, and how the final
leaderboard is ordered. It does not change how points are earned.

## Why this mode

Research into the current market (August 2026) found that every common music
quiz mechanic already has an owner: HumHigh ships decade guessing, album-art
unblurring, and humming modes; SongTrivia2 ships four-option multiple choice
with genre themes; ChronoHits, Hitify, and Year to Beat ship year-timeline
placement; the physical game Hitster owns the timeline mechanic outright.

Battle-royale trivia is proven in the general trivia category (Quizelo,
Jackbox's Trivia Murder Party) but no music-specific web implementation was
found. Snippet already has the two things such a mode requires and competitors
lack: real-time server-authoritative rooms, and a catalogue with genre families
(Bollywood, drill, trap as separate scenes) that no competitor carries.

Mode novelty is a weak moat on its own. The combination of knockout plus those
genre families is the differentiated product.

## Terminology

- **Alive** — a non-spectator player who has not been eliminated.
- **Eliminated** — removed from answering, but still present, still holding
  their score, their placement, their XP eligibility, and their host
  eligibility.
- **Placement** — final finishing position, 1 for the winner.

## Non-goals

- Knockout does not change point values, speed bonuses, or streak bonuses.
- Knockout does not introduce a new game phase.
- Knockout does not apply to the daily challenge, which stays solo.
- Leftover lives are worth nothing at game over. Score alone separates
  survivors, so a knockout point is worth exactly the same as a classic point
  and XP stays consistent across formats.

## Settings

Knockout is a new axis, not a `MODE_CHOICES` value. `mode` describes the
question type (TITLE vs ARTIST) and stays orthogonal, so that Knockout can be
played with either question type.

Added to `gameLogic.js`:

```js
export const FORMAT_CHOICES = ["CLASSIC", "KNOCKOUT"];
export const KNOCKOUT_CHOICES = ["SLOWEST", "LIVES"];
export const KNOCKOUT_LIVES = 3;
```

`DEFAULT_SETTINGS` gains `format: "CLASSIC"` and `knockout: "SLOWEST"`.
`sanitizeSettings` validates both through the existing `pick` helper, so an
unknown value degrades to the default rather than erroring. `knockout` is
retained and validated even under `CLASSIC`, where it is simply unused; this
keeps the settings object a fixed shape.

## Elimination rules

### SLOWEST

Exactly one player is eliminated per round, without exception. Round results are
ranked by a single ordering, best to worst:

1. Correct answers, ordered by ascending `elapsedMs`.
2. Wrong answers.
3. No answer submitted.

The last-ranked alive player is eliminated. Ties are broken by lower total
score, then by later join order (the insertion order of `room.players`), so the
outcome is fully deterministic and never random.

Consequence: a room of N players runs exactly N-1 rounds. A full room of 8 runs
7 rounds. The characteristic moment of this rule is being eliminated despite
answering correctly, because someone else was faster.

### LIVES

Every alive player starts with `KNOCKOUT_LIVES` (3). A wrong answer or a missing
answer costs one life. A player reaching zero lives is eliminated at the end of
that round.

Multiple players may be eliminated in the same round. If every remaining alive
player reaches zero in the same round, they are all eliminated together and the
one with the highest score is awarded 1st place; the rest take the placements
below it, ordered by score. There is no draw state.

## Placement

Placements are assigned on elimination, counting down from the number of players
who started the match. In an 8-player match the first player eliminated takes
8th, and the final survivor takes 1st.

When several players are eliminated in the same round, they occupy the
contiguous block of placements at the bottom of the remaining range, ordered
among themselves by score (higher score takes the better placement).

The knockout final leaderboard is ordered by placement. Score is displayed but
is not the sort key.

## Game end

- Knockout ends as soon as one alive player remains.
- `settings.rounds` becomes a backstop cap rather than the driver of length. If
  the cap is reached with more than one player still alive (only reachable under
  LIVES), the match ends and survivors are placed by score.
- The existing empty-room and all-disconnected paths are unchanged.

## Player state

`makePlayer` gains four fields:

| Field | Meaning |
|---|---|
| `eliminated` | `false` until knocked out |
| `eliminatedRound` | round number of elimination, else `null` |
| `placement` | final position, assigned on elimination or at game over, else `null` |
| `lives` | remaining lives under LIVES; unused under SLOWEST and CLASSIC |

### `spectator` must not be reused

`p.spectator` currently carries five meanings at once: cannot guess, cannot
score, excluded from the round leaderboard (`server.js` round scoring), excluded
from the game-over leaderboard, denied XP, and ineligible to be host. An
eliminated player must retain all of those except the ability to guess.
Overloading `spectator` would silently erase eliminated players from the
leaderboard and deny them XP.

Therefore `eliminated` is a separate flag, and every existing `!p.spectator`
filter is audited individually:

| Site | Behaviour with eliminated players |
|---|---|
| `allGuessed` | must ignore them, so they never block a round from ending |
| `guess` handler | must reject their guesses, with a distinct message |
| round scoring | must still include them, holding their final score |
| game-over leaderboard | must include them, ordered by placement |
| XP award loop | must still award them |
| host transfer | must still consider them eligible |
| rematch reset | must clear `eliminated`, `placement`, and `lives` |

## Pool sizing

`poolSizeFor` currently derives from `settings.rounds`. Knockout changes the
real round count:

- SLOWEST runs at most `players - 1` rounds, which is never more than 7 and is
  therefore cheaper than the current default of 10.
- LIVES runs at most `(players - 1) * KNOCKOUT_LIVES` rounds, up to 21 for a
  full room, which exceeds the pool the current formula would build.

`poolSizeFor` gains a knockout branch that sizes from the worst-case round count
for the chosen rule and player count, still clamped by the existing upper bound
so the fetcher is never hammered. `maybeRefreshPool` remains as the safety net.

## Guards

- Knockout requires at least 3 alive players at `startGame`. With 2 players,
  SLOWEST would end after a single round, which does not read as a game. The
  lobby states the requirement and the server enforces it.
- A player who disconnects mid-knockout is eliminated with a real placement in
  `finalizeLeave`, rather than disappearing from the standings.
- If disconnections reduce the room to one alive player mid-match, the match
  ends normally with that player as the winner.

## Wire format

No new socket events. Two existing payloads are extended.

`publicState` players gain:

```
eliminated: boolean
lives: number | null      // null unless format is KNOCKOUT with rule LIVES
placement: number | null
```

The `reveal` payload gains:

```
eliminated: [{ id, name, placement }]   // empty array in CLASSIC
format: "CLASSIC" | "KNOCKOUT"
knockout: "SLOWEST" | "LIVES"
livesLeft: [{ id, lives }]              // omitted unless rule is LIVES
```

`REVEAL_MS` is 3000ms, which is too short to land an elimination. Knockout
reveals hold longer via a separate constant so the knocked-out player has time
to read the result.

Security posture is unchanged: nothing added here discloses the correct answer
before the round is over.

## Client

**Home hub.** A `knockout` card is inserted after `create` in the `GAMES` array
in `client/src/screens/Home.jsx`, **replacing the `harmonies` placeholder**.
Harmonies is the vaguest of the four "soon" entries, and removing it keeps the
grid at 8 cards with the playable block contiguous. `openGame` carries a format
preference into the lobby the same way `clipPref` is carried today.

**Lobby.** A host-only Format control (Classic / Knockout). When Knockout is
selected, a second control appears offering Slowest out / 3 lives, along with
the 3-player minimum notice. Both follow the existing option-toggle pattern and
both values are re-validated server-side.

**Playing.** The player list shows lives under LIVES, and marks who is at risk.
Eliminated players are visibly out rather than absent.

**Reveal.** The elimination callout is the shareable beat of this mode and gets
real design weight, in the existing refined-arcade register: typographic glyphs,
no emoji, respecting `prefers-reduced-motion`.

**GameOver.** Knockout renders a placement-ordered result with the survivor
called out as the winner, instead of the score-ordered classic leaderboard.

## Testing

All decision logic is added to `gameLogic.js` as pure functions, matching how
that file already isolates logic from sockets and timers:

- `rankRoundResults(players, guesses, correct, roundMs)`
- `pickEliminated(ranked)` for SLOWEST
- `applyLives(players, roundOutcomes)` for LIVES
- `placementFor(startingCount, alreadyEliminated, batch)`
- extended `sanitizeSettings` and `poolSizeFor`

Unit tests go in `test/gameLogic.test.js` and must cover: exactly one
elimination per SLOWEST round; a correct-but-slowest elimination; the all-wrong
round; deterministic tie-breaking; simultaneous LIVES eliminations; the
all-remaining-players-hit-zero case; placement ordering across several rounds;
settings sanitisation of bad `format`/`knockout` values; and knockout pool
sizing at the 8-player LIVES worst case.

The socket path (elimination broadcast, guess rejection, mid-match disconnect,
rematch reset) is verified by a manual multi-tab run before deploy, as with
previous waves.

## Follow-on, explicitly out of scope

The remaining Home placeholders (Wordzic, Lyricles, Crosszic) are untouched.
Lyricles in particular is not currently buildable: the catalogue carries no
lyric data.
