/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        // Vibrant-arcade palette: dark indigo canvas + a structured neon set.
        void: "#13131E", // app background (indigo, not flat black)
        cabinet: "#1B1B2A", // panels / cards / option fills
        rule: "#2E2E44", // hairline borders
        bone: "#EDEDF2", // primary text
        dim: "#8A8AA0", // secondary text
        amber: "#FFC93C", // gold — scoreboard / hi-score / host
        pink: "#FF3D7F", // primary CTA / brand accent
        cyan: "#36D8FF", // secondary accent / option 1
        purple: "#B14BFF", // sparing accent
        yellow: "#FFD23F", // option 4 / highlight
        good: "#3DF07A", // correct (green) — reveal + option 3
        bad: "#FF4D6D", // wrong / error (red)
      },
      fontFamily: {
        marquee: ["Archivo", "system-ui", "sans-serif"],
        console: ['"Space Mono"', "ui-monospace", "monospace"],
        coin: ['"Press Start 2P"', "ui-monospace", "monospace"],
      },
      keyframes: {
        blink: { "50%": { opacity: "0" } },
        flicker: {
          "0%,97%": { opacity: "1" },
          "98%": { opacity: ".82" },
          "100%": { opacity: "1" },
        },
        scoreroll: {
          from: { transform: "translateY(0.4em)", opacity: "0" },
          to: { transform: "none", opacity: "1" },
        },
        rise: {
          from: { transform: "translateY(8px)", opacity: "0" },
          to: { transform: "none", opacity: "1" },
        },
        floatup: {
          "0%": { transform: "translateY(0) scale(.8)", opacity: "0" },
          "15%": { transform: "translateY(-10px) scale(1)", opacity: "1" },
          "100%": { transform: "translateY(-120px) scale(1)", opacity: "0" },
        },
        // Icon/marker pop: scale .25→1, blur 4→0 (make-interfaces spec values).
        popin: {
          from: { transform: "scale(.25)", opacity: "0", filter: "blur(4px)" },
          to: { transform: "scale(1)", opacity: "1", filter: "blur(0px)" },
        },
        // Quick press-and-settle punch when an answer locks in.
        lockin: {
          "0%": { transform: "scale(1)" },
          "35%": { transform: "scale(.97)" },
          "100%": { transform: "scale(1)" },
        },
        // Big countdown digit: lands from slightly oversized each tick.
        digitpop: {
          from: { transform: "scale(1.25)", opacity: "0" },
          to: { transform: "scale(1)", opacity: "1" },
        },
        // Low-time heartbeat: subtle scale pulse, once per second.
        beat: {
          "0%, 100%": { transform: "scale(1)" },
          "50%": { transform: "scale(1.04)" },
        },
        // Wrong answer: tight 3-axis shake, settles fast.
        shake3: {
          "0%, 100%": { transform: "translate(0,0) rotate(0)" },
          "20%": { transform: "translate(-5px,1px) rotate(-0.4deg)" },
          "40%": { transform: "translate(4px,-1px) rotate(0.4deg)" },
          "60%": { transform: "translate(-3px,1px) rotate(-0.25deg)" },
          "80%": { transform: "translate(2px,0) rotate(0.15deg)" },
        },
        // Correct answer: green wash floods the card then recedes.
        flood: {
          "0%": { boxShadow: "inset 0 0 0 0 rgba(61,240,122,0)" },
          "30%": { boxShadow: "inset 0 0 120px 10px rgba(61,240,122,0.28)" },
          "100%": { boxShadow: "inset 0 0 60px 0 rgba(61,240,122,0.12)" },
        },
        // Typographic starburst particle: shoots out along --burst-x/--burst-y.
        burst: {
          "0%": { transform: "translate(0,0) scale(.4)", opacity: "1" },
          "100%": { transform: "translate(var(--burst-x), var(--burst-y)) scale(1)", opacity: "0" },
        },
        // Ghost marker pulse when the ghost "answers".
        ghostblip: {
          "0%": { transform: "scale(1)", opacity: "1" },
          "50%": { transform: "scale(1.8)", opacity: ".7" },
          "100%": { transform: "scale(1)", opacity: "1" },
        },
        // Level-up overlay: zoom in from deep, settle with a slight overshoot.
        levelup: {
          "0%": { transform: "scale(.6)", opacity: "0", filter: "blur(6px)" },
          "70%": { transform: "scale(1.05)", opacity: "1", filter: "blur(0)" },
          "100%": { transform: "scale(1)", opacity: "1" },
        },
      },
      animation: {
        blink: "blink 1s step-end infinite",
        flicker: "flicker 4s steps(1) infinite",
        scoreroll: "scoreroll 240ms cubic-bezier(.16,1,.3,1) both",
        rise: "rise 240ms cubic-bezier(.16,1,.3,1) both",
        floatup: "floatup 1.6s ease-out forwards",
        popin: "popin 300ms cubic-bezier(0.2,0,0,1) both",
        lockin: "lockin 220ms cubic-bezier(.16,1,.3,1) both",
        digitpop: "digitpop 260ms cubic-bezier(0.2,0,0,1) both",
        beat: "beat 1s ease-in-out infinite",
        shake3: "shake3 360ms cubic-bezier(.36,.07,.19,.97) both",
        flood: "flood 700ms ease-out both",
        burst: "burst 700ms cubic-bezier(0.2,0,0,1) both",
        ghostblip: "ghostblip 500ms ease-out both",
        levelup: "levelup 600ms cubic-bezier(.34,1.56,.64,1) both",
      },
    },
  },
  plugins: [],
};
