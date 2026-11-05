"use client";

import { useEffect, useRef } from "react";

export interface WorkflowStage {
  readonly label: string;
  /** Statuses that sit at this stage. */
  readonly statuses: readonly string[];
  /** A side exit (returned, rejected, cancelled): shown only while the item is there. */
  readonly branch?: boolean;
}

const storageKey = (id: string) => `workflow-guide:${id}`;

/**
 * In-page workflow guide (G5): the status chain of a module, the current stage highlighted.
 * Collapsible; the open/closed choice is remembered per guide in this browser (best effort:
 * storage can be blocked, the guide then simply starts open).
 */
export function WorkflowGuide(props: {
  id: string;
  flow: { readonly title: string; readonly stages: readonly WorkflowStage[] };
  /** The item's status, or null on a list page (no stage highlighted). */
  current?: string | null;
}) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    try {
      if (ref.current && localStorage.getItem(storageKey(props.id)) === "closed") {
        ref.current.open = false;
      }
    } catch {
      // Storage blocked: keep the default.
    }
  }, [props.id]);
  const current = props.current ?? null;
  const shown = props.flow.stages.filter(
    (s) => !s.branch || (current !== null && s.statuses.includes(current)),
  );
  return (
    <details
      ref={ref}
      className="ui-workflow"
      open
      onToggle={(event) => {
        try {
          localStorage.setItem(storageKey(props.id), event.currentTarget.open ? "open" : "closed");
        } catch {
          // Storage blocked: the choice is not remembered.
        }
      }}
    >
      <summary>{props.flow.title}</summary>
      <ol className="ui-workflow-steps">
        {shown.map((stage) => {
          const here = current !== null && stage.statuses.includes(current);
          return (
            <li
              key={stage.label}
              aria-current={here ? "step" : undefined}
              data-branch={stage.branch ? "" : undefined}
            >
              {stage.label}
            </li>
          );
        })}
      </ol>
    </details>
  );
}
