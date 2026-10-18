import type { Metadata } from "next";
import { cookies } from "next/headers";
import { Suspense } from "react";
import { AlbumCards } from "@/components/album-cards";
import { DICTIONARIES, LANG_COOKIE, languageFrom } from "@/i18n/dictionaries";
import { Localized } from "@/i18n/localized";
import { publicAlbums } from "@/server/gallery";

export const metadata: Metadata = { title: "Gallery" };

// Static shell (title); the album list streams in (cached albums + language cookie).
export default function GalleryPage() {
  return (
    <main className="ui-shell">
      <Localized render={(t) => <h1 className="ui-shell-title">{t.pages.gallery}</h1>} />
      <Suspense fallback={null}>
        <AlbumList />
      </Suspense>
    </main>
  );
}

async function AlbumList() {
  const t = DICTIONARIES[languageFrom((await cookies()).get(LANG_COOKIE)?.value)];
  const albums = await publicAlbums();
  return albums.length === 0 ? <p>{t.gallery.empty}</p> : <AlbumCards items={albums} t={t} />;
}
