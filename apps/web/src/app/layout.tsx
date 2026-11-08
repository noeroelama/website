import type { Metadata } from "next";
import { Poppins } from "next/font/google";
import type { ReactNode } from "react";
import "@website/ui/styles.css";
import "./globals.css";
import { PageViewTracker } from "@/components/page-view-tracker";
import { SiteFooter, SiteHeader } from "@/components/site-frame";
import { Localized } from "@/i18n/localized";

const poppins = Poppins({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-poppins",
});

export const metadata: Metadata = {
  title: { default: "PPIDK Asia-Oseania", template: "%s · PPIDK Asia-Oseania" },
  description: "Perhimpunan Pelajar Indonesia Dunia Kawasan Asia-Oseania",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="id" className={poppins.variable}>
      <body>
        <PageViewTracker />
        <Localized render={(t) => <SiteHeader t={t} />} />
        {children}
        <Localized render={(t) => <SiteFooter t={t} />} />
      </body>
    </html>
  );
}
