"use client";

import QRCode from "qrcode";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  MEETING_ROLE_LABELS,
  MEETING_STATUS_LABELS,
  type MeetingRole,
  type MeetingStatus,
} from "@website/domain/meetings";
import {
  cancelMeetingAction,
  markAttendanceAction,
  openCodeAction,
  saveRoomAction,
} from "@/app/(panel)/meetings/actions";
import { actionMessage } from "@/components/action-message";
import { formatInZone } from "@/components/format";
import { MeetingForm, MEETING_STATUS_TONE, type MeetingValues } from "@/components/meetings-page";
import { DraftMinutes } from "@/components/draft-minutes";
import { MinutesPanel, type ActionItemView, type MinutesView } from "@/components/minutes-panel";
import { ChoiceField, Field, FormModal, text } from "@/components/program-ui";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { DataTable, type Column } from "@/components/ui/data-table";
import { Modal } from "@/components/ui/modal";
import { ToastBanner, useToastMessage } from "@/components/ui/toast";

export interface MeetingView {
  id: string;
  version: number;
  periodId: string;
  title: string;
  description: string;
  unitName: string;
  startsAt: string;
  endsAt: string;
  timeZone: string;
  status: MeetingStatus;
  /** The start has passed (manual ticks allowed). */
  started: boolean;
  externalUrl: string | null;
  zoomRequestId: string | null;
  /** Approved Zoom bookings made for this meeting (F1), to use as the room. */
  zoomBookings: Array<{ id: string; label: string }>;
  cancelReason: string | null;
  agenda: string[];
  agendaItems: Array<{ id: string; title: string }>;
  minutes: MinutesView | null;
  actionItems: ActionItemView[];
  participants: Array<{
    uid: string;
    name: string;
    role: MeetingRole;
    presentAt: string | null;
    method: "code" | "manual" | null;
  }>;
}

/** The projector screen: a fresh code (and its QR) every 90 seconds while it is open. */
function CodeScreen({ meetingId, onClose }: { meetingId: string; onClose: () => void }) {
  const [code, setCode] = useState<{ code: string; qr: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    const renew = async () => {
      const result = await openCodeAction({ id: meetingId });
      if (!alive) return;
      if (!result.ok) return setError(actionMessage(result));
      const qr = await QRCode.toDataURL(result.data.url, { errorCorrectionLevel: "H", margin: 4 });
      if (alive) setCode({ code: result.data.code, qr });
    };
    void renew();
    const timer = setInterval(() => void renew(), 90_000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [meetingId]);
  return (
    <Modal open title="Attendance code" onClose={onClose}>
      {error ? <p role="alert">{error}</p> : null}
      {code ? (
        <div style={{ textAlign: "center" }}>
          <p style={{ fontSize: "3rem", letterSpacing: "0.3em", fontWeight: 700 }}>{code.code}</p>
          {/* eslint-disable-next-line @next/next/no-img-element -- a data: URL, nothing to optimise */}
          <img
            src={code.qr}
            alt={`QR code for attendance code ${code.code}`}
            width={280}
            height={280}
          />
          <p className="admin-page-header__desc">
            Participants scan the QR or type the code on the website (Attendance). It changes every
            90 seconds.
          </p>
        </div>
      ) : null}
    </Modal>
  );
}

/** One meeting (F4): details, room, attendance; minutes come below (F5). */
export function MeetingPage({
  meeting: m,
  runs,
  canApprove,
  canDraft,
  edit,
}: {
  meeting: MeetingView;
  canApprove: boolean;
  /** Machine drafts are set up (ANTHROPIC_API_KEY). */
  canDraft: boolean;
  /** The viewer runs it (chair, secretary or the unit's meetings.edit) and it is not cancelled. */
  runs: boolean;
  edit: { units: Array<{ id: string; name: string }>; values: MeetingValues } | null;
}) {
  const router = useRouter();
  const toast = useToastMessage();
  const [editing, setEditing] = useState(false);
  const [room, setRoom] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [screen, setScreen] = useState(false);

  const tick = async (uid: string, present: boolean) => {
    const result = await markAttendanceAction({ id: m.id, version: m.version, uid, present });
    if (!result.ok) return toast.show(actionMessage(result));
    router.refresh();
  };

  type P = MeetingView["participants"][number];
  const columns: Column<P>[] = [
    {
      key: "name",
      header: "Participant",
      render: (p) => <span className="admin-table__title">{p.name}</span>,
    },
    { key: "role", header: "Role", render: (p) => MEETING_ROLE_LABELS[p.role] },
    {
      key: "present",
      header: "Attendance",
      render: (p) =>
        p.presentAt
          ? `Present · ${formatInZone(p.presentAt, m.timeZone)}${p.method === "manual" ? " (ticked)" : ""}`
          : "—",
    },
    ...(runs && m.started
      ? [
          {
            key: "tick",
            header: "",
            align: "right" as const,
            render: (p: P) => (
              <Button size="sm" variant="outline" onClick={() => void tick(p.uid, !p.presentAt)}>
                {p.presentAt ? "Remove" : "Mark present"}
              </Button>
            ),
          },
        ]
      : []),
  ];

  return (
    <div>
      <ToastBanner message={toast.message} />
      <div className="admin-page-header">
        <div>
          <h1 className="admin-page-header__title">
            <a href="/meetings">Meetings</a> &gt; {m.title}
          </h1>
          <p className="admin-page-header__desc">
            {m.unitName} · {formatInZone(m.startsAt, m.timeZone)} –{" "}
            {formatInZone(m.endsAt, m.timeZone)} ({m.timeZone}){" "}
            <Badge tone={MEETING_STATUS_TONE[m.status]}>{MEETING_STATUS_LABELS[m.status]}</Badge>
          </p>
        </div>
        <div className="admin-page-header__actions">
          {runs ? (
            <Button size="sm" icon="qr" onClick={() => setScreen(true)}>
              Show attendance code
            </Button>
          ) : null}
          {runs && m.status === "scheduled" ? (
            <Button size="sm" variant="outline" icon="link" onClick={() => setRoom(true)}>
              Room
            </Button>
          ) : null}
          {edit ? (
            <Button size="sm" variant="outline" icon="edit" onClick={() => setEditing(true)}>
              Edit
            </Button>
          ) : null}
          {runs && m.status === "scheduled" ? (
            <Button size="sm" variant="danger" onClick={() => setCancelling(true)}>
              Cancel meeting
            </Button>
          ) : null}
        </div>
      </div>
      <Card>
        <CardHeader title="Details" />
        <CardBody>
          {m.cancelReason ? <p>Cancelled: {m.cancelReason}</p> : null}
          <p>
            Room:{" "}
            {m.externalUrl ? (
              <a href={m.externalUrl} target="_blank" rel="noreferrer">
                {m.externalUrl}
              </a>
            ) : m.zoomRequestId ? (
              "Zoom booking"
            ) : (
              "not set"
            )}
          </p>
          {m.description ? <p style={{ whiteSpace: "pre-wrap" }}>{m.description}</p> : null}
          {m.agenda.length > 0 ? (
            <ol>
              {m.agenda.map((a) => (
                <li key={a}>{a}</li>
              ))}
            </ol>
          ) : null}
        </CardBody>
      </Card>
      <Card>
        <CardHeader
          title="Attendance"
          subtitle={`${m.participants.filter((p) => p.presentAt).length} of ${m.participants.length} present`}
        />
        <CardBody flush>
          <DataTable columns={columns} rows={m.participants} rowKey={(p) => p.uid} />
        </CardBody>
      </Card>
      <MinutesPanel
        meetingId={m.id}
        version={m.version}
        agenda={m.agendaItems}
        minutes={m.minutes}
        items={m.actionItems}
        participants={m.participants.map((p) => ({ uid: p.uid, name: p.name }))}
        runs={runs}
        canApprove={canApprove}
        extra={
          runs && canDraft && !m.minutes?.approvedAt ? (
            <DraftMinutes
              meetingId={m.id}
              version={m.version}
              names={new Map(m.participants.map((p) => [p.uid, p.name]))}
            />
          ) : null
        }
      />
      {screen ? <CodeScreen meetingId={m.id} onClose={() => setScreen(false)} /> : null}
      {edit ? (
        <MeetingForm
          open={editing}
          onClose={() => setEditing(false)}
          periodId={m.periodId}
          units={edit.units}
          current={edit.values}
        />
      ) : null}
      <FormModal
        open={room}
        title="Meeting room"
        onClose={() => setRoom(false)}
        onSubmit={(form) => {
          const url = text(form, "url");
          const zoom = text(form, "zoom");
          return saveRoomAction({
            id: m.id,
            version: m.version,
            room: zoom
              ? { kind: "zoom", zoomRequestId: zoom }
              : url
                ? { kind: "link", url }
                : { kind: "none" },
          });
        }}
      >
        <Field
          label="External link"
          name="url"
          type="url"
          hint="Google Meet, Teams or a map link; empty removes it. Saving a link clears a Zoom booking."
          defaultValue={m.externalUrl ?? ""}
        />
        <ChoiceField
          label="Or a Zoom booking"
          name="zoom"
          defaultValue={m.zoomRequestId ?? ""}
          options={[
            { value: "", label: "No Zoom (use the link above)" },
            ...m.zoomBookings.map((b) => ({ value: b.id, label: b.label })),
          ]}
        />
      </FormModal>
      <FormModal
        open={cancelling}
        title="Cancel meeting"
        submitLabel="Cancel meeting"
        onClose={() => setCancelling(false)}
        onSubmit={(form) =>
          cancelMeetingAction({ id: m.id, version: m.version, reason: text(form, "reason") })
        }
      >
        <Field label="Reason" name="reason" rows={2} required maxLength={500} />
      </FormModal>
    </div>
  );
}
