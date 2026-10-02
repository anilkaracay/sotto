// The Sotto logo: the horizontal lockup of the approved brand kit (design/brand-kit, step 4.2.1),
// outlined, never retyped. Ink on light grounds, white on dark ones (the sky, night). 28 pixels
// tall, 102 wide: above the guidelines' 96 pixel minimum for the lockup.
import { SottoLockupInk, SottoLockupWhite } from "@sotto/ui";

export function Logo({
  tone = "ink",
  height = 28,
  decorative = false,
}: {
  tone?: "ink" | "white";
  height?: number;
  /** True inside a link that already names Sotto (aria-label). */
  decorative?: boolean;
}) {
  const Lockup = tone === "white" ? SottoLockupWhite : SottoLockupInk;
  return <Lockup height={height} decorative={decorative} />;
}
