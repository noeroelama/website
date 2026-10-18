"use client";

import { useRef, useState } from "react";

type Photo = { url: string; thumbUrl: string; width: number; height: number };

/** Featured photos as a grid; a click opens a native <dialog> lightbox (no library). */
export function Lightbox(props: {
  photos: readonly Photo[];
  labels: { close: string; previous: string; next: string; open: string };
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [index, setIndex] = useState(0);
  const count = props.photos.length;
  const current = props.photos[index];
  const show = (i: number) => {
    setIndex((i + count) % count);
    if (!dialog.current?.open) dialog.current?.showModal();
  };

  return (
    <>
      <ul className="site-cards">
        {props.photos.map((photo, i) => (
          <li key={photo.url}>
            <button
              type="button"
              className="site-photo"
              aria-label={`${props.labels.open} ${i + 1}`}
              onClick={() => show(i)}
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- Storage thumbnail (WebP) */}
              <img className="site-card__image" src={photo.thumbUrl} alt="" loading="lazy" />
            </button>
          </li>
        ))}
      </ul>
      <dialog
        ref={dialog}
        className="site-lightbox"
        onKeyDown={(e) => {
          if (e.key === "ArrowLeft") show(index - 1);
          if (e.key === "ArrowRight") show(index + 1);
        }}
      >
        {current && (
          // eslint-disable-next-line @next/next/no-img-element -- Storage WebP (≤ 2400 px)
          <img
            className="site-lightbox__image"
            src={current.url}
            width={current.width}
            height={current.height}
            alt=""
          />
        )}
        <p className="site-pager">
          <button type="button" className="ui-button" onClick={() => show(index - 1)}>
            {props.labels.previous}
          </button>
          <span>
            {index + 1} / {count}
          </span>
          <button type="button" className="ui-button" onClick={() => show(index + 1)}>
            {props.labels.next}
          </button>
          <button type="button" className="ui-button" onClick={() => dialog.current?.close()}>
            {props.labels.close}
          </button>
        </p>
      </dialog>
    </>
  );
}
