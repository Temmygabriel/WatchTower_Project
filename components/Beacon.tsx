export default function Beacon({
  size = 10,
  color = "beacon",
  active = true,
}: {
  size?: number;
  color?: "beacon" | "verified" | "violation";
  active?: boolean;
}) {
  const colorMap: Record<string, string> = {
    beacon: "#F0A340",
    verified: "#2FBF9F",
    violation: "#E5484D",
  };
  const hex = colorMap[color];

  return (
    <span
      className="beacon-wrap"
      style={{ width: size + 20, height: size + 20 }}
      aria-hidden="true"
    >
      {active && (
        <span
          className="beacon-ring animate-sweep"
          style={{ borderColor: `${hex}55` }}
        />
      )}
      <span
        className={active ? "beacon-dot animate-beaconPulse" : "beacon-dot"}
        style={{
          width: size,
          height: size,
          background: hex,
          boxShadow: `0 0 ${size}px 2px ${hex}88`,
        }}
      />
    </span>
  );
}
