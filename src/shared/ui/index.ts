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
//   - EmptyState                               — "nothing here" surface (#378)
//   - Kicker                                   — uppercase mono label (#378)
//   - Pip                                      — filled-circle indicator (#378)
//   - StatPair                                 — label-above-value cell (#378)
//   - KeyValue                                 — horizontal label : value (#378)
//
// Design-primitive consolidation (#378) will land further additions here
// (Panel, SectionPanel, …) as features migrate off inline styles.

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

export {
  EmptyState,
} from './EmptyState';

export {
  Kicker,
} from './Kicker';

export {
  Pip,
} from './Pip';

export {
  StatPair,
} from './StatPair';

export {
  KeyValue,
} from './KeyValue';

export {
  SectionPanel,
} from './SectionPanel';

export {
  Button,
  type ButtonVariant,
} from './Button';
