export default function Beacon({
  size = 10,
  color = "signal",
  active = true,
}: {
  size?: number;
  color?: "signal" | "verified" | "alarm";
  active?: boolean;
}) {
  const colorMap: Record<string, string> = {
    signal: "#F0A340",
    verified: "#3FD6C0",
    alarm: "#FF5D5D",
  };
  const hex = colorMap[color];
  const sweepSize = size * 4.2;

  return (
    <span
      className="relative inline-flex items-center justify-center shrink-0"
      style={{ width: sweepSize, height: sweepSize }}
      aria-hidden="true"
    >
      {active && (
        <span
          className="absolute inset-0 rounded-full animate-radarSweep"
          style={{
            background: `conic-gradient(from 0deg, ${hex}55, transparent 35%)`,
            maskImage: "radial-gradient(circle, transparent 35%, black 36%, black 100%)",
            WebkitMaskImage: "radial-gradient(circle, transparent 35%, black 36%, black 100%)",
          }}
        />
      )}
      <span
        className="absolute rounded-full"
        style={{
          width: size * 2.2,
          height: size * 2.2,
          background: `radial-gradient(circle, ${hex}30, transparent 70%)`,
        }}
      />
      <span
        className={active ? "rounded-full animate-beaconPulse" : "rounded-full"}
        style={{
          width: size,
          height: size,
          background: hex,
          boxShadow: `0 0 ${size * 1.2}px 1px ${hex}99`,
        }}
      />
    </span>
  );
}