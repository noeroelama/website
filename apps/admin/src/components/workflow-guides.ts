import { INCOMING_STATUSES, LETTER_STATUSES } from "@website/domain/documents";
import { FINANCE_STATUSES } from "@website/domain/finance";
import { LPJ_STATUSES, PROGRAM_STATUSES } from "@website/domain/programs";
import { APPLICATION_STATUSES } from "@website/domain/recruitment";
import type { EventStatus } from "./events-model";

interface Flow<S extends string> {
  readonly title: string;
  /** Every status of the module (tests/unit/workflow-guides.test.ts: each has a stage). */
  readonly statuses: readonly S[];
  readonly stages: ReadonlyArray<{ label: string; statuses: readonly S[]; branch?: boolean }>;
}
const flow = <S extends string>(f: Flow<S>) => f;

const EVENT_STATUSES: readonly EventStatus[] = ["draft", "published"];

/** The in-page workflow guides (G5): stage keys are the modules' own status values. */
export const WORKFLOWS = {
  programs: flow({
    title: "Programme chain",
    statuses: PROGRAM_STATUSES,
    stages: [
      { label: "Proposed", statuses: ["proposed"] },
      { label: "Approved", statuses: ["approved"] },
      { label: "Running (weekly check-ins)", statuses: ["running"] },
      { label: "Finished → write the LPJ", statuses: ["finished"] },
      { label: "Cancelled", statuses: ["cancelled"], branch: true },
    ],
  }),
  lpj: flow({
    title: "LPJ",
    statuses: LPJ_STATUSES,
    stages: [
      { label: "Draft by the PICs", statuses: ["draft"] },
      { label: "Returned with a note", statuses: ["returned"], branch: true },
      { label: "Secretariat + treasurer check, then approval", statuses: ["submitted"] },
      { label: "Approved", statuses: ["approved"] },
    ],
  }),
  recruitment: flow({
    title: "Recruitment",
    statuses: APPLICATION_STATUSES,
    stages: [
      { label: "Draft", statuses: ["draft"] },
      { label: "Submitted", statuses: ["submitted"] },
      { label: "Revision asked", statuses: ["revision"], branch: true },
      { label: "Interview", statuses: ["interview"] },
      { label: "Offered", statuses: ["offered"] },
      { label: "Accepted", statuses: ["accepted"] },
      { label: "Approved", statuses: ["approved"] },
      { label: "Pakta integritas check", statuses: ["pakta_review"] },
      { label: "Confirmed", statuses: ["confirmed"] },
      {
        label: "Ended (rejected, declined or withdrawn)",
        statuses: ["admin_rejected", "rejected", "declined", "withdrawn"],
        branch: true,
      },
    ],
  }),
  letters: flow({
    title: "Outgoing letters",
    statuses: LETTER_STATUSES,
    stages: [
      { label: "Draft", statuses: ["draft"] },
      { label: "Secretariat review", statuses: ["review"] },
      { label: "Signing desks", statuses: ["corrected"] },
      { label: "Approved", statuses: ["approved"] },
      { label: "Waiting for the final PDF", statuses: ["awaiting_file"], branch: true },
      { label: "Issued (numbered)", statuses: ["issued"] },
      { label: "Cancelled", statuses: ["cancelled"], branch: true },
    ],
  }),
  incoming: flow({
    title: "Incoming letters",
    statuses: INCOMING_STATUSES,
    stages: [
      { label: "Registered", statuses: ["new"] },
      { label: "Disposed to people or units", statuses: ["disposed"] },
      { label: "Done", statuses: ["done"] },
      { label: "Archived", statuses: ["archived"] },
    ],
  }),
  finance: flow({
    title: "Finance requests",
    statuses: FINANCE_STATUSES,
    stages: [
      { label: "Draft", statuses: ["draft"] },
      { label: "Returned for revision", statuses: ["revision"], branch: true },
      { label: "Treasurer review", statuses: ["submitted"] },
      { label: "Coordinator authorisation", statuses: ["reviewed"] },
      { label: "Transfer with proof", statuses: ["authorized"] },
      { label: "Paid", statuses: ["paid"] },
      { label: "Done", statuses: ["done"] },
      { label: "Rejected", statuses: ["rejected"], branch: true },
    ],
  }),
  events: flow({
    title: "Events",
    statuses: EVENT_STATUSES,
    stages: [
      { label: "Draft", statuses: ["draft"] },
      { label: "Published (registration open)", statuses: ["published"] },
    ],
  }),
};
