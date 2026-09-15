"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { BUCKET } from "./attachments";

const TTL_SECONDS = 3600;

/**
 * Signed download URLs for a set of storage paths. Paths are signed once per hour and
 * cached for the life of the component; new paths are signed as they appear.
 */
export function useSignedUrls(paths: string[]): Record<string, string> {
  const [urls, setUrls] = useState<Record<string, string>>({});
  const pending = useRef(new Set<string>());
  const key = paths.join("\n");

  useEffect(() => {
    const missing = key.split("\n").filter((p) => p && !(p in urls) && !pending.current.has(p));
    if (missing.length === 0) return;
    missing.forEach((p) => pending.current.add(p));
    let cancelled = false;
    createClient()
      .storage.from(BUCKET)
      .createSignedUrls(missing, TTL_SECONDS)
      .then(({ data }) => {
        missing.forEach((p) => pending.current.delete(p));
        if (cancelled || !data) return;
        const next: Record<string, string> = {};
        for (const d of data) if (d.path && d.signedUrl) next[d.path] = d.signedUrl;
        if (Object.keys(next).length) setUrls((prev) => ({ ...prev, ...next }));
      });
    return () => {
      cancelled = true;
    };
  }, [key, urls]);

  return urls;
}
