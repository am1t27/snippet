// GenreMarquee — the arcade-cabinet marquee strip: a slow ticker of the
// playable genres. Content-bearing (these are the real catalog genres), quiet
// by design: small mono type, dim ink, one pink star as the only accent.

const GENRES = ["HIP-HOP", "DRILL", "TRAP", "R&B", "POP", "INDIE", "COUNTRY", "BOLLYWOOD"];

export function GenreMarquee() {
  // Two identical tracks make the loop seamless (the second scrolls into
  // view as the first leaves). Decorative: screen readers skip it.
  const track = (key) => (
    <div key={key}>
      {GENRES.map((g) => (
        <span key={g} className="flex items-center gap-10 font-console text-[11px] uppercase tracking-[0.25em] text-dim">
          {g} <span className="text-pink/80">★</span>
        </span>
      ))}
    </div>
  );
  return (
    <div className="fx-marquee py-2.5" aria-hidden="true">
      {track("a")}
      {track("b")}
    </div>
  );
}
