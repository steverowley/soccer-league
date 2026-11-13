// ── Components.tsx ──────────────────────────────────────────────────────────
// `/dev/components` — internal design-system reference, not in fan nav.
//
// WHY: modelled on Meta's Astryx library (astryx.atmeta.com/components): one
// page that browses every shared/ui primitive, grouped by purpose, each with
// a live rendered example instead of a prose description. Astryx exists so
// builders (human or agent) reuse the system instead of re-deriving it one
// page at a time; this is the same idea sized to what ISL actually has.
//
// Every example below renders the REAL component from shared/ui on the
// REAL tokens (src/shared/design) — never a mocked look-alike — so this page
// drifts the moment a component's own style changes, which is the point: a
// stale screenshot cannot happen here.
//
// Dev-only: reachable at /dev/components by direct URL, not linked from the
// site header or footer. It still obeys every house rule (PageHeader owns
// the one h1, no raw style values — scripts/designTokens.test.ts scans this
// file like any other) because it is as much a candidate for drift as any
// fan page, and because showing a borrowed hack here would teach it to the
// next builder who copies this page as a template.
//
// Scope: a live swatch per shared/ui export (docs/design-language.md
// section 6), grouped the way Astryx groups its 150+ components, plus a
// closing "Gaps" section naming the Astryx categories ISL has nothing in
// yet — so the page doubles as the system's own backlog.

import { useState } from 'react';
import { usePageTitle } from '../shared/hooks/usePageTitle';
import { color, space, tone, type } from '../shared/design';
import {
  BackLink,
  Breadcrumbs,
  Button,
  Card,
  CheckField,
  Crest,
  DataTable,
  EmptyState,
  ErrorState,
  FactGrid,
  FactRows,
  Field,
  FormError,
  FormStrip,
  LiveBadge,
  LoadingState,
  PageHeader,
  PageShell,
  PreSeasonState,
  Prose,
  Paragraph,
  ProseSection,
  SectionHeader,
  Skeleton,
  StatBlock,
  Tag,
  TextLink,
  inputStyle,
  dataCell,
  dataHead,
  useToast,
} from '../shared/ui';

// ── Local showcase chrome ───────────────────────────────────────────────────
// Not exported: this page's own layout, built from tokens like any page.

/** One component's entry: name, one-line purpose, a live example. */
function Entry({
  name,
  purpose,
  children,
}: {
  name: string;
  purpose: string;
  children: React.ReactNode;
}) {
  return (
    <Card style={{ display: 'flex', flexDirection: 'column', gap: space[16], minWidth: 0 }}>
      <div>
        <div style={{ ...type.subheading, margin: 0 }}>{name}</div>
        <p style={{ ...type.small, ...tone.secondary, margin: 0, marginTop: space[4] }}>{purpose}</p>
      </div>
      <div
        style={{
          ...tone.primary,
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: space[12],
          paddingTop: space[16],
          borderTop: `1px solid ${color.lineFaint}`,
        }}
      >
        {children}
      </div>
    </Card>
  );
}

/** Auto-fitting grid of Entry cards: the Astryx "browse the library" shelf. */
function Shelf({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(min(320px, 100%), 1fr))',
        gap: space[16],
        alignItems: 'start',
      }}
    >
      {children}
    </div>
  );
}

/** One category: a numbered SectionHeader over its Shelf. */
function Category({
  index,
  label,
  subtitle,
  children,
}: {
  index: string;
  label: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <SectionHeader index={index} label={label} subtitle={subtitle} />
      <Shelf>{children}</Shelf>
    </section>
  );
}

/** A labelled row, for packing several small variants into one Entry. */
function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: space[8] }}>
      <div style={{ ...type.label, ...tone.secondary }}>{label}</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: space[8] }}>{children}</div>
    </div>
  );
}

/** Interactive toast demo: proves ToastViewport is already mounted app-wide. */
function ToastDemo() {
  const toast = useToast();
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: space[8] }}>
      <Button variant="secondary" onClick={() => toast.success('Saved.')}>Fire success</Button>
      <Button variant="secondary" onClick={() => toast.error('Could not save.')}>Fire error</Button>
      <Button variant="secondary" onClick={() => toast.info('Season 4 starts Friday.')}>Fire info</Button>
    </div>
  );
}

/** Interactive CheckField demo: needs local state to stay controlled. */
function CheckFieldDemo() {
  const [checked, setChecked] = useState(false);
  return (
    <CheckField id="design-system-demo-check" checked={checked} onChange={setChecked} hint="Toggles like any other CheckField.">
      I am 18 or older.
    </CheckField>
  );
}

const SAMPLE_FORM: Array<'W' | 'D' | 'L'> = ['W', 'W', 'D', 'L', 'W'];

export default function Components() {
  usePageTitle('Design system');
  return (
    <PageShell>
      <PageHeader
        eyebrow="Internal"
        title="Design system"
        subtitle={
          <>
            Every reusable primitive in <code>src/shared/ui</code>, grouped the way{' '}
            <TextLink href="https://astryx.atmeta.com/components" newTab>Astryx</TextLink> groups its own
            library, each rendered live from the real tokens. Build pages from these; never a raw
            colour, font size or letter spacing (<code>scripts/designTokens.test.ts</code> is a hard zero).
          </>
        }
      />

      <Category index="I" label="Action" subtitle="The one button, and the generic data-retry controls.">
        <Entry name="Button" purpose="The one button: primary, secondary, tertiary, disabled.">
          <Row label="Variants">
            <Button variant="primary">Primary</Button>
            <Button variant="secondary">Secondary</Button>
            <Button variant="tertiary">Tertiary</Button>
            <Button variant="secondary" disabled>Disabled</Button>
          </Row>
        </Entry>
      </Category>

      <Category index="II" label="Container" subtitle="The hairline box, and the box with a header strip.">
        <Entry name="Card" purpose="The hairline box. Tones carry meaning: default, architect, live.">
          <Row label="Tones">
            <Card tone="default" padding={12} style={{ minWidth: 120 }}><span style={{ ...type.small }}>Default</span></Card>
            <Card tone="architect" padding={12} style={{ minWidth: 120 }}><span style={{ ...type.small, color: color.architect }}>Architect</span></Card>
            <Card tone="live" padding={12} style={{ minWidth: 120 }}><span style={{ ...type.small, color: color.live }}>Live</span></Card>
          </Row>
        </Entry>
        <Entry name="PageShell" purpose="Header, flex-grow main column, footer. This page is one.">
          <p style={{ ...type.small, ...tone.secondary, margin: 0 }}>
            Every route is <code>&lt;PageShell&gt;&lt;PageHeader /&gt;...sections...&lt;/PageShell&gt;</code>. See
            the top of this page for a live instance; it is not re-nested here to avoid a second header
            and footer on one screen.
          </p>
        </Entry>
      </Category>

      <Category
        index="III"
        label="Content"
        subtitle="Headings, labels, badges and prose. PageHeader and this page's own SectionHeaders are already live above."
      >
        <Entry name="PageHeader" purpose="Every page's h1, back link, crumbs, crest and meta row.">
          <p style={{ ...type.small, ...tone.secondary, margin: 0 }}>
            This page's own header, at the top, is a live instance. Not re-rendered here: a second
            <code>&lt;h1&gt;</code> on one page breaks the one-heading rule
            (<code>src/pages/pageHeadings.test.ts</code>).
          </p>
        </Entry>
        <Entry name="SectionHeader" purpose="The h2 that opens a page section: numeral, label, title, optional action.">
          <div style={{ width: '100%' }}>
            <SectionHeader index="A" label="Example" title="A section title" subtitle="An optional one-sentence subtitle." />
          </div>
        </Entry>
        <Entry name="StatBlock" purpose="Label over value: the one way a page shows a single figure.">
          <Row label="Tones">
            <StatBlock label="Position" value="2nd" />
            <StatBlock label="Record" value="W4 D1 L1" valueTone="success" />
            <StatBlock label="Minute" value="73'" valueTone="live" />
          </Row>
        </Entry>
        <Entry name="Tag" purpose="Hairline label for categories, filters and statuses. selected flips the fill.">
          <Row label="Tones">
            <Tag>Dispatch</Tag>
            <Tag tone="architect">Architect</Tag>
            <Tag tone="live">Red card</Tag>
            <Tag tone="success">Qualified</Tag>
            <Tag selected>Selected</Tag>
          </Row>
        </Entry>
        <Entry name="LiveBadge" purpose="The only way 'live' is shown: red dot plus minute, or 'Full time'.">
          <Row label="States">
            <LiveBadge />
            <LiveBadge minute={73} />
            <LiveBadge fullTime />
          </Row>
        </Entry>
        <Entry name="Crest" purpose="Club shield silhouette at four fixed sizes; null paints a neutral shield.">
          <Row label="Sizes">
            <Crest color={color.action} size={16} title="16" />
            <Crest color={color.success} size={24} title="24" />
            <Crest color={color.architect} size={40} title="40" />
            <Crest color={null} size={64} title="64, no club colour" />
          </Row>
        </Entry>
        <Entry name="Prose / ProseSection / Paragraph / TextLink" purpose="The one long-form copy style: About, Privacy, Terms.">
          <div style={{ width: '100%' }}>
            <Prose>
              <ProseSection index="B" title="Example section">
                <Paragraph>
                  Body copy at the reading measure, with an inline <TextLink href="#" >TextLink</TextLink> for
                  running-text links.
                </Paragraph>
              </ProseSection>
            </Prose>
          </div>
        </Entry>
      </Category>

      <Category index="IV" label="Feedback & Status" subtitle="Loading, error, empty, pre-season and toast states; the form-result strip.">
        <Entry name="EmptyState" purpose="The 'nothing here' surface: say what will appear and when.">
          <div style={{ width: '100%' }}>
            <EmptyState kicker="No bets" hint="Browse fixtures to place one.">
              You have not placed any wagers yet.
            </EmptyState>
          </div>
        </Entry>
        <Entry name="LoadingState / ErrorState / PreSeasonState" purpose="The three states every async section renders while it waits on Supabase.">
          <div style={{ display: 'flex', flexDirection: 'column', gap: space[12], width: '100%' }}>
            <LoadingState label="Loading fixtures" />
            <ErrorState what="the fixtures" onRetry={() => {}} />
            <PreSeasonState seasonName="Season 5" detail="Standings will appear once it kicks off." />
          </div>
        </Entry>
        <Entry name="Toast" purpose="App-wide transient confirmation. ToastProvider is already mounted; this fires a real one.">
          <ToastDemo />
        </Entry>
        <Entry name="Skeleton" purpose="Flat loading placeholder; no shimmer, respects reduced motion.">
          <div style={{ display: 'flex', flexDirection: 'column', gap: space[8], width: '100%', maxWidth: 240 }}>
            <Skeleton height={12} width={100} />
            <Skeleton height={20} width="70%" />
          </div>
        </Entry>
        <Entry name="FormPip / FormStrip" purpose="Recent results as a row of W/D/L tiles. Red never means a result.">
          <FormStrip form={SAMPLE_FORM} slots={5} />
        </Entry>
      </Category>

      <Category index="V" label="Form Controls" subtitle="The one field style, the one checkbox row, the one error line.">
        <Entry name="Field" purpose="Label above a hairline control on the raised surface, with hint and error lines.">
          <div style={{ width: '100%', maxWidth: 320 }}>
            <Field id="design-system-demo-email" label="Email" hint="We never show it.">
              <input id="design-system-demo-email" type="email" style={inputStyle} placeholder="you@example.com" />
            </Field>
          </div>
        </Entry>
        <Entry name="CheckField" purpose="A checkbox whose whole sentence is the tap target.">
          <CheckFieldDemo />
        </Entry>
        <Entry name="FormError" purpose="Red, small, role=alert: the one error line under a field or form.">
          <FormError>Passwords must be at least 8 characters.</FormError>
        </Entry>
      </Category>

      <Category index="VI" label="Navigation" subtitle="Detail-page back link and breadcrumb trail.">
        <Entry name="BackLink" purpose="'◂ All clubs': the one back-to-listing spelling.">
          <BackLink to="/dev/components">All clubs</BackLink>
        </Entry>
        <Entry name="Breadcrumbs" purpose="'Leagues / Rocky Inner / Earth United', last crumb unlinked.">
          <Breadcrumbs
            items={[
              { label: 'Leagues', to: '/leagues' },
              { label: 'Rocky Inner', to: '/leagues' },
              { label: 'Earth United' },
            ]}
          />
        </Entry>
      </Category>

      <Category index="VII" label="Table & List" subtitle="The one table look, and the two ways a page lists facts.">
        <Entry name="DataTable / dataHead / dataCell" purpose="label headers, small cells, faint row rules, tabular numbers.">
          <div style={{ width: '100%' }}>
            <DataTable caption="Example standings">
              <thead>
                <tr>
                  <th style={dataHead()}>Club</th>
                  <th style={dataHead('right')}>Pts</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td style={dataCell()}>Earth United</td>
                  <td style={dataCell('right')}>42</td>
                </tr>
                <tr>
                  <td style={dataCell()}>Mars Reds</td>
                  <td style={dataCell('right')}>39</td>
                </tr>
              </tbody>
            </DataTable>
          </div>
        </Entry>
        <Entry name="FactGrid" purpose="Label-over-value pairs in an auto-fitting grid; short prose values.">
          <div style={{ width: '100%' }}>
            <FactGrid facts={[['Kit', 'Blue with white trim'], ['Ground', 'The Marbles'], ['Founded', '2431']]} />
          </div>
        </Entry>
        <Entry name="FactRows" purpose="Hairline-separated rows: the one list style for the whole site, no bullets.">
          <div style={{ width: '100%' }}>
            <FactRows
              label="Honours"
              items={[
                { key: 'a', content: 'Celestial Cup, Season 2' },
                { key: 'b', content: 'Rocky Inner League, Season 3' },
              ]}
            />
          </div>
        </Entry>
      </Category>

      <Category
        index="VIII"
        label="Gaps"
        subtitle="Astryx categories with nothing (or very little) in ISL yet. Not a build queue, a backlog."
      >
        <Entry name="Overlay" purpose="Dialog, Drawer, Popover, Tooltip, CommandPalette, Lightbox: none exist. Toast is the only overlay primitive today.">
          <p style={{ ...type.small, ...tone.secondary, margin: 0 }}>
            Every confirm-before-delete and settings drawer currently hand-rolls its own markup.
          </p>
        </Entry>
        <Entry name="Layout" purpose="AppShell, Grid, Stack, Divider, ScrollableArea: PageShell covers the page frame; nothing names a reusable grid or stack.">
          <p style={{ ...type.small, ...tone.secondary, margin: 0 }}>
            Shelf and Row above are this page's own throwaway layout helpers, which is exactly the
            kind of thing a shared Stack/Grid would absorb.
          </p>
        </Entry>
        <Entry name="Navigation" purpose="SideNav, TopNavMegaMenu, Pagination, Stepper, TabList: Header.tsx hand-rolls the top nav; no pagination primitive exists anywhere lists paginate.">
          <p style={{ ...type.small, ...tone.secondary, margin: 0 }}>
            Worth a pass once a list page actually needs paging.
          </p>
        </Entry>
        <Entry name="Form Controls" purpose="Selector, DateInput, NumberInput, Switch, TextArea: only text input, checkbox and the raw inputStyle token exist.">
          <p style={{ ...type.small, ...tone.secondary, margin: 0 }}>
            Admin and Voting forms build selects and date pickers ad hoc today.
          </p>
        </Entry>
      </Category>
    </PageShell>
  );
}
