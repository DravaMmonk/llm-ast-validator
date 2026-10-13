/**
 * Application bootstrap: the research workstation shell around every module.
 *
 * The AI Formula Lab (the original session-based diabetes formula flow) keeps
 * its `/sessions` routes unchanged; the workstation modules sit beside it and
 * share the console design system, the local API, and the expression kernel.
 */

import { lazy, Suspense, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Navigate,
  Outlet,
  Route,
  RouterProvider,
  createBrowserRouter,
  createRoutesFromElements,
  useLocation,
} from "react-router-dom";

import { LoadingState, Toaster } from "./shared-console/src";
import { ErrorBoundary } from "./workstation/ErrorBoundary";
import { Shell } from "./workstation/Shell";
import { HomePage } from "./modules/home/HomePage";

const DataStudio = lazy(() => import("./modules/data/DataStudio"));
const CohortBuilder = lazy(() => import("./modules/cohort/CohortBuilder"));
const ScoreForge = lazy(() => import("./modules/forge/ScoreForge"));
const CalculatorsPage = lazy(() => import("./modules/calculators/CalculatorsPage"));
const StatsWorkbench = lazy(() => import("./modules/stats/StatsWorkbench"));
const DiagnosticLab = lazy(() => import("./modules/diagnostic/DiagnosticLab"));
const StudyDesign = lazy(() => import("./modules/design/StudyDesign"));
const ReportPage = lazy(() => import("./modules/report/ReportPage"));
const SessionPage = lazy(() => import("./session/SessionPage").then((module) => ({ default: module.SessionPage })));

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

const routes = createRoutesFromElements(
  <Route element={<Layout />}>
    <Route path="/" element={<HomePage />} />
    <Route path="/data" element={<DataStudio />} />
    <Route path="/cohorts" element={<CohortBuilder />} />
    <Route path="/cohorts/:cohortId" element={<CohortBuilder />} />
    <Route path="/forge" element={<ScoreForge />} />
    <Route path="/forge/:scoreId" element={<ScoreForge />} />
    <Route path="/calculators" element={<CalculatorsPage />} />
    <Route path="/calculators/:calculatorKey" element={<CalculatorsPage />} />
    <Route path="/stats" element={<StatsWorkbench />} />
    <Route path="/stats/:analysis" element={<StatsWorkbench />} />
    <Route path="/diagnostic" element={<DiagnosticLab />} />
    <Route path="/diagnostic/:tool" element={<DiagnosticLab />} />
    <Route path="/design" element={<StudyDesign />} />
    <Route path="/design/:tool" element={<StudyDesign />} />
    <Route path="/report" element={<ReportPage />} />
    <Route path="/sessions" element={<SessionPage />} />
    <Route path="/sessions/:sessionId" element={<SessionPage />} />
    <Route path="*" element={<Navigate to="/" replace />} />
  </Route>,
);

/**
 * A data router, so the unsaved-changes guard can block every navigation —
 * including the browser's Back and Forward buttons — with `useBlocker`.
 */
export default function App({ client = createQueryClient() }: { client?: QueryClient } = {}) {
  const [router] = useState(() => createBrowserRouter(routes, { future: { v7_relativeSplatPath: true } }));
  return (
    <QueryClientProvider client={client}>
      <RouterProvider router={router} future={{ v7_startTransition: true }} />
    </QueryClientProvider>
  );
}

function Layout() {
  const location = useLocation();
  return (
    <>
      <Shell>
        <ErrorBoundary resetKey={location.pathname}>
          <Suspense fallback={<LoadingState label="Loading module…" />}>
            <Outlet />
          </Suspense>
        </ErrorBoundary>
      </Shell>
      <Toaster />
    </>
  );
}
