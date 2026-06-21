// Synthesized arcade sound effects via the Web Audio API.
//
// There are NO audio files: every sound is generated from oscillators at play
// time, so there's nothing to download and it stays perfectly on-theme. The
// AudioContext is created lazily and resumed on a user gesture (autoplay
// policy). Muting is persisted in localStorage.

const MUTE_KEY = "snippet.muted";
let ctx = null;
let muted = false;
try {
  muted = localStorage.getItem(MUTE_KEY) === "1";
} catch {
  /* storage blocked */
}

function ac() {
  if (typeof window === "undefined") return null;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  if (!ctx) ctx = new AC();
  return ctx;
}

// Resume the context on a user gesture so later sounds can play.
export function unlock() {
  const c = ac();
  if (c && c.state === "suspended") c.resume().catch(() => {});
}

export function isMuted() {
  return muted;
}
export function setMuted(v) {
  muted = Boolean(v);
  try {
    localStorage.setItem(MUTE_KEY, muted ? "1" : "0");
  } catch {
    /* ignore */
  }
}
export function toggleMuted() {
  setMuted(!muted);
  return muted;
}

// One enveloped tone. Exponential ramps avoid clicks.
function tone(c, { freq = 440, type = "square", start = 0, dur = 0.12, gain = 0.08, slideTo = null }) {
  const t0 = c.currentTime + start;
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g).connect(c.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.03);
}

const SOUNDS = {
  blip: (c) => tone(c, { freq: 520, type: "square", dur: 0.07, gain: 0.05 }),
  select: (c) => tone(c, { freq: 680, type: "square", dur: 0.08, gain: 0.06 }),
  correct: (c) => {
    tone(c, { freq: 660, type: "triangle", dur: 0.1, gain: 0.07 });
    tone(c, { freq: 990, type: "triangle", start: 0.1, dur: 0.18, gain: 0.07 });
  },
  wrong: (c) => tone(c, { freq: 300, type: "sawtooth", dur: 0.3, gain: 0.06, slideTo: 120 }),
  count: (c) => tone(c, { freq: 440, type: "square", dur: 0.1, gain: 0.06 }),
  go: (c) => {
    tone(c, { freq: 880, type: "square", dur: 0.18, gain: 0.08 });
    tone(c, { freq: 1320, type: "square", start: 0.06, dur: 0.2, gain: 0.06 });
  },
  win: (c) => [523, 659, 784, 1047].forEach((f, i) => tone(c, { freq: f, type: "triangle", start: i * 0.12, dur: 0.16, gain: 0.07 })),
  lose: (c) => [392, 330, 262].forEach((f, i) => tone(c, { freq: f, type: "sawtooth", start: i * 0.14, dur: 0.18, gain: 0.05 })),
};

export function play(name) {
  if (muted) return;
  const c = ac();
  if (!c) return;
  if (c.state === "suspended") c.resume().catch(() => {});
  const fn = SOUNDS[name];
  if (fn) {
    try {
      fn(c);
    } catch {
      /* audio glitch — never fatal */
    }
  }
}

export default { play, unlock, isMuted, setMuted, toggleMuted };
