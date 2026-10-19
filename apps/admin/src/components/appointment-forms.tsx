"use client";

import { useState } from "react";
import {
  APPOINTMENT_SEATS,
  CORE_UNIT_TYPES,
  SUGGESTED_APPOINTMENT_ROLES,
  type AppointmentRoleMap,
  type AppointmentSeat,
} from "@website/domain/organizations";
import {
  appointAction,
  endAppointmentAction,
  saveAppointmentRolesAction,
} from "@/app/(panel)/organizations/actions";
import { actionMessage } from "@/components/action-message";
import { Button } from "@/components/ui/button";
import { FieldError } from "@/components/ui/field-error";
import { Modal } from "@/components/ui/modal";
import { label, ORG_UNIT_TYPE_LABELS } from "@/labels";

/** An appointment row of the Structure page (mapped on the server from `appointments/{id}`). */
export interface AppointmentItem {
  id: string;
  version: number;
  orgUnitId: string;
  name: string;
  title: string;
  seat: AppointmentSeat;
  status: "active" | "ended" | "revoked";
}

const SEAT_LABELS: Record<AppointmentSeat, string> = {
  head: "Head of the unit",
  secretary: "Secretary of the unit",
  member: "Member",
};

/** The people of one unit with an End button (ending revokes the roles the appointment gave). */
export function UnitPeople(props: {
  people: AppointmentItem[];
  canEdit: boolean;
  onDone: (message: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const end = async (a: AppointmentItem) => {
    setBusy(true);
    const result = await endAppointmentAction({ id: a.id, version: a.version, status: "ended" });
    setBusy(false);
    props.onDone(result.ok ? `${a.name}'s appointment ended` : actionMessage(result));
  };
  if (props.people.length === 0) return null;
  return (
    <ul className="admin-form-separator__list">
      {props.people.map((a) => (
        <li key={a.id} className="admin-account__row">
          <span className="admin-table__sub">
            {a.title} — {a.name}
          </span>
          {props.canEdit ? (
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => void end(a)}>
              End
            </Button>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

/** Appoint someone (by account e-mail) to a seat of one unit of the active period. */
export function AppointModal(props: {
  unit: { id: string; name: string } | null;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const [email, setEmail] = useState("");
  const [seat, setSeat] = useState<AppointmentSeat>("member");
  const [title, setTitle] = useState("");
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { unit } = props;

  const appoint = async () => {
    if (!unit) return;
    setBusy(true);
    const result = await appointAction({ email, orgUnitId: unit.id, seat, title });
    setBusy(false);
    if (!result.ok) {
      setErrors(result.fields ?? {});
      setMessage(actionMessage(result));
      return;
    }
    props.onDone(`${email} appointed`);
  };

  return (
    <Modal
      open={unit !== null}
      title={`Appoint to ${unit?.name ?? ""}`}
      width={480}
      onClose={props.onClose}
      footer={
        <div className="admin-modal__footer-row admin-modal__footer-row--end">
          <Button variant="ghost" onClick={props.onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={busy} onClick={() => void appoint()}>
            Appoint
          </Button>
        </div>
      }
    >
      <div className="admin-field">
        <label className="admin-field__label" htmlFor="appoint-email">
          Account e-mail *
        </label>
        <input
          id="appoint-email"
          className="admin-input"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          aria-describedby="appoint-email-error"
        />
        <FieldError
          id="appoint-email-error"
          message={errors["email"] ?? "The person signs in on the website once first."}
        />
      </div>
      <div className="admin-field">
        <label className="admin-field__label" htmlFor="appoint-seat">
          Seat *
        </label>
        <select
          id="appoint-seat"
          className="admin-select"
          value={seat}
          onChange={(e) => setSeat(e.target.value as AppointmentSeat)}
        >
          {APPOINTMENT_SEATS.map((s) => (
            <option key={s} value={s}>
              {SEAT_LABELS[s]}
            </option>
          ))}
        </select>
      </div>
      <div className="admin-field">
        <label className="admin-field__label" htmlFor="appoint-title">
          Title *
        </label>
        <input
          id="appoint-title"
          className="admin-input"
          value={title}
          placeholder="e.g. Direktur Media"
          onChange={(e) => setTitle(e.target.value)}
          aria-describedby="appoint-title-error"
        />
        <FieldError id="appoint-title-error" message={errors["title"]} />
      </div>
      {message && (
        <p role="alert" className="admin-field__error">
          {message}
        </p>
      )}
    </Modal>
  );
}

/** Roles from appointments: which (custom) role each seat gives. Data, edited with roles.edit. */
export function RoleMapModal(props: {
  open: boolean;
  current: { map: AppointmentRoleMap; version: number } | null;
  roles: { id: string; name: string }[];
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const [map, setMap] = useState<AppointmentRoleMap>(
    props.current?.map ?? SUGGESTED_APPOINTMENT_ROLES,
  );
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    const result = await saveAppointmentRolesAction({
      map,
      version: props.current?.version ?? null,
    });
    setBusy(false);
    if (!result.ok) return setMessage(actionMessage(result));
    props.onDone("Roles from appointments saved");
  };

  const select = (text: string, value: string, onChange: (id: string) => void) => (
    <div className="admin-field" key={text}>
      <label className="admin-field__label">
        {text}
        <select className="admin-select" value={value} onChange={(e) => onChange(e.target.value)}>
          {props.roles.some((r) => r.id === value) ? null : <option value={value}>{value}</option>}
          {props.roles.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
      </label>
    </div>
  );

  return (
    <Modal
      open={props.open}
      title="Roles from appointments"
      width={560}
      onClose={props.onClose}
      footer={
        <div className="admin-modal__footer-row admin-modal__footer-row--end">
          <Button variant="ghost" onClick={props.onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={busy} onClick={() => void save()}>
            Save
          </Button>
        </div>
      }
    >
      <p className="admin-table__sub">
        Every appointment gives the officer role; heads and secretaries also get their role for
        their unit (and the units below it); the head of a core unit gets its role for the whole
        organisation. Roles count only in the appointment&apos;s period and end with it.
      </p>
      <div className="admin-form-grid">
        {select("Every officer", map.officer, (id) => setMap((m) => ({ ...m, officer: id })))}
        {select("Unit head", map.unitHead, (id) => setMap((m) => ({ ...m, unitHead: id })))}
        {select("Unit secretary", map.unitSecretary, (id) =>
          setMap((m) => ({ ...m, unitSecretary: id })),
        )}
        {CORE_UNIT_TYPES.map((type) =>
          select(`Head of ${label(ORG_UNIT_TYPE_LABELS, type)}`, map.core[type], (id) =>
            setMap((m) => ({ ...m, core: { ...m.core, [type]: id } })),
          ),
        )}
      </div>
      {message && (
        <p role="alert" className="admin-field__error">
          {message}
        </p>
      )}
    </Modal>
  );
}
