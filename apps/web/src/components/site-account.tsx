"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { shortName } from "@website/ui";
import type { Dictionary } from "@/i18n/dictionaries";

type Labels = Dictionary["account"];

export function LoginChip(props: { t: Labels }) {
  return (
    <a className="site-account-chip" href="/login">
      {props.t.login}
    </a>
  );
}

export function SiteAccount(props: {
  name: string;
  initials: string;
  picture: string | null;
  t: Labels;
}) {
  const [open, setOpen] = useState(false);
  const [signOutFailed, setSignOutFailed] = useState(false);
  const router = useRouter();
  const menuId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    menuRef.current?.querySelector<HTMLElement>("[role='menuitem']")?.focus();
    const close = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);

  function onMenuKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const items = [...(menuRef.current?.querySelectorAll<HTMLElement>("[role='menuitem']") ?? [])];
    const index = items.indexOf(document.activeElement as HTMLElement);
    if (event.key === "Escape") {
      setOpen(false);
      buttonRef.current?.focus();
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      items[(index + step + items.length) % items.length]?.focus();
    } else if (event.key === "Tab") {
      setOpen(false);
    }
  }

  async function signOut() {
    setSignOutFailed(false);
    try {
      const response = await fetch("/api/session", { method: "DELETE" });
      if (!response.ok) throw new Error(String(response.status));
      setOpen(false);
      router.refresh();
    } catch {
      setSignOutFailed(true);
    }
  }

  return (
    <div ref={rootRef} className="site-account">
      <button
        ref={buttonRef}
        type="button"
        className="site-account-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={`${props.t.menu}: ${props.name}`}
        onClick={() => setOpen((value) => !value)}
      >
        {props.picture ? (
          // eslint-disable-next-line @next/next/no-img-element -- provider photo, any host
          <img
            className="site-account-avatar"
            src={props.picture}
            alt=""
            width={24}
            height={24}
            referrerPolicy="no-referrer"
          />
        ) : (
          <span className="site-account-avatar" aria-hidden="true">
            {props.initials}
          </span>
        )}
        <span>{shortName(props.name)}</span>
        <svg
          className="site-account-arrow"
          viewBox="0 0 16 16"
          aria-hidden="true"
          focusable="false"
        >
          <path d="m4 6 4 4 4-4" />
        </svg>
      </button>
      {open && (
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          aria-label={props.t.menu}
          className="site-account-menu"
          onKeyDown={onMenuKeyDown}
        >
          <a role="menuitem" href="/account/profile">
            {props.t.profile}
          </a>
          <a role="menuitem" href="/account">
            {props.t.account}
          </a>
          <button role="menuitem" type="button" onClick={() => void signOut()}>
            {props.t.logout}
          </button>
        </div>
      )}
      {signOutFailed && (
        <p role="alert" className="site-account-error">
          {props.t.signOutFailed}
        </p>
      )}
    </div>
  );
}
