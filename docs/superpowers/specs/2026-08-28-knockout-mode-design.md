# Knockout mode — design

Status: approved design, ready for an implementation plan.
Date: 2026-08-28

## Summary

A new multiplayer game format in which players are removed from the match as it
runs, until one remains. The host chooses between two knockout rules:

- **SLOWEST** — exactly one player is eliminated every round.
- **LIVES** — every player starts with 3 lives (4 in a 2-player duel); a wrong
  or missing answer costs one; a player is eliminated at zero. The Sweep rule
  guarantees every round costs somebody a life.

A knockout match has **no round limit**. It ends when one player is left
standing, never because a round counter ran out.

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
- Knockout does not add a separate duel format. A 2-player LIVES match is an
  ordinary LIVES match with fewer players.
- Knockout does not use `settings.rounds` at all. There is no round cap and no
  backstop ending.

## Settings

Knockout is a new axis, not a `MODE_CHOICES` value. `mode` describes the
question type (TITLE vs ARTIST) and stays orthogonal, so that Knockout can be
played with either question type.

Added to `gameLogic.js`:

```js
export const FORMAT_CHOICES = ["CLASSIC", "KNOCKOUT"];
export const KNOCKOUT_CHOICES = ["SLOWEST", "LIVES"];
export const KNOCKOUT_LIVES = 3;
export const KNOCKOUT_LIVES_DUEL = 4; // 2-player matches start with more
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

Every alive player starts with `livesFor(startingPlayers)`: `KNOCKOUT_LIVES` (3)
normally, `KNOCKOUT_LIVES_DUEL` (4) when the match starts with exactly two
players. The count is fixed at `startGame` and never changes mid-match. A wrong
answer or a missing answer costs one life. A player reaching zero lives is
eliminated at the end of that round.

Multiple players may be eliminated in the same round. If every remaining alive
player reaches zero in the same round, they are all eliminated together and the
one with the highest score is awarded 1st place; the rest take the placements
below it, ordered by score. There is no draw state.

#### The Sweep rule

Plain LIVES has a stalemate failure mode: when every alive player answers
correctly, no life is lost and the round changed nothing. With no round cap this
is not merely a dull stretch, it is an unbounded match. Three strong players
could run indefinitely. Adding lives makes this worse, not better.

So: **if a round would cost nobody a life, the slowest correct player loses
one.**

The rule fires only on a clean sweep, when every alive player answered
correctly. Any round in which somebody was wrong or absent has already made
progress and is left untouched, so the mode keeps its forgiving feel during
normal play.

Three properties matter:

1. **Termination without a cap.** Every round removes at least one life from the
   board, so the match is bounded by the total lives in play: at most
   `startingPlayers x lives - 1` rounds, the case where every round costs
   exactly one life and the survivor finishes on their last one. An 8-player
   match is bounded at 23 rounds and a 2-player duel at 7, by the mechanics
   rather than by a counter. The match always ends because somebody won.
2. **One rule, not a rule plus an endgame exception.** It applies identically at
   every player count, including two, so there is no separate duel or
   final-two case to explain or test.
3. **Self-scaling pressure.** With many players alive, somebody is usually
   wrong, so Sweep rarely fires. It bites exactly when the field is small and
   stubborn, which is when the match needs pressure.

It reuses the SLOWEST speed comparison already specified above, so it introduces
no new concept for players.

SLOWEST needs none of this. Exactly one player leaves per round, so an N-player
match is always N-1 rounds, bounded by construction.

Players inside the rejoin grace window need no special handling. A held player
already scores as "no answer", which means the round was not a clean sweep and
Sweep does not fire. A network blip therefore never triggers the rule.

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

Knockout ends when, and only when, one alive player remains. That player wins.

There is **no round cap**. `settings.rounds` is ignored entirely under knockout:
a match that reaches round 18 with three players still fighting keeps going.
Ending a knockout on a counter would cut a live fight short and produce a winner
nobody earned.

Termination is guaranteed by the rules rather than by a limit. SLOWEST removes
exactly one player per round. LIVES removes at least one life per round via the
Sweep rule. Neither can run forever.

The existing empty-room and all-disconnected paths are unchanged.

## Scoring under knockout

Question value escalates as `QUESTION_BASE + roundIndex * QUESTION_STEP`. With no
round cap that climbs without limit: a 23-round match would reach 5,800 points
for a single question, making round 2 worth roughly 4% of round 20 and awarding
several times the XP of any other mode (XP is score / 10).

Under KNOCKOUT the question value therefore **plateaus after round 10** and holds
flat at 2,550 for every later round. The ramp still shapes a normal-length match,
the runaway stops, and a knockout point stays comparable to a classic point so XP
is consistent across formats.

Knockout does not need the ramp for drama in any case: placement carries the
story, and being knocked out at round 3 versus round 18 is already the
difference that matters.

Speed bonuses, streak bonuses, and XP conversion are otherwise unchanged.

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

With no round cap, the sizing driver is the Sweep rule's bound rather than
`settings.rounds`: at most `startingPlayers x lives - 1` rounds, so 23 for a
full 8-player LIVES room, needing roughly 35 tracks. That sits under the existing 60
ceiling. A 2-player duel is bounded at 7 rounds and needs no special handling.

`poolSizeFor` gains a knockout branch that sizes from the worst-case round count
for the chosen rule and player count, still clamped by the existing upper bound
so the fetcher is never hammered. `maybeRefreshPool` remains as the safety net.

## Guards

- The minimum player count depends on the rule, checked at `startGame`:
  **SLOWEST requires 3**, because a 2-player SLOWEST match ends after a single
  round and does not read as a game. **LIVES requires 2**, since the Sweep rule
  makes a duel terminate cleanly. The lobby states which combination is blocked
  and why, and the server enforces both independently.
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
swept: boolean                          // LIVES only: this round was a clean
                                        // sweep, so Sweep took a life
```

`publicState.totalRounds` is `null` under knockout, since no total exists. The
client renders a bare round number plus a players-remaining count instead of
"Round 3 / 10".

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
selected, a second control appears offering Slowest out / Lives, along with the
minimum-player notice for whichever rule is selected (3 for Slowest, 2 for
Lives). The rounds picker is **hidden** under Knockout rather than disabled,
since it controls nothing in that format. Both follow the existing option-toggle pattern and
both values are re-validated server-side.

**Playing.** The player list shows lives under LIVES, and marks who is at risk.
Eliminated players are visibly out rather than absent. The header shows the
round number and players remaining, with no total, because a knockout has no
known length. When a round resolves by Sweep the reveal says so, since "everyone
was right, so the slowest lost a life" must never look like an unexplained
penalty.

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
- `applyLives(players, roundOutcomes)` for LIVES, including Sweep
- `livesFor(startingPlayers)`
- `minPlayersFor(settings)`
- `placementFor(startingCount, alreadyEliminated, batch)`
- extended `sanitizeSettings` and `poolSizeFor`

Unit tests go in `test/gameLogic.test.js` and must cover: exactly one
elimination per SLOWEST round; a correct-but-slowest elimination; the all-wrong
round; deterministic tie-breaking; simultaneous LIVES eliminations; the
all-remaining-players-hit-zero case; placement ordering across several rounds;
settings sanitisation of bad `format`/`knockout` values; and knockout pool
sizing at the 8-player LIVES worst case.

Sweep specifically must cover: a clean-sweep round costing the slowest correct
player a life at three, four, and two alive players; a round with any wrong
answer leaving Sweep dormant; a held player's missing answer keeping Sweep
dormant; a match terminating within `startingPlayers x lives - 1` rounds; `livesFor`
returning 4 at two players and 3 above; and `minPlayersFor` blocking 2-player
SLOWEST while allowing 2-player LIVES.

Scoring must cover the knockout question-value plateau: identical to classic
through round 10, flat at 2,550 from round 11 onward, and unchanged under
CLASSIC at every round.

The socket path (elimination broadcast, guess rejection, mid-match disconnect,
rematch reset) is verified by a manual multi-tab run before deploy, as with
previous waves.

## Follow-on, explicitly out of scope

The remaining Home placeholders (Wordzic, Lyricles, Crosszic) are untouched.
Lyricles in particular is not currently buildable: the catalogue carries no
lyric data.
