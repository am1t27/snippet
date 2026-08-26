// Interaction effects, ported dependency-free:
//   ParticleButton — KokonutUI `particle-button`: a click showers ✦ particles
//     from the button before the action lands.
//   ClickFX — Originkit `clickeffects` (sniper mode): a global crosshair ping
//     wherever the player clicks. Pointer-fine devices only.
import { useEffect, useRef, useState } from "react";

const BURST_VECTORS = [
  [0, -70], [50, -50], [70, 0], [50, 50], [0, 70], [-50, 50], [-70, 0], [-50, -50],
];

// Wraps any button-styled element. Spawns particles at the click point, then
// forwards the click. Purely decorative: the action never waits on it.
export function ParticleButton({ onClick, className = "", disabled, children, ...rest }) {
  const [bursts, setBursts] = useState([]);
  const seq = useRef(0);

  const handle = (e) => {
    if (!disabled && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      const rect = e.currentTarget.getBoundingClientRect();
      const id = ++seq.current;
      setBursts((prev) => [...prev.slice(-3), { id, x: e.clientX - rect.left, y: e.clientY - rect.top }]);
      setTimeout(() => setBursts((prev) => prev.filter((b) => b.id !== id)), 700);
    }
    onClick?.(e);
  };

  return (
    <button type="button" onClick={handle} disabled={disabled} className={`relative overflow-visible ${className}`} {...rest}>
      {children}
      {bursts.map((b) => (
        <span key={b.id} aria-hidden="true" className="pointer-events-none absolute" style={{ left: b.x, top: b.y }}>
          {BURST_VECTORS.map(([x, y], i) => (
            <span
              key={i}
              className="absolute animate-burst font-marquee text-sm text-amber"
              style={{ "--burst-x": `${x}px`, "--burst-y": `${y}px`, animationDelay: `${i * 12}ms` }}
            >
              ✦
            </span>
          ))}
        </span>
      ))}
    </button>
  );
}

// Global click feedback: four crosshair ticks fly outward from every click.
// Renders nothing on touch devices or under reduced motion.
export function ClickFX() {
  const [pings, setPings] = useState([]);
  const seq = useRef(0);

  useEffect(() => {
    if (!window.matchMedia("(pointer: fine)").matches) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const onClick = (e) => {
      const id = ++seq.current;
      setPings((prev) => [...prev.slice(-4), { id, x: e.clientX, y: e.clientY }]);
      setTimeout(() => setPings((prev) => prev.filter((p) => p.id !== id)), 450);
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, []);

  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-0 z-[70]">
      {pings.map((p) => (
        <span key={p.id} className="absolute" style={{ left: p.x, top: p.y }}>
          {[0, 90, 180, 270].map((deg) => (
            <span
              key={deg}
              className="fx-ping absolute block bg-cyan"
              style={{ transform: `rotate(${deg}deg)` }}
            />
          ))}
        </span>
      ))}
    </div>
  );
}
