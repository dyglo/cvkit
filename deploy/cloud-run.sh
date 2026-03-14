#!/bin/sh
set -eu

PROJECT_ID="${1:-your-project-id}"
REGION="${2:-us-central1}"
IMAGE="gcr.io/${PROJECT_ID}/cvkit:latest"

if [ -z "${CVKIT_OPENAI_KEY:-}" ]; then
  echo "CVKIT_OPENAI_KEY must be set before deploying."
  exit 1
fi

echo "Building Docker image..."
docker build -t "${IMAGE}" .

echo "Pushing to Google Container Registry..."
docker push "${IMAGE}"

echo "Deploying to Cloud Run..."
gcloud run deploy cvkit \
  --image "${IMAGE}" \
  --platform managed \
  --region "${REGION}" \
  --allow-unauthenticated \
  --set-env-vars "CVKIT_OPENAI_KEY=${CVKIT_OPENAI_KEY}" \
  --memory 1Gi \
  --cpu 1 \
  --port 8080

echo "Deployment complete."
