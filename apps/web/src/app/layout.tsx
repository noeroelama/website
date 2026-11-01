import type { Metadata } from "next";
import { Crimson_Pro, Inter, Poppins } from "next/font/google";
import type { ReactNode } from "react";
import "@website/ui/styles.css";
import "./globals.css";
import { SiteFooter, SiteHeader } from "@/components/site-frame";
import { Localized } from "@/i18n/localized";

// Self-hosted at build time by next/font; design tokens use them through --font-poppins and,
// on the home page, --font-inter (body copy) and --font-crimson (chair's welcome quote).
const poppins = Poppins({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-poppins",
});

const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-inter",
});

const crimsonPro = Crimson_Pro({
  subsets: ["latin"],
  weight: ["400"],
  variable: "--font-crimson",
});

export const metadata: Metadata = {
  title: { default: "PPIDK Asia-Oseania", template: "%s · PPIDK Asia-Oseania" },
  description: "Perhimpunan Pelajar Indonesia Dunia Kawasan Asia-Oseania",
};

// Header and footer follow the visitor's language (Indonesian in the prerendered shell). The page
// segment ({children}) is always rendered, outside the language boundary.
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="id" className={`${poppins.variable} ${inter.variable} ${crimsonPro.variable}`}>
      <body>
        <Localized render={(t) => <SiteHeader t={t} />} />
        {children}
        <Localized render={(t) => <SiteFooter t={t} />} />
      </body>
    </html>
  );
}
