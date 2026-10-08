create or replace function public.accept_receiving(p_receiving_id text)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_account_id uuid;
  v_state jsonb;
  v_note jsonb;
  v_products jsonb;
  v_receiving jsonb;
begin
  v_account_id := private.current_account_id();
  select state into v_state from public.app_state where owner_id = v_account_id for update;
  if v_state is null then return false; end if;
  select n into v_note
  from jsonb_array_elements(coalesce(v_state->'receiving','[]'::jsonb)) n
  where n->>'id' = p_receiving_id
    and n->>'status' in ('conferido','divergente')
    and coalesce((n->>'stockReleased')::boolean, false) = false
  limit 1;
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
  update public.app_state
  set state = v_state || jsonb_build_object('products',v_products,'receiving',v_receiving), updated_at = now()
  where owner_id = v_account_id;
  return true;
end;
$$;

revoke execute on function public.accept_receiving(text) from public;
revoke execute on function public.accept_receiving(text) from anon;
grant execute on function public.accept_receiving(text) to authenticated;