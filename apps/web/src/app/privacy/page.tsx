import type { Metadata } from "next";
import { LegalPage } from "@/components/site-frame";
import { Localized } from "@/i18n/localized";

export const metadata: Metadata = { title: "Kebijakan Privasi · Privacy" };

export default function PrivacyPage() {
  return <Localized render={(t) => <LegalPage {...t.privacy} />} />;
}
