// Playing: audio round, options, CRT timer, local countdown.
import { useEffect, useRef, useState } from "react";
import { EYEBROW, BTN_GHOST, ReactionBar } from "../ui";

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
export function Playing({ state, roundMeta, myGuess, hasGuessed, spectator, onGuess, onReact, audioRef }) {
  const locked = hasGuessed || spectator; // spectators can't answer
  const startRef = useRef(() => {});
  const [needsTap, setNeedsTap] = useState(false);
  const [audioError, setAudioError] = useState(false);

  // Play a 10-second snippet from a random offset that always leaves room.
  // Drives the persistent, primed root <audio> element via audioRef.
  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;

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

      <TimeCounter
        timeRemainingMs={state.timeRemainingMs}
        round={state.round}
        total={roundSeconds}
      />

      {audioError && (
        <button type="button"
          onClick={retryAudio}
          className="w-full border border-amber px-5 py-3 font-console text-sm uppercase tracking-[0.2em] text-amber transition-colors hover:bg-amber hover:text-black"
        >
          Audio didn't load — retry
        </button>
      )}

      {needsTap && (
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
            {isArtist ? "Pick the artist" : "Pick the track"} — faster = more points · keys 1-
            {state.options.length}
          </p>
        )
      )}

      <ReactionBar onReact={onReact} />
    </div>
  );
}

// The CRT scoreboard — the design signature.
//
// Owns the countdown itself rather than taking `seconds` as a prop: the timer
// ticks 4x/sec, and if Playing held that state every tick would re-render the
// whole round (all option buttons) instead of just this panel.
function TimeCounter({ timeRemainingMs, round, total = 10 }) {
  const seconds = useCountdown(timeRemainingMs, round);
  const pct = Math.max(0, Math.min(100, (seconds / total) * 100));
  const low = seconds <= 3; // the only place red appears outside reveal
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
          className={`font-console text-7xl font-bold tabular-nums leading-none ${
            low ? "phosphor-bad animate-flicker" : "phosphor"
          }`}
        >
          {mm}:{ss}
        </span>
      </div>
      <div className="mt-4 h-1.5 w-full bg-rule">
        <div
          className={`h-full transition-[width,background-color] duration-1000 ease-linear ${low ? "bg-bad" : "bg-amber"}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

// ---------- Display-only countdown ----------
// Seeds from the server's timeRemainingMs at the start of each round and ticks
// down locally for smooth display. The server is still the only authority on
// scoring — this number never leaves the client.
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
