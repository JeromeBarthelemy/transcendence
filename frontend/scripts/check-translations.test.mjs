import assert from "node:assert/strict";
import { test } from "vitest";
import { catalogueProblems } from "./check-translations.mjs";

test("reports missing, empty and unexpected keys without runtime fallback", () => {
  const problems = catalogueProblems(
    { a: "A", b: "B" },
    { a: "", extra: "X" },
    "en",
  );
  assert.ok(problems.some((p) => p.includes("a: translation is empty")));
  assert.ok(problems.some((p) => p.includes("b: missing")));
  assert.ok(problems.some((p) => p.includes("extra: unexpected")));
});

test("rejects changed interpolation variables and missing rich links", () => {
  const source = {
    greeting: "Bonjour {{name}}",
    policy: "<privacy>Confidentialité</privacy>",
  };
  const problems = catalogueProblems(
    source,
    { greeting: "Hello {{email}}", policy: "Privacy" },
    "en",
  );
  assert.ok(
    problems.some((p) => p.includes("greeting: incompatible interpolation")),
  );
  assert.ok(problems.some((p) => p.includes("policy: incompatible rich-text")));
});

test("accepts reordered variables, literal braces and translated rich text", () => {
  assert.deepEqual(
    catalogueProblems(
      { text: "{{name}}: {{count}}", rich: "<strong>Bonjour</strong>" },
      { text: "{{count}} for {{name}}", rich: "<strong>Hello</strong>" },
      "en",
    ),
    [],
  );
});

test("requires only the target language's plural categories", () => {
  const reference = {
    item_one: "{{count}} objet",
    item_other: "{{count}} objets",
    item_many: "{{count}} objets",
    test_zero: "Test zéro",
  };
  const english = {
    item_one: "{{count}} item",
    item_other: "{{count}} items",
    test_zero: "Test zero",
  };
  assert.deepEqual(catalogueProblems(reference, english, "en"), []);
  assert.ok(
    catalogueProblems(reference, english, "es").some((p) =>
      p.includes("item_many: missing"),
    ),
  );
  assert.deepEqual(
    catalogueProblems(
      reference,
      { ...english, item_many: "{{count}} objetos" },
      "es",
    ),
    [],
  );
});

test("accepts an explicit zero form without count and rejects new variables", () => {
  const reference = {
    item_one: "{{count}} objet",
    item_other: "{{count}} objets",
  };
  assert.deepEqual(
    catalogueProblems(reference, { ...reference, item_zero: "No items" }, "en"),
    [],
  );
  assert.ok(
    catalogueProblems(reference, { ...reference, item_zero: "{{email}}" }, "en")
      .length,
  );
  const named = {
    item_one: "{{name}}: {{count}} objet",
    item_other: "{{name}}: {{count}} objets",
  };
  assert.ok(
    catalogueProblems(named, { ...named, item_zero: "No items" }, "en").length,
  );
});

test("rejects malformed catalogue values", () => {
  assert.ok(
    catalogueProblems({ title: "Title" }, { title: ["Title"] }, "en").some(
      (p) => p.includes("expected"),
    ),
  );
});
