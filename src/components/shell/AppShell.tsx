"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useStore } from "./store";
import { TopBar } from "./TopBar";
import { Rail } from "./Rail";
import { MobileTabBar } from "./MobileTabBar";
import { NewMessageModal } from "./NewMessageModal";
import { DmList } from "@/components/sidebar/DmList";
import { HomeSidebar } from "@/components/sidebar/HomeSidebar";
import { ActivityList } from "@/components/sidebar/ActivityList";
import { LaterSidebar } from "@/components/sidebar/LaterSidebar";
import { FilesSidebar } from "@/components/sidebar/FilesSidebar";
import { YouSidebar } from "@/components/sidebar/YouSidebar";
import { CustomerSidebar } from "@/components/sidebar/CustomerSidebar";
import { ProfileCardHost } from "@/components/people/ProfileCard";
import { QuickSwitcher } from "./QuickSwitcher";
import { liveConversations } from "./store";

/**
 * Desktop: 44px top bar, 72px rail, sidebar + conversation pane on the green frame.
 * Mobile (< md): a single pane; list with a bottom tab bar, or the conversation with a back button.
 * Customers get a simplified shell: their groups and direct messages only.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const { nav, activeConversationId, isPage, newMessage, closeNewMessage, isCustomer, conversations, markRead } =
    useStore();
  const router = useRouter();
  const [switcher, setSwitcher] = useState(false);
  const showMain = !!activeConversationId || isPage;

  // Global shortcuts: Ctrl/Cmd+K jump, Alt+↑/↓ previous/next conversation, Shift+Esc mark all read.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSwitcher((v) => !v);
        return;
      }
      if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
        const dmNav = nav === "dms";
        const list = liveConversations(conversations)
          .filter((c) => (dmNav ? c.type === "dm" || c.type === "group_dm" : true))
          .sort((a, b) => (b.last_message_at ?? "").localeCompare(a.last_message_at ?? ""));
        if (!list.length) return;
        e.preventDefault();
        const idx = list.findIndex((c) => c.id === activeConversationId);
        const next = list[(idx + (e.key === "ArrowDown" ? 1 : -1) + list.length) % list.length];
        router.push(`/${nav === "home" || nav === "dms" ? nav : "home"}/${next.id}`);
        return;
      }
      if (e.shiftKey && e.key === "Escape") {
        e.preventDefault();
        for (const c of conversations) if (c.unread_count > 0) void markRead(c.id);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [nav, conversations, activeConversationId, router, markRead]);
  const wide = nav === "dms" || nav === "activity";

  const sidebar = isCustomer ? (
    nav === "you" ? (
      <YouSidebar />
    ) : (
      <CustomerSidebar />
    )
  ) : nav === "dms" ? (
    <DmList />
  ) : nav === "home" ? (
    <HomeSidebar />
  ) : nav === "activity" ? (
    <ActivityList />
  ) : nav === "you" ? (
    <YouSidebar />
  ) : nav === "later" ? (
    <LaterSidebar />
  ) : (
    <FilesSidebar />
  );

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-frame text-ink">
      <TopBar />
      <div className="flex min-h-0 flex-1">
        <Rail />
        <div className="flex min-h-0 min-w-0 flex-1 md:gap-1 md:pr-1 md:pb-1">
          <aside
            className={`${showMain ? "hidden md:flex" : "flex"} min-h-0 w-full shrink-0 flex-col bg-sb text-sb-text md:rounded-l-lg ${wide && !isCustomer ? "md:w-[380px]" : "md:w-[320px]"}`}
          >
            {sidebar}
          </aside>
          <main
            className={`${showMain ? "flex" : "hidden md:flex"} relative min-h-0 min-w-0 flex-1 flex-col bg-panel text-ink md:rounded-r-lg`}
          >
            {children}
          </main>
        </div>
      </div>
      {!showMain && <MobileTabBar />}
      {newMessage && <NewMessageModal mode={newMessage} onClose={closeNewMessage} />}
      <ProfileCardHost />
      {switcher && <QuickSwitcher onClose={() => setSwitcher(false)} />}
    </div>
  );
}
