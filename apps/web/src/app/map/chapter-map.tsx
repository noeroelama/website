"use client";

import { useState, type ReactNode } from "react";

/**
 * The Asia–Oceania dot map with one marker per active chapter (positions in percent, so they
 * stay on their country at any width). Selecting a marker shows that chapter's card (rendered
 * on the server and passed in).
 */
export function ChapterMap(props: {
  label: string;
  closeLabel: string;
  markers: readonly { slug: string; name: string; x: number; y: number; card: ReactNode }[];
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const current = props.markers.find((m) => m.slug === selected);
  return (
    <div className="site-map">
      <div className="site-map__box" role="group" aria-label={props.label}>
        {/* eslint-disable-next-line @next/next/no-img-element -- static SVG asset */}
        <img className="site-map__image" src="/map/asia-oceania.svg" alt="" />
        {props.markers.map((m) => (
          <button
            key={m.slug}
            type="button"
            className="site-map__marker"
            style={{ left: `${m.x}%`, top: `${m.y}%` }}
            aria-label={m.name}
            aria-pressed={selected === m.slug}
            onClick={() => setSelected(selected === m.slug ? null : m.slug)}
          />
        ))}
      </div>
      {current && (
        <div className="site-map__card" role="status">
          {current.card}
          <button type="button" className="ui-button" onClick={() => setSelected(null)}>
            {props.closeLabel}
          </button>
        </div>
      )}
    </div>
  );
}
