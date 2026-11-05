"use client";

import QRCode from "qrcode";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  JOIN_BEFORE_HOST_MINUTES,
  ZOOM_STATUS_LABELS,
  type ZoomStatus,
} from "@website/domain/zoom";
import {
  approveZoomAction,
  cancelZoomAction,
  rejectZoomAction,
  requestZoomAction,
  saveZoomSettingsAction,
} from "@/app/(panel)/zoom/actions";
import { actionMessage, type ActionFailure } from "@/components/action-message";
import { formatInZone } from "@/components/format";
import { ChoiceField, Field, FormModal, num, text } from "@/components/program-ui";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { DataTable, type Column } from "@/components/ui/data-table";
import { Modal } from "@/components/ui/modal";
import { ToastBanner, useToastMessage } from "@/components/ui/toast";

const TONE: Record<ZoomStatus, BadgeTone> = {
  pending: "warn",
  approved: "success",
  rejected: "danger",
  cancelled: "neutral",
};

interface Row {
  id: string;
  version: number;
  topic: string;
  startsAt: string;
  endsAt: string;
  timeZone: string;
  status: ZoomStatus;
  requester: string;
  joinUrl: string | null;
  roomError: string | null;
  /** Archive state of the recording (F3), null = nothing recorded. */
  recording: string | null;
  decisionNote: string | null;
  invitation: string | null;
  canDecide: boolean;
  canCancel: boolean;
}

interface SettingsView {
  version: number | null;
  licences: number;
  concurrentPerLicence: number;
  approvalRequired: boolean;
  minNoticeHours: number;
  maxDurationMinutes: number;
  autoDeleteRecordings: boolean;
  hostKeySet: boolean;
}

/** Invitation text and its QR (the join link), ready to copy. Never the Host Key. */
function Invitation({ row, onClose }: { row: Row; onClose: () => void }) {
  const [qr, setQr] = useState<string | null>(null);
  useEffect(() => {
    if (row.joinUrl) {
      void QRCode.toDataURL(row.joinUrl, { errorCorrectionLevel: "H", margin: 4 }).then(setQr);
    }
  }, [row.joinUrl]);
  return (
    <Modal open title="Invitation" onClose={onClose}>
      <pre style={{ whiteSpace: "pre-wrap" }}>{row.invitation}</pre>
      <Button
        size="sm"
        icon="copy"
        onClick={() => void navigator.clipboard?.writeText(row.invitation ?? "")}
      >
        Copy text
      </Button>
      {qr ? (
        // eslint-disable-next-line @next/next/no-img-element -- a data: URL, nothing to optimise
        <img src={qr} alt="QR code of the join link" width={220} height={220} />
      ) : null}
    </Modal>
  );
}

/** Zoom bookings (F1): request, approve or reject, cancel, invitation, settings. */
export function ZoomPage({
  rows,
  canRequest,
  settings,
  rules,
}: {
  rows: Row[];
  canRequest: boolean;
  /** null = the viewer may not change the settings. */
  settings: SettingsView | null;
  rules: { approvalRequired: boolean; minNoticeHours: number; maxDurationMinutes: number };
}) {
  const router = useRouter();
  const toast = useToastMessage();
  const [requesting, setRequesting] = useState(false);
  const [editingSettings, setEditingSettings] = useState(false);
  const [deciding, setDeciding] = useState<{ row: Row; approve: boolean } | null>(null);
  const [invite, setInvite] = useState<Row | null>(null);

  const run = async (action: Promise<{ ok: true } | ActionFailure>, done: string) => {
    const result = await action;
    toast.show(result.ok ? done : actionMessage(result));
    if (result.ok) router.refresh();
  };

  const columns: Column<Row>[] = [
    {
      key: "topic",
      header: "Booking",
      width: "35%",
      render: (r) => (
        <div>
          <span className="admin-table__title">{r.topic}</span>
          <div className="admin-table__sub">
            {r.requester}
            {r.roomError ? " · Room not created yet (retried automatically)" : ""}
            {r.decisionNote ? ` · ${r.decisionNote}` : ""}
            {r.recording ? ` · ${r.recording}` : ""}
          </div>
        </div>
      ),
    },
    {
      key: "when",
      header: "When",
      render: (r) => `${formatInZone(r.startsAt, r.timeZone)} (${r.timeZone})`,
    },
    {
      key: "status",
      header: "Status",
      render: (r) => <Badge tone={TONE[r.status]}>{ZOOM_STATUS_LABELS[r.status]}</Badge>,
    },
    {
      key: "actions",
      header: "",
      align: "right",
      render: (r) => (
        <div className="admin-table__actions">
          {r.invitation ? (
            <Button size="sm" variant="outline" icon="qr" onClick={() => setInvite(r)}>
              Invitation
            </Button>
          ) : null}
          {r.canDecide ? (
            <>
              <Button
                size="sm"
                variant="success"
                onClick={() => setDeciding({ row: r, approve: true })}
              >
                Approve
              </Button>
              <Button
                size="sm"
                variant="danger"
                onClick={() => setDeciding({ row: r, approve: false })}
              >
                Reject
              </Button>
            </>
          ) : null}
          {r.canCancel ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={() =>
                void run(cancelZoomAction({ id: r.id, version: r.version }), "Booking cancelled")
              }
            >
              Cancel
            </Button>
          ) : null}
        </div>
      ),
    },
  ];

  return (
    <div>
      <ToastBanner message={toast.message} />
      <div className="admin-page-header">
        <div>
          <h1 className="admin-page-header__title">Zoom</h1>
          <p className="admin-page-header__desc">
            Book a Zoom room at least {rules.minNoticeHours} hours ahead, up to{" "}
            {rules.maxDurationMinutes} minutes
            {rules.approvalRequired ? "; bookings wait for approval" : ""}.
          </p>
        </div>
        <div className="admin-page-header__actions">
          {settings ? (
            <Button
              size="sm"
              variant="outline"
              icon="settings"
              onClick={() => setEditingSettings(true)}
            >
              Settings
            </Button>
          ) : null}
          {canRequest ? (
            <Button size="sm" variant="outline" icon="plus" onClick={() => setRequesting(true)}>
              Book Zoom
            </Button>
          ) : null}
        </div>
      </div>
      <Card className="admin-list-card">
        <CardBody flush>
          <DataTable columns={columns} rows={rows} rowKey={(r) => r.id} emptyText="No bookings." />
        </CardBody>
      </Card>
      <FormModal
        open={requesting}
        title="Book Zoom"
        onClose={() => setRequesting(false)}
        onSubmit={(form) =>
          requestZoomAction({
            topic: text(form, "topic"),
            startsAtLocal: text(form, "startsAtLocal"),
            timeZone: text(form, "timeZone"),
            durationMinutes: num(form, "durationMinutes"),
            passcode: text(form, "passcode"),
            joinBeforeHostMinutes: num(form, "joinBeforeHostMinutes"),
            meetingId: text(form, "meetingId") || null,
          })
        }
      >
        <Field label="Topic" name="topic" required maxLength={200} />
        <Field label="Start" name="startsAtLocal" type="datetime-local" required />
        <Field
          label="Time zone"
          name="timeZone"
          required
          hint="IANA zone of the start time, e.g. Asia/Tokyo"
          defaultValue={Intl.DateTimeFormat().resolvedOptions().timeZone}
        />
        <Field
          label="Duration (minutes)"
          name="durationMinutes"
          type="number"
          min={15}
          required
          defaultValue={60}
        />
        <Field
          label="Passcode"
          name="passcode"
          required
          maxLength={10}
          hint="Up to 10 characters"
        />
        <ChoiceField
          label="Participants may join before the host"
          name="joinBeforeHostMinutes"
          defaultValue="0"
          options={JOIN_BEFORE_HOST_MINUTES.map((m) => ({
            value: String(m),
            label: m === 0 ? "No" : `${m} minutes before`,
          }))}
        />
        <Field
          label="Meeting id (optional)"
          name="meetingId"
          hint="The meeting this room is for; attach it there under Room afterwards"
        />
      </FormModal>
      {deciding ? (
        <FormModal
          open
          title={deciding.approve ? "Approve booking" : "Reject booking"}
          submitLabel={deciding.approve ? "Approve" : "Reject"}
          onClose={() => setDeciding(null)}
          onSubmit={(form) =>
            (deciding.approve ? approveZoomAction : rejectZoomAction)({
              id: deciding.row.id,
              version: deciding.row.version,
              note: text(form, "note"),
            })
          }
        >
          <p>{deciding.row.topic}</p>
          <Field label="Note" name="note" rows={2} maxLength={500} />
        </FormModal>
      ) : null}
      {settings ? (
        <FormModal
          open={editingSettings}
          title="Zoom settings"
          onClose={() => setEditingSettings(false)}
          onSubmit={(form) => {
            const hostKey = text(form, "hostKey");
            return saveZoomSettingsAction({
              version: settings.version,
              licences: num(form, "licences"),
              concurrentPerLicence: num(form, "concurrentPerLicence"),
              approvalRequired: text(form, "approvalRequired") === "yes",
              minNoticeHours: num(form, "minNoticeHours"),
              maxDurationMinutes: num(form, "maxDurationMinutes"),
              autoDeleteRecordings: text(form, "autoDeleteRecordings") === "yes",
              hostKey: text(form, "removeHostKey") === "yes" ? "" : hostKey || null,
            });
          }}
        >
          <Field
            label="Licences"
            name="licences"
            type="number"
            min={0}
            defaultValue={settings.licences}
          />
          <Field
            label="Concurrent meetings per licence"
            name="concurrentPerLicence"
            type="number"
            min={1}
            defaultValue={settings.concurrentPerLicence}
          />
          <ChoiceField
            label="Approval required"
            name="approvalRequired"
            defaultValue={settings.approvalRequired ? "yes" : "no"}
            options={[
              { value: "yes", label: "Yes" },
              { value: "no", label: "No (approved when capacity allows)" },
            ]}
          />
          <Field
            label="Minimum notice (hours)"
            name="minNoticeHours"
            type="number"
            min={0}
            defaultValue={settings.minNoticeHours}
          />
          <Field
            label="Longest booking (minutes)"
            name="maxDurationMinutes"
            type="number"
            min={15}
            defaultValue={settings.maxDurationMinutes}
          />
          <ChoiceField
            label="Move recordings to the Zoom trash once archived in Drive"
            name="autoDeleteRecordings"
            defaultValue={settings.autoDeleteRecordings ? "yes" : "no"}
            options={[
              { value: "no", label: "No (default)" },
              { value: "yes", label: "Yes, after every file of the session is verified" },
            ]}
          />
          <Field
            label={settings.hostKeySet ? "New Host Key (one is stored)" : "Host Key"}
            name="hostKey"
            hint="6 digits; stored encrypted and never put in invitations. Empty = keep."
            maxLength={6}
          />
          {settings.hostKeySet ? (
            <ChoiceField
              label="Remove the stored Host Key"
              name="removeHostKey"
              defaultValue="no"
              options={[
                { value: "no", label: "No" },
                { value: "yes", label: "Yes" },
              ]}
            />
          ) : null}
        </FormModal>
      ) : null}
      {invite ? <Invitation row={invite} onClose={() => setInvite(null)} /> : null}
    </div>
  );
}
