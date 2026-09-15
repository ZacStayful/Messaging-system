"use client";

import Link from "next/link";
import { useState } from "react";
import { useStore } from "@/components/shell/store";
import { Avatar } from "@/components/ui/Avatar";
import { Icon } from "@/components/ui/Icon";
import { PresenceDot } from "@/components/ui/PresenceDot";
import { StatusDialog } from "@/components/people/StatusDialog";
import { ROLE_LABEL, activeStatus, dndActive, manualAway, presenceLook, presenceText } from "@/lib/presence";

const row =
  "flex h-11 w-full items-center gap-3 rounded-lg border border-sb-border bg-sb-input px-3 text-left text-[15px] font-medium text-sb-text no-underline";

export function YouSidebar() {
  const { me, org, isTeam, presenceOf, updateMe } = useStore();
  const [status, setStatus] = useState(false);
  const custom = activeStatus(me);
  const dnd = dndActive(me);
  const away = manualAway(me);
  const look = presenceLook(presenceOf(me.id));

  return (
    <>
      <div className="font-display flex h-[50px] shrink-0 items-center px-4 text-[18px] font-bold">You</div>
      <div className="flex flex-col gap-4 px-4 pb-6">
        <div className="flex items-center gap-3.5">
          <span className="relative shrink-0">
            <Avatar profile={me} size={56} radius={14} />
            <PresenceDot look={look} size={14} border="var(--sb)" />
          </span>
          <div className="min-w-0">
            <div className="truncate text-[17px] font-bold">{me.full_name ?? me.display_name}</div>
            <div className="truncate text-[14px] text-sb-dim">{me.email}</div>
            <div className="text-[14px] text-sb-dim">
              {ROLE_LABEL[me.role] ?? me.role} · {org.name} · {presenceText(presenceOf(me.id), me)}
            </div>
          </div>
        </div>

        <button type="button" onClick={() => setStatus(true)} className={row}>
          {custom ? <span className="text-[18px]">{custom.emoji || "💬"}</span> : <Icon name="emoji" />}
          <span className="min-w-0 flex-1 truncate">{custom ? custom.text || "Status set" : "Set a status"}</span>
          {custom && <Icon name="pencil" size={16} className="opacity-70" />}
        </button>
        {custom && (
          <button
            type="button"
            onClick={() => void updateMe({ status_text: null, status_emoji: null, status_expires_at: null })}
            className="-mt-2 self-start px-1 text-[14px] text-sb-dim hover:underline"
          >
            Clear status
          </button>
        )}
        <button type="button" onClick={() => setStatus(true)} className={row}>
          <Icon name="moon" />
          <span className="min-w-0 flex-1 truncate">
            {away
              ? me.away_until
                ? `Away until ${new Date(me.away_until).toLocaleString("en-GB", { weekday: "short", hour: "numeric", minute: "2-digit" })}`
                : "You're away — notifications off"
              : "Set yourself away"}
          </span>
        </button>
        {away && (
          <button
            type="button"
            onClick={() => void updateMe({ presence_mode: "auto", away_since: null, away_until: null })}
            className="-mt-2 self-start px-1 text-[14px] text-sb-dim hover:underline"
          >
            Come back
          </button>
        )}
        <button type="button" onClick={() => setStatus(true)} className={row}>
          <Icon name={dnd ? "bellOff" : "bell"} />
          <span className="min-w-0 flex-1 truncate">
            {dnd
              ? `Notifications paused until ${new Date(me.dnd_until!).toLocaleString("en-GB", { weekday: "short", hour: "numeric", minute: "2-digit" })}`
              : "Pause notifications"}
          </span>
        </button>
        {dnd && (
          <button
            type="button"
            onClick={() => void updateMe({ dnd_until: null })}
            className="-mt-2 self-start px-1 text-[14px] text-sb-dim hover:underline"
          >
            Resume notifications
          </button>
        )}

        <Link href="/settings/account" className={row}>
          <Icon name="settings" />
          Profile, account and password
        </Link>
        {isTeam && (
          <Link href="/people" className={row}>
            <Icon name="users" />
            People directory
          </Link>
        )}
        {isTeam && (
          <Link href="/customers/new" className={row}>
            <Icon name="userPlus" />
            Invite a customer
          </Link>
        )}
        <form action="/auth/signout" method="post">
          <button type="submit" className={row}>
            <Icon name="logout" />
            Sign out
          </button>
        </form>
      </div>
      {status && <StatusDialog onClose={() => setStatus(false)} />}
    </>
  );
}
