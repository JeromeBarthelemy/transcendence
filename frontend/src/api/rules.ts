import { z } from "zod/mini";
import { get, post } from "./client";

const citationSchema = z.object({
  rank: z.number(),
  reference: z.string(),
  text: z.string(),
  source: z.enum(["game_manual", "official_qa"]),
  authority: z.enum(["binding", "ruling"]),
  document_title: z.string(),
  // Where this passage lives on FIRST's own manual page (#134); null when
  // the source document has no URL or this citation has no anchor on it.
  url: z.nullable(z.string()),
});

const ruleAnswerSchema = z.object({
  question: z.string(),
  // Empty when the citations speak for themselves; a sentence only when
  // nothing could be cited (README, "Rulebook questions").
  answer: z.string(),
  citations: z.array(citationSchema),
});

export type Citation = z.infer<typeof citationSchema>;
export type RuleAnswer = z.infer<typeof ruleAnswerSchema>;

/** The server's own limit (AskSerializer). */
export const QUESTION_MAX_LENGTH = 500;

export async function askRules(question: string): Promise<RuleAnswer> {
  const { body } = await post("/api/rules/ask/", { question });
  const result = ruleAnswerSchema.safeParse(body);
  if (!result.success) {
    throw new Error("The rulebook answer is invalid");
  }
  return result.data;
}

const glossaryTermSchema = z.object({
  term: z.string(),
  definition: z.string(),
});

const glossarySchema = z.array(glossaryTermSchema);

export type GlossaryTerm = z.infer<typeof glossaryTermSchema>;

export const glossaryQueryKey = ["rules", "glossary"] as const;

/** The current season's glossary (#136), empty without one ingested yet. */
export async function getGlossary(): Promise<GlossaryTerm[]> {
  const { body } = await get("/api/rules/glossary/");
  const result = glossarySchema.safeParse(body);
  if (!result.success) {
    throw new Error("The glossary response is invalid");
  }
  return result.data;
}
