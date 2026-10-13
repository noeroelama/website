"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import type { NavItem } from "../navigation";

/** Display data only. Which items exist was decided on the server (see navigation.ts). */
export interface SidebarUser {
  readonly name: string;
  readonly email: string | null;
  readonly initials: string;
}

const ORGANISATION = "PPI Dunia Kawasan Asia-Oseania";
/** Must match the desktop breakpoint in app/globals.css. */
const DESKTOP_QUERY = "(min-width: 1024px)";

function subscribeToViewport(onChange: () => void) {
  const query = window.matchMedia(DESKTOP_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * Admin side panel. Desktop: fixed column on the left. Mobile: off-canvas drawer opened from the
 * top bar, closed by the backdrop, Escape or following a link.
 */
export function AdminSidebar(props: {
  items: readonly NavItem[];
  user: SidebarUser;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const isDesktop = useSyncExternalStore(
    subscribeToViewport,
    () => window.matchMedia(DESKTOP_QUERY).matches,
    () => true,
  );
  const drawerId = useId();
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const drawerVisible = isDesktop || drawerOpen;

  useEffect(() => {
    if (isDesktop || !drawerOpen) return;
    // Move focus into the drawer and stop the page behind it from scrolling.
    panelRef.current?.querySelector<HTMLElement>("a, button")?.focus();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setDrawerOpen(false);
      menuButtonRef.current?.focus();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [drawerOpen, isDesktop]);

  return (
    <div className="admin-frame">
      <a className="admin-skip-link" href="#main">
        Skip to main content
      </a>

      <header className="admin-topbar">
        <button
          ref={menuButtonRef}
          type="button"
          className="admin-icon-button"
          aria-label="Open menu"
          aria-controls={drawerId}
          aria-expanded={drawerOpen}
          onClick={() => setDrawerOpen(true)}
        >
          <MenuIcon />
        </button>
        <span className="admin-topbar-title">{ORGANISATION}</span>
      </header>

      <button
        type="button"
        tabIndex={-1}
        aria-label="Close menu"
        className="admin-backdrop"
        data-open={drawerOpen}
        onClick={() => setDrawerOpen(false)}
      />

      <aside
        ref={panelRef}
        id={drawerId}
        className="admin-panel"
        data-open={drawerOpen}
        aria-label="Admin side panel"
        inert={!drawerVisible}
      >
        <div className="admin-brand">
          <Image src="/icon.png" alt="" width={40} height={40} className="admin-logo" />
          <span className="admin-brand-name">{ORGANISATION}</span>
        </div>

        <nav className="admin-nav" aria-labelledby={`${drawerId}-menu`}>
          <p id={`${drawerId}-menu`} className="admin-menu-label">
            Menu
          </p>
          <ul className="admin-nav-list">
            {props.items.map((item) => {
              const active = isActive(pathname, item.href);
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className="admin-nav-link"
                    aria-current={active ? "page" : undefined}
                    onClick={() => setDrawerOpen(false)}
                  >
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        <div className="admin-footer">
          <UserMenu user={props.user} onNavigate={() => setDrawerOpen(false)} />
        </div>
      </aside>

      <main id="main" className="admin-main">
        {props.children}
      </main>
    </div>
  );
}

function UserMenu(props: { user: SidebarUser; onNavigate: () => void }) {
  const [open, setOpen] = useState(false);
  const [signOutFailed, setSignOutFailed] = useState(false);
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
      event.stopPropagation(); // close the menu, not the whole drawer
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
      window.location.assign("/");
    } catch {
      setSignOutFailed(true);
    }
  }

  const close = () => {
    setOpen(false);
    props.onNavigate();
  };

  return (
    <div ref={rootRef} className="admin-user-menu">
      {open && (
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          aria-label="Account"
          className="admin-popup"
          onKeyDown={onMenuKeyDown}
        >
          <Link role="menuitem" href="/profile" className="admin-popup-item" onClick={close}>
            <UserIcon /> Profile
          </Link>
          <Link role="menuitem" href="/account" className="admin-popup-item" onClick={close}>
            <GearIcon /> Account
          </Link>
          <Link role="menuitem" href="/emails" className="admin-popup-item" onClick={close}>
            <MailIcon /> Emails
          </Link>
          <div role="separator" className="admin-popup-separator" />
          <button
            role="menuitem"
            type="button"
            className="admin-popup-item"
            onClick={() => void signOut()}
          >
            <LogOutIcon /> Log out
          </button>
        </div>
      )}
      {signOutFailed && (
        <p role="alert" className="admin-sign-out-error">
          Could not sign out. Please try again.
        </p>
      )}
      <button
        ref={buttonRef}
        type="button"
        className="admin-user-button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="admin-avatar" aria-hidden="true">
          {props.user.initials}
        </span>
        <span className="admin-user-text">
          <span className="admin-user-name">{props.user.name}</span>
          {props.user.email && <span className="admin-user-email">{props.user.email}</span>}
        </span>
      </button>
    </div>
  );
}

// Inline icons (no icon dependency). Decorative: the visible text is the label.
function Svg(props: { children: ReactNode }) {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {props.children}
    </svg>
  );
}

function MenuIcon() {
  return (
    <Svg>
      <path d="M4 6h16M4 12h16M4 18h16" />
    </Svg>
  );
}

function UserIcon() {
  return (
    <Svg>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21c0-4 3.6-7 8-7s8 3 8 7" />
    </Svg>
  );
}

function GearIcon() {
  return (
    <Svg>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" />
    </Svg>
  );
}

function MailIcon() {
  return (
    <Svg>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="m3 7 9 6 9-6" />
    </Svg>
  );
}

function LogOutIcon() {
  return (
    <Svg>
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <path d="m16 17 5-5-5-5M21 12H9" />
    </Svg>
  );
}
