alter table public.profiles
  add column if not exists account_id uuid references auth.users(id) on delete cascade,
  add column if not exists role text not null default 'manager',
  add column if not exists active boolean not null default true,
  add column if not exists display_name text;

update public.profiles
set account_id = id,
    role = coalesce(nullif(role, ''), 'manager'),
    active = coalesce(active, true),
    display_name = coalesce(nullif(display_name, ''), username)
where account_id is null;

alter table public.profiles alter column account_id set not null;
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check check (role in ('manager','pdv'));
create index if not exists profiles_account_id_idx on public.profiles(account_id);

create schema if not exists private;

create or replace function private.current_account_id()
returns uuid language sql stable security definer set search_path = ''
as $$ select coalesce((select p.account_id from public.profiles p where p.id = (select auth.uid())), (select auth.uid())); $$;

create or replace function private.current_account_role()
returns text language sql stable security definer set search_path = ''
as $$ select coalesce((select p.role from public.profiles p where p.id = (select auth.uid())), 'pdv'); $$;

revoke execute on function private.current_account_id() from public;
revoke execute on function private.current_account_role() from public;
grant usage on schema private to authenticated;
grant execute on function private.current_account_id() to authenticated;
grant execute on function private.current_account_role() to authenticated;

drop policy if exists "profiles own insert" on public.profiles;
drop policy if exists "profiles own select" on public.profiles;
drop policy if exists "profiles own update" on public.profiles;
drop policy if exists "profiles account select" on public.profiles;
create policy "profiles account select" on public.profiles for select to authenticated
using (id = (select auth.uid()) or ((select private.current_account_role()) = 'manager' and account_id = (select private.current_account_id())));
revoke insert, update, delete on table public.profiles from authenticated;
grant select on table public.profiles to authenticated;

drop policy if exists "state own insert" on public.app_state;
drop policy if exists "state own select" on public.app_state;
drop policy if exists "state own update" on public.app_state;
create policy "state account insert" on public.app_state for insert to authenticated
with check (owner_id = (select private.current_account_id()));
create policy "state account select" on public.app_state for select to authenticated
using (owner_id = (select private.current_account_id()));
create policy "state account update" on public.app_state for update to authenticated
using (owner_id = (select private.current_account_id()))
with check (owner_id = (select private.current_account_id()));
grant select, insert, update on table public.app_state to authenticated;

create or replace function public.accept_receiving(p_receiving_id text)
returns boolean language plpgsql security definer set search_path = ''
as $$
declare
  v_account_id uuid; v_state jsonb; v_note jsonb; v_products jsonb; v_receiving jsonb;
begin
  v_account_id := private.current_account_id();
  select state into v_state from public.app_state where owner_id = v_account_id for update;
  if v_state is null then return false; end if;
  select n into v_note from jsonb_array_elements(coalesce(v_state->'receiving','[]'::jsonb)) n
  where n->>'id' = p_receiving_id and n->>'status' in ('conferido','divergente')
    and coalesce((n->>'stockReleased')::boolean, false) = false limit 1;
  if v_note is null then return false; end if;

  select coalesce(jsonb_agg(case when p->>'id' = i.product_id
    then jsonb_set(p,'{stock}',to_jsonb(coalesce((p->>'stock')::numeric,0)+i.received))
    else p end),'[]'::jsonb)
  into v_products
  from jsonb_array_elements(coalesce(v_state->'products','[]'::jsonb)) p
  left join lateral (
    select x->>'productId' product_id, coalesce((x->>'received')::numeric,0) received
    from jsonb_array_elements(coalesce(v_note->'items','[]'::jsonb)) x
  ) i on i.product_id = p->>'id';

  select coalesce(jsonb_agg(case when n->>'id' = p_receiving_id
    then n || jsonb_build_object('status','aceito','stockReleased',true) else n end),'[]'::jsonb)
  into v_receiving from jsonb_array_elements(coalesce(v_state->'receiving','[]'::jsonb)) n;

  update public.app_state set state = v_state || jsonb_build_object('products',v_products,'receiving',v_receiving), updated_at = now()
  where owner_id = v_account_id;
  return true;
end; $$;

revoke execute on function public.accept_receiving(text) from public;
grant execute on function public.accept_receiving(text) to authenticated;