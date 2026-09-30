// The landing design sets CSS custom properties inline (--i, --l, --L, --o, --fx, --fy), which
// React's style type does not list (step 3.1).
import "react";

declare module "react" {
  interface CSSProperties {
    [property: `--${string}`]: string | number | undefined;
  }
}
