-- 0008_pgcrypto_search_path.sql
-- pgcrypto lives in the `extensions` schema on Supabase; the account RPCs need it on their path.
alter function public.create_customer_account(text, text, text, text, uuid[], public.user_role) set search_path = public, extensions;
alter function public.reset_customer_password(uuid, text) set search_path = public, extensions;
