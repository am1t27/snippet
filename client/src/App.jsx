// App — React client for the multiplayer music guessing game.
//
// Design: "minimalist arcade" — bone on void, one amber CRT phosphor accent,
// Space Mono scoreboard, hairline rules, zero radius. The signature is the CRT
// timer/score. Green/red appear ONLY on reveal to mark answers (+ glyphs).
//
// IMPORTANT: presentation only. The socket/data contract is untouched — every
// prop, event, and server field is wired exactly as before. Screens live in
// ./screens/*, shared tokens + reusable bits in ./ui.jsx.

import { useEffect, useRef, useState } from "react";
import { useGameSocket } from "./useGameSocket";
import sound from "./sound";
import { getStats, recordGame } from "./stats";
import {
  EYEBROW, Centered, ErrorBar, Toast, LoadingOverlay, CountdownOverlay, ReactionOverlay,
} from "./ui";
import { GAMES, Home, Profile, SideMenu } from "./screens/Home";
import { EntryScreen } from "./screens/Entry";
import { Lobby } from "./screens/Lobby";
import { Playing } from "./screens/Playing";
import { Reveal } from "./screens/Reveal";
import { GameOver } from "./screens/GameOver";

export default function App() {
  const {
    connected, myId, state, reveal, gameOver, loading, error, roundMeta, countdown, notice,
    messages, reactions, roomCode, createRoom, joinRoom, quickPlay, start, guess, restart,
    sendChat, sendReaction, clearError, clearNotice, leaveRoom,
  } = useGameSocket();

  // --- Mobile audio unlock (priming) ---------------------------------------
  // One persistent <audio> at the root, primed on the first tap (Enter/Start)
  // so mobile autoplays each round without the tap penalty.
  const audioRef = useRef(null);
  const primedRef = useRef(false);

  const primeAudio = () => {
    sound.unlock(); // resume the Web Audio context on this user gesture
    if (primedRef.current) return;
    const el = audioRef.current;
    if (!el) return;
    primedRef.current = true;
    try {
      el.src =
        "data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAAA";
      const p = el.play();
      if (p && typeof p.then === "function") {
        p.then(() => el.pause()).catch(() => {});
      }
    } catch {
      /* ignore — per-round tap fallback still covers playback */
    }
  };

  const handleCreate = (name, idToken) => {
    primeAudio();
    createRoom(name, idToken);
  };
  const handleJoinRoom = (code, name, idToken) => {
    primeAudio();
    joinRoom(code, name, idToken);
  };
  const handleQuick = (name, idToken) => {
    primeAudio();
    quickPlay(name, idToken);
  };
  const handleStart = (settings) => {
    primeAudio();
    start(settings);
  };

  const phase = state?.phase ?? "LOBBY";
  const players = state?.players ?? [];
  const me = players.find((p) => p.id === myId) || null;
  const joined = Boolean(me);
  const isSpectator = Boolean(me?.spectator);
  // Host = the first non-spectator player (mirrors the server's host rule).
  const firstPlayer = players.find((p) => !p.spectator) || null;
  const isHost = Boolean(firstPlayer && firstPlayer.id === myId);

  // Our own guess for the round (our choice — NOT the answer). Reset each round.
  const [myGuess, setMyGuess] = useState(null);
  const round = state?.round ?? 0;
  useEffect(() => {
    setMyGuess(null);
  }, [round]);

  // Auto-dismiss transient errors.
  useEffect(() => {
    if (!error) return;
    const t = setTimeout(clearError, 3500);
    return () => clearTimeout(t);
  }, [error, clearError]);

  // Auto-dismiss bottom toasts.
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(clearNotice, 3000);
    return () => clearTimeout(t);
  }, [notice, clearNotice]);

  // Sound + mute toggle (persisted in localStorage by the sound module).
  const [muted, setMutedState] = useState(() => sound.isMuted());
  const toggleMute = () => setMutedState(sound.toggleMuted());

  // Screen-reader announcements for phase outcomes (aria-live region below).
  const [announce, setAnnounce] = useState("");

  // Hub navigation. "home" (landing) is the default; "play" shows the entry
  // (create/join) flow; "profile" shows local stats. Once in a room the game
  // screens take over regardless of view.
  const [view, setView] = useState("home");
  const [menuOpen, setMenuOpen] = useState(false);
  const [clipPref, setClipPref] = useState("RANDOM"); // preset by the Heardle card
  const [stats, setStats] = useState(() => getStats());

  // Count my correct answers across the game so the profile can track accuracy.
  const myCorrectRef = useRef(0);
  useEffect(() => {
    if (phase === "LOBBY") myCorrectRef.current = 0;
  }, [phase]);

  const handleLeave = () => {
    if (joined) {
      if (phase !== "LOBBY" && phase !== "GAME_OVER") {
        if (!window.confirm("Leave this active game?")) return;
      }
      leaveRoom();
    }
    setView("home");
  };

  const handleNavigate = (targetView) => {
    if (joined) {
      if (phase !== "LOBBY" && phase !== "GAME_OVER") {
        if (!window.confirm("Leave this active game?")) return;
      }
      leaveRoom();
    }
    setView(targetView);
    setMenuOpen(false);
  };

  // Route into the room flow from a Home game card.
  const openGame = (game) => {
    if (!game || game.status !== "play") return;
    if (joined) {
      if (phase !== "LOBBY" && phase !== "GAME_OVER") {
        if (!window.confirm("Leave this active game?")) return;
      }
      leaveRoom();
    }
    setClipPref(game.clip || "RANDOM");
    setView("play");
    setMenuOpen(false);
  };

  // Reveal: play correct/wrong sting and announce my result.
  useEffect(() => {
    if (!reveal) return;
    const mine = (reveal.results || []).find((r) => r.id === myId);
    if (!mine) return;
    if (mine.correct) {
      myCorrectRef.current += 1;
      sound.play("correct");
      setAnnounce(`Correct. Plus ${mine.pointsEarned} points.`);
    } else if (mine.answerTimeSeconds != null) {
      sound.play("wrong");
      setAnnounce("Wrong answer.");
    } else {
      setAnnounce("Time up — no answer.");
    }
  }, [reveal, myId]);

  // Game over: fanfare for the winner, soft cue otherwise, and record my stats.
  const recordedRef = useRef(null);
  useEffect(() => {
    if (!gameOver) return;
    const board = gameOver.leaderboard || [];
    const idx = board.findIndex((r) => r.id === myId);
    if (idx === 0) {
      sound.play("win");
      setAnnounce("Game over. You win!");
    } else {
      sound.play("lose");
      setAnnounce(idx >= 0 ? `Game over. You placed number ${idx + 1}.` : "Game over.");
    }
    // Persist once per game over (and only if I actually played).
    const sig = `${idx}:${board.length}:${gameOver.roundHistory?.length || 0}`;
    if (idx >= 0 && recordedRef.current !== sig) {
      recordedRef.current = sig;
      const next = recordGame({
        won: idx === 0,
        score: board[idx]?.score || 0,
        correct: myCorrectRef.current,
        rounds: gameOver.roundHistory?.length || 0,
      });
      setStats(next);
    }
  }, [gameOver, myId]);
  // Allow the next game to record again.
  useEffect(() => {
    if (phase === "LOBBY") recordedRef.current = null;
  }, [phase]);

  const handleGuess = (opt) => {
    sound.play("select");
    setMyGuess(opt);
    guess(opt);
  };

  return (
    <div className="crt-scan min-h-screen bg-void font-console text-bone antialiased selection:bg-amber selection:text-black">
      {error && <ErrorBar message={error} />}
      {loading && <LoadingOverlay message={loading.message} />}
      {countdown && (
        <CountdownOverlay
          key={countdown.round}
          seconds={countdown.seconds}
          round={countdown.round}
          worth={countdown.questionValue}
          maxPoints={countdown.maxPoints}
        />
      )}
      {notice && <Toast message={notice} />}
      <ReactionOverlay reactions={reactions} />
      <div className="sr-only" role="status" aria-live="polite">
        {announce}
      </div>

      {menuOpen && (
        <SideMenu
          games={GAMES}
          onClose={() => setMenuOpen(false)}
          onHome={() => handleNavigate("home")}
          onOpen={openGame}
          onProfile={() => handleNavigate("profile")}
        />
      )}

      {!connected && joined && (
        <div
          role="status"
          aria-live="polite"
          className="fixed inset-x-0 top-0 z-50 bg-amber px-4 py-2 text-center font-console text-xs uppercase tracking-[0.2em] text-black"
        >
          Reconnecting…
        </div>
      )}

      <div className="mx-auto flex min-h-screen max-w-xl flex-col px-5 pt-6 pb-8">
        <Masthead
          phase={phase}
          round={round}
          total={state?.totalRounds}
          onMenu={() => setMenuOpen(true)}
          onBrand={handleLeave}
        />

        <main className="flex flex-1 flex-col justify-start py-8">
          {!connected && !joined ? (
            <Centered eyebrow="Status" title="Connecting…" />
          ) : !joined && view === "home" ? (
            <Home games={GAMES} stats={stats} onOpen={openGame} onProfile={() => setView("profile")} />
          ) : !joined && view === "profile" ? (
            <Profile stats={stats} onBack={() => setView("home")} />
          ) : !joined ? (
            <EntryScreen
              onCreate={handleCreate}
              onJoin={handleJoinRoom}
              onQuick={handleQuick}
              onHome={() => setView("home")}
              clipPref={clipPref}
            />
          ) : phase === "LOBBY" ? (
            <Lobby
              players={players}
              myId={myId}
              isHost={isHost}
              onStart={handleStart}
              code={roomCode}
              messages={messages}
              onChat={sendChat}
              clipPref={clipPref}
              onLeave={handleLeave}
            />
          ) : phase === "ROUND_PLAYING" ? (
            <Playing
              state={state}
              roundMeta={roundMeta}
              myGuess={myGuess}
              hasGuessed={Boolean(myGuess) || Boolean(me?.hasGuessed)}
              spectator={isSpectator}
              onGuess={handleGuess}
              onReact={sendReaction}
              audioRef={audioRef}
            />
          ) : phase === "ROUND_REVEAL" ? (
            reveal ? (
              <Reveal reveal={reveal} myId={myId} onReact={sendReaction} players={players} />
            ) : (
              <Centered eyebrow="Status" title="Catching up…" />
            )
          ) : phase === "GAME_OVER" ? (
            <GameOver
              gameOver={gameOver}
              players={players}
              myId={myId}
              onRestart={restart}
              messages={messages}
              onChat={sendChat}
            />
          ) : null}
        </main>

        <footer className={`${EYEBROW} flex items-center justify-between border-t border-rule pt-4`}>
          <span>{connected ? "● Online" : "○ Offline"}</span>
          <button type="button"
            onClick={toggleMute}
            aria-pressed={!muted}
            aria-label={muted ? "Unmute sound effects" : "Mute sound effects"}
            className="inline-flex min-h-11 items-center font-console text-[11px] uppercase tracking-[0.2em] text-dim transition-colors hover:text-amber"
          >
            {muted ? "♪ Off" : "♪ On"}
          </button>
          <span className="text-bone">{me ? me.name : "Guest"}</span>
        </footer>
      </div>

      {/* Single persistent, primed audio element reused across all rounds. */}
      <audio ref={audioRef} preload="auto" className="hidden" />
    </div>
  );
}

// ---------- Masthead ----------
function Masthead({ phase, round, total, onMenu, onBrand }) {
  const label =
    phase === "ROUND_PLAYING" || phase === "ROUND_REVEAL"
      ? `Track ${String(round).padStart(2, "0")} / ${String(total ?? 10).padStart(2, "0")}`
      : phase === "GAME_OVER"
      ? "Side B · Final"
      : "Side A · Lobby";
  return (
    <header className="flex items-center justify-between gap-3 border-b border-rule pb-4">
      <div className="flex items-center gap-3">
        {onMenu && (
          <button type="button"
            onClick={onMenu}
            aria-label="Open menu"
            className="inline-flex min-h-11 min-w-11 items-center justify-center font-console text-2xl leading-none text-dim transition-colors hover:text-amber"
          >
            ≡
          </button>
        )}
        <h1 className="flex items-center font-marquee text-2xl font-black uppercase leading-none tracking-tight text-bone sm:text-3xl">
          <button type="button"
            onClick={onBrand || undefined}
            disabled={!onBrand}
            className="flex items-center disabled:cursor-default"
          >
            Snippet
            <span className="ml-1.5 inline-block h-[0.7em] w-[0.32em] animate-blink bg-pink" aria-hidden="true" />
          </button>
        </h1>
      </div>
      <span className={EYEBROW}>{label}</span>
    </header>
  );
}
