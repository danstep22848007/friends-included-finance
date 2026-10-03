-- Run once in the Supabase SQL editor. Keep the secret key on the server only.
create sequence if not exists public.sales_sheet_rows start 2;
create sequence if not exists public.expense_sheet_rows start 2;

create table if not exists public.employees (
  id text primary key,
  name text not null,
  role text not null check (role in ('sales', 'expenses', 'manager'))
);

insert into public.employees (id, name, role) values
  ('richard', 'Richard Darling', 'sales'),
  ('anastasia', 'Anastasia Ferrari', 'sales'),
  ('jean_claude', 'Jean-Claude Bērziņš', 'sales'),
  ('kevin', 'Kevin von Whatever', 'expenses'),
  ('svetlana', 'Svetlana de Monte Carlo', 'manager')
on conflict (id) do update set name = excluded.name, role = excluded.role;

create table if not exists public.telegram_links (
  telegram_user_id bigint primary key,
  chat_id bigint not null,
  employee_id text not null references public.employees(id),
  linked_at timestamptz not null default now()
);

create table if not exists public.telegram_contacts (
  telegram_user_id bigint primary key,
  chat_id bigint not null,
  started_at timestamptz not null default now()
);

create table if not exists public.transactions (
  reference text primary key,
  kind text not null check (kind in ('sale', 'expense')),
  employee_id text not null references public.employees(id),
  source text not null check (source in ('website', 'telegram')),
  origin_chat_id bigint,
  submitted_at timestamptz not null default now(),
  customer text,
  project text check (project in ('A', 'B')),
  description text not null,
  amount numeric(14,2) not null check (amount > 0),
  category text check (category in ('Materials', 'Travel', 'Other')),
  proposed_r integer,
  proposed_a integer,
  proposed_j integer,
  approved_r integer,
  approved_a integer,
  approved_j integer,
  proposed_allocation text check (proposed_allocation in ('A', 'B', 'Company overhead')),
  final_allocation text check (final_allocation in ('A', 'B', 'Company overhead')),
  status text not null check (status in ('Pending approval', 'Approved', 'Awaiting allocation', 'Allocated')),
  decided_at timestamptz,
  sheet_row integer not null,
  sync_status text not null default 'pending' check (sync_status in ('pending', 'synced', 'failed')),
  sync_error text,
  notification_chat_id bigint,
  notification_status text not null default 'not_required' check (notification_status in ('not_required', 'pending', 'sent', 'failed', 'no_recipient')),
  notification_error text,
  constraint sale_shape check (
    (kind = 'sale' and customer is not null and project is not null and category is null and proposed_allocation is null
      and proposed_r is not null and proposed_a is not null and proposed_j is not null)
    or (kind = 'expense' and customer is null and project is null and category is not null and proposed_allocation is not null
      and proposed_r is null and proposed_a is null and proposed_j is null)
  ),
  constraint unique_sheet_row unique (kind, sheet_row)
);

create index if not exists transactions_employee_idx on public.transactions(employee_id, submitted_at desc);
create index if not exists transactions_status_idx on public.transactions(status);

alter table public.employees enable row level security;
alter table public.telegram_links enable row level security;
alter table public.telegram_contacts enable row level security;
alter table public.transactions enable row level security;
revoke all on public.employees, public.telegram_links, public.telegram_contacts, public.transactions from anon, authenticated;
revoke all on sequence public.sales_sheet_rows, public.expense_sheet_rows from anon, authenticated;

create or replace function public.record_transaction(
  p_employee text, p_source text, p_chat bigint, p_data jsonb
) returns public.transactions
language plpgsql security definer set search_path = public
as $$
declare
  v_role text;
  v_kind text := p_data->>'kind';
  v_ref text := upper(trim(p_data->>'reference'));
  v_description text := trim(p_data->>'description');
  v_amount numeric;
  v_r integer;
  v_a integer;
  v_j integer;
  v_proposal text;
  v_row public.transactions;
begin
  select role into v_role from public.employees where id = p_employee;
  if p_source not in ('website', 'telegram') then raise exception 'Invalid submission source'; end if;
  if v_ref is null or v_ref !~ '^[A-Z][A-Z0-9-]{1,19}$' then raise exception 'Enter a unique reference of 2–20 letters, numbers, or hyphens'; end if;
  if v_description is null or v_description = '' then raise exception 'Description is required'; end if;
  if p_data->>'amount' is null then raise exception 'Amount is required'; end if;
  v_amount := (p_data->>'amount')::numeric;
  if v_amount <= 0 or round(v_amount, 2) <> v_amount then raise exception 'Amount must be greater than zero with at most two decimal places'; end if;
  if v_kind = 'sale' then
    if v_role <> 'sales' then raise exception 'Only salespeople can submit sales'; end if;
    if nullif(trim(p_data->>'customer'), '') is null then raise exception 'Customer is required'; end if;
    if p_data->>'project' not in ('A', 'B') then raise exception 'Choose project A or B'; end if;
    v_r := (p_data->>'proposed_r')::integer;
    v_a := (p_data->>'proposed_a')::integer;
    v_j := (p_data->>'proposed_j')::integer;
    if v_r not between 0 and 100 or v_a not between 0 and 100 or v_j not between 0 and 100
       or v_r + v_a + v_j <> 100 then raise exception 'Commission shares must each be 0–100%% and total 100%%'; end if;
    insert into public.transactions (
      reference, kind, employee_id, source, origin_chat_id, customer, project, description,
      amount, proposed_r, proposed_a, proposed_j, status, sheet_row
    ) values (
      v_ref, 'sale', p_employee, p_source, p_chat, trim(p_data->>'customer'), p_data->>'project',
      v_description, v_amount, v_r, v_a, v_j, 'Pending approval', nextval('public.sales_sheet_rows')
    ) returning * into v_row;
  elsif v_kind = 'expense' then
    if v_role <> 'expenses' then raise exception 'Only Kevin can submit expenses'; end if;
    if p_data->>'category' not in ('Materials', 'Travel', 'Other') then raise exception 'Choose Materials, Travel, or Other'; end if;
    v_proposal := p_data->>'proposed_allocation';
    if v_proposal not in ('A', 'B', 'Company overhead') then raise exception 'Choose A, B, or Company overhead'; end if;
    insert into public.transactions (
      reference, kind, employee_id, source, origin_chat_id, description, amount, category,
      proposed_allocation, final_allocation, status, sheet_row
    ) values (
      v_ref, 'expense', p_employee, p_source, p_chat, v_description, v_amount,
      p_data->>'category', v_proposal,
      case when v_proposal = 'Company overhead' then v_proposal else null end,
      case when v_proposal = 'Company overhead' then 'Allocated' else 'Awaiting allocation' end,
      nextval('public.expense_sheet_rows')
    ) returning * into v_row;
  else
    raise exception 'Choose a sale or expense';
  end if;
  return v_row;
exception when unique_violation then
  raise exception 'Reference % already exists', v_ref;
end;
$$;

create or replace function public.decide_transaction(
  p_manager text, p_reference text, p_split jsonb, p_allocation text
) returns public.transactions
language plpgsql security definer set search_path = public
as $$
declare
  v_role text;
  v_row public.transactions;
  v_r integer;
  v_a integer;
  v_j integer;
  v_chat bigint;
begin
  select role into v_role from public.employees where id = p_manager;
  if v_role <> 'manager' then raise exception 'Only Svetlana can approve or correct transactions'; end if;
  select * into v_row from public.transactions where reference = upper(trim(p_reference)) for update;
  if not found then raise exception 'Transaction not found'; end if;
  if v_row.status in ('Approved', 'Allocated') then raise exception 'This transaction has already been decided'; end if;
  if v_row.kind = 'sale' then
    v_r := (p_split->>'r')::integer;
    v_a := (p_split->>'a')::integer;
    v_j := (p_split->>'j')::integer;
    if v_r not between 0 and 100 or v_a not between 0 and 100 or v_j not between 0 and 100
       or v_r + v_a + v_j <> 100 then raise exception 'Commission shares must each be 0–100%% and total 100%%'; end if;
    update public.transactions set approved_r = v_r, approved_a = v_a, approved_j = v_j,
      status = 'Approved', decided_at = now(), sync_status = 'pending', sync_error = null
      where reference = v_row.reference returning * into v_row;
  else
    if p_allocation not in ('A', 'B', 'Company overhead') then raise exception 'Choose A, B, or Company overhead'; end if;
    update public.transactions set final_allocation = p_allocation,
      status = 'Allocated', decided_at = now(), sync_status = 'pending', sync_error = null
      where reference = v_row.reference returning * into v_row;
  end if;
  v_chat := v_row.origin_chat_id;
  if v_chat is null then
    select chat_id into v_chat from public.telegram_links where employee_id = v_row.employee_id order by linked_at desc limit 1;
  end if;
  update public.transactions set notification_chat_id = v_chat,
    notification_status = case when v_chat is null then 'no_recipient' else 'pending' end,
    notification_error = null where reference = v_row.reference returning * into v_row;
  return v_row;
end;
$$;

revoke all on function public.record_transaction(text,text,bigint,jsonb) from public, anon, authenticated;
revoke all on function public.decide_transaction(text,text,jsonb,text) from public, anon, authenticated;
grant execute on function public.record_transaction(text,text,bigint,jsonb) to service_role;
grant execute on function public.decide_transaction(text,text,jsonb,text) to service_role;
