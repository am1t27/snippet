# Snippet — multiplayer music guessing game

A real-time, server-authoritative music guessing game. Listen to a short song
snippet, pick the right track from four options — faster answers score more.

Play it now! [snippet-flock.vercel.app/](https://snippet-flock.vercel.app/)

## Stack
- **Server** — Node.js + Socket.IO (`server.js`), iTunes preview API (`itunesFetcher.js`)
- **Client** — React + Vite + Tailwind (`client/`)

## How it works
- Single room, up to 8 players, 10 rounds.
- State machine: `LOBBY → ROUND_PLAYING → ROUND_REVEAL → GAME_OVER`.
- The **server is the only source of truth**: it holds the correct answer, runs
  the round clock, validates guesses, and computes every score. The correct
  answer is never sent to clients during a round.
- **Scoring**: escalating question value (`300 + roundIndex * 250`) plus a linear
  speed bonus (max 350). Settled only after the round ends.
- **Audio**: 30s iTunes previews, played from a random offset, stopped after 10s
  client-side.

## Premium arcade UI

Refined-arcade design system: fluid display type, cascade screen choreography,
springy buttons, glow washes and film grain, staged timer (amber, orange, red),
a live WebAudio waveform that dances with each clip, album-art reveal cards,
and an XP / level / rank progression (CADET through LEGEND) with a level-up
celebration. Everything respects prefers-reduced-motion.

## Daily challenge

One frozen 5-song puzzle per UTC day (mixed genres), playable solo by anyone.
Guests keep a local streak; Google-verified players get one ranked run per day
on a global per-day leaderboard (first completion wins, timed by the server
clock). Puzzle rows and results persist in Postgres when DATABASE_URL is set;
without it the puzzle lives in memory per boot and nothing is ranked.
Extras: a Past Puzzles archive (replay any frozen day, practice only) and a
ghost race - today's #1 player's answer timings pace your ranked run.

## Knockout

A multiplayer format where players are removed from the match as it runs. It
ends when one player is left standing, never on a round counter: `settings.rounds`
is ignored entirely, so a match at round 18 with three people still fighting
keeps going. The host picks one of two rules.

**Slowest out** eliminates exactly one player every round. Results rank correct
before wrong before absent, and speed separates only correct answers, so
answering wrong quickly earns nothing. Ties resolve by score then join order, so
elimination is never random. Being right is not enough if you were the slowest.
Needs 3 players (a 2-player match would end in one round).

**Lives** gives everyone 3 lives, or 4 in a 2-player duel. A wrong or missing
answer costs one. The **Sweep** rule closes the stalemate hole: if a round would
cost nobody a life, the slowest correct player loses one. Every round therefore
removes at least one life, which is what lets the mode run uncapped and still
terminate, inside `startingPlayers x lives - 1` rounds. Needs 2 players.

Eliminated players keep their score, their leaderboard row, their XP, and their
host eligibility; they only lose the ability to guess. Final standings sort by
placement, not score. Question value plateaus after round 10 under knockout so a
long match cannot inflate XP against the other modes.

## Run it
```bash
# 1. game server (port 3000)
node server.js

# 2. client (port 5173) — Vite proxies /socket.io to :3000
cd client && npm install && npm run dev
```

Open http://localhost:5173 in two tabs to play with a friend.

```bash
npm test        # unit suite
npm run test:e2e  # spawns a real server and plays real matches (slow)
```
