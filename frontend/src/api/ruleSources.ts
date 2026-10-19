import { z } from "zod/mini";
import { get, post, upload } from "./client";

const changeSummarySchema = z.object({
  added: z.number(),
  removed: z.number(),
  changed: z.number(),
  references: z.array(z.string()),
  references_total: z.number(),
});

const sourceRowSchema = z.object({
  source: z.enum(["game_manual", "official_qa"]),
  title: z.nullable(z.string()),
  url: z.string(),
  fetched_at: z.nullable(z.string()),
  checked_at: z.nullable(z.string()),
  pending: z.nullable(
    z.object({
      detected_at: z.string(),
      summary: changeSummarySchema,
    }),
  ),
  // Only on the answer to a check just run (club/api/views.py, _rule_sources).
  check: z.nullable(
    z.object({
      status: z.enum(["unchanged", "pending", "error"]),
      detail: z.string(),
    }),
  ),
});

const sourcesSchema = z.array(sourceRowSchema);

export type SourceRow = z.infer<typeof sourceRowSchema>;

export const ruleSourcesQueryKey = ["rules", "sources"] as const;
export const SOURCE_MAX_BYTES = 5 * 1024 * 1024;

export interface SourceImport {
  source: SourceRow["source"];
  title?: string;
  url?: string;
  file?: File;
}

export async function importRuleSource(
  input: SourceImport,
): Promise<SourceRow[]> {
  if (input.file) {
    const form = new FormData();
    form.append("source", input.source);
    form.append("file", input.file);
    if (input.title) form.append("title", input.title);
    if (input.url) form.append("url", input.url);
    const { body } = await upload(
      "POST",
      "/api/rules/sources/",
      form,
      () => {},
    );
    return parseSources(body);
  }
  const { body } = await post("/api/rules/sources/", input);
  return parseSources(body);
}

function parseSources(body: unknown): SourceRow[] {
  const result = sourcesSchema.safeParse(body);
  if (!result.success) {
    throw new Error("The rulebook sources response is invalid");
  }
  return result.data;
}

/** Per source, the copy `ask` searches and any change waiting for review —
 * administrators only. */
export async function getRuleSources(): Promise<SourceRow[]> {
  const { body } = await get("/api/rules/sources/");
  return parseSources(body);
}

/** Checks sources with an official URL against their page now — the same
 * check the `sources-check` service runs every 24 hours. */
export async function checkRuleSources(): Promise<SourceRow[]> {
  const { body } = await post("/api/rules/sources/check/");
  return parseSources(body);
}

/** Replaces the searched copy with the one just fetched. */
export async function acceptRuleSource(source: string): Promise<SourceRow[]> {
  const { body } = await post(`/api/rules/sources/${source}/accept/`);
  return parseSources(body);
}

const DISMISSED_KEY_PREFIX = "rulebook-source-dismissed:";

/** Dismissing is remembered by the change's own `detected_at`, not just a
 * flag: a later check finding a newer change (a different `detected_at`)
 * un-dismisses it by itself, with nothing to clear by hand. Read with
 * `isDismissed` wherever a row is shown — the badge and the review screen
 * agree on it without sharing any state of their own. */
export function dismissPending(source: string, detectedAt: string): void {
  try {
    localStorage.setItem(DISMISSED_KEY_PREFIX + source, detectedAt);
  } catch {
    // A private window or disabled storage: the dismissal just won't
    // outlive this render, which is the same as never calling this at all.
  }
}

export function isDismissed(row: SourceRow): boolean {
  if (!row.pending) {
    return false;
  }
  try {
    return (
      localStorage.getItem(DISMISSED_KEY_PREFIX + row.source) ===
      row.pending.detected_at
    );
  } catch {
    return false;
  }
}
