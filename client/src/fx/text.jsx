// Text effects, ported dependency-free:
//   ScrambleText — Originkit `scrambletext`: characters decode left-to-right
//     through glitch chars with a ░▒▓█ wave cursor.
//   GlitchText — KokonutUI `glitch-text`: RGB-split clone layers jittering
//     behind the real text (CSS keyframes carry the motion).
import { useEffect, useRef, useState } from "react";

const GLITCH_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#$%&";
const WAVE_CHARS = "░▒▓█";

export function ScrambleText({ text, className = "", durationMs = 900, delayMs = 0 }) {
  const [shown, setShown] = useState(text);
  const rafRef = useRef(null);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setShown(text);
      return;
    }
    let raf;
    let t0 = null;
    const step = (now) => {
      if (t0 === null) t0 = now + delayMs;
      const k = Math.max(0, Math.min(1, (now - t0) / durationMs));
      // Decode sweeps left to right; ahead of the sweep sits a short block-wave
      // cursor, beyond it raw glitch noise.
      const resolved = Math.floor(k * text.length);
      let out = text.slice(0, resolved);
      for (let i = resolved; i < text.length; i++) {
        const ch = text[i];
        if (ch === " " || ch === "\n") { out += ch; continue; }
        out +=
          i - resolved < 2
            ? WAVE_CHARS[Math.floor(Math.random() * WAVE_CHARS.length)]
            : GLITCH_CHARS[Math.floor(Math.random() * GLITCH_CHARS.length)];
      }
      setShown(out);
      if (k < 1) raf = rafRef.current = requestAnimationFrame(step);
      else setShown(text);
    };
    raf = rafRef.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [text, durationMs, delayMs]);

  // aria: announce the real text, not the scramble frames.
  return (
    <span className={className} aria-label={text} role="text">
      <span aria-hidden="true">{shown}</span>
    </span>
  );
}

// data-text feeds the ::before/::after clone layers (see index.css .fx-glitch).
export function GlitchText({ text, className = "" }) {
  return (
    <span className={`fx-glitch relative inline-block ${className}`} data-text={text}>
      {text}
    </span>
  );
}
