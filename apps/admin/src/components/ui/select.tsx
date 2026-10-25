"use client";

import {
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type SelectHTMLAttributes,
} from "react";
import { filterOptions, needsSearch, optionsFrom } from "@/components/fields-model";
import { Icon } from "./icon";

/**
 * Open state and position of a dropdown panel. The panel is fixed to the window under its button
 * (or above it when there is more room there), so a popup's scroll area does not cut it off; it
 * follows scrolling and resizing, and a click outside `box` closes it. Give the panel `position`
 * as its style (with `.admin-combo__panel`).
 */
export function useDropdown<T extends HTMLElement>() {
  const trigger = useRef<T>(null);
  const box = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<CSSProperties>({});

  /** Under the button, or above it when there is more room there. */
  const place = () => {
    const rect = trigger.current?.getBoundingClientRect();
    if (!rect) return;
    const below = window.innerHeight - rect.bottom;
    const above = below < 280 && rect.top > below;
    setPosition({
      left: rect.left,
      width: rect.width,
      ...(above ? { bottom: window.innerHeight - rect.top + 4 } : { top: rect.bottom + 4 }),
    });
  };

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (!box.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      document.removeEventListener("mousedown", close);
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [open]);

  return {
    trigger,
    box,
    open,
    position,
    show: () => {
      place();
      setOpen(true);
    },
    hide: () => setOpen(false),
  };
}

/**
 * Admin dropdown: use it like `<select>` (same props, `<option>` children). It opens the same
 * cream menu as the Newsletter status filter (`.admin-row-menu__panel`), with a search box when
 * there are more than 5 options. The native `<select>` stays in the page (hidden), so `name`,
 * `value`/`defaultValue`, `onChange`, `required` and GET forms keep working.
 */
export function Select({
  id,
  className,
  disabled,
  "aria-label": ariaLabel,
  ...rest
}: SelectHTMLAttributes<HTMLSelectElement>) {
  const options = optionsFrom(rest.children);
  const native = useRef<HTMLSelectElement>(null);
  const { trigger, box, open, position, show: showPanel, hide } = useDropdown<HTMLButtonElement>();
  const listId = useId();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  // Uncontrolled selects (defaultValue, GET forms): the shown option follows the native select.
  const [picked, setPicked] = useState(String(rest.defaultValue ?? options[0]?.value ?? ""));
  const current = rest.value === undefined ? picked : String(rest.value);
  const searchable = needsSearch(options);
  const shown = filterOptions(options, query);
  const activeId = open && shown[active] ? `${listId}-${active}` : undefined;

  const show = () => {
    setQuery("");
    setActive(
      Math.max(
        options.findIndex((o) => o.value === current),
        0,
      ),
    );
    showPanel();
  };

  const choose = (value: string) => {
    const select = native.current;
    hide();
    trigger.current?.focus();
    if (!select || select.value === value) return;
    // Set the value the way the browser does, so React's onChange and form submits see it.
    select.value = value;
    select.dispatchEvent(new Event("change", { bubbles: true }));
    setPicked(value);
  };

  // Keys while the menu is open (focus on the search box, or on the button without one).
  const onOpenKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActive((i) => Math.min(Math.max(i + step, 0), shown.length - 1));
    } else if (event.key === "Enter") {
      event.preventDefault();
      const option = shown[active];
      if (option && !option.disabled) choose(option.value);
    } else if (event.key === "Escape") {
      event.preventDefault();
      hide();
      trigger.current?.focus();
    } else if (event.key === "Tab") {
      hide();
    }
  };

  return (
    <div className="admin-combo" ref={box} onKeyDown={open ? onOpenKey : undefined}>
      <select
        {...rest}
        ref={native}
        className="admin-combo__native"
        disabled={disabled}
        tabIndex={-1}
        aria-hidden="true"
      />
      <button
        id={id}
        ref={trigger}
        type="button"
        className={["admin-combo__trigger", className].filter(Boolean).join(" ")}
        disabled={disabled}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={searchable ? undefined : activeId}
        onClick={() => (open ? hide() : show())}
        onKeyDown={(event) => {
          if (!open && event.key === "ArrowDown") {
            event.preventDefault();
            show();
          }
        }}
      >
        <span className="admin-combo__value">
          {options.find((o) => o.value === current)?.label ?? ""}
        </span>
        <Icon name="chevronDown" size={14} />
      </button>
      {open ? (
        <div className="admin-row-menu__panel admin-combo__panel" style={position}>
          {searchable ? (
            <input
              className="admin-input admin-combo__search"
              type="search"
              placeholder="Search…"
              aria-label="Search the options"
              aria-controls={listId}
              aria-activedescendant={activeId}
              autoFocus
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setActive(0);
              }}
            />
          ) : null}
          <ul id={listId} role="listbox" className="admin-combo__list" aria-label={ariaLabel}>
            {shown.map((option, i) => (
              <li
                key={option.value}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={option.value === current}
                aria-disabled={option.disabled || undefined}
                className={[
                  "admin-row-menu__item",
                  i === active ? "admin-combo__option--active" : "",
                  option.value === current ? "admin-combo__option--selected" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                onMouseEnter={() => setActive(i)}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => !option.disabled && choose(option.value)}
              >
                {option.label}
              </li>
            ))}
            {shown.length === 0 ? <li className="admin-combo__empty">No matches</li> : null}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
