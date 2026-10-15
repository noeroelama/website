"use client";

import type { ReactNode } from "react";
import { Button } from "./button";
import { Modal } from "./modal";

/**
 * Confirmation for destructive or account-changing actions. Records are never removed for good
 * (soft delete), so the default wording is "Move to trash" (DEC-16).
 */
export function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel = "Move to trash",
  tone = "danger",
  pending = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  children: ReactNode;
  confirmLabel?: string;
  tone?: "danger" | "success" | "primary";
  pending?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Modal
      open={open}
      title={title}
      onClose={onCancel}
      footer={
        <div className="admin-modal__footer-row admin-modal__footer-row--end">
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant={tone} disabled={pending} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </div>
      }
    >
      <div className="admin-delete-confirm__message">{children}</div>
    </Modal>
  );
}
