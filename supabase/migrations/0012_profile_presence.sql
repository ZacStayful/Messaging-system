-- 0012_profile_presence.sql
-- Live profile changes (name, photo, custom status, do-not-disturb) reach everyone in the
-- organisation through the org topic they already subscribe to for presence.
create or replace function public.broadcast_profile_changes()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.display_name is distinct from old.display_name
     or new.full_name is distinct from old.full_name
     or new.avatar_url is distinct from old.avatar_url
     or new.avatar_color is distinct from old.avatar_color
     or new.status_text is distinct from old.status_text
     or new.status_emoji is distinct from old.status_emoji
     or new.status_expires_at is distinct from old.status_expires_at
     or new.dnd_until is distinct from old.dnd_until
     or new.timezone is distinct from old.timezone
     or new.presence is distinct from old.presence
     or new.deactivated_at is distinct from old.deactivated_at then
    perform realtime.send(
      jsonb_build_object(
        'id', new.id, 'display_name', new.display_name, 'full_name', new.full_name,
        'avatar_url', new.avatar_url, 'avatar_color', new.avatar_color,
        'status_text', new.status_text, 'status_emoji', new.status_emoji,
        'status_expires_at', new.status_expires_at, 'dnd_until', new.dnd_until,
        'timezone', new.timezone, 'presence', new.presence, 'deactivated_at', new.deactivated_at),
      'profile_changed', 'org:' || new.org_id::text, true);
  end if;
  return null;
end $$;
revoke execute on function public.broadcast_profile_changes() from public, anon, authenticated;
drop trigger if exists profiles_broadcast on public.profiles;
create trigger profiles_broadcast
  after update on public.profiles
  for each row execute function public.broadcast_profile_changes();
