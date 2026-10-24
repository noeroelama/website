"use client";

import type { ReactNode } from "react";
import { Button } from "./button";
import type { IconName } from "./icon";
import { Modal } from "./modal";

/**
 * Confirmation for destructive or account-changing actions, in the shared popup look (Back + the
 * action at the bottom right). Records are never removed for good (soft delete), so the default
 * wording is "Move to trash" (DEC-16); list pages use `DELETE_HINT` as the message.
 */
export function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel = "Move to trash",
  tone = "danger",
  icon,
  pending = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  children: ReactNode;
  confirmLabel?: string;
  tone?: "danger" | "success" | "primary";
  /** Icon of the action button (e.g. "trash"). */
  icon?: IconName;
  pending?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Modal
      open={open}
      title={title}
      width={420}
      hideClose
      onClose={onCancel}
      footer={
        <div className="admin-modal__footer-row">
          <Button variant="outline" icon="chevronLeft" onClick={onCancel}>
            Back
          </Button>
          <Button variant={tone} {...(icon ? { icon } : {})} disabled={pending} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </div>
      }
    >
      <div className="admin-delete-confirm__message">{children}</div>
    </Modal>
  );
}

/** Message of a soft delete on the content list pages (revertible on the Audit Log). */
export const DELETE_HINT =
  "They disappear from the public page now. You can revert deletion on the admin log before 14 days.";
