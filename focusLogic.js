// Focus mode: the clue is the album cover, revealed as a resolution ladder.
//
// Pure and side-effect free so both the server and the tests can use it without
// a socket, a clock, or the network. The client imports nothing from here: it
// only ever asks our own proxy for a step index.

// Six rungs. The numbers are real image sizes, and the ladder only sharpens.
export const ART_STEPS = [8, 14, 24, 44, 90, 300];

// The image host we are willing to fetch from. Anything else is refused so a
// crafted artwork value can never turn the proxy into an open relay.
const ART_HOST = "is1-ssl.mzstatic.com";

// Which rung is visible after `elapsedMs` of a `roundMs` round. The ladder is
// spread across the round so it tracks the host's chosen timer rather than
// assuming one length. Clamped at both ends: negative clock skew must not skip
// ahead, and overrun must not index past the ladder.
export function stepForElapsed(elapsedMs, roundMs) {
  const total = Number(roundMs) > 0 ? Number(roundMs) : 10000;
  const per = total / ART_STEPS.length;
  const raw = Math.floor((Number(elapsedMs) || 0) / per);
  return Math.max(0, Math.min(ART_STEPS.length - 1, raw));
}

// THE security predicate. A client may ask for the current rung or any blurrier
// one; asking for a sharper image than the round has reached is the whole cheat
// this mode has to prevent, so it is refused here and nowhere else.
export function stepAllowed(elapsedMs, roundMs, requested) {
  if (typeof requested !== "number" || !Number.isInteger(requested)) return false;
  if (requested < 0 || requested >= ART_STEPS.length) return false;
  return requested <= stepForElapsed(elapsedMs, roundMs);
}

// Host URL for one rung. The host encodes the size as a path segment, which is
// exactly why the client is never given one of these: rewriting 8x8 to 300x300
// would reveal the answer. Server-side only.
export function artUrlForStep(artworkUrl, step) {
  if (!artworkUrl || typeof artworkUrl !== "string") return null;
  if (!Number.isInteger(step) || step < 0 || step >= ART_STEPS.length) return null;
  let host;
  try {
    host = new URL(artworkUrl).hostname;
  } catch {
    return null;
  }
  if (host !== ART_HOST) return null;
  const n = ART_STEPS[step];
  return artworkUrl.replace(/\/\d+x\d+bb\.jpg$/, `/${n}x${n}bb.jpg`);
}

export default { ART_STEPS, stepForElapsed, stepAllowed, artUrlForStep };
