import assert from "node:assert/strict";
import test from "node:test";

import {
  canonicalRulebookText,
  diffRulebookContent,
} from "../src/rulebooks/watch.ts";

test("rulebook comparison ignores numeric display-only formatting", () => {
  assert.equal(
    canonicalRulebookText("Champion\n74.5\nSalary Cap"),
    canonicalRulebookText("Champion\n74.50\nSalary   Cap"),
  );
  assert.deepEqual(
    diffRulebookContent("Champion\n74.5\nSalary Cap", "Champion\n74.50\nSalary   Cap"),
    [],
  );
});

test("rulebook comparison reports real wording and value changes", () => {
  const changes = diffRulebookContent(
    "4.11.2. Each slot may play in up to 8 series.\nFoundation 43.5",
    "4.11.2. Each slot may play in up to 9 series.\nFoundation 34.5",
  );
  assert.ok(changes.length >= 1);
  const text = JSON.stringify(changes);
  assert.match(text, /8 series/);
  assert.match(text, /9 series/);
  assert.match(text, /43\.5/);
  assert.match(text, /34\.5/);
});
