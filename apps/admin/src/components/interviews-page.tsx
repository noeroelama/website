"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { utcToWallTime } from "@website/domain/shared";
import {
  createInterviewPlanAction,
  removeInterviewSlotAction,
} from "@/app/(panel)/recruitment/actions";
import { actionMessage } from "@/components/action-message";
import { Button } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { FieldError } from "@/components/ui/field-error";
import { Modal } from "@/components/ui/modal";
import { ToastBanner, useToastMessage } from "@/components/ui/toast";

export interface SlotItem {
  id: string;
  startsAt: string;
  durationMinutes: number;
  capacity: number;
  booked: number;
  location: string;
  applicants: string[];
}

const browserZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

export function InterviewsPage(props: {
  recruitment: { id: string; title: string };
  slots: SlotItem[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const toast = useToastMessage();
  const [zone] = useState(browserZone);
  const days = useMemo(
    () => [
      ...new Set(props.slots.map((s) => utcToWallTime(new Date(s.startsAt), zone).slice(0, 10))),
    ],
    [props.slots, zone],
  );
  const [day, setDay] = useState(days[0] ?? "");
  const [planning, setPlanning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Readonly<Record<string, string>>>({});
  const [plan, setPlan] = useState({
    date: "",
    startTime: "09:00",
    endTime: "12:00",
    durationMinutes: "30",
    gapMinutes: "10",
    breakStart: "",
    breakEnd: "",
    capacity: "1",
    location: "",
  });

  const ofDay = props.slots.filter((s) =>
    utcToWallTime(new Date(s.startsAt), zone).startsWith(day),
  );

  const create = async () => {
    setBusy(true);
    const result = await createInterviewPlanAction({
      recruitmentId: props.recruitment.id,
      plan: {
        date: plan.date,
        timeZone: zone,
        startTime: plan.startTime,
        endTime: plan.endTime,
        durationMinutes: Number(plan.durationMinutes),
        gapMinutes: Number(plan.gapMinutes),
        breaks:
          plan.breakStart && plan.breakEnd ? [{ start: plan.breakStart, end: plan.breakEnd }] : [],
        capacity: Number(plan.capacity),
        location: plan.location,
      },
    });
    setBusy(false);
    if (!result.ok) {
      setFieldErrors(result.fields ?? {});
      toast.show(actionMessage(result));
      return;
    }
    setPlanning(false);
    setDay(plan.date);
    toast.show(`${result.data.created} interview times created`);
    router.refresh();
  };

  const remove = async (id: string) => {
    setBusy(true);
    const result = await removeInterviewSlotAction({ id });
    setBusy(false);
    toast.show(result.ok ? "Interview time removed" : actionMessage(result));
    if (result.ok) router.refresh();
  };

  const field = (key: keyof typeof plan, text: string, type = "text") => (
    <div className="admin-field">
      <label className="admin-field__label" htmlFor={`plan-${key}`}>
        {text}
      </label>
      <input
        id={`plan-${key}`}
        className="admin-input"
        type={type}
        value={plan[key]}
        onChange={(e) => setPlan({ ...plan, [key]: e.target.value })}
      />
    </div>
  );

  return (
    <div>
      <div className="admin-page-header">
        <div>
          <h1 className="admin-page-header__title">Recruitment &gt; Interviews</h1>
          <p className="admin-page-header__desc">
            {props.recruitment.title} · times on your clock ({zone}); applicants see them on theirs.
          </p>
        </div>
        <div className="admin-page-header__actions">
          <Button
            variant="outline"
            size="sm"
            icon="chevronLeft"
            onClick={() => router.push("/recruitment")}
          >
            Back
          </Button>
          <div className="admin-fab">
            {props.canEdit ? (
              <Button variant="outline" size="sm" icon="plus" onClick={() => setPlanning(true)}>
                Add a day
              </Button>
            ) : null}
          </div>
        </div>
      </div>

      <div className="admin-toolbar">
        <div className="admin-field">
          <label className="admin-field__label" htmlFor="interview-day">
            Day
          </label>
          <input
            id="interview-day"
            className="admin-input"
            type="date"
            value={day}
            onChange={(e) => setDay(e.target.value)}
          />
          <FieldError
            id="interview-day-error"
            hint={
              days.length ? `Days with interviews: ${days.join(", ")}` : "No interview times yet."
            }
          />
        </div>
      </div>

      <Card className="admin-list-card">
        <CardBody>
          {ofDay.length === 0 ? (
            <span className="admin-card__subtitle">No interview times on this day.</span>
          ) : (
            <ol className="admin-detail-rounds">
              {ofDay.map((s) => (
                <li key={s.id}>
                  <strong>{utcToWallTime(new Date(s.startsAt), zone).slice(11)}</strong> ·{" "}
                  {s.durationMinutes} min · {s.booked}/{s.capacity} booked
                  {s.applicants.length ? ` — ${s.applicants.join(", ")}` : ""}
                  {s.location ? ` · ${s.location}` : ""}
                  {props.canEdit && s.booked === 0 ? (
                    <>
                      {" "}
                      <Button
                        variant="ghost"
                        size="sm"
                        icon="trash"
                        disabled={busy}
                        onClick={() => remove(s.id)}
                      >
                        Remove
                      </Button>
                    </>
                  ) : null}
                </li>
              ))}
            </ol>
          )}
        </CardBody>
      </Card>

      <Modal
        asForm
        open={planning}
        title="Add a day of interviews"
        subtitle={`Times on your clock (${zone}); stored in UTC.`}
        onClose={() => setPlanning(false)}
        footer={
          <div className="admin-modal__footer-row">
            <Button variant="outline" icon="chevronLeft" onClick={() => setPlanning(false)}>
              Back
            </Button>
            <Button
              type="submit"
              variant="primary"
              icon="plus"
              disabled={busy}
              onClick={() => create()}
            >
              Create times
            </Button>
          </div>
        }
      >
        <div className="admin-form-grid">
          {field("date", "Day *", "date")}
          {field("capacity", "People per time *", "number")}
          {field("startTime", "From *", "time")}
          {field("endTime", "Until *", "time")}
          {field("durationMinutes", "Minutes per interview *", "number")}
          {field("gapMinutes", "Minutes between", "number")}
          {field("breakStart", "Break from", "time")}
          {field("breakEnd", "Break until", "time")}
          <div className="admin-form-grid__full">{field("location", "Meeting link or room")}</div>
        </div>
        <FieldError id="plan-error" message={fieldErrors["plan"]} />
      </Modal>
      <ToastBanner message={toast.message} />
    </div>
  );
}
