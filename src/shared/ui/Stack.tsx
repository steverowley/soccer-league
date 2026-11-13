// ── shared/ui/Stack.tsx ───────────────────────────────────────────────────
// The one flex layout primitive (docs/design-language.md section 6): a row
// or column of children with a gap from the spacing scale.
//
// WHY: the same five lines (display flex, direction, gap, align, justify)
// were hand-written about a hundred times across the app. Each copy could
// pick an off-scale gap or forget `flexWrap` on a phone; Stack makes the
// gap a spacing step by type, so an off-scale gap does not compile.
//
// Scope: layout only. Anything that styles the box itself (border, fill,
// padding, type) belongs to a component like Card, not here; `style` is for
// the few layout extras a stack needs in place (margin, width, minWidth,
// flex). `as` keeps the right element for semantics (nav, section, form).

import { forwardRef, type CSSProperties, type FormEvent, type HTMLAttributes, type ReactNode, type Ref } from 'react';
import { layout, space } from '../design';

/** A step on the spacing scale (4, 8, 12, 16, 24, 32, 48, 64). */
export type SpaceStep = keyof typeof space;

/** Elements a Stack may render as. Add one when a page genuinely needs it. */
type StackElement = 'div' | 'section' | 'nav' | 'header' | 'footer' | 'aside' | 'article' | 'form' | 'ul' | 'ol' | 'li' | 'span';

interface StackProps extends Omit<HTMLAttributes<HTMLElement>, 'style' | 'onSubmit'> {
  /** Column (default) stacks top to bottom; row lays children side by side. */
  direction?: 'column' | 'row';
  /** Space between children: a spacing step, or `section` for the gap between page sections (48, 32 on a phone). Omit for none. */
  gap?: SpaceStep | 'section';
  /** Cross-axis alignment (CSS align-items). */
  align?: CSSProperties['alignItems'];
  /** Main-axis distribution (CSS justify-content). */
  justify?: CSSProperties['justifyContent'];
  /** Let children wrap onto new lines (rows that must fit a phone). */
  wrap?: boolean;
  /** The element to render (default div). */
  as?: StackElement;
  /** Form submit handler, for `as="form"`. */
  onSubmit?: (event: FormEvent<HTMLFormElement>) => void;
  /** Form validation opt-out, for `as="form"`. */
  noValidate?: boolean;
  /** Layout extras only (margin, width, minWidth, flex). Never colours, type or borders. */
  style?: CSSProperties;
  children?: ReactNode;
}

/**
 * A flex row or column with an on-scale gap.
 *
 * @returns The chosen element laid out as a flex container.
 */
export const Stack = forwardRef<HTMLElement, StackProps>(function Stack(
  { direction = 'column', gap, align, justify, wrap = false, as = 'div', style, children, ...rest },
  ref,
) {
  const Element = as as 'div';
  return (
    <Element
      ref={ref as Ref<HTMLDivElement>}
      {...(rest as unknown as HTMLAttributes<HTMLDivElement>)}
      style={{
        display: 'flex',
        flexDirection: direction,
        ...(gap != null ? { gap: gap === 'section' ? layout.sectionGap : space[gap] } : null),
        ...(align != null ? { alignItems: align } : null),
        ...(justify != null ? { justifyContent: justify } : null),
        ...(wrap ? { flexWrap: 'wrap' } : null),
        ...style,
      }}
    >
      {children}
    </Element>
  );
});
