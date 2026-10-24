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
 * Admin dropdown: use it like `<select>` (same props, `<option>` children). With more than 5
 * options it opens a list with a search box; the native `<select>` stays in the page (hidden), so
 * `name`, `value`/`defaultValue`, `onChange`, `required` and GET forms keep working.
 */
export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return needsSearch(optionsFrom(props.children)) ? (
    <SearchSelect {...props} />
  ) : (
    <select {...props} />
  );
}

function SearchSelect({
  id,
  className,
  disabled,
  "aria-label": ariaLabel,
  ...rest
}: SelectHTMLAttributes<HTMLSelectElement>) {
  const options = optionsFrom(rest.children);
  const native = useRef<HTMLSelectElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  // The list is fixed to the window, so a popup's scroll area does not cut it off.
  const [position, setPosition] = useState<CSSProperties>({});
  // Uncontrolled selects (defaultValue, GET forms): the shown option follows the native select.
  const [picked, setPicked] = useState(String(rest.defaultValue ?? options[0]?.value ?? ""));
  const current = rest.value === undefined ? picked : String(rest.value);
  const shown = filterOptions(options, query);

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

  const show = () => {
    setQuery("");
    setActive(
      Math.max(
        options.findIndex((o) => o.value === current),
        0,
      ),
    );
    place();
    setOpen(true);
  };

  const choose = (value: string) => {
    const select = native.current;
    setOpen(false);
    trigger.current?.focus();
    if (!select || select.value === value) return;
    // Set the value the way the browser does, so React's onChange and form submits see it.
    select.value = value;
    select.dispatchEvent(new Event("change", { bubbles: true }));
    setPicked(value);
  };

  const onSearchKey = (event: KeyboardEvent<HTMLInputElement>) => {
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
      setOpen(false);
      trigger.current?.focus();
    } else if (event.key === "Tab") {
      setOpen(false);
    }
  };

  return (
    <div className="admin-combo" ref={box}>
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
        onClick={() => (open ? setOpen(false) : show())}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
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
          <input
            className="admin-input admin-combo__search"
            type="search"
            placeholder="Search…"
            aria-label="Search the options"
            aria-controls={listId}
            aria-activedescendant={shown[active] ? `${listId}-${active}` : undefined}
            autoFocus
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setActive(0);
            }}
            onKeyDown={onSearchKey}
          />
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
                <span>{option.label}</span>
                {option.value === current ? <Icon name="check" size={14} /> : null}
              </li>
            ))}
            {shown.length === 0 ? <li className="admin-combo__empty">No matches</li> : null}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
