// ui.jsx — shared design tokens, reusable components, and overlays.
// Extracted from App.jsx; presentation only, no socket/data logic.
import { useEffect, useRef, useState } from "react";
import sound from "./sound";

// ---- Shared class fragments (drive the look across every screen) ----
export const EYEBROW = "font-console text-[11px] uppercase tracking-[0.2em] text-dim";
export const PANEL = "border border-rule bg-cabinet";
// Primary CTA = pink with a soft neon glow.
export const BTN_AMBER =
  "bg-pink px-5 py-4 font-console text-sm uppercase tracking-[0.2em] text-black " +
  "shadow-[0_0_24px_-6px_#FF3D7F] transition-[transform,background-color] hover:bg-[#ff5e96] active:scale-[.96] " +
  "focus:outline-none focus:ring-2 focus:ring-pink focus:ring-offset-2 focus:ring-offset-void " +
  "disabled:cursor-not-allowed disabled:bg-rule disabled:text-dim disabled:shadow-none";
export const BTN_GHOST =
  "border border-rule bg-cabinet px-5 py-3 font-console text-sm uppercase tracking-[0.2em] text-bone " +
  "transition-colors hover:border-amber hover:text-amber active:scale-[.96] " +
  "focus:outline-none focus:ring-2 focus:ring-amber disabled:cursor-not-allowed disabled:opacity-50";

// Reaction call-outs (must match the server's REACTIONS whitelist). Typographic,
// not emoji — keeps the §12 design rule while still being expressive.
const REACTION_TOKENS = ["GG", "WOW", "!!", "??", "★", "♥"];


// Animated count-up for score reveals. Eases out over ~600ms; snaps instantly
// under prefers-reduced-motion. Display-only — never affects real scores.
export function useCountUp(target, duration = 600) {
  const [val, setVal] = useState(0);
  useEffect(() => {
    const n = Number(target) || 0;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setVal(n);
      return;
    }
    let raf;
    const t0 = performance.now();
    const step = (t) => {
      const k = Math.min(1, (t - t0) / duration);
      setVal(Math.round(n * (1 - Math.pow(1 - k, 3)))); // ease-out cubic
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, duration]);
  return val;
}

// ---------- Reusable bits ----------
export function Leaderboard({ rows, myId, title }) {
  return (
    <div>
      {title && <p className={EYEBROW}>{title}</p>}
      <ol className={`mt-3 ${PANEL} divide-y divide-rule`}>
        {rows.map((r, i) => {
          const isMe = myId && r.id === myId;
          const top = i === 0;
          return (
            <li
              key={r.id ?? r.name ?? i}
              className={`flex items-center justify-between px-4 py-3 ${isMe ? "bg-pink/5" : ""}`}
            >
              <span className="flex items-center gap-3">
                <span className={`w-6 font-console text-xs ${top ? "text-amber" : "text-dim"}`}>
                  {String(r.rank ?? i + 1).padStart(2, "0")}
                </span>
                <span className={`font-console uppercase tracking-wide ${top ? "text-bone" : "text-dim"}`}>
                  {r.name}
                </span>
              </span>
              <span className={`font-console tabular-nums ${top ? "text-amber" : "text-dim"}`}>{r.score}</span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

// Square arcade-portrait avatar (zero radius, per the design rules). Falls back
// to the player's initial when there's no Google photo or it fails to load.
export function Avatar({ name, src, size = 26 }) {
  const [broken, setBroken] = useState(false);
  const initial = ((name || "?").trim().charAt(0) || "?").toUpperCase();
  const px = `${size}px`;
  if (src && !broken) {
    return (
      <img
        src={src}
        alt=""
        onError={() => setBroken(true)}
        style={{ width: px, height: px }}
        className="shrink-0 border border-rule object-cover"
      />
    );
  }
  return (
    <span
      aria-hidden="true"
      style={{ width: px, height: px }}
      className="grid shrink-0 place-items-center border border-rule bg-void font-console text-[11px] text-dim"
    >
      {initial}
    </span>
  );
}

// Room chat — used in the lobby and on game over. Rate-limited + masked server
// side; the client just renders.
export function Chat({ messages, onChat, myId, title = "Chat" }) {
  const [text, setText] = useState("");
  const listRef = useRef(null);
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);
  const submit = (e) => {
    e.preventDefault();
    const t = text.trim();
    if (!t) return;
    onChat(t);
    setText("");
  };
  return (
    <div>
      <p className={EYEBROW}>{title}</p>
      <div className={`mt-3 ${PANEL}`}>
        <div ref={listRef} className="max-h-40 space-y-1.5 overflow-y-auto px-4 py-3" aria-live="polite">
          {messages.length === 0 ? (
            <p className="font-console text-xs text-dim">No messages yet. Say hi.</p>
          ) : (
            messages.map((m) => (
              <p key={m.key} className="font-console text-xs leading-snug">
                <span className={m.id === myId ? "text-pink" : "text-cyan"}>{m.name}</span>
                <span className="text-dim"> · </span>
                <span className="break-words text-bone">{m.text}</span>
              </p>
            ))
          )}
        </div>
        <form onSubmit={submit} className="flex border-t border-rule">
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={200}
            placeholder="Message…"
            aria-label="Chat message"
            className="w-full bg-transparent px-4 py-2.5 font-console text-xs text-bone placeholder:text-dim focus:outline-none"
          />
          <button
            type="submit"
            className="border-l border-rule px-4 font-console text-xs uppercase tracking-[0.2em] text-dim transition-colors hover:text-pink"
          >
            Send
          </button>
        </form>
      </div>
    </div>
  );
}

// The 6 reaction call-outs. Tapping floats one over everyone's screen.
export function ReactionBar({ onReact }) {
  return (
    <div className="flex flex-wrap items-center justify-center gap-2">
      {REACTION_TOKENS.map((t) => (
        <button type="button"
          key={t}
          onClick={() => onReact(t)}
          aria-label={`React ${t}`}
          className="inline-flex min-h-11 min-w-11 items-center justify-center border border-rule bg-cabinet px-2 py-1.5 font-console text-xs text-dim transition-[transform,color,border-color] hover:border-amber hover:text-amber active:scale-[.96]"
        >
          {t}
        </button>
      ))}
    </div>
  );
}

// Full-screen, non-interactive layer that floats incoming reactions upward.
export function ReactionOverlay({ reactions }) {
  if (!reactions || reactions.length === 0) return null;
  return (
    <div className="pointer-events-none fixed inset-0 z-[55] overflow-hidden">
      {reactions.map((r) => (
        <div
          key={r.key}
          className="absolute bottom-24 animate-floatup whitespace-nowrap font-marquee text-3xl font-black text-amber phosphor"
          style={{ left: `${12 + (r.lane ?? 0) * 18}%` }}
        >
          {r.token}
          <span className="ml-1 align-middle font-console text-[11px] uppercase tracking-wide text-dim">
            {r.name}
          </span>
        </div>
      ))}
    </div>
  );
}

export function Centered({ eyebrow, title }) {
  return (
    <div className="text-center">
      <p className={EYEBROW}>{eyebrow}</p>
      <h2 className="mt-2 font-marquee text-3xl font-black uppercase tracking-tight text-bone">{title}</h2>
    </div>
  );
}

export function ErrorBar({ message }) {
  return (
    <div
      role="alert"
      className="fixed inset-x-0 top-0 z-50 border-b border-bad bg-void/90 px-5 py-3 text-center font-console text-xs uppercase tracking-[0.2em] text-bad backdrop-blur"
    >
      {message}
    </div>
  );
}

// Bottom toast for room notices (player left, new host) — Feature 5.
export function Toast({ message }) {
  return (
    <div
      role="status"
      className="fixed inset-x-0 bottom-0 z-50 border-t border-rule bg-cabinet px-5 py-3 text-center font-console text-xs uppercase tracking-[0.2em] text-dim"
    >
      {message}
    </div>
  );
}

export function LoadingOverlay({ message }) {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={message ? `Loading: ${message}` : "Loading"}
      className="crt-scan fixed inset-0 z-40 flex flex-col items-center justify-center gap-3 bg-void/95"
    >
      <p className="font-coin text-xs text-pink">LOADING</p>
      <p className="font-console text-sm uppercase tracking-[0.2em] text-dim">
        {message} <span className="animate-blink text-pink">▍</span>
      </p>
    </div>
  );
}

// 3-2-1-GO overlay shown before each round's audio (Feature 3). Also shows the
// round's point worth + max-if-fastest. Server controls the real 3s gap.
export function CountdownOverlay({ seconds, round, worth, maxPoints }) {
  const [n, setN] = useState(seconds ?? 3);
  useEffect(() => {
    let v = seconds ?? 3;
    setN(v);
    sound.play("count");
    const id = setInterval(() => {
      v -= 1;
      setN(v);
      if (v === 0) sound.play("go");
      else if (v > 0) sound.play("count");
      if (v <= -1) clearInterval(id);
    }, 1000);
    return () => clearInterval(id);
  }, [seconds]);
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={`Round ${round ?? 0} starting${n > 0 ? ` in ${n}` : ""}`}
      className="crt-scan fixed inset-0 z-40 flex flex-col items-center justify-center gap-6 bg-void/95 px-6 text-center"
    >
      <p className={EYEBROW}>Round {String(round ?? 0).padStart(2, "0")}</p>
      {n > 0 ? (
        <span key={n} className="animate-digitpop font-marquee text-8xl font-black tabular-nums leading-none phosphor">
          {n}
        </span>
      ) : (
        <span className="animate-digitpop font-coin text-5xl leading-none phosphor-pink">GO</span>
      )}
      {worth != null && (
        <div className="space-y-1">
          <p className="font-console text-sm uppercase tracking-[0.2em] text-bone">
            Worth <span className="text-amber">{worth}</span> pts this round
          </p>
          <p className="font-console text-xs uppercase tracking-[0.2em] text-amber">
            Up to {maxPoints} if you answer fastest
          </p>
        </div>
      )}
    </div>
  );
}
