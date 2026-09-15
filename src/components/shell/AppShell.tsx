"use client";

import type { ReactNode } from "react";
import { useStore } from "./store";
import { TopBar } from "./TopBar";
import { Rail } from "./Rail";
import { MobileTabBar } from "./MobileTabBar";
import { DmList } from "@/components/sidebar/DmList";
import { HomeSidebar } from "@/components/sidebar/HomeSidebar";
import { ActivityList } from "@/components/sidebar/ActivityList";
import { PlaceholderSidebar } from "@/components/sidebar/PlaceholderSidebar";
import { YouSidebar } from "@/components/sidebar/YouSidebar";

/**
 * Desktop: 44px top bar, 72px rail, sidebar + conversation pane on the green frame.
 * Mobile (< md): a single pane; list with a bottom tab bar, or the conversation with a back button.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const { nav, activeConversationId } = useStore();
  const hasConversation = !!activeConversationId;
  const wide = nav === "dms" || nav === "activity";

  const sidebar =
    nav === "dms" ? (
      <DmList />
    ) : nav === "home" ? (
      <HomeSidebar />
    ) : nav === "activity" ? (
      <ActivityList />
    ) : nav === "you" ? (
      <YouSidebar />
    ) : (
      <PlaceholderSidebar nav={nav} />
    );

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-frame text-ink">
      <TopBar />
      <div className="flex min-h-0 flex-1">
        <Rail />
        <div className="flex min-h-0 min-w-0 flex-1 md:gap-1 md:pr-1 md:pb-1">
          <aside
            className={`${hasConversation ? "hidden md:flex" : "flex"} min-h-0 w-full shrink-0 flex-col bg-sb text-sb-text md:rounded-l-lg ${wide ? "md:w-[380px]" : "md:w-[300px]"}`}
          >
            {sidebar}
          </aside>
          <main
            className={`${hasConversation ? "flex" : "hidden md:flex"} relative min-h-0 min-w-0 flex-1 flex-col bg-panel text-ink md:rounded-r-lg`}
          >
            {children}
          </main>
        </div>
      </div>
      {!hasConversation && <MobileTabBar />}
    </div>
  );
}
