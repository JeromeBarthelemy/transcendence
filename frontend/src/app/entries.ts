import type { QueryClient, QueryKey } from "@tanstack/react-query";

/** A conflict needs a fresh version even when the cache is still fresh.
 * Keep the cached page intact on failure so its editor and draft stay mounted.
 * Discard late results if the original query was removed (session reset,
 * account deletion, or eviction), even if the same key has been recreated. */
export async function fetchFreshEntry<Data, Entry extends { id: number }>(
  queryClient: QueryClient,
  query: { queryKey: QueryKey; queryFn: () => Promise<Data> },
  entries: (data: Data) => readonly Entry[],
  entryId: number,
): Promise<Entry | null> {
  const cache = queryClient.getQueryCache();
  const originalQuery = cache.find({ queryKey: query.queryKey, exact: true });
  if (!originalQuery) return null;

  const data = await query.queryFn();
  if (cache.find({ queryKey: query.queryKey, exact: true }) !== originalQuery) {
    return null;
  }
  queryClient.setQueryData(query.queryKey, data);
  return entries(data).find((entry) => entry.id === entryId) ?? null;
}
