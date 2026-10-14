/**
 * Focus management for every modal dialog, including the frozen console kit's
 * `Modal`, which renders `role="dialog"` but does not manage focus itself.
 *
 * When a modal opens, focus moves into it (honouring `autoFocus`), Tab and
 * Shift+Tab cycle inside it, the dialog is labelled by its heading, the ✕
 * button gets an accessible name, and focus returns to the opener on close.
 */

import { useEffect } from "react";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function focusables(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((element) => element.getClientRects().length > 0);
}

let sequence = 0;

function enhance(dialog: HTMLElement): void {
  const heading = dialog.querySelector<HTMLElement>("h1, h2, h3, h4");
  if (heading && !dialog.hasAttribute("aria-labelledby") && !dialog.hasAttribute("aria-label")) {
    if (!heading.id) heading.id = `dialog-title-${++sequence}`;
    dialog.setAttribute("aria-labelledby", heading.id);
  }
  for (const button of dialog.querySelectorAll<HTMLButtonElement>("button")) {
    if (button.textContent?.trim() === "✕" && !button.hasAttribute("aria-label")) button.setAttribute("aria-label", "Close");
  }
  if (!dialog.contains(document.activeElement)) {
    const preferred =
      dialog.querySelector<HTMLElement>("[autofocus]") ??
      focusables(dialog).find((element) => element.getAttribute("aria-label") !== "Close") ??
      dialog;
    if (preferred === dialog && !dialog.hasAttribute("tabindex")) dialog.setAttribute("tabindex", "-1");
    preferred.focus();
  }
}

export function useDialogFocus(): void {
  useEffect(() => {
    let current: HTMLElement | null = null;
    let opener: HTMLElement | null = null;
    let frame = 0;

    const sync = () => {
      frame = 0;
      const dialogs = Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"][aria-modal="true"]'));
      const top = dialogs[dialogs.length - 1] ?? null;
      if (top && top !== current) {
        if (!current) opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        current = top;
        enhance(top);
      } else if (!top && current) {
        current = null;
        if (opener && document.contains(opener)) opener.focus();
        opener = null;
      }
    };
    const schedule = () => {
      if (!frame) frame = window.requestAnimationFrame(sync);
    };
    const observer = new MutationObserver(schedule);
    observer.observe(document.body, { childList: true, subtree: true });

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Tab" || !current) return;
      const list = focusables(current);
      if (list.length === 0) {
        event.preventDefault();
        return;
      }
      const first = list[0];
      const last = list[list.length - 1];
      const active = document.activeElement;
      if (!current.contains(active)) {
        event.preventDefault();
        first.focus();
      } else if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      observer.disconnect();
      document.removeEventListener("keydown", onKeyDown, true);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, []);
}
