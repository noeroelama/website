import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { formatNewsDate } from "@website/domain/content";
import { sanitizeRichText } from "@website/security/html";
import { ArticleView } from "@website/ui";
import { DICTIONARIES, LANG_COOKIE, languageFrom } from "@/i18n/dictionaries";
import { newsletter } from "@/server/newsletter-wiring";

// Public archive of a campaign that went out (admin "Copy Link"). Not cached: a campaign deleted
// in admin disappears at once. Unknown, draft or deleted id → the 404 page.
export const instant = false;

const find = async (params: PageProps<"/newsletter/[id]">["params"]) => {
  await connection(); // read per request, never prerendered at build
  return newsletter().publicCampaign((await params).id);
};

export async function generateMetadata({
  params,
}: PageProps<"/newsletter/[id]">): Promise<Metadata> {
  const campaign = await find(params);
  return campaign ? { title: campaign.subject } : {};
}

export default async function NewsletterArchivePage({ params }: PageProps<"/newsletter/[id]">) {
  const campaign = await find(params);
  if (!campaign) notFound();
  const language = languageFrom((await cookies()).get(LANG_COOKIE)?.value);
  return (
    <ArticleView
      title={campaign.subject}
      author="PPIDK Asia-Oseania"
      date={formatNewsDate(campaign.sentAt ?? campaign.sendAt ?? campaign.updatedAt, language)}
      category={DICTIONARIES[language].newsletter.label}
      image={null}
      safeHtml={sanitizeRichText(campaign.body)}
      tags={[]}
    />
  );
}
