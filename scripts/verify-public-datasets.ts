/**
 * Live check of the public dataset catalogue: downloads every source, verifies
 * its pinned SHA-256, applies the column contract and builds a frame.
 *
 *   npm run verify:public-datasets            # every dataset
 *   npm run verify:public-datasets -- pbc_mayo # one or more keys
 *
 * Needs network access, so it is not part of `npm run check`. It prints counts
 * only — never row values — and writes nothing to disk.
 */

import { buildFrame } from "../shared/workbench/dataset";
import { PUBLIC_DATASETS } from "../shared/workbench/publicDatasets";
import { validatePublicCatalog } from "../shared/workbench/publicImport";
import { downloadPublicDataset } from "../server/publicSource";

const wanted = process.argv.slice(2);
const problems = validatePublicCatalog(PUBLIC_DATASETS);
if (problems.length > 0) {
  console.error(`[verify:public-datasets] catalogue problems:\n  ${problems.join("\n  ")}`);
  process.exit(1);
}

let failures = 0;
for (const dataset of PUBLIC_DATASETS.filter((entry) => wanted.length === 0 || wanted.includes(entry.key))) {
  try {
    const { columns, rowCount } = await downloadPublicDataset(dataset);
    const frame = buildFrame({ id: dataset.key, name: dataset.name, content_hash: "", row_count: rowCount, columns, derived: [] });
    const cells = rowCount * columns.length;
    const missing = columns.reduce((sum, column) => sum + column.values.filter((value) => value === null).length, 0);
    const roles = columns.filter((column) => column.role !== "none").map((column) => `${column.role}=${column.name}`);
    console.log(
      `PASS ${dataset.key.padEnd(24)} ${String(rowCount).padStart(5)} rows × ${String(frame.columns.length).padStart(2)} cols · ${((missing / cells) * 100).toFixed(1)}% missing · ${roles.join(", ")}`,
    );
  } catch (error) {
    failures += 1;
    console.error(`FAIL ${dataset.key.padEnd(24)} ${error instanceof Error ? error.message : String(error)}`);
  }
}
console.log(failures === 0 ? "[verify:public-datasets] all sources verified" : `[verify:public-datasets] ${failures} failed`);
process.exit(failures === 0 ? 0 : 1);
