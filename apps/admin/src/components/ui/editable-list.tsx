"use client";

import { useState } from "react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";

export function EditableList({
  title,
  subtitle,
  count,
  emptyHint,
  addLabel,
  onAdd,
  onRemove,
  onReorder,
  renderRow,
}: {
  title: string;
  subtitle?: string;
  count: number;
  emptyHint: string;
  addLabel: string;
  onAdd: () => void;
  onRemove: (index: number) => void;
  onReorder: (from: number, to: number) => void;
  renderRow: (index: number) => ReactNode;
}) {
  const [dragFrom, setDragFrom] = useState<number | null>(null);

  return (
    <div className="admin-form-separator">
      <div className="admin-form-separator__head">
        <div className="admin-form-separator__titleblock">
          <span className="admin-field__label">{title}</span>
          {subtitle ? <p className="admin-form-separator__sub">{subtitle}</p> : null}
        </div>
        <Button variant="outline" size="sm" icon="plus" onClick={onAdd}>
          {addLabel}
        </Button>
      </div>
      {count === 0 ? (
        <span className="admin-card__subtitle">{emptyHint}</span>
      ) : (
        <div className="admin-form-separator__list">
          {Array.from({ length: count }, (_, i) => (
            <div
              key={i}
              className={`admin-list-panel${dragFrom === i ? " admin-list-panel--dragging" : ""}`}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                if (dragFrom !== null && dragFrom !== i) onReorder(dragFrom, i);
                setDragFrom(null);
              }}
            >
              <div className="admin-list-panel__body">
                <span
                  className="admin-list-panel__handle"
                  draggable
                  aria-label={`Drag ${title.toLowerCase()} to reorder`}
                  title="Drag to reorder"
                  onDragStart={(e) => {
                    setDragFrom(i);
                    e.dataTransfer.effectAllowed = "move";
                    e.dataTransfer.setData("text/plain", String(i));
                  }}
                  onDragEnd={() => setDragFrom(null)}
                >
                  <Icon name="grip" size={48} />
                </span>
                {renderRow(i)}
                <Button
                  variant="danger"
                  size="sm"
                  icon="trash"
                  aria-label={`Remove ${title.toLowerCase()}`}
                  onClick={() => onRemove(i)}
                >
                  Delete
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
