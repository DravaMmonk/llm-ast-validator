import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Session, SessionDetailResponse } from "../../shared/contracts";
import { SessionPage } from "./SessionPage";

const { listSessions, createSession, getSession, patchSession } = vi.hoisted(() => ({
  listSessions: vi.fn(),
  createSession: vi.fn(),
  getSession: vi.fn(),
  patchSession: vi.fn(),
}));

vi.mock("../api/client", async () => {
  const actual = await vi.importActual<typeof import("../api/client")>("../api/client");
  return { ...actual, api: { listSessions, createSession, getSession, patchSession } };
});

const SESSION_ID = "11111111-1111-4111-8111-111111111111";

function session(overrides: Partial<Session> = {}): Session {
  return {
    id: SESSION_ID,
    title: "Fasting glucose screen",
    current_requirement: "Score risk from baseline labs",
    status: "active",
    selected_candidate_version_id: null,
    created_at: "2026-07-16T00:00:00.000Z",
    updated_at: "2026-07-16T00:00:00.000Z",
    ...overrides,
  };
}

function detail(overrides: Partial<Session> = {}): SessionDetailResponse {
  return { session: session(overrides), turns: [] };
}

function renderPage(path = `/sessions/${SESSION_ID}`) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/" element={<SessionPage />} />
          <Route path="/sessions/:sessionId" element={<SessionPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  listSessions.mockReset().mockResolvedValue({ sessions: [session()] });
  createSession.mockReset();
  getSession.mockReset().mockResolvedValue(detail());
  patchSession.mockReset();
});

describe("SessionPage — URL selection", () => {
  it("loads the session named in the URL", async () => {
    renderPage();

    await waitFor(() => expect(getSession).toHaveBeenCalledWith(SESSION_ID));
    expect(await screen.findByDisplayValue("Fasting glucose screen")).toBeInTheDocument();
  });

  it("restores the same session on a refresh of the same URL", async () => {
    renderPage();
    await screen.findByDisplayValue("Fasting glucose screen");

    // A refresh is a fresh mount at the same URL with no client-side memory.
    renderPage();

    await waitFor(() => expect(getSession).toHaveBeenLastCalledWith(SESSION_ID));
    expect(await screen.findAllByDisplayValue("Fasting glucose screen")).not.toHaveLength(0);
  });

  it("prompts for a selection when no session is in the URL", async () => {
    renderPage("/");

    expect(await screen.findByText("No session selected")).toBeInTheDocument();
    expect(getSession).not.toHaveBeenCalled();
  });

  it("mounts the generation review panel and prompts for a candidate", async () => {
    renderPage();

    expect(await screen.findByText("No candidates yet")).toBeInTheDocument();
    // With nothing selected, the canvas region prompts rather than mounting Blockly.
    expect(screen.getByText("No candidate selected")).toBeInTheDocument();
  });
});

describe("SessionPage — failures", () => {
  it("reports a missing session distinctly", async () => {
    const { ApiError } = await vi.importActual<typeof import("../api/client")>("../api/client");
    getSession.mockRejectedValue(new ApiError(404, "SESSION_NOT_FOUND", "Session does not exist."));
    renderPage();

    expect(await screen.findByText("Session not found")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Back to sessions" })).toBeInTheDocument();
  });

  it("offers a retry for a transport failure", async () => {
    getSession.mockRejectedValueOnce(new Error("The local API is unreachable. Is it running?"));
    renderPage();

    expect(await screen.findByText("Could not load this session")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });
});

describe("SessionPage — rename", () => {
  it("renames on Enter and sends only the title", async () => {
    patchSession.mockResolvedValue(session({ title: "Renamed" }));
    renderPage();
    const input = await screen.findByLabelText("Session title");

    await userEvent.clear(input);
    await userEvent.type(input, "Renamed{Enter}");

    await waitFor(() => expect(patchSession).toHaveBeenCalledWith(SESSION_ID, { title: "Renamed" }));
  });

  it("does not call the API when the title is unchanged", async () => {
    renderPage();
    const input = await screen.findByLabelText("Session title");

    await userEvent.click(input);
    await userEvent.tab();

    expect(patchSession).not.toHaveBeenCalled();
  });

  it("does not submit an empty title", async () => {
    renderPage();
    const input = await screen.findByLabelText("Session title");

    await userEvent.clear(input);
    await userEvent.tab();

    expect(patchSession).not.toHaveBeenCalled();
  });

  it("abandons the draft on Escape", async () => {
    renderPage();
    const input = await screen.findByLabelText("Session title");

    await userEvent.clear(input);
    await userEvent.type(input, "Discarded{Escape}");

    await waitFor(() => expect(input).toHaveValue("Fasting glucose screen"));
    expect(patchSession).not.toHaveBeenCalled();
  });
});

describe("SessionPage — archive", () => {
  it("confirms before archiving and never deletes", async () => {
    patchSession.mockResolvedValue(session({ status: "archived" }));
    renderPage();
    await screen.findByLabelText("Session title");

    await userEvent.click(screen.getByRole("button", { name: "Archive" }));
    expect(await screen.findByText("Archive this session?")).toBeInTheDocument();
    expect(patchSession).not.toHaveBeenCalled();

    const dialog = screen.getByRole("dialog");
    await userEvent.click(within(dialog).getByRole("button", { name: "Archive" }));
    await waitFor(() => expect(patchSession).toHaveBeenCalledWith(SESSION_ID, { status: "archived" }));
  });

  it("cancels archiving without a call", async () => {
    renderPage();
    await screen.findByLabelText("Session title");

    await userEvent.click(screen.getByRole("button", { name: "Archive" }));
    await userEvent.click(await screen.findByRole("button", { name: "Cancel" }));

    await waitFor(() => expect(screen.queryByText("Archive this session?")).not.toBeInTheDocument());
    expect(patchSession).not.toHaveBeenCalled();
  });

  it("reopens an archived session directly", async () => {
    getSession.mockResolvedValue(detail({ status: "archived" }));
    patchSession.mockResolvedValue(session({ status: "active" }));
    renderPage();

    await userEvent.click(await screen.findByRole("button", { name: "Reopen" }));

    await waitFor(() => expect(patchSession).toHaveBeenCalledWith(SESSION_ID, { status: "active" }));
  });
});

describe("SessionPage — no browser-side business state", () => {
  it("persists nothing to localStorage or sessionStorage", async () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    patchSession.mockResolvedValue(session({ title: "Renamed" }));
    renderPage();

    const input = await screen.findByLabelText("Session title");
    await userEvent.clear(input);
    await userEvent.type(input, "Renamed{Enter}");
    await waitFor(() => expect(patchSession).toHaveBeenCalled());

    expect(setItem).not.toHaveBeenCalled();
  });
});
