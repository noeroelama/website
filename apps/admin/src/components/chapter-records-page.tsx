"use client";

import { useState } from "react";
import { CHAPTER_SIGNAL_LABELS, type ChapterSignal } from "@website/domain/organizations";
import {
  saveChapterOfficersAction,
  submitChapterReportAction,
} from "@/app/(panel)/organizations/actions";
import { Field, FormModal, text } from "@/components/program-ui";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Select } from "@/components/ui/select";

interface Officer {
  name: string;
  title: string;
  termEnd: string | null;
  warning: string | null;
}
interface Report {
  quarter: string;
  activeMembers: number;
  activities: string[];
  obstacles: string;
  submittedAt: string;
  filledByCentre: boolean;
}

const lines = (value: string) =>
  value
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

/** Chapter records (H1-H3): officers with terms, the quarterly report, the risk signal. */
export function ChapterRecordsPage(props: {
  chapter: { id: string; name: string };
  signal: { signal: ChapterSignal; reason: string } | null;
  officers: Officer[];
  reports: Report[];
  /** The current quarter and the two before it (a future quarter is refused). */
  quarters: string[];
  canEdit: boolean;
}) {
  const [form, setForm] = useState<"officers" | "report" | null>(null);
  return (
    <div>
      <div className="admin-page-header">
        <div>
          <h1 className="admin-page-header__title">{props.chapter.name}</h1>
          <p className="admin-page-header__desc">
            {props.signal ? (
              <>
                <Badge tone={props.signal.signal === "active" ? "success" : "danger"}>
                  {CHAPTER_SIGNAL_LABELS[props.signal.signal]}
                </Badge>{" "}
                {props.signal.reason}
              </>
            ) : (
              "Inactive chapter: not rated."
            )}{" "}
            <a href="/organizations?view=ppi">Back to PPI</a>
          </p>
        </div>
        {props.canEdit ? (
          <div className="admin-page-header__actions">
            <Button size="sm" variant="outline" onClick={() => setForm("officers")}>
              Edit officers
            </Button>
            <Button size="sm" onClick={() => setForm("report")}>
              Submit quarterly report
            </Button>
          </div>
        ) : null}
      </div>

      <Card>
        <CardHeader title="Core officers" />
        <CardBody>
          {props.officers.length === 0 ? (
            <p>No officers entered.</p>
          ) : (
            <ul>
              {props.officers.map((o, i) => (
                <li key={i}>
                  {o.title} — {o.name}{" "}
                  <span className="admin-table__sub">{o.termEnd ?? "end unknown"}</span>
                  {o.warning ? (
                    <>
                      {" "}
                      <Badge tone="danger">{o.warning}</Badge>
                    </>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Quarterly reports" />
        <CardBody>
          {props.reports.length === 0 ? (
            <p>No reports yet.</p>
          ) : (
            <ul>
              {props.reports.map((r) => (
                <li key={r.quarter}>
                  <strong>{r.quarter}</strong> — {r.activeMembers} active members;{" "}
                  {r.activities.join(", ") || "no activities"}
                  {r.obstacles ? `. Obstacles: ${r.obstacles}` : ""}{" "}
                  <span className="admin-table__sub">{r.submittedAt}</span>
                  {r.filledByCentre ? (
                    <>
                      {" "}
                      <Badge>Filled by centre</Badge>
                    </>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      <FormModal
        open={form === "officers"}
        title="Core officers"
        onClose={() => setForm(null)}
        onSubmit={(data) =>
          saveChapterOfficersAction({
            chapterId: props.chapter.id,
            officers: lines(text(data, "officers")).map((line) => {
              const [name = "", title = "", termEnd = ""] = line.split("|").map((p) => p.trim());
              return { name, title, termEnd: termEnd || null };
            }),
          })
        }
      >
        <Field
          label="Officers"
          name="officers"
          rows={6}
          hint="One per line: Name | Position | term end (yyyy-mm-dd, empty = unknown)."
          defaultValue={props.officers
            .map((o) => [o.name, o.title, o.termEnd ?? ""].join(" | "))
            .join("\n")}
        />
      </FormModal>

      <FormModal
        open={form === "report"}
        title="Quarterly report"
        submitLabel="Submit"
        onClose={() => setForm(null)}
        onSubmit={(data) =>
          submitChapterReportAction({
            chapterId: props.chapter.id,
            quarter: text(data, "quarter"),
            activeMembers: Number(text(data, "activeMembers")),
            activities: lines(text(data, "activities")),
            obstacles: text(data, "obstacles"),
          })
        }
      >
        <p className="admin-page-header__desc">
          Submitting again for the same quarter replaces that report.
        </p>
        <div className="admin-field">
          <label className="admin-field__label" htmlFor="field-quarter">
            Quarter
          </label>
          <Select id="field-quarter" name="quarter" className="admin-select">
            {props.quarters.map((q) => (
              <option key={q} value={q}>
                {q}
              </option>
            ))}
          </Select>
        </div>
        <Field label="Active members" name="activeMembers" type="number" min={0} required />
        <Field label="Activities held" name="activities" rows={4} hint="One per line." />
        <Field label="Obstacles" name="obstacles" rows={3} />
      </FormModal>
    </div>
  );
}
