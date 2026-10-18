"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "@/components/ui/modal";
import { useToastMessage, ToastBanner } from "@/components/ui/toast";
import { Icon } from "@/components/ui/icon";

interface PasskeyInfo {
  name: string;
  rowName: string;
  rowSub: string;
  deviceLine: string;
  detailLine: string;
}

const PASSKEYS_START: PasskeyInfo[] = [
  {
    name: "MacBook Pro Chrome",
    rowName: "Mac Book Pro",
    rowSub: "Chrome · macOS · Created on 23 Mar 2023",
    deviceLine: "MacBook Pro · Chrome 141 · macOS 16",
    detailLine: "Passkey will be saved in iCloud Keychain",
  },
  {
    name: "IPhone",
    rowName: "IPhone",
    rowSub: "iOS · iCloud Keychain · Created on 23 Mar 2023",
    deviceLine: "IPhone · iOS 18 · iCloud Keychain",
    detailLine: "Passkey will be saved in iCloud Keychain",
  },
];

/**
 * Recovered admin "Your account" page (from the Vite admin, session b561ba27),
 * ported to the new admin: Connected Account (Google + primary/backup email),
 * Passkeys (add / edit / delete), Danger Zone (delete account), plus the six
 * popups. All colours come from design tokens; flat black card == --color-black,
 * cream text == --color-brand-50.
 */

/** Delete-account confirm hint — shared by the textbox placeholder and the
    caption under it so the two can never drift apart. */
const DELETE_CONFIRM_HINT = 'Type "DELETE" in capital letters to activate the button.';

export function AccountAccountPage() {
  const { message: toastMessage, show: toast } = useToastMessage();
  const router = useRouter();
  const [verifyOpen, setVerifyOpen] = useState(false);
  const [passkeyOpen, setPasskeyOpen] = useState(false);
  const [editPasskeyOpen, setEditPasskeyOpen] = useState(false);
  const [deletePasskeyOpen, setDeletePasskeyOpen] = useState(false);
  const [editingPasskey, setEditingPasskey] = useState<PasskeyInfo>(PASSKEYS_START[0]!);
  const [passkeys, setPasskeys] = useState<PasskeyInfo[]>(PASSKEYS_START);
  const [passkeyName, setPasskeyName] = useState("MacBook Pro Chrome");
  const [editEmailOpen, setEditEmailOpen] = useState(false);
  const [editingEmailKind, setEditingEmailKind] = useState<"primary" | "backup">("primary");
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [primaryEmail, setPrimaryEmail] = useState("muflihkamil05@gmail.com");
  const [backupEmail, setBackupEmail] = useState("muflihkamil05@gmail.com");
  const [emailValue, setEmailValue] = useState(primaryEmail);
  const codeRefs = useRef<Array<HTMLInputElement | null>>([]);
  const handleCodeChange = (i: number) => {
    if (i < 3) codeRefs.current[i + 1]?.focus();
    else codeRefs.current[i]?.blur();
  };

  return (
    <div className="admin-acct-page">
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-5)" }}>
        {/* ---------- Connected Account ---------- */}
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2-5)" }}>
          <div className="admin-acct-head">
            <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-0-5)" }}>
              <span className="admin-acct-head__title">Connected Account</span>
              <span className="admin-acct-head__sub">
                For notifications, account recovery, and verifications.
              </span>
            </div>
          </div>

          {/* Google */}
          <div className="admin-acct-row">
            <div className="admin-acct-avatar admin-acct-avatar--chrome">
              <Icon name="user" size={17} />
            </div>
            <div className="admin-acct-mid">
              <span className="admin-acct-top">Google · Muhammad Muflih Naufal Kamil</span>
              <span className="admin-acct-sub">
                muflihkamil05@gmail.com · Connected since 04 Feb 2026
              </span>
            </div>
            <div className="admin-acct-right">
              <span className="admin-acct-chip admin-acct-chip--ok">Connected</span>
              <button className="admin-acct-btn" type="button">
                Disconnect Google Account
              </button>
            </div>
          </div>

          {/* Primary email */}
          <div className="admin-acct-row">
            <div className="admin-acct-avatar">
              <Icon name="mail" size={17} />
            </div>
            <div className="admin-acct-mid">
              <span className="admin-acct-top">{primaryEmail}</span>
              <span className="admin-acct-sub">Primary email address</span>
            </div>
            <div className="admin-acct-right">
              <span className="admin-acct-chip admin-acct-chip--ok">Verified</span>
              <button
                className="admin-acct-btn"
                type="button"
                onClick={() => {
                  setEditingEmailKind("primary");
                  setEmailValue(primaryEmail);
                  setEditEmailOpen(true);
                }}
              >
                <Icon name="edit" size={14} />
                Edit
              </button>
            </div>
          </div>

          {/* Backup email */}
          <div className="admin-acct-row">
            <div className="admin-acct-avatar">
              <Icon name="shield" size={17} />
            </div>
            <div className="admin-acct-mid">
              <span className="admin-acct-top">{backupEmail}</span>
              <span className="admin-acct-sub">Backup email address</span>
            </div>
            <div className="admin-acct-right">
              <span className="admin-acct-chip admin-acct-chip--bad">Not Verified</span>
              <button className="admin-acct-btn" type="button" onClick={() => setVerifyOpen(true)}>
                Resend Verification
              </button>
              <button
                className="admin-acct-btn"
                type="button"
                onClick={() => {
                  setEditingEmailKind("backup");
                  setEmailValue(backupEmail);
                  setEditEmailOpen(true);
                }}
              >
                <Icon name="edit" size={14} />
                Edit
              </button>
            </div>
          </div>
        </div>

        <div className="admin-acct-divider" />

        {/* ---------- Passkeys ---------- */}
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2-5)" }}>
          <div className="admin-acct-head">
            <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-0-5)" }}>
              <span className="admin-acct-head__titleline">
                <span className="admin-acct-head__title">Passkeys</span>
                <span className="admin-acct-head__count">{passkeys.length}</span>
              </span>
              <span className="admin-acct-head__sub">Fingerprint, Face ID, or Device PIN.</span>
            </div>
            <button
              className="admin-acct-btn--white"
              type="button"
              onClick={() => setPasskeyOpen(true)}
            >
              <Icon name="plus" size={14} />
              Add Passkey
            </button>
          </div>

          {passkeys.map((pk) => (
            <div key={pk.name} className="admin-acct-row">
              <div className="admin-acct-avatar">
                <Icon name="key" size={17} />
              </div>
              <div className="admin-acct-mid">
                <span className="admin-acct-top">{pk.rowName}</span>
                <span className="admin-acct-sub">{pk.rowSub}</span>
              </div>
              <div className="admin-acct-right">
                <div className="admin-acct-lastused">
                  <div className="admin-acct-lastused__label">Last Used</div>
                  <div className="admin-acct-lastused__value">2 hours ago</div>
                </div>
                <button
                  className="admin-acct-btn--danger"
                  type="button"
                  onClick={() => {
                    setEditingPasskey(pk);
                    setDeletePasskeyOpen(true);
                  }}
                >
                  <Icon name="trash" size={14} />
                  Delete
                </button>
                <button
                  className="admin-acct-btn"
                  type="button"
                  onClick={() => {
                    setEditingPasskey(pk);
                    setPasskeyName(pk.name);
                    setEditPasskeyOpen(true);
                  }}
                >
                  <Icon name="edit" size={14} />
                  Edit
                </button>
              </div>
            </div>
          ))}
        </div>

        <div className="admin-acct-divider" />

        {/* ---------- Danger Zone ---------- */}
        <div className="admin-acct-row admin-acct-row--stack">
          <span className="admin-acct-danger__title">Danger Zone</span>
          <div className="admin-acct-danger__divider" />
          <div className="admin-acct-danger__row">
            <div style={{ minWidth: 0 }}>
              <span className="admin-acct-top" style={{ display: "block" }}>
                Delete Account
              </span>
              <span className="admin-acct-sub" style={{ display: "block" }}>
                Once you delete your account, there is no going back. Please be certain.
              </span>
            </div>
            <button
              className="admin-acct-btn--danger"
              type="button"
              onClick={() => {
                setConfirmText("");
                setDeleteOpen(true);
              }}
            >
              <Icon name="trash" size={14} />
              Delete Account
            </button>
          </div>
        </div>

        <div className="admin-acct-divider" />

        {/* ---------- Footer ---------- */}
        <div className="admin-acct-foot">
          <button className="admin-acct-btn--cream" type="button" onClick={() => router.back()}>
            <Icon name="chevronLeft" size={14} />
            Back
          </button>
          <button
            className="admin-acct-btn--cream"
            type="button"
            onClick={() => toast("Account saved")}
          >
            <Icon name="cloud" size={14} />
            Save
          </button>
        </div>
      </div>

      {/* ---------- Popup Email Verification ---------- */}
      <Modal
        open={verifyOpen}
        onClose={() => setVerifyOpen(false)}
        title="Email Verification"
        subtitle="Enter the verification code sent to youremail@example.com"
        width={480}
        className="admin-modal--dark"
        hideClose
        footer={
          <div
            className="admin-modal__footer-row--end"
            style={{ marginTop: "calc(var(--space-0-5) * -1)" }}
          >
            <button
              className="admin-acct-btn--cream admin-acct-btn--pop"
              type="button"
              onClick={() => setVerifyOpen(false)}
            >
              <Icon name="chevronLeft" size={12} />
              Back
            </button>
            <button
              className="admin-acct-btn--cream admin-acct-btn--pop"
              type="button"
              onClick={() => {
                setVerifyOpen(false);
                toast("Email verified");
              }}
            >
              Verify Email
            </button>
          </div>
        }
      >
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3-5)" }}>
          <span className="admin-acct-modal-text">
            Didn&apos;t receive the code?{" "}
            <button
              className="admin-acct-link"
              type="button"
              onClick={() => toast("Verification code resent")}
            >
              Resend Code
            </button>
          </span>
          <div style={{ display: "flex", gap: "var(--space-2)", justifyContent: "center" }}>
            {[0, 1, 2, 3].map((i) => (
              <input
                key={i}
                ref={(el) => {
                  codeRefs.current[i] = el;
                }}
                type="text"
                inputMode="numeric"
                maxLength={1}
                aria-label={`Verification code digit ${i + 1}`}
                onChange={() => handleCodeChange(i)}
                className="admin-acct-code"
              />
            ))}
          </div>
        </div>
      </Modal>

      {/* ---------- Popup Add Passkey ---------- */}
      <Modal
        open={passkeyOpen}
        onClose={() => setPasskeyOpen(false)}
        title="Add Passkey"
        subtitle="Your device will ask for a fingerprint, face, or PIN."
        width={480}
        className="admin-modal--dark admin-acct-edit"
        hideClose
        footer={
          <div
            className="admin-modal__footer-row--end"
            style={{ marginTop: "calc(var(--space-0-5) * -1)" }}
          >
            <button
              className="admin-acct-btn--cream admin-acct-btn--pop"
              type="button"
              onClick={() => setPasskeyOpen(false)}
            >
              <Icon name="chevronLeft" size={12} />
              Back
            </button>
            <button
              className="admin-acct-btn--cream admin-acct-btn--pop"
              type="button"
              onClick={() => {
                setPasskeys((prev) => [
                  ...prev,
                  {
                    name: passkeyName,
                    rowName: passkeyName,
                    rowSub: "Chrome · macOS · Created on 23 Mar 2023",
                    deviceLine: `${passkeyName} · Chrome 141 · macOS 16`,
                    detailLine: "Passkey will be saved in iCloud Keychain",
                  },
                ]);
                setPasskeyOpen(false);
                toast("Passkey saved");
              }}
            >
              <Icon name="cloud" size={12} />
              Save
            </button>
          </div>
        }
      >
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3-5)" }}>
          {/* Container perangkat — krem */}
          <div className="admin-acct-pop">
            <div className="admin-acct-pop__icon">
              <Icon name="laptop" size={17} />
            </div>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "var(--space-0-5)",
                minWidth: 0,
              }}
            >
              <span className="admin-acct-pop__title">MacBook Pro · Chrome 141 · macOS 16</span>
              <span className="admin-acct-pop__sub">Passkey will be saved in iCloud Keychain</span>
            </div>
          </div>

          {/* PASSKEY NAME */}
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-1-5)" }}>
            <span className="admin-acct-fieldlabel">Passkey Name</span>
            <div style={{ position: "relative" }}>
              <input
                className="admin-acct-input-cream"
                value={passkeyName}
                maxLength={32}
                onChange={(e) => setPasskeyName(e.target.value)}
                style={{ paddingRight: "42px" }}
              />
              <span
                style={{
                  position: "absolute",
                  right: "12px",
                  top: "50%",
                  transform: "translateY(-50%)",
                  fontSize: "var(--text-xs)",
                  color: "color-mix(in srgb, var(--color-black) 55%, transparent)",
                }}
              >
                {passkeyName.length}/32
              </span>
            </div>
          </div>
        </div>
      </Modal>

      {/* ---------- Popup Edit Passkey ---------- */}
      <Modal
        open={editPasskeyOpen}
        onClose={() => setEditPasskeyOpen(false)}
        title="Edit Passkey"
        subtitle="Edit passkey name."
        width={480}
        className="admin-modal--dark admin-acct-edit"
        hideClose
        footer={
          <div
            className="admin-modal__footer-row--end"
            style={{ marginTop: "calc(var(--space-0-5) * -1)" }}
          >
            <button
              className="admin-acct-btn--cream admin-acct-btn--pop"
              type="button"
              onClick={() => setEditPasskeyOpen(false)}
            >
              <Icon name="chevronLeft" size={12} />
              Back
            </button>
            <button
              className="admin-acct-btn--cream admin-acct-btn--pop"
              type="button"
              onClick={() => {
                setEditPasskeyOpen(false);
                toast("Passkey updated");
              }}
            >
              <Icon name="cloud" size={12} />
              Save
            </button>
          </div>
        }
      >
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3-5)" }}>
          {/* Container perangkat — cream */}
          <div className="admin-acct-pop">
            <div className="admin-acct-pop__icon">
              <Icon name="laptop" size={17} />
            </div>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "var(--space-0-5)",
                minWidth: 0,
              }}
            >
              <span className="admin-acct-pop__title">{editingPasskey.deviceLine}</span>
              <span className="admin-acct-pop__sub">{editingPasskey.detailLine}</span>
            </div>
          </div>

          {/* PASSKEY NAME */}
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-1-5)" }}>
            <span className="admin-acct-fieldlabel">Passkey Name</span>
            <div style={{ position: "relative" }}>
              <input
                className="admin-acct-input-cream"
                value={passkeyName}
                maxLength={32}
                onChange={(e) => setPasskeyName(e.target.value)}
                style={{ paddingRight: "42px" }}
              />
              <span
                style={{
                  position: "absolute",
                  right: "12px",
                  top: "50%",
                  transform: "translateY(-50%)",
                  fontSize: "var(--text-xs)",
                  color: "color-mix(in srgb, var(--color-black) 55%, transparent)",
                }}
              >
                {passkeyName.length}/32
              </span>
            </div>
          </div>
        </div>
      </Modal>

      {/* ---------- Popup Edit Email ---------- */}
      <Modal
        open={editEmailOpen}
        onClose={() => setEditEmailOpen(false)}
        title="Edit Email"
        subtitle={
          editingEmailKind === "primary"
            ? "Edit your primary email address."
            : "Edit your backup email address."
        }
        width={480}
        className="admin-modal--dark admin-acct-edit"
        hideClose
        footer={
          <div
            className="admin-modal__footer-row--end"
            style={{ marginTop: "calc(var(--space-0-5) * -1)" }}
          >
            <button
              className="admin-acct-btn--cream admin-acct-btn--pop"
              type="button"
              onClick={() => setEditEmailOpen(false)}
            >
              <Icon name="chevronLeft" size={12} />
              Back
            </button>
            <button
              className="admin-acct-btn--cream admin-acct-btn--pop"
              type="button"
              onClick={() => {
                if (editingEmailKind === "primary") setPrimaryEmail(emailValue);
                else setBackupEmail(emailValue);
                setEditEmailOpen(false);
                toast("Email updated");
              }}
            >
              <Icon name="cloud" size={12} />
              Save
            </button>
          </div>
        }
      >
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3-5)" }}>
          {/* EMAIL ADDRESS */}
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-1-5)" }}>
            <span className="admin-acct-fieldlabel">Email Address</span>
            <input
              className="admin-acct-input-cream"
              type="email"
              value={emailValue}
              onChange={(e) => setEmailValue(e.target.value)}
            />
          </div>
        </div>
      </Modal>

      {/* ---------- Popup Delete Account ---------- */}
      <Modal
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        title="Delete Account?"
        subtitle="Once you delete your account, there is no going back."
        width={480}
        className="admin-modal--dark admin-acct-delete"
        hideClose
        footer={
          <div
            className="admin-modal__footer-row--end"
            style={{ marginTop: "calc(var(--space-0-5) * -1)" }}
          >
            <button
              className="admin-acct-btn--cream admin-acct-btn--pop"
              type="button"
              onClick={() => setDeleteOpen(false)}
            >
              <Icon name="chevronLeft" size={12} />
              Back
            </button>
            <button
              className="admin-acct-btn--red admin-acct-btn--pop"
              type="button"
              disabled={confirmText !== "DELETE"}
              onClick={() => {
                setDeleteOpen(false);
                toast("Account deleted");
              }}
            >
              <Icon name="trash" size={12} />
              Delete Account Permanently
            </button>
          </div>
        }
      >
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3-5)" }}>
          {/* Container peringatan — teks merah */}
          <div className="admin-acct-pop">
            <div className="admin-acct-pop__icon admin-acct-pop__icon--warn">
              <Icon name="warning" size={17} />
            </div>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "var(--space-0-5)",
                minWidth: 0,
              }}
            >
              <span className="admin-acct-pop__warn">
                Membership, activities, and {PASSKEYS_START.length} passkeys will be deleted.
              </span>
              <span className="admin-acct-pop__warn-sub">
                Google account will be automatically disconnected.
              </span>
            </div>
          </div>

          {/* CONFIRMATION */}
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-1-5)" }}>
            <span className="admin-acct-fieldlabel">Confirmation</span>
            <input
              className="admin-acct-input-cream"
              placeholder={DELETE_CONFIRM_HINT}
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
            />
            <span className="admin-acct-input-hint">{DELETE_CONFIRM_HINT}</span>
          </div>
        </div>
      </Modal>

      {/* ---------- Popup Delete Passkey ---------- */}
      <Modal
        open={deletePasskeyOpen}
        onClose={() => setDeletePasskeyOpen(false)}
        title="Delete Passkey?"
        subtitle="Once you delete this passkey, you will no longer be able to sign in from this device."
        width={480}
        className="admin-modal--dark admin-acct-delete"
        hideClose
        footer={
          <div
            className="admin-modal__footer-row--end"
            style={{ marginTop: "calc(var(--space-0-5) * -1)" }}
          >
            <button
              className="admin-acct-btn--cream admin-acct-btn--pop"
              type="button"
              onClick={() => setDeletePasskeyOpen(false)}
            >
              <Icon name="chevronLeft" size={12} />
              Back
            </button>
            <button
              className="admin-acct-btn--red admin-acct-btn--pop"
              type="button"
              onClick={() => {
                setPasskeys((prev) => prev.filter((pk) => pk.name !== editingPasskey.name));
                setDeletePasskeyOpen(false);
                toast("Passkey deleted");
              }}
            >
              <Icon name="trash" size={12} />
              Delete
            </button>
          </div>
        }
      >
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3-5)" }}>
          {/* Container peringatan — teks merah */}
          <div className="admin-acct-pop">
            <div className="admin-acct-pop__icon admin-acct-pop__icon--warn">
              <Icon name="warning" size={17} />
            </div>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "var(--space-0-5)",
                minWidth: 0,
              }}
            >
              <span className="admin-acct-pop__warn">{editingPasskey.deviceLine}</span>
              <span className="admin-acct-pop__warn-sub">
                This passkey will be permanently removed from your account.
              </span>
            </div>
          </div>
        </div>
      </Modal>

      <ToastBanner message={toastMessage} />
    </div>
  );
}
