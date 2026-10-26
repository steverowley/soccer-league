-- 0095_commentary_club_names.sql
--
-- Rewrites stored match commentary that named a club by its three-letter code
-- ("EUN adjust. Amara Diallo on.") or as "the home side" / "the away side"
-- ("Corner for the away side."). Season 1's first matchday wrote 252 such
-- lines out of 863: the worker filled the commentators' <team> slot from
-- `payload.team`, which is the club's code (a machine key the worker matches
-- goals on), and corners carry no team at all. The worker now names the club
-- from the event's side (commentary.ts, spokenClubName); this brings the lines
-- already played into line with it.
--
-- Spoken name = teams.name without a trailing FC / AFC / SC, the same rule as
-- spokenClubName(). Only the commentary text changes: payload.team (the code)
-- is left alone, because the worker and the score check match on it.
--
-- Idempotent: once rewritten, no code or "the home/away side" remains, so a
-- re-run changes nothing.

WITH tm AS (
  SELECT id,
         short_name AS code,
         regexp_replace(trim(name), '\s+(A?FC|SC)$', '') AS spoken
    FROM public.teams
   WHERE short_name IS NOT NULL
),
ev AS (
  SELECT e.id,
         e.payload->>'commentary' AS old,
         h.code AS hc, h.spoken AS hs,
         a.code AS ac, a.spoken AS asp
    FROM public.match_events e
    JOIN public.matches m ON m.id = e.match_id
    JOIN tm h ON h.id = m.home_team_id
    JOIN tm a ON a.id = m.away_team_id
   WHERE e.payload ? 'commentary'
     AND e.type IN ('out_corner', 'substitution', 'goal', 'woodwork', 'penalty', 'shot')
),
fixed AS (
  SELECT id,
         old,
         regexp_replace(
           regexp_replace(
             regexp_replace(
               regexp_replace(old, '\m' || hc || '\M', hs, 'g'),
               '\m' || ac || '\M', asp, 'g'),
             '\mthe home side\M', hs, 'gi'),
           '\mthe away side\M', asp, 'gi') AS new
    FROM ev
)
UPDATE public.match_events e
   SET payload = jsonb_set(e.payload, '{commentary}', to_jsonb(f.new))
  FROM fixed f
 WHERE e.id = f.id
   AND f.new IS DISTINCT FROM f.old;
