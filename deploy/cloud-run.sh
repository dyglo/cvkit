#!/bin/sh
set -eu

PROJECT_ID="${1:-your-project-id}"
REGION="${2:-us-central1}"
GEMINI_SECRET_NAME="${3:-cvkit-gemini-key}"
SERVICE_NAME="${4:-cvkit}"
GEMINI_SECRET_VERSION="${5:-latest}"
IMAGE="gcr.io/${PROJECT_ID}/cvkit:latest"

echo "Building Docker image..."
docker build -t "${IMAGE}" .

echo "Pushing to Google Container Registry..."
docker push "${IMAGE}"

echo "Deploying to Cloud Run..."
gcloud run deploy "${SERVICE_NAME}" \
  --image "${IMAGE}" \
  --platform managed \
  --region "${REGION}" \
  --no-allow-unauthenticated \
  --set-secrets "CVKIT_GEMINI_KEY=${GEMINI_SECRET_NAME}:${GEMINI_SECRET_VERSION}" \
  --memory 1Gi \
  --cpu 1 \
  --port 8080

echo "Deployment complete. Cloud Run requires authenticated access."
