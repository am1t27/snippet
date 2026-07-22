// Entry: sign in (Google or guest), create or join a room.
import { useCallback, useEffect, useRef, useState } from "react";
import { EYEBROW, PANEL, BTN_AMBER, BTN_GHOST } from "../ui";

// ---------- Entry: sign in (Google or guest), create or join a room ----------
export function EntryScreen({ onCreate, onJoin, onQuick, onHome }) {
  const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID || "";
  const [name, setName] = useState("");
  const [code, setCode] = useState(() => {
    if (typeof window === "undefined") return "";
    return (new URLSearchParams(window.location.search).get("room") || "").toUpperCase().slice(0, 4);
  });
  const [googleCred, setGoogleCred] = useState(null); // { name, idToken }
  const onSignIn = useCallback((c) => setGoogleCred(c), []);

  const identityName = googleCred ? googleCred.name : name.trim();
  const idToken = googleCred ? googleCred.idToken : undefined;
  const canPlay = identityName.length > 0;

  return (
    <div className="mx-auto w-full max-w-sm animate-rise space-y-6">
      {onHome && (
        <button onClick={onHome} className={`${EYEBROW} inline-flex min-h-11 items-center hover:text-amber`}>
          ‹ Home
        </button>
      )}
      <div>
        <p className="font-coin text-base leading-relaxed text-pink">INSERT COIN</p>
        <div className="mt-3 h-px w-24 bg-rule" />
        <p className="mt-4 font-console text-sm text-dim">
          Sign in or play as a guest, then create or join a room.
        </p>
      </div>

      {clientId &&
        (googleCred ? (
          <div className={`${PANEL} flex items-center justify-between px-4 py-3`}>
            <span className="min-w-0 truncate font-console text-sm text-bone">
              Signed in · <span className="text-good">{googleCred.name}</span>
            </span>
            <button
              onClick={() => setGoogleCred(null)}
              className="inline-flex min-h-11 shrink-0 items-center font-console text-xs uppercase tracking-[0.2em] text-dim transition-colors hover:text-pink"
            >
              Switch
            </button>
          </div>
        ) : (
          <GoogleSignIn clientId={clientId} onSignIn={onSignIn} />
        ))}

      {!googleCred && (
        <div>
          {clientId && <p className={`${EYEBROW} mb-2`}>or play as guest</p>}
          <div className="flex items-center border-b-2 border-rule focus-within:border-pink">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={20}
              placeholder="YOUR HANDLE"
              aria-label="Your handle"
              className="w-full bg-transparent px-1 py-3 font-console text-lg uppercase tracking-widest text-bone placeholder:text-dim focus:outline-none"
            />
            {name.length === 0 && <span className="mr-1 h-5 w-2 animate-blink bg-pink" aria-hidden="true" />}
          </div>
        </div>
      )}

      {!canPlay && (
        <p id="handle-hint" className="font-console text-xs uppercase tracking-[0.2em] text-dim">
          Enter a handle to play
        </p>
      )}

      <button
        onClick={() => canPlay && onCreate(identityName, idToken)}
        disabled={!canPlay}
        aria-describedby={!canPlay ? "handle-hint" : undefined}
        className={`${BTN_AMBER} w-full`}
      >
        <span aria-hidden="true">▶ </span>Create Room
      </button>

      <button
        onClick={() => canPlay && onQuick(identityName, idToken)}
        disabled={!canPlay}
        aria-describedby={!canPlay ? "handle-hint" : undefined}
        className={`${BTN_GHOST} w-full`}
      >
        <span aria-hidden="true">▶ </span>Quick Play · public match
      </button>

      <div>
        <p className={EYEBROW}>or join with a code</p>
        <div className="mt-3 flex gap-2">
          <input
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase().slice(0, 4))}
            maxLength={4}
            placeholder="CODE"
            aria-label="Room code"
            className="w-28 border border-rule bg-cabinet px-3 py-3 text-center font-console text-lg uppercase tracking-[0.3em] text-bone placeholder:text-dim focus:border-pink focus:outline-none"
          />
          <button
            onClick={() => canPlay && code && onJoin(code, identityName, idToken)}
            disabled={!canPlay || !code}
            className={`${BTN_GHOST} flex-1`}
          >
            Join
          </button>
        </div>
      </div>
    </div>
  );
}

// Google Identity Services button. Renders nothing if no client ID is set (then
// the app is guest-only). The credential is a Google ID token the server
// re-verifies — the client never trusts it for identity.
export function GoogleSignIn({ clientId, onSignIn }) {
  const ref = useRef(null);
  const cbRef = useRef(onSignIn);
  cbRef.current = onSignIn;
  useEffect(() => {
    if (!clientId) return;
    let timer = null;
    const init = () => {
      const g = window.google && window.google.accounts && window.google.accounts.id;
      if (!g || !ref.current) return false;
      g.initialize({
        client_id: clientId,
        callback: (resp) => {
          try {
            const part = resp.credential.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
            const payload = JSON.parse(decodeURIComponent(escape(atob(part))));
            cbRef.current({ name: payload.name || payload.email, idToken: resp.credential });
          } catch {
            /* ignore malformed token */
          }
        },
      });
      ref.current.innerHTML = "";
      g.renderButton(ref.current, { theme: "filled_black", size: "large", text: "signin_with", shape: "rectangular" });
      return true;
    };
    if (!init()) timer = setInterval(() => { if (init()) clearInterval(timer); }, 200);
    return () => {
      if (timer) clearInterval(timer);
    };
  }, [clientId]);
  if (!clientId) return null;
  return <div ref={ref} className="flex justify-center" />;
}
