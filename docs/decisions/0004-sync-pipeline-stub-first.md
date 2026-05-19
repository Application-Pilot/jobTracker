# ADR-0004: Build the sync pipeline with a stub classifier first

**Status:** accepted
**Date:** 2026-05-19

## Context

Stage 2 Session C builds the per-user Gmail sync pipeline: EventBridge cron → scheduler Lambda → SQS → worker Lambda → DynamoDB applications. The original plan bundled three concerns into one session:

1. **Pipeline plumbing** — EventBridge, SQS, two new Lambdas, IAM, KMS decrypt with encryption context, sync_state cursor management, retries via DLQ.
2. **Gmail integration** — refresh-token exchange, message-list paging, fetching full messages, per-user cursor (`historyId`) for incremental sync, rate-limit handling.
3. **Email classification + LLM extraction** — deciding which emails are real job-application updates vs. promotional noise / recruiter cold-outreach / bounces, then prompting Gemini for structured fields (`company`, `role`, `status`, `appliedAt`).

The prototype already has working logic for (2) and (3), but porting it cleanly into the new architecture (encrypted token storage, per-user isolation, error handling, idempotency by `gmailThreadId`) is a non-trivial chunk of work on its own — and (3) in particular still has open product questions: how to filter recruiter outreach for jobs the user never applied to, how to handle multilingual emails, what to do with HR replies that aren't status updates.

If we ship all three at once and the deployed pipeline doesn't produce applications, it's hard to know whether the failure is in plumbing, OAuth/Gmail, or classification. Three changes can fail in three different ways and the debug surface is large.

## Decision

**Build the pipeline plumbing in Session C with a stub classifier. Defer real Gmail fetching and LLM extraction to Session D.**

Concretely, the Session C worker Lambda:

- Receives an SQS message containing `{ userId }`
- Reads the user row from DynamoDB
- KMS-decrypts the Gmail refresh token (using `EncryptionContext: { userId }`)
- Exchanges the refresh token for an access token via Google's `/oauth2/token` (proves the decrypted token is real, exercises the network path that the real worker will use later)
- **Stub mode:** skips Gmail message fetching and the LLM call entirely. Generates one synthetic `Application` row with deterministic-looking placeholder fields (`company: "Stub Co"`, `role: "Stub Engineer"`, `gmailThreadId: "stub-<uuid>"`, etc.) and writes it to the applications table.
- Updates `sync_state` with `lastSyncAt`, `lastSyncStatus = "success"`, increments `applicationsCreated`, and sets `nextSyncEligibleAt = now + 15min`.

A `STUB_CLASSIFIER=true` env var flags this mode. Session D flips it off and the same worker, same IAM, same wiring runs against real Gmail + Gemini — only the classify/extract function body changes.

A `classify()` function stub in `app/packages/sync-core/` is the swap-in point. Its signature will be stable across both sessions.

## Consequences

**Positive:**
- Pipeline failure modes become discoverable in isolation. If after Session C the synthetic row doesn't appear in DynamoDB, the bug is in plumbing — never in the classifier (because there is no classifier yet).
- KMS encryption context is exercised end-to-end (encrypt in the web Lambda during Connect Gmail, decrypt in the worker Lambda during sync). Getting the `EncryptionContext: { userId }` shape wrong is the most common pitfall with per-user KMS — having both sides committed and working before LLM code lands de-risks that.
- Session D becomes purely about Gmail + Gemini, with a known-good pipeline underneath. Smaller cognitive load, smaller diff surface, easier code review.
- The shared `sync-core` package is in place from Session C, so when the real classifier ships in Session D it has somewhere clean to live (not crammed into the worker's `index.ts`).
- The cron is already firing on its real schedule. By the time Session D lands, we'll have ~24 hours of stub-mode sync data in CloudWatch logs — enough to debug worker cold-start latency, SQS retry behaviour, IAM gaps, before piling on Gemini's failure modes.

**Negative:**
- The applications table fills with synthetic rows between Session C and Session D. Mitigation: easy to wipe with a single `aws dynamodb` call before Session D's first real sync, OR add a `synthetic: true` flag and filter it from UI queries.
- An interview-skimming reader of the repo at the wrong moment will see "Connect Gmail" working but the dashboard showing nonsense applications. Mitigated by README + the fact that the cron only runs in dev for now.
- One extra ADR + one extra commit boundary to manage. Worth it.

## When to revisit

After Session D ships the real classifier, archive this ADR's stub-mode code path. The `STUB_CLASSIFIER` env var becomes dead code; remove it.

## Related ADRs

- [ADR-0001 — Web hosting (Lambda + OpenNext)](0001-web-hosting.md): same philosophy of breaking large changes into auditable pieces
- [ADR-0002 — DynamoDB schema](0002-dynamodb-schema.md): the `applications` and `sync_state` tables this pipeline writes to
