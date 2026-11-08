"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import type { DragEvent } from "react";
import type { FeaturedImage } from "@website/domain/content";
import { ORG_UNIT_TYPES, type OrgUnitType } from "@website/domain/organizations";
import { saveOrgUnitAction } from "@/app/(panel)/organizations/actions";
import { actionMessage } from "@/components/action-message";
import { publicImage, useImageUpload } from "@/components/image-upload";
import { Button } from "@/components/ui/button";
import { FieldError } from "@/components/ui/field-error";
import { Icon } from "@/components/ui/icon";
import { ToastBanner, useToastMessage } from "@/components/ui/toast";
import { label, ORG_UNIT_TYPE_LABELS } from "@/labels";
import { ORG_SUBTITLE } from "./organizations-page";
import type { OrgUnitItem } from "./org-units-model";
import { Select } from "@/components/ui/select";

/** A member row; `key` only keeps React rows stable while they are reordered. */
interface MemberRow {
  key: number;
  name: string;
  role: string;
  head: boolean;
  photo: FeaturedImage | null;
}
interface DivisionRow {
  key: number;
  name: string;
  members: MemberRow[];
}
/** Which list a row belongs to: the core members (null) or a division (its index). */
type ListId = number | null;

let nextKey = 1;
const newMember = (): MemberRow => ({
  key: nextKey++,
  name: "",
  role: "",
  head: false,
  photo: null,
});
const toRows = (members: OrgUnitItem["members"]): MemberRow[] =>
  members.map((m) => ({ ...m, key: nextKey++ }));
const fromRows = (rows: MemberRow[]) =>
  rows.map(({ name, role, head, photo }) => ({ name, role, head, photo }));

/** Moves item `from` to position `to` (drag and drop). */
function moved<T>(list: T[], from: number, to: number): T[] {
  const next = [...list];
  const [item] = next.splice(from, 1);
  if (item !== undefined) next.splice(to, 0, item);
  return next;
}

/**
 * Organizations → Period → Structure → Create / Edit Unit: the unit's name, code and type, its
 * core members and its divisions with their members — names, roles and photos for the cabinet
 * page — display data only (not accounts, no roles). Rows are reordered by dragging the handle.
 */
export function OrgUnitEditor({ periodId, unit }: { periodId: string; unit: OrgUnitItem | null }) {
  const router = useRouter();
  const toast = useToastMessage();
  const [name, setName] = useState(unit?.name ?? "");
  const [code, setCode] = useState(unit?.code ?? "");
  const [type, setType] = useState<OrgUnitType | "">(unit?.type ?? "");
  const [members, setMembers] = useState<MemberRow[]>(() => toRows(unit?.members ?? []));
  const [divisions, setDivisions] = useState<DivisionRow[]>(() =>
    (unit?.divisions ?? []).map((d) => ({
      key: nextKey++,
      name: d.name,
      members: toRows(d.members),
    })),
  );
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>({});
  const [busy, setBusy] = useState(false);
  const photo = useImageUpload("cabinet");
  const photoInput = useRef<HTMLInputElement>(null);
  const photoFor = useRef<{ list: ListId; index: number } | null>(null);
  /* What is being dragged: a member (in a list) or a division. */
  const dragged = useRef<{ list: ListId; index: number } | { division: number } | null>(null);
  const backPath = `/organizations/periods/${periodId}`;

  /* ---- member lists ---- */
  const listOf = (list: ListId) => (list === null ? members : (divisions[list]?.members ?? []));
  const setList = (list: ListId, update: (rows: MemberRow[]) => MemberRow[]) => {
    if (list === null) setMembers(update);
    else
      setDivisions((ds) =>
        ds.map((d, i) => (i === list ? { ...d, members: update(d.members) } : d)),
      );
  };
  const setMember = (list: ListId, index: number, change: Partial<MemberRow>) =>
    setList(list, (rows) => rows.map((m, i) => (i === index ? { ...m, ...change } : m)));

  const dropOn = (target: { list: ListId; index: number } | { division: number }) => {
    const from = dragged.current;
    dragged.current = null;
    if (!from) return;
    if ("division" in from && "division" in target) {
      setDivisions((ds) => moved(ds, from.division, target.division));
    } else if ("list" in from && "list" in target && from.list === target.list) {
      setList(from.list, (rows) => moved(rows, from.index, target.index));
    }
  };
  const dropZone = (target: { list: ListId; index: number } | { division: number }) => ({
    onDragOver: (e: DragEvent) => e.preventDefault(),
    onDrop: (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      dropOn(target);
    },
  });

  const save = async () => {
    if (!type) return setErrors({ type: "Choose the unit type." });
    setBusy(true);
    const result = await saveOrgUnitAction({
      ...(unit ? { id: unit.id } : {}),
      version: unit?.version ?? null,
      periodId,
      // Where the unit sits and its notes are kept as they are (this page does not show them).
      parentId: unit?.parentId ?? null,
      description: unit?.description ?? "",
      sort: unit?.sort ?? 0,
      active: unit?.active ?? true,
      name,
      code,
      type,
      members: fromRows(members),
      divisions: divisions.map((d) => ({ name: d.name, members: fromRows(d.members) })),
    });
    setBusy(false);
    if (!result.ok) {
      setErrors(result.fields ?? {});
      return toast.show(actionMessage(result));
    }
    router.push(backPath);
    router.refresh();
  };

  const memberCard = (m: MemberRow, list: ListId, index: number) => (
    <div
      key={m.key}
      className={`admin-unit-member${list === null ? " admin-unit-card" : ""}`}
      {...dropZone({ list, index })}
    >
      {list === null ? (
        <span
          className="admin-unit-grip"
          draggable
          onDragStart={() => (dragged.current = { list, index })}
          aria-label="Drag to reorder"
          title="Drag to reorder"
        >
          <Icon name="gripBold" size={28} />
        </span>
      ) : null}
      <button
        type="button"
        className="admin-unit-photo"
        aria-label={m.photo ? `Change the photo of ${m.name || "this member"}` : "Add a photo"}
        disabled={photo.busy}
        onClick={() => {
          photoFor.current = { list, index };
          photoInput.current?.click();
        }}
        onDragStart={(e) => e.preventDefault()}
      >
        {m.photo ? (
          // eslint-disable-next-line @next/next/no-img-element -- Storage thumbnail (WebP)
          <img src={m.photo.thumbUrl} alt="" width={80} height={80} />
        ) : (
          <Icon name="user" size={32} />
        )}
      </button>
      <div className="admin-field">
        <label className="admin-field__label" htmlFor={`member-${m.key}-name`}>
          Name *
        </label>
        <input
          id={`member-${m.key}-name`}
          required
          className="admin-input"
          placeholder="Name"
          value={m.name}
          onChange={(e) => setMember(list, index, { name: e.target.value })}
        />
        <FieldError id={`member-${m.key}-name-error`} />
      </div>
      <div className="admin-field">
        <label className="admin-field__label" htmlFor={`member-${m.key}-role`}>
          Role *
        </label>
        <input
          id={`member-${m.key}-role`}
          required
          className="admin-input"
          placeholder={list === null ? "Kepala Direktorat" : "Staff Bidang"}
          value={m.role}
          onChange={(e) => setMember(list, index, { role: e.target.value })}
        />
        <FieldError id={`member-${m.key}-role-error`} />
      </div>
      <Button
        variant="primary"
        size="sm"
        className="admin-unit-seat"
        icon={m.head ? "crown" : "user"}
        aria-pressed={m.head}
        title={m.head ? "Shown as head — click to make a member" : "Click to show as head"}
        onClick={() => setMember(list, index, { head: !m.head })}
      >
        {m.head ? "Head" : "Member"}
      </Button>
      <Button
        variant="danger"
        size="sm"
        icon="trash"
        onClick={() => setList(list, (rows) => rows.filter((_, i) => i !== index))}
      >
        Delete
      </Button>
    </div>
  );

  return (
    <div>
      <div className="admin-page-header admin-unit-header">
        <div>
          <h1 className="admin-page-header__title">
            Organizations &gt; Period &gt; Structure &gt; {unit ? "Edit Unit" : "Create Unit"}
          </h1>
          <p className="admin-page-header__desc">{ORG_SUBTITLE}</p>
        </div>
      </div>

      <div className="admin-unit-fields">
        <div className="admin-field">
          <label className="admin-field__label" htmlFor="unit-name">
            Name *
          </label>
          <input
            id="unit-name"
            required
            className="admin-input"
            placeholder="e.g Badan Koordinasi Kawasan"
            value={name}
            onChange={(e) => setName(e.target.value)}
            aria-invalid={errors["name"] ? true : undefined}
            aria-describedby="unit-name-error"
          />
          <FieldError id="unit-name-error" message={errors["name"]} />
        </div>
        <div className="admin-field">
          <label className="admin-field__label" htmlFor="unit-code">
            Code *
          </label>
          <input
            id="unit-code"
            required
            className="admin-input"
            placeholder="e.g Koor"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            aria-invalid={errors["code"] ? true : undefined}
            aria-describedby="unit-code-error"
          />
          <FieldError id="unit-code-error" message={errors["code"]} />
        </div>
        <div className="admin-field">
          <label className="admin-field__label" htmlFor="unit-type">
            Type *
          </label>
          <Select
            id="unit-type"
            required
            className="admin-input"
            value={type}
            onChange={(e) => setType(e.target.value as OrgUnitType)}
            aria-invalid={errors["type"] ? true : undefined}
            aria-describedby="unit-type-error"
          >
            <option value="" disabled>
              Select...
            </option>
            {ORG_UNIT_TYPES.map((t) => (
              <option key={t} value={t}>
                {label(ORG_UNIT_TYPE_LABELS, t, "id")}
              </option>
            ))}
          </Select>
          <FieldError id="unit-type-error" message={errors["type"]} />
        </div>
      </div>

      <section className="admin-unit-section">
        <div className="admin-unit-section__head">
          <div>
            <h2 className="admin-unit-section__title">Core Members</h2>
            <p className="admin-unit-section__desc">Heads of unit and members without divisions</p>
          </div>
          <Button
            variant="outline"
            size="sm"
            icon="plus"
            onClick={() => setMembers((rows) => [...rows, newMember()])}
          >
            Add New Member
          </Button>
        </div>
        {members.length === 0 ? (
          <p className="admin-unit-empty">There are no members of the unit yet.</p>
        ) : (
          members.map((m, i) => memberCard(m, null, i))
        )}
        <FieldError id="unit-members-error" message={errors["members"]} />
      </section>

      <section className="admin-unit-section">
        <div className="admin-unit-section__head">
          <div>
            <h2 className="admin-unit-section__title">Divisions</h2>
            <p className="admin-unit-section__desc">Add a division if the unit has division</p>
          </div>
          <Button
            variant="outline"
            size="sm"
            icon="plus"
            onClick={() => setDivisions((ds) => [...ds, { key: nextKey++, name: "", members: [] }])}
          >
            Add New Division
          </Button>
        </div>
        {divisions.length === 0 ? (
          <p className="admin-unit-empty">
            There are no divisions. Click &quot;Add New Division&quot; if this unit has a division.
          </p>
        ) : (
          divisions.map((d, di) => (
            <div
              key={d.key}
              className="admin-unit-card admin-unit-division"
              {...dropZone({ division: di })}
            >
              <span
                className="admin-unit-grip"
                draggable
                onDragStart={() => (dragged.current = { division: di })}
                aria-label="Drag to reorder"
                title="Drag to reorder"
              >
                <Icon name="gripBold" size={28} />
              </span>
              <div className="admin-unit-division__body">
                <div className="admin-unit-division__name">
                  <div className="admin-field">
                    <label className="admin-field__label" htmlFor={`division-${d.key}`}>
                      Division Name *
                    </label>
                    <input
                      id={`division-${d.key}`}
                      required
                      className="admin-input"
                      placeholder="Division Name"
                      value={d.name}
                      onChange={(e) =>
                        setDivisions((ds) =>
                          ds.map((x, i) => (i === di ? { ...x, name: e.target.value } : x)),
                        )
                      }
                    />
                    <FieldError id={`division-${d.key}-error`} />
                  </div>
                  <Button
                    variant="danger"
                    size="sm"
                    icon="trash"
                    onClick={() => setDivisions((ds) => ds.filter((_, i) => i !== di))}
                  >
                    Delete Division
                  </Button>
                </div>
                {d.members.length === 0 ? (
                  <p className="admin-unit-empty">There are no members in this division yet.</p>
                ) : (
                  d.members.map((m, mi) => memberCard(m, di, mi))
                )}
                <button
                  type="button"
                  className="admin-unit-add"
                  onClick={() => setList(di, (rows) => [...rows, newMember()])}
                >
                  <Icon name="plus" size={16} /> Add New Member
                </button>
              </div>
            </div>
          ))
        )}
        <FieldError id="unit-divisions-error" message={errors["divisions"]} />
      </section>

      <input
        ref={photoInput}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          const target = photoFor.current;
          e.target.value = "";
          if (!file || !target) return;
          void photo.upload(file).then((image) => {
            const uploaded = image ? publicImage(image) : null;
            if (uploaded && listOf(target.list)[target.index]) {
              setMember(target.list, target.index, { photo: uploaded });
            }
          });
        }}
      />
      <FieldError id="unit-photo-error" message={photo.error ?? undefined} />

      <div className="admin-unit-footer">
        <Button variant="outline" size="sm" icon="chevronLeft" href={backPath}>
          Back
        </Button>
        <Button
          variant="outline"
          size="sm"
          icon="cloud"
          disabled={busy || photo.busy}
          onClick={() => save()}
        >
          Save
        </Button>
      </div>
      <ToastBanner message={toast.message} />
    </div>
  );
}
