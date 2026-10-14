/**
 * The workstation shell: nav rail, header, and the module area.
 *
 * Follows the console design system's layout contract (DESIGN.md §4–5): the
 * desktop layout never adapts to viewport width — the rail collapses only by
 * the user's toggle and the module area scrolls horizontally below
 * `MODULE_MIN_W` — and phones get a bottom tab bar instead of the rail.
 */

import { useEffect, useState, type ReactNode } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { ChevronDown, Command, Database, Moon, PanelLeftClose, PanelLeftOpen, Search, Sun } from "lucide-react";

import { Kbd, Popover, capSm, useMobile } from "../shared-console/src";
import { CommandPalette } from "./CommandPalette";
import { useDialogFocus } from "./dialogFocus";
import { ShortcutsDialog } from "./ShortcutsDialog";
import { GuardProvider, hasUnsavedChanges, useGuard } from "./guard";
import { useActiveDataset } from "./data";
import { MODULES, MODULE_GROUPS, moduleForPath } from "./modules";
import { usePreference, useTheme } from "./preferences";

/** Below this width the module area scrolls rather than crushing panes. */
export const MODULE_MIN_W = 860;

export function Shell({ children }: { children: ReactNode }) {
  return (
    <GuardProvider>
      <ShellFrame>{children}</ShellFrame>
    </GuardProvider>
  );
}

/** A nav link that asks before leaving an editor with unsaved changes. */
function GuardedLink({ to, children, ...props }: { to: string; children: ReactNode } & Omit<React.ComponentProps<typeof Link>, "to">) {
  const guard = useGuard();
  const navigate = useNavigate();
  return (
    <Link
      to={to}
      {...props}
      onClick={(event) => {
        if (hasUnsavedChanges()) {
          event.preventDefault();
          guard(() => navigate(to));
        }
      }}
    >
      {children}
    </Link>
  );
}

function ShellFrame({ children }: { children: ReactNode }) {
  useDialogFocus();
  const location = useLocation();
  const mobile = useMobile();
  const [collapsed, setCollapsed] = usePreference<boolean>("nav-collapsed", false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const current = moduleForPath(location.pathname);

  useEffect(() => {
    document.title = `${current.label} · MedLab Workstation`;
  }, [current.label]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPaletteOpen((open) => !open);
        return;
      }
      // “?” opens the shortcut list unless the user is typing somewhere.
      const target = event.target as HTMLElement | null;
      const typing = target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName) || target.closest(".blocklyWidgetDiv"));
      if (event.key === "?" && !typing && !event.metaKey && !event.ctrlKey) {
        event.preventDefault();
        setShortcutsOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="flex h-screen min-h-0 bg-bg text-fg">
      <a
        href="#main-content"
        className="sr-only z-[70] rounded-md bg-primary px-3 py-2 text-ui font-semibold text-primary-fg focus:not-sr-only focus:fixed focus:left-3 focus:top-3"
      >
        Skip to content
      </a>
      {!mobile && <NavRail collapsed={collapsed} onToggle={() => setCollapsed(!collapsed)} activeId={current.id} />}
      <div className="flex min-w-0 flex-1 flex-col">
        <Header title={current.label} onOpenPalette={() => setPaletteOpen(true)} showDataset={current.id !== "formula-lab"} />
        <main id="main-content" tabIndex={-1} className="ui-scroll flex min-h-0 flex-1 overflow-x-auto outline-none mobile:overflow-y-auto">
          {/* min-w-0 lets the module shrink to the viewport on phones instead of growing to its content. */}
          <div className="flex min-h-0 min-w-0 flex-1 flex-col" style={mobile ? undefined : { minWidth: MODULE_MIN_W }}>
            {children}
          </div>
        </main>
        {mobile && <MobileNav activeId={current.id} onMore={() => setPaletteOpen(true)} />}
      </div>
      {paletteOpen && <CommandPalette onClose={() => setPaletteOpen(false)} onShowShortcuts={() => setShortcutsOpen(true)} />}
      {shortcutsOpen && <ShortcutsDialog onClose={() => setShortcutsOpen(false)} />}
    </div>
  );
}

function NavRail({ collapsed, onToggle, activeId }: { collapsed: boolean; onToggle: () => void; activeId: string }) {
  return (
    <nav
      aria-label="Modules"
      className="flex flex-none flex-col border-r border-border bg-card"
      style={{ width: collapsed ? 52 : 212, transition: "width 140ms ease-out" }}
    >
      <div className="flex h-11 flex-none items-center gap-2 border-b border-border-2 px-3">
        <LogoMark />
        {!collapsed && (
          <div className="min-w-0 leading-tight">
            <div className="truncate text-ui font-semibold text-fg-strong">MedLab</div>
            <div className="truncate text-tag uppercase tracking-[0.05em] text-muted-fg">Research workstation</div>
          </div>
        )}
      </div>
      <div className="ui-scroll min-h-0 flex-1 overflow-y-auto py-1.5">
        {MODULE_GROUPS.map((group) => (
          <div key={group} className="mb-1">
            {!collapsed && group !== "Workspace" && <div className={`${capSm} px-3.5 pb-0.5 pt-2`}>{group}</div>}
            {collapsed && group !== "Workspace" && <div className="mx-3 my-1.5 h-px bg-border-2" />}
            {MODULES.filter((entry) => entry.group === group).map((entry) => {
              const Icon = entry.icon;
              const active = entry.id === activeId;
              return (
                <GuardedLink
                  key={entry.id}
                  to={entry.path}
                  title={collapsed ? entry.label : undefined}
                  aria-current={active ? "page" : undefined}
                  className={`mx-1.5 flex h-8 items-center gap-2.5 rounded-md px-2 text-body font-medium no-underline ${
                    active ? "bg-primary-soft text-primary" : "text-muted-fg hover:bg-muted hover:text-fg"
                  }`}
                >
                  <Icon size={16} strokeWidth={1.9} className="flex-none" aria-hidden />
                  {!collapsed && <span className="truncate">{entry.label}</span>}
                </GuardedLink>
              );
            })}
          </div>
        ))}
      </div>
      <button
        type="button"
        onClick={onToggle}
        className="flex h-9 flex-none cursor-pointer items-center gap-2 border-0 border-t border-border-2 bg-transparent px-3.5 text-label text-muted-fg hover:text-fg"
        aria-label={collapsed ? "Expand navigation" : "Collapse navigation"}
      >
        {collapsed ? <PanelLeftOpen size={15} /> : <PanelLeftClose size={15} />}
        {!collapsed && <span>Collapse</span>}
      </button>
    </nav>
  );
}

/** A small abstract mark: a puzzle-piece cross in the primary colour. */
export function LogoMark({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden className="flex-none">
      <rect x="1" y="1" width="22" height="22" rx="6" fill="var(--primary)" />
      <path
        d="M10 5.5h4v4.5h4.5v4H14v4.5h-4V14H5.5v-4H10z"
        fill="var(--primary-fg)"
        stroke="var(--primary-fg)"
        strokeWidth="0.6"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function Header({ title, onOpenPalette, showDataset }: { title: string; onOpenPalette: () => void; showDataset: boolean }) {
  const [theme, setTheme] = useTheme();
  const mobile = useMobile();
  return (
    <header className="flex h-11 flex-none items-center gap-2 border-b border-border bg-card px-3">
      {mobile && <LogoMark size={22} />}
      <h1 className="m-0 min-w-0 truncate text-title font-semibold text-fg-strong">{title}</h1>
      <div className="ml-auto flex items-center gap-1.5">
        {/* The AI Formula Lab evaluates against its own imported diabetes cohort, not the active dataset. */}
        {showDataset ? <DatasetSwitcher /> : <span className="text-cap text-muted-fg mobile:hidden">Evaluates on the imported diabetes cohort</span>}
        <button
          type="button"
          onClick={onOpenPalette}
          className="flex h-7 cursor-pointer items-center gap-2 rounded-md border border-border bg-card-2 px-2 text-ui text-muted-fg hover:text-fg mobile:hidden"
          aria-label="Open command palette"
        >
          <Search size={13} aria-hidden />
          <span className="w-[150px] text-left">Search or jump to…</span>
          <Kbd>⌘K</Kbd>
        </button>
        <button
          type="button"
          onClick={onOpenPalette}
          className="hidden h-7 w-7 cursor-pointer items-center justify-center rounded-md border border-border bg-card-2 text-muted-fg mobile:flex"
          aria-label="Open command palette"
        >
          <Command size={14} />
        </button>
        <button
          type="button"
          onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
          className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-md border border-border bg-card-2 text-muted-fg hover:text-fg"
          aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
          title={theme === "dark" ? "Light theme" : "Dark theme"}
        >
          {theme === "dark" ? <Sun size={14} /> : <Moon size={14} />}
        </button>
      </div>
    </header>
  );
}

/** Header control for the active dataset every module analyses by default. */
export function DatasetSwitcher() {
  const { summary, datasets, setDatasetId, isLoading } = useActiveDataset();
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const guard = useGuard();
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex h-7 max-w-[260px] cursor-pointer items-center gap-1.5 rounded-md border border-border bg-card-2 px-2 text-ui text-fg hover:bg-muted mobile:max-w-[150px]"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Active dataset: ${summary?.name ?? "none"}`}
      >
        <Database size={13} className="flex-none text-muted-fg" aria-hidden />
        <span className="min-w-0 truncate">{isLoading ? "Loading…" : summary?.name ?? "No dataset"}</span>
        {summary && <span className="ui-mono flex-none text-fine text-muted-fg mobile:hidden">{summary.row_count.toLocaleString("en-US")}</span>}
        <ChevronDown size={13} className="flex-none text-muted-fg" aria-hidden />
      </button>
      {open && (
        <Popover onClose={() => setOpen(false)} className="right-0 top-[calc(100%+4px)] w-[320px] overflow-hidden">
          <div className={`${capSm} border-b border-border-2 px-3 py-2`}>Active dataset</div>
          <div
            role="listbox"
            aria-label="Datasets"
            className="ui-scroll max-h-[300px] overflow-y-auto"
            ref={(node) => {
              // Put keyboard focus on the active dataset when the list opens.
              if (node && !node.contains(document.activeElement)) node.querySelector<HTMLElement>('[aria-selected="true"], [role="option"]')?.focus();
            }}
            onKeyDown={(event) => {
              if (event.key !== "ArrowDown" && event.key !== "ArrowUp" && event.key !== "Home" && event.key !== "End") return;
              event.preventDefault();
              const options = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('[role="option"]'));
              const index = options.indexOf(document.activeElement as HTMLElement);
              const next =
                event.key === "Home" ? 0 : event.key === "End" ? options.length - 1 : Math.min(options.length - 1, Math.max(0, index + (event.key === "ArrowDown" ? 1 : -1)));
              options[next]?.focus();
            }}
          >
            {datasets.length === 0 && <div className="px-3 py-3 text-ui text-muted-fg">No datasets yet.</div>}
            {datasets.map((dataset) => (
              <button
                key={dataset.id}
                type="button"
                role="option"
                aria-selected={dataset.id === summary?.id}
                onClick={() => {
                  setOpen(false);
                  if (dataset.id !== summary?.id) guard(() => setDatasetId(dataset.id));
                }}
                className="flex w-full cursor-pointer items-center gap-2 border-0 border-b border-border-2 bg-transparent px-3 py-2 text-left hover:bg-muted"
                style={dataset.id === summary?.id ? { boxShadow: "inset 3px 0 0 var(--primary)", background: "var(--muted)" } : undefined}
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate text-body font-medium text-fg">{dataset.name}</div>
                  <div className="ui-mono text-fine text-muted-fg">
                    {dataset.row_count.toLocaleString("en-US")} rows · {dataset.column_count + dataset.derived_count} columns
                    {dataset.source === "sample" ? " · synthetic" : ""}
                  </div>
                </div>
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              guard(() => navigate("/data"));
            }}
            className="w-full cursor-pointer border-0 bg-card-2 px-3 py-2 text-left text-label font-semibold text-primary hover:bg-muted"
          >
            Manage datasets in Data Studio →
          </button>
        </Popover>
      )}
    </div>
  );
}

function MobileNav({ activeId, onMore }: { activeId: string; onMore: () => void }) {
  const primary = MODULES.filter((entry) => entry.primaryOnMobile);
  return (
    <nav aria-label="Modules" className="flex h-14 flex-none border-t border-border bg-card">
      {primary.map((entry) => {
        const Icon = entry.icon;
        const active = entry.id === activeId;
        return (
          <GuardedLink
            key={entry.id}
            to={entry.path}
            className={`flex flex-1 flex-col items-center justify-center gap-0.5 text-tag font-semibold no-underline ${
              active ? "text-primary" : "text-muted-fg"
            }`}
          >
            <Icon size={18} aria-hidden />
            {entry.label.split(" ")[0]}
          </GuardedLink>
        );
      })}
      <button
        type="button"
        onClick={onMore}
        className="flex flex-1 cursor-pointer flex-col items-center justify-center gap-0.5 border-0 bg-transparent text-tag font-semibold text-muted-fg"
      >
        <Command size={18} aria-hidden />
        More
      </button>
    </nav>
  );
}
