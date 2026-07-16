# Security policy

Please do not open a public issue for a vulnerability that could expose
credentials, private prompts, or subject data. Report it privately to the
repository maintainers.

## Boundaries this prototype relies on

- **The API binds to `127.0.0.1`** and answers only the configured frontend
  origin (`ALLOWED_ORIGINS`). Request bodies are capped at 100 KiB and the
  provider envelope at 512 KiB.
- **No credentials in the browser.** OpenAI is configured only through the API
  process environment. With no configured `Generator`, generation is unavailable
  rather than silently falling back. The adapter never bypasses admission. Keep
  provider secrets in server-side configuration and never commit `.env` files.
- **No dynamic code execution.** The evaluator walks an admitted AST through a
  closed operator registry. Model content never reaches `eval`, `Function`, a
  shell, or a SQL fragment. Row queries accept only bounded, enumerated filters.
- **Errors are opaque.** Non-2xx responses use a fixed envelope and never carry
  stack traces, SQL, local paths, or provider credentials.

## Cohort data

Real cohort row values exist only in the ignored local SQLite database and in
the active local browser response. They must never reach logs, error bodies,
fixtures, snapshots, screenshots, recordings, documents, build artifacts, or CI
artifacts. The browser smoke path uses a synthetic fixture and never the real
workbook.

Row identity is deliberately split: an internal deterministic key that never
leaves the database, and a random display UUID that is the only row identity any
API, log, or export may expose. Neither derives from a source subject id or a
workbook row number.

## Before any release

`.gitignore` is not a security control. Run the gate, which audits the worktree,
the index, the release archive, the build, the package manifest, and every Git
ref and reachable object:

```bash
npm run audit:release -- --all-history
```

It fails on secrets, private names, forbidden paths, and files force-staged past
`.gitignore` with `git add -f`. Deleting a file in the latest commit is not
sufficient — history must be cleaned by a separately approved rewrite, and the
audit rerun.

Release is permitted only after this audit passes. The shared UI redistribution
grant and frozen extraction record are maintained in `shared-ui-provenance.json`.
