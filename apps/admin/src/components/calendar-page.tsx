"use client";

import { useRouter } from "next/navigation";
import { CALENDAR_KIND_LABELS, type CalendarKind } from "@website/domain/tasks";
import {
  addHolidayAction,
  removeHolidayAction,
  revokeFeedAction,
} from "@/app/(panel)/calendar/actions";
import { actionMessage, type ActionFailure } from "@/components/action-message";
import { Field, FormModal, text } from "@/components/program-ui";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";
import { ToastBanner, useToastMessage } from "@/components/ui/toast";
import { useState } from "react";

interface Item {
  id: string;
  kind: CalendarKind;
  title: string;
  /** UTC day of a timed item, or the plain date of an all-day one. */
  day: string;
  time: string | null;
  href: string | null;
  warnings: string[];
}

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** The month as weeks (Monday first) of "YYYY-MM-DD" or null for padding. */
function weeks(month: string): Array<Array<string | null>> {
  const first = new Date(`${month}-01T00:00:00Z`);
  const days = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  const cells: Array<string | null> = Array.from(
    { length: (first.getUTCDay() + 6) % 7 },
    () => null,
  );
  for (let d = 1; d <= days; d++) cells.push(`${month}-${String(d).padStart(2, "0")}`);
  while (cells.length % 7) cells.push(null);
  return Array.from({ length: cells.length / 7 }, (_, i) => cells.slice(i * 7, i * 7 + 7));
}

const shift = (month: string, by: number) => {
  const d = new Date(`${month}-01T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + by);
  return d.toISOString().slice(0, 7);
};

/** Calendar (G2): month grid, the day list, the feed link and holidays. */
export function CalendarPage({
  month,
  items,
  feedUrl,
  holidays,
}: {
  month: string;
  items: Item[];
  feedUrl: string | null;
  /** null = the viewer may not manage holidays. */
  holidays: Array<{ id: string; date: string; name: string }> | null;
}) {
  const router = useRouter();
  const toast = useToastMessage();
  const [adding, setAdding] = useState(false);
  const byDay = new Map<string, Item[]>();
  for (const item of items) byDay.set(item.day, [...(byDay.get(item.day) ?? []), item]);
  const run = async (action: Promise<{ ok: true } | ActionFailure>, done: string) => {
    const result = await action;
    toast.show(result.ok ? done : actionMessage(result));
    if (result.ok) router.refresh();
  };
  return (
    <div>
      <ToastBanner message={toast.message} />
      <div className="admin-page-header">
        <div>
          <h1 className="admin-page-header__title">Calendar {month}</h1>
          <p className="admin-page-header__desc">
            Meetings, Zoom, milestones, LPJ due dates and holidays you may see (days in UTC).
          </p>
        </div>
        <div className="admin-page-header__actions">
          <Button
            size="sm"
            variant="outline"
            icon="chevronLeft"
            href={`/calendar?month=${shift(month, -1)}`}
          >
            Previous
          </Button>
          <Button
            size="sm"
            variant="outline"
            icon="chevronRight"
            href={`/calendar?month=${shift(month, 1)}`}
          >
            Next
          </Button>
        </div>
      </div>
      <Card>
        <CardBody>
          <table className="admin-calendar" style={{ width: "100%", tableLayout: "fixed" }}>
            <thead>
              <tr>
                {WEEKDAYS.map((d) => (
                  <th key={d}>{d}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {weeks(month).map((week) => (
                <tr key={week.join()}>
                  {week.map((day, i) => (
                    <td key={day ?? `pad-${i}`} style={{ verticalAlign: "top", height: "5rem" }}>
                      {day ? <strong>{Number(day.slice(8))}</strong> : null}
                      {(day ? (byDay.get(day) ?? []) : []).map((item) => (
                        <div
                          key={item.id}
                          className="admin-table__sub"
                          title={item.warnings.join("; ")}
                        >
                          {item.warnings.length ? <Icon name="warning" size={12} /> : null}
                          {item.href ? <a href={item.href}>{item.title}</a> : item.title}
                        </div>
                      ))}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="List" />
        <CardBody>
          {items.length === 0 ? <p>Nothing this month.</p> : null}
          <ul>
            {items.map((item) => (
              <li key={item.id}>
                {item.day} {item.time ?? "(all day)"} · {CALENDAR_KIND_LABELS[item.kind]} ·{" "}
                {item.href ? <a href={item.href}>{item.title}</a> : item.title}
                {item.warnings.length ? ` · Warning: ${item.warnings.join("; ")}` : ""}
              </li>
            ))}
          </ul>
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Calendar app (.ics)" />
        <CardBody>
          {feedUrl ? (
            <>
              <p>
                Subscribe in Google Calendar, Outlook or Apple Calendar with this private link.
                Anyone with it sees your items; revoke it if it leaks.
              </p>
              <input className="admin-input" readOnly value={feedUrl} aria-label="Feed link" />
              <Button
                size="sm"
                variant="danger"
                onClick={() =>
                  void run(revokeFeedAction({}), "Old links revoked; a new link is shown")
                }
              >
                Revoke and make a new link
              </Button>
            </>
          ) : (
            <p>The feed is not set up (CALENDAR_FEED_SIGNING_SECRET).</p>
          )}
        </CardBody>
      </Card>
      {holidays ? (
        <Card>
          <CardHeader
            title="Holidays"
            actions={
              <Button size="sm" variant="outline" icon="plus" onClick={() => setAdding(true)}>
                Add
              </Button>
            }
          />
          <CardBody>
            <ul>
              {holidays.map((h) => (
                <li key={h.id}>
                  {h.date} {h.name}{" "}
                  <Button
                    size="sm"
                    variant="ghost"
                    icon="trash"
                    onClick={() => void run(removeHolidayAction({ id: h.id }), "Holiday removed")}
                  >
                    Remove
                  </Button>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      ) : null}
      <FormModal
        open={adding}
        title="Add holiday"
        onClose={() => setAdding(false)}
        onSubmit={(form) =>
          addHolidayAction({ date: text(form, "date"), name: text(form, "name") })
        }
      >
        <Field label="Date" name="date" type="date" required />
        <Field label="Name" name="name" required maxLength={120} />
      </FormModal>
    </div>
  );
}
