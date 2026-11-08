"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Select } from "./ui/select";

type Choice = { value: string; label: string; href: string };

/** Page views card header: page dropdown, then the Daily / Monthly / Yearly switch (links). */
export function PageViewsControls(props: {
  pages: Choice[];
  page: string;
  periods: Choice[];
  period: string;
}) {
  const router = useRouter();
  return (
    <>
      <Select
        aria-label="Page"
        className="admin-select"
        value={props.page}
        onChange={(e) => {
          const to = props.pages.find((p) => p.value === e.target.value);
          if (to) router.push(to.href);
        }}
      >
        {props.pages.map((p) => (
          <option key={p.value} value={p.value}>
            {p.label}
          </option>
        ))}
      </Select>
      <div role="group" aria-label="Period" className="admin-segmented">
        {props.periods.map((p) => (
          <Link
            key={p.value}
            href={p.href}
            className="admin-segmented__item"
            aria-current={p.value === props.period ? "page" : undefined}
          >
            {p.label}
          </Link>
        ))}
      </div>
    </>
  );
}
