// Reads that must see a write made seconds ago.
//
// Hyperdrive caches the results of read queries (60 seconds by default, served
// stale for a while longer while it refreshes). For most pages that is free
// speed. For some reads it is a bug, and one was caught on 2026-09-14: the owner
// assigned the Hookka number to its company, the write succeeded, and for about
// two minutes Settings → Phone numbers kept showing "NO COMPANY" — so he pressed
// Assign three more times and got three refusals for a number that was already
// assigned. The same cache would let a new customer message miss the channel it
// was just assigned to, and let an away message be sent twice because the first
// one was not in the cached thread yet.
//
// Hyperdrive does not cache a query that calls a volatile or stable function
// (Cloudflare docs, "Query caching"). `now()` is stable, so adding this
// always-true predicate to a WHERE opts exactly that one query out of the cache
// and changes nothing about its result. Use it only where a stale answer is
// wrong, not merely slower: every use is a real round-trip to Postgres.

import { sql, type SQL } from "drizzle-orm";

export function bypassReadCache(): SQL {
  return sql`now() is not null`;
}
