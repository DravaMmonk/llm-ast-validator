/**
 * Data hooks shared by every workstation module: the dataset list, the active
 * dataset, materialized frames, saved documents, cohort row selection, and
 * pinning results to the report.
 */

import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { evaluateCohort, maskedRows, type CohortResult } from "../../shared/workbench/cohort";
import { type DatasetSummary, type Frame, buildFrame } from "../../shared/workbench/dataset";
import { findPublicDataset } from "../../shared/workbench/publicDatasets";
import type {
  CohortPayload,
  DocumentKind,
  ReportItemPayload,
  WorkbenchDocument,
} from "../../shared/workbench/documents";
import { toast } from "../shared-console/src";
import { errorMessage, wbApi } from "./api";
import { usePreference } from "./preferences";

export const queryKeys = {
  datasets: (status = "active") => ["wb-datasets", status] as const,
  dataset: (id: string | null) => ["wb-dataset", id] as const,
  documents: (kind: DocumentKind, datasetId?: string | null) => ["wb-docs", kind, datasetId ?? "all"] as const,
  samples: ["wb-samples"] as const,
};

export function useDatasets() {
  return useQuery({ queryKey: queryKeys.datasets(), queryFn: () => wbApi.listDatasets("active") });
}

/**
 * The dataset every module analyses by default. The stored preference is only
 * a hint: when it names a dataset that no longer exists or was archived, the
 * most recently updated active dataset takes over.
 */
export function useActiveDataset(): {
  datasetId: string | null;
  summary: DatasetSummary | null;
  datasets: DatasetSummary[];
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  setDatasetId: (id: string | null) => void;
} {
  const list = useDatasets();
  const [preferred, setPreferred] = usePreference<string | null>("active-dataset", null);
  const datasets = list.data?.datasets ?? [];
  const summary = datasets.find((dataset) => dataset.id === preferred) ?? datasets[0] ?? null;
  return {
    datasetId: summary?.id ?? null,
    summary,
    datasets,
    isLoading: list.isLoading,
    isError: list.isError,
    error: list.error,
    setDatasetId: setPreferred,
  };
}

export function useDatasetDetail(datasetId: string | null) {
  return useQuery({
    queryKey: queryKeys.dataset(datasetId),
    queryFn: () => wbApi.getDataset(datasetId!),
    enabled: Boolean(datasetId),
    staleTime: 60_000,
  });
}

/** The analysis frame (source + derived columns) of a dataset. */
export function useFrame(datasetId: string | null): {
  frame: Frame | null;
  isLoading: boolean;
  error: unknown;
  refetch: () => void;
} {
  const detail = useDatasetDetail(datasetId);
  const frame = useMemo(() => {
    if (!detail.data) return null;
    const built = buildFrame(detail.data);
    const entry = detail.data.source === "public" && detail.data.sample_key ? findPublicDataset(detail.data.sample_key) : undefined;
    return entry ? { ...built, citation: entry.citation } : built;
  }, [detail.data]);
  return { frame, isLoading: detail.isLoading, error: detail.error, refetch: () => void detail.refetch() };
}

export function useDocuments<P>(kind: DocumentKind, datasetId?: string | null, enabled = true) {
  return useQuery({
    queryKey: queryKeys.documents(kind, datasetId),
    queryFn: () => wbApi.listDocuments<P>(kind, { datasetId }),
    enabled,
  });
}

export function invalidateDocuments(queryClient: ReturnType<typeof useQueryClient>, kind: DocumentKind) {
  return queryClient.invalidateQueries({ queryKey: ["wb-docs", kind] });
}

/** Row selection for an analysis: the whole dataset or a saved cohort. */
export interface RowSelection {
  rows: number[];
  cohort: WorkbenchDocument<CohortPayload> | null;
  result: CohortResult | null;
  label: string;
}

export function useRowSelection(
  frame: Frame | null,
  cohortId: string | null,
): RowSelection & { cohorts: WorkbenchDocument<CohortPayload>[]; cohortsLoaded: boolean } {
  const cohorts = useDocuments<CohortPayload>("cohort", frame?.datasetId ?? null, Boolean(frame));
  const list = cohorts.data?.documents ?? [];
  const cohort = list.find((doc) => doc.id === cohortId) ?? null;
  const cohortsLoaded = cohorts.isSuccess;
  return useMemo(() => {
    if (!frame) return { rows: [], cohort: null, result: null, label: "—", cohorts: list, cohortsLoaded };
    if (!cohort) return { rows: maskedRows(frame.rowCount, null), cohort: null, result: null, label: "All rows", cohorts: list, cohortsLoaded };
    const result = evaluateCohort(frame, cohort.payload.steps);
    return { rows: maskedRows(frame.rowCount, result.mask), cohort, result, label: cohort.title, cohorts: list, cohortsLoaded };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- list identity follows the query data
  }, [frame, cohort, cohorts.data, cohortsLoaded]);
}

/** Saves a result snapshot to the evidence report. */
export function usePinToReport() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { title: string; datasetId: string | null; payload: ReportItemPayload }) =>
      wbApi.createDocument<ReportItemPayload>({
        kind: "report_item",
        title: input.title.slice(0, 160),
        dataset_id: input.datasetId,
        payload: input.payload,
      }),
    onSuccess: async (doc) => {
      toast(`Pinned to report · ${doc.title}`);
      await invalidateDocuments(queryClient, "report_item");
    },
    onError: (error) => toast(`Could not pin: ${errorMessage(error)}`),
  });
}

/** Standard provenance for anything derived from a frame and selection. */
export function provenanceOf(frame: Frame, selection: RowSelection): Record<string, string | number | null> {
  return {
    dataset: frame.name,
    dataset_id: frame.datasetId,
    content_hash: frame.contentHash.slice(0, 12),
    rows: selection.rows.length,
    cohort: selection.cohort?.title ?? "All rows",
    ...(frame.citation ? { data_source: frame.citation } : {}),
    generated_at: new Date().toISOString(),
  };
}

/**
 * Adds a dataset from the public catalogue: the local API downloads it from
 * the official source, checks the pinned SHA-256 and the column contract,
 * and stores it. The new dataset becomes the active one.
 */
export function useAddPublicDataset() {
  const queryClient = useQueryClient();
  const { setDatasetId } = useActiveDataset();
  return useMutation({
    mutationFn: (key: string) => wbApi.createPublicDataset(key),
    onSuccess: async ({ dataset }) => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.datasets() });
      setDatasetId(dataset.id);
      toast(`Added · ${dataset.name} · ${dataset.row_count.toLocaleString("en-US")} rows, verified`);
    },
  });
}
