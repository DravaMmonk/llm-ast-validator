/**
 * verify:shared-ui — enforces the shared console UI contract.
 *
 * It proves the frozen extraction has not drifted, that no unauthorized visible
 * component appeared, and that the publication grant remains explicit. A
 * failure here is BLOCKED, not a warning.
 */

import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const PROVENANCE_PATH = join(ROOT, "shared-ui-provenance.json");
const EXTRACTION_DIR = join(ROOT, "src", "shared-console");
const SESSION_DIR = join(ROOT, "src", "session");

interface Provenance {
  artifact: { local_path: string };
  license: { redistribution_permitted: boolean };
  authorization: { publication_authorized: boolean };
  gate_0: { status: string; public_release: string };
  frozen_files: { path: string; sha256: string }[];
  visible_component_allowlist: { authorized: string[]; page_composition: string[] };
}

const failures: string[] = [];

function fail(message: string): void {
  failures.push(message);
}

function sha256(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

const provenance = JSON.parse(readFileSync(PROVENANCE_PATH, "utf8")) as Provenance;

// 1. Every frozen file must match its recorded digest exactly.
for (const file of provenance.frozen_files) {
  const full = join(EXTRACTION_DIR, file.path);
  let actual: string;
  try {
    actual = sha256(full);
  } catch {
    fail(`frozen file is missing: src/shared-console/${file.path}`);
    continue;
  }
  if (actual !== file.sha256) {
    fail(
      `frozen file drifted: src/shared-console/${file.path}\n    expected ${file.sha256}\n    actual   ${actual}\n    The shared surface is frozen; change it at the source and re-extract.`,
    );
  }
}

// 2. No file may be added to the extraction without a provenance entry.
const recorded = new Set(provenance.frozen_files.map((file) => file.path));
for (const full of walk(EXTRACTION_DIR)) {
  const rel = relative(EXTRACTION_DIR, full).split("\\").join("/");
  if (!recorded.has(rel)) {
    fail(`unrecorded file inside the frozen extraction: src/shared-console/${rel}`);
  }
}

// 3. The brand mark must stay out: this is a neutral extraction.
for (const full of walk(EXTRACTION_DIR)) {
  if (/brand\.tsx$/.test(full)) fail("brand.tsx must not be re-introduced into the neutral extraction.");
}

/*
 * 4. The extraction must stay neutral.
 *
 * The kit was stripped of the vocabulary that identified where it came from.
 * Re-extracting without repeating that step would silently put it back, so this
 * is checked rather than trusted.
 *
 * The denylist is stored as truncated SHA-256 of normalized terms, not as
 * plaintext: a guard written literally would reproduce inside this repository
 * the exact wording it exists to keep out. Hashing matches whole normalized
 * words and word pairs, which also avoids the false positives a substring scan
 * hits on innocent words like "compose" and "revision".
 */
const DENYLIST: Record<string, string[]> = {
  "origin-identity": [
    "64da817f607e9405",
    "ecac58bd34d476c9",
    "8d716aab1db233b7",
    "008bc55dfc8d0087",
    "cd73ca603027f5e1",
    "3787be12474fdbbe",
    "c4d6ab14176890b7",
  ],
  "origin-product": ["7b3d74039aeefa45", "859da8b0bea6b35d", "eb78d91909c595a2", "bf5da0a1e09509d7"],
  "origin-business-domain": ["9475a5970e0d3b96", "a8ff1c41b8415cb2", "ec30c219d7c20fb7", "27bc7eb20add5b3e"],
  "origin-pose-domain": ["4b43a309ceec9c34", "a2d5f201bb5e91f6", "36bc9e8ccb9d134f"],
};

const denyLookup = new Map<string, string>();
for (const [category, digests] of Object.entries(DENYLIST)) {
  for (const digest of digests) denyLookup.set(digest, category);
}

function token(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

/** Lowercase, split on any non-alphanumeric, then test each word and word pair. */
function scanForDeniedTerms(text: string): { category: string; line: number }[] {
  const hits: { category: string; line: number }[] = [];
  const lines = text.split("\n");

  lines.forEach((line, index) => {
    const words = line.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
    const candidates = [...words, ...words.slice(0, -1).map((word, i) => `${word} ${words[i + 1]}`)];
    for (const candidate of candidates) {
      const category = denyLookup.get(token(candidate));
      if (category) hits.push({ category, line: index + 1 });
    }
  });
  return hits;
}

for (const full of walk(EXTRACTION_DIR)) {
  const rel = relative(ROOT, full);
  for (const hit of scanForDeniedTerms(readFileSync(full, "utf8"))) {
    fail(`${hit.category} vocabulary reintroduced into the extraction: ${rel}:${hit.line}`);
  }
}

// 5. Only the authorized visible components may exist beside the page composition.
const allowedComponents = new Set([
  ...provenance.visible_component_allowlist.authorized,
  ...provenance.visible_component_allowlist.page_composition,
]);
let sessionFiles: string[] = [];
try {
  sessionFiles = readdirSync(SESSION_DIR);
} catch {
  sessionFiles = [];
}
for (const entry of sessionFiles) {
  if (!entry.endsWith(".tsx") || entry.includes(".test.")) continue;
  const component = entry.replace(/\.tsx$/, "");
  if (!allowedComponents.has(component)) {
    fail(
      `unauthorized visible component: src/session/${entry}\n    Section 6.3 authorizes only ${[...allowedComponents].join(", ")}. A fourth requires a plan revision.`,
    );
  }
}

// 6. Public release requires an explicit redistribution grant and a passing gate.
if (!provenance.license.redistribution_permitted || !provenance.authorization.publication_authorized) {
  fail("the shared UI must retain explicit public redistribution authorization.");
}
if (provenance.gate_0.status !== "PASS" || provenance.gate_0.public_release !== "PASS") {
  fail("gate_0 must stay PASS while this extraction is included in the public project.");
}

if (failures.length > 0) {
  console.error(`\n[verify:shared-ui] BLOCKED — ${failures.length} problem(s):\n`);
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}

console.log(
  `[verify:shared-ui] PASS — ${provenance.frozen_files.length} frozen files match, extraction is neutral, component allowlist holds.`,
);
