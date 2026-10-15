import type { ButtonHTMLAttributes, ReactNode } from "react";
import { Icon, type IconName } from "./icon";

/**
 * Admin button. Ported from the earlier Vite admin: supports `href` (renders an `<a>`) and an
 * optional leading icon. Variants/sizes map to `admin-btn--*` classes defined in
 * `apps/admin/src/app/globals.css` (all colours from the shared design tokens).
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

type BaseButtonProps = ButtonCommonProps & ButtonHTMLAttributes<HTMLButtonElement>;

export interface ButtonLinkProps extends ButtonCommonProps {
  href: string;
  target?: string;
  rel?: string;
  title?: string;
  onClick?: () => void;
}

export type ButtonPropsUnion = BaseButtonProps | ButtonLinkProps;

function classFor(variant: ButtonVariant, size: ButtonSize, className?: string): string {
  const classes = ["admin-btn", `admin-btn--${variant}`];
  if (size !== "md") classes.push(`admin-btn--${size}`);
  if (className) classes.push(className);
  return classes.join(" ");
}

/** Drop the custom (non-DOM) props before spreading the rest onto a native button. */
function stripCommon(props: BaseButtonProps): Omit<BaseButtonProps, keyof ButtonCommonProps> {
  const { variant, size, icon, children, className, ...rest } = props;
  void variant;
  void size;
  void icon;
  void children;
  void className;
  return rest;
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
        onClick={onClick}
        className={classFor(variant, size, className)}
      >
        {props.icon ? <Icon name={props.icon} size={16} /> : null}
        {props.children}
      </a>
    );
  }

  const variant = props.variant ?? "primary";
  const size = props.size ?? "md";
  return (
    <button className={classFor(variant, size, props.className)} {...stripCommon(props)}>
      {props.icon ? <Icon name={props.icon} size={16} /> : null}
      {props.children}
    </button>
  );
}
