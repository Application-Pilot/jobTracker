/**
 * Deprecated: Apps Script sync is intentionally disabled in this project.
 *
 * Use the Cloud Run + Cloud Scheduler flow instead:
 *   Cloud Scheduler -> POST /api/sync -> /api/applications/upsert -> Google Sheet
 *
 * See:
 *   - CLAUDE.md
 *   - SYNC.md
 *   - CREATE_SCHEDULER.sh
 */

function disabledMessage_() {
  return [
    'Apps Script sync is disabled for this project.',
    'Use Cloud Scheduler to call /api/sync on the deployed app instead.',
    'See CLAUDE.md and SYNC.md for the supported setup.',
  ].join(' ');
}

function syncNow() {
  throw new Error(disabledMessage_());
}

function installDailyTrigger() {
  throw new Error(disabledMessage_());
}

function removeTriggers() {
  Logger.log('No Apps Script triggers to remove. ' + disabledMessage_());
}

function resetSeenThreads() {
  Logger.log('No Apps Script state to reset. ' + disabledMessage_());
}
