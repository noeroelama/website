"use client";

import { useEffect } from "react";
import type { CSSProperties, FormEvent, ReactNode } from "react";
import { Icon } from "./icon";

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
   * A form popup, built like Article Settings: the body and footer are one `<form>` (the footer's
   * submit button runs native validation), on the cream side panel, 548px wide, without the X
   * (the footer has Back). `onSubmit` is for forms read with `FormData`; otherwise the submit
   * button's `onClick` does the work.
   */
  asForm?: boolean;
  onSubmit?: (event: FormEvent<HTMLFormElement>) => void;
}

export function Modal({
  open,
  title,
  subtitle,
  onClose,
  children,
  footer,
  asForm = false,
  width = asForm ? 548 : 560,
  className,
  hideClose = asForm,
  style,
  onSubmit,
}: ModalProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
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
        className={["admin-modal", asForm ? "admin-modal--side" : "", className]
          .filter(Boolean)
          .join(" ")}
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
          <form
            className="admin-modal__form"
            onSubmit={(event) => {
              event.preventDefault();
              onSubmit?.(event);
            }}
          >
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
