"use client";

import { useRef, useState, type FormEvent } from "react";
import { useStore } from "@/components/shell/store";
import { createClient } from "@/lib/supabase/client";
import { Avatar } from "@/components/ui/Avatar";
import { Icon } from "@/components/ui/Icon";
import { browserTimezone } from "@/lib/presence";

const input =
  "h-11 w-full rounded-lg border border-input-border bg-input px-3.5 text-[16px] text-ink outline-none focus:border-brand focus:shadow-[0_0_0_3px_rgba(93,129,86,0.2)]";
const primary =
  "h-11 rounded-lg bg-brand px-4 text-[15px] font-semibold text-white hover:opacity-90 disabled:opacity-60";
const secondary = "h-11 rounded-lg border border-input-border px-4 text-[15px] font-semibold text-ink hover:bg-hover";

const ZONES = [
  "Europe/London",
  "Europe/Dublin",
  "Europe/Paris",
  "Europe/Madrid",
  "Europe/Lisbon",
  "Europe/Berlin",
  "Europe/Athens",
  "Europe/Istanbul",
  "Asia/Dubai",
  "Asia/Kolkata",
  "Asia/Singapore",
  "Asia/Hong_Kong",
  "Asia/Tokyo",
  "Australia/Sydney",
  "Pacific/Auckland",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Toronto",
  "America/Sao_Paulo",
  "Africa/Johannesburg",
  "UTC",
];

/** Name, photo and timezone. Everyone in the workspace sees these live. */
export function ProfileSection() {
  const { me, updateMe } = useStore();
  const supabase = createClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [displayName, setDisplayName] = useState(me.display_name);
  const [fullName, setFullName] = useState(me.full_name ?? "");
  const [timezone, setTimezone] = useState(me.timezone || browserTimezone());
  const [state, setState] = useState<"idle" | "busy" | "done" | "error">("idle");
  const [photoState, setPhotoState] = useState<"idle" | "busy" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const zones = ZONES.includes(timezone) ? ZONES : [timezone, ...ZONES];

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    const dn = displayName.trim();
    if (dn.length < 2) return setError("Display name needs at least 2 characters.");
    setState("busy");
    const ok = await updateMe({ display_name: dn, full_name: fullName.trim() || null, timezone });
    setState(ok ? "done" : "error");
    if (!ok) setError("Couldn't save your profile. Try again.");
  };

  const upload = async (file: File) => {
    setError(null);
    if (!/^image\/(jpeg|png|webp|gif)$/.test(file.type)) return setError("Use a JPG, PNG, WebP or GIF.");
    if (file.size > 5 * 1024 * 1024) return setError("Photos must be under 5 MB.");
    setPhotoState("busy");
    const ext = file.type === "image/jpeg" ? "jpg" : file.type.split("/")[1];
    const path = `${me.id}/avatar.${ext}`;
    const { error: upErr } = await supabase.storage
      .from("avatars")
      .upload(path, file, { contentType: file.type, upsert: true, cacheControl: "3600" });
    if (upErr) {
      setPhotoState("error");
      setError(upErr.message);
      return;
    }
    const { data } = supabase.storage.from("avatars").getPublicUrl(path);
    const ok = await updateMe({ avatar_url: `${data.publicUrl}?v=${Date.now()}` });
    setPhotoState(ok ? "idle" : "error");
  };

  const removePhoto = async () => {
    setPhotoState("busy");
    await updateMe({ avatar_url: null });
    setPhotoState("idle");
  };

  return (
    <section className="rounded-xl border border-line bg-card p-5">
      <h2 className="mb-1 text-[16px] font-bold">Profile</h2>
      <p className="mb-4 text-[14px] text-muted">How you appear to everyone in Stayful.</p>
      <div className="mb-5 flex items-center gap-4">
        <Avatar profile={me} size={72} radius={16} />
        <div className="flex flex-wrap gap-2">
          <input
            ref={fileRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif"
            className="hidden"
            aria-label="Choose a profile photo"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void upload(f);
              e.target.value = "";
            }}
          />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={photoState === "busy"}
            className={secondary}
          >
            <span className="flex items-center gap-2">
              <Icon name="upload" size={16} />{" "}
              {photoState === "busy" ? "Uploading…" : me.avatar_url ? "Change photo" : "Upload photo"}
            </span>
          </button>
          {me.avatar_url && (
            <button
              type="button"
              onClick={() => void removePhoto()}
              disabled={photoState === "busy"}
              className={secondary}
            >
              Remove photo
            </button>
          )}
        </div>
      </div>
      <form onSubmit={save} className="flex flex-col gap-3">
        <label className="flex flex-col gap-1.5 text-[14px] font-semibold">
          Display name
          <input
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            className={input}
            maxLength={40}
            required
          />
          <span className="text-[13px] font-normal text-muted">Shown on your messages and used for @mentions.</span>
        </label>
        <label className="flex flex-col gap-1.5 text-[14px] font-semibold">
          Full name
          <input value={fullName} onChange={(e) => setFullName(e.target.value)} className={input} maxLength={80} />
        </label>
        <label className="flex flex-col gap-1.5 text-[14px] font-semibold">
          Time zone
          <span className="flex gap-2">
            <select
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
              className={`${input} flex-1`}
              aria-label="Time zone"
            >
              {zones.map((z) => (
                <option key={z} value={z}>
                  {z.replace(/_/g, " ")}
                </option>
              ))}
            </select>
            <button type="button" onClick={() => setTimezone(browserTimezone())} className={secondary}>
              Detect
            </button>
          </span>
          <span className="text-[13px] font-normal text-muted">Others see your local time on your profile.</span>
        </label>
        {error && (
          <p role="alert" className="alert-error">
            {error}
          </p>
        )}
        {state === "done" && <p className="rounded-lg bg-soft px-3 py-2 text-[14px] text-link">Profile saved.</p>}
        <div>
          <button type="submit" disabled={state === "busy"} className={primary}>
            {state === "busy" ? "Saving…" : "Save profile"}
          </button>
        </div>
      </form>
    </section>
  );
}
