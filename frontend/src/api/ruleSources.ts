import { z } from "zod/mini";
import { get, post } from "./client";

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

function parseSources(body: unknown): SourceRow[] {
  const result = sourcesSchema.safeParse(body);
  if (!result.success) {
    throw new Error("The rulebook sources response is invalid");
  }
  return result.data;
}

/** Per source, the copy `ask` searches and any change waiting for review
 * (#103) — administrators only. */
export async function getRuleSources(): Promise<SourceRow[]> {
  const { body } = await get("/api/rules/sources/");
  return parseSources(body);
}

/** Checks the game manual against its page now — the same check the
 * `sources-check` service runs every 24 hours (the Q&A is not checked
 * automatically). */
export async function checkRuleSources(): Promise<SourceRow[]> {
  const { body } = await post("/api/rules/sources/check/");
  return parseSources(body);
}

/** Replaces the searched copy with the one just fetched. */
export async function acceptRuleSource(source: string): Promise<SourceRow[]> {
  const { body } = await post(`/api/rules/sources/${source}/accept/`);
  return parseSources(body);
}
