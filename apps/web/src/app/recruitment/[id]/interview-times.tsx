"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Dictionary, Language } from "@/i18n/dictionaries";
import { formatEventTime } from "@/lib/event-time";
import { bookInterviewAction } from "./actions";

export function InterviewTimes(props: {
  recruitmentId: string;
  zone: string;
  language: Language;
  current: string | null;
  times: { id: string; startsAt: string; minutes: number }[];
  location: string;
  labels: Dictionary["recruitment"];
}) {
  const router = useRouter();
  const t = props.labels;
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const show = (iso: string) => formatEventTime(new Date(iso), props.zone, props.language);

  const book = async (slotId: string) => {
    setBusy(true);
    const result = await bookInterviewAction({ recruitmentId: props.recruitmentId, slotId });
    setBusy(false);
    setMessage(
      result.ok ? t.booked : result.error === "refused" ? (result.message ?? t.failed) : t.failed,
    );
    if (result.ok) router.refresh();
  };

  return (
    <div className="ui-form site-form">
      {props.current && (
        <p className="site-notice">
          {t.yourInterview}: <strong>{show(props.current)}</strong> ({props.zone})
          {props.location && (
            <>
              <br />
              {props.location}
            </>
          )}
        </p>
      )}
      <h3>{t.interviewTimes}</h3>
      <p className="site-muted">
        {t.timesIn}: {props.zone}
      </p>
      {props.times.length === 0 ? (
        <p className="site-muted">{t.noTimes}</p>
      ) : (
        <ul className="site-choices">
          {props.times.map((s) => (
            <li key={s.id} className="site-choice">
              {show(s.startsAt)} · {s.minutes} min{" "}
              <button
                className="ui-button"
                type="button"
                disabled={busy}
                onClick={() => void book(s.id)}
              >
                {props.current ? t.move : t.book}
              </button>
            </li>
          ))}
        </ul>
      )}
      {message && (
        <p role="status" className="ui-message">
          {message}
        </p>
      )}
    </div>
  );
}
