/**
 * The formula workspace: library rail, Blockly canvas with its fx bar, and the
 * right inspector (plan Section 6.4, 11.3).
 *
 * Layout follows the reference workspace: the library rail feeds the
 * canvas by click-to-insert or drag; the canvas carries a floating
 * undo/redo/tidy toolbar and a floating validation chip; the editable text
 * twin (fx bar) sits directly under the canvas; and the right inspector owns
 * the review flow as tabs — Candidates (generation review), Formula
 * (admission read-outs), and Cohort results.
 *
 * This is domain composition over the shared kit and the diabetes adapters,
 * not a new design primitive.
 *
 * Editing never mutates the database. `Save version` sends the AST to the
 * server, which is the only validation authority, and the server appends a
 * `blockly` child version.
 */

import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type { AstDocument } from "../../shared/ast/core";
import { hashDocument } from "../../shared/ast/core";
import type { SessionTurnDetail } from "../../shared/contracts";
import { ApiError, api } from "../api/client";
import {
  ConfirmDialog,
  EmptyState,
  KV,
  LoadingState,
  Pane,
  PaneBody,
  PaneFooter,
  PaneHeader,
  TabBar,
  capSm,
  ghostBtn,
  inputCls,
  primaryBtn,
} from "../shared-console/src";
import { CohortEvaluationPanel } from "../session/CohortEvaluationPanel";
import { GenerationReviewPanel } from "../session/GenerationReviewPanel";
import type { CatalogEntry } from "./diabetesCatalog";
import { BlockConversionError, blockToDocument } from "./diabetesBlocklyAdapter";
import { ExpressionError, parseFormula, printFormula } from "./diabetesExpressionAdapter";
import { formatBlockLatex, formatFormulaLatex } from "./diabetesLatexAdapter";
import { FormulaLibrary } from "./FormulaLibrary";
import { FormulaPreview } from "./FormulaPreview";
import { type CanvasApi, useBlocklyCanvas } from "./useBlocklyCanvas";

type InspectorTab = "candidates" | "formula" | "results";

export function FormulaWorkspace({
  sessionId,
  candidateId,
  versionId,
  turns,
  onSelectVersion,
}: {
  sessionId: string;
  candidateId: string | null;
  versionId: string | null;
  turns: SessionTurnDetail[];
  onSelectVersion: (versionId: string) => void;
}) {
  const queryClient = useQueryClient();

  // The tab and dirty flag live above the per-version editor so the inspector
  // survives a version switch.
  const [tab, setTab] = useState<InspectorTab>("candidates");
  const [dirty, setDirty] = useState(false);
  const canvasRef = useRef<CanvasApi | null>(null);

  const version = useQuery({
    queryKey: ["candidate-version", versionId],
    queryFn: () => api.getVersion(versionId!),
    enabled: Boolean(versionId),
    retry: false,
  });

  const editorReady = Boolean(versionId && candidateId && version.data?.ast);

  return (
    <>
      <FormulaLibrary
        disabled={!editorReady}
        onInsert={(entry: CatalogEntry) => canvasRef.current?.insert(entry.insert.blockType, entry.insert.fields)}
      />

      {editorReady ? (
        <Editor
          key={versionId}
          candidateId={candidateId!}
          versionId={versionId!}
          document={version.data!.ast!}
          onCanvasApi={(apiRef) => {
            canvasRef.current = apiRef;
          }}
          onDirtyChange={setDirty}
          onSaved={async () => {
            // The review panel reads the turn under its own key, so invalidating
            // only "session" would leave the candidate row showing the old version.
            await Promise.all([
              queryClient.invalidateQueries({ queryKey: ["session"] }),
              queryClient.invalidateQueries({ queryKey: ["session-turn"] }),
            ]);
          }}
        />
      ) : (
        <CanvasPlaceholder
          hasSelection={Boolean(versionId && candidateId)}
          loading={Boolean(versionId) && version.isLoading}
          error={version.error}
        />
      )}

      <Pane w={360} side="l">
        <TabBar
          value={tab}
          onChange={setTab}
          options={[
            { v: "candidates", label: "Candidates" },
            { v: "formula", label: "Formula" },
            { v: "results", label: "Cohort results" },
          ]}
        />
        {tab === "candidates" && (
          <GenerationReviewPanel
            sessionId={sessionId}
            turns={turns}
            selectedVersionId={versionId}
            onSelectVersion={onSelectVersion}
          />
        )}
        {tab === "formula" &&
          (version.data?.ast ? (
            <FormulaInspector document={version.data.ast} validation={version.data.validation} dirty={dirty} />
          ) : (
            <PaneBody>
              <EmptyState
                title="No candidate selected"
                hint="Select an admitted candidate in the Candidates tab to inspect its admission record."
              />
            </PaneBody>
          ))}
        {tab === "results" && (
          <CohortEvaluationPanel sessionId={sessionId} versionId={versionId} isDirty={dirty} />
        )}
      </Pane>
    </>
  );
}

/** The canvas pane before a version can be edited: prompt, loading, or error. */
function CanvasPlaceholder({
  hasSelection,
  loading,
  error,
}: {
  hasSelection: boolean;
  loading: boolean;
  error: unknown;
}) {
  return (
    <Pane>
      <PaneHeader label="Canvas" />
      <PaneBody>
        {loading ? (
          <LoadingState label="Loading formula…" />
        ) : !hasSelection ? (
          <EmptyState
            title="No candidate selected"
            hint="Describe a requirement in the Candidates tab, then select an admitted candidate to load it here."
          />
        ) : (
          <EmptyState
            title="This version has no loadable formula"
            hint={
              error instanceof ApiError
                ? error.message
                : "A blocked version keeps its raw content and diagnostics but never reaches the canvas."
            }
          />
        )}
      </PaneBody>
    </Pane>
  );
}

function Editor({
  candidateId,
  versionId,
  document: loaded,
  onCanvasApi,
  onDirtyChange,
  onSaved,
}: {
  candidateId: string;
  versionId: string;
  document: AstDocument;
  onCanvasApi: (api: CanvasApi | null) => void;
  onDirtyChange: (dirty: boolean) => void;
  onSaved: () => Promise<void>;
}) {
  const host = useRef<HTMLDivElement>(null);
  /** The hash of the exact loaded version: the dirty baseline (Section 11.3). */
  const baseline = useRef(hashDocument(loaded));

  const [text, setText] = useState(() => printFormula(loaded));
  const [latex, setLatex] = useState(() => formatFormulaLatex(loaded));
  const [problem, setProblem] = useState<string | null>(null);
  const [dirty, setDirtyState] = useState(false);
  const [pendingReset, setPendingReset] = useState(false);

  const setDirty = (next: boolean) => {
    setDirtyState(next);
    onDirtyChange(next);
  };

  /** Canvas is the source of truth on a block change; text follows it. */
  const canvas = useBlocklyCanvas(host, () => {
    const tops = canvas.topBlockStates();
    if (tops.length === 0) {
      setLatex("\\square");
      setProblem("The canvas is empty.");
      setDirty(true);
      return;
    }
    setLatex(tops.map(formatBlockLatex).join("\\qquad"));
    if (tops.length > 1) {
      setProblem(`${tops.length} disconnected blocks — connect everything into one formula.`);
      setDirty(true);
      return;
    }
    try {
      const document = blockToDocument(tops[0]);
      setText(printFormula(document));
      setProblem(null);
      setDirty(hashDocument(document) !== baseline.current);
    } catch (error) {
      setProblem(error instanceof BlockConversionError ? error.message : "The canvas is not a valid formula.");
      setDirty(true);
    }
  });

  // Seed the canvas with the loaded version and hand the api to the library
  // rail. Remounting per version is handled by the `key` on <Editor/>.
  useEffect(() => {
    canvas.loadDocument(loaded);
    onCanvasApi(canvas);
    return () => onCanvasApi(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-once seeding
  }, []);

  /** Text is the source of truth on commit; the canvas is rebuilt from it. */
  function applyText(next: string): string | null {
    try {
      const document = parseFormula(next);
      canvas.loadDocument(document);
      setText(printFormula(document));
      setLatex(formatFormulaLatex(document));
      setProblem(null);
      setDirty(hashDocument(document) !== baseline.current);
      return null;
    } catch (error) {
      return error instanceof ExpressionError ? error.message : "The formula could not be parsed.";
    }
  }

  const save = useMutation({
    mutationFn: () => api.saveVersion(candidateId, { ast: parseFormula(text) }),
    onSuccess: async () => {
      baseline.current = hashDocument(parseFormula(text));
      setDirty(false);
      await onSaved();
    },
  });

  function resetToLoaded(): void {
    canvas.loadDocument(loaded);
    setText(printFormula(loaded));
    setLatex(formatFormulaLatex(loaded));
    setProblem(null);
    setDirty(false);
    setPendingReset(false);
  }

  const saveError =
    save.error instanceof ApiError
      ? `${save.error.code} — ${save.error.message}`
      : save.error instanceof Error
        ? save.error.message
        : null;

  return (
    <Pane>
      <PaneHeader label="Canvas">
        {dirty && <span className="ui-mono text-fine text-warn">unsaved</span>}
        <button
          type="button"
          className={ghostBtn}
          disabled={!dirty || save.isPending}
          onClick={() => setPendingReset(true)}
        >
          Revert
        </button>
        <button
          type="button"
          className={primaryBtn}
          disabled={!dirty || problem !== null || save.isPending}
          onClick={() => save.mutate()}
        >
          {save.isPending ? "Saving…" : "Save version"}
        </button>
      </PaneHeader>

      {/* Live mathematical twin of the Blockly tree, copied from the reference builder. */}
      <FormulaPreview latex={latex} />

      <div className="relative min-h-0 flex-1 overflow-hidden">
        <div ref={host} className="absolute inset-0" data-testid="blockly-canvas" />

        {/* canvas toolbar */}
        <div className="absolute right-2.5 top-2.5 z-[5] flex items-center gap-1 rounded-lg border border-border bg-card p-0.5 shadow-sm">
          {(
            [
              { title: "Undo (⌘Z)", glyph: "↩", run: canvas.undo },
              { title: "Redo (⇧⌘Z)", glyph: "↪", run: canvas.redo },
              { title: "Tidy layout", glyph: "⌗", run: canvas.tidy },
            ] as const
          ).map((button) => (
            <button
              key={button.title}
              type="button"
              onClick={button.run}
              title={button.title}
              className="ui-mono h-6 min-w-6 cursor-pointer rounded-md border-0 bg-transparent px-1.5 text-label text-fg hover:bg-muted"
            >
              {button.glyph}
            </button>
          ))}
        </div>

        {/* floating validation strip */}
        {problem !== null && (
          <div className="pointer-events-none absolute bottom-2.5 left-1/2 z-[5] max-w-[85%] -translate-x-1/2 rounded-full border border-border bg-card px-2.5 py-1 text-dense font-medium shadow-sm" style={{ color: "var(--bad)" }}>
            ⚠ {problem}
          </div>
        )}
      </div>

      {/* fx bar: the text round trip of the same AST, directly under the canvas */}
      <FxBar expr={text} onApply={applyText} onEscape={resetToLoaded} />

      {saveError && (
        <div className="flex-none border-t border-border-2 bg-card-2 px-[11px] py-1.5 text-body" style={{ color: "var(--bad)" }}>
          {saveError}
        </div>
      )}

      <PaneFooter>
        <span className="ui-mono">version {versionId.slice(0, 8)}</span>
        <span>{dirty ? "Draft is not evaluable until saved" : "Saved"}</span>
      </PaneFooter>

      {pendingReset && (
        <ConfirmDialog
          title="Discard unsaved changes?"
          message="The canvas returns to the exact saved version. The formula you edited is not kept."
          confirmLabel="Discard"
          danger
          onConfirm={resetToLoaded}
          onClose={() => setPendingReset(false)}
        />
      )}
    </Pane>
  );
}

/** fx text bar — type a formula, Enter rebuilds the blocks. */
function FxBar({
  expr,
  onApply,
  onEscape,
}: {
  expr: string;
  onApply: (text: string) => string | null;
  onEscape: () => void;
}) {
  const [draft, setDraft] = useState<string | null>(null); // null = mirror canvas
  const [error, setError] = useState<string | null>(null);
  const value = draft ?? expr;

  return (
    <div className="flex flex-none flex-col gap-1 border-t border-border bg-card-2 px-[11px] py-2">
      <div className="flex items-center gap-1.5">
        <span className="ui-mono flex-none text-label font-semibold text-primary">fx</span>
        <input
          className={`${inputCls} ui-mono min-w-0 flex-1`}
          aria-label="Formula text"
          spellCheck={false}
          value={value}
          onChange={(event) => {
            setDraft(event.target.value);
            setError(null);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              const failure = onApply(value);
              setError(failure);
              if (!failure) setDraft(null);
            } else if (event.key === "Escape") {
              setDraft(null);
              setError(null);
              onEscape();
            }
          }}
          onBlur={() => {
            if (draft === expr) setDraft(null);
          }}
          style={{ borderColor: error ? "var(--bad)" : draft !== null ? "var(--primary)" : undefined }}
          title="Type a formula as text — Enter rebuilds the blocks. Esc reverts."
        />
      </div>
      {error ? (
        <div className="pl-6 text-dense leading-snug" style={{ color: "var(--bad)" }}>
          ⚠ {error}
        </div>
      ) : draft !== null ? (
        <div className="pl-6 text-dense text-muted-fg">↵ apply to canvas · esc revert</div>
      ) : null}
    </div>
  );
}

/** The existing AST and validation presentation, unchanged in spirit. */
function FormulaInspector({
  document: loaded,
  validation,
  dirty,
}: {
  document: AstDocument;
  validation: unknown;
  dirty: boolean;
}) {
  const report = validation as
    | { metrics?: { node_count: number; depth: number }; protected_operations?: { op: string; fallback: string }[] }
    | undefined;

  return (
    <PaneBody pad>
      <div className={capSm}>Saved formula</div>
      <div className="mt-1">
        <FormulaPreview latex={formatFormulaLatex(loaded)} variant="card" />
      </div>
      <p className="ui-mono m-0 mb-2 mt-1 text-body leading-relaxed text-fg">{printFormula(loaded)}</p>

      <div className={capSm}>Admission</div>
      <KV k="AST version" v={loaded.ast_version} />
      <KV k="Nodes" v={String(report?.metrics?.node_count ?? "—")} />
      <KV k="Depth" v={String(report?.metrics?.depth ?? "—")} />
      <KV k="Draft" v={dirty ? "unsaved changes" : "saved"} />

      {report?.protected_operations && report.protected_operations.length > 0 && (
        <>
          <div className={`${capSm} mt-2`}>Protected operations</div>
          {report.protected_operations.map((entry, index) => (
            <p key={index} className="m-0 mt-1 text-cap leading-relaxed text-muted-fg">
              <span className="ui-mono">{entry.op}</span> — {entry.fallback}
            </p>
          ))}
        </>
      )}
    </PaneBody>
  );
}
