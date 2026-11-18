-- Fairway Next: database schema for Supabase (run once in the SQL editor of a new project).
-- The game only ever uses the public anon key; row level security below decides what each
-- signed-in player may read and write. No service role key is used or needed by the game.

-- Profiles: a display name per player, readable by everyone (it shows on leaderboards).
create table if not exists public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null check (char_length(display_name) between 3 and 18),
  updated_at timestamptz not null default now()
);

-- Saves: one row per player, the whole game save as JSON. Private to its owner.
create table if not exists public.saves (
  user_id uuid primary key references auth.users (id) on delete cascade,
  data jsonb not null,
  version int not null default 4,
  updated_at timestamptz not null default now()
);

-- Scores: casual leaderboard entries. Readable by everyone, written by their owner only.
create table if not exists public.scores (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  board text not null check (board in ('daily', 'longdrive', 'target', 'level')),
  period text not null check (char_length(period) <= 12),
  value int not null,
  display_name text not null check (char_length(display_name) between 1 and 18),
  created_at timestamptz not null default now(),
  -- The same sane bounds the game applies before upload.
  constraint score_bounds check (
    (board = 'daily' and value between -9 and 18) or
    (board = 'longdrive' and value between 50 and 420) or
    (board = 'target' and value between 0 and 2500) or
    (board = 'level' and value between 1 and 40)
  )
);
create index if not exists scores_board_period on public.scores (board, period, value);

alter table public.profiles enable row level security;
alter table public.saves enable row level security;
alter table public.scores enable row level security;

create policy "profiles are readable by everyone" on public.profiles for select using (true);
create policy "players write their own profile" on public.profiles for insert with check (auth.uid() = user_id);
create policy "players update their own profile" on public.profiles for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "players read their own save" on public.saves for select using (auth.uid() = user_id);
create policy "players write their own save" on public.saves for insert with check (auth.uid() = user_id);
create policy "players update their own save" on public.saves for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "scores are readable by everyone" on public.scores for select using (true);
create policy "players post their own scores" on public.scores for insert with check (auth.uid() = user_id);

-- Delete my account: removes the caller's rows and their auth user. Security definer so it
-- can remove the auth row; it only ever acts on auth.uid(), the caller.
create or replace function public.delete_my_account()
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not signed in';
  end if;
  delete from public.scores where user_id = auth.uid();
  delete from public.saves where user_id = auth.uid();
  delete from public.profiles where user_id = auth.uid();
  delete from auth.users where id = auth.uid();
  return true;
end;
$$;
revoke all on function public.delete_my_account() from public;
grant execute on function public.delete_my_account() to authenticated;
