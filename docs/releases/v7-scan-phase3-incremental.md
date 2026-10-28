# Collection v7: optional incremental scan cursors

Score stays v18. Collection stays v7. Cursor rows live beside the public
snapshot and do not change its JSON, coverage values, or `source_status`
object. `GHFIND_DISCOVER_SCORE_V1` is untouched.

## Flag

`GHFIND_SCAN_INCREMENTAL_ENABLED` defaults off. Accepted on values are `1`,
`true`, and `on`. With the flag off, the worker is the current dev path:
in-process Collect, then fullscan when coverage is `partial_public`, and the
existing `GHFIND_SCAN_FANOUT_ENABLED` semantics.

Rollback is unsetting the flag. Do not bump collection or score, and do not
rewrite stored snapshots.

## When the flag is on

Each user keeps one cursor book with a watermark per source (`repos`,
`external_prs`, `merged_window`). The watermark is the newest `pushedAt` or
`mergedAt` on that source. A GraphQL `endCursor` is stored only when that
page boundary was stable. The next scan pulls items strictly after the
watermark and merges them into the stored source page by stable key.

A part job on the fan-out path carries the same `since` watermark. Assemble
merges incremental part payloads before scoring. If the merged quick scan is
still `partial_public`, the worker runs the existing fullscan deepen.

## Reconciliation

The next pull of a source is a full read when any of these hold:

- the cursor is missing or its watermark does not parse
- `collection` on the cursor is not the current collection version
- incremental runs since the last full read reach `StatusTTL / roastFreshness`
  (7 days / 24 hours)
- the last full read is at least `StatusTTL` old (7 days)

Those thresholds are the existing job-status TTL and the #580 24h rescan
cooldown. Deletes, renames, visibility changes, and force-push drift are
corrected on that full read. An incremental pull does not delete rows.

The cursor table `scan_source_cursors` is created on first use
(`CREATE TABLE IF NOT EXISTS`). It does not alter `public_scan_runs`.

## Validation

Go tests use a fictional upstream only. They check that an incremental merge
matches a full scan of the same add, update, and delete, that a missing or
wrong-version cursor reconciles, and that the flag off does not publish a
`since` watermark.
