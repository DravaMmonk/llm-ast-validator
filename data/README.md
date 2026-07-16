# Local cohort data

This directory holds the dataset **contract**, never the dataset.

- `source-manifest.json` — provenance, expected digests, the column contract, the
  inclusion policy, and the split rules. Tracked in Git. Contains no row data.
- `raw/` — where you place the source workbook. Ignored by Git.

Row-level cohort values exist only in the ignored local SQLite database and in
the active local browser response. They must never reach logs, error bodies,
fixtures, snapshots, screenshots, documents, build artifacts, or CI artifacts.

## Getting the workbook

The repository does not download or redistribute the workbook. Fetch it yourself
from the dataset record and place it at the documented path:

1. Open the [Dryad record](https://doi.org/10.5061/dryad.ft8750v).
2. Download `RC Health Care Data-20180820.xlsx`.
3. Put it at `data/raw/RC Health Care Data-20180820.xlsx`.

Without it, cohort preparation fails with `DATASET_SOURCE_MISSING` and prints
these instructions. Everything else — generation, admission, Blockly editing,
and the test suite — runs without it.

## Verifying and importing

```bash
npm run prepare:cohort -- --check-only   # verify digest and workbook schema only
npm run prepare:cohort                   # verify, then import into the local database
```

The command refuses an unexpected filename, digest, or workbook schema, and it
refuses an unknown or ambiguous fasting-glucose mapping — confusing baseline FPG
with the follow-up measurement would leak the outcome into a predictor.

Preparation is deterministic and idempotent by source checksum and preprocessing
version. The same input reproduces the same dataset version and the same split.
A failed load leaves the previous dataset version current.

## What the importer records

The dataset version stores the source DOI, digests, licence, citation,
preprocessing version, inclusion policy, outcome definition, column contract,
split seed, the published source totals, and the admitted counts after local
filtering, with exclusion counts by reason.

Each row gets two separate identities: an internal deterministic split key that
never leaves the database, and a locally generated random UUID that is the only
row identity any API, log, or export may expose. Neither is derived from a source
subject id or workbook row number, so identical source content recreates the same
split population while public-facing row keys stay unlinkable.

## Licence

The source is [CC0-1.0](https://datadryad.org/terms) and redistribution is
permitted — see [Dryad's reuse guide](https://datadryad.org/help/guides/reuse).
Raw and derived row-level files stay out of Git regardless: this repository has
no reason to republish a cohort it did not collect. Cite the dataset as recorded
in `source-manifest.json`.

## Limitations

The outcome is binary and ignores varying censoring time. Review-split metrics
are **exploratory**, not held-out performance: a human may inspect a false
negative and then edit the formula. The prototype makes no survival-risk,
fixed-horizon, or external-validity claim.
