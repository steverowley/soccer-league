// ── shared/ui ─────────────────────────────────────────────────────────────
// Barrel for app-wide UI primitives. Pages and features import from here
// rather than from the individual files so the public surface stays small
// and ergonomic.
//
// First inhabitants (#383):
//   - ToastProvider / useToast / ToastViewport — global toast surface.
//   - Skeleton / RouteSuspenseFallback         — loading placeholders.
//
// Design-primitive consolidation (#378) will land further additions here
// (Card, Panel, Chip, etc.) as features migrate off inline styles.

export {
  ToastProvider,
  ToastViewport,
  useToast,
  type ToastApi,
  type ToastKind,
} from './Toast';

export {
  Skeleton,
  RouteSuspenseFallback,
} from './Skeleton';
