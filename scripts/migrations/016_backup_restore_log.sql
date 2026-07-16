-- 014 (Z2): bewijslog van restore-tests.
create table if not exists backup_restore_log (
  id          bigint generated always as identity primary key,
  test_date   date not null,
  dump_file   text not null,
  result      text not null check (result in ('ok','failed')),
  duration_s  integer,
  notes       text,
  created_at  timestamptz not null default now()
);
