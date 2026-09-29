// The design's sky art (design .skyk): a blue gradient with a cloud of fractal noise, behind the
// overview's account card (step 1.10) and the viewing keys page's card (step 2.4).
import { useId } from "react";

export function SkyArt({ className }: { className?: string }) {
  const art = useId().replace(/:/g, "");
  return (
    <svg
      className={className}
      viewBox="0 0 600 420"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={`${art}g`} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="#3F7ED6" />
          <stop offset=".6" stopColor="#8CBDF0" />
          <stop offset="1" stopColor="#DCEBFA" />
        </linearGradient>
        <filter id={`${art}f`} x="0" y="0" width="100%" height="100%">
          <feTurbulence
            type="fractalNoise"
            baseFrequency=".006 .014"
            numOctaves={6}
            seed={9}
            result="n"
          />
          <feColorMatrix
            in="n"
            type="matrix"
            values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  3.1 0 0 0 -1.35"
          />
          <feGaussianBlur stdDeviation=".8" />
        </filter>
      </defs>
      <rect width="600" height="420" fill={`url(#${art}g)`} />
      <rect y="140" width="600" height="280" filter={`url(#${art}f)`} opacity=".95" />
    </svg>
  );
}
