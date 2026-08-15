/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx}",
    "./components/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Watchtower palette v2 -- blue-black, not neutral-black.
        // The warmth in the undertone is what keeps this from
        // reading as a generic dark-mode default.
        abyss: "#0A0E14",        // page background
        steel: "#141B24",        // panel surface
        steelRaised: "#1B2530",  // hover/raised surface
        horizon: "#2A3644",      // hairline borders
        paper: "#E8EDF2",        // primary text -- cool white, not pure white
        mist: "#7C8B9A",         // secondary text
        signal: "#F0A340",       // amber -- active watch / pending
        verified: "#3FD6C0",     // teal-cyan -- claim passed
        alarm: "#FF5D5D",        // red -- claim failed / slashed

        // Back-compat aliases so existing component classes
        // (bg-panel, text-inkMuted, etc.) keep working while we
        // migrate call sites incrementally.
        base: "#0A0E14",
        panel: "#141B24",
        panelRaised: "#1B2530",
        line: "#2A3644",
        ink: "#E8EDF2",
        inkMuted: "#7C8B9A",
        beacon: "#F0A340",
        violation: "#FF5D5D",
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
        radarSweep: {
          "0%": { transform: "rotate(0deg)" },
          "100%": { transform: "rotate(360deg)" },
        },
      },
      animation: {
        beaconPulse: "beaconPulse 2s ease-in-out infinite",
        radarSweep: "radarSweep 4s linear infinite",
      },
    },
  },
  plugins: [],
};