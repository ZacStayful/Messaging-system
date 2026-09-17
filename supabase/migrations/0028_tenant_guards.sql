-- 0028_tenant_guards.sql
-- Three functions from 0023 and 0024 took an org_id and believed it.
--
-- Found by the Supabase security advisor after 0024 was applied: it lists every SECURITY
-- DEFINER function reachable as `authenticated`, and three of the new ones accept the
-- organisation to act on as a parameter and never check it against the caller's own. In a schema
-- whose entire access model is "every row carries org_id", that is a hole:
--
--   render_message_template(p_org, ...)   reads another organisation's template bodies
--   next_available_slug(p_org, ...)       probes whether a slug exists in another organisation
--   ensure_maintenance_channel(p_org)     CREATES A CONVERSATION in another organisation, and
--                                         was callable by any signed-in account at all,
--                                         customers included
--
-- Only one organisation exists today, so nothing was exposed in practice. It is fixed because
-- the multi-tenant rule is load-bearing everywhere else and these three quietly opted out of it.
--
-- The guard is the same shape in all three: when there is a caller (auth.uid() is not null) the
-- org must be theirs. auth.uid() is null for the service role, which is how the inbound WhatsApp
-- webhook reaches ensure_maintenance_channel, so that path stays open — the same exemption
-- conversation_bookmarks_guard (0021) relies on.

-- ---------------------------------------------------------------------------
-- render_message_template: your own organisation's templates only
-- ---------------------------------------------------------------------------
create or replace function public.render_message_template(p_org uuid, p_key text, p_vars jsonb default '{}'::jsonb)
returns text language plpgsql stable security definer set search_path = public as $$
declare v_body text; k text; v text;
begin
  if auth.uid() is not null and p_org is distinct from public.auth_org_id() then
    raise exception 'not allowed';
  end if;
  select body into v_body from public.message_templates
   where org_id = p_org and key = p_key and active;
  if v_body is null then return null; end if;
  for k, v in select key, value #>> '{}' from jsonb_each(coalesce(p_vars, '{}'::jsonb)) loop
    v_body := replace(v_body, '{{' || k || '}}', coalesce(v, ''));
  end loop;
  return v_body;
end $$;
revoke all on function public.render_message_template(uuid, text, jsonb) from public, anon;
grant execute on function public.render_message_template(uuid, text, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- next_available_slug: likewise, and team-only
-- ---------------------------------------------------------------------------
-- Only a team member can create a group, so only a team member has any business asking what a
-- group could be called. A customer probing this learns which clients Stayful has.
create or replace function public.next_available_slug(p_org uuid, p_base text)
returns text language plpgsql stable security definer set search_path = public as $$
declare v_base text; v_try text; n int := 1;
begin
  if auth.uid() is not null and (p_org is distinct from public.auth_org_id() or not public.is_team()) then
    raise exception 'not allowed';
  end if;
  v_base := trim(both '-' from regexp_replace(lower(coalesce(p_base, '')), '[^a-z0-9]+', '-', 'g'));
  v_base := trim(both '-' from left(v_base, 60));
  if v_base = '' then return null; end if;
  v_try := v_base;
  while exists (select 1 from public.conversations c
                 where c.org_id = p_org and c.slug = v_try and c.archived_at is null) loop
    n := n + 1;
    v_try := v_base || '-' || n;
    if n > 50 then return null; end if;
  end loop;
  return v_try;
end $$;
revoke all on function public.next_available_slug(uuid, text) from public, anon;
grant execute on function public.next_available_slug(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- ensure_maintenance_channel: the one that actually wrote
-- ---------------------------------------------------------------------------
-- This creates a conversation. Unguarded and granted to `authenticated`, a customer account
-- could have created one in any organisation whose id they could guess. Now: no caller means
-- the service role (the inbound webhook, which is the normal path), and a caller must be a team
-- member of that organisation.
create or replace function public.ensure_maintenance_channel(p_org uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare cid uuid; v_actor uuid;
begin
  if auth.uid() is not null and (p_org is distinct from public.auth_org_id() or not public.is_team()) then
    raise exception 'not allowed';
  end if;
  select id into cid from public.conversations
   where org_id = p_org and slug = 'maintenance' and type = 'internal' and archived_at is null;
  if cid is not null then return cid; end if;
  -- auth.uid() is null when the webhook calls this, so fall back to an admin as the creator
  -- rather than leaving created_by null and the channel memberless.
  v_actor := coalesce(auth.uid(),
    (select id from public.profiles
      where org_id = p_org and account_type = 'team' and role = 'admin' and deactivated_at is null
      order by created_at limit 1));
  insert into public.conversations (org_id, type, name, slug, topic, is_private, created_by)
  values (p_org, 'internal', 'maintenance', 'maintenance',
          'Inbound maintenance WhatsApp lands here until it is moved to a property thread',
          true, v_actor)
  returning id into cid;
  if v_actor is not null then
    insert into public.conversation_members (conversation_id, user_id, org_id, member_side)
    values (cid, v_actor, p_org, 'internal') on conflict do nothing;
  end if;
  return cid;
end $$;
revoke all on function public.ensure_maintenance_channel(uuid) from public, anon;
grant execute on function public.ensure_maintenance_channel(uuid) to authenticated;
