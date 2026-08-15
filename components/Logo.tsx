export default function Logo({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="7" fill="#0A0E14" />
      <circle
        cx="16"
        cy="16"
        r="10.5"
        fill="none"
        stroke="#F0A340"
        strokeWidth="1.4"
        strokeOpacity="0.4"
      />
      <circle cx="16" cy="16" r="4.5" fill="#F0A340" />
    </svg>
  );
}