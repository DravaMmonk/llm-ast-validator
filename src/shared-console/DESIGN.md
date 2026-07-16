# Console Design System

The contract for every UI change that consumes the shared console kit.
Application build and UI-lint gates enforce the mechanical rules; this document
explains them and carries the ones a script cannot check. When you need a new
pattern, extend [`src/kit.tsx`](src/kit.tsx) — never hand-roll a second variant
of something that exists.

## 1. Tokens

All color comes from CSS variables in [`src/tokens.css`](src/tokens.css)
(`:root` light / `.dark` overrides), surfaced as Tailwind utilities in
`tailwind.config.js`:

- **Surfaces** `bg`, `card`, `card-2`, `elev`, `muted`, `faint`
- **Text** `fg`, `fg-strong`, `muted-fg`
- **Lines** `border`, `border-2`, `grid`
- **Brand** `primary`, `primary-fg`, `primary-soft`
- **Semantic** `info`, `accent2`, `warn`, `bad`
- **Risk bands** `risk-low`, `risk-mod`, `risk-elev`, `risk-high` (+`-soft`)

No hex colors, no Tailwind palette literals (`bg-green-100`), no `text-white`
outside over-media overlays (lint rules R1/R2/R6).

## 2. Type scale (lint R3/R4)

Named sizes only — defined in `tailwind.config.js`:

| class        | px   | role                                     |
| ------------ | ---- | ---------------------------------------- |
| `text-nano`  | 8    | smallest mono annotations                |
| `text-micro` | 8.5  | table micro-labels, axis ticks           |
| `text-tag`   | 9    | chips, badges, pills                     |
| `text-fine`  | 9.5  | dense mono numerals/readouts             |
| `text-cap`   | 10   | section captions (`capSm`), dense meta   |
| `text-dense` | 10.5 | compact selects, secondary meta          |
| `text-label` | 11   | pane captions (`cap`), KV rows           |
| `text-body`  | 11.5 | table cells, list rows                   |
| `text-ui`    | 12   | buttons, inputs, body copy               |
| `text-emph`  | 12.5 | emphasized inline values                 |
| `text-md`    | 13   | emphasized body, empty-state titles      |
| `text-title` | 14   | page/pane titles                         |

The half-pixel steps mirror the original hand-tuned design — dense mono
readouts sit between the integer steps on purpose. Never consolidate them:
the hierarchy collapses visibly on retina displays.

Display numerals (15–24px) stay arbitrary and rare. Letter-tracking: use kit
`cap` (0.1em) / `capSm` (0.06em); the only other sanctioned values are 0.05em
(micro labels) and ±0.01/0.02em (display titles).

## 3. Component vocabulary (`src/console/kit.tsx`)

- **Layout** `Page` → `Pane(w?)` → `PaneHeader(label,count)` / `PaneBody` /
  `PaneFooter`. Flush panes divided by borders; no floating cards at page
  level (`ui-card` is for the legacy pages' simple forms only).
- **Buttons** — max ONE `primaryBtn` per pane. Supporting `pillBtn`, tinted
  tertiary `softBtn`, destructive `dangerBtn` (always behind `ConfirmDialog`),
  dense/icon `ghostBtn`.
- **Forms** `inputCls` / `inputSmCls` / `selectCls` / `selectSmCls` /
  `textareaCls` / `checkboxCls`. Append width/flex utilities only — never a
  conflicting size/padding/text class.
- **Badges** — one rounded-full tinted silhouette: `Chip` (category,
  uppercase), `StatusPill` (run state, dot, `pulse` for in-flight),
  `StageChip`/`CurrentChip` (version lanes, in `versioning/`). Colors resolve
  from `statusColor()`/`STAGE_META` — never a local color table.
- **Master lists** — every list-detail rail uses `MasterListPane` at the shared
  280px width. `MasterListSearch` plus `matchesMasterListSearch` own consistent
  search UI/semantics; `MasterListGroup` owns collapsible sticky category bars;
  `MasterListItem` owns the thin single-line name-only row.
  Drawer-based master lists use the same primitives and `MASTER_LIST_WIDTH`.
- **Selection** — master-list rows use `MasterListItem` (muted fill + 3px primary
  inset bar); other row-like surfaces use `selectedRowStyle`; cards use
  `selectedCardStyle` (primary border). Row hover is `hover:bg-muted`.
- **Tabs** — `TabBar` (underline) switches pane sections; `SegTabs` (boxed)
  toggles a small inline mode. Never both for the same role in one pane.
- **Versions** — embedded workspaces use `VersionDropdown` with the shared
  `VersionList` row anatomy; full lifecycle management remains in Versions.
- **Tables** — `thCls` / `tdCls` / `trHoverCls`; ids/dates/numbers get
  `ui-mono`.
- **Overlays** — `Modal` (scroll-lock, dialog semantics), `Drawer`, `Popover`
  (click-catcher included). All close on Escape via a shared overlay stack —
  never add your own Escape listener for them. Menus close on select;
  filter-checkbox popovers stay open.
- **Feedback** — `toast()` for transient confirmations (one `<Toaster/>`
  mounted in ConsoleLayout), `ConfirmDialog` for destructive actions,
  `LoadingState` / `EmptyState` for pane states. Inline error text is
  `text-ui` colored `var(--bad)` — never squeezed into a Chip.

## 4. Layout & zoom uniformity

- The console is a data-dense desktop surface. **The desktop layout never
  adapts to the CSS viewport width** — no auto-collapsing, no hiding, no
  re-wrapping at desktop breakpoints. Browser zoom narrows the CSS viewport,
  and zoom must scale the page uniformly, exactly as the original design
  does; width-driven re-arrangement reads as a broken layout to a zoomed
  user. Phone adaptations live exclusively behind the `mobile:` screen /
  `useMobile()` (see §5).
- The single desktop-width guard is `MODULE_MIN_W` (860px, in
  `ConsoleLayout`): below it the module area scrolls horizontally — panes
  must never crush or overlap. The nav rail collapses only by the user's
  manual toggle.
- Give every flexible text cell `min-w-0` + `truncate` so squeezed content
  clips instead of spilling into neighbors.
- Test layout changes at 1512 (MBP-14 default), at ~1210×780 (the same
  window under 125% zoom — layout must be IDENTICAL, only denser), and at
  the 375px phone preset, in both themes.

## 5. Mobile mode (`kit.MOBILE_MQ`)

Triggers on true handsets — narrow (<768px) AND coarse pointer — or
ultra-narrow windows (<=480px). Deliberately NOT width-only: browser zoom
narrows the CSS viewport, and a zoomed desktop window must keep the desktop
layout unchanged (it falls back to the 860px horizontal-scroll guarantee).
Use the `mobile:` Tailwind screen for classes and `useMobile()` from kit when
classes alone can't express it — never `max-md:` for phone adaptations:

- The shell swaps the nav rail for a bottom tab bar (`MobileNav`: four
  role-aware primary modules + a "More" sheet listing every group).
- `Page` stacks its children vertically and scrolls as a whole; every direct
  child gets natural height. `Pane` goes full-width, capped at 70vh with
  internal scroll (master-detail becomes stacked sections).
- `Modal` renders as a full-width bottom sheet; `Drawer` caps at
  `min(85vw, 340px)`.
- Hard grids need a mobile column count (`mobile:grid-cols-1`); decorative
  chrome (header search) hides via `mobile:hidden`.
- index.css forces 16px form-control text (stops iOS focus auto-zoom) and
  `touch-action: manipulation` on controls.
- Heavy authoring surfaces (formula canvas, evaluation comparison) remain
  desktop-first; they stack legibly on mobile but are not optimized workflows
  — don't invest in phone-specific features there without a product decision.
- Test at the 375px preset in both themes before shipping mobile-visible
  changes.

## 6. Interaction standards

- Keyboard focus shows the global `:focus-visible` primary ring — don't
  suppress outlines.
- Disabled means `disabled` (the attribute) — `pointer-events-none` alone
  leaves keyboard access open.
- Motion respects `prefers-reduced-motion` (global media query in index.css);
  keep decorative animation opt-in and subtle.
- Each module sets the browser-tab title (`ModulePage`).

## 7. Extending the system

1. Need a variant? First check kit; if genuinely new, add it to kit with a
   doc comment stating its role, then consume it — never fork locally.
2. New status/lane vocabulary goes into `STAGE_META`/`STATUS_COLOR` in kit.
3. If lint flags a genuine exception, append `// ui-lint-allow` on that line
   with a reason in the surrounding code — allowlists in
   `scripts/ui-lint.mjs` are for whole-file over-media cases only.
4. Update this document when a rule changes; it is the source the lint script
   implements.
