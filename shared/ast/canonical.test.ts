import { createHash, randomBytes } from "node:crypto";

import { describe, expect, it } from "vitest";

import { CanonicalJsonError, canonicalHash, canonicalJson, sha256Hex } from "./canonical";

function reference(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

describe("sha256Hex", () => {
  it("matches the published empty-string vector", () => {
    expect(sha256Hex("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  });

  it("matches the published “abc” vector", () => {
    expect(sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });

  it("matches node:crypto across lengths that cross block and padding boundaries", () => {
    for (const length of [0, 1, 55, 56, 57, 63, 64, 65, 119, 120, 127, 128, 129, 1000]) {
      const input = "a".repeat(length);
      expect(sha256Hex(input), `length ${length}`).toBe(reference(input));
    }
  });

  it("matches node:crypto for multi-byte UTF-8 content", () => {
    for (const input of ["héllo", "日本語のテキスト", "🩺📊", "naïve—café"]) {
      expect(sha256Hex(input), input).toBe(reference(input));
    }
  });

  it("matches node:crypto for random payloads", () => {
    for (let i = 0; i < 50; i += 1) {
      const input = randomBytes(64).toString("base64");
      expect(sha256Hex(input)).toBe(reference(input));
    }
  });
});

describe("canonicalJson", () => {
  it("sorts object members by UTF-16 code unit, not locale", () => {
    expect(canonicalJson({ b: 1, a: 2, C: 3, á: 4, Z: 5 })).toBe('{"C":3,"Z":5,"a":2,"b":1,"á":4}');
  });

  it("sorts nested members too", () => {
    expect(canonicalJson({ root: { op: "add", args: [1, 2] }, ast_version: "1.0" })).toBe(
      '{"ast_version":"1.0","root":{"args":[1,2],"op":"add"}}',
    );
  });

  it("normalizes negative zero", () => {
    expect(canonicalJson(-0)).toBe("0");
    expect(canonicalJson({ value: -0 })).toBe('{"value":0}');
  });

  it("hashes structurally identical documents identically regardless of key order", () => {
    const left = { ast_version: "1.0", root: { node_type: "literal", value: 1 } };
    const right = { root: { value: 1, node_type: "literal" }, ast_version: "1.0" };
    expect(canonicalHash(left)).toBe(canonicalHash(right));
  });

  it("hashes -0 and 0 identically", () => {
    expect(canonicalHash({ value: -0 })).toBe(canonicalHash({ value: 0 }));
  });

  it("distinguishes documents that differ only in a nested value", () => {
    const left = { root: { node_type: "literal", value: 1 } };
    const right = { root: { node_type: "literal", value: 1.0000001 } };
    expect(canonicalHash(left)).not.toBe(canonicalHash(right));
  });

  it("rejects non-finite numbers rather than emitting null", () => {
    expect(() => canonicalJson({ value: Number.NaN })).toThrow(CanonicalJsonError);
    expect(() => canonicalJson({ value: Number.POSITIVE_INFINITY })).toThrow(CanonicalJsonError);
  });

  it("omits undefined members instead of failing", () => {
    expect(canonicalJson({ a: 1, b: undefined })).toBe('{"a":1}');
  });

  it("rejects values JSON cannot represent", () => {
    expect(() => canonicalJson(() => 1)).toThrow(CanonicalJsonError);
    expect(() => canonicalJson(10n)).toThrow(CanonicalJsonError);
  });

  it("escapes strings the way JSON does", () => {
    expect(canonicalJson('a"b\\c\nd')).toBe('"a\\"b\\\\c\\nd"');
  });

  it("agrees with the RFC 8785 number-to-string contract for representative values", () => {
    expect(canonicalJson(1e21)).toBe("1e+21");
    expect(canonicalJson(0.1)).toBe("0.1");
    expect(canonicalJson(-1.5)).toBe("-1.5");
    expect(canonicalJson(1000000)).toBe("1000000");
  });
});
