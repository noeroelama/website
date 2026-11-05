# Workflow guide (G5)

## What it does

A collapsible panel at the top of a module page showing the module's status chain. On a list page
no stage is highlighted; on an item page (a programme, an LPJ) the item's current stage is.
Side exits (returned, rejected, cancelled) show only while the item is there.

## Where it lives

- Component: `packages/ui/src/workflow-guide.tsx` (`WorkflowGuide`, client); styles `.ui-workflow*`
  in `packages/ui/src/styles.css`
- Flows: `apps/admin/src/components/workflow-guides.ts` (`WORKFLOWS`): programmes, LPJ,
  recruitment, outgoing letters, incoming letters, finance, events. Each stage lists the module's
  own status values.
- Tests: `tests/unit/workflow-guides.test.ts` fails when a status of a module has no stage (or two)

## How to use it

```tsx
<WorkflowGuide id="lpj" flow={WORKFLOWS.lpj} current={lpj.status} />
```

## Rules and assumptions

- Presentational only: it never decides what anyone may do.
- Open/closed is remembered per guide in `localStorage` (`workflow-guide:<id>`) inside try/catch;
  blocked storage just means it starts open.
- A new status in a domain module must be added to its flow (the test enforces it).
