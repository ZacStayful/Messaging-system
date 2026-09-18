"use client";

import Link from "next/link";
import { useMemo, useRef, useState, type DragEvent, type KeyboardEvent, type MouseEvent } from "react";
import { useStore, liveConversations } from "@/components/shell/store";
import type { ConversationSummary, SidebarSection } from "@/lib/database.types";
import { Avatar } from "@/components/ui/Avatar";
import { PresenceDot } from "@/components/ui/PresenceDot";
import { UnreadBadge } from "@/components/ui/UnreadBadge";
import { Icon } from "@/components/ui/Icon";
import { Menu } from "@/components/ui/Menu";
import { presenceLook } from "@/lib/presence";
import { useBoolPref, usePref } from "@/lib/prefs";
import { partitionBySection } from "@/lib/sections";
import { LEAD_CATEGORIES, LEAD_CATEGORY_KEYS } from "@/lib/leadCategories";
import { SearchLink, SectionHeader, SidebarHeader, SidebarSearch, iconBtn } from "./SidebarBits";
import { ThreadsRow } from "./ThreadsRow";
import { PeopleRow } from "./PeopleRow";
import { ConversationMenu, RowMenuButton, useConversationMenu } from "./ConversationMenu";

/**
 * What a dragged sidebar row carries.
 *
 * A custom type rather than the plain text or URL an anchor drags by default, for two reasons: the
 * file drop zones in Composer and ConversationView both guard on "Files", so a row dragged over the
 * message pane is ignored rather than misread as an attachment; and text or a link dragged in from
 * another window cannot land in a section.
 */
const DRAG_TYPE = "application/x-stayful-conversation";

/** Not a section id, so it can key the drag-over highlight for "no section" without colliding. */
const UNFILED = "unfiled";

function byUnreadThenName(a: ConversationSummary, b: ConversationSummary) {
  const au = a.unread_count > 0 && !a.muted ? 0 : 1;
  const bu = b.unread_count > 0 && !b.muted ? 0 : 1;
  return au - bu || (a.name ?? "").localeCompare(b.name ?? "");
}

export function HomeSidebar() {
  const {
    conversations,
    org,
    me,
    isAdmin,
    otherMember,
    conversationName,
    presenceOf,
    activeConversationId,
    openNewMessage,
    sections,
    sectionOf,
    moveToSection,
    createSection,
    renameSection,
    deleteSection,
  } = useStore();
  const [filter, setFilter] = useState("");
  const [showArchived, setShowArchived] = useBoolPref("home.showArchived", false);
  const [customersCollapsed, setCustomersCollapsed] = useBoolPref("home.customers.collapsed", false);
  const [leadsCollapsed, setLeadsCollapsed] = useBoolPref("home.leads.collapsed", false);
  // One pref per category; hooks cannot sit in a loop, and there are exactly two.
  const [managementCollapsed, setManagementCollapsed] = useBoolPref("home.leads.airbnb_management.collapsed", false);
  const [r2rCollapsed, setR2rCollapsed] = useBoolPref("home.leads.r2r.collapsed", false);
  const leadPrefs = {
    airbnb_management: [managementCollapsed, setManagementCollapsed] as const,
    r2r: [r2rCollapsed, setR2rCollapsed] as const,
  };
  const [channelsCollapsed, setChannelsCollapsed] = useBoolPref("home.channels.collapsed", false);
  const [dmsCollapsed, setDmsCollapsed] = useBoolPref("home.dms.collapsed", false);
  const [starredCollapsed, setStarredCollapsed] = useBoolPref("home.starred.collapsed", false);
  // Custom sections come and go, and hooks cannot sit in a loop, so their collapsed state is one
  // preference holding a set of ids rather than a useBoolPref each.
  const [collapsedIds, setCollapsedIds] = usePref("home.sections.collapsed", "");
  const rowMenu = useConversationMenu();
  const q = filter.trim().toLowerCase();

  const collapsedSections = useMemo(() => new Set(collapsedIds.split(",").filter(Boolean)), [collapsedIds]);
  const toggleSectionCollapsed = (id: string) => {
    const next = new Set(collapsedSections);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setCollapsedIds([...next].join(","));
  };

  const live = useMemo(() => liveConversations(conversations, showArchived), [conversations, showArchived]);
  const archivedCount = conversations.filter((c) => c.archived_at).length;
  // Starred stays on top and wins over a section; everything filed leaves the computed lists below,
  // so nothing appears twice. See src/lib/sections.ts for why.
  const { starred, filed, rest } = useMemo(
    () => partitionBySection(live, sections, sectionOf),
    [live, sections, sectionOf],
  );
  const customers = useMemo(
    () => rest.filter((c) => (c.type === "owner" || c.type === "job") && !c.lead_category).sort(byUnreadThenName),
    [rest],
  );
  // Lead-database customers: on file, not yet invited, filed apart so the Customers list stays
  // the list of people actually using the app.
  const leads = useMemo(
    () => rest.filter((c) => c.type === "owner" && !!c.lead_category).sort(byUnreadThenName),
    [rest],
  );
  const channels = useMemo(() => rest.filter((c) => c.type === "internal").sort(byUnreadThenName), [rest]);
  const dms = useMemo(() => rest.filter((c) => c.type === "dm" || c.type === "group_dm").slice(0, 8), [rest]);

  // ---- drag and drop --------------------------------------------------------
  const [dragOver, setDragOver] = useState<string | null>(null);
  // A drag that ends on a link still delivers a click in some browsers, which would navigate to
  // the group that was just dropped. The row's onClick checks this.
  const dragging = useRef(false);

  const dragProps = (c: ConversationSummary) => ({
    draggable: true,
    onDragStart: (e: DragEvent) => {
      dragging.current = true;
      e.dataTransfer.setData(DRAG_TYPE, c.id);
      e.dataTransfer.effectAllowed = "move";
    },
    onDragEnd: () => {
      setDragOver(null);
      window.setTimeout(() => {
        dragging.current = false;
      }, 0);
    },
    onClick: (e: MouseEvent<HTMLAnchorElement>) => {
      if (dragging.current) e.preventDefault();
    },
  });

  /** Drop-target props for a block that files into `sectionId` (null takes the group back out). */
  const dropProps = (key: string, sectionId: string | null) => ({
    onDragOver: (e: DragEvent) => {
      if (!e.dataTransfer.types.includes(DRAG_TYPE)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      setDragOver(key);
    },
    onDragLeave: (e: DragEvent) => {
      // Moving onto a child is not leaving the block.
      if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
      setDragOver((current) => (current === key ? null : current));
    },
    onDrop: (e: DragEvent) => {
      if (!e.dataTransfer.types.includes(DRAG_TYPE)) return;
      e.preventDefault();
      setDragOver(null);
      const id = e.dataTransfer.getData(DRAG_TYPE);
      if (id && sectionOf(id) !== sectionId) void moveToSection(id, sectionId);
    },
  });

  // The mint the sidebar already uses for the selected row, so "it will land here" reads the same
  // way as "this is the one you are on".
  const dropRing = (key: string) =>
    dragOver === key ? "rounded-lg bg-sb-hover outline-2 outline-offset-[-2px] outline-dashed outline-sb-sel" : "";

  // ---- making and editing sections ------------------------------------------
  const [creating, setCreating] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [renaming, setRenaming] = useState<string | null>(null);
  const [menuFor, setMenuFor] = useState<string | null>(null);

  const submitNew = async () => {
    const name = draftName.trim();
    setCreating(false);
    setDraftName("");
    if (name) await createSection(name);
  };

  const submitRename = async (section: SidebarSection) => {
    const name = draftName.trim();
    setRenaming(null);
    setDraftName("");
    if (name && name !== section.name) await renameSection(section.id, name);
  };

  const onNameKey = (e: KeyboardEvent<HTMLInputElement>, submit: () => void) => {
    if (e.key === "Enter") submit();
    if (e.key === "Escape") {
      setCreating(false);
      setRenaming(null);
      setDraftName("");
    }
  };

  const nameInput =
    "w-full rounded-md border border-sb-border bg-sb-input px-2 py-1 text-[15px] text-sb-text outline-none";

  const sel = (id: string) =>
    activeConversationId === id ? { background: "var(--sb-sel)", color: "var(--sb-sel-text)" } : undefined;
  const matches = (c: ConversationSummary) => !q || conversationName(c).toLowerCase().includes(q);

  const channelRow = (c: ConversationSummary) => {
    const unread = c.unread_count > 0 && !c.muted;
    const active = activeConversationId === c.id;
    return (
      <Link
        key={c.id}
        href={`/home/${c.id}`}
        className="sb-row group text-sb-text no-underline flex h-8 items-center gap-2 rounded-md pr-1 pl-3 md:h-8"
        style={{ ...sel(c.id), opacity: c.muted || c.archived_at ? 0.6 : unread || active ? 1 : 0.88 }}
        aria-current={active ? "page" : undefined}
        onContextMenu={rowMenu.openAt(c.id)}
        {...dragProps(c)}
      >
        <Icon name={c.archived_at ? "files" : "lock"} size={15} strokeWidth={2} />
        <span className="flex-1 truncate text-[16px]" style={{ fontWeight: unread ? 700 : 500 }}>
          {c.name}
        </span>
        {c.mention_count > 0 && !c.muted ? <span className="text-[12px] font-bold">@</span> : null}
        {!c.muted && <UnreadBadge count={c.unread_count} className="min-w-[22px]" />}
        <RowMenuButton onOpen={rowMenu.openFrom(c.id)} name={c.name ?? "group"} />
      </Link>
    );
  };

  const dmRow = (c: ConversationSummary) => {
    const other = otherMember(c);
    const active = activeConversationId === c.id;
    const look = presenceLook(other ? presenceOf(other.id) : "offline");
    return (
      <Link
        key={c.id}
        href={`/home/${c.id}`}
        className="sb-row group text-sb-text no-underline flex h-[34px] items-center gap-2.5 rounded-md pr-1 pl-3"
        style={sel(c.id)}
        aria-current={active ? "page" : undefined}
        onContextMenu={rowMenu.openAt(c.id)}
      >
        <span className="relative h-5 w-5 shrink-0">
          <Avatar profile={other} size={20} radius={5} />
          <PresenceDot look={look} size={9} border={active ? "var(--sb-sel)" : "var(--sb)"} />
        </span>
        <span className="flex-1 truncate text-[16px]" style={{ fontWeight: c.unread_count ? 700 : 500 }}>
          {conversationName(c)}
        </span>
        <UnreadBadge count={c.unread_count} className="min-w-[22px]" />
        <RowMenuButton onOpen={rowMenu.openFrom(c.id)} name={conversationName(c)} />
      </Link>
    );
  };

  const row = (c: ConversationSummary) => (c.type === "dm" || c.type === "group_dm" ? dmRow(c) : channelRow(c));

  return (
    <>
      <SidebarHeader title={org.name}>
        <SearchLink />
        {me.account_type === "team" && (
          <>
            <button
              type="button"
              onClick={() => openNewMessage("group")}
              className={iconBtn}
              aria-label="New group"
              title="New group"
            >
              <Icon name="plus" strokeWidth={2} />
            </button>
            <Link
              href="/customers/new"
              className={`${iconBtn} no-underline`}
              aria-label="Invite a customer"
              title="Invite a customer"
            >
              <Icon name="userPlus" />
            </Link>
          </>
        )}
        <button
          type="button"
          onClick={() => openNewMessage("people")}
          className={iconBtn}
          aria-label="New message"
          title="New message"
        >
          <Icon name="pencil" />
        </button>
      </SidebarHeader>
      <SidebarSearch value={filter} onChange={setFilter} placeholder="Find a conversation..." />
      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {!q && (
          <div className="pt-1 pb-2">
            <ThreadsRow compact />
            <PeopleRow />
          </div>
        )}
        {starred.length > 0 && (
          <>
            <SectionHeader
              label="Starred"
              collapsed={starredCollapsed}
              onToggle={() => setStarredCollapsed(!starredCollapsed)}
              count={starred.length}
            />
            {!starredCollapsed && starred.filter(matches).map(row)}
          </>
        )}

        {filed.map(({ section, conversations: inSection }) => {
          const collapsed = collapsedSections.has(section.id);
          const shown = inSection.slice().sort(byUnreadThenName).filter(matches);
          return (
            <div
              key={section.id}
              role="group"
              aria-label={section.name}
              className={dropRing(section.id)}
              {...dropProps(section.id, section.id)}
            >
              {renaming === section.id ? (
                <div className="px-1 pt-3 pb-1">
                  <input
                    autoFocus
                    value={draftName}
                    onChange={(e) => setDraftName(e.target.value)}
                    onKeyDown={(e) => onNameKey(e, () => void submitRename(section))}
                    onBlur={() => void submitRename(section)}
                    maxLength={60}
                    aria-label={`Rename ${section.name}`}
                    className={nameInput}
                  />
                </div>
              ) : (
                <SectionHeader
                  label={section.name}
                  collapsed={collapsed}
                  onToggle={() => toggleSectionCollapsed(section.id)}
                  count={inSection.length}
                >
                  <div className="relative">
                    <button
                      type="button"
                      onClick={() => setMenuFor(menuFor === section.id ? null : section.id)}
                      className="flex h-6 w-6 items-center justify-center rounded-md text-sb-dim hover:bg-sb-hover"
                      aria-label={`Options for ${section.name}`}
                      title="Rename or delete"
                    >
                      <Icon name="more" size={14} strokeWidth={2.6} />
                    </button>
                    {menuFor === section.id && (
                      <Menu
                        label={`Options for ${section.name}`}
                        align="right"
                        below
                        onClose={() => setMenuFor(null)}
                        items={[
                          {
                            id: "rename",
                            label: "Rename section",
                            icon: "pencil",
                            onSelect: () => {
                              setDraftName(section.name);
                              setRenaming(section.id);
                            },
                          },
                          {
                            id: "delete",
                            label: "Delete section",
                            icon: "trash",
                            danger: true,
                            onSelect: () => void deleteSection(section.id),
                          },
                        ]}
                      />
                    )}
                  </div>
                </SectionHeader>
              )}
              {!collapsed && shown.map(row)}
              {!collapsed && inSection.length === 0 && (
                <p className="px-3 py-2 text-[14px] text-sb-dim">Drag a group here to file it.</p>
              )}
            </div>
          );
        })}

        {creating ? (
          <div className="px-1 pt-3 pb-1">
            <input
              autoFocus
              value={draftName}
              onChange={(e) => setDraftName(e.target.value)}
              onKeyDown={(e) => onNameKey(e, () => void submitNew())}
              onBlur={() => void submitNew()}
              maxLength={60}
              placeholder="Section name"
              aria-label="New section name"
              className={nameInput}
            />
          </div>
        ) : (
          <button
            type="button"
            onClick={() => {
              setDraftName("");
              setCreating(true);
            }}
            className="mt-2 flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-[14px] text-sb-dim hover:bg-sb-hover"
          >
            <Icon name="plus" size={14} strokeWidth={2} />
            New section
          </button>
        )}

        <div className={dropRing(UNFILED)} {...dropProps(UNFILED, null)}>
          <SectionHeader
            label="Customers"
            collapsed={customersCollapsed}
            onToggle={() => setCustomersCollapsed(!customersCollapsed)}
            count={customers.length}
          >
            <button
              type="button"
              onClick={() => openNewMessage("group")}
              className="flex h-6 w-6 items-center justify-center rounded-md text-sb-dim hover:bg-sb-hover"
              aria-label="New customer group"
              title="New customer group"
            >
              <Icon name="plus" size={14} strokeWidth={2} />
            </button>
          </SectionHeader>
          {!customersCollapsed && customers.length === 0 && (
            <p className="px-3 py-2 text-[14px] text-sb-dim">
              No customer groups yet. Use + to create one, or invite a customer.
            </p>
          )}
          {!customersCollapsed && customers.filter(matches).map(channelRow)}

          {(leads.length > 0 || me.account_type === "team") && (
            <>
              <SectionHeader
                label="Lead database customers"
                collapsed={leadsCollapsed}
                onToggle={() => setLeadsCollapsed(!leadsCollapsed)}
                count={leads.length}
              />
              {!leadsCollapsed && leads.length === 0 && (
                <p className="px-3 py-2 text-[14px] text-sb-dim">
                  No lead database customers yet.
                  {isAdmin ? (
                    <>
                      {" "}
                      Import them from{" "}
                      <Link href="/settings/integrations" className="text-sb-text underline">
                        Settings → Integrations
                      </Link>
                      .
                    </>
                  ) : null}
                </p>
              )}
              {!leadsCollapsed &&
                LEAD_CATEGORY_KEYS.map((key) => {
                  const rows = leads.filter((c) => c.lead_category === key);
                  const [collapsed, setCollapsed] = leadPrefs[key];
                  if (rows.length === 0) return null;
                  const shown = rows.filter(matches);
                  return (
                    <div key={key}>
                      <button
                        type="button"
                        onClick={() => setCollapsed(!collapsed)}
                        aria-expanded={!collapsed}
                        className="flex w-full items-center gap-1.5 rounded-md border-0 bg-transparent px-3 pt-2 pb-1 text-left text-[13px] font-semibold text-sb-dim hover:bg-sb-hover"
                      >
                        <Icon
                          name="chevronDown"
                          size={12}
                          strokeWidth={2}
                          style={{ transform: collapsed ? "rotate(-90deg)" : undefined, transition: "transform .12s" }}
                        />
                        <span className="truncate">{LEAD_CATEGORIES[key].label}</span>
                        <span className="opacity-80">{rows.length}</span>
                      </button>
                      {!collapsed && shown.map(channelRow)}
                    </div>
                  );
                })}
            </>
          )}

          <SectionHeader
            label="Channels"
            collapsed={channelsCollapsed}
            onToggle={() => setChannelsCollapsed(!channelsCollapsed)}
            count={channels.length}
          />
          {!channelsCollapsed && channels.length === 0 && (
            <p className="px-3 py-2 text-[14px] text-sb-dim">Internal channels for the Stayful team appear here.</p>
          )}
          {!channelsCollapsed && channels.filter(matches).map(channelRow)}
        </div>

        <SectionHeader
          label="Direct messages"
          collapsed={dmsCollapsed}
          onToggle={() => setDmsCollapsed(!dmsCollapsed)}
          count={dms.length}
        >
          <button
            type="button"
            onClick={() => openNewMessage("people")}
            className="flex h-6 w-6 items-center justify-center rounded-md text-sb-dim hover:bg-sb-hover"
            aria-label="New direct message"
            title="New direct message"
          >
            <Icon name="plus" size={14} strokeWidth={2} />
          </button>
        </SectionHeader>
        {!dmsCollapsed && dms.filter(matches).map(dmRow)}

        {archivedCount > 0 && (
          <button
            type="button"
            onClick={() => setShowArchived(!showArchived)}
            className="mt-3 flex items-center gap-2 rounded-md px-3 py-1.5 text-[14px] text-sb-dim hover:bg-sb-hover"
          >
            <Icon name="files" size={15} />
            {showArchived ? "Hide archived" : `Show ${archivedCount} archived`}
          </button>
        )}
      </div>
      <ConversationMenu menu={rowMenu.menu} onClose={rowMenu.close} />
    </>
  );
}
