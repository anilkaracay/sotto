// The Sotto mark and name (design/sotto-app.html .lg).
export function Logo({ size = 24 }: { size?: number }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 9,
        fontWeight: 600,
        fontSize: 22,
        letterSpacing: "-0.04em",
      }}
    >
      <svg width={size} height={size} viewBox="0 0 26 26" aria-hidden="true">
        <circle cx="13" cy="13" r="11" fill="none" stroke="#0B1830" strokeWidth="1.9" />
        <path d="M13 2a11 11 0 000 22z" fill="#0B1830" />
      </svg>
      <span>Sotto</span>
    </span>
  );
}
