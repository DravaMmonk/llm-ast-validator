/**
 * audit-public-release — the release gate (plan Sections 8.6, 17).
 *
 * Ignore rules are not a security control. This audits what is actually there:
 * the worktree, the index, the release archive, the production build and its
 * source maps, the package manifest, and — with --all-history — every Git ref
 * and reachable object. A file force-staged with `git add -f`, or deleted only
 * in the latest commit, is still a finding.
 *
 * Any finding blocks release. Exit code 1 means BLOCKED.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const ALL_HISTORY = process.argv.includes("--all-history");

interface Finding {
  scope: string;
  detail: string;
}

const findings: Finding[] = [];
const checks: string[] = [];

function git(args: string[]): string {
  return execFileSync("git", args, { cwd: ROOT, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
}

/**
 * Patterns that must never reach a public artifact. Each is anchored so it
 * cannot fire on ordinary prose ("compose" contains pose, "revision" contains
 * vision).
 */
const SECRET_PATTERNS: { name: string; pattern: RegExp }[] = [
  { name: "AWS access key", pattern: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: "private key block", pattern: /-----BEGIN (RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/ },
  { name: "bearer token", pattern: /\bBearer\s+[A-Za-z0-9._~+/-]{20,}/ },
  { name: "generic api key assignment", pattern: /\b(api[_-]?key|secret[_-]?key|access[_-]?token)\s*[:=]\s*["'][^"'\s]{16,}["']/i },
  { name: "anthropic key", pattern: /\bsk-ant-[A-Za-z0-9_-]{16,}/ },
  { name: "openai key", pattern: /\bsk-[A-Za-z0-9]{32,}/ },
  { name: "slack token", pattern: /\bxox[baprs]-[A-Za-z0-9-]{10,}/ },
  { name: "postgres url with password", pattern: /\bpostgres(ql)?:\/\/[^\s:@]+:[^\s@]+@/ },
];

const PRIVATE_NAME_PATTERNS: { name: string; pattern: RegExp }[] = [
  { name: "origin company", pattern: /hound\s*forward|houndforward/i },
  { name: "private repository", pattern: /HoundForwardCV|cv-research/i },
  { name: "brand class prefix", pattern: /\bhf-[a-z]/i },
  { name: "origin product", pattern: /\bgait\b/i },
  { name: "origin business domain", pattern: /\binsurer\b|\bbreed\b/i },
  { name: "origin module", pattern: /annotation studio|feature builder/i },
];

/**
 * Real cohort content must never leave the local database.
 *
 * This is deliberately path-based rather than content-based. The workbook's
 * name, DOI, and column contract are public CC0 metadata that the manifest and
 * README are *required* to state so a user knows what to fetch — matching on
 * them only produces false positives. What actually matters is that no raw
 * workbook, derived extract, or runtime database is ever an artifact, which
 * FORBIDDEN_PATHS below enforces against the real file lists rather than
 * against .gitignore.
 */
const COHORT_PATTERNS: { name: string; pattern: RegExp }[] = [];

const FORBIDDEN_PATHS: { name: string; pattern: RegExp }[] = [
  { name: "runtime database", pattern: /(^|\/)var\/|\.db(-wal|-shm)?$|\.backup$/ },
  { name: "raw dataset", pattern: /(^|\/)data\/raw\// },
  { name: "workbook or csv", pattern: /\.(xlsx|xlsm|csv|tsv)$/i },
  { name: "env file", pattern: /(^|\/)\.env($|\.)(?!example)/ },
  // Browser-test artifacts embed page snapshots, which carry row values.
  { name: "browser test artifact", pattern: /(^|\/)(test-results|playwright-report|blob-report)\// },
];

const TEXT_LIKE = /\.(ts|tsx|js|jsx|mjs|cjs|json|md|css|html|sql|yml|yaml|txt|map)$/i;

function scanText(scope: string, path: string, text: string): void {
  for (const group of [SECRET_PATTERNS, PRIVATE_NAME_PATTERNS, COHORT_PATTERNS]) {
    for (const { name, pattern } of group) {
      const match = pattern.exec(text);
      if (match) {
        const line = text.slice(0, match.index).split("\n").length;
        findings.push({ scope, detail: `${name} in ${path}:${line}` });
      }
    }
  }
}

function scanPaths(scope: string, paths: string[]): void {
  for (const path of paths) {
    for (const { name, pattern } of FORBIDDEN_PATHS) {
      if (pattern.test(path)) findings.push({ scope, detail: `${name} present: ${path}` });
    }
  }
}

// 1. Tracked files: paths and content. Catches anything force-staged past
//    .gitignore, which is exactly what ignore rules cannot prevent.
{
  const tracked = git(["ls-files"]).split("\n").filter(Boolean);
  scanPaths("worktree/index", tracked);
  for (const path of tracked) {
    if (!TEXT_LIKE.test(path)) continue;
    if (path === "scripts/audit-public-release.ts") continue; // the patterns live here
    if (existsSync(`${ROOT}${path}`)) scanText("worktree", path, readFileSync(`${ROOT}${path}`, "utf8"));
  }
  checks.push(`${tracked.length} tracked files`);
}

// 2. The staged index, which may differ from the worktree.
{
  const staged = git(["diff", "--cached", "--name-only"]).split("\n").filter(Boolean);
  scanPaths("index", staged);
  checks.push(`${staged.length} staged files`);
}

// 3. The release archive: what a consumer of `git archive` actually receives.
{
  const archived = git(["archive", "--format=tar", "HEAD"]);
  const names = git(["ls-tree", "-r", "--name-only", "HEAD"]).split("\n").filter(Boolean);
  scanPaths("archive", names);
  checks.push(`${names.length} archived paths (${archived.length} bytes)`);
}

// 4. Production build and source maps.
{
  if (existsSync(`${ROOT}dist`)) {
    const built = execFileSync("find", ["dist", "-type", "f"], { cwd: ROOT, encoding: "utf8" })
      .split("\n")
      .filter(Boolean);
    scanPaths("build", built);
    for (const path of built) {
      if (!TEXT_LIKE.test(path)) continue;
      scanText("build", path, readFileSync(`${ROOT}${path}`, "utf8"));
    }
    checks.push(`${built.length} build artifacts`);
  } else {
    checks.push("build not present (skipped)");
  }
}

// 5. The package manifest a publish would ship.
{
  const manifest = JSON.parse(readFileSync(`${ROOT}package.json`, "utf8")) as {
    private?: boolean;
    license?: string;
  };
  if (manifest.private !== true && !manifest.license) {
    findings.push({
      scope: "package",
      detail: "package.json is publishable but declares no license. Set a license or mark it private.",
    });
  }
  checks.push("package manifest");
}

// 6. Every ref and every reachable object.
if (ALL_HISTORY) {
  const refs = git(["for-each-ref", "--format=%(refname)"]).split("\n").filter(Boolean);
  const commits = git(["rev-list", "--all"]).split("\n").filter(Boolean);

  for (const commit of commits) {
    const message = git(["log", "-1", "--format=%B", commit]);
    scanText(`history/${commit.slice(0, 8)}`, "commit message", message);
    const names = git(["ls-tree", "-r", "--name-only", commit]).split("\n").filter(Boolean);
    scanPaths(`history/${commit.slice(0, 8)}`, names);
  }

  // Blob content across all history, deduplicated by object id.
  const objects = git(["rev-list", "--all", "--objects"])
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [id, ...rest] = line.split(" ");
      return { id, path: rest.join(" ") };
    })
    .filter((entry) => entry.path && TEXT_LIKE.test(entry.path));

  const seen = new Set<string>();
  for (const { id, path } of objects) {
    if (seen.has(id)) continue;
    seen.add(id);
    if (path === "scripts/audit-public-release.ts") continue;
    const type = git(["cat-file", "-t", id]).trim();
    if (type !== "blob") continue;
    scanText("history/blob", path, git(["cat-file", "-p", id]));
  }

  checks.push(`${refs.length} refs, ${commits.length} commits, ${seen.size} distinct text blobs`);
}

for (const check of checks) console.log(`[audit] checked ${check}`);

if (findings.length > 0) {
  console.error(`\n[audit] BLOCKED — ${findings.length} finding(s):\n`);
  for (const finding of findings) console.error(`  - [${finding.scope}] ${finding.detail}`);
  console.error(
    "\nDeleting a file in the latest commit is not sufficient. Clean history with a separately approved rewrite, then rerun.",
  );
  process.exit(1);
}

console.log(
  `[audit] PASS — no secrets, private names, cohort content, or forbidden paths${ALL_HISTORY ? " in any ref or object" : " (run with --all-history for the release gate)"}.`,
);
