import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Session } from "../../shared/contracts";
import { SessionRail } from "./SessionRail";

const { listSessions, createSession } = vi.hoisted(() => ({
  listSessions: vi.fn(),
  createSession: vi.fn(),
}));

vi.mock("../api/client", async () => {
  const actual = await vi.importActual<typeof import("../api/client")>("../api/client");
  return { ...actual, api: { listSessions, createSession } };
});

function session(overrides: Partial<Session> = {}): Session {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    title: "Fasting glucose screen",
    current_requirement: "Score risk from baseline labs",
    status: "active",
    selected_candidate_version_id: null,
    created_at: "2026-07-16T00:00:00.000Z",
    updated_at: "2026-07-16T00:00:00.000Z",
    ...overrides,
  };
}

function renderRail(selectedSessionId: string | null = null) {
  const onSelect = vi.fn();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <SessionRail selectedSessionId={selectedSessionId} onSelect={onSelect} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { onSelect };
}

beforeEach(() => {
  listSessions.mockReset();
  createSession.mockReset();
});

describe("SessionRail — loading and empty", () => {
  it("shows a loading state before the API answers", () => {
    listSessions.mockReturnValue(new Promise(() => {}));
    renderRail();

    expect(screen.getByText("Loading sessions…")).toBeInTheDocument();
  });

  it("offers session creation when none exist", async () => {
    listSessions.mockResolvedValue({ sessions: [] });
    renderRail();

    expect(await screen.findByText("No sessions yet")).toBeInTheDocument();
  });

  it("distinguishes an empty archived tab from an empty active tab", async () => {
    listSessions.mockResolvedValue({ sessions: [] });
    renderRail();
    await screen.findByText("No sessions yet");

    await userEvent.click(screen.getByRole("button", { name: "Archived" }));

    expect(await screen.findByText("No archived sessions")).toBeInTheDocument();
    expect(listSessions).toHaveBeenLastCalledWith("archived");
  });
});

describe("SessionRail — API failure", () => {
  it("surfaces the error and retries", async () => {
    listSessions.mockRejectedValueOnce(new Error("The local API is unreachable. Is it running?"));
    renderRail();

    expect(await screen.findByText("Could not load sessions")).toBeInTheDocument();
    expect(screen.getByText("The local API is unreachable. Is it running?")).toBeInTheDocument();

    listSessions.mockResolvedValue({ sessions: [session()] });
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));

    expect(await screen.findByText("Fasting glucose screen")).toBeInTheDocument();
  });
});

describe("SessionRail — listing", () => {
  it("lists sessions and marks the selected one", async () => {
    listSessions.mockResolvedValue({
      sessions: [session(), session({ id: "22222222-2222-4222-8222-222222222222", title: "Lipid ratio" })],
    });
    renderRail("22222222-2222-4222-8222-222222222222");

    expect(await screen.findByText("Fasting glucose screen")).toBeInTheDocument();
    expect(screen.getByText("Lipid ratio")).toBeInTheDocument();
  });

  it("deep-links each session by its stable id", async () => {
    listSessions.mockResolvedValue({ sessions: [session()] });
    renderRail();

    const link = await screen.findByRole("link", { name: "Fasting glucose screen" });
    expect(link).toHaveAttribute("href", "/sessions/11111111-1111-4111-8111-111111111111");
  });

  it("filters by title and requirement without calling the API again", async () => {
    listSessions.mockResolvedValue({
      sessions: [session(), session({ id: "22222222-2222-4222-8222-222222222222", title: "Lipid ratio" })],
    });
    renderRail();
    await screen.findByText("Fasting glucose screen");
    const callsBefore = listSessions.mock.calls.length;

    await userEvent.type(screen.getByLabelText("Search sessions…"), "lipid");

    await waitFor(() => expect(screen.queryByText("Fasting glucose screen")).not.toBeInTheDocument());
    expect(screen.getByText("Lipid ratio")).toBeInTheDocument();
    expect(listSessions.mock.calls.length).toBe(callsBefore);
  });

  it("reports when a search matches nothing", async () => {
    listSessions.mockResolvedValue({ sessions: [session()] });
    renderRail();
    await screen.findByText("Fasting glucose screen");

    await userEvent.type(screen.getByLabelText("Search sessions…"), "zzzz");

    expect(await screen.findByText("No matching sessions")).toBeInTheDocument();
  });
});

describe("SessionRail — creation", () => {
  it("creates a session and selects it", async () => {
    listSessions.mockResolvedValue({ sessions: [] });
    createSession.mockResolvedValue(session({ id: "33333333-3333-4333-8333-333333333333" }));
    const { onSelect } = renderRail();
    await screen.findByText("No sessions yet");

    const rail = screen.getByText("Sessions").closest("div")!.parentElement!;
    await userEvent.click(within(rail).getAllByRole("button", { name: "New session" })[0]);

    await waitFor(() => expect(onSelect).toHaveBeenCalledWith("33333333-3333-4333-8333-333333333333"));
    expect(createSession).toHaveBeenCalledTimes(1);
  });
});
