// Lobby: player list, room code, host settings, chat.
import { useState } from "react";
import { EYEBROW, PANEL, BTN_AMBER, BTN_GHOST, Avatar, Chat } from "../ui";

// Genre options the host can pick before starting. Values mirror the server's
// catalog/genres.js registry (its GENRE_KEYS allowlist) - the server
// re-validates, so an out-of-sync entry degrades to the default, never breaks.
const GENRES = [
  { label: "HIP-HOP/RAP", value: "hip-hop" },
  { label: "DRILL", value: "drill" },
  { label: "TRAP", value: "trap" },
  { label: "R&B", value: "r&b" },
  { label: "POP", value: "pop" },
  { label: "INDIE", value: "indie" },
  { label: "COUNTRY", value: "country" },
  { label: "BOLLYWOOD", value: "bollywood" },
];

// Host-configurable match settings. Each option is { label, value } and the
// value is sent to the server, which re-validates against its own allowlist.
const ROUND_OPTS = [
  { label: "10", value: 10 },
  { label: "5", value: 5 },
  { label: "15", value: 15 },
];
const TIMER_OPTS = [
  { label: "10s", value: 10000 },
  { label: "7.5s", value: 7500 },
  { label: "15s", value: 15000 },
  { label: "20s", value: 20000 },
];
const OPTION_OPTS = [
  { label: "4", value: 4 },
  { label: "3", value: 3 },
  { label: "6", value: 6 },
];
const MODE_OPTS = [
  { label: "Title", value: "TITLE" },
  { label: "Artist", value: "ARTIST" },
];
const DECADE_OPTS = [
  { label: "All", value: "all" },
  { label: "New", value: "new" },
  { label: "2020s", value: "2020s" },
  { label: "2010s", value: "2010s" },
  { label: "2000s", value: "2000s" },
  { label: "90s", value: "1990s" },
  { label: "80s", value: "1980s" },
];
const CLIP_OPTS = [
  { label: "Random", value: "RANDOM" },
  { label: "Intro", value: "INTRO" },
];
// Match format. Knockout removes players as the match runs and ends only when
// one is left standing, so it ignores the rounds setting entirely.
const FORMAT_OPTS = [
  { label: "Classic", value: "CLASSIC" },
  { label: "Knockout", value: "KNOCKOUT" },
];
// What the player is given each round. COVER shows the album art sharpening and
// plays nothing, so the Clip setting has nothing to act on.
const CLUE_OPTS = [
  { label: "Audio", value: "AUDIO" },
  { label: "Cover", value: "COVER" },
];
const KNOCKOUT_OPTS = [
  { label: "Slowest out", value: "SLOWEST" },
  { label: "Lives", value: "LIVES" },
];

// Each option slot (1-4) gets its own arcade-button color. Full literal class

// ---------- Lobby ----------
export function Lobby({ players, myId, isHost, onStart, code, messages, onChat, clipPref, formatPref, knockoutPref, cluePref, onLeave }) {
  const [copied, setCopied] = useState(false);
  const [genre, setGenre] = useState(GENRES[0].value);
  // Match settings (host only). Defaults mirror the server's DEFAULT_SETTINGS;
  // `clip` is seeded from the Home card the host arrived through (Heardle=INTRO).
  // Reading a sharpening cover needs more runway than naming a clip, so a
  // Focus lobby starts on the 20s timer. The host can still change it.
  const [settings, setSettings] = useState({
    rounds: 10,
    roundMs: cluePref === "COVER" ? 20000 : 10000,
    optionsCount: 4,
    mode: "TITLE",
    decade: "all",
    clip: clipPref === "INTRO" ? "INTRO" : "RANDOM",
    format: formatPref === "KNOCKOUT" ? "KNOCKOUT" : "CLASSIC",
    knockout: knockoutPref === "LIVES" ? "LIVES" : "SLOWEST",
    clue: cluePref === "COVER" ? "COVER" : "AUDIO",
  });
  const setField = (key) => (value) => setSettings((s) => ({ ...s, [key]: value }));
  const handleStart = () => onStart({ ...settings, genre });
  const joinLink =
    typeof window !== "undefined" && code ? `${window.location.origin}?room=${code}` : "";
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(joinLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked */
    }
  };

  return (
    <div className="space-y-8">
      <div>
        <p className={EYEBROW}>Players {String(players.length).padStart(2, "0")} / 08</p>
        <ul className={`mt-3 ${PANEL} divide-y divide-rule`}>
          {players.map((p, i) => (
            <li
              key={p.id}
              className={`flex items-center justify-between px-4 py-3 ${i % 2 ? "bg-void/40" : ""}`}
            >
              <span className="flex min-w-0 items-center gap-3">
                <Avatar name={p.name} src={p.avatar} />
                <span className="font-console text-xs text-cyan">{i + 1}UP</span>
                <span className="truncate font-console uppercase tracking-wide text-bone">{p.name}</span>
                {p.google && (
                  <span className="shrink-0 text-good" title="Google verified" role="img" aria-label="Google verified">
                    ✓
                  </span>
                )}
              </span>
              <span className="flex items-center gap-3 font-console text-[11px] uppercase tracking-[0.2em]">
                {p.id === myId && <span className="text-dim">· You</span>}
                {i === 0 && <span className="text-amber">[Host]</span>}
              </span>
            </li>
          ))}
        </ul>
      </div>

      <div>
        <p className={EYEBROW}>Room code</p>
        <div className="mt-3 flex items-center justify-between gap-3">
          <span className="font-marquee text-4xl font-black tracking-[0.25em] text-amber">{code}</span>
          <button type="button" onClick={copy} className={BTN_GHOST}>
            {copied ? "Link copied" : "Copy link"}
          </button>
          <span className="sr-only" role="status">
            {copied ? "Join link copied to clipboard" : ""}
          </span>
        </div>
        <p className="mt-2 font-console text-xs text-dim">Friends join with this code, or your copied link.</p>
      </div>

      {isHost ? (
        <div className="space-y-5">
          <div>
            <p className={EYEBROW}>Genre</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {GENRES.map((g) => {
                const active = g.value === genre;
                return (
                  <button type="button"
                    key={g.value}
                    onClick={() => setGenre(g.value)}
                    aria-pressed={active}
                    className={`min-h-11 px-3 py-2 font-console text-xs uppercase tracking-[0.2em] transition-[color,border-color,background-color,transform] active:scale-[.96] ${
                      active
                        ? "bg-pink text-black"
                        : "border border-rule text-dim hover:border-pink hover:text-pink"
                    }`}
                  >
                    {g.label}
                  </button>
                );
              })}
            </div>
          </div>

          <SettingRow label="Format" options={FORMAT_OPTS} value={settings.format} onChange={setField("format")} />
          {settings.format === "KNOCKOUT" && (
            <>
              <SettingRow label="Rule" options={KNOCKOUT_OPTS} value={settings.knockout} onChange={setField("knockout")} />
              <p className="font-console text-[11px] leading-relaxed text-dim">
                {settings.knockout === "LIVES"
                  ? "3 lives each (4 in a 2-player duel). Wrong or no answer costs one. If everyone gets it right, the slowest still loses one. Needs 2 players."
                  : "One player is knocked out every round, and being right is not enough if you were the slowest. Needs 3 players."}
              </p>
            </>
          )}
          <SettingRow label="Mode" options={MODE_OPTS} value={settings.mode} onChange={setField("mode")} />
          <SettingRow
            label="Clue"
            options={CLUE_OPTS}
            value={settings.clue}
            onChange={(v) =>
              setSettings((s) => ({
                ...s,
                clue: v,
                // Switching to Cover bumps a still-default 10s timer to 20s;
                // a timer the host set deliberately is left alone.
                roundMs: v === "COVER" && s.roundMs === 10000 ? 20000 : s.roundMs,
              }))
            }
          />
          {/* A cover round plays nothing, so the clip start point is moot. */}
          {settings.clue !== "COVER" && (
            <SettingRow label="Clip" options={CLIP_OPTS} value={settings.clip} onChange={setField("clip")} />
          )}
          {/* Knockout runs until one player is left standing, so a round count
              would control nothing. Hidden rather than disabled. */}
          {settings.format !== "KNOCKOUT" && (
            <SettingRow label="Rounds" options={ROUND_OPTS} value={settings.rounds} onChange={setField("rounds")} />
          )}
          <SettingRow label="Timer" options={TIMER_OPTS} value={settings.roundMs} onChange={setField("roundMs")} />
          <SettingRow label="Answers" options={OPTION_OPTS} value={settings.optionsCount} onChange={setField("optionsCount")} />
          <SettingRow label="Era" options={DECADE_OPTS} value={settings.decade} onChange={setField("decade")} />

          <button type="button" onClick={handleStart} className={`${BTN_AMBER} w-full`}>
            <span aria-hidden="true">▶ </span>Start Game
          </button>
        </div>
      ) : (
        <p className={`${EYEBROW} text-center`}>
          <span className="animate-blink text-amber">▍</span> Waiting for host
        </p>
      )}

      <button type="button" onClick={onLeave} className={`${BTN_GHOST} w-full`}>
        <span aria-hidden="true">✕ </span>Leave Room
      </button>

      <Chat messages={messages} onChat={onChat} myId={myId} title="Lobby chat" />
    </div>
  );
}

// A labelled segmented control for one match setting (host lobby).
function SettingRow({ label, options, value, onChange }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <p className={EYEBROW}>{label}</p>
      <div className="flex flex-wrap justify-end gap-1.5">
        {options.map((o) => {
          const active = o.value === value;
          return (
            <button type="button"
              key={String(o.value)}
              onClick={() => onChange(o.value)}
              aria-pressed={active}
              className={`min-h-11 min-w-[2.75rem] px-2.5 py-1.5 font-console text-xs uppercase tracking-[0.12em] transition-[color,border-color,background-color,transform] active:scale-[.96] ${
                active
                  ? "bg-pink text-black"
                  : "border border-rule text-dim hover:border-pink hover:text-pink"
              }`}
            >
              {o.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
