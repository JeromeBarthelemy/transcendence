import { z } from "zod/mini";

import { get } from "./client";
import { entrySchema, type WorkItemStep } from "./workItems";

export const entryTypes = ["progress", "note", "decision"] as const;
export const searchOrders = ["newest", "oldest"] as const;
export const pageSizes = [10, 20, 50] as const;

/** The notebook search's filters, as the query string carries them: every
 * one optional, each one narrowing the results. */
export interface SearchFilters {
  q?: string;
  work_item?: number;
  on_robot?: boolean;
  step?: WorkItemStep;
  participant?: number;
  since?: string;
  until?: string;
  type?: (typeof entryTypes)[number];
  has_photo?: boolean;
  order?: (typeof searchOrders)[number];
  page?: number;
  page_size?: number;
}

const searchResultSchema = z.extend(entrySchema, { day: z.string() });

const searchPageSchema = z.object({
  count: z.int().check(z.nonnegative()),
  page: z.int().check(z.positive()),
  page_size: z.int().check(z.positive()),
  results: z.array(searchResultSchema),
  people: z.array(
    z.object({
      id: z.number(),
      display_name: z.string(),
      avatar: z.nullable(z.string()),
    }),
  ),
});

export type SearchResult = z.infer<typeof searchResultSchema>;
export type SearchPage = z.infer<typeof searchPageSchema>;

export function searchQuery(filters: SearchFilters): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined && value !== "") params.set(key, String(value));
  }
  return params.toString();
}

export async function searchEntries(
  teamSeasonId: number,
  filters: SearchFilters,
): Promise<SearchPage> {
  const query = searchQuery(filters);
  const { body } = await get(
    `/api/team-seasons/${teamSeasonId}/search/${query ? `?${query}` : ""}`,
  );
  const result = searchPageSchema.safeParse(body);
  if (!result.success) {
    throw new Error("The search response is invalid");
  }
  return result.data;
}
