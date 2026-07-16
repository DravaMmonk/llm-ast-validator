/**
 * Blockly workspace lifecycle as a hook, modeled on the reference feature
 * builder's `useWorkspace`. It owns inject/dispose, the change listener with a
 * loading gate (programmatic loads never mark the draft dirty), drag-and-drop
 * from the library rail, and the imperative canvas API the workspace component
 * uses (insert with smart-connect / load document / tidy / undo / redo).
 *
 * The registry-driven block definitions and the AST conversion stay in
 * `diabetesBlocklyAdapter` — this hook is canvas plumbing only.
 */

import { useEffect, useRef } from "react";
import * as Blockly from "blockly/core";
import "blockly/blocks";

import type { AstDocument } from "../../shared/ast/core";
import { type BlockState, blockDefinitions, documentToBlock } from "./diabetesBlocklyAdapter";

/*
 * Concrete colors, not CSS vars: Blockly paints into SVG attributes and cannot
 * resolve var() there. Values mirror the console tokens (light / .dark).
 */
const CANVAS_COLORS = {
  light: {
    workspaceBackgroundColour: "#fcfcfb",
    flyoutBackgroundColour: "#ffffff",
    scrollbarColour: "#e4e4e7",
    insertionMarkerColour: "#6b7d49",
    markerColour: "#6b7d49",
    cursorColour: "#6b7d49",
  },
  dark: {
    workspaceBackgroundColour: "#121317",
    flyoutBackgroundColour: "#16171c",
    scrollbarColour: "#2e2e35",
    insertionMarkerColour: "#9bb37a",
    markerColour: "#9bb37a",
    cursorColour: "#9bb37a",
  },
  gridLight: "#e7e7e4",
  gridDark: "#26262b",
};

const themeCache: Record<string, Blockly.Theme> = {};

function canvasTheme(dark: boolean): Blockly.Theme {
  const key = dark ? "dark" : "light";
  themeCache[key] ??= Blockly.Theme.defineTheme(`diabetes_canvas_${key}`, {
    name: `diabetes_canvas_${key}`,
    base: Blockly.Themes.Classic,
    componentStyles: CANVAS_COLORS[key],
    fontStyle: { family: "Inter, system-ui, sans-serif", weight: "600", size: 13 },
  });
  return themeCache[key];
}

let blocksRegistered = false;

/** Registers one Blockly block per registry entry, exactly once per page. */
function ensureBlocksRegistered(): void {
  if (blocksRegistered) return;
  for (const definition of blockDefinitions()) {
    if (Blockly.Blocks[definition.type]) continue;
    Blockly.Blocks[definition.type] = {
      init(this: Blockly.Block) {
        this.jsonInit({
          message0: definition.message0,
          args0: definition.args0,
          inputsInline: definition.inputsInline,
          output: definition.output,
          colour: definition.colour,
          tooltip: definition.tooltip,
        });
      },
    };
  }
  blocksRegistered = true;
}

export interface CanvasApi {
  ws: () => Blockly.WorkspaceSvg | null;
  /** Insert a block; snaps into the selected block's first compatible empty
   *  input, otherwise drops at the viewport centre. */
  insert: (blockType: string, fields?: Record<string, string | number>) => void;
  /** Replace the canvas with an AST document without marking it dirty. */
  loadDocument: (document: AstDocument) => void;
  /** Serialized state of every top-level block, in position order. */
  topBlockStates: () => BlockState[];
  isEmpty: () => boolean;
  tidy: () => void;
  undo: () => void;
  redo: () => void;
}

export function useBlocklyCanvas(
  hostRef: React.RefObject<HTMLDivElement | null>,
  onChange: () => void,
): CanvasApi {
  const wsRef = useRef<Blockly.WorkspaceSvg | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  /** Gates the change listener so programmatic loads don't mark dirty. */
  const loadingRef = useRef(false);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || wsRef.current) return;
    ensureBlocksRegistered();

    const dark = document.documentElement.classList.contains("dark");
    const ws = Blockly.inject(host, {
      theme: canvasTheme(dark),
      renderer: "zelos",
      // Served from the project's own public dir (vite publicDir maps to
      // node_modules/blockly/media) — never Google's demo CDN.
      media: import.meta.env.BASE_URL,
      sounds: false,
      trashcan: true,
      grid: { spacing: 22, length: 3, colour: dark ? CANVAS_COLORS.gridDark : CANVAS_COLORS.gridLight, snap: true },
      zoom: { controls: true, wheel: true, startScale: 0.85, maxScale: 3, minScale: 0.3, scaleSpeed: 1.2 },
      move: { scrollbars: true, drag: true, wheel: false },
    });
    wsRef.current = ws;

    // The zoom controls + trashcan reference the raster sprite sheet; swap to
    // the vector twin (same layout) — it renders crisper on retina displays.
    for (const img of host.querySelectorAll<SVGImageElement>("image")) {
      const href = img.getAttribute("xlink:href") ?? img.getAttribute("href");
      if (href?.endsWith("sprites.png")) {
        const svgHref = href.replace("sprites.png", "sprites.svg");
        img.setAttribute("xlink:href", svgHref);
        img.setAttribute("href", svgHref);
      }
    }

    ws.addChangeListener((event: Blockly.Events.Abstract) => {
      if (
        event.type === Blockly.Events.VIEWPORT_CHANGE ||
        event.type === Blockly.Events.CLICK ||
        event.type === Blockly.Events.SELECTED ||
        event.isUiEvent
      )
        return;
      if (loadingRef.current) return;
      onChangeRef.current();
    });

    // Library drag-and-drop → drop a fresh block under the cursor.
    const onDragOver = (event: DragEvent) => {
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
    };
    const onDrop = (event: DragEvent) => {
      event.preventDefault();
      if (!event.dataTransfer) return;
      let payload: { blockType: string; fields?: Record<string, string | number> };
      try {
        payload = JSON.parse(event.dataTransfer.getData("application/json"));
      } catch {
        return;
      }
      if (!payload?.blockType) return;
      // Screen → workspace coordinates via Blockly's own math — it accounts
      // for scroll, zoom, and the injection offset.
      const point = Blockly.utils.svgMath.screenToWsCoordinates(
        ws,
        new Blockly.utils.Coordinate(event.clientX, event.clientY),
      );
      const block = newBlock(ws, payload.blockType, payload.fields);
      block.moveBy(point.x - 16, point.y - 12);
      block.select();
    };
    host.addEventListener("dragover", onDragOver);
    host.addEventListener("drop", onDrop);

    const observer = new ResizeObserver(() => Blockly.svgResize(ws));
    observer.observe(host);
    setTimeout(() => {
      Blockly.svgResize(ws);
      try {
        ws.scrollCenter();
      } catch {
        /* noop */
      }
    }, 50);

    return () => {
      observer.disconnect();
      host.removeEventListener("dragover", onDragOver);
      host.removeEventListener("drop", onDrop);
      try {
        ws.dispose();
      } catch {
        /* noop */
      }
      wsRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-once Blockly inject/dispose lifecycle
  }, []);

  const api = useRef<CanvasApi>({
    ws: () => wsRef.current,
    insert(blockType, fields) {
      const ws = wsRef.current;
      if (!ws) return;
      // One event group → one undo removes the whole insert.
      Blockly.Events.setGroup(true);
      try {
        insertBlock(ws, blockType, fields);
      } finally {
        Blockly.Events.setGroup(false);
      }
    },
    loadDocument(document) {
      const ws = wsRef.current;
      if (!ws) return;
      loadingRef.current = true;
      try {
        ws.clear();
        Blockly.serialization.blocks.append(
          documentToBlock(document) as unknown as Blockly.serialization.blocks.State,
          ws,
        );
        ws.render();
      } finally {
        loadingRef.current = false;
      }
      recenter(ws);
    },
    topBlockStates() {
      const ws = wsRef.current;
      if (!ws) return [];
      return ws
        .getTopBlocks(true)
        .map((top) => Blockly.serialization.blocks.save(top) as unknown as BlockState);
    },
    isEmpty() {
      const ws = wsRef.current;
      return !ws || ws.getAllBlocks(false).length === 0;
    },
    tidy() {
      const ws = wsRef.current;
      if (!ws) return;
      ws.cleanUp();
      try {
        ws.scrollCenter();
      } catch {
        /* noop */
      }
    },
    undo() {
      wsRef.current?.undo(false);
    },
    redo() {
      wsRef.current?.undo(true);
    },
  });
  return api.current;
}

/**
 * Re-centre the canvas on its content once the layout has settled. The pane can
 * still be flexing when a version loads, so the workspace may report a
 * zero-sized viewport for a while — poll until metrics are real and stable,
 * then centre on the largest top block.
 */
function recenter(ws: Blockly.WorkspaceSvg): void {
  let tries = 0;
  let lastW = -1;
  let lastH = -1;
  const attempt = () => {
    if (!ws.rendered) return; // disposed while waiting
    try {
      Blockly.svgResize(ws);
      const metrics = ws.getMetrics();
      const settled =
        metrics.viewWidth > 0 && metrics.viewHeight > 0 && metrics.viewWidth === lastW && metrics.viewHeight === lastH;
      lastW = metrics.viewWidth;
      lastH = metrics.viewHeight;
      if (!settled && tries++ < 30) {
        setTimeout(attempt, 100);
        return;
      }
      const tops = ws.getTopBlocks(false);
      let best: Blockly.Block | null = null;
      for (const top of tops) {
        if (!best || top.getDescendants(false).length > best.getDescendants(false).length) best = top;
      }
      if (best) ws.centerOnBlock(best.id);
    } catch {
      /* noop */
    }
  };
  setTimeout(attempt, 60);
}

/** Create a block and either snap it into the selected block's first compatible
 *  empty input (smart connect) or drop it at the viewport centre. */
function insertBlock(ws: Blockly.WorkspaceSvg, blockType: string, fields?: Record<string, string | number>): void {
  const block = newBlock(ws, blockType, fields);
  const selected = Blockly.getSelected();
  if (selected && selected instanceof Blockly.BlockSvg && selected.workspace === ws && block.outputConnection) {
    for (const input of selected.inputList) {
      const connection = input.connection;
      if (!connection || connection.targetBlock()) continue;
      if (ws.connectionChecker.canConnect(connection, block.outputConnection, false, Infinity)) {
        connection.connect(block.outputConnection);
        block.select();
        return;
      }
    }
  }
  const metrics = ws.getMetrics();
  block.moveBy(
    (metrics.viewLeft + metrics.viewWidth / 2) / ws.scale - 40,
    (metrics.viewTop + metrics.viewHeight / 2) / ws.scale - 20,
  );
  try {
    ws.centerOnBlock(block.id);
  } catch {
    /* noop */
  }
  block.select();
}

function newBlock(
  ws: Blockly.WorkspaceSvg,
  type: string,
  fields?: Record<string, string | number>,
): Blockly.BlockSvg {
  const block = ws.newBlock(type) as Blockly.BlockSvg;
  if (fields)
    for (const [key, value] of Object.entries(fields)) {
      try {
        block.setFieldValue(value, key);
      } catch {
        /* unknown field — ignore */
      }
    }
  block.initSvg();
  block.render();
  return block;
}
