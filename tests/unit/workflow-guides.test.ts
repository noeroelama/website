import { describe, expect, it } from "vitest";
import { WORKFLOWS } from "../../apps/admin/src/components/workflow-guides";

describe("workflow guides (G5)", () => {
  it.each(Object.entries(WORKFLOWS))("%s: every status sits at exactly one stage", (_, flow) => {
    const staged = flow.stages.flatMap((s) => [...s.statuses]);
    expect([...staged].sort()).toEqual([...flow.statuses].sort());
  });
});
