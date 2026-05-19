# Sync Pipeline Module

Creates the Stage 2 Gmail sync plumbing:

EventBridge runs `jobtracker-dev-sync-scheduler` every 15 minutes. The scheduler scans Gmail-connected users, checks each user's `sync_state.nextSyncEligibleAt`, and sends `{ "userId": "..." }` messages to `jobtracker-dev-sync-jobs` for users that are due.

`jobtracker-dev-sync-worker` consumes one SQS message per invocation, decrypts the user's KMS-encrypted Gmail refresh token with `EncryptionContext = { userId }`, refreshes a Google access token, and then calls the Session C stub classifier. The stub writes one synthetic application and updates `sync_state`.

No Gmail message fetching, classification, LLM extraction, alarms, dashboards, or concurrency caps are included yet. Those are Stage 2 Session D / Stage 3 concerns.
