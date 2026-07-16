/**
 * SessionRail — one of the three visible components this plan authorizes
 * (Section 6.3). It is Codex-like session creation, search, selection, rename,
 * and archive, composed only from the frozen master-list primitives.
 *
 * It is deliberately not a chat transcript and carries no message model.
 */

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type { Session, SessionStatus } from "../../shared/contracts";
import { api } from "../api/client";
import {
  EmptyState,
  LoadingState,
  MasterListGroup,
  MasterListItem,
  MasterListPane,
  MasterListSearch,
  SegTabs,
  ghostBtn,
  matchesMasterListSearch,
  pillBtn,
} from "../shared-console/src";

export function sessionsQueryKey(status: SessionStatus): readonly unknown[] {
  return ["sessions", status];
}

export function SessionRail({
  selectedSessionId,
  onSelect,
}: {
  selectedSessionId: string | null;
  onSelect: (sessionId: string) => void;
}) {
  const [status, setStatus] = useState<SessionStatus>("active");
  const [query, setQuery] = useState("");
  const queryClient = useQueryClient();

  const sessions = useQuery({
    queryKey: sessionsQueryKey(status),
    queryFn: () => api.listSessions(status),
  });

  const createSession = useMutation({
    mutationFn: () => api.createSession(),
    onSuccess: async (session) => {
      await queryClient.invalidateQueries({ queryKey: ["sessions"] });
      onSelect(session.id);
    },
  });

  const visible = useMemo(() => {
    const all = sessions.data?.sessions ?? [];
    if (query.trim() === "") return all;
    return all.filter((session) => matchesMasterListSearch(query, session.title, session.current_requirement));
  }, [sessions.data, query]);

  return (
    <MasterListPane
      label="Sessions"
      count={sessions.data ? visible.length : null}
      actions={
        <button
          type="button"
          className={pillBtn}
          onClick={() => createSession.mutate()}
          disabled={createSession.isPending}
        >
          {createSession.isPending ? "Creating…" : "New session"}
        </button>
      }
      tabs={
        <div className="flex flex-none border-b border-border-2 px-[11px] py-2">
          <SegTabs
            value={status}
            onChange={setStatus}
            options={[
              { v: "active", label: "Active" },
              { v: "archived", label: "Archived" },
            ]}
          />
        </div>
      }
      toolbar={<MasterListSearch value={query} onChange={setQuery} placeholder="Search sessions…" />}
    >
      <SessionRailBody
        status={status}
        query={query}
        sessions={visible}
        isLoading={sessions.isLoading}
        error={sessions.error}
        onRetry={() => void sessions.refetch()}
        onCreate={() => createSession.mutate()}
        selectedSessionId={selectedSessionId}
        onSelect={onSelect}
      />
    </MasterListPane>
  );
}

function SessionRailBody({
  status,
  query,
  sessions,
  isLoading,
  error,
  onRetry,
  onCreate,
  selectedSessionId,
  onSelect,
}: {
  status: SessionStatus;
  query: string;
  sessions: Session[];
  isLoading: boolean;
  error: unknown;
  onRetry: () => void;
  onCreate: () => void;
  selectedSessionId: string | null;
  onSelect: (sessionId: string) => void;
}) {
  if (isLoading) return <LoadingState label="Loading sessions…" />;

  if (error) {
    return (
      <EmptyState
        title="Could not load sessions"
        hint={error instanceof Error ? error.message : "The local API did not respond."}
        action={
          <button type="button" className={ghostBtn} onClick={onRetry}>
            Retry
          </button>
        }
      />
    );
  }

  if (sessions.length === 0) {
    if (query.trim() !== "") {
      return <EmptyState title="No matching sessions" hint="No session title or requirement matches this search." />;
    }
    if (status === "archived") {
      return <EmptyState title="No archived sessions" hint="Archived sessions stay available here once you archive one." />;
    }
    return (
      <EmptyState
        title="No sessions yet"
        hint="Create a session to turn a natural-language requirement into reviewable formula candidates."
        action={
          <button type="button" className={pillBtn} onClick={onCreate}>
            New session
          </button>
        }
      />
    );
  }

  return (
    <MasterListGroup label={status === "active" ? "Active" : "Archived"} count={sessions.length}>
      {sessions.map((session) => (
        <MasterListItem
          key={session.id}
          active={session.id === selectedSessionId}
          primary={session.title}
          tooltip={session.current_requirement ?? session.title}
          to={`/sessions/${session.id}`}
          onClick={() => onSelect(session.id)}
        />
      ))}
    </MasterListGroup>
  );
}
