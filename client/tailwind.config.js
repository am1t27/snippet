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
      },
    },
  },
  plugins: [],
};
