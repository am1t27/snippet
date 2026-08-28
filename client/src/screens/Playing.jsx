// Playing: audio or cover round, options, CRT timer, local countdown.
import { useEffect, useRef, useState } from "react";
import { EYEBROW, BTN_GHOST, ReactionBar } from "../ui";
import { Waveform } from "../waveform";

// Fallback scoring constants, mirroring server.js (banner uses roundMeta first).
const QUESTION_BASE = 300;
const QUESTION_STEP = 250;
const MAX_SPEED_BONUS = 350;

// strings so Tailwind's JIT picks them up.
const OPT_COLORS = [
  { num: "text-cyan", sel: "border-cyan bg-cyan/10 ring-cyan", hov: "enabled:hover:border-cyan enabled:hover:bg-cyan/10" },
  { num: "text-pink", sel: "border-pink bg-pink/10 ring-pink", hov: "enabled:hover:border-pink enabled:hover:bg-pink/10" },
  { num: "text-good", sel: "border-good bg-good/10 ring-good", hov: "enabled:hover:border-good enabled:hover:bg-good/10" },
  { num: "text-yellow", sel: "border-yellow bg-yellow/10 ring-yellow", hov: "enabled:hover:border-yellow enabled:hover:bg-yellow/10" },
];

// ---------- Playing ----------
export function Playing({ state, roundMeta, myGuess, hasGuessed, spectator, eliminated, onGuess, onReact, ghost, audioRef }) {
  const locked = hasGuessed || spectator || eliminated; // spectators and knocked-out players can't answer
  const startRef = useRef(() => {});
  const [needsTap, setNeedsTap] = useState(false);
  const [audioError, setAudioError] = useState(false);

  // Play a 10-second snippet from a random offset that always leaves room.
  // Drives the persistent, primed root <audio> element via audioRef.
  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    // COVER rounds have no clip. Leave the primed element alone entirely rather
    // than pointing it at null, which would abort playback noisily.
    if (state.clue === "COVER" || !state.audioUrl) return;

    let pauseTimer = null;

    // Point the primed, persistent element at this round's clip. Pause first to
    // avoid an "interrupted by load()" abort if a previous play is still pending.
    el.pause();
    el.src = state.audioUrl;
    el.load();

    const start = () => {
      try {
        if (state.clip === "INTRO") {
          el.currentTime = 0; // Heardle-style: play from the very start
        } else {
          const maxOffset = Math.max(0, el.duration - 10);
          el.currentTime = Math.random() * Math.min(15, maxOffset);
        }
      } catch {
        /* not seekable yet; the loadedmetadata handler will run start() */
      }
      const p = el.play();
      if (p && typeof p.then === "function") {
        p.then(() => {
          setNeedsTap(false);
          setAudioError(false);
        }).catch(() => setNeedsTap(true));
      }
      if (pauseTimer) clearTimeout(pauseTimer);
      // Play for the whole round, not a hardcoded 10s (a 15s round would
      // otherwise sit in silence for its final seconds).
      pauseTimer = setTimeout(() => el.pause(), state.roundMs ?? 10000);
    };
    startRef.current = start;

    const onError = () => setAudioError(true);
    el.addEventListener("error", onError);

    if (el.readyState >= 1) start();
    else el.addEventListener("loadedmetadata", start, { once: true });

    return () => {
      if (pauseTimer) clearTimeout(pauseTimer);
      el.removeEventListener("loadedmetadata", start);
      el.removeEventListener("error", onError);
      el.pause();
    };
    // Keyed on audioUrl only, by design: state.clip and state.roundMs are fixed
    // for the match and every new round brings a new audioUrl, so they can never
    // change without this effect re-running anyway. Adding them would restart
    // playback mid-round on an unrelated state update.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.audioUrl, audioRef]);

  // Manual recovery from an audio load/decode failure.
  const retryAudio = () => {
    const el = audioRef.current;
    if (!el) return;
    setAudioError(false);
    el.load();
    el.play().then(() => setNeedsTap(false)).catch(() => setNeedsTap(true));
  };

  // Arcade keys 1-4 to answer (also an a11y win). Guard once-guessed/spectator.
  useEffect(() => {
    if (locked) return;
    const onKey = (e) => {
      const i = parseInt(e.key, 10);
      if (i >= 1 && i <= (state.options?.length ?? 0)) onGuess(state.options[i - 1]);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [locked, state.options, onGuess]);

  // Round value chip. Prefer the server's roundStart values (roundMeta).
  const questionValue =
    roundMeta?.questionValue ?? QUESTION_BASE + (state.round - 1) * QUESTION_STEP;
  const maxSpeedBonus = roundMeta?.maxSpeedBonus ?? MAX_SPEED_BONUS;
  const isArtist = state.mode === "ARTIST";
  const roundSeconds = Math.round((state.roundMs ?? 10000) / 1000);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <span className={EYEBROW}>
          {isArtist ? "Name the artist" : "Name the track"}
          {state.clip === "INTRO" ? " · intro" : ""}
        </span>
        <span className="font-console text-xs uppercase tracking-[0.18em] text-dim">
          QV <span className="text-amber">{questionValue}</span> · Speed ≤{maxSpeedBonus}
        </span>
      </div>

      {state.format === "KNOCKOUT" && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-rule pb-3">
          <span className={EYEBROW}>
            {state.players.filter((p) => !p.spectator && !p.eliminated).length} still in
          </span>
          {state.knockout === "LIVES" && (
            <span className="flex flex-wrap justify-end gap-x-3 gap-y-1">
              {state.players
                .filter((p) => !p.spectator)
                .map((p) => (
                  <span
                    key={p.id}
                    className={`font-console text-[11px] uppercase tracking-[0.15em] ${
                      p.eliminated ? "text-dim line-through" : "text-bone"
                    }`}
                  >
                    {p.name}{" "}
                    <span aria-hidden="true" className={p.eliminated ? "text-dim" : "text-amber"}>
                      {"\u25CF".repeat(Math.max(0, p.lives ?? 0))}
                    </span>
                    <span className="sr-only">{p.lives ?? 0} lives left</span>
                  </span>
                ))}
            </span>
          )}
        </div>
      )}

      <TimeCounter
        timeRemainingMs={state.timeRemainingMs}
        round={state.round}
        total={roundSeconds}
        ghost={ghost && ghost.perRound ? { name: ghost.name, mark: ghost.perRound[state.round - 1] || null } : null}
      />

      {state.clue === "COVER" ? (
        <CoverArt
          token={state.artToken ?? roundMeta?.artToken ?? null}
          steps={roundMeta?.artSteps || 10}
          timeRemainingMs={state.timeRemainingMs}
          roundMs={state.roundMs ?? 10000}
        />
      ) : (
        <Waveform audioRef={audioRef} />
      )}

      {state.clue !== "COVER" && audioError && (
        <button type="button"
          onClick={retryAudio}
          className="w-full border border-amber px-5 py-3 font-console text-sm uppercase tracking-[0.2em] text-amber transition-colors hover:bg-amber hover:text-black"
        >
          Audio didn't load - retry
        </button>
      )}

      {state.clue !== "COVER" && needsTap && (
        <button type="button" onClick={() => startRef.current()} className={`${BTN_GHOST} w-full`}>
          ▶ Play clip
        </button>
      )}

      <div className="grid gap-3">
        {state.options.map((opt, i) => {
          const selected = myGuess === opt;
          const dimmed = locked && !selected; // lock animation
          const c = OPT_COLORS[i % OPT_COLORS.length];
          return (
            // min-w-0: grid items default to min-width:auto, so without this a
            // long track name sets the track's floor and scrolls the page
            // sideways on narrow screens instead of letting the label truncate.
            <div key={opt} className="min-w-0 animate-rise" style={{ animationDelay: `${i * 50}ms` }}>
              <button type="button"
                onClick={() => onGuess(opt)}
                disabled={locked}
                aria-label={`Option ${i + 1}: ${opt}`}
                className={[
                  "flex w-full items-center gap-4 border px-4 py-4 text-left font-console text-sm uppercase tracking-wide text-bone",
                  "transition-[border-color,background-color,opacity,transform] enabled:active:scale-[.96]",
                  selected ? `ring-2 ${c.sel} animate-lockin` : `border-rule bg-cabinet ${c.hov}`,
                  dimmed ? "pointer-events-none opacity-30" : "",
                  "disabled:cursor-not-allowed",
                ].join(" ")}
              >
                <span className={`font-console text-xs ${c.num}`}>{i + 1}</span>
                <span className="min-w-0 truncate">{opt}</span>
              </button>
              {hasGuessed && selected && (
                <p className={`mt-1 animate-rise font-console text-xs uppercase tracking-[0.2em] ${c.num}`}>Locked</p>
              )}
            </div>
          );
        })}
      </div>

      {spectator ? (
        <p className={`${EYEBROW} text-center text-cyan`}>Spectating. You can react, but not guess.</p>
      ) : (
        !hasGuessed && (
          <p className={`${EYEBROW} text-center`}>
            {isArtist ? "Pick the artist" : "Pick the track"} - faster = more points · keys 1-
            {state.options.length}
          </p>
        )
      )}

      <ReactionBar onReact={onReact} />
    </div>
  );
}

// The CRT scoreboard - the design signature.
//
// Owns the countdown itself rather than taking `seconds` as a prop: the timer
// ticks 4x/sec, and if Playing held that state every tick would re-render the
// whole round (all option buttons) instead of just this panel.
function TimeCounter({ timeRemainingMs, round, total = 10, ghost = null }) {
  const seconds = useCountdown(timeRemainingMs, round);
  const pct = Math.max(0, Math.min(100, (seconds / total) * 100));
  // Ghost race: where on this round's clock the current #1 answered. The bar
  // drains right-to-left, so the ghost sits at (remaining when they answered).
  const ghostMark = ghost && ghost.mark && ghost.mark.correct ? ghost.mark : null;
  const ghostPct = ghostMark ? Math.max(0, 100 - (ghostMark.ms / (total * 1000)) * 100) : null;
  const elapsedMs = (total - seconds) * 1000;
  const ghostPassed = ghostMark ? elapsedMs >= ghostMark.ms : false;
  const low = seconds <= 3; // the only place red appears outside reveal
  const warn = !low && seconds <= 6; // amber heats up before it turns red
  const mm = Math.floor(seconds / 60);
  const ss = String(seconds % 60).padStart(2, "0");
  return (
    <div className="bezel border border-rule bg-cabinet px-4 py-5">
      <div className="flex items-center justify-between">
        <span className={EYEBROW}>Time</span>
        <span className={EYEBROW}>{Math.round(pct)}%</span>
      </div>
      {/* Heartbeat wrapper: scale pulse lives on the parent so it can compose
          with the flicker (opacity) animation on the digits themselves. */}
      <div className={`mt-1 text-center ${low ? "animate-beat" : ""}`}>
        <span
          className={`fs-display font-console font-bold tabular-nums ${
            low ? "phosphor-bad animate-flicker" : "phosphor"
          }`}
          style={warn ? { color: "#FF8A3C", textShadow: "0 0 2px rgba(255,138,60,.7), 0 0 12px rgba(255,138,60,.45)" } : undefined}
        >
          {mm}:{ss}
        </span>
      </div>
      <div className="relative mt-4 h-1.5 w-full bg-rule">
        <div
          className={`h-full transition-[width,background-color] duration-1000 ease-linear ${low ? "bg-bad" : warn ? "bg-[#FF8A3C]" : "bg-amber"}`}
          style={{ width: `${pct}%` }}
        />
        {ghostPct != null && (
          <span
            aria-hidden="true"
            className={`absolute -top-[3px] h-3 w-[3px] bg-cyan shadow-[0_0_8px_#36D8FF] ${ghostPassed ? "animate-ghostblip" : ""}`}
            style={{ left: `${ghostPct}%` }}
          />
        )}
      </div>
      {ghostMark && (
        <p className={`mt-2 text-center font-console text-[11px] uppercase tracking-[0.2em] ${ghostPassed ? "text-cyan" : "text-dim"}`}>
          {ghostPassed
            ? `${ghost.name} answered · beat them next round`
            : `Racing ${ghost.name} · ${(ghostMark.ms / 1000).toFixed(1)}s`}
        </p>
      )}
    </div>
  );
}

// ---------- Display-only countdown ----------
// Seeds from the server's timeRemainingMs at the start of each round and ticks
// down locally for smooth display. The server is still the only authority on
// scoring - this number never leaves the client.
function useCountdown(timeRemainingMs, round) {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const endAt = Date.now() + (timeRemainingMs ?? 0);
    const tick = () => setSeconds(Math.max(0, Math.ceil((endAt - Date.now()) / 1000)));
    tick();
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [round]);
  return seconds;
}

// The Focus clue: the album cover as a resolution ladder. Every step is a
// separate request to our own proxy, which refuses any step the round clock has
// not reached, so there is no sharper image sitting on the client to uncover.
//
// Two-stage rendering: `allowed` is what the clock permits, `shown` is the last
// rung whose bytes have actually arrived. Each newly allowed rung is preloaded
// off-screen and promoted only on load, into one stable <img> element. That is
// what keeps the frame and the picture in sync: nothing bordered ever renders
// without pixels inside it, on mount or on any step change.
function CoverArt({ token, steps, timeRemainingMs, roundMs }) {
  const [allowed, setAllowed] = useState(0);
  const [shown, setShown] = useState(-1); // -1: nothing loaded yet
  const startedAt = useRef(0);
  const base = import.meta.env.VITE_SOCKET_URL || "";

  // Seed the local clock from the server's remaining time once per round
  // token, then run the ladder locally. The server broadcasts state on events,
  // not on a tick, so a round where nobody guesses would otherwise never
  // advance the reveal at all.
  useEffect(() => {
    if (!token) return;
    const seeded = Math.max(0, roundMs - (timeRemainingMs ?? roundMs));
    startedAt.current = Date.now() - seeded;
    setAllowed(0);
    setShown(-1);
    // timeRemainingMs seeds the clock once per token; a mid-round broadcast
    // must not restart it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  useEffect(() => {
    if (!token || !steps) return;
    const tick = () => {
      const elapsed = Date.now() - startedAt.current;
      const next = Math.min(steps - 1, Math.floor(elapsed / (roundMs / steps)));
      setAllowed((a) => (next > a ? next : a)); // only ever sharpens
    };
    tick();
    const id = setInterval(tick, 150);
    return () => clearInterval(id);
  }, [token, steps, roundMs]);

  // Preload the newly allowed rung; promote it only when its bytes are in.
  // The visible <img> then swaps src against a warm cache, so the change is a
  // single repaint with no empty frame.
  useEffect(() => {
    if (!token || allowed < 0) return;
    let alive = true;
    const img = new Image();
    img.onload = () => {
      if (alive) setShown((s) => (allowed > s ? allowed : s));
    };
    img.src = `${base}/art/${token}/${allowed}`;
    return () => {
      alive = false;
    };
  }, [token, allowed, base]);

  if (!token) return null;
  return (
    <div className="grid place-items-center">
      {shown < 0 ? (
        // Reserve the exact footprint but draw no frame: the border belongs to
        // the image and must never appear ahead of it.
        <div className="h-[min(70vw,20rem)] w-[min(70vw,20rem)]" aria-hidden="true" />
      ) : (
        <img
          src={`${base}/art/${token}/${shown}`}
          alt="Album cover, partly revealed"
          width="320"
          height="320"
          className="h-[min(70vw,20rem)] w-[min(70vw,20rem)] border border-rule bg-void object-cover"
          style={{ imageRendering: "pixelated" }}
        />
      )}
    </div>
  );
}
