// Game over: champion, high scores, round history, chat, restart.
import { useState } from "react";
import { EYEBROW, PANEL, BTN_AMBER, Avatar, Chat, Leaderboard, useCountUp } from "../ui";

// ---------- Game Over ----------
export function GameOver({ gameOver, players, myId, onRestart, messages, onChat }) {
  const rows =
    gameOver?.leaderboard ??
    players.toSorted((a, b) => b.score - a.score).map((p, i) => ({ rank: i + 1, ...p }));
  const champ = rows[0];
  const rest = rows.slice(1);
  const history = gameOver?.roundHistory ?? null;
  const avatarOf = {};
  for (const p of players ?? []) avatarOf[p.id] = p.avatar;
  const shownScore = useCountUp(champ?.score ?? 0, 900);

  return (
    <div className="space-y-8">
      <p className="animate-rise text-center font-marquee text-4xl font-black uppercase tracking-tight text-bone [text-wrap:balance]">
        Game Over
      </p>

      {champ && (
        <div
          className="animate-rise border border-amber/50 bg-amber/5 px-6 py-6 text-center shadow-[0_0_36px_-12px_#FFC93C]"
          style={{ animationDelay: "120ms" }}
        >
          <p className="font-coin text-xs text-amber">1UP · Champion</p>
          <div className="mt-3 flex items-center justify-center gap-3">
            <Avatar name={champ.name} src={avatarOf[champ.id]} size={32} />
            <p className="font-console uppercase tracking-wide text-bone">{champ.name}</p>
          </div>
          <p className="mt-1 animate-scoreroll font-marquee text-4xl font-black tabular-nums text-amber">
            {shownScore}
          </p>
        </div>
      )}

      {rest.length > 0 && (
        <div className="animate-rise" style={{ animationDelay: "220ms" }}>
          <p className={EYEBROW}>High scores</p>
          <ol className={`mt-3 ${PANEL} divide-y divide-rule`}>
            {rest.map((r, i) => (
              <li key={r.id ?? r.name ?? i} className="flex items-center justify-between px-4 py-2.5">
                <span className="flex items-center gap-3">
                  <span className="w-6 font-console text-xs text-dim">{String(r.rank ?? i + 2).padStart(2, "0")}</span>
                  <span className="font-console text-sm uppercase tracking-wide text-dim">{r.name}</span>
                </span>
                <span className="font-console text-sm tabular-nums text-dim">{r.score}</span>
              </li>
            ))}
          </ol>
        </div>
      )}

      {history && history.length > 0 && <RoundHistory history={history} />}

      <Chat messages={messages} onChat={onChat} myId={myId} title="Chat" />

      <button type="button" onClick={onRestart} className={`${BTN_AMBER} w-full`}>
        <span aria-hidden="true">↻ </span>Play again
      </button>
    </div>
  );
}

// Collapsible per-round recap shown on game over (Feature 6).
function RoundHistory({ history }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls="round-history"
        className={`${EYEBROW} flex min-h-11 w-full items-center gap-2 text-left hover:text-amber`}
      >
        <span className="text-amber" aria-hidden="true">{open ? "▼" : "▶"}</span> See all rounds
      </button>
      {open && (
        <ol id="round-history" className={`mt-3 ${PANEL} divide-y divide-rule`}>
          {history.map((h, i) => (
            <li key={i} className="flex items-center justify-between gap-3 px-4 py-2.5 font-console text-xs">
              <span className="flex min-w-0 items-center gap-3">
                <span className="w-6 text-dim">{String(i + 1).padStart(2, "0")}</span>
                <span className="truncate text-dim">
                  <span className="text-bone">{h.artistName}</span> — {h.trackName}
                </span>
              </span>
              <span className="shrink-0 uppercase tracking-wide text-amber">{h.winner || "No one"}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
