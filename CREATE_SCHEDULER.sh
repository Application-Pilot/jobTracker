#!/usr/bin/env bash
# Create Cloud Scheduler job to run sync every 15 minutes

PROJECT_ID="${PROJECT_ID:-jobtracker-494704}"
LOCATION="${LOCATION:-us-central1}"

DEPLOYED_URL=$(gcloud run services describe jobtracker --region $LOCATION --format='value(status.url)')
SYNC_SECRET=$(grep SYNC_SHARED_SECRET /Users/daipayanhati/Desktop/Personal\ Projects/jobtracker/.env.local | cut -d= -f2-)

echo "Creating Cloud Scheduler job..."
echo "  URL: $DEPLOYED_URL/api/sync"
echo "  Schedule: every 15 minutes"
echo "  Auth: Bearer token (SYNC_SHARED_SECRET=$SYNC_SECRET)"

# Delete old job if it exists
gcloud scheduler jobs delete jobtracker-sync --location=$LOCATION --quiet 2>/dev/null || true

# Create new job: every 15 minutes (*/15 * * * *)
gcloud scheduler jobs create http jobtracker-sync \
  --schedule="*/15 * * * *" \
  --http-method=POST \
  --uri="$DEPLOYED_URL/api/sync" \
  --oidc-service-account-email=$(gcloud projects describe $PROJECT_ID --format='value(projectNumber)')-compute@developer.gserviceaccount.com \
  --oidc-token-audience="$DEPLOYED_URL" \
  --headers="Authorization=Bearer $SYNC_SECRET" \
  --location=$LOCATION

echo "✅ Job created!"
echo ""
echo "Test it:"
echo "  gcloud scheduler jobs run jobtracker-sync --location=$LOCATION"
echo ""
echo "View logs:"
echo "  gcloud run logs read jobtracker --limit 100 --region=$LOCATION"
