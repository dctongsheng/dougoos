# @dougoos/storage

`@dougoos/storage` owns the file-backed SQLite WAL database, append-only migration
manifest, durable event receipt ledger, journal/projector transaction, consistent
snapshots, replay retention boundary, crash recovery, provider status, and the
resettable pseudonymous device identity.

Core is the only production caller and the only writer. Core allocates stable
`eventId` values before calling storage; storage allocates the global `seq` from
`journal_state` inside the append transaction. An exact retry returns the original
sequence without changing the read model. Reusing an `eventId` with a different
canonical payload fails closed, including after the journal row has been pruned,
because the non-content receipt ledger is retained.

`turn_end` is the sole terminal Turn event. Its projector closes streaming
text/thought messages, active tools, and pending approvals in the same transaction.
Completed/failed/cancelled Turns leave the initialized Session idle; interrupted
Turns leave it crashed. Recovery emits one interrupted `turn_end` per active Turn
in one transaction and a second recovery pass is a no-op.

Session persistence begins with one atomic `createInitializedSession` call: the
fully initialized idle row and its initial `session_state` envelope either both
commit or neither does. Turn creation accepts the complete shared
`CreateTurnRequest`; every `content[]` part is retained as a separate ordered user
message envelope, while idempotency fingerprints the canonical
`{ sessionId, request }` value. `getTurn(turnId)` and
`getApproval(turnId, requestId)` are the narrow shared-schema-validated command
lookups.

An Agent crash is ordered as terminal `turn_end` first and `session_error` second.
This preserves the single terminal transition and prevents a crashed Session from
retaining an active Turn.

Operational SQLite policy is fixed at WAL, `busy_timeout=5000`,
`synchronous=FULL`, foreign keys on, and an automatic checkpoint every 1000 pages.
For an existing file, ownership, migration history, schema fingerprints, base
invariants, and journal integrity are checked read-only before any persistent
pragma. Pending migrations are revalidated and applied transactionally; WAL is
enabled only after the final schema and journal pass. Fresh bootstrap and all
pending migrations are one transaction, so failure leaves no partial storage
schema.
Normal SQLite lock timeout is reported as `DATABASE_BUSY`; it is never rewritten
as the product-level `SESSION_BUSY`. Exhausted SQLite capacity is reported
separately as `DATABASE_FULL`.

The Accepted Architecture name `usage_stats` is retained with one row per Turn:
`turn_id` is the stable key and `session_id` is indexed for later aggregation.
`getTurnUsage(turnId)` is the narrow typed read path, including after journal
retention. A public session-level aggregate DTO is intentionally left to the
later Core/API contract rather than inventing quality-merging semantics here.

## Self-test

This creates a temporary real file, loads the native module, runs migrations and
an integrity inspection, checkpoints WAL, and removes only that temporary file:

```bash
pnpm --filter @dougoos/storage debug
```

## Safe database inspection

The inspector copies a stable main/WAL snapshot without opening or mutating the
source (including an orphaned WAL after a crash), then opens only the temporary
copy with `query_only`. It never runs migrations and prints only
schema/migration metadata, integrity status, journal watermarks, and aggregate
row counts. It never prints the database path, cwd, device ID, messages, tool
content, or tokens.

```bash
pnpm --filter @dougoos/storage build
node packages/storage/dist/db-inspect.js -- /absolute/path/to/data.db
```
