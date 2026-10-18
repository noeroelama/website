import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { isValidSlug } from "@website/domain/shared";
import { DICTIONARIES, LANG_COOKIE, languageFrom } from "@/i18n/dictionaries";
import { publicAlbumBySlug } from "@/server/gallery";
import { Lightbox } from "./lightbox";

// Unknown, draft or deleted album → the 404 page (a soft 404 while streaming; see /news/[slug]).
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

export default async function AlbumPage({ params }: PageProps<"/gallery/[slug]">) {
  const album = await find((await params).slug);
  if (!album) notFound();
  const t = DICTIONARIES[languageFrom((await cookies()).get(LANG_COOKIE)?.value)].gallery;
  return (
    <main className="ui-shell">
      <h1 className="ui-shell-title">{album.eventTitle}</h1>
      <p className="site-muted">
        {album.photoCount} {t.photos}
      </p>
      <Lightbox
        photos={album.images}
        labels={{ close: t.close, previous: t.previous, next: t.next, open: t.open }}
      />
      <a className="ui-button" href={album.albumUrl} target="_blank" rel="noopener noreferrer">
        {t.seeAll}
      </a>
    </main>
  );
}
