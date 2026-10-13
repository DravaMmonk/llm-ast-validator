/** The “?” overlay: every keyboard shortcut in one place. */

import { Kbd, Modal } from "../shared-console/src";

const GROUPS: { title: string; items: [string[], string][] }[] = [
  {
    title: "Anywhere",
    items: [
      [["⌘", "K"], "Open the command palette (Ctrl+K on Windows/Linux)"],
      [["?"], "Show this list"],
      [["Esc"], "Close the top dialog, popover or palette"],
    ],
  },
  {
    title: "Command palette",
    items: [
      [["↑", "↓"], "Move between results"],
      [["↵"], "Open the highlighted result"],
    ],
  },
  {
    title: "Formula bar (fx)",
    items: [
      [["↵"], "Rebuild the puzzle pieces from the typed formula"],
      [["Esc"], "Discard the typed draft"],
    ],
  },
  {
    title: "Puzzle canvas",
    items: [
      [["⌘", "Z"], "Undo"],
      [["⇧", "⌘", "Z"], "Redo"],
      [["⌘", "C"], "Copy the selected piece"],
      [["⌘", "V"], "Paste it"],
      [["Del"], "Delete the selected piece"],
      [["Right-click"], "Disable a cohort step, duplicate, add a comment"],
    ],
  },
  {
    title: "Charts",
    items: [
      [["Tab"], "Move between bars, boxes and forest-plot rows"],
      [["←", "→"], "Move the crosshair on line charts"],
      [["↑", "↓"], "Move the pre-test marker on the Fagan nomogram"],
    ],
  },
];

export function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  return (
    <Modal title="Keyboard shortcuts" onClose={onClose} w={560}>
      <div className="mt-3 grid grid-cols-2 gap-x-6 gap-y-4 mobile:grid-cols-1">
        {GROUPS.map((group) => (
          <section key={group.title}>
            <h4 className="m-0 mb-1.5 text-cap font-semibold uppercase tracking-[0.06em] text-muted-fg">{group.title}</h4>
            <dl className="m-0 flex flex-col gap-1.5">
              {group.items.map(([keys, description]) => (
                <div key={description} className="flex items-start justify-between gap-3">
                  <dt className="text-body text-fg">{description}</dt>
                  <dd className="m-0 flex flex-none gap-0.5">
                    {keys.map((key) => (
                      <Kbd key={key}>{key}</Kbd>
                    ))}
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </Modal>
  );
}
