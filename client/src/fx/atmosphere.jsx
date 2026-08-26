// Atmosphere pieces (MagicUI / Aceternity-inspired, dependency-free):
//   AuroraLayer  — app-wide ambient color drift (pure CSS, one div).
//   RetroGrid    — neon perspective grid floor for hero sections.
//   GenreMarquee — arcade-marquee ticker of the playable genres.
//   Reveal       — scroll-triggered rise-in for below-the-fold sections.
//   useSpotlight — delegated pointer tracking that feeds .fx-spot cards.
import { useEffect, useRef, useState } from "react";

export function AuroraLayer() {
  return <div className="fx-aurora" aria-hidden="true" />;
}

export function RetroGrid({ className = "" }) {
  return <div className={`fx-retro-grid ${className}`} aria-hidden="true" />;
}

const GENRES = ["HIP-HOP", "DRILL", "TRAP", "R&B", "POP", "INDIE", "COUNTRY", "BOLLYWOOD"];

export function GenreMarquee() {
  // Two identical tracks make the loop seamless (the second scrolls into
  // view as the first leaves). Decorative: screen readers skip it.
  const track = (key) => (
    <div key={key}>
      {GENRES.map((g) => (
        <span key={g} className="flex items-center gap-10 font-marquee text-sm font-black uppercase tracking-[0.3em] text-dim">
          {g} <span className="text-pink">★</span>
        </span>
      ))}
    </div>
  );
  return (
    <div className="fx-marquee py-3" aria-hidden="true">
      {track("a")}
      {track("b")}
    </div>
  );
}

// Wraps a section; adds .is-in when ~15% visible (once).
export function Reveal({ children, className = "" }) {
  const ref = useRef(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || !("IntersectionObserver" in window)) {
      setInView(true);
      return;
    }
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setInView(true);
          io.disconnect();
        }
      },
      { threshold: 0.15 }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <div ref={ref} className={`fx-reveal ${inView ? "is-in" : ""} ${className}`}>
      {children}
    </div>
  );
}

// One document-level listener feeds every .fx-spot card its pointer position
// (cheaper than a listener per card; writes CSS vars, no React state).
export function useSpotlight() {
  useEffect(() => {
    if (!window.matchMedia("(pointer: fine)").matches) return;
    const onMove = (e) => {
      const el = e.target.closest?.(".fx-spot");
      if (!el) return;
      const rect = el.getBoundingClientRect();
      el.style.setProperty("--mx", `${e.clientX - rect.left}px`);
      el.style.setProperty("--my", `${e.clientY - rect.top}px`);
    };
    document.addEventListener("pointermove", onMove, { passive: true });
    return () => document.removeEventListener("pointermove", onMove);
  }, []);
}
