import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { isValidSlug } from "@website/domain/shared";
import { DICTIONARIES, LANG_COOKIE, languageFrom } from "@/i18n/dictionaries";
import { cityOf } from "@/lib/event-time";
import { publicAlbumBySlug } from "@/server/gallery";

export const instant = false;

const find = async (slug: string) => (isValidSlug(slug) ? publicAlbumBySlug(slug) : null);

export async function generateMetadata({
  params,
}: PageProps<"/gallery/[slug]">): Promise<Metadata> {
  const album = await find((await params).slug);
  if (!album) return {};
  return {
    title: album.eventTitle,
    openGraph: { title: album.eventTitle, images: album.cover ? [album.cover.url] : [] },
  };
}

function DriveLogo() {
  return (
    <svg className="site-album__drive-logo" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="currentColor"
        d="M12.01 1.485c-2.082 0-3.754.02-3.743.047.01.02 1.708 3.001 3.774 6.62l3.76 6.574h3.76c2.081 0 3.753-.02 3.742-.047-.005-.02-1.708-3.001-3.775-6.62l-3.76-6.574zm-4.76 1.73a789.828 789.861 0 0 0-3.63 6.319L0 15.868l1.89 3.298 1.885 3.297 3.62-6.335 3.618-6.33-1.88-3.287C8.1 4.704 7.255 3.22 7.25 3.214zm2.259 12.653-.203.348c-.114.198-.96 1.672-1.88 3.287a423.93 423.948 0 0 1-1.698 2.97c-.01.026 3.24.042 7.222.042h7.244l1.796-3.157c.992-1.734 1.85-3.23 1.906-3.323l.104-.167h-7.249z"
      />
    </svg>
  );
}

export default async function AlbumPage({ params }: PageProps<"/gallery/[slug]">) {
  const album = await find((await params).slug);
  if (!album) notFound();
  const t = DICTIONARIES[languageFrom((await cookies()).get(LANG_COOKIE)?.value)];
  const year = album.eventStartsAt ? String(album.eventStartsAt.getFullYear()) : null;
  const city = album.eventLocation ? cityOf(album.eventLocation) : null;
  const type = album.eventType ? t.events.types[album.eventType] : null;
  const photos = album.images;
  return (
    <main className="site-event site-album">
      {album.cover && (
        // eslint-disable-next-line @next/next/no-img-element -- Storage serves sized WebP
        <img
          className="site-event__banner"
          src={album.cover.url}
          width={album.cover.width}
          height={album.cover.height}
          alt=""
        />
      )}
      <div className="site-event__inner">
        <header className="site-event__head">
          <h1 className="site-event__title">{album.eventTitle}</h1>
          <div className="site-album__pills">
            {year && <span className="site-album__pill site-album__pill--white">{year}</span>}
            {city && <span className="site-album__pill">{city}</span>}
            {type && <span className="site-album__pill">{type}</span>}
          </div>
          <p className="site-album__brief">{t.gallery.brief}</p>
        </header>

        <hr className="site-album__divider" />

        {photos.length >= 3 ? (
          <div className="site-album__photos">
            {/* eslint-disable-next-line @next/next/no-img-element -- Storage serves sized WebP */}
            <img
              className="site-album__photo site-album__photo--wide"
              src={photos[0]!.url}
              width={photos[0]!.width}
              height={photos[0]!.height}
              alt=""
              loading="lazy"
            />
            <div className="site-album__stack">
              {photos.slice(1, 3).map((photo) => (
                // eslint-disable-next-line @next/next/no-img-element -- Storage serves sized WebP
                <img
                  className="site-album__photo"
                  src={photo.url}
                  width={photo.width}
                  height={photo.height}
                  alt=""
                  loading="lazy"
                  key={photo.url}
                />
              ))}
            </div>
          </div>
        ) : photos.length === 2 ? (
          <div className="site-album__photos site-album__photos--pair">
            {photos.map((photo) => (
              // eslint-disable-next-line @next/next/no-img-element -- Storage serves sized WebP
              <img
                className="site-album__photo"
                src={photo.url}
                width={photo.width}
                height={photo.height}
                alt=""
                loading="lazy"
                key={photo.url}
              />
            ))}
          </div>
        ) : photos.length === 1 ? (
          <div className="site-album__photos site-album__photos--single">
            {/* eslint-disable-next-line @next/next/no-img-element -- Storage serves sized WebP */}
            <img
              className="site-album__photo"
              src={photos[0]!.url}
              width={photos[0]!.width}
              height={photos[0]!.height}
              alt=""
              loading="lazy"
            />
          </div>
        ) : null}

        <div className="site-album__actions">
          <a
            className="site-album__drive"
            href={album.albumUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            <DriveLogo />
            {t.gallery.viewAlbum}
          </a>
        </div>
      </div>
    </main>
  );
}
