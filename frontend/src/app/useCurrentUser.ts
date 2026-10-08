import { hashKey, type QueryClient, useQuery } from "@tanstack/react-query";

import { getCurrentUser, type Identity } from "../api/auth";

export const currentUserQueryKey = ["auth", "me"] as const;

export function useCurrentUser() {
  return useQuery({
    queryKey: currentUserQueryKey,
    queryFn: getCurrentUser,
  });
}

/** Logging in or out: everything the previous account loaded — boards,
 * work items, days, analytics, an admin's member list and its addresses —
 * leaves the cache, and only the new identity (`null` once signed out)
 * stays. On the club's shared laptop, the next member to sign in on the
 * same tab must never see the last one's data, not even while their own is
 * still loading. Queries still in flight are cancelled as they are
 * removed, so a late answer for the previous account cannot land
 * afterwards.
 *
 * The identity's own entry is written over rather than removed with the
 * rest: the header and the page on screen are subscribed to it, and must
 * see the change even when the address does not change (logging out from
 * the home page). Deleting an account keeps its own `removeQueries()`
 * (ProfilePage): there, the profile must *not* see the signed-out identity
 * before the home page replaces it, or it would redirect to /login. */
export function resetSession(
  queryClient: QueryClient,
  identity: Identity | null,
) {
  const identityHash = hashKey(currentUserQueryKey);
  queryClient.removeQueries({
    predicate: (query) => query.queryHash !== identityHash,
  });
  queryClient.setQueryData(currentUserQueryKey, identity);
}
