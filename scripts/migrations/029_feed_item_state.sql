-- 029 feed_item_state — UI/workflow-state voor de "Vandaag"-triagefeed (Fase 1).
--
-- Puur presentatie-/workflow-state. Deze tabel:
--   * wijzigt GEEN bestaande analyse-, SOP-, forecast-, recommendation- of task-tabel;
--   * bevat uitsluitend overlay-state (snooze, reden, toegewezen eigenaar, handmatige status);
--   * is niet leidend — de oorspronkelijke brondata blijft leidend. Als een item automatisch
--     uit de data oplost (verdwijnt uit de bron), gaat dat vóór elke handmatige status hier.
--
-- item_key is de stabiele feed-sleutel `${source}:${clientId}:${naturalId}` en is uniek:
-- één overlay-rij per feed-item. Idempotent addendum, raakt niets bestaands aan.

CREATE TABLE IF NOT EXISTS feed_item_state (
  item_key       text PRIMARY KEY,           -- `${source}:${clientId}:${naturalId}`
  client_id      text NOT NULL,
  source         text NOT NULL,              -- signal | queue | task | recommendation | tracking | pacing | manual
  assigned_owner text,                       -- handmatig toegewezen eigenaar (naam), overschrijft mock
  snoozed_until  timestamptz,                -- actief zolang > now()
  snooze_reason  text,                       -- verplicht bij snooze (afgedwongen in de UI)
  feed_status    text,                       -- new | in_progress | awaiting_approval | snoozed | resolved
  updated_by     text,                       -- wie de laatste wijziging deed (e-mail/id)
  updated_at     timestamptz DEFAULT now(),
  created_at     timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_feed_item_state_client ON feed_item_state(client_id);
CREATE INDEX IF NOT EXISTS idx_feed_item_state_snooze ON feed_item_state(snoozed_until);
