// ── shared/ui ─────────────────────────────────────────────────────────────
// Barrel for app-wide UI primitives. Pages and features import from here
// rather than from the individual files so the public surface stays small
// and ergonomic.
//
// Inhabitants so far:
//   - ToastProvider / useToast / ToastViewport — global toast surface (#383)
//   - Skeleton / RouteSuspenseFallback         — loading placeholders (#383)
//   - Card                                     — canonical content card (#378)
//   - EmptyState                               — "nothing here" surface (#378)
//   - SectionPanel, Button, data states        (#378)
//   - The design language components below (docs/design-language.md).
//
// Chip, Kicker, Pip, StatPair and KeyValue (#378) were deleted with the
// design system's last group: Tag, the `label` type preset, StatBlock and
// FactRows replace them, and nothing rendered them any more.

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
  EmptyState,
} from './EmptyState';

export {
  SectionPanel,
} from './SectionPanel';

export {
  Button,
  type ButtonVariant,
} from './Button';

export {
  LoadingState,
  ErrorState,
  PreSeasonState,
  AsyncView,
  formatKickoffDate,
} from './DataState';

// ── Design language components (docs/design-language.md, section 6) ──────
export { PageShell } from './PageShell';
export { PageHeader } from './PageHeader';
export { SectionHeader, toRoman } from './SectionHeader';
export { Tag, type TagTone } from './Tag';
export { LiveBadge } from './LiveBadge';
export { BackLink } from './BackLink';
export { Breadcrumbs, type Crumb } from './Breadcrumbs';
export { Crest, type CrestSize } from './Crest';
export { StatBlock, type StatTone } from './StatBlock';
export { FormPip, FormStrip, type FormResult } from './FormStrip';
export { DataTable, dataCell, dataHead } from './DataTable';
export { FactGrid, FactRows } from './FactList';
export { Field, CheckField, FormError, inputStyle } from './Field';
export { Prose, ProseSection, Paragraph, TextLink } from './Prose';
