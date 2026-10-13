/**
 * Unsaved-change protection across the whole workstation.
 *
 * An editor declares `useUnsavedChanges(dirty, label)`. Anything that would
 * leave or remount it — nav links, the command palette, the dataset switcher,
 * a module's own document picker — runs through `useGuard()`, which asks for
 * confirmation while any editor is dirty. Closing or reloading the tab gets the
 * browser's own prompt.
 */

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { useBlocker } from "react-router-dom";

import { ConfirmDialog } from "../shared-console/src";

const dirtySources = new Map<symbol, string>();

export function hasUnsavedChanges(): boolean {
  return dirtySources.size > 0;
}

/** Call right before a navigation that follows a successful save. */
export function markClean(): void {
  dirtySources.clear();
}

export function useUnsavedChanges(dirty: boolean, label: string): void {
  useEffect(() => {
    if (!dirty) return;
    const token = Symbol(label);
    dirtySources.set(token, label);
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      dirtySources.delete(token);
      window.removeEventListener("beforeunload", onBeforeUnload);
    };
  }, [dirty, label]);
}

type Guard = (action: () => void) => void;

const GuardContext = createContext<Guard>((action) => action());

export function GuardProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<{ action: () => void; labels: string[] } | null>(null);
  const guard = useCallback<Guard>((action) => {
    if (dirtySources.size === 0) {
      action();
      return;
    }
    setPending({ action, labels: [...new Set(dirtySources.values())] });
  }, []);
  // Router-level protection: Back/Forward and any navigation not routed through `guard`.
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      dirtySources.size > 0 &&
      (currentLocation.pathname !== nextLocation.pathname || currentLocation.search !== nextLocation.search),
  );
  return (
    <GuardContext.Provider value={guard}>
      {children}
      {blocker.state === "blocked" && !pending && (
        <ConfirmDialog
          title="Discard unsaved changes?"
          message={`${[...new Set(dirtySources.values())].join(", ")} ${dirtySources.size === 1 ? "has" : "have"} changes that are not saved. Leaving discards them.`}
          confirmLabel="Discard and leave"
          danger
          onConfirm={() => {
            dirtySources.clear();
            blocker.proceed();
          }}
          onClose={() => blocker.reset()}
        />
      )}
      {pending && (
        <ConfirmDialog
          title="Discard unsaved changes?"
          message={`${pending.labels.join(", ")} ${pending.labels.length === 1 ? "has" : "have"} changes that are not saved. Continuing discards them.`}
          confirmLabel="Discard and continue"
          danger
          onConfirm={() => {
            const { action } = pending;
            setPending(null);
            dirtySources.clear();
            action();
          }}
          onClose={() => setPending(null)}
        />
      )}
    </GuardContext.Provider>
  );
}

/** Runs an action that may discard edits, asking first when anything is unsaved. */
export function useGuard(): Guard {
  return useContext(GuardContext);
}
