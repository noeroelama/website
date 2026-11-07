"use client";

import { useState, type ButtonHTMLAttributes, type MouseEvent, type ReactNode } from "react";
import { Icon, type IconName } from "./icon";

/**
 * Admin button. Ported from the earlier Vite admin: supports `href` (renders an `<a>`) and an
 * optional leading icon. Variants/sizes map to `admin-btn--*` classes defined in
 * `apps/admin/src/app/globals.css` (all colours from the shared design tokens).
 *
 * States (docs/admin-shell.md "Buttons"): default, hover (pointer devices), focus, press,
 * loading and disabled. Loading: `loading`, or automatically while an `onClick` that returns a
 * promise runs; the button is then disabled and `aria-busy`.
 *
 * A real `<button>`: `type="button"` unless `type="submit"` is given. A submit button with an
 * `onClick` checks its form first (native validation, skipped with `formNoValidate`), runs the
 * `onClick` instead of submitting, and never reloads the page; without `onClick` the form's own
 * `onSubmit` runs.
 */
export type ButtonVariant = "primary" | "maroon" | "ghost" | "outline" | "success" | "danger";
export type ButtonSize = "sm" | "md" | "lg" | "icon";

export interface ButtonCommonProps {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: IconName;
  children?: ReactNode;
  className?: string;
}

type BaseButtonProps = ButtonCommonProps &
  Omit<ButtonHTMLAttributes<HTMLButtonElement>, "onClick"> & {
    /** Shows the loading state (also on while a returned promise runs). */
    loading?: boolean;
    /** May return a promise: the button shows the loading state until it settles. */
    onClick?: (event: MouseEvent<HTMLButtonElement>) => unknown;
  };

export interface ButtonLinkProps extends ButtonCommonProps {
  href: string;
  target?: string;
  rel?: string;
  title?: string;
  onClick?: () => unknown;
}

export type ButtonPropsUnion = BaseButtonProps | ButtonLinkProps;

function classFor(variant: ButtonVariant, size: ButtonSize, className?: string): string {
  const classes = ["admin-btn", `admin-btn--${variant}`];
  if (size !== "md") classes.push(`admin-btn--${size}`);
  if (className) classes.push(className);
  return classes.join(" ");
}

export function Button(props: ButtonPropsUnion) {
  if ("href" in props) {
    const { href, target, rel, title, onClick, className } = props;
    const variant = props.variant ?? "primary";
    const size = props.size ?? "md";
    return (
      <a
        href={href}
        target={target}
        rel={rel}
        title={title}
        onClick={onClick ? () => void onClick() : undefined}
        className={classFor(variant, size, className)}
      >
        {props.icon ? <Icon name={props.icon} size={16} /> : null}
        {props.children}
      </a>
    );
  }
  return <NativeButton {...props} />;
}

function NativeButton(props: BaseButtonProps) {
  const {
    variant = "primary",
    size = "md",
    icon,
    children,
    className,
    loading = false,
    type = "button",
    disabled,
    onClick,
    ...rest
  } = props;
  const [running, setRunning] = useState(false);
  const busy = loading || running;

  function click(event: MouseEvent<HTMLButtonElement>) {
    if (!onClick) return;
    const button = event.currentTarget;
    if (type === "submit" && button.form) {
      event.preventDefault(); // the onClick below is the action; no page reload
      if (!button.formNoValidate && !button.form.reportValidity()) return;
    }
    const result = onClick(event);
    if (result instanceof Promise) {
      setRunning(true);
      void result.finally(() => setRunning(false));
    }
  }

  return (
    <button
      {...rest}
      type={type}
      className={classFor(variant, size, className)}
      disabled={disabled === true || busy}
      aria-busy={busy || undefined}
      onClick={click}
    >
      {icon ? <Icon name={icon} size={16} /> : null}
      {children}
    </button>
  );
}
