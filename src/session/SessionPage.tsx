/**
 * SessionPage — page composition (plan Section 6.3), not a new design
 * primitive. It places the one new permanent column (the session rail) beside
 * the formula workspace and owns page-level state only.
 *
 * The workspace is one flat row under a single compact header: library rail,
 * Blockly canvas, and the right inspector whose tabs carry the generation
 * review and the cohort evaluation. No fourth workspace pane and no new card,
 * hero, or dashboard layer belongs here.
 */

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router-dom";

import type { SessionDetailResponse } from "../../shared/contracts";
import { SESSION_TITLE_MAX_LENGTH } from "../../shared/contracts";
import { ApiError, api } from "../api/client";
import {
  ConfirmDialog,
  EmptyState,
  LoadingState,
  Page,
  Pane,
  PaneBody,
  PaneHeader,
  StatusPill,
  cap,
  ghostBtn,
  inputSmCls,
  softBtn,
} from "../shared-console/src";
import { FormulaWorkspace } from "../formula/FormulaWorkspace";
import { SessionRail } from "./SessionRail";

/**
 * Which candidate owns the selected version. The session stores the version id;
 * saving a child version needs its lineage, and the turn list already carries
 * the mapping, so this avoids another request.
 */
function selectedCandidateId(detail: SessionDetailResponse): string | null {
  const selected = detail.session.selected_candidate_version_id;
  if (!selected) return null;
  for (const turn of detail.turns) {
    for (const candidate of turn.candidates ?? []) {
      if (candidate.versions.some((version) => version.id === selected)) return candidate.id;
    }
  }
  return null;
}

export function SessionPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();

  const selectSession = (id: string) => navigate(`/sessions/${id}`);

  return (
    <Page>
      <SessionRail selectedSessionId={sessionId ?? null} onSelect={selectSession} />
      {sessionId ? <SessionWorkspace sessionId={sessionId} /> : <NoSessionSelected />}
    </Page>
  );
}

function NoSessionSelected() {
  return (
    <Pane>
      <PaneHeader label="Session" />
      <PaneBody>
        <EmptyState
          title="No session selected"
          hint="Choose a session from the rail, or create one to start a new formula review."
        />
      </PaneBody>
    </Pane>
  );
}

function SessionWorkspace({ sessionId }: { sessionId: string }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const session = useQuery({
    queryKey: ["session", sessionId],
    queryFn: () => api.getSession(sessionId),
    retry: false,
  });

  const patch = useMutation({
    mutationFn: (input: Parameters<typeof api.patchSession>[1]) => api.patchSession(sessionId, input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["session", sessionId] });
      await queryClient.invalidateQueries({ queryKey: ["sessions"] });
    },
  });

  if (session.isLoading) {
    return (
      <Pane>
        <PaneHeader label="Session" />
        <PaneBody>
          <LoadingState label="Loading session…" />
        </PaneBody>
      </Pane>
    );
  }

  if (session.error) {
    const missing = session.error instanceof ApiError && session.error.code === "SESSION_NOT_FOUND";
    return (
      <Pane>
        <PaneHeader label="Session" />
        <PaneBody>
          <EmptyState
            title={missing ? "Session not found" : "Could not load this session"}
            hint={session.error instanceof Error ? session.error.message : undefined}
            action={
              <button type="button" className={ghostBtn} onClick={() => (missing ? navigate("/") : void session.refetch())}>
                {missing ? "Back to sessions" : "Retry"}
              </button>
            }
          />
        </PaneBody>
      </Pane>
    );
  }

  const detail = session.data!;

  return (
    <Pane>
      <SessionHeader
        title={detail.session.title}
        status={detail.session.status}
        turnCount={detail.turns.length}
        isBusy={patch.isPending}
        onRename={(title) => patch.mutate({ title })}
        onArchiveChange={(archived) => patch.mutate({ status: archived ? "archived" : "active" })}
      />
      {/* Library rail, canvas, and the review inspector — one flat row. */}
      <div className="flex min-h-0 flex-1 mobile:flex-col">
        <FormulaWorkspace
          sessionId={sessionId}
          candidateId={selectedCandidateId(detail)}
          versionId={detail.session.selected_candidate_version_id}
          turns={detail.turns}
          onSelectVersion={(versionId) => patch.mutate({ selected_candidate_version_id: versionId })}
        />
      </div>
    </Pane>
  );
}

/** One compact row: label, inline-editable title, turn count, status, archive. */
function SessionHeader({
  title,
  status,
  turnCount,
  isBusy,
  onRename,
  onArchiveChange,
}: {
  title: string;
  status: "active" | "archived";
  turnCount: number;
  isBusy: boolean;
  onRename: (title: string) => void;
  onArchiveChange: (archived: boolean) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const [confirmArchive, setConfirmArchive] = useState(false);

  // A rename elsewhere must not be overwritten by a stale local draft.
  useEffect(() => setDraft(null), [title]);

  const commit = () => {
    const next = (draft ?? "").trim();
    setDraft(null);
    if (next !== "" && next !== title) onRename(next);
  };

  return (
    <>
      <div className="flex min-h-[37px] flex-none items-center gap-2 border-b border-border-2 bg-card px-[11px] py-1.5">
        <span className={`${cap} flex-none`}>Session</span>
        <input
          className={`${inputSmCls} w-full min-w-0 max-w-[420px] flex-1`}
          aria-label="Session title"
          maxLength={SESSION_TITLE_MAX_LENGTH}
          value={draft ?? title}
          disabled={isBusy}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
            if (event.key === "Escape") setDraft(null);
          }}
        />
        {draft !== null && draft.trim() !== "" && draft !== title && (
          <button type="button" className={softBtn} disabled={isBusy} onMouseDown={(e) => e.preventDefault()} onClick={commit}>
            Rename
          </button>
        )}
        <div className="ml-auto flex flex-none items-center gap-2">
          {turnCount > 0 && (
            <span className="ui-mono rounded-[9px] bg-muted px-[7px] py-px text-cap font-semibold text-fg">
              {turnCount} turn{turnCount === 1 ? "" : "s"}
            </span>
          )}
          <StatusPill status={status} />
          {status === "archived" ? (
            <button type="button" className={ghostBtn} disabled={isBusy} onClick={() => onArchiveChange(false)}>
              Reopen
            </button>
          ) : (
            <button type="button" className={ghostBtn} disabled={isBusy} onClick={() => setConfirmArchive(true)}>
              Archive
            </button>
          )}
        </div>
      </div>

      {confirmArchive && (
        <ConfirmDialog
          title="Archive this session?"
          message="It leaves the active list but is never deleted; you can reopen it from the Archived tab."
          confirmLabel="Archive"
          busy={isBusy}
          onConfirm={() => {
            setConfirmArchive(false);
            onArchiveChange(true);
          }}
          onClose={() => setConfirmArchive(false)}
        />
      )}
    </>
  );
}
