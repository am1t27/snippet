// End-to-end knockout tests: a real server process, real Socket.IO clients,
// real rounds. These cover what unit tests cannot — the round loop, the
// elimination broadcast, the start guards, and the end condition.
//
// Answers are chosen at random, which is deliberate: every invariant asserted
// here holds regardless of whether a guess was right. Rules that depend on
// correctness (Sweep) are proven deterministically in test/gameLogic.test.js.
//
// Slow by nature (a round is a 3s countdown + a 3s early-end grace + a 4.5s
// reveal), so these are excluded from `npm test` and run via `npm run test:e2e`.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawn } from "node:child_process";
import { io as connect } from "socket.io-client";

const PORT = 4599;
const URL = `http://127.0.0.1:${PORT}`;
let server;

beforeAll(async () => {
  server = spawn("node", ["server.js"], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: String(PORT), CLIENT_ORIGIN: "*", NODE_ENV: "test" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("server did not start")), 20000);
    server.stdout.on("data", (b) => {
      if (String(b).includes("listening")) {
        clearTimeout(timer);
        resolve();
      }
    });
  });
}, 30000);

afterAll(() => {
  if (server) server.kill("SIGKILL");
});

// ----- helpers -----

const sock = () => connect(URL, { transports: ["websocket"], forceNew: true });

function once(s, event) {
  return new Promise((resolve) => s.once(event, resolve));
}

// A test player: connects, tracks what it is told, and answers at random.
async function player(name) {
  const s = sock();
  await once(s, "connect");
  const p = {
    s,
    name,
    id: null,
    reveals: [],
    gameOver: null,
    errors: [],
    states: [],
    guessRejections: [],
  };
  s.on("roomJoined", (d) => { p.id = d.id; });
  s.on("state", (d) => p.states.push(d));
  s.on("reveal", (d) => p.reveals.push(d));
  s.on("gameOver", (d) => { p.gameOver = d; });
  s.on("errorMsg", (d) => p.errors.push(d.message));
  // Answer as soon as a round opens, so rounds end on the early-end grace
  // rather than running the full clock.
  s.on("state", (d) => {
    if (d.phase !== "ROUND_PLAYING" || !d.options) return;
    const me = d.players.find((x) => x.id === p.id);
    if (!me || me.spectator) return;
    // Deliberately misbehave once after being knocked out, so the server's
    // rejection is actually exercised rather than assumed.
    if (me.eliminated) {
      if (p.probeWhenOut && !p.probed) {
        p.probed = true;
        s.emit("guess", { option: d.options[0] });
      }
      return;
    }
    if (me.hasGuessed) return;
    s.emit("guess", { option: d.options[Math.floor(Math.random() * d.options.length)] });
  });
  return p;
}

async function room(hostName, guestNames) {
  const host = await player(hostName);
  host.s.emit("createRoom", { name: hostName });
  const joined = await once(host.s, "roomJoined");
  const code = joined.code;
  const guests = [];
  for (const n of guestNames) {
    const g = await player(n);
    g.s.emit("joinRoom", { name: n, code });
    await once(g.s, "roomJoined");
    guests.push(g);
  }
  return { host, guests, all: [host, ...guests], code };
}

function closeAll(r) {
  for (const p of r.all) p.s.close();
}

// Wait for a broadcast state satisfying `pred`. Needed because the lobby
// state is still CLASSIC: knockout fields only appear once a match is running.
function waitForState(p, pred, ms = 20000) {
  return new Promise((resolve, reject) => {
    const hit = p.states.find(pred);
    if (hit) return resolve(hit);
    const timer = setTimeout(() => reject(new Error("no matching state in time")), ms);
    const onState = (d) => {
      if (!pred(d)) return;
      clearTimeout(timer);
      p.s.off("state", onState);
      resolve(d);
    };
    p.s.on("state", onState);
  });
}

const inRound = (d) => d.phase === "ROUND_PLAYING" || d.phase === "ROUND_REVEAL";

function waitForGameOver(p, ms) {
  return new Promise((resolve, reject) => {
    if (p.gameOver) return resolve(p.gameOver);
    const timer = setTimeout(() => reject(new Error("game did not end in time")), ms);
    p.s.once("gameOver", (d) => { clearTimeout(timer); resolve(d); });
  });
}

// ----- tests -----

describe("knockout start guards", () => {
  it("refuses a 2-player SLOWEST match and explains why", async () => {
    const r = await room("Host", ["Guest"]);
    r.host.s.emit("startGame", { format: "KNOCKOUT", knockout: "SLOWEST", genre: "pop" });
    await new Promise((res) => setTimeout(res, 600));
    expect(r.host.errors.join(" ")).toContain("at least 3 players");
    // Refused cleanly: the room is still in the lobby, not stuck loading.
    expect(r.host.states.at(-1).phase).toBe("LOBBY");
    closeAll(r);
  }, 20000);

  it("allows a 2-player LIVES duel", async () => {
    const r = await room("Host", ["Guest"]);
    r.host.s.emit("startGame", { format: "KNOCKOUT", knockout: "LIVES", genre: "pop" });
    const cd = await once(r.host.s, "countdown");
    expect(cd.round).toBe(1);

    // A duel starts with 4 lives, not 3. Read a state from inside the match:
    // the lobby state predates the format being applied.
    const live = await waitForState(r.host, inRound);
    expect(live.format).toBe("KNOCKOUT");
    expect(live.knockout).toBe("LIVES");
    expect(live.players.every((p) => p.lives === 4)).toBe(true);

    // The duel must terminate, and within its bound of 2 * 4 - 1 = 7 rounds.
    const over = await waitForGameOver(r.host, 150000);
    expect(r.host.reveals.length).toBeLessThanOrEqual(7);
    expect(over.leaderboard).toHaveLength(2);
    expect(over.leaderboard.map((x) => x.placement).sort()).toEqual([1, 2]);
    closeAll(r);
  }, 180000);
});

describe("SLOWEST knockout", () => {
  it("eliminates exactly one player per round and ignores settings.rounds", async () => {
    // 7 players with rounds set to 5. SLOWEST must run 6 rounds, proving the
    // round setting does not end a knockout.
    const r = await room("P1", ["P2", "P3", "P4", "P5", "P6", "P7"]);
    r.host.s.emit("startGame", {
      format: "KNOCKOUT",
      knockout: "SLOWEST",
      rounds: 5,
      roundMs: 7500,
      genre: "pop",
    });

    const over = await waitForGameOver(r.host, 150000);

    // Exactly one elimination per round, every round.
    for (const rev of r.host.reveals) {
      expect(rev.eliminated).toHaveLength(1);
    }
    // 7 players means 6 rounds, which is past the rounds:5 setting.
    expect(r.host.reveals.length).toBe(6);
    expect(r.host.reveals.at(-1).round).toBe(6);

    // No round total is advertised anywhere under knockout.
    expect(r.host.reveals.every((x) => x.totalRounds === null)).toBe(true);
    const roundStates = r.host.states.filter(inRound);
    expect(roundStates.length).toBeGreaterThan(0);
    expect(roundStates.every((x) => x.totalRounds === null)).toBe(true);
    expect(roundStates.every((x) => x.format === "KNOCKOUT")).toBe(true);

    // Everyone is placed 1..7, each place used exactly once, nobody dropped.
    expect(over.leaderboard).toHaveLength(7);
    expect(over.leaderboard.map((x) => x.placement).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(over.leaderboard[0].placement).toBe(1);
    expect(over.format).toBe("KNOCKOUT");
    closeAll(r);
  }, 180000);

  it("stops an eliminated player from guessing but keeps them in the standings", async () => {
    const r = await room("A", ["B", "C"]);
    for (const p of r.all) p.probeWhenOut = true; // try to guess after being knocked out
    r.host.s.emit("startGame", { format: "KNOCKOUT", knockout: "SLOWEST", roundMs: 7500, genre: "pop" });
    const over = await waitForGameOver(r.host, 90000);

    // 3 players: exactly 2 rounds, then one winner.
    expect(r.host.reveals.length).toBe(2);
    expect(over.leaderboard).toHaveLength(3);

    // The first player out tried to guess again in later rounds and was told no.
    const firstOutId = r.host.reveals[0].eliminated[0].id;
    const firstOut = r.all.find((p) => p.id === firstOutId);
    expect(firstOut.errors.some((m) => m.includes("You're out"))).toBe(true);

    // ... and still holds a row and a placement.
    const row = over.leaderboard.find((x) => x.id === firstOutId);
    expect(row).toBeTruthy();
    expect(row.placement).toBe(3);
    closeAll(r);
  }, 120000);
});

describe("classic regression", () => {
  it("still runs a fixed number of rounds and advertises a total", async () => {
    const r = await room("A", ["B"]);
    r.host.s.emit("startGame", { format: "CLASSIC", rounds: 5, roundMs: 7500, genre: "pop" });
    const over = await waitForGameOver(r.host, 120000);

    expect(r.host.reveals.length).toBe(5);
    expect(r.host.reveals.every((x) => x.totalRounds === 5)).toBe(true);
    // No knockout machinery leaks into a classic match.
    expect(r.host.reveals.every((x) => x.eliminated.length === 0)).toBe(true);
    expect(over.leaderboard.every((x) => x.placement == null)).toBe(true);
    closeAll(r);
  }, 150000);
});
