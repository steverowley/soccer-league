-- 0091_replays_bucket.sql
-- Storage bucket for match replays: one gzipped file per match,
-- replays/<match_id>.json.gz.
--
-- WHY (docs/mvp-free-tier.md, decision 1; incident #712): replay frames stored
-- as Postgres rows cost about 2.6 MB per match, so one 224-match season of
-- replays (about 590 MB) was larger than the free plan's whole 500 MB database
-- quota. The same roster plus compact v2 frames, gzipped, measure about
-- 0.2 MB per match and live in Storage's separate 1 GB allowance.
--
-- ACCESS
--   Public read: the viewer fetches the file from its public URL with no
--   auth, exactly as match_positions was public-read once a match was
--   simulated, so spoilers are no worse than before.
--   Service-role write: the match-worker uploads with the service role, which
--   bypasses Storage RLS. No insert/update/delete policy is created for anon
--   or authenticated, so nobody else can write or delete.
--
-- LIMITS
--   file_size_limit 5 MB: a replay is about 0.2 MB; this only stops a runaway.
--   allowed_mime_types: the worker uploads application/gzip, nothing else.
--
-- Retention (keep the bucket under 800 MB, oldest first) runs from the
-- db-maintenance workflow: scripts/db-maintenance.ts replay-retention.
--
-- Idempotent: safe to re-run.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('replays', 'replays', true, 5242880, ARRAY['application/gzip'])
ON CONFLICT (id) DO NOTHING;

-- Converge the settings if the bucket already existed with different ones
-- (for example created by hand in the dashboard). No-op when they match.
UPDATE storage.buckets
   SET public             = true,
       file_size_limit    = 5242880,
       allowed_mime_types = ARRAY['application/gzip']
 WHERE id = 'replays'
   AND (public IS DISTINCT FROM true
        OR file_size_limit IS DISTINCT FROM 5242880
        OR allowed_mime_types IS DISTINCT FROM ARRAY['application/gzip']);
