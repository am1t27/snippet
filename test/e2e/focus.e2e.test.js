// End-to-end Focus tests: a real server process, real Socket.IO clients, real
// rounds. Covers what unit tests cannot - that the cover round withholds audio,
// that the art proxy serves the current step, and that it REFUSES a step ahead
// of the round clock, which is the security property the mode rests on.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawn } from "node:child_process";
import { io as connect } from "socket.io-client";

const PORT = 4601;
const URL = `http://127.0.0.1:${PORT}`;
let server;

beforeAll(async () => {
  server = spawn("node", ["server.js"], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: String(PORT), CLIENT_ORIGIN: "*", NODE_ENV: "test", CATALOG_INGEST: "off" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("server did not start")), 20000);
    server.stdout.on("data", (b) => {
      if (String(b).includes("listening")) { clearTimeout(timer); resolve(); }
    });
  });
}, 30000);

afterAll(() => { if (server) server.kill("SIGKILL"); });

const sock = () => connect(URL, { transports: ["websocket"], forceNew: true });
const once = (s, e) => new Promise((r) => s.once(e, r));

async function player(name) {
  const s = sock();
  await once(s, "connect");
  const p = { s, name, id: null, states: [], reveals: [], roundStarts: [] };
  s.on("roomJoined", (d) => { p.id = d.id; });
  s.on("state", (d) => p.states.push(d));
  s.on("reveal", (d) => p.reveals.push(d));
  s.on("roundStart", (d) => p.roundStarts.push(d));
  return p;
}

async function room(names) {
  const [hostName, ...guests] = names;
  const host = await player(hostName);
  host.s.emit("createRoom", { name: hostName });
  const { code } = await once(host.s, "roomJoined");
  const rest = [];
  for (const n of guests) {
    const g = await player(n);
    g.s.emit("joinRoom", { name: n, code });
    await once(g.s, "roomJoined");
    rest.push(g);
  }
  return { host, all: [host, ...rest], code };
}

const inRound = (d) => d.phase === "ROUND_PLAYING" || d.phase === "ROUND_REVEAL";

describe("Focus cover rounds", () => {
  it("withholds audio, mints an art token, and gates the ladder by the clock", async () => {
    const r = await room(["Ana", "Bo"]);
    r.host.s.emit("startGame", { clue: "COVER", rounds: 5, roundMs: 15000, genre: "pop" });

    const started = await once(r.host.s, "roundStart");
    // The round carries an opaque token and the ladder length, nothing else.
    expect(typeof started.artToken).toBe("string");
    expect(started.artToken.length).toBeGreaterThan(20);
    expect(started.artSteps).toBe(10);

    // Wait for the playing state so the round clock is running.
    await new Promise((res) => setTimeout(res, 600));

    // No audio reaches the client, in any state, ever.
    const roundStates = r.host.states.filter(inRound);
    expect(roundStates.length).toBeGreaterThan(0);
    expect(roundStates.every((s) => s.audioUrl === null)).toBe(true);
    expect(roundStates.every((s) => s.clue === "COVER")).toBe(true);

    // No image-host URL is ever handed to the client.
    const asText = JSON.stringify(roundStates) + JSON.stringify(r.host.roundStarts);
    expect(asText).not.toContain("mzstatic.com");

    // The blurriest step is served immediately.
    const early = await fetch(`${URL}/art/${started.artToken}/0`);
    expect(early.status).toBe(200);
    expect(early.headers.get("content-type")).toBe("image/jpeg");
    const bytes = Number(early.headers.get("content-length"));
    expect(bytes).toBeGreaterThan(0);
    expect(bytes).toBeLessThan(5000); // an 8x8 jpeg, not the full cover

    // THE security assertion: a step ahead of the clock is refused.
    const ahead = await fetch(`${URL}/art/${started.artToken}/5`);
    expect(ahead.status).toBe(403);

    // An unknown token is refused cleanly, never a 500.
    const bogus = await fetch(`${URL}/art/not-a-real-token/0`);
    expect(bogus.status).toBe(403);

    // Later in the round the sharper step becomes available, proving the gate
    // opens with the clock rather than being permanently closed.
    await new Promise((res) => setTimeout(res, 11000));
    const late = await fetch(`${URL}/art/${started.artToken}/4`);
    expect(late.status).toBe(200);
    const lateBytes = Number(late.headers.get("content-length"));
    expect(lateBytes).toBeGreaterThan(bytes); // sharper means bigger

    for (const p of r.all) p.s.close();
  }, 90000);

  it("reveals the full cover and the answer once the round is over", async () => {
    const r = await room(["Cy", "Di"]);
    r.host.s.emit("startGame", { clue: "COVER", rounds: 5, roundMs: 7500, genre: "pop" });
    const rev = await new Promise((res) => r.host.s.once("reveal", res));
    expect(rev.track.trackName).toBeTruthy();
    // The reveal may legitimately carry the artwork: the round is over.
    expect(rev.correct).toBeTruthy();
    for (const p of r.all) p.s.close();
  }, 60000);
});

describe("audio rounds are unregressed", () => {
  it("still sends a clip and no art token", async () => {
    const r = await room(["Eve", "Fay"]);
    r.host.s.emit("startGame", { clue: "AUDIO", rounds: 5, roundMs: 7500, genre: "pop" });
    const started = await once(r.host.s, "roundStart");
    expect(started.artToken).toBe(null);
    expect(started.artSteps).toBe(0);

    await new Promise((res) => setTimeout(res, 600));
    const roundStates = r.host.states.filter(inRound);
    expect(roundStates.some((s) => typeof s.audioUrl === "string")).toBe(true);
    expect(roundStates.every((s) => s.clue === "AUDIO")).toBe(true);
    for (const p of r.all) p.s.close();
  }, 60000);
});
