#!/usr/bin/env bash
# Create Cloud Scheduler job to run sync every 15 minutes

set -euo pipefail

PROJECT_ID="${PROJECT_ID:-jobtracker-494704}"
LOCATION="${LOCATION:-us-central1}"
SERVICE="${SERVICE:-jobtracker}"
JOB_NAME="${JOB_NAME:-jobtracker-sync}"

if [[ ! -f .env.local ]]; then
  echo "Missing .env.local — create it first." >&2
  exit 1
fi

# Load env vars exactly as the app sees them, including quoted values.
set -a
. ./.env.local
set +a

SYNC_SECRET="${SYNC_SHARED_SECRET:-}"
if [[ -z "$SYNC_SECRET" ]]; then
  echo "Missing SYNC_SHARED_SECRET in .env.local — refusing to create an unauthenticated scheduler job." >&2
  exit 1
fi

gcloud config set project "$PROJECT_ID" >/dev/null
gcloud services enable cloudscheduler.googleapis.com run.googleapis.com >/dev/null

DEPLOYED_URL="$(gcloud run services describe "$SERVICE" --region "$LOCATION" --format='value(status.url)')"
if [[ -z "$DEPLOYED_URL" ]]; then
  echo "Could not resolve Cloud Run URL for service '$SERVICE' in region '$LOCATION'." >&2
  exit 1
fi

echo "Creating Cloud Scheduler job..."
echo "  URL: $DEPLOYED_URL/api/sync"
echo "  Schedule: every 15 minutes"
echo "  Auth: OIDC token plus X-Sync-Secret from .env.local"

# Delete old job if it exists
gcloud scheduler jobs delete "$JOB_NAME" --location="$LOCATION" --quiet 2>/dev/null || true

# Create new job: every 15 minutes (*/15 * * * *)
gcloud scheduler jobs create http "$JOB_NAME" \
  --schedule="*/15 * * * *" \
  --http-method=POST \
  --uri="$DEPLOYED_URL/api/sync" \
  --oidc-service-account-email="$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')-compute@developer.gserviceaccount.com" \
  --oidc-token-audience="$DEPLOYED_URL" \
  --headers="X-Sync-Secret=$SYNC_SECRET" \
  --location="$LOCATION"

echo "✅ Job created!"
echo ""
echo "Test it:"
echo "  gcloud scheduler jobs run $JOB_NAME --location=$LOCATION"
echo ""
echo "View logs:"
echo "  gcloud run logs read $SERVICE --limit 100 --region=$LOCATION"
