import type { Metadata } from "next";
import { Poppins } from "next/font/google";
import type { ReactNode } from "react";
import "@website/ui/styles.css";
import "./globals.css";
import { SiteFooter, SiteHeader } from "@/components/site-frame";
import { Localized } from "@/i18n/localized";

// Self-hosted at build time by next/font; design tokens use it through --font-poppins.
const poppins = Poppins({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-poppins",
});

export const metadata: Metadata = {
  title: { default: "PPIDK Asia-Oseania", template: "%s · PPIDK Asia-Oseania" },
  description: "Perhimpunan Pelajar Indonesia Dunia Kawasan Asia-Oseania",
};

// Header and footer follow the visitor's language (Indonesian in the prerendered shell). The page
// segment ({children}) is always rendered, outside the language boundary.
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="id" className={poppins.variable}>
      <body>
        <Localized render={(t, language) => <SiteHeader t={t} language={language} />} />
        {children}
        <Localized render={(t) => <SiteFooter t={t} />} />
      </body>
    </html>
  );
}
