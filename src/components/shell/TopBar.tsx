"use client";

import Image from "next/image";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Icon } from "@/components/ui/Icon";

const btn = "flex h-8 w-8 items-center justify-center rounded-md border-0 bg-transparent text-sb-dim hover:bg-sb-hover";

export function TopBar() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const initial = pathname === "/search" ? (params.get("q") ?? "") : "";
  const [q, setQ] = useState(initial);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const query = q.trim();
    if (query) router.push(`/search?q=${encodeURIComponent(query)}`);
  };

  return (
    <header className="hidden h-11 shrink-0 items-center gap-2 pr-3 text-sb-text md:flex">
      <div className="w-[72px] shrink-0" />
      <div className="flex min-w-0 flex-1 items-center justify-center gap-0.5">
        <button type="button" className={btn} onClick={() => router.back()} aria-label="Back">
          <Icon name="back" />
        </button>
        <button type="button" className={`${btn} opacity-50`} onClick={() => router.forward()} aria-label="Forward">
          <Icon name="forward" />
        </button>
        <button type="button" className={`${btn} mr-2`} aria-label="History" title="History">
          <Icon name="clock" />
        </button>
        <form
          onSubmit={submit}
          role="search"
          className="flex h-[30px] min-w-0 flex-1 max-w-[720px] items-center gap-2 rounded-md border border-sb-border bg-sb-input px-2.5 text-sb-dim focus-within:bg-input focus-within:text-ink"
        >
          <Icon name="search" size={16} strokeWidth={2} />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search Stayful"
            aria-label="Search Stayful"
            className="min-w-0 flex-1 border-0 bg-transparent text-[14px] text-inherit outline-none placeholder:text-current"
          />
          {q && (
            <button
              type="button"
              onClick={() => setQ("")}
              className="flex h-5 w-5 items-center justify-center rounded"
              aria-label="Clear search"
            >
              <Icon name="close" size={12} strokeWidth={2.4} />
            </button>
          )}
        </form>
        <Image
          src="/brand/stayful-logo.png"
          alt=""
          width={26}
          height={26}
          className="ml-2 h-[26px] w-[26px] rounded-md"
        />
      </div>
      <button type="button" className={btn} aria-label="Help" title="Help">
        <Icon name="help" />
      </button>
    </header>
  );
}
