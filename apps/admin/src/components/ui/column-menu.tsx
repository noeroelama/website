"use client";

import { useEffect, useId, useRef, type CSSProperties } from "react";
import type { SortDir } from "../list-model";
import { Icon } from "./icon";
import { useDropdown } from "./select";

export interface ColumnMenuProps {
  label: string;
  active: boolean;
  dir: SortDir;
  onSort: (dir: SortDir) => void;
  filter?: {
    values: readonly string[];
    hidden: ReadonlySet<string>;
    onChange: (hidden: Set<string>) => void;
  };
}

export function ColumnMenu({ label, active, dir, onSort, filter }: ColumnMenuProps) {
  const { trigger, box, open, position, show, hide } = useDropdown<HTMLButtonElement>();
  const listId = useId();
  const all = useRef<HTMLInputElement>(null);
  const hidden = filter?.hidden ?? new Set<string>();
  const filtered = hidden.size > 0;
  const values = filter?.values ?? [];

  useEffect(() => {
    if (all.current) all.current.indeterminate = filtered && hidden.size < values.length;
  });

  const toggle = (value: string) => {
    const next = new Set(hidden);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    filter?.onChange(next);
  };

  return (
    <div
      className="admin-colmenu"
      ref={box}
      onKeyDown={(event) => {
        if (event.key !== "Escape" || !open) return;
        event.stopPropagation();
        hide();
        trigger.current?.focus();
      }}
    >
      <button
        ref={trigger}
        type="button"
        className={`admin-th-sort${active || filtered ? " admin-th-sort--active" : ""}`}
        aria-label={`${label}: sort and filter${filtered ? " (filtered)" : ""}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        onClick={() => (open ? hide() : show())}
      >
        <span>{label}</span>
        {active ? <Icon name={dir === "asc" ? "arrowUp" : "arrowDown"} size={12} /> : null}
        <Icon name="filter" size={12} />
      </button>
      {open ? (
        <div
          id={listId}
          role="dialog"
          aria-label={`${label}: sort and filter`}
          className="admin-row-menu__panel admin-combo__panel admin-colmenu__panel"
          style={{ ...position, width: undefined }}
        >
          <button
            type="button"
            className="admin-row-menu__item"
            aria-pressed={active && dir === "asc"}
            style={{ "--i": 0 } as CSSProperties}
            onClick={() => onSort("asc")}
          >
            <Icon name="arrowUp" size={14} /> Sort A to Z
          </button>
          <button
            type="button"
            className="admin-row-menu__item"
            aria-pressed={active && dir === "desc"}
            style={{ "--i": 1 } as CSSProperties}
            onClick={() => onSort("desc")}
          >
            <Icon name="arrowDown" size={14} /> Sort Z to A
          </button>
          {filter ? (
            <fieldset className="admin-colmenu__list" aria-label="Show rows with">
              <label className="admin-row-menu__item" style={{ "--i": 2 } as CSSProperties}>
                <input
                  ref={all}
                  type="checkbox"
                  checked={!filtered}
                  onChange={() => filter.onChange(filtered ? new Set() : new Set(values))}
                />
                Select all
              </label>
              {values.map((value, i) => (
                <label
                  key={value}
                  className="admin-row-menu__item"
                  style={{ "--i": i + 3 } as CSSProperties}
                >
                  <input
                    type="checkbox"
                    checked={!hidden.has(value)}
                    onChange={() => toggle(value)}
                  />
                  {value === "" ? "(Blank)" : value}
                </label>
              ))}
            </fieldset>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
