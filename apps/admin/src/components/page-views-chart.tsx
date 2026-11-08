"use client";

import { useEffect, useRef, useState, type PointerEvent } from "react";
import { axisTicks, pointLabel } from "@/components/page-views-model";

/** Page views chart: round axis steps, dashed grid, line (daily) or bars (monthly, yearly). */
const H = 280;
const PAD = { top: 16, right: 32, bottom: 32, left: 56 };

export function ViewChart(props: {
  rows: { label: string; views: number }[];
  line: boolean;
  color: string;
}) {
  const { rows, line, color } = props;
  // Draw at the real width (1 unit = 1 px), so the text keeps the admin type size on any screen.
  const box = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(900);
  const [hover, setHover] = useState<number | null>(null);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setW(Math.max(280, Math.round(entry.contentRect.width)));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const ticks = axisTicks(Math.max(0, ...rows.map((r) => r.views)));
  const top = ticks.at(-1) ?? 1;
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const bottom = PAD.top + innerH;
  // A line runs edge to edge; bars sit in equal slots.
  const x = line
    ? (i: number) => PAD.left + (rows.length > 1 ? (innerW * i) / (rows.length - 1) : innerW / 2)
    : (i: number) => PAD.left + (innerW / rows.length) * (i + 0.5);
  const y = (v: number) => bottom - (v / top) * innerH;
  // One label per ~80 px, counted back from the latest point.
  const every = Math.ceil(rows.length / Math.max(2, Math.floor(innerW / 80)));
  const shown = rows.map((_, i) => (rows.length - 1 - i) % every === 0);
  const points = rows.map((r, i) => `${x(i)},${y(r.views)}`);
  // Hover: the point nearest the pointer across (the svg may be drawn narrower for a moment).
  const onMove = (event: PointerEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const at = ((event.clientX - rect.left) * W) / rect.width;
    let nearest = 0;
    rows.forEach((_, i) => {
      if (Math.abs(x(i) - at) < Math.abs(x(nearest) - at)) nearest = i;
    });
    setHover(rows.length > 0 ? nearest : null);
  };
  const hovered = hover === null ? undefined : rows[hover];
  return (
    <div ref={box} className="admin-views__plot">
      <svg
        onPointerMove={onMove}
        onPointerLeave={() => setHover(null)}
        viewBox={`0 0 ${W} ${H}`}
        width={W}
        height={H}
        role="img"
        aria-label={rows.map((r) => `${pointLabel(r.label)}: ${r.views}`).join(", ")}
        className="admin-views__chart"
      >
        {ticks.map((t) => (
          <g key={t}>
            <line
              x1={PAD.left}
              x2={W - PAD.right}
              y1={y(t)}
              y2={y(t)}
              className="admin-views__grid"
            />
            <text x={PAD.left - 8} y={y(t) + 4} textAnchor="end">
              {t.toLocaleString("en")}
            </text>
          </g>
        ))}
        {rows.map((r, i) =>
          shown[i] ? (
            <g key={r.label}>
              <line x1={x(i)} x2={x(i)} y1={PAD.top} y2={bottom} className="admin-views__grid" />
              <text x={x(i)} y={H - 10} textAnchor="middle">
                {pointLabel(r.label)}
              </text>
            </g>
          ) : null,
        )}
        <text
          x={14}
          y={PAD.top + innerH / 2}
          textAnchor="middle"
          transform={`rotate(-90 14 ${PAD.top + innerH / 2})`}
        >
          Views
        </text>
        <path
          d={`M${PAD.left},${PAD.top}V${bottom}H${W - PAD.right}`}
          className="admin-views__axis"
        />
        {hovered && hover !== null ? (
          <line
            x1={x(hover)}
            x2={x(hover)}
            y1={PAD.top}
            y2={bottom}
            className="admin-views__guide"
          />
        ) : null}
        {line ? (
          <>
            <polygon
              points={`${x(0)},${bottom} ${points.join(" ")} ${x(rows.length - 1)},${bottom}`}
              fill={color}
              opacity={0.15}
            />
            <polyline points={points.join(" ")} fill="none" stroke={color} strokeWidth={2.5} />
            {rows.map((r, i) => (
              <circle
                key={r.label}
                cx={x(i)}
                cy={y(r.views)}
                r={i === hover ? 5 : 3.5}
                fill={color}
              />
            ))}
          </>
        ) : (
          rows.map((r, i) => (
            <rect
              key={r.label}
              x={x(i) - (innerW / rows.length) * 0.35}
              width={(innerW / rows.length) * 0.7}
              y={y(r.views)}
              height={bottom - y(r.views)}
              rx={4}
              fill={color}
              opacity={hover === null || i === hover ? 1 : 0.6}
            />
          ))
        )}
      </svg>
      {hovered && hover !== null ? (
        <div
          className="admin-views__tip"
          aria-hidden="true"
          style={{
            left: x(hover),
            top: Math.min(y(hovered.views) + 16, bottom - 48),
            // Near the right edge the tip opens to the left of the point.
            translate: x(hover) > W - 160 ? "calc(-100% - 12px) 0" : "12px 0",
          }}
        >
          <div>{hovered.label}</div>
          <div>Views: {hovered.views.toLocaleString("en")}</div>
        </div>
      ) : null}
    </div>
  );
}
