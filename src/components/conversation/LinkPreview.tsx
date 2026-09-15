"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import type { UnfurlResult } from "@/app/api/unfurl/route";

const cache = new Map<string, Promise<UnfurlResult | null>>();

function load(url: string): Promise<UnfurlResult | null> {
  let p = cache.get(url);
  if (!p) {
    p = fetch(`/api/unfurl?url=${encodeURIComponent(url)}`)
      .then((r) => (r.ok ? (r.json() as Promise<UnfurlResult>) : null))
      .then((r) => (r && r.ok ? r : null))
      .catch(() => null);
    cache.set(url, p);
  }
  return p;
}

/** Open Graph card under a message for its first external link (Slack-style unfurl). */
export function LinkPreview({ url }: { url: string }) {
  const [data, setData] = useState<UnfurlResult | null | undefined>(undefined);
  useEffect(() => {
    let cancelled = false;
    load(url).then((r) => {
      if (!cancelled) setData(r);
    });
    return () => {
      cancelled = true;
    };
  }, [url]);
  if (!data) return null;
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="mt-1.5 mb-2 flex max-w-[520px] overflow-hidden rounded-lg border border-line bg-card text-ink no-underline hover:bg-hover"
    >
      <span className="w-1 shrink-0 bg-line" />
      <span className="flex min-w-0 flex-1 gap-3 p-3">
        <span className="min-w-0 flex-1">
          {data.site_name && (
            <span className="block truncate text-[13px] font-semibold text-muted">{data.site_name}</span>
          )}
          <span className="clamp-2 block text-[15px] font-bold text-link">{data.title}</span>
          {data.description && <span className="clamp-2 mt-0.5 block text-[14px] text-muted">{data.description}</span>}
        </span>
        {data.image_url && (
          <span
            className="relative hidden h-[72px] w-[96px] shrink-0 overflow-hidden rounded-md sm:block"
            style={{ background: "var(--thumb)" }}
          >
            <Image src={data.image_url} alt="" fill unoptimized className="object-cover" sizes="96px" />
          </span>
        )}
      </span>
    </a>
  );
}
