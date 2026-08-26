// Daily challenge results — score, glyph grid, streak, board, share.
// Rendered from the server's daily:finish payload; guests see their local
// streak, verified players see their global rank.
import { useEffect, useState } from "react";
import { EYEBROW, PANEL, BTN_AMBER, BTN_GHOST } from "../ui";

// "HH:MM:SS" until the next UTC midnight (when the next puzzle unlocks).
function untilNextPuzzle() {
  const now = new Date();
  const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  let s = Math.max(0, Math.floor((next - now.getTime()) / 1000));
  const h = String(Math.floor(s / 3600)).padStart(2, "0");
  const m = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
  const sec = String(s % 60).padStart(2, "0");
  return `${h}:${m}:${sec}`;
}

export function DailyResults({ finish, localStreak, onHome }) {
  const [copied, setCopied] = useState(false);
  const [left, setLeft] = useState(untilNextPuzzle());

  useEffect(() => {
    const t = setInterval(() => setLeft(untilNextPuzzle()), 1000);
    return () => clearInterval(t);
  }, []);

  const streak = finish.streak ?? localStreak ?? 0;
  const correct = finish.perRound.filter(Boolean).length;

  const share = async () => {
    try {
      await navigator.clipboard.writeText(finish.shareText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard blocked — the text is visible on screen anyway */
    }
  };

  return (
    <div className="mx-auto w-full max-w-sm animate-rise space-y-6">
      <div>
        <p className={EYEBROW}>Daily #{finish.number} complete</p>
        <p className="mt-3 font-marquee text-5xl font-black tabular-nums text-amber">{finish.score}</p>
        <p className="mt-2 font-console text-sm text-dim">
          {correct} of {finish.perRound.length} correct
        </p>
      </div>

      <div className={`${PANEL} px-4 py-4`}>
        <p className="text-center font-marquee text-2xl tracking-[0.4em] text-bone" aria-label={`Results: ${finish.perRound.map((ok) => (ok ? "correct" : "wrong")).join(", ")}`}>
          {finish.perRound.map((ok) => (ok ? "■" : "□")).join(" ")}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className={`${PANEL} px-4 py-3`}>
          <p className={EYEBROW}>Streak</p>
          <p className="mt-1 font-console text-xl tabular-nums text-bone">{streak}</p>
        </div>
        <div className={`${PANEL} px-4 py-3`}>
          <p className={EYEBROW}>{finish.ranked ? "Your rank" : "Ranked"}</p>
          <p className="mt-1 font-console text-xl tabular-nums text-bone">
            {finish.ranked && finish.myRank ? `#${finish.myRank}` : finish.ranked ? "—" : "Guests: no"}
          </p>
        </div>
      </div>

      {!finish.ranked && (
        <p className="font-console text-xs leading-relaxed text-dim">
          Sign in with Google before playing to appear on the global board.
        </p>
      )}

      {finish.leaderboard.length > 0 && (
        <div className={`${PANEL} px-4 py-3`}>
          <p className={EYEBROW}>Today's board</p>
          <ol className="mt-2 space-y-1">
            {finish.leaderboard.map((row) => (
              <li key={`${row.rank}-${row.name}`} className="flex items-baseline justify-between font-console text-sm">
                <span className="text-dim">
                  <span className="tabular-nums">{row.rank}.</span> <span className="text-bone">{row.name}</span>
                </span>
                <span className="tabular-nums text-amber">{row.score}</span>
              </li>
            ))}
          </ol>
        </div>
      )}

      <button type="button" onClick={share} className={`${BTN_AMBER} w-full`}>
        {copied ? "■ Copied" : "Share result"}
      </button>

      <div className="flex items-center justify-between">
        <p className="font-console text-xs uppercase tracking-[0.2em] text-dim">
          Next puzzle in <span className="tabular-nums text-bone">{left}</span>
        </p>
        <button type="button" onClick={onHome} className={`${BTN_GHOST} px-4`}>
          Home
        </button>
      </div>
    </div>
  );
}
