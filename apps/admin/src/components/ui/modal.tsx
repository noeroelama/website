"use client";

import { useEffect } from "react";
import type { CSSProperties, ReactNode } from "react";
import { Icon } from "./icon";

/**
 * Admin modal (client component — needs DOM effects). Closes on Escape (unless a control inside
 * already handled it with preventDefault, e.g. an open dropdown) or overlay click.
 * Styling via `admin-modal*` classes in globals.css.
 */
export interface ModalProps {
  open: boolean;
  title: string;
  subtitle?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
  className?: string;
  hideClose?: boolean;
  style?: CSSProperties;
  /**
   * Body and footer form one `<form>`: Enter in a field and a `type="submit"` footer button run
   * the action after native validation (see Button). Leave it off when the body has its own form.
   */
  asForm?: boolean;
}

export function Modal({
  open,
  title,
  subtitle,
  onClose,
  children,
  footer,
  width = 560,
  className,
  hideClose,
  style,
  asForm = false,
}: ModalProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      // A dropdown inside the popup that handles Escape itself calls preventDefault().
      if (e.key === "Escape" && !e.defaultPrevented) onClose();
    };
    document.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="admin-modal-overlay" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={["admin-modal", className].filter(Boolean).join(" ")}
        style={{ maxWidth: width, ...style }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="admin-modal__header">
          <div>
            <div className="admin-modal__title">{title}</div>
            {subtitle ? <div className="admin-modal__subtitle">{subtitle}</div> : null}
          </div>
          {!hideClose ? (
            <button
              type="button"
              className="admin-modal__close"
              onClick={onClose}
              aria-label="Close"
            >
              <Icon name="x" size={20} />
            </button>
          ) : null}
        </div>
        {asForm ? (
          <form className="admin-modal__form" onSubmit={(event) => event.preventDefault()}>
            <div className="admin-modal__body">{children}</div>
            {footer ? <div className="admin-modal__footer">{footer}</div> : null}
          </form>
        ) : (
          <>
            <div className="admin-modal__body">{children}</div>
            {footer ? <div className="admin-modal__footer">{footer}</div> : null}
          </>
        )}
      </div>
    </div>
  );
}
