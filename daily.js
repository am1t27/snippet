// Daily challenge socket runtime — solo async play of one frozen puzzle per
// UTC day.
//
// CONTRACT WITH THE CLIENT: during play this module emits the SAME event
// shapes the live multiplayer rounds emit (`countdown`, `roundStart`,
// `state`, `reveal`) so Playing.jsx renders a daily round with zero changes.
// Everything is socket-scoped (socket.emit, never a room broadcast).
//
// SECURITY, same stance as the live game:
//   - The correct answer never leaves the server while its round is open.
//   - All timing comes from the server clock (session.roundStartedAt set when
//     the round is emitted); client-reported elapsed times are never read.
//   - Verified (Google) players get one ranked play per day, enforced by the
//     (day, sub) primary key. Guests are gated client-side only by design —
//     they are never written to the leaderboard, so there is nothing to farm.
import { getSongs } from "./songProvider.js";
import { MAX_SPEED_BONUS, questionValueFor } from "./gameLogic.js";
import {
  DAILY_ROUNDS, DAILY_ROUND_MS, dayKey, dailyNumber,
  buildDailyRounds, scoreDailyAnswer, computeStreak, shareText,
} from "./dailyLogic.js";
import {
  saveDailyPuzzle, getDailyPuzzle, saveDailyResult, getDailyResult,
  getDailyLeaderboard, getDailyRank, getDailyDaysPlayed,
} from "./storage.js";
import { addXp } from "./storage.js";
import { awardFor } from "./xpLogic.js";
import { log } from "./log.js";

const COUNTDOWN_MS = 3000;
const REVEAL_MS = 3000;
const EXPIRE_GRACE_MS = 2000; // network slack past the round clock

const sessions = new Map(); // socket.id -> session

// Serialize puzzle creation so a burst of first-players builds it once.
let buildInFlight = null;
async function puzzleForDay(day) {
  const existing = await getDailyPuzzle(day);
  if (existing) return existing;
  if (!buildInFlight) {
    buildInFlight = (async () => {
      try {
        const rounds = await buildDailyRounds({ getSongs });
        // First writer wins; whatever is frozen in storage is what we play.
        return await saveDailyPuzzle(day, rounds);
      } finally {
        buildInFlight = null;
      }
    })();
  }
  return buildInFlight;
}

function clearSessionTimers(s) {
  if (s.timer) clearTimeout(s.timer);
  s.timer = null;
}

function dropSession(socket) {
  const s = sessions.get(socket.id);
  if (!s) return;
  clearSessionTimers(s);
  sessions.delete(socket.id);
}

// Mirror of server.js publicState, shaped for a one-player solo session.
function dailyState(s, socket, phase) {
  const inRound = phase === "ROUND_PLAYING" || phase === "ROUND_REVEAL";
  const round = s.rounds[s.roundIdx];
  return {
    code: "DAILY",
    phase,
    round: s.roundIdx + 1,
    totalRounds: DAILY_ROUNDS,
    roundMs: DAILY_ROUND_MS,
    mode: "TITLE",
    clip: "RANDOM",
    maxPlayers: 1,
    isPublic: false,
    audioUrl: inRound ? round.audioUrl : null,
    options: inRound ? round.options : null,
    timeRemainingMs:
      phase === "ROUND_PLAYING"
        ? Math.max(0, DAILY_ROUND_MS - (Date.now() - s.roundStartedAt))
        : null,
    players: [
      {
        id: socket.id,
        name: s.name,
        google: Boolean(s.sub),
        avatar: s.picture || null,
        spectator: false,
        connected: true,
        score: s.score,
        hasGuessed: s.answered,
        lastRoundScore: s.lastRoundScore,
      },
    ],
  };
}

function startRoundFor(socket, s) {
  const idx = s.roundIdx;
  const qv = questionValueFor(idx);
  s.answered = false;
  s.lastRoundScore = 0;
  socket.emit("countdown", {
    seconds: COUNTDOWN_MS / 1000,
    round: idx + 1,
    questionValue: qv,
    maxSpeedBonus: MAX_SPEED_BONUS,
    maxPoints: qv + MAX_SPEED_BONUS,
  });
  s.timer = setTimeout(() => {
    if (!sessions.has(socket.id)) return;
    s.roundStartedAt = Date.now();
    // SAFE: no correct answer field in either payload.
    socket.emit("roundStart", { questionValue: qv, maxSpeedBonus: MAX_SPEED_BONUS, roundIndex: idx });
    socket.emit("state", dailyState(s, socket, "ROUND_PLAYING"));
    s.timer = setTimeout(() => resolveRound(socket, s, null), DAILY_ROUND_MS + EXPIRE_GRACE_MS);
  }, COUNTDOWN_MS);
}

// choice === null means the round expired unanswered.
async function resolveRound(socket, s, choice) {
  clearSessionTimers(s);
  const idx = s.roundIdx;
  const round = s.rounds[idx];
  const elapsedMs = Date.now() - s.roundStartedAt;
  const isCorrect = choice !== null && choice === round.correct;

  s.streak = isCorrect ? s.streak + 1 : 0;
  const scored = scoreDailyAnswer({ isCorrect, elapsedMs, roundIndex: idx, streak: s.streak });
  s.score += scored.points;
  s.lastRoundScore = scored.points;
  s.perRound.push(isCorrect);
  s.answers.push({ correct: isCorrect, ms: Math.min(elapsedMs, DAILY_ROUND_MS + EXPIRE_GRACE_MS) });
  s.answered = true;

  const answerTimeSeconds = isCorrect ? Math.round(elapsedMs / 100) / 10 : null;
  // The round is OVER: disclosing the answer here is intentional and safe.
  socket.emit("state", dailyState(s, socket, "ROUND_REVEAL"));
  socket.emit("reveal", {
    correct: round.correct,
    track: { trackName: round.trackName, artistName: round.artistName, artworkUrl: round.artworkUrl || null },
    mode: "TITLE",
    round: idx + 1,
    totalRounds: DAILY_ROUNDS,
    results: [
      {
        id: socket.id,
        name: s.name,
        correct: isCorrect,
        pointsEarned: scored.points,
        streakBonus: scored.streakBonus,
        currentStreak: s.streak,
        answerTimeSeconds,
        score: s.score,
        gained: scored.points,
      },
    ],
    roundWinner: isCorrect ? { name: s.name, answerTimeSeconds } : null,
    leaderboard: [{ rank: 1, id: socket.id, name: s.name, score: s.score }],
  });

  s.roundIdx += 1;
  if (s.roundIdx < DAILY_ROUNDS) {
    s.timer = setTimeout(() => {
      if (sessions.has(socket.id)) startRoundFor(socket, s);
    }, REVEAL_MS);
  } else {
    s.timer = setTimeout(() => finishDaily(socket, s), REVEAL_MS);
  }
}

async function finishDaily(socket, s) {
  dropSession(socket);
  const number = dailyNumber(s.day);
  let ranked = false;
  let myRank = null;
  let streak = null;
  let xp = null;
  if (s.sub) {
    ranked = await saveDailyResult({
      day: s.day, sub: s.sub, name: s.name, score: s.score, answers: s.answers,
    });
    myRank = await getDailyRank(s.day, s.sub);
    streak = computeStreak(await getDailyDaysPlayed(s.sub), s.day);
    // XP only for the ranked (first) completion — replays of past days or
    // degraded states never farm the curve.
    if (ranked) {
      const { before } = await addXp(s.sub, s.name, Math.max(0, Math.round(s.score / 10)));
      xp = awardFor(before, s.score);
    }
  }
  const leaderboard = await getDailyLeaderboard(s.day, 10);
  socket.emit("daily:finish", {
    day: s.day,
    number,
    score: s.score,
    perRound: s.perRound,
    shareText: shareText({ number, score: s.score, perRound: s.perRound }),
    leaderboard,
    myRank,
    streak,
    ranked,
    xp, // null for guests; they mirror the curve locally
  });
}

export function registerDaily(socket, { resolveIdentity, rateLimited }) {
  socket.on("daily:status", async (payload) => {
    if (rateLimited(socket, "dailyStatus", 10, 10000)) return;
    const day = dayKey();
    const out = {
      day,
      number: dailyNumber(day),
      played: false,
      myScore: null,
      myRank: null,
      streak: null,
      leaderboard: await getDailyLeaderboard(day, 10),
    };
    // Optional idToken: verified players get their served-side played state.
    if (payload && payload.idToken) {
      const id = await resolveIdentity(payload);
      if (!id.error && id.sub) {
        const result = await getDailyResult(day, id.sub);
        if (result) {
          out.played = true;
          out.myScore = result.score;
          out.myRank = await getDailyRank(day, id.sub);
        }
        out.streak = computeStreak(await getDailyDaysPlayed(id.sub), day);
      }
    }
    socket.emit("daily:status", out);
  });

  socket.on("daily:start", async (payload) => {
    if (socket.data.busy) return;
    if (sessions.has(socket.id)) return; // one live daily per socket
    if (rateLimited(socket, "dailyStart", 3, 10000)) {
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
      const day = dayKey();
      if (id.sub && (await getDailyResult(day, id.sub))) {
        socket.emit("errorMsg", { message: "You already played today's daily. New puzzle at midnight UTC." });
        return;
      }
      let rounds;
      try {
        rounds = await puzzleForDay(day);
      } catch (e) {
        log.error("daily: puzzle build failed", { error: String((e && e.message) || e) });
        socket.emit("errorMsg", { message: "Today's puzzle is not ready yet. Try again in a minute." });
        return;
      }
      const s = {
        day, rounds, roundIdx: 0, score: 0, streak: 0,
        perRound: [], answers: [], answered: false, lastRoundScore: 0,
        roundStartedAt: 0, timer: null,
        sub: id.sub || null, name: id.name, picture: id.picture || null,
      };
      sessions.set(socket.id, s);
      startRoundFor(socket, s);
    } finally {
      socket.data.busy = false;
    }
  });

  socket.on("daily:answer", (payload) => {
    if (rateLimited(socket, "dailyAnswer", 10, 10000)) return;
    const s = sessions.get(socket.id);
    if (!s || s.answered || !s.roundStartedAt) return;
    const round = s.rounds[s.roundIdx];
    if (!round) return;
    const choice = payload && typeof payload.choice === "string" ? payload.choice : null;
    if (choice === null || !round.options.includes(choice)) return;
    resolveRound(socket, s, choice);
  });

  socket.on("daily:leave", () => dropSession(socket));
  socket.on("disconnect", () => dropSession(socket));
}
