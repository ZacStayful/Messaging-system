"use client";

import { useState, type MouseEvent } from "react";
import { useStore, type NotifyLevel } from "@/components/shell/store";
import { Menu, type MenuItem } from "@/components/ui/Menu";
import { Icon } from "@/components/ui/Icon";
import { NOTIFY_LABELS } from "@/components/conversation/Header";

export interface RowMenuState {
  id: string;
  x: number;
  y: number;
}

/** Right-click or "⋯" state for one sidebar list. */
export function useConversationMenu() {
  const [menu, setMenu] = useState<RowMenuState | null>(null);
  const openAt = (id: string) => (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setMenu({ id, x: e.clientX, y: e.clientY });
  };
  const openFrom = (id: string) => (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setMenu({ id, x: r.left, y: r.bottom });
  };
  return { menu, openAt, openFrom, close: () => setMenu(null) };
}

/** The "⋯" that appears when hovering a sidebar row (desktop). */
export function RowMenuButton({ onOpen, name }: { onOpen: (e: MouseEvent) => void; name: string }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="hidden h-6 w-6 shrink-0 items-center justify-center rounded-md border-0 bg-transparent text-current opacity-0 group-hover:opacity-100 hover:bg-sb-hover focus:opacity-100 md:flex"
      aria-label={`Options for ${name}`}
      title="More options"
    >
      <Icon name="more" size={16} strokeWidth={2.6} />
    </button>
  );
}

/** Slack-style conversation context menu anchored at a screen position. */
export function ConversationMenu({ menu, onClose }: { menu: RowMenuState | null; onClose: () => void }) {
  const {
    isTeam,
    conversationById,
    conversationName,
    markRead,
    toggleStar,
    toggleMute,
    setNotifyLevel,
    leaveConversation,
    setArchived,
    nav,
    sections,
    sectionOf,
    moveToSection,
  } = useStore();
  const [view, setView] = useState<"main" | "notify" | "section">("main");
  const c = menu ? conversationById(menu.id) : undefined;
  if (!menu || !c) return null;

  const isDm = c.type === "dm" || c.type === "group_dm";
  const isChannel = !isDm;
  const level = (c.notify_level as NotifyLevel) || "all";
  const href = `${window.location.origin}/${isDm ? "dms" : nav === "dms" ? "dms" : "home"}/${c.id}`;

  const close = () => {
    setView("main");
    onClose();
  };

  const main: (MenuItem | "divider")[] = [];
  if (c.unread_count > 0 || c.mention_count > 0) {
    main.push({ id: "read", label: "Mark as read", icon: "check", onSelect: () => void markRead(c.id) });
  }
  main.push({
    id: "star",
    label: c.starred ? "Remove from starred" : "Star",
    icon: "star",
    onSelect: () => void toggleStar(c.id),
  });
  main.push({
    id: "mute",
    label: c.muted ? "Unmute" : "Mute",
    icon: c.muted ? "bell" : "bellOff",
    onSelect: () => void toggleMute(c.id),
  });
  main.push({
    id: "notify",
    label: "Notification preferences",
    icon: "bell",
    hint: NOTIFY_LABELS[level],
    keepOpen: true,
    onSelect: () => setView("notify"),
  });
  // Dragging a row into a section is mouse-only, and the Home sidebar is the mobile sidebar too —
  // so this submenu is the way the feature exists at all on a phone, and by keyboard. Hidden until
  // there is a section to move into; they are made from "New section" in the Home sidebar, which
  // is reachable on a phone too.
  if (isTeam && isChannel && sections.length > 0) {
    main.push({
      id: "section",
      label: "Move to section",
      icon: "files",
      hint: sections.find((s) => s.id === sectionOf(c.id))?.name ?? "None",
      keepOpen: true,
      onSelect: () => setView("section"),
    });
  }
  main.push({
    id: "copy",
    label: "Copy link",
    icon: "link",
    onSelect: () => void navigator.clipboard?.writeText(href),
  });
  if (isTeam && c.type !== "dm") {
    main.push("divider");
    main.push({
      id: "leave",
      label: isChannel ? "Leave group" : "Leave group message",
      icon: "logout",
      onSelect: () => void leaveConversation(c.id),
    });
    if (isChannel) {
      main.push({
        id: "archive",
        label: c.archived_at ? "Un-archive group" : "Archive group",
        icon: "files",
        danger: !c.archived_at,
        onSelect: () => void setArchived(c.id, !c.archived_at),
      });
    }
  }

  const notify: (MenuItem | "divider")[] = [
    ...(["all", "mentions", "none"] as NotifyLevel[]).map((l) => ({
      id: l,
      label: NOTIFY_LABELS[l],
      checked: level === l,
      onSelect: () => void setNotifyLevel(c.id, l),
    })),
    "divider",
    {
      id: "back",
      label: "Back",
      icon: "back",
      keepOpen: true,
      onSelect: () => setView("main"),
    },
  ];

  const currentSection = sectionOf(c.id);
  const section: (MenuItem | "divider")[] = [
    ...sections.map((s) => ({
      id: s.id,
      label: s.name,
      checked: currentSection === s.id,
      onSelect: () => void moveToSection(c.id, s.id),
    })),
    "divider",
    {
      id: "none",
      label: "None",
      checked: currentSection === null,
      onSelect: () => void moveToSection(c.id, null),
    },
    "divider",
    {
      id: "back",
      label: "Back",
      icon: "back",
      keepOpen: true,
      onSelect: () => setView("main"),
    },
  ];

  const width = 260;
  const left = Math.max(8, Math.min(menu.x, window.innerWidth - width - 8));
  const below = menu.y < window.innerHeight - 380;

  return (
    <div className="fixed z-40" style={{ left, top: menu.y }}>
      <Menu
        label={`Options for ${conversationName(c)}`}
        header={view === "notify" ? "Notify me about" : view === "section" ? "Move to section" : conversationName(c)}
        items={view === "notify" ? notify : view === "section" ? section : main}
        onClose={close}
        align="left"
        below={below}
      />
    </div>
  );
}
