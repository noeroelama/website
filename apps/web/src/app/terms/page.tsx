import type { Metadata } from "next";
import { LegalPage } from "@/components/site-frame";
import { Localized } from "@/i18n/localized";

export const metadata: Metadata = { title: "Syarat dan Ketentuan · Terms" };

export default function TermsPage() {
  return <Localized render={(t) => <LegalPage {...t.terms} />} />;
}
