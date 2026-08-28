// Reveal: round answer, winner card, per-player results, leaderboard.
import { EYEBROW, PANEL, Avatar, Leaderboard, ReactionBar, useCountUp } from "../ui";
import { GlitchText } from "../fx/text";

// ---------- Reveal ----------
export function Reveal({ reveal, myId, onReact, players }) {
  const results = reveal?.results ?? [];
  const winner = reveal?.roundWinner ?? null; // fastest correct answer, or null
  const round = reveal?.round ?? 0;
  const avatarOf = {};
  for (const p of players ?? []) avatarOf[p.id] = p.avatar;
  const total = reveal?.totalRounds ?? null; // null under knockout: no fixed length
  const track = reveal?.track ?? null; // { trackName, artistName } - always shown
  const isArtist = reveal?.mode === "ARTIST";
  const leaderboard =
    reveal?.leaderboard ??
    results.toSorted((a, b) => b.score - a.score).map((p, i) => ({ rank: i + 1, ...p }));
  const winnerResult = winner ? results.find((r) => r.name === winner.name) : null;
  // My own outcome drives the answer card's mood: green flood, red shake, or
  // neutral (spectator / didn't answer).
  const mine = results.find((r) => r.id === myId) || null;
  const cardMood = mine
    ? mine.correct
      ? "animate-flood border-good/50"
      : mine.answerTimeSeconds != null
      ? "animate-shake3 border-bad/40"
      : ""
    : "";
  const winnerPoints = winnerResult?.pointsEarned ?? 0;
  const winnerStreak = winnerResult?.streakBonus ?? 0;
  const shownPoints = useCountUp(winnerPoints);

  return (
    <div className="space-y-6">
      <p className={`${EYEBROW} animate-rise`}>
        Round {String(round).padStart(2, "0")}
        {total != null && ` / ${String(total).padStart(2, "0")}`}
      </p>

      {(reveal?.eliminated?.length > 0 || reveal?.swept) && (
        <div className={`${PANEL} animate-rise border-l-2 border-l-bad px-5 py-4`} style={{ animationDelay: "40ms" }}>
          {reveal.swept && (
            // A life vanishing with no wrong answer on screen would read as a
            // bug. Always say which rule took it.
            <p className={EYEBROW}>Everyone got it · slowest loses a life</p>
          )}
          {(reveal.eliminated ?? []).map((e) => (
            <p key={e.id} className="mt-2 font-marquee text-lg font-black uppercase tracking-tight text-bad">
              {e.name} is out
              <span className="ml-2 font-console text-xs tracking-[0.2em] text-dim">
                {e.placement}
                {e.placement === 1 ? "st" : e.placement === 2 ? "nd" : e.placement === 3 ? "rd" : "th"}
              </span>
            </p>
          ))}
        </div>
      )}

      {track && (
        <div
          className={`${PANEL} animate-rise flex items-center gap-4 px-5 py-4 ${cardMood}`}
          style={{ animationDelay: "80ms" }}
        >
          {/* Album artwork; glyph tile until the catalog's next ingest fills it. */}
          {track.artworkUrl ? (
            <img
              src={track.artworkUrl}
              alt=""
              width="80"
              height="80"
              className="h-20 w-20 shrink-0 animate-popin border border-rule object-cover"
            />
          ) : (
            <div className="grid h-20 w-20 shrink-0 animate-popin place-items-center border border-rule bg-void font-marquee text-3xl text-pink">
              ♬
            </div>
          )}
          <div className="min-w-0">
            <p className={EYEBROW}>The answer</p>
            <p className="mt-2 font-marquee text-lg font-black uppercase tracking-tight text-bone">
              <span className={isArtist ? "text-amber" : ""}>{track.artistName}</span>
              <span className="text-dim"> - </span>
              <span className={isArtist ? "" : "text-amber"}>{track.trackName}</span>
            </p>
          </div>
        </div>
      )}

      {/* Winner card: HIGH SCORE, amber left accent, big points */}
      {winner ? (
        <div
          className="animate-rise border border-amber/40 border-l-4 border-l-amber bg-amber/5 px-5 py-5"
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
          className="animate-rise border border-bad/50 border-l-4 border-l-bad bg-bad/5 px-5 py-6 text-center"
          style={{ animationDelay: "160ms" }}
        >
          <p className="font-marquee text-2xl font-black uppercase tracking-tight text-bad">
            <GlitchText text="No one got it" />
          </p>
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
                  <span className="text-dim">{answered ? `${r.answerTimeSeconds}s` : "-"}</span>
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
function StatusDot({ correct, answered, delay = 0 }) {
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
