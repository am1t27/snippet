// Reveal: round answer, winner card, per-player results, leaderboard.
import { EYEBROW, PANEL, Avatar, Leaderboard, ReactionBar, useCountUp } from "../ui";

// ---------- Reveal ----------
export function Reveal({ reveal, myId, onReact, players }) {
  const results = reveal?.results ?? [];
  const winner = reveal?.roundWinner ?? null; // fastest correct answer, or null
  const round = reveal?.round ?? 0;
  const avatarOf = {};
  for (const p of players ?? []) avatarOf[p.id] = p.avatar;
  const total = reveal?.totalRounds ?? 10;
  const track = reveal?.track ?? null; // { trackName, artistName } — always shown
  const isArtist = reveal?.mode === "ARTIST";
  const leaderboard =
    reveal?.leaderboard ??
    [...results].sort((a, b) => b.score - a.score).map((p, i) => ({ rank: i + 1, ...p }));
  const winnerResult = winner ? results.find((r) => r.name === winner.name) : null;
  const winnerPoints = winnerResult?.pointsEarned ?? 0;
  const winnerStreak = winnerResult?.streakBonus ?? 0;
  const shownPoints = useCountUp(winnerPoints);

  return (
    <div className="space-y-6">
      <p className={`${EYEBROW} animate-rise`}>
        Round {String(round).padStart(2, "0")} / {String(total).padStart(2, "0")}
      </p>

      {track && (
        <div className={`${PANEL} animate-rise px-5 py-4`} style={{ animationDelay: "80ms" }}>
          <p className={EYEBROW}>The answer</p>
          <p className="mt-2 font-marquee text-lg font-black uppercase tracking-tight text-bone">
            <span className={isArtist ? "text-amber" : ""}>{track.artistName}</span>
            <span className="text-dim"> — </span>
            <span className={isArtist ? "" : "text-amber"}>{track.trackName}</span>
          </p>
        </div>
      )}

      {/* Winner card: HIGH SCORE, amber left accent, big points */}
      {winner ? (
        <div
          className="animate-rise border border-amber/40 border-l-4 border-l-amber bg-amber/5 px-5 py-5 shadow-[0_0_30px_-10px_#FFC93C]"
          style={{ animationDelay: "160ms" }}
        >
          <p className="font-coin text-xs text-amber">HIGH SCORE</p>
          <div className="mt-3 flex items-end justify-between gap-4">
            <div className="min-w-0">
              <p className="truncate font-marquee text-2xl font-black uppercase tracking-tight text-bone">
                {winner.name}
              </p>
              <p className="mt-1 font-console text-xs tabular-nums text-dim">{winner.answerTimeSeconds}s</p>
            </div>
            <p className="shrink-0 animate-scoreroll font-marquee text-3xl font-black tabular-nums text-amber">
              +{shownPoints}
            </p>
          </div>
          {winnerStreak > 0 && (
            <p className="mt-2 font-console text-[11px] uppercase tracking-[0.2em] text-amber">
              Streak +{winnerStreak}
            </p>
          )}
        </div>
      ) : (
        <div
          className="animate-rise border border-bad/50 bg-bad/5 px-5 py-6 text-center shadow-[0_0_30px_-10px_#FF4D6D]"
          style={{ animationDelay: "160ms" }}
        >
          <p className="font-marquee text-2xl font-black uppercase tracking-tight text-bad">No one got it</p>
        </div>
      )}

      {/* Per-player results: name | answer time | correct/wrong | points */}
      <div className="animate-rise" style={{ animationDelay: "260ms" }}>
        <p className={EYEBROW}>This round</p>
        <ul className={`mt-3 ${PANEL} divide-y divide-rule`}>
          {results.map((r, ri) => {
            const answered = r.answerTimeSeconds != null;
            const isMe = myId && r.id === myId;
            return (
              <li
                key={r.id ?? r.name}
                className={`flex animate-rise items-center justify-between gap-3 px-4 py-3 ${
                  r.correct ? "bg-good/5" : isMe ? "bg-pink/5" : ""
                }`}
                style={{ animationDelay: `${300 + ri * 50}ms` }}
              >
                <span className="flex min-w-0 items-center gap-3">
                  <StatusDot correct={r.correct} answered={answered} delay={300 + ri * 50 + 140} />
                  <Avatar name={r.name} src={avatarOf[r.id]} size={22} />
                  <span className="truncate font-console uppercase tracking-wide text-bone">{r.name}</span>
                  {r.streakBonus > 0 && (
                    <span className="shrink-0 font-console text-[11px] uppercase tracking-wide text-amber">
                      +{r.currentStreak} st
                    </span>
                  )}
                </span>
                <span className="flex items-center gap-4 font-console text-sm tabular-nums">
                  <span className="text-dim">{answered ? `${r.answerTimeSeconds}s` : "—"}</span>
                  <span className={r.correct ? "text-good" : "text-dim"}>+{r.pointsEarned}</span>
                </span>
              </li>
            );
          })}
        </ul>
      </div>

      <div className="animate-rise" style={{ animationDelay: "380ms" }}>
        <Leaderboard rows={leaderboard} myId={myId} title="Leaderboard" />
      </div>

      <ReactionBar onReact={onReact} />
    </div>
  );
}

// Correct / wrong / no-answer marker for the reveal list. `delay` syncs the
// pop with the row's own stagger so the mark lands just after the row shows.
export function StatusDot({ correct, answered, delay = 0 }) {
  const cls = !answered ? "text-dim" : correct ? "text-good" : "text-bad";
  const mark = !answered ? "○" : correct ? "✓" : "✗";
  const label = !answered ? "No answer" : correct ? "Correct" : "Incorrect";
  return (
    <span className={`w-4 text-center font-console text-sm ${cls}`}>
      <span className="sr-only">{label}</span>
      <span aria-hidden="true" className="inline-block animate-popin" style={{ animationDelay: `${delay}ms` }}>
        {mark}
      </span>
    </span>
  );
}
