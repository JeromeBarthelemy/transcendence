import type { QueryClient, QueryKey } from "@tanstack/react-query";

/** A conflict needs a fresh version even when the cache is still fresh.
 * Keep the cached page intact on failure so its editor and draft stay mounted. */
export async function fetchFreshEntry<Data, Entry extends { id: number }>(
  queryClient: QueryClient,
  query: { queryKey: QueryKey; queryFn: () => Promise<Data> },
  entries: (data: Data) => readonly Entry[],
  entryId: number,
): Promise<Entry | null> {
  const data = await query.queryFn();
  queryClient.setQueryData(query.queryKey, data);
  return entries(data).find((entry) => entry.id === entryId) ?? null;
}
