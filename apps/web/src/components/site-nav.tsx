"use client";

import { usePathname } from "next/navigation";
import { Suspense } from "react";

type Link = readonly [href: string, text: string];

/**
 * Header links; the current section gets aria-current="page" (shown bold). Pages with a dynamic
 * slug only know their path at request time, so the prerendered shell shows the links unmarked.
 */
export function SiteNav({ label, links }: { label: string; links: readonly Link[] }) {
  return (
    <nav aria-label={label}>
      <Suspense fallback={<NavList links={links} pathname="" />}>
        <CurrentNavList links={links} />
      </Suspense>
    </nav>
  );
}

function CurrentNavList({ links }: { links: readonly Link[] }) {
  return <NavList links={links} pathname={usePathname()} />;
}

function NavList({ links, pathname }: { links: readonly Link[]; pathname: string }) {
  return (
    <ul className="site-header__nav">
      {links.map(([href, text]) => {
        const current = pathname === href || pathname.startsWith(`${href}/`);
        return (
          <li key={href}>
            <a href={href} aria-current={current ? "page" : undefined}>
              {text}
            </a>
          </li>
        );
      })}
    </ul>
  );
}
