-- 000: migratie-administratie (fundament voor alle volgende files)
-- Idempotent. De runner registreert hier elke toegepaste migratie met checksum.
create table if not exists schema_migrations (
  filename   text primary key,
  checksum   text not null,
  applied_at timestamptz not null default now()
);
