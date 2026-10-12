"use client";

// The footer's wordmark (landing v8): a blurred layer under a sharp one, and the sharp one shows
// through a round mask. By itself the mask glides from side to side; under a mouse it follows the
// cursor. The mask is drawn in the sharp layer's own box, which is narrower than the footer and
// centred in it, so the cursor is measured against that layer, on every frame: scrolling, a resize,
// a font that loads late or a scale on a parent then change nothing. The position goes straight to
// the element as --fx and --fy, with no render of the landing. The stylesheet eases between the glide
// and the cursor (--wm), so entering and leaving never jump.
//
// Touch and pen input and a reader who asks for less motion get no tracking: the layer keeps the
// state the stylesheet gives it.
import { SottoWordmarkWhite } from "@sotto/ui";
import { useEffect, useRef } from "react";

export function WordmarkFocus() {
  const root = useRef<HTMLDivElement>(null);
  const sharp = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const element = root.current;
    const layer = sharp.current;
    if (!element || !layer) return;
    const lessMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    /** The cursor's last place in the window while it is over the wordmark. */
    let cursor: { x: number; y: number } | null = null;
    let frame = 0;

    const release = () => {
      cursor = null;
      element.classList.remove("man");
      window.removeEventListener("scroll", schedule);
    };
    const place = () => {
      frame = 0;
      if (!cursor) return;
      const box = element.getBoundingClientRect();
      // The page scrolled the wordmark away from a cursor that did not move.
      if (
        cursor.x < box.left ||
        cursor.x > box.right ||
        cursor.y < box.top ||
        cursor.y > box.bottom
      ) {
        release();
        return;
      }
      const rect = layer.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      // From the window to the layer's own pixels, a scale on any parent included.
      const x = ((cursor.x - rect.left) / rect.width) * layer.offsetWidth;
      const y = ((cursor.y - rect.top) / rect.height) * layer.offsetHeight;
      element.style.setProperty("--fx", `${x.toFixed(1)}px`);
      element.style.setProperty("--fy", `${y.toFixed(1)}px`);
      element.classList.add("man");
    };
    function schedule() {
      if (!frame) frame = requestAnimationFrame(place);
    }
    const follow = (event: PointerEvent) => {
      if (event.pointerType !== "mouse" || lessMotion.matches) return;
      // A still cursor over a scrolling page moves over the wordmark too.
      if (!cursor) window.addEventListener("scroll", schedule, { passive: true });
      cursor = { x: event.clientX, y: event.clientY };
      schedule();
    };

    element.addEventListener("pointermove", follow, { passive: true });
    element.addEventListener("pointerleave", release, { passive: true });
    return () => {
      element.removeEventListener("pointermove", follow);
      element.removeEventListener("pointerleave", release);
      window.removeEventListener("scroll", schedule);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <div className="wmk" ref={root} aria-hidden="true" data-testid="wordmark-focus">
      <span className="bl">
        <SottoWordmarkWhite height={256} decorative />
      </span>
      <span className="sh" ref={sharp}>
        <SottoWordmarkWhite height={256} decorative />
      </span>
    </div>
  );
}
