#!/usr/bin/env bash
# Deploy jobtracker to Google Cloud Run.
#
# Prereqs (one-time):
#   1. gcloud CLI installed + `gcloud auth login` + `gcloud auth configure-docker`
#   2. Set PROJECT_ID below (or override with: PROJECT_ID=foo ./deploy.sh)
#   3. cred.json present at project root (your service account JSON)
#   4. .env.local with all required vars
#
# What it does:
#   - Enables required APIs
#   - Stores GOOGLE_SERVICE_ACCOUNT_KEY in Secret Manager (reads from cred.json)
#   - Builds the container with Cloud Build
#   - Deploys to Cloud Run with min-instances=0 (scales to zero)
#   - Prints the public URL

set -euo pipefail

PROJECT_ID="${PROJECT_ID:-jobtracker-494704}"
REGION="${REGION:-us-central1}"
SERVICE="${SERVICE:-jobtracker}"
SECRET_NAME="${SECRET_NAME:-google-service-account-key}"

if [[ ! -f .env.local ]]; then
  echo "Missing .env.local — create it first (see README)." >&2
  exit 1
fi

# Load env vars exactly as the app sees them, including quoted values.
set -a
. ./.env.local
set +a

GOOGLE_SHEETS_ID="${GOOGLE_SHEETS_ID:-}"
GOOGLE_SERVICE_ACCOUNT_EMAIL="${GOOGLE_SERVICE_ACCOUNT_EMAIL:-}"
SYNC_SHARED_SECRET="${SYNC_SHARED_SECRET:-}"
GEMINI_API_KEY="${GEMINI_API_KEY:-}"
DASHBOARD_BASE_URL="${DASHBOARD_BASE_URL:-}"
GMAIL_REFRESH_TOKEN="${GMAIL_REFRESH_TOKEN:-}"
GMAIL_CLIENT_ID="${GMAIL_CLIENT_ID:-}"
GMAIL_CLIENT_SECRET="${GMAIL_CLIENT_SECRET:-}"

if [[ -z "$GOOGLE_SHEETS_ID" || -z "$GOOGLE_SERVICE_ACCOUNT_EMAIL" ]]; then
  echo "Missing GOOGLE_SHEETS_ID or GOOGLE_SERVICE_ACCOUNT_EMAIL in .env.local." >&2
  exit 1
fi

if [[ ! -f cred.json ]]; then
  echo "Missing cred.json (service account JSON)." >&2
  exit 1
fi

echo "▶ Project: $PROJECT_ID  Region: $REGION  Service: $SERVICE"

gcloud config set project "$PROJECT_ID" >/dev/null

echo "▶ Enabling APIs (run, cloudbuild, artifactregistry, secretmanager)..."
gcloud services enable \
  run.googleapis.com \
  cloudbuild.googleapis.com \
  artifactregistry.googleapis.com \
  secretmanager.googleapis.com \
  cloudscheduler.googleapis.com >/dev/null

# Extract the private_key from cred.json — that's what we store as a secret.
PRIVATE_KEY="$(python3 -c 'import json,sys; print(json.load(open("cred.json"))["private_key"], end="")')"

if gcloud secrets describe "$SECRET_NAME" >/dev/null 2>&1; then
  echo "▶ Updating secret $SECRET_NAME..."
  printf '%s' "$PRIVATE_KEY" | gcloud secrets versions add "$SECRET_NAME" --data-file=- >/dev/null
else
  echo "▶ Creating secret $SECRET_NAME..."
  printf '%s' "$PRIVATE_KEY" | gcloud secrets create "$SECRET_NAME" --replication-policy=automatic --data-file=- >/dev/null
fi

# Allow the Cloud Run runtime service account (default: PROJECT_NUMBER-compute@...) to read the secret.
PROJECT_NUMBER="$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')"
RUNTIME_SA="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"
gcloud secrets add-iam-policy-binding "$SECRET_NAME" \
  --member="serviceAccount:${RUNTIME_SA}" \
  --role=roles/secretmanager.secretAccessor >/dev/null 2>&1 || true

ENV_VARS="GOOGLE_SHEETS_ID=${GOOGLE_SHEETS_ID},GOOGLE_SERVICE_ACCOUNT_EMAIL=${GOOGLE_SERVICE_ACCOUNT_EMAIL}"
if [[ -n "$SYNC_SHARED_SECRET" ]]; then
  ENV_VARS="${ENV_VARS},SYNC_SHARED_SECRET=${SYNC_SHARED_SECRET}"
fi
if [[ -n "$GEMINI_API_KEY" ]]; then
  ENV_VARS="${ENV_VARS},GEMINI_API_KEY=${GEMINI_API_KEY}"
fi
if [[ -n "$GMAIL_REFRESH_TOKEN" ]]; then
  ENV_VARS="${ENV_VARS},GMAIL_REFRESH_TOKEN=${GMAIL_REFRESH_TOKEN}"
fi
if [[ -n "$GMAIL_CLIENT_ID" ]]; then
  ENV_VARS="${ENV_VARS},GMAIL_CLIENT_ID=${GMAIL_CLIENT_ID}"
fi
if [[ -n "$GMAIL_CLIENT_SECRET" ]]; then
  ENV_VARS="${ENV_VARS},GMAIL_CLIENT_SECRET=${GMAIL_CLIENT_SECRET}"
fi
if [[ -n "$DASHBOARD_BASE_URL" ]] && [[ ! "$DASHBOARD_BASE_URL" =~ ^https?://(localhost|127\.0\.0\.1)(:[0-9]+)?/?$ ]]; then
  ENV_VARS="${ENV_VARS},DASHBOARD_BASE_URL=${DASHBOARD_BASE_URL}"
fi

if [[ -n "$DASHBOARD_BASE_URL" ]] && [[ "$DASHBOARD_BASE_URL" =~ ^https?://(localhost|127\.0\.0\.1)(:[0-9]+)?/?$ ]]; then
  echo "▶ Skipping local DASHBOARD_BASE_URL for Cloud Run; /api/sync will use the incoming request origin."
fi

echo "▶ Building + deploying (this takes 2-4 min)..."
gcloud run deploy "$SERVICE" \
  --source . \
  --region "$REGION" \
  --allow-unauthenticated \
  --min-instances=0 \
  --max-instances=2 \
  --memory=512Mi \
  --cpu=1 \
  --port=8080 \
  --set-env-vars="$ENV_VARS" \
  --set-secrets="GOOGLE_SERVICE_ACCOUNT_KEY=${SECRET_NAME}:latest"

URL="$(gcloud run services describe "$SERVICE" --region "$REGION" --format='value(status.url)')"
echo
echo "✅ Deployed: $URL"
echo "   Use this as DASHBOARD_BASE_URL in your .env.local if not already set."
