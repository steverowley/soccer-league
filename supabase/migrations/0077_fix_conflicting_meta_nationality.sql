-- ── 0077_fix_conflicting_meta_nationality.sql ──────────────────────────────
-- Data hygiene. 13 entities stored `nationality` twice — once at the top level
-- of `meta` and once under `meta.profile` — with DISAGREEING values (e.g.
-- "Callistoan" vs "Callistian", "Mining Colony" vs "Belt Colonist"). The
-- `meta.profile.nationality` form is the authored canonical demonym, so align
-- the redundant top-level copy to it. Only rows where the two genuinely
-- conflict are touched; the rows that already agree are left untouched.
UPDATE entities
SET meta = jsonb_set(meta, '{nationality}', meta -> 'profile' -> 'nationality', false)
WHERE meta ? 'nationality'
  AND meta -> 'profile' ? 'nationality'
  AND meta ->> 'nationality' IS DISTINCT FROM meta -> 'profile' ->> 'nationality';
