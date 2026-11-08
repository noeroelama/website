import type { Metadata } from "next";
import { AttendPage } from "../attend-page";

export const metadata: Metadata = { title: "Presensi", robots: { index: false, follow: false } };
export const instant = false;

export default async function Page({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  return <AttendPage code={code.slice(0, 12)} />;
}
