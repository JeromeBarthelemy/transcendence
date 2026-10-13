import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const pluralSuffix = /^(.*)_(zero|one|two|few|many|other)$/;

function flatten(value, prefix = "", problems = []) {
  const entries = new Map();
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    problems.push(`${prefix || "catalogue"}: expected an object`);
    return entries;
  }
  for (const [key, child] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof child === "string") {
      entries.set(path, child);
      if (!child.trim()) problems.push(`${path}: translation is empty`);
    } else if (child && typeof child === "object" && !Array.isArray(child)) {
      for (const entry of flatten(child, path, problems)) entries.set(...entry);
    } else {
      problems.push(`${path}: expected a translation string or an object`);
    }
  }
  return entries;
}

function variables(text) {
  return [...text.matchAll(/\{\{\s*-?\s*([\w.]+)(?:\s*,[^}]*)?\s*\}\}/g)]
    .map((match) => match[1])
    .filter((value, i, all) => all.indexOf(value) === i)
    .sort();
}

function tags(text) {
  return [...text.matchAll(/<\/?([a-zA-Z][\w-]*)\s*\/?>/g)]
    .map((match) => match[0].replace(/\s/g, ""))
    .sort();
}

/** Compare plural groups using the target language's categories: '_many'
 * is required in French and Spanish, but not English. A lone key such as
 * 'test_zero' is ordinary text, not a plural group. */
export function catalogueProblems(reference, catalogue, language) {
  const problems = [];
  const source = flatten(reference, "", problems);
  const target = flatten(catalogue, "", problems);
  const groups = new Set(
    [...source.keys()]
      .filter(
        (key) =>
          key.endsWith("_other") && source.has(key.replace(/_other$/, "_one")),
      )
      .map((key) => key.slice(0, -6)),
  );
  const categories = new Intl.PluralRules(language).resolvedOptions()
    .pluralCategories;
  const expected = new Map();
  for (const [key, text] of source) {
    const match = key.match(pluralSuffix);
    if (!match || !groups.has(match[1])) expected.set(key, text);
  }
  for (const group of groups) {
    for (const category of categories) {
      expected.set(
        `${group}_${category}`,
        source.get(`${group}_${category}`) ?? source.get(`${group}_other`),
      );
    }
  }
  for (const [key, text] of expected) {
    if (!target.has(key)) {
      problems.push(`${key}: missing translation`);
      continue;
    }
    const translated = target.get(key);
    if (
      JSON.stringify(variables(text)) !== JSON.stringify(variables(translated))
    ) {
      problems.push(`${key}: incompatible interpolation variables`);
    }
    if (JSON.stringify(tags(text)) !== JSON.stringify(tags(translated))) {
      problems.push(`${key}: incompatible rich-text tags`);
    }
  }
  for (const [key, text] of target) {
    if (expected.has(key)) continue;
    const match = key.match(pluralSuffix);
    if (match?.[2] === "zero" && groups.has(match[1])) {
      const base = source.get(`${match[1]}_other`);
      // An explicit zero form may omit the count, but not add new variables.
      const sourceVariables = variables(base);
      const translatedVariables = variables(text);
      if (
        translatedVariables.some((name) => !sourceVariables.includes(name)) ||
        sourceVariables.some(
          (name) => name !== "count" && !translatedVariables.includes(name),
        )
      ) {
        problems.push(`${key}: incompatible interpolation variables`);
      }
      if (JSON.stringify(tags(text)) !== JSON.stringify(tags(base))) {
        problems.push(`${key}: incompatible rich-text tags`);
      }
    } else {
      problems.push(`${key}: unexpected translation key`);
    }
  }
  return problems;
}

function main() {
  const read = (name) =>
    JSON.parse(
      readFileSync(
        new URL(`../src/locales/${name}.json`, import.meta.url),
        "utf8",
      ),
    );
  const reference = read("fr");
  let failed = false;
  for (const language of ["fr", "en", "es"]) {
    const problems = catalogueProblems(reference, read(language), language);
    for (const problem of problems) console.error(`${language}: ${problem}`);
    failed ||= problems.length > 0;
  }
  const fallbacks = read("server-error-fallbacks");
  for (const code of Object.keys(fallbacks)) {
    if (!Object.hasOwn(reference.serverErrors, code)) {
      console.error(`Missing localized server-error fallback: ${code}`);
      failed = true;
    }
  }
  if (failed) process.exitCode = 1;
  else
    console.log(
      "Translation catalogues: complete keys, plural forms, variables and rich-text tags.",
    );
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main();
}
