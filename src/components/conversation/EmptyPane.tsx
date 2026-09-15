import Image from "next/image";

const TITLES: Record<string, string> = {
  dms: "Pick a direct message",
  home: "Pick a conversation",
  activity: "Your activity",
  files: "Files",
  later: "Later",
  agents: "Agents & tools",
  you: "You",
};

export function EmptyPane({ nav }: { nav: string }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center text-muted">
      <Image src="/brand/stayful-logo.png" alt="" width={56} height={56} className="h-14 w-14 rounded-2xl opacity-80" />
      <div className="text-[16px] font-semibold text-ink">{TITLES[nav] ?? "Stayful"}</div>
      <p className="max-w-sm text-[14px]">Choose something from the list on the left to start reading and replying.</p>
    </div>
  );
}
