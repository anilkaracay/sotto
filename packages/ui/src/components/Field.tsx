import type {
  HTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  Ref,
  SelectHTMLAttributes,
} from "react";
import { cx } from "./cx.ts";
import styles from "./field.module.css";

/** Two columns of fields; a wide field or the actions take the whole row. */
export function FieldGrid({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cx(styles.grid, className)} {...rest} />;
}

/** A field: its label above the control, then the hint and the problem, if any. */
export function Field({
  label,
  htmlFor,
  hint,
  error,
  wide = false,
  className,
  children,
}: {
  label: ReactNode;
  htmlFor: string;
  hint?: ReactNode;
  error?: ReactNode;
  wide?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cx(styles.field, wide && styles.wide, className)}>
      <label className={styles.label} htmlFor={htmlFor}>
        {label}
      </label>
      {children}
      {hint ? <small className={styles.hint}>{hint}</small> : null}
      {error ? <small className={styles.error}>{error}</small> : null}
    </div>
  );
}

/** A text control (design .drawer input). */
export function Input({
  className,
  ref,
  ...rest
}: InputHTMLAttributes<HTMLInputElement> & { ref?: Ref<HTMLInputElement> }) {
  return <input ref={ref} className={cx(styles.control, className)} {...rest} />;
}

/** A select with the design's chevron. */
export function Select({
  className,
  ref,
  ...rest
}: SelectHTMLAttributes<HTMLSelectElement> & { ref?: Ref<HTMLSelectElement> }) {
  return <select ref={ref} className={cx(styles.control, styles.select, className)} {...rest} />;
}

/** The buttons under the fields, across both columns. */
export function FieldActions({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cx(styles.actions, className)} {...rest} />;
}
