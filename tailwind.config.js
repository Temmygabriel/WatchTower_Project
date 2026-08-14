/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx}",
    "./components/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Watchtower palette -- a dark instrument panel, not a
        // generic dark-mode-with-neon default. Named for what
        // they mean in this product, not generic shade numbers.
        base: "#0B0E11",        // page background, near-black
        panel: "#12161C",       // card/panel surface
        panelRaised: "#181D24", // hover/raised surface
        line: "#232A33",        // hairline borders
        ink: "#E6E9EC",         // primary text
        inkMuted: "#8B95A1",    // secondary text
        beacon: "#F0A340",      // amber -- active watch / pending
        verified: "#2FBF9F",    // teal -- claim passed
        violation: "#E5484D",   // red -- claim failed / slashed
      },
      fontFamily: {
        display: ["var(--font-display)"],
        body: ["var(--font-body)"],
        mono: ["var(--font-mono)"],
      },
      keyframes: {
        beaconPulse: {
          "0%, 100%": { opacity: "1", transform: "scale(1)" },
          "50%": { opacity: "0.4", transform: "scale(1.15)" },
        },
        sweep: {
          "0%": { transform: "rotate(0deg)" },
          "100%": { transform: "rotate(360deg)" },
        },
      },
      animation: {
        beaconPulse: "beaconPulse 2s ease-in-out infinite",
        sweep: "sweep 6s linear infinite",
      },
    },
  },
  plugins: [],
};
