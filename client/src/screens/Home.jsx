// Home hub, profile, and side menu — landing surfaces outside a room.
import { useEffect, useRef, useState } from "react";
import { EYEBROW, PANEL } from "../ui";

// The music-games catalog shown on the Home hub and in the side menu. Each
// "play" game routes into the room flow (some preset a clip mode); "soon" games
// are placeholders. Glyphs are typographic marks, not emoji (§12).
export const GAMES = [
  { key: "musicquiz", glyph: "♬", title: "Music Quiz", sub: "Name the track from a 10s snippet", status: "play", clip: "RANDOM" },
  { key: "heardle", glyph: "▶", title: "Heardle", sub: "Guess the song from its intro", status: "play", clip: "INTRO" },
  { key: "create", glyph: "+", title: "Create", sub: "Private room — challenge your friends", status: "play", clip: "RANDOM" },
  { key: "harmonies", glyph: "⌘", title: "Harmonies", sub: "Music connections puzzle", status: "soon" },
  { key: "wordzic", glyph: "▦", title: "Wordzic", sub: "Guess the music word", status: "soon" },
  { key: "lyricles", glyph: "❝", title: "Lyricles", sub: "Guess the song from its lyrics", status: "soon" },
  { key: "crosszic", glyph: "✚", title: "Crosszic", sub: "Music crossword puzzle", status: "soon" },
];

// ---------- Home hub (landing) ----------
export function Home({ games, stats, onOpen, onProfile }) {
  return (
    <div className="animate-rise space-y-10">
      <div className="space-y-3">
        <p className="font-coin text-sm leading-relaxed text-pink">INSERT COIN</p>
        <h2 className="font-marquee text-3xl font-black uppercase leading-[1.05] tracking-tight text-bone">
          Guess the song.
          <br />
          Beat your friends.
        </h2>
        <p className="font-console text-sm text-dim">
          Free real-time music games. Hear a snippet, name the track, score faster than everyone else.
        </p>
      </div>

      <button
        onClick={onProfile}
        className={`${PANEL} flex w-full items-center justify-between px-4 py-3 text-left transition-colors hover:border-amber/60`}
      >
        <span className={EYEBROW}>Your profile</span>
        <span className="font-console text-xs tabular-nums text-dim">
          {stats.games} games · {stats.wins} wins · best {stats.bestScore}
        </span>
      </button>

      <div>
        <p className={EYEBROW}>Music games</p>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {games.map((g) => (
            <GameCard key={g.key} game={g} onOpen={onOpen} />
          ))}
        </div>
      </div>

      <WhySnippet />
      <Faq />
      <SiteFooter />
    </div>
  );
}

export function GameCard({ game, onOpen }) {
  const playable = game.status === "play";
  return (
    <button
      onClick={() => playable && onOpen(game)}
      disabled={!playable}
      className={`${PANEL} flex items-start gap-3 px-4 py-4 text-left transition-colors ${
        playable ? "hover:border-pink" : "opacity-60"
      }`}
    >
      <span className="grid h-9 w-9 shrink-0 place-items-center border border-rule bg-void font-marquee text-lg text-pink">
        {game.glyph}
      </span>
      <span className="min-w-0">
        <span className="flex items-center gap-2">
          <span className="font-console text-sm uppercase tracking-wide text-bone">{game.title}</span>
          {!playable && (
            <span className="font-console text-[11px] uppercase tracking-[0.2em] text-amber">Soon</span>
          )}
        </span>
        <span className="mt-1 block font-console text-xs text-dim">{game.sub}</span>
        {playable && (
          <span className="mt-2 inline-block font-console text-[11px] uppercase tracking-[0.2em] text-pink">
            ▶ Play
          </span>
        )}
      </span>
    </button>
  );
}

export function WhySnippet() {
  const items = [
    { t: "Massive library", d: "Real preview clips across every genre, re-sampled every round." },
    { t: "Real-time multiplayer", d: "Private rooms, up to 8 players, scored by speed." },
    { t: "Your way", d: "Pick rounds, timer, answers, era, and title-vs-artist mode." },
    { t: "Completely free", d: "No downloads, no account needed. Just open and play." },
  ];
  return (
    <div>
      <p className={EYEBROW}>Why Snippet</p>
      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        {items.map((i) => (
          <div key={i.t} className={`${PANEL} px-4 py-3`}>
            <p className="font-console text-sm uppercase tracking-wide text-bone">{i.t}</p>
            <p className="mt-1 font-console text-xs leading-relaxed text-dim">{i.d}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

export const FAQ_ITEMS = [
  {
    q: "What makes a good guess-the-song game?",
    a: "A big music library, fair audio, and fast speed-scored rounds. Snippet adds private rooms, host settings, and reconnect so a dropped player keeps their score.",
  },
  {
    q: "Can I play with friends online?",
    a: "Yes. Create a private room and share the code or link, or hit Quick Play to match into a public lobby. Up to 8 players per room, plus spectators.",
  },
  {
    q: "Can I focus on a genre or era?",
    a: "The host picks a genre (hip-hop, R&B, rap, drill, trap) and a decade filter — all the way back to the 90s — before starting.",
  },
  {
    q: "Do I need to download anything?",
    a: "No. It runs in the browser and installs as a PWA if you want an app icon. No account required — sign in with Google only if you want a verified name and avatar.",
  },
];

export function Faq() {
  const [open, setOpen] = useState(-1);
  return (
    <div>
      <p className={EYEBROW}>Popular questions</p>
      <div className="mt-3 space-y-2">
        {FAQ_ITEMS.map((f, i) => {
          const isOpen = open === i;
          return (
            <div key={i} className={PANEL}>
              <button
                onClick={() => setOpen(isOpen ? -1 : i)}
                aria-expanded={isOpen}
                aria-controls={`faq-answer-${i}`}
                className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
              >
                <span className="font-console text-xs uppercase tracking-wide text-bone">{f.q}</span>
                <span className="shrink-0 font-console text-amber" aria-hidden="true">{isOpen ? "−" : "+"}</span>
              </button>
              {isOpen && (
                <p id={`faq-answer-${i}`} className="border-t border-rule px-4 py-3 font-console text-xs leading-relaxed text-dim">{f.a}</p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function SiteFooter() {
  return (
    <footer className="border-t border-rule pt-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="font-marquee text-lg font-black uppercase tracking-tight text-bone">Snippet</span>
        <span className={EYEBROW}>Free music guessing games</span>
      </div>
      <p className="mt-3 font-console text-xs leading-relaxed text-dim">
        Preview clips via the iTunes Search API. Made for fun — not affiliated with Apple.
      </p>
    </footer>
  );
}

// ---------- My profile (local stats) ----------
export function Profile({ stats, onBack }) {
  const acc = stats.rounds > 0 ? Math.round((stats.correct / stats.rounds) * 100) : 0;
  const winRate = stats.games > 0 ? Math.round((stats.wins / stats.games) * 100) : 0;
  const rows = [
    { k: "Games played", v: stats.games },
    { k: "Wins", v: `${stats.wins} · ${winRate}%` },
    { k: "Best score", v: stats.bestScore },
    { k: "Correct", v: `${stats.correct} / ${stats.rounds} · ${acc}%` },
  ];
  return (
    <div className="animate-rise space-y-6">
      <button onClick={onBack} className={`${EYEBROW} inline-flex min-h-11 items-center hover:text-amber`}>
        ‹ Home
      </button>
      <div>
        <p className="font-coin text-sm text-pink">MY PROFILE</p>
        <p className="mt-2 font-console text-sm text-dim">Your stats on this device — play more to fill them in.</p>
      </div>
      <ul className={`${PANEL} divide-y divide-rule`}>
        {rows.map((r) => (
          <li key={r.k} className="flex items-center justify-between px-4 py-3">
            <span className="font-console text-xs uppercase tracking-wide text-dim">{r.k}</span>
            <span className="font-console text-sm tabular-nums text-bone">{r.v}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---------- Slide-in side menu ----------
export function LanguageSelect() {
  const [lang, setLang] = useState("EN");
  return (
    <select
      value={lang}
      onChange={(e) => setLang(e.target.value)}
      aria-label="Game language"
      className="mt-2 w-full border border-rule bg-void px-3 py-2 font-console text-sm text-bone focus:border-pink focus:outline-none"
    >
      <option value="EN">English</option>
      <option value="SOON" disabled>
        More languages soon…
      </option>
    </select>
  );
}

export function SideMenu({ games, onClose, onHome, onOpen, onProfile }) {
  const playable = games.filter((g) => g.status === "play");
  const panelRef = useRef(null);

  // Modal a11y: focus into the panel on open, trap Tab, close on Escape, and
  // restore focus to the trigger on close (WCAG 2.4.3 / 2.1.2 / 4.1.2).
  useEffect(() => {
    const prevFocused = document.activeElement;
    const panel = panelRef.current;
    const focusables = () =>
      panel
        ? Array.from(
            panel.querySelectorAll(
              'button, [href], select, input, [tabindex]:not([tabindex="-1"])'
            )
          ).filter((el) => !el.disabled)
        : [];
    const first = focusables()[0];
    if (first) first.focus();

    const onKey = (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key === "Tab") {
        const items = focusables();
        if (items.length === 0) return;
        const a = items[0];
        const b = items[items.length - 1];
        if (e.shiftKey && document.activeElement === a) {
          e.preventDefault();
          b.focus();
        } else if (!e.shiftKey && document.activeElement === b) {
          e.preventDefault();
          a.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      if (prevFocused && typeof prevFocused.focus === "function") prevFocused.focus();
    };
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[70] flex" role="dialog" aria-modal="true" aria-label="Menu">
      <nav
        ref={panelRef}
        className="animate-rise w-72 max-w-[80vw] overflow-y-auto border-r border-rule bg-cabinet px-5 py-6"
      >
        <div className="flex items-center justify-between">
          <span className="font-marquee text-xl font-black uppercase tracking-tight text-bone">Snippet</span>
          <button
            onClick={onClose}
            aria-label="Close menu"
            className="inline-flex min-h-11 min-w-11 items-center justify-center font-console text-xl text-dim transition-colors hover:text-pink"
          >
            ✕
          </button>
        </div>

        <p className={`${EYEBROW} mt-8`}>Play</p>
        <ul className="mt-3 space-y-1">
          {playable.map((g) => (
            <li key={g.key}>
              <button
                onClick={() => onOpen(g)}
                className="flex min-h-11 w-full items-center gap-3 px-1 py-2 text-left font-console text-sm text-bone transition-colors hover:text-pink"
              >
                <span className="w-5 text-center text-pink">{g.glyph}</span>
                {g.title}
              </button>
            </li>
          ))}
        </ul>

        <p className={`${EYEBROW} mt-8`}>You</p>
        <ul className="mt-3 space-y-1">
          <li>
            <button onClick={onHome} className="inline-flex min-h-11 items-center px-1 py-2 font-console text-sm text-bone transition-colors hover:text-pink">
              All games
            </button>
          </li>
          <li>
            <button onClick={onProfile} className="inline-flex min-h-11 items-center px-1 py-2 font-console text-sm text-bone transition-colors hover:text-pink">
              My profile
            </button>
          </li>
        </ul>

        <div className="mt-8">
          <p className={EYEBROW}>Game language</p>
          <LanguageSelect />
        </div>

        <p className="mt-8 font-console text-xs leading-relaxed text-dim">
          Share the game with friends for even more fun.
        </p>
      </nav>
      <button aria-label="Close menu" onClick={onClose} className="flex-1 bg-void/70 backdrop-blur-sm" />
    </div>
  );
}
