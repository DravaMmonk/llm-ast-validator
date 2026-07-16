/*
 * kit — shared console UI primitives, so every module composes the same
 * anatomy: full-height flush panes, sticky uppercase pane headers, mono data,
 * chip and pill button hierarchy. No floating cards at page level; borders
 * divide panes.
 */
import { useEffect, useRef, useState } from "react";
import type { ButtonHTMLAttributes, CSSProperties, MouseEventHandler, ReactNode } from "react";
import type { UseQueryResult } from "@tanstack/react-query";
import { Link } from "react-router-dom";

/** Pane header label (uppercase caption). */
export const cap = "text-label font-semibold uppercase tracking-[0.1em] text-muted-fg";
/** Section subheader inside a pane. */
export const capSm = "text-cap font-semibold uppercase tracking-[0.06em] text-muted-fg";
/** Neutral pill button. */
export const pillBtn =
  "h-7 cursor-pointer rounded-md border border-border bg-card px-3 text-ui font-medium text-fg hover:bg-muted disabled:cursor-default disabled:opacity-40";
/** Primary filled action. */
export const primaryBtn =
  "h-7 cursor-pointer rounded-md border border-primary bg-primary px-3 text-ui font-medium text-primary-fg hover:opacity-85 disabled:cursor-default disabled:opacity-40";
/** Small ghost/icon button. */
export const ghostBtn =
  "flex h-[22px] items-center justify-center rounded-[5px] border border-border bg-card-2 px-1.5 text-ui text-muted-fg hover:text-fg";
/** Soft (tinted) primary action — secondary emphasis next to `primaryBtn`. */
export const softBtn =
  "h-7 cursor-pointer rounded-md border border-transparent bg-primary-soft px-3 text-ui font-semibold text-primary hover:opacity-85 disabled:cursor-default disabled:opacity-40";
/** Destructive filled action (delete / discard / stop). Pair with ConfirmDialog. */
export const dangerBtn =
  "h-7 cursor-pointer rounded-md border border-transparent bg-bad px-3 text-ui font-medium text-primary-fg hover:opacity-85 disabled:cursor-default disabled:opacity-40";

/*
 * Button hierarchy rule: at most ONE `primaryBtn` per pane (the pane's main
 * action); supporting actions are `pillBtn`, tinted tertiary actions
 * `softBtn`, destructive `dangerBtn`, icon/dense `ghostBtn`.
 */

/* ---- form controls: the only sanctioned input/select recipes ---- */
/** Standard text/search input. */
export const inputCls =
  "h-7 rounded-md border border-border bg-card-2 px-2 text-ui text-fg outline-none placeholder:text-muted-fg focus:border-primary disabled:opacity-60";
/** Compact (dense-form) input, mono for keys/numbers. */
export const inputSmCls =
  "ui-mono h-[24px] rounded-md border border-border-2 bg-card px-1.5 text-label text-fg outline-none focus:border-primary disabled:opacity-60";
/** Borderless input used only inside the PageHeader global-search shell. */
export const headerSearchInputCls =
  "h-6 min-w-0 flex-1 border-0 bg-transparent p-0 text-ui text-fg outline-none placeholder:text-muted-fg";
/** Standard select. */
export const selectCls =
  "h-7 cursor-pointer rounded-md border border-border bg-card-2 px-1.5 text-body text-fg outline-none";
/** Compact select for dense forms/toolbars. */
export const selectSmCls =
  "h-[24px] cursor-pointer rounded-md border border-border-2 bg-card px-1.5 text-dense text-fg outline-none";
/** Multi-line text area. */
export const textareaCls =
  "w-full resize-y rounded-md border border-border bg-card-2 px-2 py-1.5 text-ui text-fg outline-none focus:border-primary";
/** Checkbox. */
export const checkboxCls = "h-3.5 w-3.5 cursor-pointer accent-[var(--primary)] disabled:opacity-50";

/* ---- data table recipes: sticky uppercase header, hover rows ---- */
export const thCls = `sticky top-0 z-[1] border-b border-border-2 bg-card px-2.5 py-1.5 text-left ${capSm}`;
export const tdCls = "border-b border-border-2 px-2.5 py-1.5 text-body text-fg";
export const trHoverCls = "hover:bg-muted";

/*
 * Close-on-Escape, shared by every overlay surface (Modal / Drawer / Popover).
 * Overlays register on a stack; Escape only closes the top-most one, so a
 * Popover inside a Modal (or any stacked pair) peels one layer per press.
 */
const escStack: symbol[] = [];
function useEscapeClose(onClose: () => void) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const token = Symbol("overlay");
    escStack.push(token);
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape" && escStack[escStack.length - 1] === token) closeRef.current();
    };
    window.addEventListener("keydown", h);
    return () => {
      const i = escStack.indexOf(token);
      if (i >= 0) escStack.splice(i, 1);
      window.removeEventListener("keydown", h);
    };
  }, []);
}

/*
 * Mobile mode: one shared media query drives every adaptive primitive.
 * Deliberately narrow AND coarse-pointer (plus ultra-narrow windows), so a
 * zoomed-in desktop window keeps the desktop layout untouched. Pages stack their panes vertically, fixed-width panes go
 * full-width, Modal becomes a bottom sheet, the shell swaps the nav rail for
 * a bottom tab bar. Components read it via useMobile().
 */
export const MOBILE_MQ = "(max-width: 480px), ((max-width: 767px) and (pointer: coarse))";
export function useMobile(): boolean {
  const [m, setM] = useState(() => typeof window !== "undefined" && window.matchMedia(MOBILE_MQ).matches);
  useEffect(() => {
    const mq = window.matchMedia(MOBILE_MQ);
    const on = () => setM(mq.matches);
    mq.addEventListener?.("change", on);
    return () => mq.removeEventListener?.("change", on);
  }, []);
  return m;
}

/** Full-page flush container: fills the routed module area under the header.
 *  On mobile the panes stack vertically and the page itself scrolls. */
export function Page({ children }: { children: ReactNode }) {
  return (
    <div className="ui-scroll flex min-h-0 flex-1 overflow-hidden mobile:flex-col mobile:overflow-y-auto mobile:*:min-h-fit mobile:*:flex-none">
      {children}
    </div>
  );
}

/** A vertical pane. Fixed width when `w` given, otherwise flex-1. On mobile
 *  every pane is a full-width stacked section, capped at 70vh with internal
 *  scroll so master-detail modules stay navigable by thumb. */
export function Pane({
  w,
  side,
  children,
  className = "",
}: {
  w?: number;
  side?: "l" | "r";
  children: ReactNode;
  className?: string;
}) {
  const mobile = useMobile();
  const border = side === "l" ? "border-l" : side === "r" ? "border-r" : "";
  return (
    <div
      className={`flex min-h-0 flex-col ${border} border-border ${w ? "flex-none" : "min-w-0 flex-1"} mobile:max-h-[70vh] mobile:w-full mobile:flex-none mobile:border-b mobile:border-l-0 mobile:border-r-0 ${className}`}
      style={w && !mobile ? { width: w } : undefined}
    >
      {children}
    </div>
  );
}

/** Sticky pane header: uppercase label + optional count badge + right slot. */
export function PaneHeader({
  label,
  count,
  children,
  className = "",
}: {
  label: ReactNode;
  count?: number | string | null;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`sticky top-0 z-[2] flex min-h-[37px] flex-none items-center gap-2 border-b border-border-2 bg-card px-[11px] py-1.5 ${className}`}
    >
      <span className={`${cap} min-w-0 truncate`}>{label}</span>
      {count != null && (
        <span className="ui-mono rounded-[9px] bg-muted px-[7px] py-px text-cap font-semibold text-fg">{count}</span>
      )}
      {children != null && <div className="ml-auto flex items-center gap-1.5">{children}</div>}
    </div>
  );
}

/** The scrollable body of a pane. */
export function PaneBody({ children, className = "", pad = false }: { children: ReactNode; className?: string; pad?: boolean }) {
  return <div className={`ui-scroll min-h-0 flex-1 overflow-y-auto ${pad ? "p-[11px]" : ""} ${className}`}>{children}</div>;
}

/** Compact pane footer status row. */
export function PaneFooter({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-none items-center gap-3 border-t border-border-2 bg-card px-[11px] py-1.5 text-cap text-muted-fg">
      {children}
    </div>
  );
}

/** Small segmented control (Table | Gallery, BRS | CRS …). */
export function SegTabs<T extends string>({
  value,
  options,
  onChange,
  disabled = false,
}: {
  value: T;
  options: { v: T; label: string }[];
  onChange: (v: T) => void;
  disabled?: boolean;
}) {
  return (
    <div className={`inline-flex flex-none overflow-hidden rounded-md border border-border ${disabled ? "opacity-40" : ""}`}>
      {options.map((o) => (
        <button
          key={o.v}
          disabled={disabled}
          onClick={() => onChange(o.v)}
          className="px-[11px] py-[5px] text-label font-semibold capitalize disabled:cursor-default"
          style={{
            background: value === o.v ? "var(--primary)" : "transparent",
            color: value === o.v ? "var(--primary-fg)" : "var(--muted-fg)",
          }}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Uppercase chip/badge with tinted background. */
export function Chip({ label, color, title }: { label: ReactNode; color: string; title?: string }) {
  return (
    <span
      title={title}
      className="rounded-full px-1.5 py-px text-tag font-semibold uppercase tracking-[0.05em]"
      style={{ background: `color-mix(in srgb, ${color} 14%, transparent)`, color }}
    >
      {label}
    </span>
  );
}

/** Key → value line for metadata grids. `flat` drops the boxed border for dense detail panes. */
export function KV({ k, v, mono = true, flat = false }: { k: string; v: ReactNode; mono?: boolean; flat?: boolean }) {
  return (
    <div
      className={`flex justify-between gap-2 text-label ${flat ? "py-0.5" : "rounded-md border border-border-2 bg-card-2 px-[9px] py-1.5"}`}
    >
      <span className="text-muted-fg">{k}</span>
      <span className={`${mono ? "ui-mono" : ""} min-w-0 truncate font-semibold text-fg`}>{v}</span>
    </div>
  );
}

/** Centered modal: dark backdrop + card. The single overlay scaffold for every dialog. */
export function Modal({
  title,
  onClose,
  children,
  headerRight,
  w = 620,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  headerRight?: ReactNode;
  w?: number;
}) {
  const mobile = useMobile();
  useEscapeClose(onClose);
  // Lock page scroll while the dialog is up.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);
  return (
    <>
      <div onClick={onClose} className="fixed inset-0 z-40 bg-black/45" />
      <div
        role="dialog"
        aria-modal="true"
        className="fixed z-[41] bg-card p-[22px] shadow-[0_20px_50px_rgba(0,0,0,0.25)] mobile:inset-x-0 mobile:bottom-0 mobile:max-h-[85vh] mobile:overflow-y-auto mobile:rounded-t-[14px] md:left-1/2 md:top-1/2 md:max-w-[calc(100vw-32px)] md:-translate-x-1/2 md:-translate-y-1/2 md:rounded-[14px]"
        style={mobile ? undefined : { width: w }}
      >
        <div className="flex items-center gap-2">
          <h3 className="m-0 flex-1 text-[15px] font-semibold text-fg">{title}</h3>
          {headerRight}
          <button
            onClick={onClose}
            className="ml-2 h-7 w-7 cursor-pointer rounded-md border-0 bg-transparent text-title text-muted-fg hover:bg-muted"
          >
            ✕
          </button>
        </div>
        {children}
      </div>
    </>
  );
}

/** Slide-in side drawer over the current pane: scrim + animated panel. */
export function Drawer({
  side = "l",
  w = 264,
  onClose,
  children,
  className = "",
}: {
  side?: "l" | "r";
  w?: number;
  onClose: () => void;
  children: ReactNode;
  className?: string;
}) {
  const mobile = useMobile();
  useEscapeClose(onClose);
  return (
    <>
      <div onClick={onClose} className="absolute inset-0 z-[8] bg-black/40 backdrop-blur-[1px]" />
      <div
        className={`absolute inset-y-0 z-[9] flex flex-col overflow-hidden border-border bg-card ${
          side === "l" ? "left-0 border-r" : "right-0 border-l"
        } ${className}`}
        style={{
          width: mobile ? "min(85vw, 340px)" : w,
          animation: `${side === "l" ? "ui-drawer-in" : "ui-drawer-in-r"} 160ms ease-out`,
        }}
      >
        {children}
      </div>
    </>
  );
}

/** Anchored dropdown/popover panel with a full-screen click-catcher. Wrap the trigger in `relative`. */
export function Popover({
  onClose,
  children,
  className = "",
  style,
}: {
  onClose: () => void;
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}) {
  useEscapeClose(onClose);
  return (
    <>
      <div onClick={onClose} className="fixed inset-0 z-30" />
      <div
        className={`absolute z-[31] rounded-[10px] border border-border bg-card shadow-[0_12px_32px_rgba(0,0,0,0.14)] ${className}`}
        style={style}
      >
        {children}
      </div>
    </>
  );
}

/** The one destructive-action confirmation surface: Modal + Cancel/confirm pair. */
export function ConfirmDialog({
  title,
  message,
  confirmLabel = "Confirm",
  danger = false,
  busy = false,
  onConfirm,
  onClose,
}: {
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Modal title={title} onClose={onClose} w={420}>
      <p className="mb-0 mt-2 text-ui leading-relaxed text-muted-fg">{message}</p>
      <div className="mt-4 flex justify-end gap-2">
        <button className={pillBtn} onClick={onClose}>
          Cancel
        </button>
        <button className={danger ? dangerBtn : primaryBtn} disabled={busy} onClick={onConfirm}>
          {confirmLabel}
        </button>
      </div>
    </Modal>
  );
}

/*
 * Tab idiom rule: `TabBar` (underline) switches a pane between content
 * sections; `SegTabs` (boxed) toggles a small inline mode/view
 * (Table | Gallery, list | json). Never both for the same role in one pane.
 */
/** Underline tab bar (full-width sibling of the boxed SegTabs). */
export function TabBar<T extends string>({
  value,
  options,
  onChange,
  grow = true,
}: {
  value: T;
  options: { v: T; label: ReactNode }[];
  onChange: (v: T) => void;
  grow?: boolean;
}) {
  const barRef = useRef<HTMLDivElement>(null);
  // Deep links can land on a tab that sits outside the scrolled viewport —
  // keep the active tab visible without jolting the page vertically.
  useEffect(() => {
    const active = barRef.current?.querySelector<HTMLButtonElement>("[data-active='true']");
    active?.scrollIntoView({ inline: "nearest", block: "nearest" });
  }, [value]);
  return (
    // Scrolls horizontally (no scrollbar chrome) instead of clipping the last
    // tab when the pane is narrower than the tab set (e.g. a 4-tab master rail).
    <div ref={barRef} className="ui-scroll-none flex flex-none overflow-x-auto border-b border-border">
      {options.map((o) => (
        <button
          key={o.v}
          data-active={value === o.v || undefined}
          onClick={() => onChange(o.v)}
          className={`h-8 cursor-pointer whitespace-nowrap border-b-2 bg-transparent px-3 text-label font-semibold ${grow ? "flex-1" : ""} ${
            value === o.v ? "border-b-fg text-fg" : "border-b-transparent text-muted-fg hover:text-fg"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Color swatch dot for legends, category tags and status rows. */
export function Dot({ color, size = 8, square = false }: { color: string; size?: number; square?: boolean }) {
  return (
    <span
      className="inline-block flex-none"
      style={{ width: size, height: size, background: color, borderRadius: square ? 3 : 999 }}
    />
  );
}

/** Keyboard-shortcut hint chip. */
export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="ui-mono rounded border border-border bg-card-2 px-1 text-tag text-muted-fg">{children}</kbd>
  );
}

/** Inline loading placeholder for panes and lists. */
export function LoadingState({ label = "Loading…" }: { label?: string }) {
  return <div className="px-3 py-3 text-ui text-muted-fg">{label}</div>;
}

/*
 * Toast — the one transient-feedback surface. Call `toast("Saved · v12")`
 * from anywhere; ConsoleLayout mounts a single <Toaster/>. Inverted colors
 * (fg-on-bg swap) so it reads in both themes.
 */
let toastListener: ((msg: string) => void) | null = null;
export function toast(msg: string) {
  toastListener?.(msg);
}
export function Toaster() {
  const [msg, setMsg] = useState<string | null>(null);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => {
    toastListener = (m) => {
      setMsg(m);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setMsg(null), 2400);
    };
    return () => {
      toastListener = null;
      window.clearTimeout(timer.current);
    };
  }, []);
  if (!msg) return null;
  return (
    <div
      role="status"
      className="ui-mono fixed bottom-4 left-1/2 z-[60] -translate-x-1/2 rounded-md px-3 py-1.5 text-ui font-medium shadow-[0_8px_24px_rgba(0,0,0,0.25)]"
      style={{ background: "var(--fg)", color: "var(--bg)" }}
    >
      {msg}
    </div>
  );
}

/*
 * Selection language: list/rail rows show selection as muted fill + 3px
 * primary inset bar (`selectedRowStyle`); free-standing cards show it as a
 * primary border (`selectedCardStyle`). No other selected-state visuals.
 */
export function selectedRowStyle(active: boolean): CSSProperties {
  return active ? { background: "var(--muted)", boxShadow: "inset 3px 0 0 var(--primary)" } : {};
}
export function selectedCardStyle(active: boolean): CSSProperties {
  return { borderColor: active ? "var(--primary)" : "var(--border)" };
}

/** Canonical interactive row for the master list in a master-detail module. */
function MasterListRow({
  active,
  className = "",
  style,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { active: boolean }) {
  return (
    <button
      type="button"
      {...props}
      className={`w-full cursor-pointer border-b border-border-2 px-[11px] py-1.5 text-left hover:bg-muted ${className}`}
      style={{ ...selectedRowStyle(active), ...style }}
    >
      {children}
    </button>
  );
}

/** Fixed-width master rail used by every list-detail module. */
export const MASTER_LIST_WIDTH = 280;
export function MasterListPane({
  label,
  count,
  actions,
  tabs,
  toolbar,
  footer,
  children,
  className = "",
}: {
  label: ReactNode;
  count?: number | string | null;
  actions?: ReactNode;
  tabs?: ReactNode;
  toolbar?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Pane w={MASTER_LIST_WIDTH} side="r" className={className}>
      <PaneHeader label={label} count={count}>{actions}</PaneHeader>
      {tabs}
      {toolbar != null && (
        <div className="flex flex-none flex-col gap-1.5 border-b border-border-2 px-[11px] py-2">{toolbar}</div>
      )}
      <PaneBody>{children}</PaneBody>
      {footer != null && <PaneFooter>{footer}</PaneFooter>}
    </Pane>
  );
}

/** One search control for every master rail. Filtering stays with the owning data module. */
export function MasterListSearch({
  value,
  onChange,
  placeholder = "Search…",
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <input
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      aria-label={placeholder}
      className={`${inputCls} w-full`}
    />
  );
}

/** Shared case-insensitive matcher for master-list identity and metadata fields. */
export function matchesMasterListSearch(query: string, ...values: unknown[]): boolean {
  const needle = query.trim().toLowerCase();
  return !needle || values.some((value) => String(value ?? "").toLowerCase().includes(needle));
}

/** Compact count filter used above grouped master lists. */
export function MasterListFilterChip({
  label,
  count,
  active,
  color,
  onClick,
}: {
  label: ReactNode;
  count: number;
  active: boolean;
  color: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className="cursor-pointer rounded-full border px-1.5 py-px text-tag font-semibold uppercase tracking-[0.05em]"
      style={{
        borderColor: active ? color : "var(--border-2)",
        color: active ? color : "var(--muted-fg)",
        background: active ? `color-mix(in srgb, ${color} 14%, transparent)` : "var(--card)",
      }}
    >
      {label} <span className="ui-mono">{count}</span>
    </button>
  );
}

/** Collapsible sticky category bar used inside every master list. */
export function MasterListGroup({
  label,
  count,
  color,
  children,
  defaultOpen = true,
  open: controlledOpen,
  onOpenChange,
}: {
  label: ReactNode;
  count?: number | string;
  color?: string;
  children: ReactNode;
  defaultOpen?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const [internalOpen, setInternalOpen] = useState(defaultOpen);
  const open = controlledOpen ?? internalOpen;
  const setOpen = (next: boolean) => {
    if (controlledOpen == null) setInternalOpen(next);
    onOpenChange?.(next);
  };
  return (
    <section>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="sticky top-0 z-[1] flex w-full items-center gap-1.5 border-b border-border-2 bg-card-2 px-[11px] py-1.5 text-left hover:bg-muted"
      >
        {color && <span className="h-1.5 w-1.5 flex-none rounded-full" style={{ background: color }} />}
        <span className={`${capSm} min-w-0 truncate`}>{label}</span>
        {count != null && <span className="ui-mono ml-auto text-fine text-muted-fg">{count}</span>}
        <span className={`${count == null ? "ml-auto" : ""} ui-mono w-2 flex-none text-right text-fine text-muted-fg`}>
          {open ? "▾" : "▸"}
        </span>
      </button>
      {open && children}
    </section>
  );
}

/** Canonical thin, single-line master-list row. Master rails show names only. */
export function MasterListItem({
  active,
  primary,
  mono = false,
  tooltip,
  className = "",
  to,
  ...props
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, "title"> & {
  active: boolean;
  primary: ReactNode;
  mono?: boolean;
  tooltip?: string;
  /** Explicit deep link for this entity. Prefer a stable business key in the URL. */
  to?: string;
}) {
  const content = <span className={`${mono ? "ui-mono" : ""} block min-w-0 truncate text-body font-medium text-fg`}>{primary}</span>;
  if (to) {
    return (
      <Link
        to={to}
        title={tooltip}
        onClick={props.onClick as MouseEventHandler<HTMLAnchorElement> | undefined}
        className={`block w-full cursor-pointer border-b border-border-2 px-[11px] py-1.5 text-left hover:bg-muted ${className}`}
        style={selectedRowStyle(active)}
      >
        {content}
      </Link>
    );
  }
  return (
    <MasterListRow active={active} title={tooltip} className={className} {...props}>
      {content}
    </MasterListRow>
  );
}

/** Centered empty state with optional action. */
export function EmptyState({
  title,
  hint,
  action,
}: {
  title: string;
  hint?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex h-full min-h-[120px] flex-col items-center justify-center gap-1.5 p-6 text-center">
      <span className="text-md font-semibold text-fg-strong">{title}</span>
      {hint && <span className="max-w-[340px] text-body leading-relaxed text-muted-fg">{hint}</span>}
      {action && <div className="mt-1.5">{action}</div>}
    </div>
  );
}

/*
 * JsonInput — the sanctioned JSON value editor. Collapsed it is a one-line
 * preview; focus expands it in place and pretty-prints for editing, blur
 * re-collapses to the compact form. Invalid drafts stay expanded and flagged;
 * only valid JSON commits through `onChange`.
 */
export function JsonInput({
  value,
  onChange,
  disabled = false,
  placeholder,
}: {
  value: unknown;
  onChange: (v: unknown) => void;
  disabled?: boolean;
  placeholder?: string;
}) {
  const canonical = JSON.stringify(value ?? null);
  const lastEmitted = useRef(canonical);
  const [draft, setDraft] = useState(canonical);
  const [focused, setFocused] = useState(false);
  const [bad, setBad] = useState(false);
  const expanded = focused || bad;

  useEffect(() => {
    if (canonical !== lastEmitted.current) {
      lastEmitted.current = canonical;
      setDraft(canonical);
      setBad(false);
    }
  }, [canonical]);

  const updateDraft = (text: string) => {
    setDraft(text);
    try {
      const parsed = JSON.parse(text) as unknown;
      lastEmitted.current = JSON.stringify(parsed);
      setBad(false);
      onChange(parsed);
    } catch {
      setBad(true);
    }
  };
  const reformat = (indent?: number) => {
    try {
      setDraft(JSON.stringify(JSON.parse(draft), null, indent));
    } catch {
      // invalid drafts keep their text; the flag below stays authoritative
    }
  };

  const rows = expanded ? Math.min(16, Math.max(6, draft.split("\n").length + 1)) : 1;

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
      <textarea
        value={draft}
        rows={rows}
        wrap={expanded ? "soft" : "off"}
        spellCheck={false}
        disabled={disabled}
        placeholder={placeholder}
        title={bad ? undefined : "Focus to expand and pretty-print"}
        onFocus={() => { setFocused(true); reformat(2); }}
        onBlur={() => { setFocused(false); reformat(); }}
        onChange={(event) => updateDraft(event.target.value)}
        style={bad ? { borderColor: "var(--bad)" } : undefined}
        className={`${expanded ? `${textareaCls} ui-mono resize-y text-label leading-relaxed` : `${inputSmCls} w-full resize-none overflow-hidden`} min-w-0`}
      />
      {bad && (
        <span className="text-cap" style={{ color: "var(--bad)" }}>
          Invalid JSON — the last valid value is kept until this parses.
        </span>
      )}
    </div>
  );
}

/*
 * QueryState — the sanctioned loading / error / empty wrapper for a useQuery
 * result. Pending renders LoadingState; failure renders a readable message plus
 * a Retry button (so a 500 is visibly distinct from "no data"); and, when
 * `emptyTitle` is given, a successfully-loaded-but-empty result (empty array by
 * default; pass `isEmpty` for other shapes) renders EmptyState. Children render
 * the loaded data. Modules that already render their query errors well should
 * keep doing so — this is for the sites that would otherwise render nothing.
 */
export function QueryState<T>({
  query,
  loadingLabel,
  emptyTitle,
  emptyHint,
  isEmpty,
  children,
}: {
  query: UseQueryResult<T>;
  loadingLabel?: string;
  /** Show EmptyState with this title when the loaded data is empty. */
  emptyTitle?: string;
  emptyHint?: string;
  /** Custom emptiness predicate (default: empty array). */
  isEmpty?: (data: T) => boolean;
  children: (data: T) => ReactNode;
}) {
  if (query.isPending) return <LoadingState label={loadingLabel} />;
  if (query.isError) {
    const err: unknown = query.error;
    return (
      <EmptyState
        title="Request failed"
        hint={err instanceof Error && err.message ? err.message : String(err)}
        action={
          <button className={pillBtn} onClick={() => void query.refetch()}>
            Retry
          </button>
        }
      />
    );
  }
  const data = query.data;
  if (emptyTitle && (isEmpty ? isEmpty(data) : Array.isArray(data) && data.length === 0)) {
    return <EmptyState title={emptyTitle} hint={emptyHint} />;
  }
  return <>{children(data)}</>;
}

/** Horizontal stacked distribution bar with legend; segments optionally clickable. */
export interface DistSegment {
  key: string;
  label: string;
  color: string;
  n: number;
  active?: boolean;
}
export function DistBar({
  segments,
  onClick,
  h = 8,
  legend = true,
}: {
  segments: DistSegment[];
  onClick?: (key: string) => void;
  h?: number;
  legend?: boolean;
}) {
  const total = segments.reduce((s, x) => s + x.n, 0);
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <div className="flex w-full overflow-hidden rounded-full bg-muted" style={{ height: h }}>
        {total > 0 &&
          segments
            .filter((s) => s.n > 0)
            .map((s) => (
              <div
                key={s.key}
                title={`${s.label} · ${s.n} (${Math.round((s.n / total) * 100)}%)`}
                onClick={onClick ? () => onClick(s.key) : undefined}
                style={{
                  width: `${(s.n / total) * 100}%`,
                  background: s.color,
                  cursor: onClick ? "pointer" : "default",
                  opacity: s.active === false ? 0.35 : 1,
                  transition: "opacity 120ms",
                }}
              />
            ))}
      </div>
      {legend && (
        <div className="flex flex-wrap gap-x-3 gap-y-0.5">
          {segments.map((s) => (
            <button
              key={s.key}
              type="button"
              onClick={onClick ? () => onClick(s.key) : undefined}
              className="inline-flex items-center gap-1 bg-transparent p-0 text-cap text-muted-fg hover:text-fg"
              style={{ cursor: onClick ? "pointer" : "default", fontWeight: s.active ? 600 : 400 }}
            >
              <span className="h-2 w-2 flex-none rounded-full" style={{ background: s.color }} />
              {s.label}
              <span className="ui-mono">{s.n}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/*
 * Status & stage color vocabulary — the single source for every lifecycle /
 * run-state tint. Run states are UPPERCASE, lifecycle states lowercase. Both
 * resolve here so the palettes can never disagree.
 */
export const STAGE_META: Record<string, { color: string; doc: string }> = {
  current: { color: "var(--risk-low)", doc: "Current — callable under implicit version control" },
  archived: { color: "var(--muted-fg)", doc: "Archived — isolated from downstream calls until restored" },
  active: { color: "var(--risk-low)", doc: "Active — in use" },
  draft: { color: "var(--muted-fg)", doc: "Draft — saved but not in use" },
  approved: { color: "var(--risk-low)", doc: "Approved — review sign-off complete" },
  candidate: { color: "var(--warn)", doc: "Candidate — under evaluation before approval" },
  retired: { color: "var(--muted-fg)", doc: "Retired — superseded, kept for reproducibility" },
  validated: { color: "var(--risk-low)", doc: "Validated — smoke-tested entrypoint" },
  registered: { color: "var(--muted-fg)", doc: "Registered — not yet smoke-tested" },
  superseded: { color: "var(--muted-fg)", doc: "Superseded by a newer revision" },
};
const STATUS_COLOR: Record<string, string> = {
  SUCCEEDED: "var(--risk-low)",
  COMPLETED: "var(--risk-low)",
  RUNNING: "var(--info)",
  PENDING: "var(--warn)",
  QUEUED: "var(--warn)",
  FAILED: "var(--bad)",
  CANCELLED: "var(--muted-fg)",
  PARTIAL: "var(--info)",
  READY: "var(--risk-low)",
  EDITING: "var(--info)",
  REVIEWED: "var(--risk-low)",
};
export function statusColor(s: string): string {
  return STATUS_COLOR[s] ?? STATUS_COLOR[s.toUpperCase()] ?? STAGE_META[s]?.color ?? "var(--muted-fg)";
}
export function StatusPill({
  status,
  pulse = false,
  style,
}: {
  status: string;
  /** Live/active ring for in-flight states (QUEUED/RUNNING). */
  pulse?: boolean;
  style?: CSSProperties;
}) {
  const c = statusColor(status);
  return (
    <span
      className="ui-mono inline-flex flex-none items-center gap-1 rounded-full px-1.5 py-px text-tag font-semibold lowercase"
      style={{ background: `color-mix(in srgb, ${c} 14%, transparent)`, color: c, ...style }}
    >
      <span
        className={`h-1.5 w-1.5 rounded-full ${pulse ? "animate-pulse motion-reduce:animate-none" : ""}`}
        style={{ background: c, boxShadow: pulse ? `0 0 0 3px color-mix(in srgb, ${c} 22%, transparent)` : undefined }}
      />
      {status.toLowerCase().replace(/_/g, " ")}
    </span>
  );
}

/** Thin progress bar for coverage/ratio read-outs. */
export function Meter({ pct, color = "var(--primary)" }: { pct: number; color?: string }) {
  return (
    <div className="h-[4px] w-full overflow-hidden rounded-full bg-muted">
      <div
        className="h-full rounded-full"
        style={{ width: `${Math.max(0, Math.min(100, pct))}%`, background: color, transition: "width 300ms" }}
      />
    </div>
  );
}

/** Inline sparkline (SVG), for KPI trends and metric history. */
export function Sparkline({
  data,
  color = "var(--primary)",
  w = 84,
  h = 24,
}: {
  data: number[];
  color?: string;
  w?: number;
  h?: number;
}) {
  if (data.length < 2) return <svg width={w} height={h} />;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const span = max - min || 1;
  const pts = data
    .map((v, i) => `${(i / (data.length - 1)) * (w - 2) + 1},${h - 2 - ((v - min) / span) * (h - 4)}`)
    .join(" ");
  return (
    <svg width={w} height={h} className="flex-none">
      <polyline points={pts} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}
