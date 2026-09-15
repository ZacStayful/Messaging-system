"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useStore } from "@/components/shell/store";
import { Avatar } from "@/components/ui/Avatar";
import { Icon } from "@/components/ui/Icon";
import { Popover } from "@/components/ui/Popover";
import { PresenceDot } from "@/components/ui/PresenceDot";
import { ROLE_LABEL, activeStatus, dndActive, localTime, presenceLook, presenceText } from "@/lib/presence";

/** Slack-style profile card, anchored where the avatar or name was clicked. Mounted once in the shell. */
export function ProfileCardHost() {
  const { profileCard, closeProfile, profiles, me, presenceOf, openDm } = useStore();
  const router = useRouter();
  const p = profileCard ? profiles[profileCard.id] : undefined;
  if (!profileCard || !p) return null;

  const status = presenceOf(p.id);
  const custom = activeStatus(p);
  const dnd = dndActive(p);
  const isMe = p.id === me.id;
  const time = localTime(p.timezone);
  const width = 300;
  const left = Math.max(8, Math.min(profileCard.x, window.innerWidth - width - 8));
  const below = profileCard.y < window.innerHeight - 420;

  const message = async () => {
    const id = await openDm(p.id);
    closeProfile();
    if (id) router.push(`/dms/${id}`);
  };
  const btn =
    "flex h-9 flex-1 items-center justify-center gap-1.5 rounded-lg border border-input-border bg-transparent px-3 text-[14px] font-semibold text-ink hover:bg-hover";

  return (
    <div className="fixed z-40" style={{ left, top: profileCard.y }}>
      <Popover
        onClose={closeProfile}
        label={`Profile: ${p.display_name}`}
        align="left"
        below={below}
        className="w-[300px] p-4"
      >
        <div className="flex items-start gap-3">
          <span className="relative shrink-0">
            <Avatar profile={p} size={72} radius={14} />
            <PresenceDot look={presenceLook(status)} size={16} border="var(--panel)" />
          </span>
          <div className="min-w-0 flex-1 pt-1">
            <div className="truncate text-[18px] leading-tight font-bold">{p.full_name ?? p.display_name}</div>
            {p.full_name && p.full_name !== p.display_name && (
              <div className="truncate text-[14px] text-muted">@{p.display_name}</div>
            )}
            <div className="mt-1 text-[13px] font-semibold text-muted">
              {ROLE_LABEL[p.role] ?? p.role}
              {p.account_type === "team" ? " · Stayful" : ""}
            </div>
          </div>
        </div>
        {custom && (
          <div className="mt-3 flex items-center gap-2 rounded-lg bg-soft px-3 py-2 text-[15px]">
            {custom.emoji && <span className="text-[18px]">{custom.emoji}</span>}
            <span className="min-w-0 truncate">{custom.text}</span>
          </div>
        )}
        <div className="mt-3 flex flex-col gap-1 text-[14px] text-muted">
          <span className="flex items-center gap-2">
            <span
              className="h-2.5 w-2.5 rounded-full"
              style={{ background: presenceLook(status).bg, boxShadow: presenceLook(status).ring }}
            />
            {presenceText(status)}
            {dnd && (
              <span className="flex items-center gap-1" title="Notifications paused">
                · <Icon name="bellOff" size={14} /> Notifications paused
              </span>
            )}
          </span>
          {time && (
            <span className="flex items-center gap-2">
              <Icon name="clock" size={14} /> {time} local time
            </span>
          )}
          {p.email && (
            <span className="flex items-center gap-2 truncate">
              <Icon name="mail" size={14} /> <span className="truncate">{p.email}</span>
            </span>
          )}
        </div>
        <div className="mt-4 flex gap-2">
          {isMe ? (
            <Link href="/settings/account" onClick={closeProfile} className={`${btn} no-underline`}>
              <Icon name="pencil" size={16} /> Edit profile
            </Link>
          ) : (
            <button
              type="button"
              onClick={() => void message()}
              className={btn}
              style={{ background: "var(--brand)", color: "#fff", borderColor: "transparent" }}
            >
              <Icon name="dms" size={16} /> Message
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              void navigator.clipboard?.writeText(p.email ?? "");
              closeProfile();
            }}
            className={btn}
          >
            <Icon name="link" size={16} /> Copy email
          </button>
        </div>
      </Popover>
    </div>
  );
}
