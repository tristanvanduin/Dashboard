-- 019 (M4): de merkgids-opslag op client-niveau. De briefing-route leest deze kolom en
-- degradeert naar een lege gids als hij ontbreekt of leeg is (emptyBrandGuide).
alter table client_settings add column if not exists brand_guide jsonb;
