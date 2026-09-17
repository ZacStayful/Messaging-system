"use server";

import { createClient } from "@/lib/supabase/server";

export interface SaveTemplateResult {
  ok: boolean;
  error?: string;
}

/**
 * Saves a message template.
 *
 * Runs as the signed-in admin, so the RLS policy on `message_templates` decides whether they may.
 * Editing the welcome message changes what the *next* customer group opens with and never
 * rewrites what a customer has already read — the template is a catalogue entry, not a document
 * every group points at.
 */
export async function saveTemplate(formData: FormData): Promise<SaveTemplateResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "You need to sign in again." };

  const key = String(formData.get("key") ?? "").trim();
  const title = String(formData.get("title") ?? "").trim();
  const body = String(formData.get("body") ?? "");
  const active = formData.get("active") === "on";
  if (!key) return { ok: false, error: "Which template?" };
  if (!title) return { ok: false, error: "Give the template a name." };
  if (!body.trim()) return { ok: false, error: "The message cannot be empty." };

  const { data: me } = await supabase.from("profiles").select("org_id").eq("id", user.id).single();
  if (!me) return { ok: false, error: "Your profile could not be loaded." };

  const { error } = await supabase
    .from("message_templates")
    .update({ title, body, active, updated_by: user.id, updated_at: new Date().toISOString() })
    .eq("org_id", me.org_id)
    .eq("key", key);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/**
 * Puts a template back to the version this app shipped with.
 *
 * `default_message_templates()` (0023) is the single source of that text — the same function the
 * migration and the new-organisation trigger read — so "restore" cannot drift from "what a fresh
 * install gets".
 */
export async function restoreTemplate(key: string): Promise<SaveTemplateResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "You need to sign in again." };

  const { data: me } = await supabase.from("profiles").select("org_id").eq("id", user.id).single();
  if (!me) return { ok: false, error: "Your profile could not be loaded." };

  const { data: defaults, error: defaultsError } = await supabase.rpc("default_message_templates");
  if (defaultsError) return { ok: false, error: defaultsError.message };
  const fallback = (defaults ?? []).find((d) => d.key === key);
  if (!fallback) return { ok: false, error: "There is no default for that template." };

  const { error } = await supabase.from("message_templates").upsert(
    {
      org_id: me.org_id,
      key,
      title: fallback.title,
      description: fallback.description,
      body: fallback.body,
      active: true,
      updated_by: user.id,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "org_id,key" },
  );
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
