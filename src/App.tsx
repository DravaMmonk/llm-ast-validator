/**
 * Application bootstrap and SessionPage composition (plan Section 13.1).
 *
 * The browser demo that ran generation and evaluation in-process is gone: the
 * local API owns persistence and the AST kernel is shared. No compatibility
 * wrapper keeps browser-side business state alive.
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Navigate, Route, BrowserRouter as Router, Routes } from "react-router-dom";

import { Toaster } from "./shared-console/src";
import { SessionPage } from "./session/SessionPage";

function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // Business state lives server-side; a stale read is never authoritative.
        refetchOnWindowFocus: false,
        retry: false,
      },
    },
  });
}

export default function App({ client = createQueryClient() }: { client?: QueryClient } = {}) {
  return (
    <QueryClientProvider client={client}>
      <Router>
        <div className="flex h-screen min-h-0 flex-col bg-bg text-fg">
          <Routes>
            <Route path="/" element={<SessionPage />} />
            <Route path="/sessions/:sessionId" element={<SessionPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </div>
        <Toaster />
      </Router>
    </QueryClientProvider>
  );
}
