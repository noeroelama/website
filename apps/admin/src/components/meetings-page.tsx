"use client";

import { useState } from "react";
import {
  MEETING_ROLES,
  MEETING_STATUS_LABELS,
  type MeetingRole,
  type MeetingStatus,
} from "@website/domain/meetings";
import { saveMeetingAction } from "@/app/(panel)/meetings/actions";
import { formatInZone } from "@/components/format";
import { ChoiceField, Field, FormModal, num, PeriodSwitch, text } from "@/components/program-ui";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { DataTable, type Column } from "@/components/ui/data-table";

export const MEETING_STATUS_TONE: Record<MeetingStatus, BadgeTone> = {
  scheduled: "primary",
  finished: "success",
  cancelled: "neutral",
};

interface Row {
  id: string;
  title: string;
  unitName: string;
  startsAt: string;
  timeZone: string;
  status: MeetingStatus;
  participants: number;
  present: number;
  mine: boolean;
}

/** The current meeting, when editing. */
export interface MeetingValues {
  id: string;
  version: number;
  title: string;
  description: string;
  orgUnitId: string | null;
  startsAtLocal: string;
  timeZone: string;
  durationMinutes: number;
  agenda: string[];
  participants: Array<{ email: string; role: MeetingRole }>;
}

/**
 * Participants typed one per line: `email` (participant) or `email chair` / `email secretary`.
 * An unknown role word is sent as is and refused by the server with a message.
 */
export function parseParticipants(value: string): Array<{ email: string; role: MeetingRole }> {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [email = "", role = "member"] = line.split(/[\s,;]+/);
      return { email, role: role.toLowerCase() as MeetingRole };
    });
}

export const participantsText = (people: MeetingValues["participants"]) =>
  people.map((p) => (p.role === "member" ? p.email : `${p.email} ${p.role}`)).join("\n");

/** Schedule / edit a meeting (one form for both). */
export function MeetingForm({
  open,
  onClose,
  periodId,
  units,
  current,
}: {
  open: boolean;
  onClose: () => void;
  periodId: string;
  units: Array<{ id: string; name: string }>;
  current: MeetingValues | null;
}) {
  const zone = current?.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  return (
    <FormModal
      open={open}
      title={current ? "Edit meeting" : "Schedule meeting"}
      onClose={onClose}
      onSubmit={(form) =>
        saveMeetingAction({
          ...(current ? { id: current.id } : {}),
          version: current?.version ?? null,
          periodId,
          title: text(form, "title"),
          description: text(form, "description"),
          orgUnitId: text(form, "orgUnitId") || null,
          startsAtLocal: text(form, "startsAtLocal"),
          timeZone: text(form, "timeZone"),
          durationMinutes: num(form, "durationMinutes"),
          agenda: text(form, "agenda")
            .split("\n")
            .map((a) => a.trim())
            .filter(Boolean),
          participants: parseParticipants(text(form, "participants")),
        })
      }
    >
      <Field
        label="Title"
        name="title"
        required
        maxLength={200}
        defaultValue={current?.title ?? ""}
      />
      <ChoiceField
        label="Unit"
        name="orgUnitId"
        defaultValue={current?.orgUnitId ?? units[0]?.id ?? ""}
        options={units.map((u) => ({ value: u.id, label: u.name }))}
      />
      <Field
        label="Start"
        name="startsAtLocal"
        type="datetime-local"
        required
        defaultValue={current?.startsAtLocal ?? ""}
      />
      <Field
        label="Time zone"
        name="timeZone"
        required
        hint="IANA zone of the start time, e.g. Asia/Tokyo"
        defaultValue={zone}
      />
      <Field
        label="Duration (minutes)"
        name="durationMinutes"
        type="number"
        min={5}
        max={720}
        required
        defaultValue={current?.durationMinutes ?? 60}
      />
      <Field
        label="Agenda"
        name="agenda"
        rows={4}
        hint="One item per line; minutes are written per item"
        defaultValue={(current?.agenda ?? []).join("\n")}
      />
      <Field
        label="Participants (account e-mails)"
        name="participants"
        rows={5}
        required
        hint={`One per line; add "chair" or "secretary" after the e-mail (${MEETING_ROLES.join(", ")})`}
        defaultValue={participantsText(current?.participants ?? [])}
      />
      <Field
        label="Description"
        name="description"
        rows={3}
        maxLength={2000}
        defaultValue={current?.description ?? ""}
      />
    </FormModal>
  );
}

/** Meetings (F4): the period's meetings the viewer takes part in or may read. */
export function MeetingsPage({
  period,
  periods,
  rows,
  units,
}: {
  period: { id: string; name: string } | null;
  periods: Array<{ id: string; name: string }>;
  rows: Row[];
  /** Where the viewer may schedule ([] = cannot). */
  units: Array<{ id: string; name: string }>;
}) {
  const [adding, setAdding] = useState(false);
  if (!period) {
    return (
      <div className="admin-page-header">
        <h1 className="admin-page-header__title">Meetings</h1>
        <p className="admin-page-header__desc">Create a board period first (Organizations).</p>
      </div>
    );
  }
  const columns: Column<Row>[] = [
    {
      key: "title",
      header: "Meeting",
      width: "40%",
      render: (r) => (
        <div>
          <a className="admin-table__title" href={`/meetings/${r.id}`}>
            {r.title}
          </a>
          <div className="admin-table__sub">
            {r.unitName}
            {r.mine ? " · You take part" : ""}
          </div>
        </div>
      ),
    },
    { key: "when", header: "When", render: (r) => formatInZone(r.startsAt, r.timeZone) },
    {
      key: "status",
      header: "Status",
      render: (r) => (
        <Badge tone={MEETING_STATUS_TONE[r.status]}>{MEETING_STATUS_LABELS[r.status]}</Badge>
      ),
    },
    { key: "present", header: "Present", render: (r) => `${r.present} / ${r.participants}` },
  ];
  return (
    <div>
      <div className="admin-page-header admin-events-header">
        <div>
          <h1 className="admin-page-header__title">Meetings</h1>
          <p className="admin-page-header__desc">Meetings of period {period.name}</p>
        </div>
        <div className="admin-page-header__actions">
          <PeriodSwitch path="/meetings" current={period.id} periods={periods} />
          <div className="admin-fab">
            {units.length > 0 ? (
              <Button variant="outline" size="sm" icon="plus" onClick={() => setAdding(true)}>
                Schedule meeting
              </Button>
            ) : null}
          </div>
        </div>
      </div>
      <Card className="admin-events-card admin-list-card">
        <CardBody flush>
          <DataTable
            columns={columns}
            rows={rows}
            rowKey={(r) => r.id}
            emptyText="No meetings in this period yet."
          />
        </CardBody>
      </Card>
      {units.length > 0 ? (
        <MeetingForm
          open={adding}
          onClose={() => setAdding(false)}
          periodId={period.id}
          units={units}
          current={null}
        />
      ) : null}
    </div>
  );
}
