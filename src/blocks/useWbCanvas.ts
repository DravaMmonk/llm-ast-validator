/**
 * Blockly canvas lifecycle for the workbench puzzle editors: inject/dispose,
 * live theming, a change listener, drag-and-drop from the library rail, smart
 * insert, and undo/redo/tidy.
 *
 * Blockly delivers events asynchronously, so a programmatic load also reaches
 * the change listener; consumers compare formulas by hash and treat an
 * unchanged formula as clean, which makes that harmless.
 *
 * Same plumbing as the diabetes canvas hook, generalised to arbitrary block
 * state (the column piece carries its column in `extraState`).
 */

import { useEffect, useRef } from "react";
import * as Blockly from "blockly/core";
import "blockly/blocks";

import { toast } from "../shared-console/src";
import type { BlockState } from "./wbAdapter";
import { ensureWorkbenchBlocks } from "./wbBlocks";

const CANVAS = {
  light: {
    workspaceBackgroundColour: "#fbfbfa",
    flyoutBackgroundColour: "#ffffff",
    scrollbarColour: "#dcdce0",
    insertionMarkerColour: "#5d6e3d",
    markerColour: "#5d6e3d",
    cursorColour: "#5d6e3d",
    grid: "#e6e6e3",
  },
  dark: {
    workspaceBackgroundColour: "#121317",
    flyoutBackgroundColour: "#16171c",
    scrollbarColour: "#2e2e35",
    insertionMarkerColour: "#9bb37a",
    markerColour: "#9bb37a",
    cursorColour: "#9bb37a",
    grid: "#23242a",
  },
};

const themes: Record<string, Blockly.Theme> = {};
function theme(dark: boolean): Blockly.Theme {
  const key = dark ? "dark" : "light";
  const { grid: _grid, ...componentStyles } = CANVAS[key];
  themes[key] ??= Blockly.Theme.defineTheme(`wb_canvas_${key}`, {
    name: `wb_canvas_${key}`,
    base: Blockly.Themes.Classic,
    componentStyles,
    fontStyle: { family: "Inter, system-ui, sans-serif", weight: "600", size: 12 },
  });
  return themes[key];
}

/** The drag payload the library rail sets on `application/x-wb-block`. */
export const DRAG_MIME = "application/x-wb-block";

export interface WbCanvasApi {
  ws: () => Blockly.WorkspaceSvg | null;
  /** Inserts a piece: into the selected piece's first free compatible socket, else at the viewport centre. */
  insert: (state: BlockState) => void;
  /**
   * Replaces the canvas content. If a piece no longer fits its socket (a column
   * changed type since the formula was saved), the `fallback` pieces — which
   * carry no type checks — are loaded instead. Returns false if neither loads.
   */
  load: (tops: BlockState[], fallback?: BlockState[]) => boolean;
  /** Serialized top-level blocks, in vertical position order. */
  tops: () => BlockState[];
  /** Appends a statement piece to the end of the chain under the start block. */
  appendStatement: (state: BlockState) => void;
  tidy: () => void;
  undo: () => void;
  redo: () => void;
  center: () => void;
  /** Scrolls so the content's top-left corner sits near the viewport's top-left. */
  anchorTopLeft: () => void;
}

export function useWbCanvas(
  hostRef: React.RefObject<HTMLDivElement | null>,
  onChange: () => void,
  options: { dark: boolean; startScale?: number; anchor?: "center" | "top-left" },
): WbCanvasApi {
  const anchorRef = useRef(options.anchor ?? "center");
  const wsRef = useRef<Blockly.WorkspaceSvg | null>(null);
  const changeRef = useRef(onChange);
  changeRef.current = onChange;
  const darkRef = useRef(options.dark);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || wsRef.current) return;
    ensureWorkbenchBlocks();
    const palette = CANVAS[options.dark ? "dark" : "light"];
    const ws = Blockly.inject(host, {
      theme: theme(options.dark),
      renderer: "zelos",
      media: import.meta.env.BASE_URL,
      sounds: false,
      trashcan: true,
      // Blockly only offers "Disable Block" by default with a categorised toolbox; steps rely on it.
      disable: true,
      grid: { spacing: 22, length: 3, colour: palette.grid, snap: true },
      zoom: { controls: true, wheel: true, startScale: options.startScale ?? 0.8, maxScale: 2.5, minScale: 0.3, scaleSpeed: 1.15 },
      move: { scrollbars: true, drag: true, wheel: false },
    });
    wsRef.current = ws;

    for (const img of host.querySelectorAll<SVGImageElement>("image")) {
      const href = img.getAttribute("xlink:href") ?? img.getAttribute("href");
      if (href?.endsWith("sprites.png")) {
        const svgHref = href.replace("sprites.png", "sprites.svg");
        img.setAttribute("xlink:href", svgHref);
        img.setAttribute("href", svgHref);
      }
    }

    ws.addChangeListener((event: Blockly.Events.Abstract) => {
      if (event.type === Blockly.Events.BLOCK_DRAG && !(event as Blockly.Events.BlockDrag).isStart) {
        // Blockly finishes connecting after the drag-end event; look once it has settled.
        const blockId = (event as Blockly.Events.BlockDrag).blockId;
        window.setTimeout(() => {
          const block = blockId ? (ws.getBlockById(blockId) as Blockly.BlockSvg | null) : null;
          if (block && !block.getParent()) explainNearMiss(ws, block, 40 / ws.scale);
        }, 0);
      }
      if (event.isUiEvent) return;
      changeRef.current();
    });

    const onDragOver = (event: DragEvent) => {
      if (!event.dataTransfer?.types.includes(DRAG_MIME)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
    };
    const onDrop = (event: DragEvent) => {
      const raw = event.dataTransfer?.getData(DRAG_MIME);
      if (!raw) return;
      event.preventDefault();
      let state: BlockState;
      try {
        state = JSON.parse(raw) as BlockState;
      } catch {
        return;
      }
      const point = Blockly.utils.svgMath.screenToWsCoordinates(ws, new Blockly.utils.Coordinate(event.clientX, event.clientY));
      Blockly.Events.setGroup(true);
      try {
        const block = Blockly.serialization.blocks.append(
          { ...state, x: point.x - 12, y: point.y - 10 } as Blockly.serialization.blocks.State,
          ws,
        ) as Blockly.BlockSvg;
        block.render();
        // Snap to a nearby socket like an in-canvas drag would (radius ≈ 48 screen px).
        if (!connectNearest(ws, block, 48 / ws.scale)) explainNearMiss(ws, block, 48 / ws.scale);
        selectBlock(block);
      } finally {
        Blockly.Events.setGroup(false);
      }
    };
    host.addEventListener("dragover", onDragOver);
    host.addEventListener("drop", onDrop);

    const observer = new ResizeObserver(() => Blockly.svgResize(ws));
    observer.observe(host);

    return () => {
      observer.disconnect();
      host.removeEventListener("dragover", onDragOver);
      host.removeEventListener("drop", onDrop);
      try {
        ws.dispose();
      } catch {
        /* already disposed */
      }
      wsRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-once lifecycle
  }, []);

  // Re-theme in place so a light/dark switch never discards unfinished pieces.
  useEffect(() => {
    const ws = wsRef.current;
    if (!ws || darkRef.current === options.dark) return;
    darkRef.current = options.dark;
    ws.setTheme(theme(options.dark));
    const grid = CANVAS[options.dark ? "dark" : "light"].grid;
    hostRef.current?.querySelectorAll("pattern line").forEach((line) => line.setAttribute("stroke", grid));
  }, [options.dark, hostRef]);

  const api = useRef<WbCanvasApi>({
    ws: () => wsRef.current,
    insert(state) {
      const ws = wsRef.current;
      if (!ws) return;
      Blockly.Events.setGroup(true);
      try {
        insertState(ws, state);
      } finally {
        Blockly.Events.setGroup(false);
      }
    },
    load(tops, fallback) {
      const ws = wsRef.current;
      if (!ws) return false;
      const attempt = (states: BlockState[]) => {
        ws.clear();
        for (const top of states) Blockly.serialization.blocks.append(top as Blockly.serialization.blocks.State, ws);
      };
      let ok = true;
      try {
        attempt(tops);
      } catch {
        try {
          if (!fallback) throw new Error("no fallback");
          attempt(fallback);
        } catch {
          ws.clear();
          ok = false;
        }
      }
      ws.clearUndo();
      settleThen(ws, () => (anchorRef.current === "top-left" ? anchorTopLeft(ws) : centerOnLargest(ws)));
      return ok;
    },
    appendStatement(state) {
      const ws = wsRef.current;
      if (!ws) return;
      Blockly.Events.setGroup(true);
      try {
        const block = Blockly.serialization.blocks.append(state as Blockly.serialization.blocks.State, ws) as Blockly.BlockSvg;
        const start = ws.getTopBlocks(true).find((top) => top !== block && !top.previousConnection && top.nextConnection);
        let tail: Blockly.Block | null = start ?? null;
        while (tail?.getNextBlock()) tail = tail.getNextBlock();
        if (tail?.nextConnection && block.previousConnection) tail.nextConnection.connect(block.previousConnection);
        selectBlock(block);
        block.bringToFront();
        ws.centerOnBlock(block.id);
      } finally {
        Blockly.Events.setGroup(false);
      }
    },
    tops() {
      const ws = wsRef.current;
      if (!ws) return [];
      return ws.getTopBlocks(true).map((top) => Blockly.serialization.blocks.save(top) as unknown as BlockState);
    },
    tidy() {
      const ws = wsRef.current;
      if (!ws) return;
      ws.cleanUp();
      centerOnLargest(ws);
    },
    undo() {
      wsRef.current?.undo(false);
    },
    redo() {
      wsRef.current?.undo(true);
    },
    center() {
      if (!wsRef.current) return;
      if (anchorRef.current === "top-left") anchorTopLeft(wsRef.current);
      else centerOnLargest(wsRef.current);
    },
    anchorTopLeft() {
      if (wsRef.current) anchorTopLeft(wsRef.current);
    },
  });
  return api.current;
}

/** Content wider than the viewport: zoom out (not below a readable floor) to show it whole. */
function fitWidth(ws: Blockly.WorkspaceSvg, floor: number): void {
  const box = ws.getBlocksBoundingBox();
  const metrics = ws.getMetrics();
  const contentWidth = (box.right - box.left) * ws.scale;
  if (Number.isFinite(contentWidth) && contentWidth > metrics.viewWidth * 0.92 && metrics.viewWidth > 0) {
    const target = Math.max(floor, (ws.scale * metrics.viewWidth * 0.88) / contentWidth);
    ws.setScale(Math.min(ws.scale, target));
  }
}

function centerOnLargest(ws: Blockly.WorkspaceSvg): void {
  try {
    fitWidth(ws, 0.45);
    let best: Blockly.Block | null = null;
    for (const top of ws.getTopBlocks(false)) {
      if (!best || top.getDescendants(false).length > best.getDescendants(false).length) best = top;
    }
    if (best) ws.centerOnBlock(best.id);
    else ws.scrollCenter();
  } catch {
    /* workspace not laid out yet */
  }
}

/** Puts the top-left of all content a small margin inside the viewport. */
function anchorTopLeft(ws: Blockly.WorkspaceSvg): void {
  try {
    if (ws.getBlocksBoundingBox().left === Infinity) return;
    // Step stacks are tall text-heavy pieces; keep them a little larger than formulas.
    fitWidth(ws, 0.55);
    const box = ws.getBlocksBoundingBox();
    const margin = 24;
    // `scroll` takes the pixel position of the workspace origin within the viewport.
    ws.scroll(-box.left * ws.scale + margin, -box.top * ws.scale + margin);
  } catch {
    /* not laid out yet */
  }
}

/** Waits for the host to have a stable, non-zero size, then positions the content. */
function settleThen(ws: Blockly.WorkspaceSvg, position: () => void): void {
  let tries = 0;
  let lastW = -1;
  let lastH = -1;
  const attempt = () => {
    if (!ws.rendered) return;
    try {
      Blockly.svgResize(ws);
      const metrics = ws.getMetrics();
      const settled = metrics.viewWidth > 0 && metrics.viewWidth === lastW && metrics.viewHeight === lastH;
      lastW = metrics.viewWidth;
      lastH = metrics.viewHeight;
      if (!settled && tries++ < 30) {
        window.setTimeout(attempt, 80);
        return;
      }
      position();
    } catch {
      /* disposed while waiting */
    }
  };
  window.setTimeout(attempt, 40);
}

function selectBlock(block: Blockly.BlockSvg): void {
  Blockly.common.setSelected(block);
}

function selectedBlock(ws: Blockly.WorkspaceSvg, except?: Blockly.BlockSvg): Blockly.BlockSvg | null {
  const selected = Blockly.common.getSelected();
  return selected instanceof Blockly.BlockSvg && selected.workspace === ws && selected !== except ? selected : null;
}

/** First empty value socket, in reading order within `root`'s subtree, that accepts `block`. */
function fillSubtree(ws: Blockly.WorkspaceSvg, root: Blockly.BlockSvg, block: Blockly.BlockSvg): boolean {
  if (!block.outputConnection) return false;
  for (const candidate of root.getDescendants(true) as Blockly.BlockSvg[]) {
    if (candidate === block || block.getDescendants(false).includes(candidate)) continue;
    for (const input of candidate.inputList) {
      const connection = input.connection;
      if (!connection || connection.type !== Blockly.ConnectionType.INPUT_VALUE || connection.targetBlock()) continue;
      if (ws.connectionChecker.canConnect(connection, block.outputConnection, false, Infinity)) {
        connection.connect(block.outputConnection);
        return true;
      }
    }
  }
  return false;
}

/**
 * Connects a freshly dropped piece to the nearest compatible socket within
 * `radius` (workspace units) — so a drop from the library snaps like a drag.
 */
function connectNearest(ws: Blockly.WorkspaceSvg, block: Blockly.BlockSvg, radius: number): boolean {
  const own = new Set(block.getDescendants(false));
  let best: { connection: Blockly.Connection; distance: number; mine: Blockly.Connection } | null = null;
  const consider = (target: Blockly.RenderedConnection | null, mine: Blockly.RenderedConnection | null) => {
    if (!target || !mine) return;
    if (!ws.connectionChecker.canConnect(target, mine, false, Infinity)) return;
    const distance = Math.hypot(target.x - mine.x, target.y - mine.y);
    if (distance <= radius && (!best || distance < best.distance)) best = { connection: target, distance, mine };
  };
  for (const candidate of ws.getAllBlocks(false) as Blockly.BlockSvg[]) {
    if (own.has(candidate)) continue;
    for (const input of candidate.inputList) {
      const connection = input.connection as Blockly.RenderedConnection | null;
      if (connection && connection.type === Blockly.ConnectionType.INPUT_VALUE && !connection.targetBlock()) {
        consider(connection, block.outputConnection);
      }
    }
    if (candidate.nextConnection && block.previousConnection) consider(candidate.nextConnection, block.previousConnection);
  }
  if (!best) return false;
  const chosen = best as { connection: Blockly.Connection; mine: Blockly.Connection };
  if (chosen.mine === block.previousConnection) {
    const displaced = chosen.connection.targetBlock();
    chosen.connection.connect(chosen.mine);
    if (displaced?.previousConnection && block.nextConnection && !block.nextConnection.targetBlock()) {
      block.nextConnection.connect(displaced.previousConnection);
    }
  } else {
    chosen.connection.connect(chosen.mine);
  }
  return true;
}

/**
 * Click-to-insert. A value piece fills the next empty compatible socket: first
 * inside the selected piece, then around it (its ancestors' subtrees), then
 * anywhere on the canvas in reading order — so clicking “Arithmetic”, then
 * “age”, then “Number” assembles a formula without any dragging. A statement
 * piece goes after the selected statement. Only when nothing accepts it does
 * a piece land loose, offset so loose pieces never stack on each other.
 */
function insertState(ws: Blockly.WorkspaceSvg, state: BlockState): void {
  const block = Blockly.serialization.blocks.append(state as Blockly.serialization.blocks.State, ws) as Blockly.BlockSvg;
  const selected = selectedBlock(ws, block);

  if (block.outputConnection) {
    let scope: Blockly.BlockSvg | null = selected;
    while (scope) {
      if (fillSubtree(ws, scope, block)) {
        selectBlock(block);
        return;
      }
      scope = scope.getParent() as Blockly.BlockSvg | null;
    }
    for (const top of ws.getTopBlocks(true) as Blockly.BlockSvg[]) {
      if (top !== block && fillSubtree(ws, top, block)) {
        selectBlock(block);
        return;
      }
    }
  }

  if (block.previousConnection && selected?.nextConnection) {
    const after = selected.nextConnection;
    if (ws.connectionChecker.canConnect(after, block.previousConnection, false, Infinity)) {
      const displaced = after.targetBlock();
      after.connect(block.previousConnection);
      if (displaced?.previousConnection && block.nextConnection) block.nextConnection.connect(displaced.previousConnection);
      selectBlock(block);
      return;
    }
  }

  if (block.outputConnection && ws.getTopBlocks(false).length > 1) {
    const kind = describeCheck(block.outputConnection.getCheck());
    toast(`No empty ${kind} socket on the canvas — placed the piece loose. Drag it where it belongs.`);
  }
  const metrics = ws.getMetrics();
  const loose = ws.getTopBlocks(false).length - 1;
  block.moveBy(
    (metrics.viewLeft + metrics.viewWidth / 2) / ws.scale - 60 + (loose % 6) * 26,
    (metrics.viewTop + metrics.viewHeight / 2) / ws.scale - 20 + (loose % 6) * 30,
  );
  selectBlock(block);
}

const CHECK_NAME: Record<string, string> = { Number: "number", String: "text", Boolean: "yes/no" };

function describeCheck(check: string[] | null): string {
  return check?.length ? check.map((name) => CHECK_NAME[name] ?? name.toLowerCase()).join(" or ") : "any";
}

/** What to do instead, for the type pairs people mix up most. */
function mismatchHint(piece: string, socket: string): string {
  if (piece === "number" && socket === "yes/no") return "Compare it first, e.g. age ≥ 65.";
  if (piece === "yes/no" && socket === "number") return "Turn it into points with if(condition, 1, 0).";
  if (piece === "text" && socket === "yes/no") return "Use “is” or “is one of” to test a text value.";
  if (piece === "text" && socket === "number") return "Text can’t be used in arithmetic; compare it instead.";
  return "Each socket only accepts its own type.";
}

/**
 * When a loose piece lands next to an empty socket that rejects its type,
 * say why it didn't snap instead of leaving the user guessing.
 */
function explainNearMiss(ws: Blockly.WorkspaceSvg, block: Blockly.BlockSvg, radius: number): void {
  const out = block.outputConnection as Blockly.RenderedConnection | null;
  if (!out) return;
  const own = new Set(block.getDescendants(false));
  let best: { socket: Blockly.RenderedConnection; distance: number } | null = null;
  for (const candidate of ws.getAllBlocks(false) as Blockly.BlockSvg[]) {
    if (own.has(candidate)) continue;
    for (const input of candidate.inputList) {
      const socket = input.connection as Blockly.RenderedConnection | null;
      if (!socket || socket.type !== Blockly.ConnectionType.INPUT_VALUE || socket.targetBlock()) continue;
      if (ws.connectionChecker.canConnect(socket, out, false, Infinity)) continue;
      const distance = Math.hypot(socket.x - out.x, socket.y - out.y);
      if (distance <= radius && (!best || distance < best.distance)) best = { socket, distance };
    }
  }
  if (!best) return;
  const piece = describeCheck(out.getCheck());
  const socket = describeCheck(best.socket.getCheck());
  toast(`A ${piece} piece doesn’t fit a ${socket} socket. ${mismatchHint(piece, socket)}`);
}
