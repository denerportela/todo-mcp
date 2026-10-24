-- Guarda o refresh token da conta Microsoft (uma linha só, id = 'default').
-- RLS ligado e sem policies: apenas a service role (backend) consegue ler/gravar.
create table if not exists public.ms_todo_tokens (
  id text primary key default 'default',
  refresh_token text not null,
  account_name text,
  updated_at timestamptz not null default now()
);

alter table public.ms_todo_tokens enable row level security;
