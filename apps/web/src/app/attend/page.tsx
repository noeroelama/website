import type { Metadata } from "next";
import { AttendPage } from "./attend-page";

export const metadata: Metadata = { title: "Presensi", robots: { index: false, follow: false } };
export const instant = false;

export default function Page() {
  return <AttendPage code="" />;
}
