import { describe, expect, it } from "vitest";

import { formatJsonLoosely, isJsonSource, parseJsonExcerpt } from "../src";

describe("isJsonSource", () => {
  it("matches .json files regardless of case, path or query", () => {
    expect(isJsonSource("case.json")).toBe(true);
    expect(isJsonSource("data/cases/CASE-1.JSON")).toBe(true);
    expect(isJsonSource("https://x.test/case.json?x=1#frag")).toBe(true);
    expect(isJsonSource("law.pdf")).toBe(false);
    expect(isJsonSource("notes.json.txt")).toBe(false);
    expect(isJsonSource(undefined)).toBe(false);
  });
});

describe("parseJsonExcerpt", () => {
  it("parses any valid JSON value", () => {
    expect(parseJsonExcerpt("{\"a\": [1, {\"b\": null}]}")).toEqual({
      value: { a: [1, { b: null }] },
      repaired: false,
    });
    expect(parseJsonExcerpt("[true, \"x\"]")).toEqual({ value: [true, "x"], repaired: false });
    expect(parseJsonExcerpt("42")).toEqual({ value: 42, repaired: false });
  });

  it("returns undefined for empty or non-JSON text", () => {
    expect(parseJsonExcerpt("   ")).toBeUndefined();
    expect(parseJsonExcerpt("Plain prose without brackets.")).toBeUndefined();
    expect(parseJsonExcerpt("{\"a\": 1]")).toBeUndefined();
  });

  it("repairs a chunk truncated inside a string", () => {
    expect(parseJsonExcerpt("{\"case_id\": \"CASE-1\", \"summary\": \"Forælder sø")).toEqual({
      value: { case_id: "CASE-1", summary: "Forælder sø" },
      repaired: true,
    });
  });

  it("repairs a chunk truncated after a key, a colon or a comma", () => {
    expect(parseJsonExcerpt("{\"a\": 1, \"b\"")?.value).toEqual({ a: 1, b: null });
    expect(parseJsonExcerpt("{\"a\": 1, \"b\":")?.value).toEqual({ a: 1, b: null });
    expect(parseJsonExcerpt("{\"a\": 1,")?.value).toEqual({ a: 1 });
  });

  it("repairs nested structures cut mid-array", () => {
    const text = "{\"timeline\": [{\"id\": \"e1\", \"tags\": [\"a\", \"b\"]}, {\"id\": \"e2\", \"ev";
    expect(parseJsonExcerpt(text)?.value).toEqual({
      timeline: [{ id: "e1", tags: ["a", "b"] }, { id: "e2", ev: null }],
    });
  });

  it("recovers sibling items from a chunk that starts mid-document", () => {
    const text = "ion\", \"law_paragraphs\": [\"x\"]}, {\"id\": \"e3\", \"label\": \"L\"}, {\"id\": \"e4\"";
    expect(parseJsonExcerpt(text)?.value).toEqual([
      { id: "e3", label: "L" },
      { id: "e4" },
    ]);
  });

  it("keeps escaped quotes inside strings intact while repairing", () => {
    expect(parseJsonExcerpt("{\"q\": \"say \\\"hi\\\"\", \"n\": 1")?.value).toEqual({
      q: "say \"hi\"",
      n: 1,
    });
  });
});

describe("formatJsonLoosely", () => {
  it("re-indents valid and truncated JSON text", () => {
    expect(formatJsonLoosely("{\"a\":1,\"b\":[1,2],\"c\":{}}")).toBe(
      "{\n  \"a\": 1,\n  \"b\": [\n    1,\n    2\n  ],\n  \"c\": {}\n}",
    );
    expect(formatJsonLoosely("{\"a\": \"x, y\", \"b\": [1")).toBe(
      "{\n  \"a\": \"x, y\",\n  \"b\": [\n    1",
    );
  });
});
