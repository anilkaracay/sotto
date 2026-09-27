import type { ButtonHTMLAttributes } from "react";
import styles from "./button.module.css";
import { cx } from "./cx.ts";

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "dark" | "blue" | "line";
  size?: "sm" | "md" | "lg";
};

/** Pill button (design .btn and its variants). */
export function Button({
  variant = "dark",
  size = "md",
  className,
  type = "button",
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cx(
        styles.button,
        variant === "blue" && styles.blue,
        variant === "line" && styles.line,
        size === "sm" && styles.sm,
        size === "lg" && styles.lg,
        className,
      )}
      {...rest}
    />
  );
}
