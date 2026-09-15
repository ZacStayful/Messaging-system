import { notFound } from "next/navigation";
import { isNav } from "@/lib/nav";
import { EmptyPane } from "@/components/conversation/EmptyPane";

export default async function NavPage({ params }: { params: Promise<{ nav: string }> }) {
  const { nav } = await params;
  if (!isNav(nav)) notFound();
  return <EmptyPane nav={nav} />;
}
