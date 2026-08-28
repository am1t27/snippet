// Live audio waveform - the music drives the interface.
//
// A WebAudio AnalyserNode taps the app's single persistent <audio> element and
// 48 frequency bars follow it in real time via requestAnimationFrame writing
// transforms directly (no per-frame React state). Falls back to a calm static
// bar row when WebAudio is unavailable, the analyser can't attach, or the
// player prefers reduced motion.
//
// WebAudio rule this file exists to respect: createMediaElementSource may be
// called ONCE per media element, ever. The graph is built once, cached on the
// element itself, and reused for the life of the app.
import { useEffect, useRef } from "react";

const BAR_COUNT = 48;
const GRAPH_KEY = "__snippetAnalyser";

// Build (or reuse) the audio graph for this element. Returns null when
// WebAudio isn't available - callers fall back to the static strip.
function analyserFor(el) {
  if (!el) return null;
  if (el[GRAPH_KEY]) return el[GRAPH_KEY];
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return null;
  try {
    const ctx = new Ctx();
    const source = ctx.createMediaElementSource(el);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 128; // 64 bins; we render 48 of them
    analyser.smoothingTimeConstant = 0.75;
    source.connect(analyser);
    analyser.connect(ctx.destination); // keep the clip audible
    el[GRAPH_KEY] = { ctx, analyser };
    return el[GRAPH_KEY];
  } catch {
    return null; // tainted source or unsupported - static fallback
  }
}

export function Waveform({ audioRef }) {
  const barsRef = useRef([]);
  const liveRef = useRef(false);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const graph = analyserFor(audioRef?.current);
    if (!graph) return;
    const { ctx, analyser } = graph;
    if (ctx.state === "suspended") ctx.resume().catch(() => {});
    liveRef.current = true;

    const data = new Uint8Array(analyser.frequencyBinCount);
    let raf;
    const frame = () => {
      analyser.getByteFrequencyData(data);
      const bars = barsRef.current;
      for (let i = 0; i < bars.length; i++) {
        const el = bars[i];
        if (!el) continue;
        // Bins skew low-frequency; spread reads across the useful range.
        const v = data[Math.floor((i / bars.length) * data.length * 0.85)] / 255;
        const scale = 0.08 + v * 0.92;
        el.style.transform = `scaleY(${scale.toFixed(3)})`;
        el.style.opacity = (0.35 + v * 0.65).toFixed(2);
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => {
      liveRef.current = false;
      cancelAnimationFrame(raf);
    };
  }, [audioRef]);

  return (
    <div
      aria-hidden="true"
      className="flex h-12 items-end justify-center gap-[3px] overflow-hidden"
    >
      {Array.from({ length: BAR_COUNT }, (_, i) => (
        <div
          key={i}
          ref={(el) => (barsRef.current[i] = el)}
          className="w-1 origin-bottom rounded-none"
          style={{
            height: "100%",
            transform: "scaleY(0.08)",
            opacity: 0.35,
            background:
              i % 8 === 0
                ? "linear-gradient(to top, #36D8FF, #FFC93C)"
                : "linear-gradient(to top, #36D8FF, #FF3D7F)",
            transition: "transform 60ms linear",
          }}
        />
      ))}
    </div>
  );
}

export default Waveform;
