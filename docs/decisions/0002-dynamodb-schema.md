# ADR-0002: DynamoDB multi-table layout with per-user partitioning

**Status:** accepted
**Date:** 2026-05-12

## Context

The jobtracker rewrite stores three kinds of data: user profiles, tracked job applications, and per-user Gmail sync state. We needed to decide:

1. **One table or many?** The DynamoDB community at scale prefers single-table design (one table with composite keys + GSIs for every access pattern). It's denser and reduces I/O at high traffic, but the design is harder upfront and harder to evolve.
2. **Billing mode?** Provisioned capacity (cheaper per request at scale, but pays 24/7 and needs capacity planning) vs on-demand (more expensive per request, $0 idle).
3. **Backup posture?** Point-in-time recovery is $0.20/GB/month — cheap insurance, but optional.
4. **Deletion guardrails?** Easy or hard to delete a table?

## Decision

**Multi-table layout, pay-per-request, with PITR and deletion protection on every table.**

Specifically:

| Table | Partition key | Sort key | Indexes |
|---|---|---|---|
| `users` | `userId` | — | — |
| `applications` | `userId` | `applicationId` | GSI `by-gmail-thread` (HASH=`gmailThreadId`, projection `KEYS_ONLY`) |
| `sync_state` | `userId` | — | — |

Every table:

- `billing_mode = PAY_PER_REQUEST`
- `point_in_time_recovery.enabled = true`
- `deletion_protection_enabled = true`
- `server_side_encryption.enabled = true` (AWS-managed key, free)

## Consequences

### Positive

- **Readable.** Each table corresponds to one entity. New engineers (and future-me) can navigate the data layer without first understanding a custom item-type scheme.
- **$0 at idle.** Pay-per-request means no charges until items are written/read. PITR also costs $0 until there's data to back up.
- **Hard to lose data.** Deletion protection forces a two-step delete (toggle off, apply, then destroy). PITR provides a 35-day rollback window against accidental writes/deletes.
- **GSI shape matches access pattern.** `by-gmail-thread` is the only secondary access pattern: "have I already created an application for this email thread?" One index, KEYS_ONLY projection (cheapest), covers it.

### Negative

- **Not optimal at scale.** At 100x current volume, single-table design with denormalized items would mean fewer round trips per dashboard load. Today this is a non-issue.
- **Cross-entity transactions are awkward.** DynamoDB transactions work across tables, but readability suffers as the count grows. Acceptable at three tables.
- **Per-request pricing higher unit cost.** At extremely high write volume (>10M writes/month), provisioned would be cheaper. We're orders of magnitude below this.

## Alternatives considered

### Single-table design
- **Pros:** Industry "best practice" at scale. Denormalized items reduce round trips. One table to manage.
- **Cons:** Schema upfront is very hard. Every access pattern must be enumerated before designing the key structure. Adding a new query later may require backfilling existing items. The model is opaque to anyone reading the code without a key-design diagram.
- **Why rejected:** Premature optimization for our scale. Migration path from multi → single later is straightforward if we need it. Migration single → simpler-multi is the painful direction, so multi is the safer starting choice.

### Provisioned capacity
- **Pros:** Cheaper per request at sustained load. Predictable cost.
- **Cons:** Requires capacity planning. Pays 24/7 even when idle. We have no usage data to estimate from.
- **Why rejected:** $0 idle is more valuable than per-request unit cost at MVP scale.

### Skip PITR to save pennies
- **Cons:** No rollback against accidental data destruction.
- **Why rejected:** PITR is cheap insurance ($0.20/GB/month on tiny data = pennies/month) against catastrophic mistakes. The cost of not having it is enormous if anything goes wrong.

### Skip deletion protection to keep `terraform destroy` snappy
- **Cons:** A typo in a tfvars file or a confused `apply -auto-approve` could wipe user data.
- **Why rejected:** The two-step delete is a feature, not a bug. Forcing intent before destruction is the right default for tables holding user data.

## Implementation

Defined in `infra/modules/data/main.tf`. Called from `infra/environments/dev/main.tf`. Outputs (`*_table_name`, `*_table_arn`, `all_table_arns`) are surfaced to the dev environment level and will be consumed by future modules (Lambda env vars, IAM policies).

## Revisit triggers

This decision should be reconsidered if:

- We routinely need cross-entity queries that don't fit the current shape — consider denormalizing or moving to single-table.
- Write volume exceeds ~1M/month consistently — consider provisioned capacity.
- A new access pattern emerges that can't be served by the current PK/SK/GSI structure.
