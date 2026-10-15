import type { StatCardProps } from "@/components/ui/badge";

/**
 * Dashboard KPI cards. Static mock until the Firebase-backed phase; the same numbers/concepts
 * as the earlier Vite admin. `href`s point at their admin pages (same origin).
 */
export const dashboardStats: StatCardProps[] = [
  {
    label: "Tools",
    value: "50",
    trend: "Short links",
    trendDir: "up",
    icon: "tools",
    href: "/tools",
  },
  {
    label: "Events",
    value: "6",
    trend: "2 upcoming",
    trendDir: "up",
    icon: "event",
    href: "/events",
  },
  {
    label: "Gallery",
    value: "6",
    trend: "+18 this week",
    trendDir: "up",
    icon: "gallery",
    href: "/gallery",
  },
  {
    label: "Articles",
    value: "7",
    trend: "+4 this week",
    trendDir: "up",
    icon: "article",
    href: "/articles",
  },
  {
    label: "Newsletter",
    value: "5",
    trend: "+2 this month",
    trendDir: "up",
    icon: "newsletter",
    href: "/newsletter",
  },
  {
    label: "Organizations",
    value: "12",
    trend: "Active members",
    trendDir: "up",
    icon: "organizations",
    href: "/organizations",
  },
  {
    label: "Audit Log",
    value: "18",
    trend: "Latest entries",
    trendDir: "up",
    icon: "audit",
    href: "/audit",
  },
];
