// ── shared/ui ─────────────────────────────────────────────────────────────
// Barrel for app-wide UI primitives. Pages and features import from here
// rather than from the individual files so the public surface stays small
// and ergonomic.
//
// Inhabitants so far:
//   - ToastProvider / useToast / ToastViewport — global toast surface (#383)
//   - Skeleton / RouteSuspenseFallback         — loading placeholders (#383)
//   - Card                                     — canonical content card (#378)
//   - Chip                                     — bordered small-caps pill (#378)
//
// Design-primitive consolidation (#378) will land further additions here
// (Panel, EmptyState, …) as features migrate off inline styles.

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

export {
  Card,
  type CardTone,
} from './Card';

export {
  Chip,
  type ChipTone,
} from './Chip';
