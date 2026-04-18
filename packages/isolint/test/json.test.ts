import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { extractJSON } from "../src/util/json.js";

describe("extractJSON", () => {
  it("parses plain JSON", () => {
    assert.deepEqual(extractJSON('{"a":1}'), { a: 1 });
  });

  it("strips markdown code fences", () => {
    assert.deepEqual(extractJSON('```json\n{"a":1}\n```'), { a: 1 });
    assert.deepEqual(extractJSON("```\n[1,2]\n```"), [1, 2]);
  });

  it("extracts JSON surrounded by prose", () => {
    assert.deepEqual(
      extractJSON('Here is the JSON: {"ok": true}. Hope that helps!'),
      { ok: true },
    );
  });

  it("handles nested objects and quoted braces", () => {
    assert.deepEqual(
      extractJSON('prefix {"a": {"b": "}"}} trailing'),
      { a: { b: "}" } },
    );
  });

  it("throws when no JSON present", () => {
    assert.throws(() => extractJSON("just text"));
  });
});
