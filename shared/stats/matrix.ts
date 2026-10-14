/**
 * Small dense linear-algebra helpers (row-major `number[][]`).
 *
 * Intended for the modest dimensions of regression models (tens of
 * columns). Singular or numerically singular input throws
 * `StatsError("SINGULAR_MATRIX")` rather than producing Infinity/NaN.
 */

import { StatsError } from "./errors";

export type Matrix = number[][];

function dims(A: readonly (readonly number[])[], label: string): [number, number] {
  if (!Array.isArray(A) || A.length === 0) throw new StatsError("EMPTY_INPUT", `${label} must have at least one row`);
  const cols = A[0].length;
  for (const row of A) {
    if (row.length !== cols) throw new StatsError("LENGTH_MISMATCH", `${label} rows must all have the same length`);
    for (const v of row) if (!Number.isFinite(v)) throw new StatsError("NON_FINITE", `${label} contains a non-finite value`);
  }
  return [A.length, cols];
}

function requireSquare(A: readonly (readonly number[])[], label: string): number {
  const [r, c] = dims(A, label);
  if (r !== c) throw new StatsError("INVALID_ARGUMENT", `${label} must be square (got ${r}x${c})`);
  return r;
}

/** Transpose of an r×c matrix. */
export function transpose(A: readonly (readonly number[])[]): Matrix {
  const [r, c] = dims(A, "A");
  const out: Matrix = Array.from({ length: c }, () => new Array<number>(r));
  for (let i = 0; i < r; i++) for (let j = 0; j < c; j++) out[j][i] = A[i][j];
  return out;
}

/** Matrix product A·B. */
export function matMul(A: readonly (readonly number[])[], B: readonly (readonly number[])[]): Matrix {
  const [ar, ac] = dims(A, "A");
  const [br, bc] = dims(B, "B");
  if (ac !== br) throw new StatsError("LENGTH_MISMATCH", `cannot multiply ${ar}x${ac} by ${br}x${bc}`);
  const out: Matrix = Array.from({ length: ar }, () => new Array<number>(bc).fill(0));
  for (let i = 0; i < ar; i++) {
    for (let k = 0; k < ac; k++) {
      const aik = A[i][k];
      if (aik === 0) continue;
      for (let j = 0; j < bc; j++) out[i][j] += aik * B[k][j];
    }
  }
  return out;
}

/** Matrix–vector product A·x. */
export function matVec(A: readonly (readonly number[])[], x: readonly number[]): number[] {
  const [r, c] = dims(A, "A");
  if (x.length !== c) throw new StatsError("LENGTH_MISMATCH", `cannot multiply ${r}x${c} by vector of length ${x.length}`);
  return A.map((row) => {
    let s = 0;
    for (let j = 0; j < c; j++) s += row[j] * x[j];
    return s;
  });
}

/** Relative pivot tolerance for Cholesky: pivot <= tol · A[j][j] is treated as singular. */
const CHOLESKY_TOL = 1e-11;

/**
 * Cholesky factor L (lower triangular, A = L·Lᵀ) of a symmetric positive
 * definite matrix. Throws SINGULAR_MATRIX if A is not (numerically) positive
 * definite: a pivot below 1e-11 × its original diagonal element.
 */
export function cholesky(A: readonly (readonly number[])[]): Matrix {
  const n = requireSquare(A, "A");
  const L: Matrix = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  for (let j = 0; j < n; j++) {
    let d = A[j][j];
    for (let k = 0; k < j; k++) d -= L[j][k] * L[j][k];
    if (!(A[j][j] > 0) || !(d > CHOLESKY_TOL * A[j][j])) {
      throw new StatsError("SINGULAR_MATRIX", `matrix is singular or not positive definite (pivot ${j})`);
    }
    const ljj = Math.sqrt(d);
    L[j][j] = ljj;
    for (let i = j + 1; i < n; i++) {
      let s = A[i][j];
      for (let k = 0; k < j; k++) s -= L[i][k] * L[j][k];
      L[i][j] = s / ljj;
    }
  }
  return L;
}

/** Solves A·x = b for symmetric positive definite A via Cholesky. */
export function solveSymmetricPositiveDefinite(A: readonly (readonly number[])[], b: readonly number[]): number[] {
  const L = cholesky(A);
  const n = L.length;
  if (b.length !== n) throw new StatsError("LENGTH_MISMATCH", "b must have one entry per row of A");
  const y = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    let s = b[i];
    for (let k = 0; k < i; k++) s -= L[i][k] * y[k];
    y[i] = s / L[i][i];
  }
  const x = new Array<number>(n);
  for (let i = n - 1; i >= 0; i--) {
    let s = y[i];
    for (let k = i + 1; k < n; k++) s -= L[k][i] * x[k];
    x[i] = s / L[i][i];
  }
  return x;
}

/** Inverse of a symmetric positive definite matrix via Cholesky (symmetric result). */
export function invertSymmetricPositiveDefinite(A: readonly (readonly number[])[]): Matrix {
  const n = requireSquare(A, "A");
  const out: Matrix = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  const L = cholesky(A);
  // Solve column by column using the factor (avoids refactoring).
  for (let col = 0; col < n; col++) {
    const y = new Array<number>(n).fill(0);
    for (let i = 0; i < n; i++) {
      let s = i === col ? 1 : 0;
      for (let k = 0; k < i; k++) s -= L[i][k] * y[k];
      y[i] = s / L[i][i];
    }
    for (let i = n - 1; i >= 0; i--) {
      let s = y[i];
      for (let k = i + 1; k < n; k++) s -= L[k][i] * out[k][col];
      out[i][col] = s / L[i][i];
    }
  }
  for (let i = 0; i < n; i++) for (let j = 0; j < i; j++) out[i][j] = out[j][i] = (out[i][j] + out[j][i]) / 2;
  return out;
}

/** Relative pivot tolerance (after row equilibration) for Gauss–Jordan inversion. */
const GAUSS_JORDAN_TOL = 1e-12;

/**
 * Inverse via Gauss–Jordan elimination with partial pivoting on a
 * row-equilibrated copy (each row scaled to max |entry| = 1). Throws
 * SINGULAR_MATRIX when a pivot falls below 1e-12 (on the equilibrated scale).
 */
export function invert(A: readonly (readonly number[])[]): Matrix {
  const n = requireSquare(A, "A");
  const scale = A.map((row) => Math.max(...row.map(Math.abs)));
  if (scale.some((s) => s === 0)) throw new StatsError("SINGULAR_MATRIX", "matrix has an all-zero row");
  // Augmented [S·A | S], where S = diag(1/scale); inverse of A = (S·A)⁻¹ · S.
  const M = A.map((row, i) => {
    const r = row.map((v) => v / scale[i]);
    for (let j = 0; j < n; j++) r.push(i === j ? 1 / scale[i] : 0);
    return r;
  });
  for (let col = 0; col < n; col++) {
    let pivotRow = col;
    let best = Math.abs(M[col][col]);
    for (let r = col + 1; r < n; r++) {
      const v = Math.abs(M[r][col]);
      if (v > best) {
        best = v;
        pivotRow = r;
      }
    }
    if (!(best > GAUSS_JORDAN_TOL)) throw new StatsError("SINGULAR_MATRIX", `matrix is singular (column ${col})`);
    if (pivotRow !== col) [M[col], M[pivotRow]] = [M[pivotRow], M[col]];
    const p = M[col][col];
    for (let j = 0; j < 2 * n; j++) M[col][j] /= p;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const factor = M[r][col];
      if (factor === 0) continue;
      for (let j = 0; j < 2 * n; j++) M[r][j] -= factor * M[col][j];
    }
  }
  const inv = M.map((row) => row.slice(n));
  for (const row of inv) for (const v of row) if (!Number.isFinite(v)) throw new StatsError("SINGULAR_MATRIX", "matrix is numerically singular");
  return inv;
}

export interface QrLeastSquares {
  /** Least-squares coefficients. */
  coefficients: number[];
  /** Upper-triangular R (p×p) with X = Q·R. */
  r: Matrix;
  /** (XᵀX)⁻¹ = R⁻¹R⁻ᵀ (the unscaled covariance). */
  xtxInverse: Matrix;
}

/**
 * Least squares via Householder QR (no pivoting). A column whose norm after
 * orthogonalisation falls below `tol` × its original norm is treated as
 * linearly dependent (same rule as R's `lm`, tol = 1e-7) and throws
 * SINGULAR_MATRIX.
 */
export function qrLeastSquares(X: readonly (readonly number[])[], y: readonly number[], tol = 1e-7): QrLeastSquares {
  const [n, p] = dims(X, "X");
  if (y.length !== n) throw new StatsError("LENGTH_MISMATCH", "y must have one entry per row of X");
  if (p > n) throw new StatsError("SINGULAR_MATRIX", "more columns than rows");
  // Column-major working copy.
  const cols = Array.from({ length: p }, (_, j) => X.map((row) => row[j]));
  const qty = [...y];
  const norms = cols.map(euclideanNorm);
  const R: Matrix = Array.from({ length: p }, () => new Array<number>(p).fill(0));
  for (let k = 0; k < p; k++) {
    const col = cols[k];
    let alpha = 0;
    for (let i = k; i < n; i++) alpha += col[i] * col[i];
    alpha = Math.sqrt(alpha);
    if (!(norms[k] > 0) || !(alpha > tol * norms[k])) {
      throw new StatsError("SINGULAR_MATRIX", `design matrix column ${k} is linearly dependent on earlier columns`);
    }
    const sign = col[k] >= 0 ? 1 : -1;
    const v = new Array<number>(n - k);
    for (let i = k; i < n; i++) v[i - k] = col[i];
    v[0] += sign * alpha;
    let vtv = 0;
    for (const vi of v) vtv += vi * vi;
    const apply = (target: number[]) => {
      let dot = 0;
      for (let i = k; i < n; i++) dot += v[i - k] * target[i];
      const f = (2 * dot) / vtv;
      for (let i = k; i < n; i++) target[i] -= f * v[i - k];
    };
    for (let j = k; j < p; j++) apply(cols[j]);
    apply(qty);
    for (let j = k; j < p; j++) R[k][j] = cols[j][k];
  }
  const rInv = invertUpperTriangular(R);
  const coefficients = new Array<number>(p).fill(0);
  for (let i = 0; i < p; i++) {
    let s = 0;
    for (let j = i; j < p; j++) s += rInv[i][j] * qty[j];
    coefficients[i] = s;
  }
  const xtxInverse: Matrix = Array.from({ length: p }, () => new Array<number>(p).fill(0));
  for (let i = 0; i < p; i++) {
    for (let j = i; j < p; j++) {
      let s = 0;
      for (let k = j; k < p; k++) s += rInv[i][k] * rInv[j][k];
      xtxInverse[i][j] = s;
      xtxInverse[j][i] = s;
    }
  }
  return { coefficients, r: R, xtxInverse };
}

/** Overflow-safe Euclidean norm (no argument spreading, so it works for long vectors). */
function euclideanNorm(v: readonly number[]): number {
  let maxAbs = 0;
  for (const x of v) maxAbs = Math.max(maxAbs, Math.abs(x));
  if (maxAbs === 0) return 0;
  let s = 0;
  for (const x of v) s += (x / maxAbs) ** 2;
  return maxAbs * Math.sqrt(s);
}

/** Inverse of a non-singular upper-triangular matrix by back substitution. */
export function invertUpperTriangular(R: readonly (readonly number[])[]): Matrix {
  const n = requireSquare(R, "R");
  const inv: Matrix = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    if (R[i][i] === 0) throw new StatsError("SINGULAR_MATRIX", "triangular matrix has a zero diagonal element");
    inv[i][i] = 1 / R[i][i];
    for (let j = i + 1; j < n; j++) {
      let s = 0;
      for (let k = i + 1; k <= j; k++) s += R[i][k] * inv[k][j];
      inv[i][j] = -s / R[i][i];
    }
  }
  return inv;
}
