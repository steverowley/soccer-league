// ── useSeasonPhase.ts ───────────────────────────────────────────────────────
// Shared read of the league calendar for every page that has to decide
// between "show the season" and "show the pre-season state". Errors and
// timeouts surface through the same AsyncData contract as any other read.

import { useSupabase } from '@shared/supabase/SupabaseProvider';
import { useAsyncData, type AsyncData } from '@shared/hooks/useAsyncData';
import { getSeasonPhase, type SeasonPhase } from '../api/seasons';

export function useSeasonPhase(): AsyncData<SeasonPhase> {
  const db = useSupabase();
  return useAsyncData(() => getSeasonPhase(db), [db]);
}
