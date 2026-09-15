"use client";

import Link from "next/link";
import { useStore } from "@/components/shell/store";
import { Avatar } from "@/components/ui/Avatar";
import { Icon } from "@/components/ui/Icon";

const ROLE_LABEL: Record<string, string> = {
  admin: "Admin",
  staff: "Stayful team",
  owner: "Owner",
  delegate: "Delegate",
  contractor: "Contractor",
  cleaner: "Cleaner",
};

export function YouSidebar() {
  const { me, org } = useStore();
  return (
    <>
      <div className="font-display flex h-[50px] shrink-0 items-center px-4 text-[18px] font-bold">You</div>
      <div className="flex flex-col gap-4 px-4 pb-6">
        <div className="flex items-center gap-3.5">
          <Avatar profile={me} size={56} radius={14} />
          <div className="min-w-0">
            <div className="truncate text-[17px] font-bold">{me.full_name ?? me.display_name}</div>
            <div className="truncate text-[14px] text-sb-dim">{me.email}</div>
            <div className="text-[14px] text-sb-dim">
              {ROLE_LABEL[me.role] ?? me.role} · {org.name}
            </div>
          </div>
        </div>
        <Link
          href="/settings/account"
          className="flex h-11 items-center gap-3 rounded-lg border border-sb-border bg-sb-input px-3 text-[15px] font-medium text-sb-text no-underline"
        >
          <Icon name="key" />
          Account and password
        </Link>
        {me.account_type === "team" && (
          <Link
            href="/customers/new"
            className="flex h-11 items-center gap-3 rounded-lg border border-sb-border bg-sb-input px-3 text-[15px] font-medium text-sb-text no-underline"
          >
            <Icon name="userPlus" />
            Invite a customer
          </Link>
        )}
        <form action="/auth/signout" method="post">
          <button
            type="submit"
            className="flex h-11 w-full items-center gap-3 rounded-lg border border-sb-border bg-sb-input px-3 text-[15px] font-medium text-sb-text"
          >
            <Icon name="logout" />
            Sign out
          </button>
        </form>
      </div>
    </>
  );
}
