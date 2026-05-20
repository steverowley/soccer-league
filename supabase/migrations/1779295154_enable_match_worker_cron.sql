-- Enable pg_cron and pg_net extensions
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Schedule the match-worker edge function to run every minute
-- This polls for due matches and simulates them in real-time
SELECT cron.schedule(
  'trigger-match-worker',
  '* * * * *',
  $$
  SELECT net.http_post(
    url := 'https://ddtpbipkqamuxnvupddc.supabase.co/functions/v1/clever-processor',
    body := '{}'::jsonb,
    headers := jsonb_build_object('Content-Type', 'application/json')
  ) AS request_id;
  $$
);
