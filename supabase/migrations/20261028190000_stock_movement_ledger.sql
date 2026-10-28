-- Central stock movement ledger. Receiving RPCs append movements in the same
-- transaction that updates the stock JSON, so the ledger and balance stay aligned.

create or replace function public.finalize_receiving_decisions(p_receiving_id text, p_decisions jsonb)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_account_id uuid;
  v_state jsonb;
  v_note jsonb;
  v_products jsonb;
  v_receiving jsonb;
  v_lines jsonb;
  v_movements jsonb;
  v_now timestamptz := now();
  v_operator text;
begin
  v_account_id := private.current_account_id();
  if v_account_id is null or p_decisions is null or jsonb_typeof(p_decisions) <> 'object' then
    return false;
  end if;

  select a.state into v_state
  from public.app_state as a
  where a.owner_id = v_account_id
  for update;

  if v_state is null then return false; end if;

  select r.value into v_note
  from jsonb_array_elements(coalesce(v_state->'receiving', '[]'::jsonb)) as r(value)
  where r.value->>'id' = p_receiving_id
    and r.value->>'status' = 'analisando'
    and coalesce((r.value->>'stockReleased')::boolean, false) = false
  limit 1;

  if v_note is null then return false; end if;

  v_lines := coalesce(v_note->'items', '[]'::jsonb) || coalesce(v_note->'extras', '[]'::jsonb);
  if jsonb_array_length(v_lines) = 0 then return false; end if;

  if exists (
    select 1 from jsonb_array_elements(v_lines) as line(value)
    where coalesce(p_decisions->>(line.value->>'productId'), '') not in ('aceitar', 'devolver')
  ) then return false; end if;

  if exists (
    select 1 from jsonb_array_elements(v_lines) as line(value)
    where coalesce(p_decisions->>(line.value->>'productId'), '') = 'aceitar'
      and not exists (
        select 1 from jsonb_array_elements(coalesce(v_state->'products', '[]'::jsonb)) as product(value)
        where product.value->>'id' = line.value->>'productId'
      )
  ) then return false; end if;

  select coalesce(jsonb_agg(
    case when coalesce(p_decisions->>(product.value->>'id'), '') = 'aceitar' then
      jsonb_set(
        product.value, '{stock}',
        to_jsonb(coalesce((product.value->>'stock')::numeric, 0) +
          coalesce((select sum(coalesce((line.value->>'received')::numeric, 0))
            from jsonb_array_elements(v_lines) as line(value)
            where line.value->>'productId' = product.value->>'id'), 0))
      )
    else product.value end
  ), '[]'::jsonb)
  into v_products
  from jsonb_array_elements(coalesce(v_state->'products', '[]'::jsonb)) as product(value);

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', 'receiving:' || p_receiving_id || ':' || (product.value->>'id'),
    'operationId', p_receiving_id,
    'date', v_now,
    'type', 'Recebimento',
    'productId', product.value->>'id',
    'productCode', product.value->>'code',
    'productName', product.value->>'name',
    'unit', coalesce(product.value->>'unit', 'un'),
    'quantity', qty.received,
    'totalValue', round(qty.received * coalesce((product.value->>'price')::numeric, 0), 2),
    'stockBefore', coalesce((product.value->>'stock')::numeric, 0),
    'stockAfter', coalesce((product.value->>'stock')::numeric, 0) + qty.received,
    'delta', qty.received,
    'operator', v_operator,
    'details', 'Nota ' || coalesce(v_note->>'number', 'sem número') || ' · ' || coalesce(v_note->>'supplier', 'Fornecedor não informado')
  )), '[]'::jsonb)
  into v_movements
  from jsonb_array_elements(coalesce(v_state->'products', '[]'::jsonb)) as product(value)
  cross join lateral (
    select sum(coalesce((line.value->>'received')::numeric, 0)) as received
    from jsonb_array_elements(v_lines) as line(value)
    where line.value->>'productId' = product.value->>'id'
      and coalesce(p_decisions->>(line.value->>'productId'), '') = 'aceitar'
  ) as qty
  where coalesce(p_decisions->>(product.value->>'id'), '') = 'aceitar'
    and coalesce(qty.received, 0) > 0;

  select p.username into v_operator
  from public.profiles p
  where p.id = auth.uid()
  limit 1;

  -- Rebuild the operator field after resolving the current authenticated user.
  select coalesce(jsonb_agg(m.value || jsonb_build_object('operator', v_operator)), '[]'::jsonb)
  into v_movements
  from jsonb_array_elements(coalesce(v_movements, '[]'::jsonb)) as m(value);

  select coalesce(jsonb_agg(
    case when receiving.value->>'id' = p_receiving_id then receiving.value || jsonb_build_object(
      'decisions', p_decisions, 'decisionCompleted', true, 'status', 'aceito', 'stockReleased', true
    ) else receiving.value end
  ), '[]'::jsonb)
  into v_receiving
  from jsonb_array_elements(coalesce(v_state->'receiving', '[]'::jsonb)) as receiving(value);

  update public.app_state
  set state = v_state || jsonb_build_object(
    'products', v_products,
    'receiving', v_receiving,
    'stockMovements', coalesce(v_state->'stockMovements', '[]'::jsonb) || coalesce(v_movements, '[]'::jsonb)
  ),
  updated_at = v_now
  where owner_id = v_account_id;

  return true;
end;
$$;

create or replace function public.accept_receiving(p_receiving_id text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_account_id uuid;
  v_state jsonb;
  v_note jsonb;
  v_products jsonb;
  v_receiving jsonb;
  v_lines jsonb;
  v_movements jsonb;
  v_now timestamptz := now();
  v_operator text;
begin
  v_account_id := private.current_account_id();
  select a.state into v_state
  from public.app_state as a
  where a.owner_id = v_account_id
  for update;
  if v_state is null then return false; end if;

  select r.value into v_note
  from jsonb_array_elements(coalesce(v_state->'receiving', '[]'::jsonb)) as r(value)
  where r.value->>'id' = p_receiving_id
    and r.value->>'status' in ('conferido', 'divergente')
    and coalesce((r.value->>'stockReleased')::boolean, false) = false
  limit 1;
  if v_note is null then return false; end if;

  v_lines := coalesce(v_note->'items', '[]'::jsonb) || coalesce(v_note->'extras', '[]'::jsonb);
  select coalesce(jsonb_agg(
    case when exists (select 1 from jsonb_array_elements(v_lines) as line(value) where line.value->>'productId' = product.value->>'id')
      then jsonb_set(product.value, '{stock}', to_jsonb(coalesce((product.value->>'stock')::numeric, 0) +
        coalesce((select sum(coalesce((line.value->>'received')::numeric, 0)) from jsonb_array_elements(v_lines) as line(value) where line.value->>'productId' = product.value->>'id'), 0)))
      else product.value end
  ), '[]'::jsonb)
  into v_products
  from jsonb_array_elements(coalesce(v_state->'products', '[]'::jsonb)) as product(value);

  select p.username into v_operator from public.profiles p where p.id = auth.uid() limit 1;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', 'receiving:' || p_receiving_id || ':' || (product.value->>'id'),
    'operationId', p_receiving_id, 'date', v_now, 'type', 'Recebimento',
    'productId', product.value->>'id', 'productCode', product.value->>'code',
    'productName', product.value->>'name', 'unit', coalesce(product.value->>'unit', 'un'),
    'quantity', qty.received,
    'totalValue', round(qty.received * coalesce((product.value->>'price')::numeric, 0), 2),
    'stockBefore', coalesce((product.value->>'stock')::numeric, 0),
    'stockAfter', coalesce((product.value->>'stock')::numeric, 0) + qty.received,
    'delta', qty.received, 'operator', v_operator,
    'details', 'Nota ' || coalesce(v_note->>'number', 'sem número') || ' · ' || coalesce(v_note->>'supplier', 'Fornecedor não informado')
  )), '[]'::jsonb)
  into v_movements
  from jsonb_array_elements(coalesce(v_state->'products', '[]'::jsonb)) as product(value)
  cross join lateral (
    select sum(coalesce((line.value->>'received')::numeric, 0)) as received
    from jsonb_array_elements(v_lines) as line(value)
    where line.value->>'productId' = product.value->>'id'
  ) as qty
  where coalesce(qty.received, 0) > 0;

  select coalesce(jsonb_agg(
    case when receiving.value->>'id' = p_receiving_id then receiving.value || jsonb_build_object('status', 'aceito', 'stockReleased', true)
      else receiving.value end
  ), '[]'::jsonb)
  into v_receiving
  from jsonb_array_elements(coalesce(v_state->'receiving', '[]'::jsonb)) as receiving(value);

  update public.app_state
  set state = v_state || jsonb_build_object(
    'products', v_products, 'receiving', v_receiving,
    'stockMovements', coalesce(v_state->'stockMovements', '[]'::jsonb) || coalesce(v_movements, '[]'::jsonb)
  ),
  updated_at = v_now
  where owner_id = v_account_id;

  return true;
end;
$$;

revoke execute on function public.finalize_receiving_decisions(text, jsonb) from public;
revoke execute on function public.finalize_receiving_decisions(text, jsonb) from anon;
grant execute on function public.finalize_receiving_decisions(text, jsonb) to authenticated;
revoke execute on function public.accept_receiving(text) from public;
revoke execute on function public.accept_receiving(text) from anon;
grant execute on function public.accept_receiving(text) to authenticated;
