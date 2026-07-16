/**
 * GenerationReviewPanel — the second of the three visible components the plan
 * authorizes (Section 6.3, 11.2).
 *
 * It lives in the right inspector's Candidates tab: the requirement composer
 * sits on top, the turn's durable status and every candidate lineage (with its
 * admission state and first blocking diagnostic) fill the rest of the column.
 * Selecting an admitted version updates the session selection; it does not
 * open another editor or introduce a transcript.
 */

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type { CandidateSummary, CandidateVersionSummary, SessionTurnDetail } from "../../shared/contracts";
import {
  CANDIDATE_COUNT_DEFAULT,
  CANDIDATE_COUNT_MAX,
  CANDIDATE_COUNT_MIN,
  REQUIREMENT_MAX_LENGTH,
} from "../../shared/contracts";
import { api } from "../api/client";
import {
  Chip,
  EmptyState,
  KV,
  LoadingState,
  PaneBody,
  StatusPill,
  cap,
  capSm,
  primaryBtn,
  selectSmCls,
  textareaCls,
} from "../shared-console/src";

/** Poll no faster than once per second while work is in flight (Section 10). */
const POLL_INTERVAL_MS = 1_000;

export function turnQueryKey(turnId: string): readonly unknown[] {
  return ["session-turn", turnId];
}

/** The version a reviewer acts on: the newest in the lineage. */
export function currentVersion(candidate: CandidateSummary): CandidateVersionSummary | undefined {
  return candidate.versions[candidate.versions.length - 1];
}

export function GenerationReviewPanel({
  sessionId,
  turns,
  selectedVersionId,
  onSelectVersion,
}: {
  sessionId: string;
  turns: SessionTurnDetail[];
  selectedVersionId: string | null;
  onSelectVersion: (versionId: string) => void;
}) {
  const [requirement, setRequirement] = useState("");
  const [candidateCount, setCandidateCount] = useState(CANDIDATE_COUNT_DEFAULT);
  const queryClient = useQueryClient();

  const health = useQuery({
    queryKey: ["health"],
    queryFn: api.getHealth,
    staleTime: 30_000,
  });
  const generatorConfigured = health.data?.generator.configured === true;

  // The latest turn is shown by default; earlier turns stay in the session.
  const latestTurn = turns[turns.length - 1];

  const turn = useQuery({
    queryKey: turnQueryKey(latestTurn?.id ?? "none"),
    queryFn: () => api.getTurn(latestTurn!.id),
    enabled: Boolean(latestTurn),
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === "pending" || status === "running" ? POLL_INTERVAL_MS : false;
    },
  });

  const generate = useMutation({
    mutationFn: () => api.createTurn(sessionId, { requirement, candidate_count: candidateCount }),
    onSuccess: async () => {
      setRequirement("");
      // A retry appends a new turn; the failed one is never rewritten.
      await queryClient.invalidateQueries({ queryKey: ["session", sessionId] });
    },
  });

  const detail = turn.data;

  return (
    <>
      {/* Composer: one requirement in, several candidates out. */}
      <div className="flex flex-none flex-col gap-2 border-b border-border-2 px-[11px] py-2">
        <textarea
          className={`${textareaCls} min-h-[64px]`}
          aria-label="Natural-language requirement"
          placeholder="Describe the formula in plain language, e.g. “Score risk of developing diabetes from baseline fasting glucose and BMI”."
          maxLength={REQUIREMENT_MAX_LENGTH}
          value={requirement}
          disabled={generate.isPending}
          onChange={(event) => setRequirement(event.target.value)}
        />
        <div className="flex items-center gap-2">
          <label className={`${capSm} flex items-center gap-1.5`}>
            Candidates
            <select
              className={selectSmCls}
              aria-label="Candidate count"
              value={candidateCount}
              disabled={generate.isPending}
              onChange={(event) => setCandidateCount(Number(event.target.value))}
            >
              {Array.from({ length: CANDIDATE_COUNT_MAX - CANDIDATE_COUNT_MIN + 1 }, (_, i) => i + CANDIDATE_COUNT_MIN).map(
                (count) => (
                  <option key={count} value={count}>
                    {count}
                  </option>
                ),
              )}
            </select>
          </label>
          <button
            type="button"
            className={`${primaryBtn} ml-auto`}
            disabled={requirement.trim() === "" || generate.isPending || !generatorConfigured}
            onClick={() => generate.mutate()}
          >
            {generate.isPending ? "Submitting…" : "Generate candidates"}
          </button>
        </div>
        {!health.isLoading && !generatorConfigured && (
          <p className="m-0 text-body text-warn">
            No generator configured. Configure it in the API server environment.
          </p>
        )}
        {generate.error && (
          <p className="m-0 text-body text-bad">
            {generate.error instanceof Error ? generate.error.message : "Generation could not be started."}
          </p>
        )}
      </div>

      <PaneBody>
        <TurnBody
          turn={detail}
          isLoading={Boolean(latestTurn) && turn.isLoading}
          hasTurn={Boolean(latestTurn)}
          selectedVersionId={selectedVersionId}
          onSelectVersion={onSelectVersion}
        />
      </PaneBody>
    </>
  );
}

function TurnBody({
  turn,
  isLoading,
  hasTurn,
  selectedVersionId,
  onSelectVersion,
}: {
  turn: SessionTurnDetail | undefined;
  isLoading: boolean;
  hasTurn: boolean;
  selectedVersionId: string | null;
  onSelectVersion: (versionId: string) => void;
}) {
  if (!hasTurn) {
    return (
      <EmptyState
        title="No candidates yet"
        hint="Submit a requirement to generate several candidate formulas for review."
      />
    );
  }
  if (isLoading) return <LoadingState label="Loading candidates…" />;
  if (!turn) return null;

  return (
    <>
      {/* The requirement this turn answered, so the review has its question. */}
      <div className="flex flex-none flex-col gap-1 border-b border-border-2 bg-card-2 px-[11px] py-2">
        <div className="flex items-center gap-2">
          <span className={capSm}>Requirement</span>
          <StatusPill status={turn.status} pulse={turn.status === "pending" || turn.status === "running"} />
          <span className="ui-mono ml-auto min-w-0 truncate text-fine text-muted-fg">
            {turn.provider} · {turn.model}
          </span>
        </div>
        <p className="m-0 min-w-0 text-body leading-relaxed text-fg">{turn.requirement}</p>
      </div>
      <TurnOutcome turn={turn} selectedVersionId={selectedVersionId} onSelectVersion={onSelectVersion} />
    </>
  );
}

function TurnOutcome({
  turn,
  selectedVersionId,
  onSelectVersion,
}: {
  turn: SessionTurnDetail;
  selectedVersionId: string | null;
  onSelectVersion: (versionId: string) => void;
}) {
  if (turn.status === "failed") {
    return (
      <EmptyState
        title="Generation failed"
        hint={`${turn.error?.code ?? "UNKNOWN"} — ${turn.error?.message ?? "The turn did not complete."} Submit again to retry; this attempt stays on the record.`}
      />
    );
  }

  if (turn.status === "pending" || turn.status === "running") {
    return <LoadingState label={`Generating ${turn.candidate_count} candidates…`} />;
  }

  return (
    <div>
      {turn.candidates.map((candidate) => (
        <CandidateRow
          key={candidate.id}
          candidate={candidate}
          selectedVersionId={selectedVersionId}
          onSelectVersion={onSelectVersion}
        />
      ))}
    </div>
  );
}

function CandidateRow({
  candidate,
  selectedVersionId,
  onSelectVersion,
}: {
  candidate: CandidateSummary;
  selectedVersionId: string | null;
  onSelectVersion: (versionId: string) => void;
}) {
  const version = currentVersion(candidate);
  if (!version) return null;

  const admitted = version.admission_state === "admitted";
  const selected = version.id === selectedVersionId;
  const repaired = candidate.versions.some((entry) => entry.source === "repair");

  return (
    <div className="border-b border-border-2">
      <button
        type="button"
        onClick={() => admitted && onSelectVersion(version.id)}
        aria-pressed={selected}
        className="w-full cursor-pointer px-[11px] py-2 text-left hover:bg-muted disabled:cursor-default"
        disabled={!admitted}
        style={selected ? { background: "var(--muted)", boxShadow: "inset 3px 0 0 var(--primary)" } : undefined}
      >
        <div className="flex items-center gap-2">
          <span className="ui-mono min-w-0 truncate text-body font-medium text-fg">
            {candidate.proposal_id.replace(/^proposal_/, "")}
          </span>
          <Chip
            label={admitted ? "admitted" : "blocked"}
            color={admitted ? "var(--risk-low)" : "var(--bad)"}
          />
          {repaired && <Chip label="repaired" color="var(--warn)" title="One bounded repair was applied." />}
          <span className="ui-mono ml-auto flex-none text-fine text-muted-fg">
            v{version.version_no} · {version.source}
          </span>
        </div>

        {admitted ? (
          <>
            {version.explanation && (
              <p className="m-0 mt-1 text-body leading-relaxed text-muted-fg">{version.explanation}</p>
            )}
            {version.assumptions.length > 0 && (
              <ul className="m-0 mt-1 list-disc pl-4 text-cap text-muted-fg">
                {version.assumptions.map((assumption) => (
                  <li key={assumption}>{assumption}</li>
                ))}
              </ul>
            )}
            {version.ast_hash && (
              <div className="mt-1">
                <KV k="AST" v={version.ast_hash.slice(0, 12)} />
              </div>
            )}
          </>
        ) : (
          <p className="m-0 mt-1 text-body leading-relaxed text-bad">
            <span className={cap}>{version.first_diagnostic?.code ?? "BLOCKED"}</span>{" "}
            {version.first_diagnostic?.message ?? "This candidate did not pass admission."}
          </p>
        )}
      </button>

      {candidate.versions.length > 1 && (
        <details className="border-t border-border-2 bg-card-2 px-[11px] py-1.5">
          <summary className="cursor-pointer text-cap text-muted-fg">Version history</summary>
          <div className="mt-1.5 space-y-1.5">
            {candidate.versions.map((entry) => (
              <div key={entry.id} className="rounded-md border border-border-2 px-2 py-1.5">
                <div className="flex items-center gap-2">
                  <span className="ui-mono text-fine text-fg">v{entry.version_no} · {entry.source}</span>
                  <Chip
                    label={entry.admission_state}
                    color={entry.admission_state === "admitted" ? "var(--risk-low)" : "var(--bad)"}
                  />
                </div>
                {entry.first_diagnostic && (
                  <p className="m-0 mt-1 text-cap leading-relaxed text-bad">
                    <span className="ui-mono">{entry.first_diagnostic.code}</span> · {entry.first_diagnostic.path} — {entry.first_diagnostic.message}
                  </p>
                )}
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}
