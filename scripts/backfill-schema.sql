-- ============================================================================
-- Drop the old duplicate tables (account_metrics_*, campaign_metrics_*, etc.)
-- These were created during the initial backfill but are superseded by the
-- ads_* tables. Run this ONCE to clean up.
-- ============================================================================

DROP TABLE IF EXISTS account_metrics_monthly;
DROP TABLE IF EXISTS account_metrics_weekly;
DROP TABLE IF EXISTS campaign_metrics_monthly;
DROP TABLE IF EXISTS campaign_impression_share;
DROP TABLE IF EXISTS ad_group_performance;
DROP TABLE IF EXISTS wasteful_search_terms;
DROP TABLE IF EXISTS change_history;
