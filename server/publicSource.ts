/**
 * Downloads one catalogue source file and verifies it. Used by the import
 * route and by `npm run verify:public-datasets`.
 *
 * Only URLs from the catalogue reach this function, so there is no
 * user-supplied URL to abuse. The body is size-capped while streaming, and the
 * SHA-256 must match the pinned digest exactly — a changed upstream file is a
 * refusal, never a silent re-pin (the same rule as data/source-manifest.json).
 */

import { createHash } from "node:crypto";

import type { PublicDataset } from "../shared/workbench/publicDatasets";
import { PUBLIC_SOURCE_HOSTS, applyPublicContract } from "../shared/workbench/publicImport";

/** Fetches a URL's body, refusing anything larger than `maxBytes`. */
export type SourceFetcher = (url: string, maxBytes: number) => Promise<Uint8Array>;

export class PublicSourceError extends Error {
  constructor(
    readonly code: "PUBLIC_SOURCE_UNAVAILABLE" | "PUBLIC_SOURCE_CHANGED",
    message: string,
  ) {
    super(message);
    this.name = "PublicSourceError";
  }
}

const TIMEOUT_MS = 30_000;

export const fetchSource: SourceFetcher = async (url, maxBytes) => {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" || !(PUBLIC_SOURCE_HOSTS as readonly string[]).includes(parsed.hostname)) {
    throw new Error("the address is not an allowed source");
  }
  const response = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS), headers: { accept: "text/csv, text/plain, */*" } });
  if (!response.ok || !response.body) throw new Error(`the server answered HTTP ${response.status}`);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Error("the file is much larger than the verified version");
    }
    chunks.push(value);
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
};

export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** Downloads, verifies the digest, and applies the column contract. */
export async function downloadPublicDataset(dataset: PublicDataset, fetcher: SourceFetcher = fetchSource) {
  let bytes: Uint8Array;
  try {
    // Generous headroom over the pinned size; the digest decides anyway.
    bytes = await fetcher(dataset.source.url, dataset.source.bytes * 2 + 64 * 1024);
  } catch (error) {
    const reason = error instanceof Error && error.name !== "TimeoutError" ? error.message : "the request timed out";
    throw new PublicSourceError(
      "PUBLIC_SOURCE_UNAVAILABLE",
      `Could not download “${dataset.name}” from ${dataset.source.publisher}: ${reason}. Check the internet connection and try again.`,
    );
  }
  const digest = sha256Hex(bytes);
  if (digest !== dataset.source.sha256) {
    throw new PublicSourceError(
      "PUBLIC_SOURCE_CHANGED",
      `The file at ${dataset.source.publisher} no longer matches the verified version of “${dataset.name}” (SHA-256 ${digest.slice(0, 12)}…, expected ${dataset.source.sha256.slice(0, 12)}…), so it was not imported.`,
    );
  }
  return { digest, ...applyPublicContract(dataset, new TextDecoder("utf-8").decode(bytes)) };
}
