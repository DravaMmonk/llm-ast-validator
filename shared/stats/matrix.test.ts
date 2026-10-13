import { describe, expect, it } from "vitest";
import {
  cholesky,
  invert,
  invertSymmetricPositiveDefinite,
  invertUpperTriangular,
  matMul,
  matVec,
  qrLeastSquares,
  solveSymmetricPositiveDefinite,
  transpose,
} from "./matrix";
import { expectAbs, expectRel, expectStatsError } from "./testHelpers";

// R: A <- matrix(c(4,2,0.6, 2,5,1.5, 0.6,1.5,3), 3); solve(A, c(1,2,3)); t(chol(A))
const A = [
  [4, 2, 0.6],
  [2, 5, 1.5],
  [0.6, 1.5, 3],
];

describe("transpose / matMul / matVec", () => {
  it("compute basic products", () => {
    expect(transpose([[1, 2, 3]])).toEqual([[1], [2], [3]]);
    expect(
      matMul(
        [
          [1, 2],
          [3, 4],
        ],
        [
          [5, 6],
          [7, 8],
        ],
      ),
    ).toEqual([
      [19, 22],
      [43, 50],
    ]);
    expect(matVec(A, [1, 0, 0])).toEqual([4, 2, 0.6]);
    expectStatsError(() => matMul([[1, 2]], [[1, 2]]), "LENGTH_MISMATCH");
    expectStatsError(() => transpose([[1, 2], [3]]), "LENGTH_MISMATCH");
    expectStatsError(() => transpose([]), "EMPTY_INPUT");
  });
});

describe("Cholesky / SPD solve", () => {
  it("matches R chol and solve", () => {
    const L = cholesky(A);
    const ref = [
      [2, 0, 0],
      [1, 2, 0],
      [0.3, 0.6, 1.5968719422671314],
    ];
    L.flat().forEach((v, i) => expectAbs(v, ref.flat()[i], 1e-15));
    const x = solveSymmetricPositiveDefinite(A, [1, 2, 3]);
    expectRel(x[0], 0.0625, 1e-14);
    expectRel(x[1], 0.092647058823529457, 1e-14);
    expectRel(x[2], 0.94117647058823517, 1e-14);
    const inv = invertSymmetricPositiveDefinite(A);
    const I = matMul(A, inv);
    I.forEach((row, i) => row.forEach((v, j) => expectAbs(v, i === j ? 1 : 0, 1e-14)));
  });
  it("throws SINGULAR_MATRIX on singular or indefinite input", () => {
    expectStatsError(
      () =>
        cholesky([
          [1, 1],
          [1, 1],
        ]),
      "SINGULAR_MATRIX",
    );
    expectStatsError(
      () =>
        cholesky([
          [1, 2],
          [2, 1],
        ]),
      "SINGULAR_MATRIX",
    );
    expectStatsError(() => solveSymmetricPositiveDefinite([[0]], [1]), "SINGULAR_MATRIX");
  });
});

describe("invert (Gauss–Jordan)", () => {
  it("matches R solve() and needs pivoting", () => {
    // B <- matrix(c(0,2,1, 1,1,0, 3,-1,2), 3, byrow = TRUE); solve(B)
    const inv = invert([
      [0, 2, 1],
      [1, 1, 0],
      [3, -1, 2],
    ]);
    const ref = [-0.25, 0.625, 0.125, 0.25, 0.375, -0.125, 0.5, -0.75, 0.25];
    inv.flat().forEach((v, i) => expectAbs(v, ref[i], 1e-15));
  });
  it("is scale-invariant (row equilibration)", () => {
    const inv = invert([
      [1e8, 0],
      [0, 1e-8],
    ]);
    expectRel(inv[0][0], 1e-8, 1e-15);
    expectRel(inv[1][1], 1e8, 1e-15);
  });
  it("throws SINGULAR_MATRIX on singular / near-singular input", () => {
    expectStatsError(
      () =>
        invert([
          [1, 2],
          [2, 4],
        ]),
      "SINGULAR_MATRIX",
    );
    expectStatsError(
      () =>
        invert([
          [1, 2, 3],
          [4, 5, 6],
          [7, 8, 9],
        ]),
      "SINGULAR_MATRIX",
    );
    expectStatsError(
      () =>
        invert([
          [0, 0],
          [1, 1],
        ]),
      "SINGULAR_MATRIX",
    );
    expectStatsError(() => invert([[1, 2]]), "INVALID_ARGUMENT");
  });
});

describe("qrLeastSquares", () => {
  it("matches R lm coefficients and (X'X)^-1", () => {
    // X <- cbind(1, 1:5, c(2,1,4,3,6)); y <- c(1.1,1.9,3.2,3.8,5.3); coef(lm(y ~ X - 1)); solve(crossprod(X))
    const X = [
      [1, 1, 2],
      [1, 2, 1],
      [1, 3, 4],
      [1, 4, 3],
      [1, 5, 6],
    ];
    const fit = qrLeastSquares(X, [1.1, 1.9, 3.2, 3.8, 5.3]);
    expectAbs(fit.coefficients[0], -0.064999999999999392, 1e-13);
    expectRel(fit.coefficients[1], 0.85499999999999976, 1e-13);
    expectRel(fit.coefficients[2], 0.1750000000000001, 1e-13);
    const ref = [
      1.1083333333333332, -0.25833333333333341, -0.041666666666666533, -0.2583333333333333, 0.30833333333333335,
      -0.20833333333333337, -0.041666666666666671, -0.20833333333333334, 0.20833333333333334,
    ];
    fit.xtxInverse.flat().forEach((v, i) => expectAbs(v, ref[i], 1e-13));
  });
  it("throws SINGULAR_MATRIX for a duplicated column", () => {
    const X = [
      [1, 2, 2],
      [1, 3, 3],
      [1, 5, 5],
      [1, 7, 7],
    ];
    expectStatsError(() => qrLeastSquares(X, [1, 2, 3, 4]), "SINGULAR_MATRIX");
    expectStatsError(() => qrLeastSquares([[1, 0], [1, 0], [1, 0]], [1, 2, 3]), "SINGULAR_MATRIX");
  });
  it("invertUpperTriangular", () => {
    const inv = invertUpperTriangular([
      [2, 1],
      [0, 4],
    ]);
    expect(inv).toEqual([
      [0.5, -0.125],
      [0, 0.25],
    ]);
  });
});
