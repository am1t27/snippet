// Daily archive - every frozen puzzle so far, newest first. Played days show
// their glyph row; any day replays unranked.
import { EYEBROW, PANEL } from "../ui";

export function DailyArchive({ days, onPlay, onBack }) {
  return (
    <div className="mx-auto w-full max-w-sm cascade space-y-6">
      <button type="button" onClick={onBack} className={`${EYEBROW} inline-flex min-h-11 items-center hover:text-amber`}>
        ‹ Back
      </button>

      <div className="glow-wash">
        <p className="font-coin text-sm text-pink">PAST PUZZLES</p>
        <p className="mt-2 font-console text-sm text-dim">
          Replay any day's five songs. Archive runs are practice: no ranking, no streak, no XP.
        </p>
      </div>

      {days === null ? (
        <p className={`${EYEBROW} py-8 text-center`}>Loading…</p>
      ) : days.length === 0 ? (
        <div className={`${PANEL} px-4 py-6 text-center`}>
          <p className="font-console text-sm text-dim">No puzzles archived yet. Come back tomorrow.</p>
        </div>
      ) : (
        <ul className="space-y-2">
          {days.map((d) => (
            <li key={d.day}>
              <button
                type="button"
                onClick={() => onPlay(d.day)}
                className={`${PANEL} flex w-full items-center justify-between px-4 py-3 text-left transition-[border-color] hover:border-pink active:scale-[.98]`}
              >
                <span className="min-w-0">
                  <span className="font-console text-sm uppercase tracking-wide text-bone">Daily #{d.number}</span>
                  <span className="ml-2 font-console text-[11px] tabular-nums uppercase tracking-[0.15em] text-dim">{d.day}</span>
                </span>
                {d.played ? (
                  <span className="shrink-0 text-right">
                    <span className="font-marquee text-sm tracking-[0.25em] text-bone">
                      {d.perRound.map((ok) => (ok ? "■" : "□")).join(" ")}
                    </span>
                    <span className="ml-3 font-console text-sm tabular-nums text-amber">{d.score}</span>
                  </span>
                ) : (
                  <span className="shrink-0 font-console text-[11px] uppercase tracking-[0.2em] text-pink">▶ Play</span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
