// Server-authoritative multiplayer music guessing game — MULTI-ROOM.
//
// Each room (4-char code) is an isolated game with its own state, players, and
// timers. The server is the only source of truth: it holds the correct answer,
// runs the round clock, validates guesses, and computes every score. The
// correct answer is NEVER sent to clients while a round is live.

import http from "node:http";
import { randomUUID, timingSafeEqual, createHash } from "node:crypto";
import { Server } from "socket.io";
import { getSongs } from "./songProvider.js";
import { initCatalog, catalogStats } from "./catalog/store.js";
import { scheduleIngest, runIngest, ingestRunning } from "./catalog/ingest.js";
import { OAuth2Client } from "google-auth-library";
import { maskProfanity } from "./profanity.js";
import {
  DEFAULT_SETTINGS,
  MAX_SPEED_BONUS,
  sanitizeSettings,
  poolSizeFor,
  cleanName,
  buildRound,
  questionValueFor,
  speedBonusFor,
  streakBonusFor,
  minPlayersFor,
  livesFor,
  pickEliminated,
  applyLives,
  placementFor,
} from "./gameLogic.js";
import { ART_STEPS, stepAllowed, artUrlForStep } from "./focusLogic.js";
import { log } from "./log.js";
import { initStorage, recordMatch, topScores, addXp } from "./storage.js";
import { awardFor } from "./xpLogic.js";
import { registerDaily } from "./daily.js";

// ----- Configuration -----
const PORT = process.env.PORT || 3000;
const IS_PROD = process.env.NODE_ENV === "production";
// Comma-separated allowlist of client origins (e.g. your Vercel URL). "*" in dev
// only. In production an unset allowlist fails CLOSED (no cross-origin allowed)
// instead of defaulting to "*", so a misconfigured deploy can't be embedded and
// driven by arbitrary sites.
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN
  ? process.env.CLIENT_ORIGIN.split(",").map((s) => s.trim())
  : IS_PROD
  ? []
  : "*";
// Abuse caps (env-overridable). Bound total rooms and connections-per-IP so a
// flood of sockets can't exhaust memory (createRoom/quickPlay each open a room).
const MAX_ROOMS = Number(process.env.MAX_ROOMS) || 500;
const MAX_CONN_PER_IP = Number(process.env.MAX_CONN_PER_IP) || 30;
const MAX_PLAYERS = 8;
const MAX_SPECTATORS = 16; // watchers allowed per room (don't count toward MAX_PLAYERS)
const REJOIN_GRACE_MS = 60000; // hold a disconnected player's slot this long mid-game
const REVEAL_MS = 3000; // pause on the reveal screen before next round
const KNOCKOUT_REVEAL_MS = 4500; // longer hold: an elimination needs to land
const EARLY_END_GRACE_MS = 3000; // keep the clip playing this long after everyone answers
// Chat + reactions. Reactions are a fixed whitelist of arcade-style call-outs
// (typographic, not emoji — keeps the §12 design rule) floated over the game.
// Match settings, scoring, and round-building live in ./gameLogic.js (imported
// above) so they can be unit-tested without a running server.
const REACTIONS = ["GG", "WOW", "!!", "??", "★", "♥"];
const CHAT_MAX_LEN = 200;

// Shared secret for the manual catalog refresh (POST /catalog/refresh). Unset
// (the default) disables the route entirely — see the handler.
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || "";

// Google OAuth (optional). If GOOGLE_CLIENT_ID is unset, sign-in is disabled and
// everyone plays as a guest.
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || "";
const oauthClient = GOOGLE_CLIENT_ID ? new OAuth2Client(GOOGLE_CLIENT_ID) : null;

// ----- Game phases -----
const PHASE = {
  LOBBY: "LOBBY",
  ROUND_PLAYING: "ROUND_PLAYING",
  ROUND_REVEAL: "ROUND_REVEAL",
  GAME_OVER: "GAME_OVER",
};

// ----- Rooms registry: code -> room state -----
const rooms = new Map();

// Focus art tokens: an unguessable id per round, handed only to the players in
// that room. The room CODE is deliberately not used as an image key - codes are
// short and were the subject of an earlier enumeration fix.
const artTokens = new Map(); // token -> { code, round, artworkUrl, trackId }
// Fetched cover bytes, keyed trackId:step. Small and bounded: a round needs at
// most six entries and each is a few KB.
const artCache = new Map();
const ART_CACHE_MAX = 240;

function dropArtToken(room) {
  if (room.artToken) artTokens.delete(room.artToken);
  room.artToken = null;
}

function mintArtToken(room, artworkUrl, trackId) {
  dropArtToken(room);
  const token = randomUUID();
  artTokens.set(token, { code: room.code, round: room.round, artworkUrl, trackId });
  room.artToken = token;
  return token;
}

// Codes use an unambiguous alphabet (no 0/O/1/I/L).
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
function makeCode() {
  let code;
  do {
    code = Array.from({ length: 4 }, () => CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)]).join("");
  } while (rooms.has(code));
  return code;
}

function makeRoom(code) {
  return {
    code,
    phase: PHASE.LOBBY,
    round: 0,
    loading: false,
    pool: [],
    usedTrackIds: new Set(),
    audioUrl: null,
    options: [],
    correct: null, // SERVER-ONLY — the gradable answer (title or artist)
    roundStartedAt: 0,
    guesses: new Map(), // socketId -> { option, elapsedMs }
    settings: { ...DEFAULT_SETTINGS }, // host-chosen, validated at startGame
    pending: null, // next round's data, held during the countdown
    correctArtist: null,
    correctTrackName: null,
    history: [], // { trackName, artistName, winner }
    players: new Map(), // socketId -> player
    timers: { round: null, reveal: null, countdown: null },
    refreshing: false,
    isPublic: false, // listed for quick-play matchmaking
    // Knockout bookkeeping. startingPlayers freezes the field size at kickoff
    // so placements stay stable as people are eliminated.
    knockout: { startingPlayers: 0, eliminatedCount: 0 },
    artToken: null, // Focus: current round's opaque art token
    disconnectGrace: new Map(), // rejoin token -> grace timeout
  };
}

// A stable per-session token lets a player rejoin after a disconnect with their
// score intact (socket ids change on reconnect, this does not).
function makeToken() {
  return randomUUID();
}

function makePlayer(id, name) {
  return {
    id,
    name,
    google: false,
    email: null, // SERVER-ONLY, never broadcast
    sub: null, // SERVER-ONLY Google subject id
    picture: null, // public Google avatar URL (safe to broadcast), or null
    token: null, // SERVER-ONLY rejoin token (never broadcast)
    connected: true, // false while held during the rejoin grace window
    spectator: false, // joined mid-game; watches, cannot guess or score
    score: 0,
    streak: 0,
    hasGuessed: false,
    lastRoundScore: 0,
    lastCorrect: false,
    // Knockout. `eliminated` is deliberately NOT `spectator`: an eliminated
    // player keeps their score, their leaderboard row, their XP, and their
    // host eligibility, and only loses the ability to guess.
    eliminated: false,
    eliminatedRound: null,
    placement: null,
    lives: 0,
  };
}

function roomOf(socket) {
  const code = socket.data && socket.data.roomCode;
  return code ? rooms.get(code) || null : null;
}

function deleteRoom(room) {
  clearTimers(room);
  rooms.delete(room.code);
}

// Per-socket sliding-window rate limiter. Returns true if the action should be
// DROPPED (limit exceeded). Used for chat/reactions/connection abuse.
function rateLimited(socket, key, max, windowMs) {
  const now = Date.now();
  socket.data.rl = socket.data.rl || {};
  const hits = (socket.data.rl[key] || []).filter((t) => now - t < windowMs);
  if (hits.length >= max) {
    socket.data.rl[key] = hits;
    return true;
  }
  hits.push(now);
  socket.data.rl[key] = hits;
  return false;
}

// Best-effort client IP for per-IP connection caps. Honors X-Forwarded-For
// (first hop) when set, since the server usually sits behind a proxy/CDN.
function ipOf(socket) {
  const fwd = socket.handshake.headers["x-forwarded-for"];
  if (fwd) return String(fwd).split(",")[0].trim();
  return socket.handshake.address || "unknown";
}
// Same idea for plain HTTP requests (admin route logging).
function ipOfRequest(req) {
  const fwd = req.headers["x-forwarded-for"];
  if (fwd) return String(fwd).split(",")[0].trim();
  return (req.socket && req.socket.remoteAddress) || "unknown";
}

// Constant-time bearer-token check for the admin route. Compares over fixed-
// length digests so neither the token's length nor its content leaks through
// response timing; timingSafeEqual itself throws on length mismatch.
function adminAuthorized(req) {
  const header = req.headers.authorization || "";
  const presented = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!presented) return false;
  const a = createHash("sha256").update(presented).digest();
  const b = createHash("sha256").update(ADMIN_TOKEN).digest();
  return timingSafeEqual(a, b);
}

// Live connection count per IP (incremented on connect, decremented on disconnect).
const connectionsByIp = new Map();

// ----- Membership helpers -----

function playerCount(room) {
  let n = 0;
  for (const p of room.players.values()) if (!p.spectator) n++;
  return n;
}
function isKnockout(room) {
  return room.settings.format === "KNOCKOUT";
}

// Players still in the fight: not spectating, not eliminated. Disconnected
// players still count as alive while inside their rejoin grace window.
function alivePlayers(room) {
  return [...room.players.values()].filter((p) => !p.spectator && !p.eliminated);
}

function aliveCount(room) {
  return alivePlayers(room).length;
}

// Final standings. Knockout is decided by placement, not score: anyone without
// a placement (a match ended early) falls behind those who have one, by score.
// Shared by gameOver and the rejoin replay so both always agree.
function finalLeaderboard(room) {
  const scoring = [...room.players.values()].filter((p) => !p.spectator);
  const sorted = isKnockout(room)
    ? scoring.slice().sort((a, b) => {
        const pa = a.placement ?? Number.MAX_SAFE_INTEGER;
        const pb = b.placement ?? Number.MAX_SAFE_INTEGER;
        if (pa !== pb) return pa - pb;
        return b.score - a.score;
      })
    : scoring.slice().sort((a, b) => b.score - a.score);
  return sorted.map((p, i) => ({
    rank: i + 1,
    id: p.id,
    name: p.name,
    score: p.score,
    placement: p.placement,
    eliminatedRound: p.eliminatedRound,
  }));
}

function spectatorCount(room) {
  let n = 0;
  for (const p of room.players.values()) if (p.spectator) n++;
  return n;
}

// Create a player, set identity + a rejoin token, and add them to the room.
// Used by createRoom, joinRoom (incl. spectators), and quickPlay.
function attachPlayer(room, socket, id, opts = {}) {
  socket.join(room.code);
  socket.data.roomCode = room.code;
  const player = makePlayer(socket.id, id.name);
  player.google = id.google;
  player.email = id.email || null;
  player.sub = id.sub || null;
  player.picture = id.picture || null;
  player.token = makeToken();
  player.spectator = Boolean(opts.spectator);
  socket.data.token = player.token;
  room.players.set(socket.id, player);
  socket.emit("roomJoined", { code: room.code, id: socket.id, token: player.token, spectator: player.spectator });
  return player;
}

// Re-key a player from an old socket id to a new one, preserving insertion
// order (so host order is stable) and moving any in-flight guess.
function rekeyPlayer(room, oldId, newId) {
  if (oldId === newId) return;
  const rebuilt = new Map();
  for (const [id, p] of room.players) {
    if (id === oldId) {
      p.id = newId;
      rebuilt.set(newId, p);
    } else {
      rebuilt.set(id, p);
    }
  }
  room.players = rebuilt;
  if (room.guesses.has(oldId)) {
    room.guesses.set(newId, room.guesses.get(oldId));
    room.guesses.delete(oldId);
  }
}

// Remove a player for good (grace expired, or an immediate leave), handling host
// transfer, empty-room cleanup, and mid-game "waiting" notices.
function finalizeLeave(room, id) {
  const player = room.players.get(id);
  if (!player) return;
  if (player.token) {
    const t = room.disconnectGrace.get(player.token);
    if (t) {
      clearTimeout(t);
      room.disconnectGrace.delete(player.token);
    }
  }
  const wasHost = !player.spectator && [...room.players.keys()][0] === id;
  const name = player.name;

  // A player who walks out of a knockout still gets a placement, so the
  // standings stay honest rather than having them silently disappear.
  const midKnockout =
    room.settings.format === "KNOCKOUT" &&
    (room.phase === PHASE.ROUND_PLAYING || room.phase === PHASE.ROUND_REVEAL);
  if (midKnockout && !player.spectator && !player.eliminated) {
    const [placed] = placementFor(
      room.knockout.startingPlayers,
      room.knockout.eliminatedCount,
      [{ id: player.id, score: player.score }]
    );
    if (placed) {
      player.eliminated = true;
      player.eliminatedRound = room.round;
      player.placement = placed.placement;
      room.knockout.eliminatedCount += 1;
    }
  }

  room.players.delete(id);
  io.to(room.code).emit("playerLeft", { name }); // SAFE

  if (room.players.size === 0) {
    deleteRoom(room);
    return;
  }
  if (wasHost) {
    const next = [...room.players.values()].find((p) => !p.spectator);
    if (next) io.to(room.code).emit("newHost", { name: next.name }); // SAFE
  }
  const activePlayers = [...room.players.values()].filter((p) => !p.spectator && p.connected);
  if (activePlayers.length === 1 && (room.phase === PHASE.ROUND_PLAYING || room.phase === PHASE.ROUND_REVEAL)) {
    io.to(room.code).emit("waitingForPlayers", {}); // SAFE
  }
  // Disconnections can decide a knockout: if only one fighter is left, the
  // match is over and they won.
  if (
    room.settings.format === "KNOCKOUT" &&
    (room.phase === PHASE.ROUND_PLAYING || room.phase === PHASE.ROUND_REVEAL) &&
    aliveCount(room) <= 1 &&
    room.players.size > 0
  ) {
    const last = alivePlayers(room)[0];
    if (last && last.placement == null) last.placement = 1;
    gameOver(room);
    return;
  }
  if (room.phase === PHASE.ROUND_PLAYING && allGuessed(room)) endRoundSoon(room);
  broadcastState(room);
}

// ----- Identity (room-independent) -----

// Resolve identity from a create/join payload. With a Google ID token (and
// GOOGLE_CLIENT_ID configured) the token is VERIFIED server-side and the Google
// name is used; otherwise the typed handle is used as a guest.
async function resolveIdentity(payload) {
  const idToken = payload && payload.idToken;
  if (idToken && oauthClient) {
    try {
      const ticket = await oauthClient.verifyIdToken({ idToken, audience: GOOGLE_CLIENT_ID });
      const p = ticket.getPayload();
      const name = cleanName(p.name || p.given_name || (p.email ? p.email.split("@")[0] : ""));
      if (!name) return { error: "Could not read your Google name." };
      const picture = typeof p.picture === "string" && p.picture.startsWith("https://") ? p.picture : null;
      return { name, google: true, sub: p.sub, email: p.email || null, picture };
    } catch {
      return { error: "Google sign-in failed. Try again." };
    }
  }
  const name = cleanName(payload && payload.name);
  if (!name) return { error: "Enter a valid handle." };
  return { name, google: false };
}

// ----- Per-room helpers -----

function clearTimers(room) {
  for (const k of ["round", "reveal", "countdown"]) {
    if (room.timers[k]) clearTimeout(room.timers[k]);
    room.timers[k] = null;
  }
}

// Public snapshot. SECURITY: omits room.correct by construction.
function publicState(room) {
  const inRound = room.phase === PHASE.ROUND_PLAYING || room.phase === PHASE.ROUND_REVEAL;
  return {
    code: room.code,
    phase: room.phase,
    round: room.round,
    // Knockout has no fixed length, so there is no total to show. The client
    // renders a bare round number plus a players-remaining count instead.
    totalRounds: room.settings.format === "KNOCKOUT" ? null : room.settings.rounds,
    format: room.settings.format,
    knockout: room.settings.knockout,
    roundMs: room.settings.roundMs, // round length, so the client bar matches
    mode: room.settings.mode, // TITLE | ARTIST — for client labels only
    clip: room.settings.clip, // RANDOM | INTRO — client picks the audio offset
    maxPlayers: MAX_PLAYERS,
    isPublic: room.isPublic,
    // COVER rounds send no audio at all: the cover is the whole clue.
    audioUrl: inRound && room.settings.clue !== "COVER" ? room.audioUrl : null,
    clue: room.settings.clue,
    // The art token rides the state, not just roundStart, so a player who
    // rejoins mid-round still gets a cover instead of an empty panel. It is not
    // a secret: every player in the room already has it, and the proxy gates by
    // the round clock rather than by who is asking.
    artToken: inRound && room.settings.clue === "COVER" ? room.artToken : null,
    options: inRound ? room.options : null,
    timeRemainingMs:
      room.phase === PHASE.ROUND_PLAYING
        ? Math.max(0, room.settings.roundMs - (Date.now() - room.roundStartedAt))
        : null,
    players: [...room.players.values()].map((p) => ({
      id: p.id,
      name: p.name,
      google: p.google, // verified badge only; email/sub never leave the server
      avatar: p.picture, // public Google photo URL or null (guests render an initial)
      spectator: p.spectator, // watching, not scoring
      connected: p.connected, // false while held during a rejoin grace window
      score: p.score,
      hasGuessed: p.hasGuessed,
      lastRoundScore: p.lastRoundScore,
      eliminated: p.eliminated,
      placement: p.placement,
      lives:
        room.settings.format === "KNOCKOUT" && room.settings.knockout === "LIVES"
          ? p.lives
          : null,
    })),
  };
}

function broadcastState(room) {
  io.to(room.code).emit("state", publicState(room)); // SAFE: omits room.correct
}

function allGuessed(room) {
  const active = [...room.players.values()].filter(
    (p) => !p.spectator && !p.eliminated && p.connected
  );
  if (active.length === 0) return false;
  for (const p of active) if (!p.hasGuessed) return false;
  return true;
}

function resetToLobby(room) {
  clearTimers(room);
  room.phase = PHASE.LOBBY;
  room.round = 0;
  room.loading = false;
  room.pool = [];
  room.usedTrackIds = new Set();
  room.audioUrl = null;
  room.options = [];
  room.correct = null;
  room.roundStartedAt = 0;
  room.guesses = new Map();
  room.pending = null;
  room.lastReveal = null;
  room.correctArtist = null;
  room.correctTrackName = null;
  room.history = [];
  dropArtToken(room);
  // room.settings is intentionally preserved so "play again" keeps the host's
  // last choices.
  for (const t of room.disconnectGrace.values()) clearTimeout(t);
  room.disconnectGrace.clear();
  // Drop anyone still held disconnected instead of resurrecting them as a
  // permanent "connected" ghost — a ghost would keep allGuessed() from ever
  // being true (early round-end never fires), occupy a MAX_PLAYERS slot, and
  // stop the room from ever being deleted once the real players leave.
  const prevHostId = [...room.players.keys()].find((id) => !room.players.get(id).spectator);
  for (const [id, p] of [...room.players]) {
    if (!p.connected) {
      room.players.delete(id);
      io.to(room.code).emit("playerLeft", { name: p.name }); // SAFE
    }
  }
  for (const p of room.players.values()) {
    p.score = 0;
    p.streak = 0;
    p.hasGuessed = false;
    p.lastRoundScore = 0;
    p.lastCorrect = false;
    p.spectator = false; // promote any watchers into the rematch
    p.eliminated = false;
    p.eliminatedRound = null;
    p.placement = null;
    p.lives = 0;
  }
  room.knockout = { startingPlayers: 0, eliminatedCount: 0 };
  // If the held host was dropped, hand the crown to the new first player.
  const newHostId = [...room.players.keys()][0];
  if (newHostId && newHostId !== prevHostId) {
    io.to(room.code).emit("newHost", { name: room.players.get(newHostId).name }); // SAFE
  }
}

// Begin round `n` with a 3-2-1 countdown, then the audio.
function startRound(room, n) {
  if (playerCount(room) === 0) {
    resetToLobby(room);
    broadcastState(room);
    return;
  }
  clearTimers(room);
  room.round = n;

  const picked = buildRound(room.pool, room.usedTrackIds, room.settings);
  room.usedTrackIds.add(picked.trackId);
  room.pending = picked;

  room.guesses = new Map();
  for (const p of room.players.values()) {
    p.hasGuessed = false;
    p.lastRoundScore = 0;
    p.lastCorrect = false;
  }

  const qv = questionValueFor(n - 1, room.settings.format);
  // SAFE: no correct answer field.
  io.to(room.code).emit("countdown", {
    seconds: 3,
    round: n,
    questionValue: qv,
    maxSpeedBonus: MAX_SPEED_BONUS,
    maxPoints: qv + MAX_SPEED_BONUS,
  });
  room.timers.countdown = setTimeout(() => beginPlaying(room), 3000);
}

function beginPlaying(room) {
  if (playerCount(room) === 0 || !room.pending) {
    resetToLobby(room);
    broadcastState(room);
    return;
  }
  const picked = room.pending;
  room.pending = null;
  room.phase = PHASE.ROUND_PLAYING;
  room.audioUrl = picked.audioUrl;
  room.options = picked.options;
  room.correct = picked.correct; // SERVER-ONLY
  room.correctArtist = picked.artistName;
  room.correctTrackName = picked.trackName;
  room.correctArtwork = picked.artworkUrl || null; // reveal-only, like the names
  room.roundStartedAt = Date.now();

  // Focus: mint this round's art token. Under COVER the audio URL is withheld
  // entirely - handing over the clip would give away the answer through the
  // other sense and make the artwork pointless.
  const cover = room.settings.clue === "COVER";
  if (cover) mintArtToken(room, room.correctArtwork, picked.trackId);
  else dropArtToken(room);

  const roundIndex = room.round - 1;
  // SAFE: no correct answer field.
  io.to(room.code).emit("roundStart", {
    questionValue: questionValueFor(roundIndex, room.settings.format),
    maxSpeedBonus: MAX_SPEED_BONUS,
    roundIndex,
    artToken: cover ? room.artToken : null,
    artSteps: cover ? ART_STEPS.length : 0,
  });
  broadcastState(room);
  room.timers.round = setTimeout(() => endRound(room), room.settings.roundMs);
}

// Everyone answered: let the clip keep playing briefly before the reveal.
function endRoundSoon(room) {
  if (room.phase !== PHASE.ROUND_PLAYING) return;
  const remaining = room.settings.roundMs - (Date.now() - room.roundStartedAt);
  if (remaining > EARLY_END_GRACE_MS) {
    if (room.timers.round) clearTimeout(room.timers.round);
    room.timers.round = setTimeout(() => endRound(room), EARLY_END_GRACE_MS);
  }
}

async function maybeRefreshPool(room) {
  if (room.refreshing) return;
  if (room.usedTrackIds.size < room.pool.length - 4) return;
  room.refreshing = true;
  try {
    const fresh = await getSongs(room.settings.genre, poolSizeFor(room.settings), {
      decade: room.settings.decade,
    });
    if (fresh && fresh.length >= room.settings.optionsCount) {
      room.pool = fresh;
      room.usedTrackIds = new Set();
    }
  } catch {
    /* keep the existing pool */
  } finally {
    room.refreshing = false;
  }
}

function endRound(room) {
  clearTimers(room);
  room.phase = PHASE.ROUND_REVEAL;
  dropArtToken(room); // the round is over; the token must not outlive it

  const correctName = room.correct ?? null;
  const questionValue = questionValueFor(room.round - 1, room.settings.format);

  let fastest = null;
  const scoring = [...room.players.values()].filter((p) => !p.spectator);
  const results = scoring.map((p) => {
    const g = room.guesses.get(p.id) || null;
    const answered = g != null;
    const isCorrect = answered && g.option === correctName;
    const answerTimeSeconds = answered ? Math.round(g.elapsedMs / 10) / 100 : null;

    p.streak = isCorrect ? (p.streak || 0) + 1 : 0;
    const streakBonus = isCorrect ? streakBonusFor(p.streak) : 0;
    const pointsEarned = isCorrect
      ? questionValue + speedBonusFor(g.elapsedMs, room.settings.roundMs) + streakBonus
      : 0;

    p.score += pointsEarned;
    p.lastRoundScore = pointsEarned;
    p.lastCorrect = isCorrect;

    if (isCorrect && (fastest === null || g.elapsedMs < fastest.elapsedMs)) {
      fastest = { name: p.name, elapsedMs: g.elapsedMs, answerTimeSeconds };
    }

    return {
      id: p.id,
      name: p.name,
      correct: isCorrect,
      pointsEarned,
      streakBonus,
      currentStreak: p.streak,
      answerTimeSeconds,
      score: p.score,
      gained: pointsEarned,
    };
  });

  const roundWinner = fastest ? { name: fastest.name, answerTimeSeconds: fastest.answerTimeSeconds } : null;

  // ----- Knockout: decide who leaves this round -----
  let eliminatedThisRound = [];
  let swept = false;
  if (isKnockout(room)) {
    const joinOrder = [...room.players.keys()];
    const entries = alivePlayers(room).map((p) => {
      const g = room.guesses.get(p.id) || null;
      return {
        id: p.id,
        correct: g != null && g.option === correctName,
        elapsedMs: g != null ? g.elapsedMs : null,
        score: p.score,
        joinIndex: joinOrder.indexOf(p.id),
      };
    });

    let outIds = [];
    if (room.settings.knockout === "SLOWEST") {
      const out = pickEliminated(entries);
      if (out) outIds = [out];
    } else {
      const applied = applyLives(
        entries,
        new Map(entries.map((x) => [x.id, room.players.get(x.id).lives]))
      );
      swept = applied.swept;
      for (const [id, left] of applied.lives) {
        const p = room.players.get(id);
        if (p) p.lives = left;
      }
      outIds = [...applied.lives.keys()].filter((id) => applied.lives.get(id) === 0);
    }

    // Everyone left can go out at once (LIVES). placementFor still places them,
    // best score first, so there is no draw state.
    const batch = outIds
      .map((id) => room.players.get(id))
      .filter(Boolean)
      .map((p) => ({ id: p.id, score: p.score }));

    const placements = placementFor(
      room.knockout.startingPlayers,
      room.knockout.eliminatedCount,
      batch
    );
    for (const { id, placement } of placements) {
      const p = room.players.get(id);
      if (!p) continue;
      p.eliminated = true;
      p.eliminatedRound = room.round;
      p.placement = placement;
      eliminatedThisRound.push({ id: p.id, name: p.name, placement });
    }
    room.knockout.eliminatedCount += placements.length;
  }

  room.history.push({
    trackName: room.correctTrackName,
    artistName: room.correctArtist,
    winner: roundWinner ? roundWinner.name : null,
  });

  const leaderboard = scoring
    .slice()
    .sort((a, b) => b.score - a.score)
    .map((p, i) => ({ rank: i + 1, id: p.id, name: p.name, score: p.score }));

  // The round is OVER, so disclosing the answer here is intentional and safe.
  // `correct` is the gradable value (title or artist); `track` always carries
  // both so the client can show the full song regardless of mode.
  const revealPayload = {
    correct: correctName,
    track: { trackName: room.correctTrackName, artistName: room.correctArtist, artworkUrl: room.correctArtwork },
    mode: room.settings.mode,
    round: room.round,
    totalRounds: isKnockout(room) ? null : room.settings.rounds,
    format: room.settings.format,
    knockout: room.settings.knockout,
    eliminated: eliminatedThisRound,
    // LIVES only: what everyone has left, and whether Sweep took this one.
    livesLeft:
      isKnockout(room) && room.settings.knockout === "LIVES"
        ? [...room.players.values()]
            .filter((p) => !p.spectator)
            .map((p) => ({ id: p.id, lives: p.lives }))
        : null,
    swept,
    results,
    roundWinner,
    leaderboard,
  };
  // Retain so a mid-reveal rejoiner can be re-sent the answer/results instead
  // of rendering an empty "No one got it" screen.
  room.lastReveal = revealPayload;
  io.to(room.code).emit("reveal", revealPayload);
  broadcastState(room);

  maybeRefreshPool(room);

  room.timers.reveal = setTimeout(() => {
    if (playerCount(room) === 0) {
      resetToLobby(room);
      broadcastState(room);
      return;
    }
    if (isKnockout(room)) {
      // Knockout has NO round limit. It ends only when one player is left.
      if (aliveCount(room) <= 1) {
        const last = alivePlayers(room)[0];
        if (last && last.placement == null) last.placement = 1;
        gameOver(room);
      } else {
        startRound(room, room.round + 1);
      }
      return;
    }
    if (room.round >= room.settings.rounds) {
      gameOver(room);
    } else {
      startRound(room, room.round + 1);
    }
  }, isKnockout(room) ? KNOCKOUT_REVEAL_MS : REVEAL_MS);
}

function gameOver(room) {
  clearTimers(room);
  room.phase = PHASE.GAME_OVER;
  const leaderboard = finalLeaderboard(room);
  io.to(room.code).emit("gameOver", {
    leaderboard,
    roundHistory: room.history,
    format: room.settings.format,
  }); // SAFE: round over
  broadcastState(room);
  // Persist final scores for the global leaderboard (no-op without DATABASE_URL).
  recordMatch({ players: [...room.players.values()], settings: room.settings }, log);
  // XP for verified players: persisted server-side and delivered per-socket
  // (each player's award differs, so it never rides the room broadcast).
  // Guests compute the same award locally from their own score.
  for (const p of room.players.values()) {
    if (p.spectator || !p.sub) continue;
    const target = io.sockets.sockets.get(p.id);
    if (!target) continue;
    addXp(p.sub, p.name, Math.max(0, Math.round(p.score / 10)))
      .then(({ before }) => target.emit("xpAward", awardFor(before, p.score)))
      .catch(() => {});
  }
}

// ----- HTTP + Socket.IO -----
const httpServer = http.createServer(async (req, res) => {
  // Reflect the request origin only when it's allowed. In prod with an empty
  // allowlist no CORS header is sent (fail closed); in dev ("*") all are allowed.
  const reqOrigin = req.headers.origin;
  let allowOrigin = "";
  if (Array.isArray(CLIENT_ORIGIN)) {
    if (reqOrigin && CLIENT_ORIGIN.includes(reqOrigin)) allowOrigin = reqOrigin;
  } else {
    allowOrigin = CLIENT_ORIGIN; // "*" in dev
  }
  if (allowOrigin) res.setHeader("Access-Control-Allow-Origin", allowOrigin);

  // Global leaderboard (only meaningful when DATABASE_URL is configured).
  // Cover art for a Focus round, at the resolution the round clock allows.
  // The client never receives an image-host URL: the host encodes the size in
  // the path, so holding one would let anyone rewrite 8x8 to 300x300 and read
  // the answer straight off the CDN.
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
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "no art" }));
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
      // Per-step immutable, but never cached by a shared proxy across rounds.
      "Cache-Control": "private, max-age=300",
    });
    res.end(buf);
    return;
  }

  if (req.method === "GET" && req.url && req.url.startsWith("/leaderboard")) {
    const rows = await topScores(20);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ leaderboard: rows }));
    return;
  }

  // Manual catalog refresh. Kicks off the same ingest the 24h timer runs, so a
  // fresh chart sweep doesn't have to wait for a restart or the next tick.
  // Gated on ADMIN_TOKEN: unset means the route doesn't exist at all (falls
  // through to the health handler), so an unconfigured deploy exposes no admin
  // surface to probe. Answers 202 immediately — the ingest takes minutes and
  // runs detached; poll GET /catalog to watch the totals move.
  if (req.method === "POST" && req.url && req.url.startsWith("/catalog/refresh") && ADMIN_TOKEN) {
    if (!adminAuthorized(req)) {
      log.warn("catalog refresh: unauthorized", { ip: ipOfRequest(req) });
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "unauthorized" }));
      return;
    }
    if (ingestRunning()) {
      res.writeHead(409, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ started: false, reason: "already_running" }));
      return;
    }
    // "charts" is the cheap refresh (~1 min); "full" also re-seeds every
    // artist (~5 min). Anything else is rejected rather than silently coerced.
    const mode = new URL(req.url, "http://localhost").searchParams.get("mode") || "charts";
    if (!["charts", "full", "artists"].includes(mode)) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "mode must be charts, full, or artists" }));
      return;
    }
    log.info("catalog refresh: started", { mode });
    runIngest(mode).catch(() => {}); // detached: runIngest already logs failures
    res.writeHead(202, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ started: true, mode }));
    return;
  }

  // Catalog health: totals per genre. Same exposure judgment as /leaderboard —
  // aggregate counts only, nothing operational.
  if (req.method === "GET" && req.url && req.url.startsWith("/catalog")) {
    const stats = await catalogStats().catch(() => ({ backend: "none", total: 0, byGenre: {} }));
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(stats));
    return;
  }

  // Health check only — deliberately no room/player counts, so operational
  // detail isn't exposed to arbitrary callers.
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ ok: true }));
});

// Socket.IO handshake Origin enforcement. Browsers don't apply CORS to
// WebSocket, so cors.origin alone can't stop other sites from opening a socket.
// This rejects the handshake server-side when the Origin isn't in the allowlist.
// Requests with no Origin header (non-browser clients, health checks) pass —
// Origin is only meaningful from browsers, which is exactly the cross-site abuse
// this blocks. It is NOT a hard auth boundary (Origin is spoofable off-browser);
// the per-IP/room caps remain the real backstop.
function originAllowed(origin) {
  if (!origin) return true; // non-browser client
  if (CLIENT_ORIGIN === "*") return true; // dev
  if (Array.isArray(CLIENT_ORIGIN)) return CLIENT_ORIGIN.includes(origin);
  return origin === CLIENT_ORIGIN;
}

const io = new Server(httpServer, {
  cors: { origin: CLIENT_ORIGIN },
  allowRequest: (req, cb) => {
    const ok = originAllowed(req.headers.origin);
    cb(ok ? null : "origin_not_allowed", ok);
  },
});

if (IS_PROD && Array.isArray(CLIENT_ORIGIN) && CLIENT_ORIGIN.length === 0) {
  log.warn(
    "CLIENT_ORIGIN is unset in production — cross-origin clients are blocked (fail closed). Set CLIENT_ORIGIN to your web origin(s), e.g. https://yourapp.vercel.app"
  );
}

// ----- Optional, env-gated scale/observability hooks -----
// Each is DORMANT unless its env var is set AND the package is installed. They
// degrade to a warning and never block the game.

// Redis adapter: fans out socket broadcasts across multiple backend instances.
// NOTE: room/game state still lives in this process's memory, so players in the
// same room must reach the same instance (use sticky sessions). This is the
// groundwork for full horizontal scale, not a complete multi-instance story.
async function maybeAttachRedis() {
  const url = process.env.REDIS_URL;
  if (!url) return;
  try {
    const [{ createAdapter }, { default: IORedis }] = await Promise.all([
      import("@socket.io/redis-adapter"),
      import("ioredis"),
    ]);
    const pub = new IORedis(url);
    const sub = pub.duplicate();
    io.adapter(createAdapter(pub, sub));
    log.info("redis adapter attached");
  } catch (e) {
    log.warn("REDIS_URL set but adapter not attached; install @socket.io/redis-adapter + ioredis", {
      error: String((e && e.message) || e),
    });
  }
}

// Sentry error monitoring (optional). Captures uncaught errors if configured.
let sentry = null;
async function maybeInitSentry() {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return;
  try {
    sentry = await import("@sentry/node");
    sentry.init({ dsn, tracesSampleRate: 0 });
    log.info("sentry initialized");
  } catch (e) {
    log.warn("SENTRY_DSN set but @sentry/node not installed", { error: String((e && e.message) || e) });
  }
}

maybeAttachRedis();
maybeInitSentry();
initStorage(log);

// Song catalog: init the store, then kick off the background ingest (first run
// builds the pool; later runs just refresh charts). Never blocks the server —
// until the catalog is warm, matches are served by the live iTunes fallback.
initCatalog(log).then(() => {
  if (process.env.CATALOG_INGEST !== "off") scheduleIngest();
});

// Last-resort safety nets: log (and report) instead of crashing silently.
process.on("uncaughtException", (err) => {
  log.error("uncaughtException", { error: String((err && err.stack) || err) });
  if (sentry) try { sentry.captureException(err); } catch {}
});
process.on("unhandledRejection", (reason) => {
  log.error("unhandledRejection", { error: String(reason) });
  if (sentry) try { sentry.captureException(reason); } catch {}
});

io.on("connection", (socket) => {
  // --- Per-IP connection cap (abuse / DoS guard) ---
  const ip = ipOf(socket);
  socket.data.ip = ip;
  connectionsByIp.set(ip, (connectionsByIp.get(ip) || 0) + 1);
  // Registered first so the count is released even if we reject below.
  socket.on("disconnect", () => {
    const c = (connectionsByIp.get(ip) || 1) - 1;
    if (c <= 0) connectionsByIp.delete(ip);
    else connectionsByIp.set(ip, c);
  });
  if (connectionsByIp.get(ip) > MAX_CONN_PER_IP) {
    socket.emit("errorMsg", { message: "Too many connections from your network. Try again in a minute." });
    socket.disconnect(true);
    return;
  }

  // --- Daily challenge (solo async) — handlers live in daily.js ---
  registerDaily(socket, { resolveIdentity, rateLimited });

  // --- createRoom: open a new room and become host ---
  socket.on("createRoom", async (payload) => {
    if (socket.data.busy || roomOf(socket)) return;
    if (rateLimited(socket, "create", 5, 10000)) {
      socket.emit("errorMsg", { message: "Too fast. Wait a moment and try again." });
      return;
    }
    if (rooms.size >= MAX_ROOMS) {
      socket.emit("errorMsg", { message: "Server is at capacity. Try again soon." });
      return;
    }
    socket.data.busy = true;
    try {
      const id = await resolveIdentity(payload);
      if (id.error) {
        socket.emit("errorMsg", { message: id.error });
        return;
      }
      if (roomOf(socket)) return;
      const code = makeCode();
      const room = makeRoom(code);
      room.isPublic = Boolean(payload && payload.public);
      rooms.set(code, room);
      attachPlayer(room, socket, id);
      broadcastState(room);
    } finally {
      socket.data.busy = false;
    }
  });

  // --- joinRoom: join by code. In LOBBY you join as a player; once a game is in
  // progress you join as a spectator (watch only). ---
  socket.on("joinRoom", async (payload) => {
    if (socket.data.busy || roomOf(socket)) return;
    if (rateLimited(socket, "join", 10, 10000)) {
      socket.emit("errorMsg", { message: "Too fast. Wait a moment and try again." });
      return;
    }
    socket.data.busy = true;
    try {
      const code = String((payload && payload.code) ?? "").toUpperCase().trim();
      const room = rooms.get(code);
      if (!room) {
        socket.emit("errorMsg", { message: "No room with that code. Check the code and try again." });
        return;
      }
      const asSpectator = room.phase !== PHASE.LOBBY;
      if (!asSpectator && playerCount(room) >= MAX_PLAYERS) {
        socket.emit("errorMsg", { message: "This room is full. Ask for another code, or create your own room." });
        return;
      }
      if (asSpectator && spectatorCount(room) >= MAX_SPECTATORS) {
        socket.emit("errorMsg", { message: "This room has too many spectators. Try again in a moment." });
        return;
      }
      const id = await resolveIdentity(payload);
      if (id.error) {
        socket.emit("errorMsg", { message: id.error });
        return;
      }
      if (roomOf(socket)) return;
      attachPlayer(room, socket, id, { spectator: asSpectator });
      broadcastState(room);
    } finally {
      socket.data.busy = false;
    }
  });

  // --- quickPlay: matchmaking. Join an open public lobby, or open a new one. ---
  socket.on("quickPlay", async (payload) => {
    if (socket.data.busy || roomOf(socket)) return;
    if (rateLimited(socket, "quick", 5, 10000)) {
      socket.emit("errorMsg", { message: "Too fast. Wait a moment and try again." });
      return;
    }
    socket.data.busy = true;
    try {
      const id = await resolveIdentity(payload);
      if (id.error) {
        socket.emit("errorMsg", { message: id.error });
        return;
      }
      if (roomOf(socket)) return;
      let room = null;
      for (const r of rooms.values()) {
        if (r.isPublic && r.phase === PHASE.LOBBY && playerCount(r) < MAX_PLAYERS) {
          room = r;
          break;
        }
      }
      if (!room) {
        if (rooms.size >= MAX_ROOMS) {
          socket.emit("errorMsg", { message: "Server is at capacity. Try again soon." });
          return;
        }
        const code = makeCode();
        room = makeRoom(code);
        room.isPublic = true;
        rooms.set(code, room);
      }
      attachPlayer(room, socket, id);
      broadcastState(room);
    } finally {
      socket.data.busy = false;
    }
  });

  // --- rejoin: reattach to a held slot after a disconnect, score intact. ---
  socket.on("rejoin", (payload) => {
    if (roomOf(socket)) return;
    const code = String((payload && payload.code) ?? "").toUpperCase().trim();
    const token = String((payload && payload.token) ?? "");
    const room = rooms.get(code);
    if (!room || !token) {
      socket.emit("rejoinFailed", {});
      return;
    }
    let target = null;
    for (const p of room.players.values()) {
      if (p.token === token) {
        target = p;
        break;
      }
    }
    if (!target) {
      socket.emit("rejoinFailed", {});
      return;
    }
    const oldId = target.id;
    rekeyPlayer(room, oldId, socket.id);
    target.connected = true;
    const grace = room.disconnectGrace.get(token);
    if (grace) {
      clearTimeout(grace);
      room.disconnectGrace.delete(token);
    }
    socket.join(room.code);
    socket.data.roomCode = room.code;
    socket.data.token = token;
    socket.emit("roomJoined", { code: room.code, id: socket.id, token, spectator: target.spectator }); // SAFE
    // Re-send the current phase's payload so the rejoiner's UI is correct.
    if (room.phase === PHASE.ROUND_REVEAL && room.lastReveal) {
      socket.emit("reveal", room.lastReveal); // SAFE — round is over, answer is public
    }
    if (room.phase === PHASE.GAME_OVER) {
      // Same ordering the rest of the room already received: under knockout
      // that is placement, not score, or a rejoiner would see standings that
      // disagree with everyone else's.
      socket.emit("gameOver", {
        leaderboard: finalLeaderboard(room),
        roundHistory: room.history,
        format: room.settings.format,
      });
    }
    broadcastState(room);
  });

  // --- startGame: host starts round 1 (optional { genre }) ---
  socket.on("startGame", async (payload) => {
    const room = roomOf(socket);
    if (!room) {
      socket.emit("errorMsg", { message: "Not in a room." });
      return;
    }
    if (room.phase !== PHASE.LOBBY) {
      socket.emit("errorMsg", { message: "Game already started." });
      return;
    }
    if (!room.players.has(socket.id)) return;
    if ([...room.players.keys()][0] !== socket.id) {
      socket.emit("errorMsg", { message: "Only the host can start." });
      return;
    }
    if (room.loading) {
      socket.emit("errorMsg", { message: "Game is already starting." });
      return;
    }
    if (rateLimited(socket, "start", 10, 10000)) {
      socket.emit("errorMsg", { message: "Too fast. Wait a moment and try again." });
      return;
    }

    // The host's requested settings are validated/clamped here — never trusted.
    // Sanitized BEFORE the loading state so a rejected knockout lineup never
    // leaves the room stuck on a loading screen.
    room.settings = sanitizeSettings(payload);

    const starting = playerCount(room);
    if (starting < minPlayersFor(room.settings)) {
      socket.emit("errorMsg", {
        message:
          room.settings.knockout === "LIVES"
            ? "Knockout needs at least 2 players."
            : "Knockout with Slowest out needs at least 3 players. Try Lives for a 2-player duel.",
      });
      return;
    }
    room.knockout = { startingPlayers: starting, eliminatedCount: 0 };

    room.loading = true;
    io.to(room.code).emit("loading", { message: "Loading songs…" }); // SAFE

    let pool;
    try {
      pool = await getSongs(room.settings.genre, poolSizeFor(room.settings, starting), {
        decade: room.settings.decade,
      });
    } catch {
      room.loading = false;
      io.to(room.code).emit("errorMsg", { message: "Could not load songs. Try again." });
      return;
    }
    room.loading = false;

    // A cover round needs a cover. Coverage is currently 100%, so this guards
    // against a future thin ingest rather than a live gap, and it fails through
    // the existing "not enough songs" path instead of showing a blank tile.
    if (room.settings.clue === "COVER" && pool) {
      pool = pool.filter((t) => t.artworkUrl);
    }

    if (!pool || pool.length < room.settings.optionsCount) {
      io.to(room.code).emit("errorMsg", { message: "Not enough songs for these settings. Try another genre or era." });
      return;
    }
    if (room.phase !== PHASE.LOBBY || room.players.size < 1) return;

    room.pool = pool;
    room.usedTrackIds = new Set();
    room.history = [];
    const seedLives =
      room.settings.format === "KNOCKOUT" && room.settings.knockout === "LIVES"
        ? livesFor(starting)
        : 0;
    for (const p of room.players.values()) {
      p.score = 0;
      p.streak = 0;
      p.eliminated = false;
      p.eliminatedRound = null;
      p.placement = null;
      p.lives = p.spectator ? 0 : seedLives;
    }
    startRound(room, 1);
  });

  // --- guess: one answer per player per round ---
  socket.on("guess", (payload) => {
    const room = roomOf(socket);
    if (!room || room.phase !== PHASE.ROUND_PLAYING) {
      socket.emit("errorMsg", { message: "No active round." });
      return;
    }
    const player = room.players.get(socket.id);
    if (!player) {
      socket.emit("errorMsg", { message: "You are not in the game." });
      return;
    }
    if (player.spectator) {
      socket.emit("errorMsg", { message: "Spectators can't guess." });
      return;
    }
    if (player.eliminated) {
      socket.emit("errorMsg", { message: "You're out. Watch the rest play it out." });
      return;
    }
    // S1 (rate limit): one guess per player per round.
    if (player.hasGuessed) {
      socket.emit("errorMsg", { message: "Already guessed this round." });
      return;
    }
    const choice = payload && payload.option;
    // Validate against the round's actual options (type + membership). Prevents
    // garbage/oversized payloads entering room state.
    if (typeof choice !== "string" || !room.options.includes(choice)) {
      socket.emit("errorMsg", { message: "Invalid option." });
      return;
    }
    const elapsedMs = Date.now() - room.roundStartedAt;
    player.hasGuessed = true;
    room.guesses.set(socket.id, { option: choice, elapsedMs });

    socket.emit("guessAck", { accepted: true }); // SAFE
    broadcastState(room);
    if (allGuessed(room)) endRoundSoon(room);
  });

  // --- restart: from GAME_OVER back to the room lobby ---
  socket.on("restart", () => {
    const room = roomOf(socket);
    if (!room || room.phase !== PHASE.GAME_OVER) {
      socket.emit("errorMsg", { message: "Game is not over yet." });
      return;
    }
    resetToLobby(room);
    broadcastState(room);
  });

  // --- chat: room-scoped messages, rate-limited, sanitized, profanity-masked ---
  socket.on("chat", (payload) => {
    const room = roomOf(socket);
    if (!room) return;
    const player = room.players.get(socket.id);
    if (!player) return;
    if (rateLimited(socket, "chat", 5, 5000)) return; // drop quietly when flooding
    let text = String((payload && payload.text) ?? "")
      .replace(/[\x00-\x1F\x7F]/g, "") // strip control chars
      .trim()
      .slice(0, CHAT_MAX_LEN);
    if (!text) return;
    text = maskProfanity(text);
    io.to(room.code).emit("chat", { id: socket.id, name: player.name, text, ts: Date.now() }); // SAFE
  });

  // --- react: floated arcade call-out from the whitelist, rate-limited ---
  socket.on("react", (payload) => {
    const room = roomOf(socket);
    if (!room) return;
    const player = room.players.get(socket.id);
    if (!player) return;
    if (rateLimited(socket, "react", 8, 5000)) return;
    const token = String((payload && payload.token) ?? "");
    if (!REACTIONS.includes(token)) return;
    io.to(room.code).emit("reaction", { id: socket.id, name: player.name, token, ts: Date.now() }); // SAFE
  });

  // --- disconnect ---
  socket.on("disconnect", () => {
    const room = roomOf(socket);
    if (!room) return;
    const player = room.players.get(socket.id);
    if (!player) return;

    const midGame = room.phase === PHASE.ROUND_PLAYING || room.phase === PHASE.ROUND_REVEAL;
    // Mid-game players keep their slot (and score) for a grace window so they
    // can rejoin with their token. Spectators and lobby/game-over leavers go now.
    if (midGame && !player.spectator && player.token) {
      player.connected = false;
      io.to(room.code).emit("playerLeft", { name: player.name, held: true }); // SAFE
      const token = player.token;
      const heldId = socket.id;
      const timer = setTimeout(() => finalizeLeave(room, heldId), REJOIN_GRACE_MS);
      room.disconnectGrace.set(token, timer);
      if (room.phase === PHASE.ROUND_PLAYING && allGuessed(room)) endRoundSoon(room);
      broadcastState(room);
      return;
    }
    finalizeLeave(room, socket.id);
  });
});

httpServer.listen(PORT, () => {
  log.info("snippet server listening", { port: Number(PORT), origins: CLIENT_ORIGIN });
});
